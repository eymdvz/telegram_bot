import { table, integer, text, sql } from 'sdk/db';

// One row per calendar day (Asia/Singapore).
// Replaces GAS: year-named Sheets + PropertiesService LAST_ID_* + CacheService.
export const prayerDays = table('prayer_days', {
  day: text('day').primaryKey(), // YYYY-MM-DD in Asia/Singapore
  zone: text('zone').notNull().default('TRG01'),
  dates: text('dates'), // "📅 Selasa, 10 November 2026"
  hijri: text('hijri'), // "🇵🇸 19 Jamadil Awal 1448H"
  timesJson: text('times_json', { mode: 'json' }), // { fajr: unix, dhuhr: unix, ... }
  mainMsgId: integer('main_msg_id'), // day-card message in test channel
  reminderJson: text('reminder_json', { mode: 'json' }), // { fajr: msgId, ... }
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
