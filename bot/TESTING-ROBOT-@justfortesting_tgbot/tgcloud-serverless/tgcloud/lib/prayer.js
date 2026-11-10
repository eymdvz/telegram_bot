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
  const headCell = (t) => ({ text: t, is_header: true, align: 'left', valign: 'top' });
  const cell = (t, bold) => bold
    ? { text: { type: 'bold', text: t }, align: 'left', valign: 'top' }
    : { text: t, align: 'left', valign: 'top' };
  const rows = PRAYERS.map((p) => {
    const bold = p.key === current;
    return [cell(`${p.emoji} ${p.name}`, bold), cell(fmtTime(today.times[p.key]), bold)];
  });
  const blocks = [
    { type: 'paragraph', text: `${HEADER_TITLE}\n${HEADER_PLACE}\n\n${today.dates}\n${today.hijri}` },
    { type: 'divider' },
    { type: 'blockquote', blocks: [{ type: 'table', is_bordered: true, caption: ZONE_CAPTION, cells: [[headCell('Solat'), headCell('Waktu')], ...rows] }] },
    { type: 'paragraph', text: [{ type: 'hashtag', text: `#${FOOTER_TAG}`, hashtag: FOOTER_TAG }, `\nby @${FOOTER_BY}`] },
    { type: 'buttons', align: 'center', buttons: [{ text: `Waktu Solat ${ZONE}`, url: `https://dev.mamtj6.com/waktu-solat?location=${ZONE}`, style: 'success' }] },
  ];
  const lines = PRAYERS.map((p) => `${p.emoji} ${fmtTime(today.times[p.key])} : ${p.name}`);
  const fallback = `${HEADER_TITLE}\n${HEADER_PLACE}\n\n${today.dates}\n${today.hijri}\n\n${lines.join('\n')}\n\n#${FOOTER_TAG}\nby @${FOOTER_BY}`;
  return { blocks, fallback };
}

// Post today's rich card to the test channel. Upserts prayer_days.
export async function postDaily() {
  const key = dayKey();
  const today = await fetchDayTimes();
  const { blocks, fallback } = buildBlocks(today);
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
    timesJson: today.times, mainMsgId, reminderJson: {},
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
  const posted = [];
  for (let i = 0; i < PRAYERS.length; i++) {
    const p = PRAYERS[i];
    if (done[p.key] || (times[p.key] || 0) * 1000 > nowMs) continue;
    const time = fmtTime(times[p.key]);
    const next = PRAYERS[i + 1];
    const nextTxt = next ? `${next.name} 🔜 ${fmtTime(times[next.key])}` : '⏰ Jadual Waktu Solat Fardhu';
    try {
      const r = await api.sendMessage({
        chat_id: CHANNEL_ID,
        text: `🕌 Waktu Solat <b>${p.name}! ${p.emoji}</b>\n${time}\n\nbagi umat Islam.\nMoh belaka solat awal!`,
        parse_mode: 'HTML',
        reply_parameters: {
          message_id: row.mainMsgId,
          allow_sending_without_reply: true,
          quote_rich_texts: [`${p.emoji} ${p.name}`, time],
        },
        reply_markup: { inline_keyboard: [[{ text: nextTxt, url: `${TEST_CHANNEL_LINK}/${row.mainMsgId}` }]] },
      });
      done[p.key] = r.message_id;
      posted.push(p.key);
      await db.update(prayerDays).set({ reminderJson: done }).where(eq(prayerDays.day, key)).run();
    } catch (e) {
      if (e instanceof BotApiError && e.code === 429) {
        console.error('rate limited, rest retries next tick');
        break;
      }
      throw e;
    }
  }
  return { day: key, mainMsgId: row.mainMsgId, posted };
}

export async function dayStatus(nowMs = Date.now()) {
  const key = dayKey(new Date(nowMs));
  const row = await db.select().from(prayerDays).where(eq(prayerDays.day, key)).get();
  if (!row) return `No row for ${key} — run /solat_today first.`;
  const times = row.timesJson || {};
  const done = row.reminderJson || {};
  const lines = PRAYERS.map((p) => `${done[p.key] ? '✅' : '⏳'} ${p.name} ${fmtTime(times[p.key] || 0)}`);
  return `${row.dates}\ncard msg ${row.mainMsgId}\n${lines.join('\n')}`;
}
