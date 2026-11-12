// handlers/callback_query.js — ephemeral probe + DM admin-chat ack.
import { api, BotApiError, db } from 'sdk';
import { eq } from 'sdk/db';
import { dmTopics } from '../schema.js';
import { guarded } from '../lib/errors.js';

const DM_HEAD = 'ᴮᴼᵀ ᴬᵁᵀᴼᴹᴬᵀᴱᴰ ᴹᴱˢˢᴬᴳᴱ';
const RECEIPT_CHAT = -1002435146176;
const RECEIPT_THREAD = 819;

async function handle(query, ctx) {
  if (query.data === 'dm_admin') {
    const msg = query.message || {};
    const topicId = (msg.direct_messages_topic && msg.direct_messages_topic.topic_id) || null;
    // Offline hours (MYT 12–7am): admins reply in the morning.
    const mytH = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
    const off = (mytH >= 0 && mytH < 7)
      ? `\n\n🌙 Luar waktu admin (12–7 pagi) — admin balas pagi nanti.\n<i>🌙 Outside admin hours (12–7am) — admins reply in the morning.</i>`
      : '';
    try {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Noted — an admin will reply here.' });
    } catch (e) { /* ignore */ }
    // Drop only the Chat Admin button; Send to Bot + FAQ stay.
    try {
      await api.editMessageReplyMarkup({
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: { inline_keyboard: [[
          { text: '📩 Send to Bot', url: 'https://t.me/Just_arobot?start=confess' },
          { text: '❓ FAQ', url: 'https://t.me/unijaconfession/66437' },
        ]] },
      });
    } catch (e) { console.error('dm strip failed:', e?.description ?? e?.message ?? e); }
    if (topicId) {
      try {
        const row = await db.select().from(dmTopics).where(eq(dmTopics.topicId, topicId)).get();
        if (row) {
          await db.update(dmTopics).set({ wantAdmin: 1 }).where(eq(dmTopics.topicId, topicId)).run();
        } else {
          await db.insert(dmTopics).values({ topicId, userId: (query.from && query.from.id) || null, wantAdmin: 1 }).run();
        }
      } catch (e) { console.error('dm wantAdmin stamp failed:', e?.description ?? e?.message ?? e); }
    }
    const qf = query.from || {};
    const who = `${qf.id || '?'}${qf.first_name ? ' ' + qf.first_name : ''}${qf.username ? ' @' + qf.username : ''}`;
    try {
      await api.sendMessage({
        chat_id: RECEIPT_CHAT, message_thread_id: RECEIPT_THREAD,
        text: `🙋 DM guest wants admin chat\ntopic: https://t.me/c/1071267775431/${(msg && msg.message_id) || ''}\nby user: ${who}`,
      });
    } catch (e) { console.error('receipt failed:', e?.description ?? e?.message ?? e); }
    if (topicId) {
      try {
        const r = await api.sendMessage({
          chat_id: msg.chat.id,
          direct_messages_topic_id: topicId,
          parse_mode: 'HTML',
          text: `${DM_HEAD}\n\n✅ Noted — you want to chat with an admin.\nPlease write your message here, an admin will reply soon.${off}\n\n⚠️ Note: Kalau you sambung chat di sini, admin boleh tahu identity you. Nak hide identity? Sila chat di bot\n\n<i>⚠️ Note: If you continue chatting here, the admin can know your identity. Want to hide your identity? Please chat in the bot</i>`,
        });
        try {
          await db.update(dmTopics).set({ lastMsgId: r.message_id }).where(eq(dmTopics.topicId, topicId)).run();
        } catch (e2) { /* stamp best-effort */ }
      } catch (e) { console.error('dm ack failed:', e?.description ?? e?.message ?? e); }
    }
    return;
  }
  if (query.data !== 'ephe_probe') {
    try {
      await api.answerCallbackQuery({ callback_query_id: query.id });
    } catch (e) { /* ignore */ }
    return;
  }
  const diag = [];
  try {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'tap received — sending ephemeral…' });
  } catch (e) {
    diag.push('toast1:' + (e?.description || e?.message || e));
  }
  const params = { chat_id: query.message.chat.id };
  if (query.message.message_thread_id) params.message_thread_id = query.message.message_thread_id;
  try {
    await api.sendMessage({
      ...params,
      text: '🤫 Ephemeral — only you (the tapper) can see this. It may vanish on restart.\n(Mobile: in-topic. Desktop: pinned to General.)',
      reply_parameters: { message_id: query.message.message_id },
      ephemeral_message_parameters: { callback_query_id: query.id },
    });
    try {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'ephemeral sent ✅' });
    } catch (e2) { /* ignore */ }
  } catch (e) {
    const why = e?.description || e?.message || String(e);
    console.error('ephemeral failed:', why);
    try {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'ephemeral failed: ' + String(why).slice(0, 150) });
    } catch (e2) { /* ignore */ }
  }
}

export default guarded(handle);
