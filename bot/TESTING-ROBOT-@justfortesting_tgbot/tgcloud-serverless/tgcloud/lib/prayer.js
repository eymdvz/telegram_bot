// lib/prayer.js — waktu-solat core, ported from GAS v2.gs + Unisza/code.gs.
// Timezone: Asia/Singapore = UTC+8 fixed (no DST), so MYT = UTC+8 always.

import { api, fetch, db, BotApiError } from 'sdk';
import { eq } from 'sdk/db';
import { prayerDays } from '../schema.js';
import {
  CHANNEL_ID, ZONE, HEADER_TITLE, HEADER_PLACE, ZONE_CAPTION,
  FOOTER_TAG, FOOTER_BY, PRAYERS, PRAYER_KEYS, TEST_CHANNEL_LINK,
} from './config.js';

const MYT_OFFSET_MS = 8 * 3600 * 1000;
const DAYS_MS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const MONTHS_MS = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
const MOON_MS = ['Muharram', 'Safar', "Rabi'ul Awal", "Rabi'ul Akhir", 'Jamadil Awal', 'Jamadil Akhir', 'Rejab', "Sya'aban", 'Ramadhan', 'Syawal', 'Zulkaedah', 'Zulhijjah'];

const myt = (d = new Date()) => new Date(d.getTime() + MYT_OFFSET_MS);

// Minimal HTML→RichText for the tags our heads/bodies use (<b>, <blockquote>).
function inlineRich(s) {
  const out = [];
  const re = /<b>(.*?)<\/b>/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push({ type: 'bold', text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function reminderBlocks(p, time, nextTxt, mainMsgId) {
  const head = p.head || `🕌 Waktu Solat <b>${p.name}! ${p.emoji}</b>`;
  const body = p.body || 'bagi umat Islam.\nMoh belaka solat awal!';
  const blocks = [
    { type: 'paragraph', text: [...inlineRich(head), `\n${time}`] },
  ];
  const bq = body.match(/^<blockquote>([\s\S]*)<\/blockquote>$/);
  if (bq) blocks.push({ type: 'blockquote', blocks: [{ type: 'paragraph', text: bq[1] }] });
  else blocks.push({ type: 'paragraph', text: inlineRich(body) });
  blocks.push({ type: 'buttons', align: 'center', buttons: [
    { text: `🌐 Waktu Solat ${ZONE}`, url: `https://dev.mamtj6.com/waktu-solat?location=${ZONE}`, style: 'success' },
  ] });
  return { blocks, fallback: `${head}\n${time}\n\n${body}`, nextTxt };
}

export function dayKey(d = new Date()) {
  const m = myt(d);
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}-${String(m.getUTCDate()).padStart(2, '0')}`;
}

// GAS Utilities.formatDate(ts, tz, 'hh:mm a') equivalent.
export function fmtTime(unixSec) {
  const m = myt(new Date(unixSec * 1000));
  let h = m.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(m.getUTCMinutes()).padStart(2, '0')} ${ap}`;
}

async function fetchDayTimes() {
  const m = myt();
  const y = m.getUTCFullYear();
  const mo = m.getUTCMonth() + 1;
  const dd = m.getUTCDate();
  const res = await fetch(`https://api.waktusolat.app/v2/solat/${ZONE}?year=${y}&month=${mo}`);
  if (!res.ok) throw new Error(`solat fetch ${res.status}`);
  const data = await res.json();
  const found = (data.prayers || []).find((p) => p.day === dd);
  if (!found) throw new Error('solat day not found');
  const times = {};
  for (const k of PRAYER_KEYS) times[k] = found[k];
  const [hy, hm, hd] = String(found.hijri).split('-');
  return {
    dates: `📅 ${DAYS_MS[m.getUTCDay()]}, ${dd} ${MONTHS_MS[m.getUTCMonth()]} ${y}`,
    hijri: `🇵🇸 ${hd} ${MOON_MS[parseInt(hm, 10) - 1]} ${hy}H`,
    times,
  };
}

// Rich day card (shape proven by /message1 in bot/ask_the_robot).
// current = prayer key to bold, or null.
export function buildBlocks(today, current = null) {
  const nameCell = (t) => ({ text: t, align: 'right', valign: 'top' });
  const timeCell = (t) => ({ text: t, align: 'left', valign: 'top' });
  const hotName = (t) => ({ text: t, is_header: true, align: 'right', valign: 'top' });
  const hotTime = (t) => ({ text: t, is_header: true, align: 'left', valign: 'top' });
  const rows = PRAYERS.map((p) => {
    const hot = p.key === current;
    return hot
      ? [hotName(`${p.emoji} ${p.name}`), hotTime(fmtTime(today.times[p.key]))]
      : [nameCell(`${p.emoji} ${p.name}`), timeCell(fmtTime(today.times[p.key]))];
  });
  const blocks = [
    { type: 'paragraph', text: `${HEADER_TITLE}\n${HEADER_PLACE}\n\n${today.dates}\n${today.hijri}` },
    { type: 'divider' },
    { type: 'table', is_bordered: false, is_compact: true, caption: ZONE_CAPTION, cells: [...rows] },
    { type: 'paragraph', text: [{ type: 'hashtag', text: `#${FOOTER_TAG}`, hashtag: FOOTER_TAG }, `\nby @${FOOTER_BY}`] },
    { type: 'buttons', align: 'center', buttons: [{ text: `Waktu Solat ${ZONE}`, url: `https://dev.mamtj6.com/waktu-solat?location=${ZONE}`, style: 'success' }] },
  ];
  const lines = PRAYERS.map((p) => `${p.emoji} ${fmtTime(today.times[p.key])} : ${p.name}`);
  const fallback = `${HEADER_TITLE}\n${HEADER_PLACE}\n\n${today.dates}\n${today.hijri}\n\n${lines.join('\n')}\n\n#${FOOTER_TAG}\nby @${FOOTER_BY}`;
  return { blocks, fallback };
}

// Post today's rich card to the test channel. Upserts prayer_days.
export async function postDaily(currentKey = null) {
  const key = dayKey();
  const today = await fetchDayTimes();
  const { blocks, fallback } = buildBlocks(today, currentKey);
  let mainMsgId;
  let rich = true;
  try {
    const r = await api.sendRichMessage({ chat_id: CHANNEL_ID, rich_message: { blocks } });
    mainMsgId = r.message_id;
  } catch (e) {
    if (!(e instanceof BotApiError) || e.code !== 400) throw e;
    console.error('rich failed, falling back:', e.description);
    const r = await api.sendMessage({ chat_id: CHANNEL_ID, text: fallback.slice(0, 4096) });
    mainMsgId = r.message_id;
    rich = false;
  }
  await db.insert(prayerDays).values({
    day: key, zone: ZONE, dates: today.dates, hijri: today.hijri,
    timesJson: today.times, mainMsgId, reminderJson: {}, preJson: {},
  }).onConflictDoUpdate({
    target: prayerDays.day,
    set: { dates: today.dates, hijri: today.hijri, timesJson: today.times, mainMsgId },
  }).run();
  return { day: key, mainMsgId, rich };
}

// Post reminders for prayers whose time has passed and has no reminder yet.
// 429 → stop, keep unsent for the next tick (reminder id only saved on ok).
export async function tickReminders(nowMs = Date.now()) {
  const key = dayKey(new Date(nowMs));
  const row = await db.select().from(prayerDays).where(eq(prayerDays.day, key)).get();
  if (!row || !row.mainMsgId) return { day: key, posted: [], note: 'no-day-row' };
  const times = row.timesJson || {};
  const done = row.reminderJson || {};
  const preDone = row.preJson || {};
  const posted = [];
  const prePosted = [];
  for (let i = 0; i < PRAYERS.length; i++) {
    const p = PRAYERS[i];
    if (p.noTick) continue;
    const due = (times[p.key] || 0) * 1000;
    if (!done[p.key] && due <= nowMs) {
      const time = fmtTime(times[p.key]);
      const next = PRAYERS.slice(i + 1).find((q) => !q.noTick);
      const nextTxt = next ? `${next.name} 🔜 ${fmtTime(times[next.key])}` : '⏰ Jadual Waktu Solat Fardhu';
      const { blocks, fallback, nextTxt: rbNext } = reminderBlocks(p, time, nextTxt, row.mainMsgId);
      const reply_parameters = {
        message_id: row.mainMsgId,
        allow_sending_without_reply: true,
        quote_rich_texts: [`${p.emoji} ${p.name}`, time],
      };
      const reply_markup = { inline_keyboard: [[{ text: rbNext, url: `${TEST_CHANNEL_LINK}/${row.mainMsgId}` }]] };
      let r;
      try {
        r = await api.sendRichMessage({ chat_id: CHANNEL_ID, rich_message: { blocks }, reply_parameters, reply_markup });
      } catch (e) {
        if (!(e instanceof BotApiError) || e.code !== 400) throw e;
        console.error('rich reminder failed, falling back:', e.description);
        r = await api.sendMessage({
          chat_id: CHANNEL_ID,
          text: fallback.slice(0, 4096),
          parse_mode: 'HTML',
          reply_parameters,
          reply_markup: { inline_keyboard: [
            [{ text: nextTxt, url: `${TEST_CHANNEL_LINK}/${row.mainMsgId}` }],
            [{ text: `🌐 Waktu Solat ${ZONE}`, url: `https://dev.mamtj6.com/waktu-solat?location=${ZONE}` }],
          ] },
        });
      }
      try {
        done[p.key] = r.message_id;
        posted.push(p.key);
        if (preDone[p.key]) {
          try { await api.deleteMessage({ chat_id: CHANNEL_ID, message_id: preDone[p.key] }); } catch (e2) { /* already gone */ }
          delete preDone[p.key];
        }
        await db.update(prayerDays).set({ reminderJson: done, preJson: preDone }).where(eq(prayerDays.day, key)).run();
      } catch (e) {
        if (e instanceof BotApiError && e.code === 429) {
          console.error('rate limited, rest retries next tick');
          break;
        }
        throw e;
      }
      continue;
    }
    // 10-min heads-up (skip silent rows + Imsak, which IS the fajr-10min
    // warning, + morning Fajr/Dhuha to keep dawn quiet).
    if (!['imsak', 'fajr', 'dhuha'].includes(p.key) && !preDone[p.key] && due - 600000 <= nowMs && nowMs < due) {
      const prevQ = PRAYERS.slice(0, i).reverse().find((q) => !q.noTick);
      const tpl = p.pre || `⏰ Menghampiri Waktu ${p.name} {time}${prevQ ? ` (Waktu ${prevQ.name} berbaki 10 minit lagi).` : '.'}`;
      try {
        const r = await api.sendMessage({
          chat_id: CHANNEL_ID,
          text: tpl.split('{time}').join(fmtTime(times[p.key])),
          parse_mode: 'HTML',
          reply_parameters: { message_id: row.mainMsgId, allow_sending_without_reply: true },
        });
        preDone[p.key] = r.message_id;
        prePosted.push(p.key);
        await db.update(prayerDays).set({ preJson: preDone }).where(eq(prayerDays.day, key)).run();
      } catch (e) {
        if (e instanceof BotApiError && e.code === 429) {
          console.error('rate limited, rest retries next tick');
          break;
        }
        throw e;
      }
    }
  }
  return { day: key, mainMsgId: row.mainMsgId, posted, prePosted };
}

export async function dayStatus(nowMs = Date.now()) {
  const key = dayKey(new Date(nowMs));
  const row = await db.select().from(prayerDays).where(eq(prayerDays.day, key)).get();
  if (!row) return `No row for ${key} — run /solat_today first.`;
  const times = row.timesJson || {};
  const done = row.reminderJson || {};
  const preDone = row.preJson || {};
  const lines = PRAYERS.map((p) => {
    const mark = p.noTick ? '🔇' : done[p.key] ? '✅' : preDone[p.key] ? '🔔' : '⏳';
    return `${mark} ${p.name} ${fmtTime(times[p.key] || 0)}`;
  });
  return `${row.dates}\ncard msg ${row.mainMsgId}\n${lines.join('\n')}`;
}
