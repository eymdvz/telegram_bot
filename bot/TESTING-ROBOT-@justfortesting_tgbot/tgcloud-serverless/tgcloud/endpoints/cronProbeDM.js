// endpoints/cronProbeDM.js — PROBE ONLY: can the bot write to the channel DM chat?
// Trigger: npx tgcloud run endpoints/cronProbeDM "{ chatId: -1071267775431, topicId: 7154716451 }"
// direct_messages_topic_id is REQUIRED for direct messages chats (else 400).
import { api } from 'sdk';

export default async function (input, ctx) {
  const chatId = Number(input?.chatId) || -1071267775431;
  const topicId = Number(input?.topicId) || undefined;
  const params = { chat_id: chatId, text: 'DM write probe — TESTING ROBOT checking write access.' };
  if (topicId) params.direct_messages_topic_id = topicId;
  try {
    const r = await api.sendMessage(params);
    return { message_id: r.message_id };
  } catch (e) {
    return { note: 'rejected', code: e?.code, description: (e?.description || String(e)).slice(0, 300) };
  }
}
