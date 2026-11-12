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
  if (!text.startsWith('/')) return;
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
  if (cmd === '/probelist') {    const lines = PROBES.map((p, i) => `#${String(i + 1).padStart(2, '0')} ${p.official} (${p.name})`);
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
