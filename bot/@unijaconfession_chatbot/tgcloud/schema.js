import { table, integer, text, sql, uniqueIndex } from 'sdk/db';

// Feedback-inbox schema (Livegram-style). No foreign keys —
// the runtime runs with FKs off, enforce integrity in code.
// Full plan: ../../plan.md (repo root of this bot: bot/Just_arobot/plan.md).

// One row per Telegram user that ever contacted the bot.
export const users = table('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgId: integer('tg_id').notNull().unique(),
  username: text('username'),
  alias: text('alias'),
  firstSeen: integer('first_seen', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  banned: integer('banned').default(0),
  banReason: text('ban_reason'),
  bannedUntil: integer('banned_until', { mode: 'timestamp' }),
  warnCount: integer('warn_count').default(0),
  warnLight: integer('warn_light').default(0),
  warnMedium: integer('warn_medium').default(0),
  anum: text('anum'),
  lang: text('lang'), // ms | en; null = never chose (gets the picker on /start)
  lastSeen: integer('last_seen', { mode: 'timestamp' }), // last inbound DM (touched hourly)
  dead: integer('dead').default(0), // 1 = bot→user sends fail (blocked/deleted; learned)
}, (t) => ({
  aliasIdx: uniqueIndex('uidx_users_alias').on(t.alias),
  anumIdx: uniqueIndex('uidx_users_anum').on(t.anum),
}));

// One support thread per user (v1: single open ticket per user).
export const tickets = table('tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  status: text('status').default('open'),
  topicId: integer('topic_id'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  closed: integer('closed_at', { mode: 'timestamp' }),
});

// Every relayed message, both directions.
export const messages = table('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id').notNull(),
  direction: text('direction').notNull(),
  tgMessageId: integer('tg_message_id'),
  text: text('text'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Staged channel forwards awaiting the user's choice (reply / report).
// state: choice → (reply tapped) awaiting_reply → consumed on next content.
export const pendingIntents = table('pending_intents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  state: text('state').default('choice'),
  srcMsgId: integer('src_msg_id'),
  postMsgId: integer('post_msg_id'),
  postSub: integer('post_sub'),
  kind: text('kind'),
  text: text('text'),
  fileId: text('file_id'),
  caption: text('caption'),
  parked: text('parked'), // staged-later content JSON {kind,text,fileId,caption} (question auto-route)
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Author edit requests on approved posts (#E id).
// status: pending | applied | dismissed
export const edits = table('edits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionId: integer('submission_id').notNull(),
  newText: text('new_text'),
  status: text('status').default('pending'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Author delete requests on approved posts (#D id).
// status: pending | applied | dismissed
export const deletes = table('deletes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionId: integer('submission_id').notNull(),
  status: text('status').default('pending'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Admin-chat sessions (user ↔ admin direct line, Topic 2).
// status: open | closed. One open per user; plain DMs route here while open.
export const sessions = table('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  status: text('status').default('open'),
  lastMsgAt: integer('last_msg_at', { mode: 'timestamp' }),
  closedBy: integer('closed_by'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Mod notes: author notes (one active per user, on all future cards) + card
// notes (threaded reply under one #C card, deletable via stored msg id).
export const notes = table('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  adminId: integer('admin_id').notNull(),
  text: text('text').notNull(),
  submissionId: integer('submission_id'),
  cardMsgId: integer('card_msg_id'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// On-duty roster: one row per admin that ever toggled. !all pings greens
// only (owner `!all all` overrides); /adminstats dots the greens.
export const duty = table('duty', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgId: integer('tg_id').notNull().unique(),
  on: integer('on').default(1),
  updated: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Daily outgoing-DM counter (one row/day; BotFather-style "bot talk" stats).
export const dayOut = table('day_out', {
  day: text('day').primaryKey(),
  n: integer('n').default(0),
});

// Monthly crown holders (bot-side honor — custom titles are owner-promoted
// only, so holders get 👑/⚡ markers in /adminstats instead).
export const crowns = table('crowns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  category: text('category').notNull(), // actions | triage | overall
  tgId: integer('tg_id').notNull(),
  month: text('month').notNull(), // YYYY-MM at crowning time
  title: text('title').notNull(),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Singleton key/value flags (maintenance mode + future toggles).
export const meta = table('meta', {
  key: text('key').primaryKey(),
  value: text('value'),
});

// Bot feedback reports (bug/idea → admin General as #F cards, never published).
export const feedback = table('feedback', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  status: text('status').default('unconfirmed'), // unconfirmed | posted | cancelled
  mediaKind: text('media_kind').default('text'), // text | photo | video
  text: text('text'),
  caption: text('caption'),
  fileId: text('file_id'),
  userMessageId: integer('user_message_id'),
  previewMsgId: integer('preview_msg_id'),
  actionMsgId: integer('action_msg_id'),
  version: text('version'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// FAQ replica (Sheet "Unija FAQ" is master; /faqsync pulls CSV → upserts here).
export const faq = table('faq', {
  key: text('key').primaryKey(),
  category: text('category'),
  questionMs: text('question_ms'),
  answerMs: text('answer_ms'),
  questionEn: text('question_en'),
  answerEn: text('answer_en'),
  sort: integer('sort').default(0),
  active: integer('active').default(1),
  source: text('source'),
});

// Topic-2 message → user map (admin swipe-reply routing).
export const chatMap = table('chat_map', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  adminMsgId: integer('admin_msg_id').notNull().unique(),
  userId: integer('user_id').notNull(),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Admin reply → user DM message map (closes the reaction loop both ways).
export const replyMap = table('reply_map', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userMsgId: integer('user_msg_id').notNull().unique(),
  adminMsgId: integer('admin_msg_id').notNull().unique(),
  submissionId: integer('submission_id').notNull(),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Lost & found claims — RETIRED 04 Nov 2026 (claim buttons cut as overcomplicated;
// brokering is manual). Table left in place, unused — no code references it.
export const claims = table('claims', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionId: integer('submission_id').notNull(),
  claimantId: integer('claimant_user_id').notNull(),
  status: text('status').default('pending'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Button-tap log for the tap-storm guard (pruned lazily; kinds: tap, tap_notice).
export const hits = table('hits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  kind: text('kind').notNull(),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Ban appeals — one row per /appeal request (#A id).
// status: pending | accepted | rejected
export const appeals = table('appeals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  text: text('text'),
  status: text('status').default('pending'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Admin group topic <-> user mapping (hot read path — cache in-module).
export const topicMap = table('topic_map', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  topicId: integer('topic_id').notNull().unique(),
  userId: integer('user_id').notNull().unique(),
});

// Confession submissions — one per user message batch (#C id).
// status: pending-album | pending | approved | approved-undone | warned | rejected
export const submissions = table('submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  status: text('status').default('pending'),
  mediaKind: text('media_kind').default('text'), // text | photo | video | album
  mediaCount: integer('media_count').default(1),
  mediaGroupId: text('media_group_id'),
  text: text('text'),
  caption: text('caption'),
  inboxMessageId: integer('inbox_message_id'),
  inboxCardId: integer('inbox_card_id'),
  userMessageId: integer('user_message_id'),
  refId: integer('ref_id'), // referenced #C for replies/reports (nullable)
  refMsgId: integer('ref_msg_id'), // referenced channel message id (nullable)
  channelMessageIds: text('channel_message_ids', { mode: 'json' }),
  acceptedBy: integer('accepted_by'),
  isQuestion: integer('is_question').default(0), // legacy flag (kept) — kind is truth
  kind: text('kind').default('confession'), // confession | question | lost | found
  kindSeq: integer('kind_seq'), // per-kind serial (#ask1, #lost1…); null = pre-numbering
  askCat: text('ask_cat'), // question category key (makan/sewa/servis/…) — null = uncategorized
  askSub: text('ask_sub'), // sub-category key (runner/grab/luar/…) — null = none
  previewMsgId: integer('preview_msg_id'), // staged preview content message
  actionMsgId: integer('action_msg_id'), // staged preview action message (Confirm row)
  ackMsgId: integer('ack_msg_id'), // Confirm ack bubble (reply-target match for the short guide)
  pollData: text('poll_data', { mode: 'json' }), // native poll: { options:[], correct:null|idx, multi:0|1, explain:null } (question lives in text)
  noticeIds: text('notice_ids', { mode: 'json' }), // transient DM notices (caption hold/nudge) — die on Confirm/Cancel
  rplCleared: integer('rpl_cleared').default(0), // reply-prefix soft gate cleared by owner ("not a reply") — survives edits
  grpCleared: integer('grp_cleared').default(1), // group-link soft gate: 1 = clear (no link at staging, or owner cleared); 0 = held — edits re-hold, never release
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
  kindSeqIdx: uniqueIndex('uidx_sub_kind_seq').on(t.kind, t.kindSeq),
}));

// One row per media part (album members share mediaGroupId).
export const parts = table('parts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionId: integer('submission_id').notNull(),
  mediaGroupId: text('media_group_id'),
  type: text('type').notNull(), // photo | video
  fileId: text('file_id').notNull(),
  caption: text('caption'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Admin actions audit (ban/unban/close/note/broadcast).
export const audit = table('audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  adminId: integer('admin_id').notNull(),
  action: text('action').notNull(),
  targetUserId: integer('target_user_id'),
  reason: text('reason'),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});
