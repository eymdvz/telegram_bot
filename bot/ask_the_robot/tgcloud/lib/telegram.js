// lib/telegram.js — shared send + echo helpers.
// Patterns adapted from https://github.com/megatzackry/Telegram-Serverless-Agent
// (Delivery.replyParams / rich-fallback / Retry button). Adapted, not copied.

import { api, db, BotApiError } from 'sdk';
import { desc, eq } from 'sdk/db';
import { messages } from '../schema.js';

export const RETRY_DATA = JSON.stringify({ a: 'retry' });

// Thread-aware params: keeps sends inside the group topic the update came from.
export function replyParams(message) {
  const params = { chat_id: message.chat.id };
  if (message.message_thread_id) params.message_thread_id = message.message_thread_id;
  return params;
}

// Rich first; on Telegram 400 fall back to plain text instead of going silent.
// Non-400 errors rethrow to `guarded`.
export async function sendRichFallback(message, { rich, fallbackText, replyMarkup }) {
  try {
    return await api.sendRichMessage({ ...replyParams(message), rich_message: rich });
  } catch (err) {
    if (!(err instanceof BotApiError) || err.code !== 400) throw err;
    console.error('rich failed, falling back:', err.description);
    return api.sendMessage({
      ...replyParams(message),
      text: fallbackText.slice(0, 4096),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }
}

// Shared echo: save + count + reply.
export async function saveEchoAndReply(message, text, { skipSave = false } = {}) {
  if (!skipSave) {
    await db.insert(messages).values({ chatId: message.chat.id, text }).run();
  }
  const count = await db.$count(messages, eq(messages.chatId, message.chat.id));
  await api.sendMessage({
    ...replyParams(message),
    text: `Saved. That's ${count} message(s) from this chat so far.`,
    reply_markup: {
      inline_keyboard: [[
        { text: 'List', callback_data: 'list' },
        { text: 'Clear', callback_data: 'clear' },
      ]],
    },
  });
}

// Latest-saved dedupe so Retry never double-saves a message that landed before the send failed.
export async function alreadySaved(chatId, text) {
  const rows = await db.select().from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.id))
    .limit(1)
    .all();
  return rows.length > 0 && rows[0].text === text;
}

// Generic failure notice with Retry button, sent as a reply so the
// callback handler can recover the original message and re-run it.
export async function sendRetryPrompt(message) {
  await api.sendMessage({
    ...replyParams(message),
    text: 'Sorry, something went wrong putting that together. Tap Retry to try again.',
    reply_parameters: { message_id: message.message_id },
    reply_markup: { inline_keyboard: [[{ text: '🔄 Retry', callback_data: RETRY_DATA }]] },
  });
}
