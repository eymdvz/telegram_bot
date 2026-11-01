// handlers/message.js — runs on each `message` update. The file name is the
// Telegram update type; the platform calls the default export with the matching
// payload (here, a Message). The full update is available as `ctx.update`.

import { api, db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { messages } from '../schema.js';
import { guarded } from '../lib/errors.js';
import { replyParams, sendRichFallback, saveEchoAndReply, sendRetryPrompt } from '../lib/telegram.js';
import { PROBES } from '../lib/probe.js';

async function handle(message, ctx) {
  const text = (message.text ?? '').trim();

  if (text.startsWith('/start')) {
    const count = await db.$count(messages, eq(messages.chatId, message.chat.id));
    await api.sendMessage({
      ...replyParams(message),
      text: `Hi! I am ask_the_robot. I have saved ${count} message(s) from this chat. Send me anything.`,
    });
    return;
  }

  if (text.startsWith('/list')) {
    const rows = await db.select().from(messages)
      .where(eq(messages.chatId, message.chat.id))
      .orderBy(desc(messages.id))
      .limit(10)
      .all();
    if (rows.length === 0) {
      await api.sendMessage({ ...replyParams(message), text: 'No saved messages yet.' });
      return;
    }
    const lines = rows.reverse().map((r, i) => `${i + 1}. ${r.text ?? '(no text)'}`);
    await api.sendMessage({ ...replyParams(message), text: lines.join('\n') });
    return;
  }

  if (text.startsWith('/clear')) {
    await db.delete(messages).where(eq(messages.chatId, message.chat.id)).run();
    await api.sendMessage({ ...replyParams(message), text: 'Cleared.' });
    return;
  }

  if (text.startsWith('/rich')) {
    const html = `<p>Rich buttons test</p><tg-button-row align="center"><tg-button type="callback_data" data="list">List</tg-button><tg-button type="callback_data" data="clear">Clear</tg-button></tg-button-row>`;
    await sendRichFallback(message, {
      rich: { html },
      fallbackText: 'Rich buttons test',
      replyMarkup: { inline_keyboard: [[{ text: 'List', callback_data: 'list' }, { text: 'Clear', callback_data: 'clear' }]] },
    });
    return;
  }

  if (text.startsWith('/message1')) {
    await sendRichFallback(message, {
      rich: { blocks: [
        { type: 'paragraph', text: '⏰ Jadual Waktu Solat Fardhu\n🇲🇾 UniSZA Kampus Gong Badak\n\n📅 Jumaat, 23 Oktober 2026\n🇵🇸 12 Jamadil Awal 1448H' },
        { type: 'blockquote', blocks: [{ type: 'table', is_bordered: true, caption: 'Zon 1: Kuala Terengganu, Marang, Kuala Nerus', cells: [
          [{ text: 'Solat', is_header: true, align: 'left', valign: 'top' }, { text: 'Waktu', is_header: true, align: 'left', valign: 'top' }],
          [{ text: '⛅️ Subuh', align: 'left', valign: 'top' }, { text: '05:44 AM', align: 'left', valign: 'top' }],
          [{ text: '🌞 Zohor', align: 'left', valign: 'top' }, { text: '12:54 PM', align: 'left', valign: 'top' }],
          [{ text: '☀️ Asar', align: 'left', valign: 'top' }, { text: '04:13 PM', align: 'left', valign: 'top' }],
          [{ text: '🌙 Maghrib', align: 'left', valign: 'top' }, { text: '06:52 PM', align: 'left', valign: 'top' }],
          [{ text: { type: 'bold', text: '⭐️ Isyak' }, align: 'left', valign: 'top' }, { text: { type: 'bold', text: '08:02 PM' }, align: 'left', valign: 'top' }],
        ] }] },
        { type: 'paragraph', text: [{ type: 'hashtag', text: '#IlmuDemiFaedahInsan', hashtag: 'IlmuDemiFaedahInsan' }, '\nby ', { type: 'mention', text: '@utmconfession', username: 'utmconfession' }] },
        { type: 'buttons', align: 'center', buttons: [{ text: 'Waktu Solat TRG01', url: 'https://dev.mamtj6.com/waktu-solat?location=TRG01', style: 'success' }] },
      ] },
      fallbackText: '⏰ Jadual Waktu Solat Fardhu\n🇲🇾 UniSZA Kampus Gong Badak\n\n📅 Jumaat, 23 Oktober 2026\n🇵🇸 12 Jamadil Awal 1448H\n\n⛅️ Subuh — 05:44 AM\n🌞 Zohor — 12:54 PM\n☀️ Asar — 04:13 PM\n🌙 Maghrib — 06:52 PM\n⭐️ Isyak — 08:02 PM\n\nZon 1: Kuala Terengganu, Marang, Kuala Nerus\nhttps://dev.mamtj6.com/waktu-solat?location=TRG01',
    });
    return;
  }

  if (text.startsWith('/probeone')) {
    const isMedia = (p) => (p.blocks ?? []).some((b) => b.type === 'map' || b.type === 'photo' || b.type === 'video');
    const textPros = PROBES.filter((p) => p.blocks && !isMedia(p));
    const mediaPros = PROBES.filter((p) => isMedia(p));
    const out = [];
    try {
      await api.sendRichMessage({ ...replyParams(message), rich_message: { blocks: textPros.flatMap((p) => p.blocks) } });
      out.push(`✅ text (${textPros.length} shapes; html pipe excluded — see /rich)`);
    } catch (e) {
      out.push(`❌ text: ${e?.description ?? e?.message ?? e}`.slice(0, 200));
    }
    try {
      await api.sendRichMessage({ ...replyParams(message), rich_message: { blocks: mediaPros.flatMap((p) => p.blocks) } });
      out.push(`✅ media (${mediaPros.map((p) => p.name).join(' + ')})`);
    } catch (e) {
      out.push(`❌ media: ${e?.description ?? e?.message ?? e}`.slice(0, 200));
    }
    await api.sendMessage({ ...replyParams(message), text: out.join('\n') });
    return;
  }

  if (text.startsWith('/probe')) {
    await api.sendMessage({ ...replyParams(message), text: `Probing ${PROBES.length} shapes, one message each…` });
    const results = [];
    for (const p of PROBES) {
      try {
        if (p.html) await api.sendRichMessage({ ...replyParams(message), rich_message: { html: p.html } });
        else await api.sendRichMessage({ ...replyParams(message), rich_message: { blocks: p.blocks } });
        results.push(`✅ ${p.name}`);
      } catch (e) {
        results.push(`❌ ${p.name}: ${e?.description ?? e?.message ?? e}`.slice(0, 200));
      }
    }
    await api.sendMessage({ ...replyParams(message), text: results.join('\n').slice(0, 4096) });
    return;
  }

  if (text.startsWith('/')) {
    await api.sendMessage({
      ...replyParams(message),
      text: `Command not set yet: ${text.split(' ')[0]}`,
    });
    return;
  }

  // Save this message; on failure offer Retry instead of going silent.
  try {
    await saveEchoAndReply(message, message.text);
  } catch (err) {
    console.error('echo failed:', err?.description ?? err?.message ?? err);
    await sendRetryPrompt(message);
  }
}

export default guarded(handle);
