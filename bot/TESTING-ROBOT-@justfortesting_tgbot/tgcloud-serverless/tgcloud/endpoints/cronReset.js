// endpoints/cronReset.js — test helper: deletes today's card + reminders, clears the row.
// Trigger: npx tgcloud run endpoints/cronReset '{}'
import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { prayerDays } from '../schema.js';
import { dayKey } from '../lib/prayer.js';
import { CHANNEL_ID } from '../lib/config.js';

export default async function (input, ctx) {
  const key = dayKey(input?.nowMs ? new Date(Number(input.nowMs)) : new Date());
  const row = await db.select().from(prayerDays).where(eq(prayerDays.day, key)).get();
  if (!row) return { day: key, deleted: [] };
  const ids = [row.mainMsgId, ...Object.values(row.reminderJson || {}), ...Object.values(row.preJson || {})]
    .map(Number).filter((id) => id > 0);
  const deleted = [];
  for (const id of ids) {
    try {
      await api.deleteMessage({ chat_id: CHANNEL_ID, message_id: id });
      deleted.push(id);
    } catch (e) {
      if (e?.code !== 400) throw e;
    }
  }
  await db.delete(prayerDays).where(eq(prayerDays.day, key)).run();
  return { day: key, deleted };
}
