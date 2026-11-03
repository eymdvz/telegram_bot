import { db, api } from 'sdk';
import { eq } from 'sdk/db';
import { users, submissions, replyMap } from '../schema.js';
import { guarded } from '../lib/errors.js';
import { ADMIN_GROUP_ID } from '../lib/config.js';

// Bidirectional reaction relay (v1).
// Paths (looked up in order):
//   1. submission content: user DM msg ↔ inbox content/card msg
//   2. admin replies: bot DM reply msg ↔ admin's group reply msg (reply_map)
// Limitation: the Bot API only lets the bot set its OWN reactions, so the
// relayed 👍 appears as the bot's reaction, not the person's. Removals mirror
// too (empty set clears the bot's reactions; other people's stay untouched).

const emojisOf = (list) =>
  (list ?? [])
    .filter((r) => r && r.type === 'emoji' && r.emoji)
    .map((r) => ({ type: 'emoji', emoji: r.emoji }))
    .slice(0, 3);

async function ownerOf(sub) {
  if (!sub) return null;
  return db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
}

async function handle(reaction) {
  const chatId = reaction.chat?.id;
  const msgId = reaction.message_id;
  if (!chatId || !msgId) return;
  const want = emojisOf(reaction.new_reaction);

  // Admin side → user DM.
  if (chatId === ADMIN_GROUP_ID) {
    const sub =
      (await db.select().from(submissions).where(eq(submissions.inboxMessageId, msgId)).get().catch(() => null)) ??
      (await db.select().from(submissions).where(eq(submissions.inboxCardId, msgId)).get().catch(() => null));
    if (sub?.userMessageId) {
      const u = await ownerOf(sub);
      if (!u) return;
      await api.setMessageReaction({ chat_id: u.tgId, message_id: sub.userMessageId, reaction: want }).catch(() => {});
      return;
    }
    // Admin's own reply message → mirror onto the bot DM reply.
    const rm = await db.select().from(replyMap).where(eq(replyMap.adminMsgId, msgId)).get().catch(() => null);
    if (!rm) return;
    const rsub = await db.select().from(submissions).where(eq(submissions.id, rm.submissionId)).get().catch(() => null);
    const u = await ownerOf(rsub);
    if (!u) return;
    await api.setMessageReaction({ chat_id: u.tgId, message_id: rm.userMsgId, reaction: want }).catch(() => {});
    return;
  }

  // User DM side → admin inbox. Private chat id == the user's tg id; enforce it
  // so reactions never cross between users.
  if (reaction.chat?.type !== 'private') return;
  const sub = await db.select().from(submissions).where(eq(submissions.userMessageId, msgId)).get().catch(() => null);
  if (sub) {
    const u = await ownerOf(sub);
    if (!u || u.tgId !== chatId) return;
    const target = sub.inboxMessageId ?? sub.inboxCardId;
    if (!target) return;
    await api.setMessageReaction({ chat_id: ADMIN_GROUP_ID, message_id: target, reaction: want }).catch(() => {});
    return;
  }
  // Reaction on a bot DM admin-reply → mirror onto the admin's group message.
  const rm = await db.select().from(replyMap).where(eq(replyMap.userMsgId, msgId)).get().catch(() => null);
  if (!rm) return;
  const rsub = await db.select().from(submissions).where(eq(submissions.id, rm.submissionId)).get().catch(() => null);
  const u = await ownerOf(rsub);
  if (!u || u.tgId !== chatId) return;
  await api.setMessageReaction({ chat_id: ADMIN_GROUP_ID, message_id: rm.adminMsgId, reaction: want }).catch(() => {});
}

export default guarded(handle);
