// handlers/callback_query.js — runs on each `callback_query` update (inline button taps).

import { api, db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { messages } from '../schema.js';
import { guarded } from '../lib/errors.js';
import { replyParams, saveEchoAndReply, alreadySaved, sendRetryPrompt } from '../lib/telegram.js';

function parseData(raw) {
  try { return JSON.parse(raw || ''); } catch { return null; }
}

async function handle(query, ctx) {
  const chatId = query.message?.chat?.id;
  if (!chatId) {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'No chat.' });
    return;
  }

  // Retry: re-run the original message recovered from the reply chain.
  // The Retry prompt is sent as a reply to the failed user message, so
  // Telegram echoes it back as callback_query.message.reply_to_message.
  if (parseData(query.data)?.a === 'retry') {
    const original = query.message?.reply_to_message;
    if (!original?.text) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Please just resend your message.', show_alert: true });
      return;
    }
    await api.sendChatAction({ chat_id: chatId, action: 'typing' }).catch(() => {});
    try {
      const skipSave = await alreadySaved(chatId, original.text);
      await saveEchoAndReply(original, original.text, { skipSave });
    } catch (err) {
      console.error('retry failed:', err?.description ?? err?.message ?? err);
      await sendRetryPrompt(original);
    }
    // Strip the Retry button so it can't be tapped again.
    await api.editMessageReplyMarkup({
      chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
    await api.answerCallbackQuery({ callback_query_id: query.id });
    return;
  }

  if (query.data === 'clear') {
    await db.delete(messages).where(eq(messages.chatId, chatId)).run();
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Cleared.' });
    await api.sendMessage({ ...replyParams(query.message), text: 'Cleared.' });
    return;
  }

  if (query.data === 'list') {
    const rows = await db.select().from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.id))
      .limit(10)
      .all();
    await api.answerCallbackQuery({ callback_query_id: query.id });
    if (rows.length === 0) {
      await api.sendMessage({ ...replyParams(query.message), text: 'No saved messages yet.' });
      return;
    }
    const lines = rows.reverse().map((r, i) => `${i + 1}. ${r.text ?? '(no text)'}`);
    await api.sendMessage({ ...replyParams(query.message), text: lines.join('\n') });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Unknown button.' });
}

export default guarded(handle);
