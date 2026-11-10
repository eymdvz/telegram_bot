// handlers/message.js — owner-only test commands for the solat rich trial.
import { api } from 'sdk';
import { guarded } from '../lib/errors.js';
import { postDaily, tickReminders, dayStatus } from '../lib/prayer.js';
import { ADMIN_IDS } from '../lib/config.js';

async function handle(message) {
  const text = (message.text ?? '').trim();
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
  await api.sendMessage({ chat_id: chatId, text: `Command not set yet: ${cmd}` });
}

export default guarded(handle);
