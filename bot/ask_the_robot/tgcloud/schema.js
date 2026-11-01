import { table, integer, text, sql } from 'sdk/db';

// Your database tables go here as named exports. Deploying this file registers the
// schema; applying the changes (a migration) updates the database.

export const messages = table('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').notNull(),
  text: text('text'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
