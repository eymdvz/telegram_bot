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
  preJson: text('pre_json', { mode: 'json' }), // { dhuhr: msgId, ... } 10-min heads-ups
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// One row per channel-DM topic (topic id = guest user id).
// Drives the redirect-card cooldown: card re-sends only when expired.
export const dmTopics = table('dm_topics', {
  topicId: integer('topic_id').primaryKey(), // guest user id
  userId: integer('user_id'),
  wantAdmin: integer('want_admin').notNull().default(0), // tapped 💬 Chat Admin
  lastCardAt: integer('last_card_at').notNull().default(0), // unix sec
  lastMsgAt: integer('last_msg_at').notNull().default(0), // unix sec
  lastMsgId: integer('last_msg_id').notNull().default(0), // bot's latest message in the topic (for links)
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
