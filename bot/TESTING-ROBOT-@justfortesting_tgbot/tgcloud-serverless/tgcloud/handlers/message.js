// handlers/message.js — owner-only test commands for the solat rich trial.
import { api, BotApiError, db } from 'sdk';
import { eq } from 'sdk/db';
import { dmTopics } from '../schema.js';
import { guarded } from '../lib/errors.js';
import { postDaily, tickReminders, dayStatus } from '../lib/prayer.js';
import { PROBES } from '../lib/probe.js';
import { PROBEHTML } from '../lib/probehtml.js';
import { ADMIN_IDS } from '../lib/config.js';

// Channel monoforum (Test Channel DMs): t.me/c/1071267775431 → Bot API -2071267775431.
const MONOFORUM_CHAT = -2071267775431;
const DM_HEAD = 'ᴮᴼᵀ ᴬᵁᵀᴼᴹᴬᵀᴱᴰ ᴹᴱˢˢᴬᴳᴱ';
// Redirect card re-sends when the last one is older than this (seconds).
const DM_COOLDOWN_S = 3600;

// Every bot message inside a DM thread carries the header.
function dmMsg(t) {
  return `${DM_HEAD}\n\n${t}`;
}

// HTML-escape for parse_mode:'HTML' sends (names can contain <>&).
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Monoforum list link (t.me/c form). With a message id it opens inside the topic.
function dmLink(msgId) {
  return msgId ? `https://t.me/c/1071267775431/${msgId}` : 'https://t.me/c/1071267775431';
}

// Stamp the bot's latest thread message id (drives the admin jump link).
async function stampMsg(topicId, msgId) {
  try {
    await db.update(dmTopics).set({ lastMsgId: msgId }).where(eq(dmTopics.topicId, topicId)).run();
  } catch (e) { console.error('dm msg stamp failed:', e?.description ?? e?.message ?? e); }
}

// Thread-aware params: keeps sends inside the topic the update came from.
function replyParams(message) {
  const params = { chat_id: message.chat.id };
  if (message.message_thread_id) params.message_thread_id = message.message_thread_id;
  return params;
}

async function handle(message) {
  const text = (message.text ?? '').trim();
  // Channel-DM guest messages arrive as plain messages in the monoforum chat.
  // Must sit BEFORE the admin gate (guests aren't admins) and the /-check.
  if (message.chat && message.chat.id === MONOFORUM_CHAT) {
    const from = message.from ? `@${message.from.username || message.from.first_name} (${message.from.id})` : 'unknown';
    const body = (message.text ?? message.caption ?? '(no text)').slice(0, 200);
    const topicId = (message.direct_messages_topic && message.direct_messages_topic.topic_id) || (message.from && message.from.id);
    const nowS = Math.floor(Date.now() / 1000);
    let row = null;
    try {
      row = topicId ? await db.select().from(dmTopics).where(eq(dmTopics.topicId, topicId)).get() : null;
    } catch (e) { console.error('dm row read failed:', e?.description ?? e?.message ?? e); }
    try {
      if (row) {
        await db.update(dmTopics).set({ lastMsgAt: nowS }).where(eq(dmTopics.topicId, topicId)).run();
      } else if (topicId) {
        await db.insert(dmTopics).values({ topicId, userId: message.from && message.from.id, lastMsgAt: nowS }).run();
        row = { wantAdmin: 0, lastCardAt: 0 };
      }
    } catch (e) { console.error('dm row write failed:', e?.description ?? e?.message ?? e); }
    // No group receipt per message — 819 only hears when the guest taps Chat Admin.
    // Card (re-)sends only when cooldown expired — and never after they tapped Chat Admin.
    const cooled = row && (nowS - (row.lastCardAt || 0) > DM_COOLDOWN_S);
    if (topicId && (!row || cooled) && !(row && row.wantAdmin)) {
      try {
        const guestName = esc((message.from && message.from.first_name) || 'there');
        const r = await api.sendMessage({
          chat_id: MONOFORUM_CHAT,
          direct_messages_topic_id: topicId,
          parse_mode: 'HTML',
          text: dmMsg(`👋 Hi ${guestName}\nYou nak hantar confession? Buat terus dengan bot, bukan di sini.\n\n⚠️ Note: Kalau you sambung chat di sini, admin boleh tahu identity you. Nak hide identity? Sila chat di bot\n\nAda soalan? Refer FAQ dulu.\n\n<i>You want to send a confession? Do it directly with the bot, not here.\n\n⚠️ Note: If you continue chatting here, the admin can know your identity. Want to hide your identity? Please chat in the bot\n\nHave a question? Check the FAQ first.</i>`),
          reply_markup: { inline_keyboard: [[
            { text: '📩 Send to Bot', url: 'https://t.me/Just_arobot?start=confess' },
            { text: '❓ FAQ', url: 'https://t.me/unijaconfession/66437' },
          ], [
            { text: '💬 Chat Admin', callback_data: 'dm_admin' },
          ]] },
        });
        try {
          await db.update(dmTopics).set({ lastCardAt: nowS, lastMsgId: r.message_id }).where(eq(dmTopics.topicId, topicId)).run();
        } catch (e2) { console.error('dm card stamp failed:', e2?.description ?? e2?.message ?? e2); }
      } catch (e) { console.error('thread reply failed:', e?.description ?? e?.message ?? e); }
    }
    return;
  }
  if (!text.startsWith('/')) {
    // File-id echo: forward any audio/document/voice/video here, get its file_id back.
    // (One-time setup helper for GAS broadcasts — file_id is per-bot.)
    const m = message.audio ? ['audio', message.audio] : message.document ? ['document', message.document] : message.voice ? ['voice', message.voice] : message.video ? ['video', message.video] : message.video_note ? ['video_note', message.video_note] : null;
    if (m) {
      await api.sendMessage({
        ...replyParams(message),
        text: `type: ${m[0]}\nfile_id:\n${m[1].file_id}\nmime: ${m[1].mime_type || '-'}\nsize: ${m[1].file_size || '-'}`,
      });
    }
    return;
  }
  const chatId = message.chat.id;
  if (!ADMIN_IDS.includes(message.from?.id)) {
    await api.sendMessage({ chat_id: chatId, text: 'Test command — owner only.' });
    return;
  }
  const cmd = text.split(' ')[0].split('@')[0];
  if (cmd === '/start') {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Solat rich trial.\n/solat_today — post day card\n/solat_tick — post due reminders\n/solat_status — show today row',
    });
    return;
  }
  if (cmd === '/solat_today') {
    const out = await postDaily();
    await api.sendMessage({ chat_id: chatId, text: `Posted ${out.day} → msg ${out.mainMsgId} (rich=${out.rich})` });
    return;
  }
  if (cmd === '/solat_tick') {
    const out = await tickReminders();
    await api.sendMessage({ chat_id: chatId, text: `Tick ${out.day}: posted [${out.posted.join(',')}]${out.note ? ` (${out.note})` : ''}` });
    return;
  }
  if (cmd === '/solat_status') {
    await api.sendMessage({ chat_id: chatId, text: (await dayStatus()).slice(0, 4096) });
    return;
  }
  if (cmd === '/probeephemeral') {
    await api.sendMessage({
      ...replyParams(message),
      text: 'Tap the button — the reply is ephemeral (only you see it).\nNote: mobile shows it in this topic, desktop pins it to General.',
      reply_markup: { inline_keyboard: [[{ text: '👁 Tap for secret', callback_data: 'ephe_probe' }]] },
    });
    return;
  }
  if (cmd === '/dmreset') {
    // /dmreset <userId> — clear cooldown + admin flag so the next message re-sends the card.
    const userId = Number(text.split(/\s+/)[1]);
    if (!userId) {
      await api.sendMessage({ ...replyParams(message), text: 'Usage:\n/dmreset <userId>' });
      return;
    }
    try {
      const row = await db.select().from(dmTopics).where(eq(dmTopics.topicId, userId)).get();
      if (row) {
        await db.update(dmTopics).set({ lastCardAt: 0, wantAdmin: 0 }).where(eq(dmTopics.topicId, userId)).run();
      } else {
        await db.insert(dmTopics).values({ topicId: userId, userId, lastCardAt: 0, wantAdmin: 0, lastMsgAt: 0 }).run();
      }
      await api.sendMessage({ ...replyParams(message), text: `DM cooldown cleared for ${userId} — next message re-sends the card.` });
    } catch (e) {
      await api.sendMessage({ ...replyParams(message), text: `DM reset failed: ${(e?.description || e?.message || e)}`.slice(0, 400) });
    }
    return;
  }
  if (cmd === '/dmreply' || cmd === '/dmreplyto') {
    // /dmreply <userId> <text...> — plain thread message as the channel.
    // /dmreplyto <userId> <msgId> <text...> — quoted reply to a thread message.
    const parts = text.split(/\s+/);
    const userId = Number(parts[1]);
    let msgId = null;
    let bodyParts;
    if (cmd === '/dmreplyto') {
      msgId = Number(parts[2]);
      bodyParts = parts.slice(3);
    } else {
      bodyParts = parts.slice(2);
    }
    if (!userId || (cmd === '/dmreplyto' && !msgId) || !bodyParts.length) {
      await api.sendMessage({ ...replyParams(message), text: `Usage:\n/dmreply <userId> <text>\n/dmreplyto <userId> <msgId> <text>` });
      return;
    }
    const params = { chat_id: MONOFORUM_CHAT, direct_messages_topic_id: userId, text: dmMsg(bodyParts.join(' ')) };
    if (msgId) params.reply_parameters = { message_id: msgId };
    try {
      const r = await api.sendMessage(params);
      try {
        await db.update(dmTopics).set({ lastMsgId: r.message_id }).where(eq(dmTopics.topicId, userId)).run();
      } catch (e2) { /* stamp best-effort */ }
      await api.sendMessage({ ...replyParams(message), text: `DM sent → msg ${r.message_id} (topic ${userId}${msgId ? `, reply to ${msgId}` : ''})\n${dmLink(r.message_id)}` });
    } catch (e) {
      await api.sendMessage({ ...replyParams(message), text: `DM failed: ${(e?.description || e?.message || e)}`.slice(0, 400) });
    }
    return;
  }
  if (cmd === '/threadtest') {
    // Private-chat topics probe (Threaded Mode must be ON in BotFather).
    // /threadtest open [name] | say <topicId> <text> | close <topicId> | reopen <topicId> | del <topicId>
    const rest = text.slice('/threadtest'.length).trim().split(/\s+/).filter(Boolean);
    const sub = (rest.shift() ?? '').toLowerCase();
    const usage = 'Usage:\n/threadtest open [name]\n/threadtest say <topicId> <text>\n/threadtest close <topicId>\n/threadtest reopen <topicId>\n/threadtest del <topicId>';
    try {
      if (sub === 'open') {
        const name = rest.join(' ') || 'Test topic';
        const t = await api.createForumTopic({ chat_id: chatId, name });
        await api.sendMessage({ ...replyParams(message), text: `Topic opened: id ${t.message_thread_id} ("${t.name}"). Try: /threadtest say ${t.message_thread_id} hello` });
      } else if (sub === 'say') {
        const tid = Number(rest.shift());
        const body = rest.join(' ');
        if (!tid || !body) throw new Error('usage: /threadtest say <topicId> <text>');
        const m = await api.sendMessage({ chat_id: chatId, message_thread_id: tid, text: body });
        await api.sendMessage({ ...replyParams(message), text: `Sent into topic ${tid} (msg ${m.message_id}).` });
      } else if (sub === 'close' || sub === 'reopen' || sub === 'del') {
        const tid = Number(rest[0]);
        if (!tid) throw new Error(`usage: /threadtest ${sub} <topicId>`);
        if (sub === 'close') await api.closeForumTopic({ chat_id: chatId, message_thread_id: tid });
        if (sub === 'reopen') await api.reopenForumTopic({ chat_id: chatId, message_thread_id: tid });
        if (sub === 'del') await api.deleteForumTopic({ chat_id: chatId, message_thread_id: tid });
        await api.sendMessage({ ...replyParams(message), text: `Topic ${tid}: ${sub} ok.` });
      } else {
        await api.sendMessage({ ...replyParams(message), text: usage });
      }
    } catch (e) {
      await api.sendMessage({ ...replyParams(message), text: `threadtest FAILED: ${(e?.description || e?.message || e)}`.slice(0, 400) });
    }
    return;
  }
  if (cmd === '/probe') {
    await api.sendMessage({
      ...replyParams(message),
      text: `Probe commands (owner only):\n/probetopic [from] [to] — rich blocks catalog (${PROBES.length} shapes, official Bot API names)\n/proberichhtml [from] [to] — rich HTML catalog (${PROBEHTML.length} groups, #H01–#H10)\n/probelist — list all catalog shapes\n/specialprobe <iklanniaga|mulk|mulkrich|zohorjumaat|zohorpre|zohormasuk> — one-off specials\n/probeephemeral — ephemeral reply probe\n/dmreply <userId> <text> — write into a DM topic\n/dmreplyto <userId> <msgId> <text> — quoted reply into a DM topic\n/dmreset <userId> — clear DM card cooldown\n/solat_today|tick|status — prayer trial`,
    });
    return;
  }
  if (cmd === '/specialprobe') {
    const sub = (text.split(/\s+/)[1] || 'iklan').toLowerCase();
    if (sub === 'mulkrich') {
      try {
        const r = await api.sendRichMessage({
          ...replyParams(message),
          rich_message: { blocks: [
            { type: 'paragraph', text: { type: 'bold', text: 'Daily Al-Mulk Reminder' } },
            { type: 'photo', photo: { type: 'photo', media: 'https://telegra.ph/file/ac93ddd660204b4372274.png' } },
            { type: 'paragraph', text: '✨ Jangan lupa baca surah Al-Mulk setiap malam untuk keberkatan! ✨\nMalas nak baca? nak dengar sebelum tidur pun boleh\nTak dapat buat semua, jangan tinggal semua' },
            { type: 'audio', audio: { type: 'audio', media: 'CQACAgUAAxkBAAMUavVnY9dJI-5Zskop4JhOg7xlk9wAAiMgAALUtalXBMoWnVEQGm09BA', title: 'Bacaan Al-Mulk' } },
            { type: 'paragraph', text: '🎧 Audio Al-Mulk, jom dengar sebelum tidur.' },
          ] },
        });
        await api.sendMessage({ ...replyParams(message), text: `✅ specialprobe mulkrich posted: msg ${r.message_id}` });
      } catch (e) {
        await api.sendMessage({ ...replyParams(message), text: `❌ specialprobe mulkrich: ${e?.description ?? e?.message ?? e}`.slice(0, 400) });
      }
      return;
    }
    if (sub === 'zohorjumaat') {
      try {
        const r = await api.sendRichMessage({
          ...replyParams(message),
          rich_message: { blocks: [
            { type: 'paragraph', text: '⏰ Menghampiri Waktu Solat Jumaat (Zohor) {time}' },
            { type: 'paragraph', text: 'Kaum Adam, moh gi sejid awal' },
            { type: 'pullquote', text: 'Sesiapa yang mandi pada hari Jumaat (seperti) mandi janabah lalu segera pergi ke masjid, maka seakan-akan berkorban dengan unta, sesiapa yang pergi pada masa yang kedua, maka seakan-akan dia berkorban dengan lembu, dan sesiapa pergi pada masa yang ketiga, maka seakan-akan dia berkorban dengan biri-biri jantan yang bertanduk, dan sesiapa yang pergi pada masa yang keempat seakan-akan dia berkorban dengan seekor ayam, dan sesiapa yang pergi pada masa kelima, maka seakan-akan dia berkorban dengan sebiji telur dan apabila imam telah keluar (untuk berkhutbah) maka para malaikat turut hadir untuk mendengar peringatan (khutbah).', credit: 'Hadis yang diriwayatkan oleh Abu Hurairah RA [Riwayat al-Bukhari (881) dan Muslim (850)]' },
          ] },
        });
        await api.sendMessage({ ...replyParams(message), text: `✅ specialprobe zohorjumaat posted: msg ${r.message_id}` });
      } catch (e) {
        await api.sendMessage({ ...replyParams(message), text: `❌ specialprobe zohorjumaat: ${e?.description ?? e?.message ?? e}`.slice(0, 400) });
      }
      return;
    }
    if (sub === 'zohorpre') {
      try {
        const r = await api.sendRichMessage({
          ...replyParams(message),
          rich_message: { blocks: [
            { type: 'paragraph', text: '⏰ Menghampiri Waktu Solat Jumaat (Zohor) 01:05 PM' },
            { type: 'paragraph', text: 'Kaum Adam, moh gi sejid awal' },
            { type: 'pullquote', text: 'Sesiapa yang mandi pada hari Jumaat (seperti) mandi janabah lalu segera pergi ke masjid, maka seakan-akan berkorban dengan unta, sesiapa yang pergi pada masa yang kedua, maka seakan-akan dia berkorban dengan lembu, dan sesiapa pergi pada masa yang ketiga, maka seakan-akan dia berkorban dengan biri-biri jantan yang bertanduk, dan sesiapa yang pergi pada masa yang keempat seakan-akan dia berkorban dengan seekor ayam, dan sesiapa yang pergi pada masa kelima, maka seakan-akan dia berkorban dengan sebiji telur dan apabila imam telah keluar (untuk berkhutbah) maka para malaikat turut hadir untuk mendengar peringatan (khutbah).', credit: 'Hadis yang diriwayatkan oleh Abu Hurairah RA [Riwayat al-Bukhari (881) dan Muslim (850)]' },
          ] },
        });
        await api.sendMessage({ ...replyParams(message), text: `✅ specialprobe zohorpre posted: msg ${r.message_id} (time is placeholder)` });
      } catch (e) {
        await api.sendMessage({ ...replyParams(message), text: `❌ specialprobe zohorpre: ${e?.description ?? e?.message ?? e}`.slice(0, 400) });
      }
      return;
    }
    if (sub === 'zohormasuk') {
      try {
        const r = await api.sendRichMessage({
          ...replyParams(message),
          rich_message: { blocks: [
            { type: 'paragraph', text: ['🕌 Waktu Solat ', { type: 'bold', text: 'Jumaat (Zohor)! 🌞' }, '\n01:05 PM'] },
            { type: 'paragraph', text: 'Yang lelaki, jom pergi masjid, dengor Khutbah Jumaat.\nMoh belaka solat awal!' },
            { type: 'buttons', align: 'center', buttons: [{ text: '🌐 Waktu Solat TRG01', url: 'https://dev.mamtj6.com/waktu-solat?location=TRG01', style: 'success' }] },
          ] },
          reply_markup: { inline_keyboard: [[{ text: 'Asar 🔜 04:35 PM', url: 'https://t.me/c/1267775431/1' }]] },
        });
        await api.sendMessage({ ...replyParams(message), text: `✅ specialprobe zohormasuk posted: msg ${r.message_id} (time is placeholder)` });
      } catch (e) {
        await api.sendMessage({ ...replyParams(message), text: `❌ specialprobe zohormasuk: ${e?.description ?? e?.message ?? e}`.slice(0, 400) });
      }
      return;
    }
    if (sub === 'mulk') {
      try {
        const p = await api.sendPhoto({
          ...replyParams(message),
          photo: 'https://telegra.ph/file/ac93ddd660204b4372274.png',
          caption: '✨ Jangan lupa baca surah Al-Mulk setiap malam untuk keberkatan! ✨\nMalas nak baca? nak dengar sebelum tidur pun boleh\nTak dapat buat semua, jangan tinggal semua',
        });
        const a = await api.sendAudio({
          ...replyParams(message),
          audio: 'CQACAgUAAxkBAAMUavVnY9dJI-5Zskop4JhOg7xlk9wAAiMgAALUtalXBMoWnVEQGm09BA',
          caption: '🎧 Audio Al-Mulk, jom dengar sebelum tidur.',
          title: 'Bacaan Al-Mulk',
        });
        await api.sendMessage({ ...replyParams(message), text: `✅ specialprobe mulk posted: photo ${p.message_id} + audio ${a.message_id}` });
      } catch (e) {
        await api.sendMessage({ ...replyParams(message), text: `❌ specialprobe mulk: ${e?.description ?? e?.message ?? e}`.slice(0, 400) });
      }
      return;
    }
    if (sub === 'iklanniaga') {
    const html = `<p><b>Iklan Niaga/Sewa</b></p><figure><img src="https://telegra.ph/file/6ed5935972e53a04190a2.png"/><figcaption>Iklan niaga/iklan sewa tidak akan di post dalam channel ini.<br/>(rujuk <a href="https://t.me/unijaconfession/61294">Larangan Iklan Niaga</a> / <a href="https://t.me/unijaconfession/68591">larangan iklan sewa</a>).</figcaption></figure><details><summary>Apa itu iklan niaga?</summary><ul><li>Promote link shoppe dan apa jua affiliate</li><li>referral link (Temu, dll)</li><li>Letgo apa jua jenis barangan</li><li>letgo/jual tiket bas</li><li>Sebarang link/pautan kepada group niaga (kecuali yang dibenarkan)</li><li>Apa jua jenis servis (grab, delivery, runner, dan sebagainya)</li></ul></details><details><summary>Apa itu iklan sewa?</summary><ul><li>Kekosongan bilik/rumah &amp; mencari pengganti penyewa</li><li>Promote rumah/bilik sewa (oleh owner/ejen)</li><li>Mencari rumah/bilik sewa (oleh penyewa)</li></ul></details><p><br/></p><tg-button-row align="center"><tg-button type="url" style="success" url="https://t.me/c/4441481560">📝 Iklan Niaga</tg-button></tg-button-row><p>📝 Iklan Niaga: untuk urusan hantar &amp; lihat iklan niaga</p><tg-button-row align="center"><tg-button type="url" url="https://t.me/iklansewa_unisza">🏘️ @iklansewa_unisza</tg-button></tg-button-row><p>🏘️ @\u200Biklansewa_unisza: urusan rumah sewa (iklan, mencari replacement)</p>`;
    try {
      await api.sendRichMessage({ ...replyParams(message), rich_message: { html } });
      await api.sendMessage({ ...replyParams(message), text: '✅ specialprobe: iklan card posted' });
    } catch (e) {
      await api.sendMessage({ ...replyParams(message), text: `❌ specialprobe: ${e?.description ?? e?.message ?? e}`.slice(0, 400) });
    }
    return;
    }
    await api.sendMessage({ ...replyParams(message), text: 'Usage: /specialprobe <iklanniaga|mulk|mulkrich|zohorjumaat|zohorpre|zohormasuk>' });
    return;
  }
  if (cmd === '/probelist') {
    const lines = PROBES.map((p, i) => `#${String(i + 1).padStart(2, '0')} ${p.official} (${p.name})`);
    const hlines = PROBEHTML.map((p, i) => `#H${String(i + 1).padStart(2, '0')} ${p.official} (${p.name})`);
    await api.sendMessage({ ...replyParams(message), text: (`Rich blocks (${PROBES.length}):\n` + lines.join('\n') + `\n\nRich HTML (${PROBEHTML.length}):\n` + hlines.join('\n')).slice(0, 4000) });
    return;
  }
  if (cmd === '/proberichhtml') {
    const args = text.split(/\s+/).slice(1).map(Number).filter((n) => n >= 1 && n <= PROBEHTML.length);
    const from = (args[0] || 1) - 1;
    const to = args.length === 1 ? args[0] : (args[1] || PROBEHTML.length);
    const slice = PROBEHTML.map((p, i) => ({ p, i })).slice(from, to);
    await api.sendMessage({ ...replyParams(message), text: `Probing HTML #H${from + 1}–#H${to} (${slice.length} groups)…\nResume: /proberichhtml ${to + 1}` });
    const results = [];
    for (const { p, i } of slice) {
      const tag = `#H${String(i + 1).padStart(2, '0')} ${p.official}`;
      try {
        await api.sendRichMessage({ ...replyParams(message), rich_message: { html: p.html } });
        results.push(`✅ ${tag}`);
      } catch (e) {
        results.push(`❌ ${tag}: ${e?.description ?? e?.message ?? e}`.slice(0, 200));
      }
    }
    await api.sendMessage({ ...replyParams(message), text: results.join('\n').slice(0, 4096) });
    return;
  }
  if (cmd === '/probetopic') {
    const args = text.split(/\s+/).slice(1).map(Number).filter((n) => n >= 1 && n <= PROBES.length);
    const from = (args[0] || 1) - 1;
    const to = args.length === 1 ? args[0] : (args[1] || PROBES.length);
    const slice = PROBES.map((p, i) => ({ p, i })).slice(from, to);
    await api.sendMessage({ ...replyParams(message), text: `Probing #${from + 1}–#${to} (${slice.length} shapes), one message each…\nResume: /probetopic ${to + 1}` });
    const results = [];
    const num = (i) => ({ type: 'paragraph', text: { type: 'bold', text: `#${String(i + 1).padStart(2, '0')}` } });
    for (const { p, i } of slice) {
      const tag = `#${String(i + 1).padStart(2, '0')} ${p.official}`;
      try {
        if (p.html) await api.sendRichMessage({ ...replyParams(message), rich_message: { html: p.html } });
        else await api.sendRichMessage({ ...replyParams(message), rich_message: { blocks: [num(i), ...p.blocks] } });
        results.push(`✅ ${tag}`);
      } catch (e) {
        results.push(`❌ ${tag}: ${e?.description ?? e?.message ?? e}`.slice(0, 200));
      }
    }
    await api.sendMessage({ ...replyParams(message), text: results.join('\n').slice(0, 4096) });
    return;
  }
  await api.sendMessage({ chat_id: chatId, text: `Command not set yet: ${cmd}` });
}

export default guarded(handle);
