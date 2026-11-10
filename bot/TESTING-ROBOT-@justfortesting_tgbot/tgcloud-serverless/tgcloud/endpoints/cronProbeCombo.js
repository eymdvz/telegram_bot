// endpoints/cronProbeCombo.js — PROBE ONLY: rich + inline keyboard combos.
// A: sendRichMessage with reply_markup. B: editMessageReplyMarkup on a rich message.
import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { prayerDays } from '../schema.js';
import { CHANNEL_ID } from '../lib/config.js';
import { dayKey } from '../lib/prayer.js';

export default async function (input, ctx) {
  const out = {};
  try {
    const r = await api.sendRichMessage({
      chat_id: CHANNEL_ID,
      rich_message: { blocks: [
        { type: 'paragraph', text: 'Combo probe A — rich + inline keyboard in one call' },
        { type: 'buttons', align: 'center', buttons: [{ text: 'Rich Green', url: 'https://dev.mamtj6.com/waktu-solat?location=TRG01', style: 'success' }] },
      ] },
      reply_markup: { inline_keyboard: [[{ text: 'Inline Plain', url: 'https://dev.mamtj6.com/waktu-solat?location=TRG01' }]] },
    });
    out.a = { message_id: r.message_id };
  } catch (e) {
    out.a = { error: e?.code, description: (e?.description || String(e)).slice(0, 200) };
  }
  if (out.a.message_id) {
    try {
      await api.editMessageReplyMarkup({
        chat_id: CHANNEL_ID,
        message_id: out.a.message_id,
        reply_markup: { inline_keyboard: [[{ text: 'Inline Edited', url: 'https://dev.mamtj6.com/waktu-solat?location=TRG01' }]] },
      });
      out.b = { edited: out.a.message_id };
    } catch (e) {
      out.b = { error: e?.code, description: (e?.description || String(e)).slice(0, 200) };
    }
  }
  return out;
}
