// handlers/guest_message.js — PROBE: channel-DM guest messages.
// Bot receives (guest_message update), answers via answerGuestQuery (inline-style
// result — not free chat), and posts a receipt to the test topic so we see it fire.
import { api } from 'sdk';
import { guarded } from '../lib/errors.js';

// Test group topic for receipts (ground.json: group -1002435146176, topic 819).
const RECEIPT_CHAT = -1002435146176;
const RECEIPT_THREAD = 819;
// Channel monoforum (Test Channel DMs): t.me/c/1071267775431 → Bot API -2071267775431.
const MONOFORUM_CHAT = -2071267775431;

async function handle(message) {
  const from = message.from ? `@${message.from.username || message.from.first_name} (${message.from.id})` : 'unknown';
  const text = (message.text ?? message.caption ?? '(no text)').slice(0, 200);
  try {
    await api.sendMessage({
      chat_id: RECEIPT_CHAT,
      message_thread_id: RECEIPT_THREAD,
      text: `📨 guest_message received\nfrom: ${from}\ntext: ${text}\nguest_query_id: ${message.guest_query_id || 'none'}`,
    });
  } catch (e) {
    console.error('receipt failed:', e?.description ?? e?.message ?? e);
  }
  if (message.guest_query_id) {
    try {
      await api.answerGuestQuery({
        guest_query_id: message.guest_query_id,
        result: {
          type: 'article',
          id: `probe-${Date.now()}`,
          title: 'TESTING ROBOT received you',
          input_message_content: { message_text: `✅ Received: ${text}` },
        },
      });
    } catch (e) {
      console.error('answerGuestQuery failed:', e?.description ?? e?.message ?? e);
    }
  }
  // Thread reply: topic id = guest user id.
  if (message.from?.id) {
    try {
      await api.sendMessage({
        chat_id: MONOFORUM_CHAT,
        direct_messages_topic_id: message.from.id,
        text: `TESTING ROBOT auto-reply: received “${text}”.`,
      });
    } catch (e) {
      console.error('thread reply failed:', e?.description ?? e?.message ?? e);
    }
  }
}

export default guarded(handle);
