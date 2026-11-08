import { db, api } from 'sdk';
import { eq, and, desc, sql } from 'sdk/db';
import { users, submissions, audit, appeals, pendingIntents, edits, deletes, feedback } from '../schema.js';
import { guarded } from '../lib/errors.js';
import { isAdmin, groupAdmins, lookupAdmin } from '../lib/admins.js';
import { banNotice, warnCounts, whoOf, cardWho, dispAid, channelPostLink, publishToChannel, postDue, queuePos, flushQueue, maskContacts, censorProfanity, kindOf, KIND_TAGS, NO_SERIAL, danaTag, tapAllowed, adminStatsText, astatsRow, oldestPage, tutRow, atutRow, dutyGreens, bumpOut, markDeadByTg, askCatLabel, crownMap, tag } from '../lib/moderation.js';
import { STR, L } from '../lib/strings.js';
import { submitConfession, confirmSubmission, confirmFeedback, openChatSession, closeSession, sendStart, sendMenu, chatOpenFor, listPage } from './message.js';
import { ADMIN_GROUP_ID, INBOX_TOPIC_ID, CHANNEL_ID, ADMIN_IDS, SUPER_ADMIN_ID, EXEMPT_IDS, WARN_TIERS, RINGAN_SECOND_BAN_DAYS, SEDERHANA_BAN_DAYS, APPEAL_CONTACT, DRIP_FEED, MASK_CONTACTS, PROFANITY_MASK, LANG, FAQ_URL, FAQ_GATE_SEC, MAP_URL, BUS_URL, TERMS_URL } from '../lib/config.js';

// Confession cards: accept / warn / ban / undo — all keyed by submission #C,
// never raw tg_id (plan: anonymity model).

function durToUntil(dur) {
  if (/^forever$/i.test(dur)) return null;
  const m = dur.match(/^(\d+)d$/i);
  if (m) return new Date(Date.now() + Number(m[1]) * 86400000);
  return null;
}

function fmtUntil(until) {
  if (!until) return 'forever';
  return 'until ' + new Date(until).toISOString().slice(0, 10);
}

const REASONS = ['spam', 'abuse', 'nsfw', 'flood', 'scam', 'other'];

// Attribution: append "… by <admin>" to the card with a clickable profile
// mention (text_mention works with or without @username). Offsets are counted
// in UTF-16 units on both sides, so compute them in code, never by hand.
async function handledEdit(oldText, line, admin) {
  const m = admin?.id ? await lookupAdmin(admin.id).catch(() => null) : null;
  const tag = admin?.id === SUPER_ADMIN_ID ? '👑 owner' : (m?.title ? `🔰 ${m.title}` : '🔰 admin');
  const name = [admin?.first_name, admin?.last_name].filter(Boolean).join(' ') || m?.name || 'admin';
  const base = (oldText ?? '').slice(0, 3000);
  const prefix = `${base}\n${line} by ${tag} - `;
  return {
    text: prefix + name,
    entities: [{ type: 'text_mention', offset: prefix.length, length: name.length, user: { id: admin.id, first_name: admin.first_name ?? name } }],
  };
}

async function editCard(query, line, buttons, linkUrl = null) {
  const ed = await handledEdit(query.message?.text, line, query.from);
  let text = ed.text;
  const entities = [...ed.entities];
  if (linkUrl) {
    const label = 'see the post';
    text += `\n🔗 ${label}`;
    entities.push({ type: 'text_link', offset: text.length - label.length, length: label.length, url: linkUrl });
  }
  const params = {
    chat_id: query.message.chat.id, message_id: query.message.message_id,
    text, reply_markup: buttons,
  };
  try {
    await api.editMessageText({ ...params, entities });
  } catch {
    await api.editMessageText(linkUrl ? { ...params, text: `${text}\n${linkUrl}` } : params).catch(() => {});
  }
}

// DM-side "Published" notice with a post hyperlink (entities, never parse_mode).
async function sendPublishedDM(tgId, subId, isRepublish, postUrl, lang, userMsgId = null) {
  const T = STR[lang ?? LANG] ?? STR.ms;
  const head = T.publishedHead(subId, isRepublish);
  const label = 'see the post';
  const text = `${head}\n${label}`;
  const thread = userMsgId ? { reply_parameters: { message_id: userMsgId } } : {};
  try {
    await api.sendMessage({ chat_id: tgId, text, entities: [{ type: 'text_link', offset: text.length - label.length, length: label.length, url: postUrl }], ...thread });
    await bumpOut();
  } catch {
    try {
      await api.sendMessage({ chat_id: tgId, text: `${head}\n${postUrl}` });
      await bumpOut();
    } catch {
      await markDeadByTg(tgId);
    }
  }
}

// Reject reasons (quick presets + instant path). Shared finish: status,
// audit, 👎 + ❌ DM, collapsed card. Pure module scope (see verdictDM).
const REJ_REASONS = { rules: 'Peraturan', format: 'Format', faq: 'FAQ' };
async function finishReject(query, adminId, id, reasonKey) {
  const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
  if (!sub || (sub.status !== 'pending' && sub.status !== 'warned' && sub.status !== 'queued') || sub.mediaKind === 'report') {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already handled — see card.' });
    return false;
  }
  const body = reasonKey ? STR.ms[{ rules: 'rejRules', format: 'rejFormat', faq: 'rejFaq' }[reasonKey]] : null;
  await db.update(submissions).set({ status: 'rejected' }).where(eq(submissions.id, id)).run();
  await db.insert(audit).values({ adminId, action: 'reject', targetUserId: sub.userId, reason: `#C${id}${reasonKey ? ':' + reasonKey : ''}` }).run();
  await editCard(query, reasonKey ? `❌ Rejected — ${REJ_REASONS[reasonKey]}` : '❌ Rejected — not approved', { inline_keyboard: [] });
  await api.answerCallbackQuery({ callback_query_id: query.id, text: `Rejected #C${id}.` });
  try {
    const u = await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
    if (u) {
      // Community language: 👎 on the user's own message means rejected.
      try {
        if (sub.userMessageId) await api.setMessageReaction({ chat_id: u.tgId, message_id: sub.userMessageId, reaction: [{ type: 'emoji', emoji: '👎' }] });
      } catch {}
      await verdictDM(u.tgId, sub.userMessageId, body ? `❌ ${body}` : L(u).rejectUser(id));
      await bumpOut();
    }
  } catch {}
  return true;
}
// Threaded verdict DM: reply to the user's original message when its id is
// known, plain fallback when it's gone. Pure send (no counting) — callers
// keep their own bumpOut. Never throws.
async function verdictDM(tgId, userMsgId, text) {
  try {
    if (userMsgId) await api.sendMessage({ chat_id: tgId, text, reply_parameters: { message_id: userMsgId } });
    else await api.sendMessage({ chat_id: tgId, text });
  } catch {
    await api.sendMessage({ chat_id: tgId, text }).catch(() => {});
  }
}

// Reason pickers with tier labels (single source — reused by Back buttons).
function warnReasonMarkup(id) {
  return { inline_keyboard: [
    [{ text: 'Spam · sederhana', callback_data: `warnreason:${id}:spam` }, { text: 'Abuse · sederhana', callback_data: `warnreason:${id}:abuse` }],
    [{ text: 'NSFW · berat', callback_data: `warnreason:${id}:nsfw` }, { text: 'Scam · berat', callback_data: `warnreason:${id}:scam` }],
    [{ text: 'Flood · ringan', callback_data: `warnreason:${id}:flood` }, { text: 'Other · ringan', callback_data: `warnreason:${id}:other` }],
    [{ text: '‹ Back', callback_data: `back:${id}` }],
  ] };
}

function banReasonMarkup(id, dur) {
  return { inline_keyboard: [[
    { text: 'Spam · sederhana', callback_data: `banreason:${id}:${dur}:spam` },
    { text: 'Abuse · sederhana', callback_data: `banreason:${id}:${dur}:abuse` },
    { text: 'NSFW · berat', callback_data: `banreason:${id}:${dur}:nsfw` },
  ], [
    { text: 'Flood · ringan', callback_data: `banreason:${id}:${dur}:flood` },
    { text: 'Scam · berat', callback_data: `banreason:${id}:${dur}:scam` },
    { text: 'Other · ringan', callback_data: `banreason:${id}:${dur}:other` },
  ], [
    { text: '‹ Back', callback_data: `banback:${id}` },
  ]] };
}

// pending_intents state → localized draft name (arm-switch notices).
const STATE_KIND = { awaiting_reply: 'reply', awaiting_question: 'question', awaiting_faq: 'question', awaiting_lost: 'lost', awaiting_found: 'found', awaiting_dana: 'dana', awaiting_suggest: 'suggest', awaiting_info: 'info', awaiting_feedback: 'feedback' };
const stateName = (s, t) => t.draftNames[STATE_KIND[s]] ?? s;

// Tanya Soalan L1 picker (fixed Malay labels — channel leads stay consistent).
const ASK_L1 = [[
  { text: '🍜 Makan', callback_data: 'askcat:makan' },
  { text: '🏠 Sewa', callback_data: 'askcat:sewa' },
], [
  { text: '🛠️ Servis', callback_data: 'askcat:servis' },
  { text: '📦 Barang', callback_data: 'askcat:barang' },
], [
  { text: '📍 Tempat', callback_data: 'askcat:tempat' },
  { text: '🚗 Tumpang/Carpool', callback_data: 'askcat:tumpang' },
], [
  { text: '🚌 Bas', callback_data: 'askcat:bas' },
  { text: '💬 Lain / Langkau', callback_data: 'askcat:skip' },
]];

async function handle(query) {
  const T = STR[LANG] ?? STR.ms;
  const data = query.data || '';
  const adminId = query.from?.id;
  // Tap-storm guard (owner + admins bypass; notice throttled inside).
  if (!EXEMPT_IDS.includes(adminId)) {
    let admin = false;
    try { admin = await isAdmin(adminId); } catch {}
    if (!admin) {
      const t = await tapAllowed(adminId).catch(() => ({ ok: true }));
      if (!t.ok) {
        if (t.notify) await api.answerCallbackQuery({ callback_query_id: query.id, text: T.tapSlow }).catch(() => {});
        return;
      }
    }
  }

  // Session lock: no new flows while an admin chat is open (Confirm/Cancel of
  // staged previews, /cancel*, /endadminsession and reads stay available).
  const LOCKED_TAPS = ['fwd_reply:', 'fwd_report:', 'reportreason:', 'send_conf', 'ask_q', 'faq_proceed', 'askcat:', 'tut:', 'lostfound', 'lost_new', 'found_new', 'dana_new', 'dana_sub:', 'dana_back', 'suggest_new', 'info_new', 'iklan_info', 'event_info', 'grid_help', 'grid_tut', 'feedback_new'];
  if (LOCKED_TAPS.some((p) => data.startsWith(p))) {
    const open = await chatOpenFor(query.from.id).catch(() => null);
    if (open) {
      const lt = L(open.user);
      await api.answerCallbackQuery({ callback_query_id: query.id, text: lt.sessionLocked });
      try { await api.sendMessage({ chat_id: query.message.chat.id, text: lt.sessionLocked }); } catch {}
      return;
    }
  }

  // DM-side forward choices (fwd_*) and report reasons: the owning user only,
  // resolved before the admin gate (these tappers are never admins-by-role).
  if (data.startsWith('fwd_') || data.startsWith('reportreason:')) {
    const pid = Number(data.split(':')[1]);
    const pend = await db.select().from(pendingIntents).where(eq(pendingIntents.id, pid)).get().catch(() => null);
    const owner = pend ? await db.select().from(users).where(eq(users.id, pend.userId)).get().catch(() => null) : null;
    if (!pend || !owner || query.from.id !== owner.tgId) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: pend ? T.notYou : T.expiredFwd });
      return;
    }
    const t = L(owner);
    const drop = async () => { await db.delete(pendingIntents).where(eq(pendingIntents.id, pid)).run().catch(() => {}); };
    const editDM = async (text, markup) => {
      try {
        await api.editMessageText({ chat_id: query.message.chat.id, message_id: query.message.message_id, text,
          reply_markup: markup ?? { inline_keyboard: [] } });
      } catch {}
    };
    const content = { kind: pend.kind, text: pend.text, fileId: pend.fileId, caption: pend.caption };
    if (data.startsWith('fwd_new:')) {
      await drop();
      try {
        await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id });
      } catch {
        await editDM(t.retiredU);
      }
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.retiredU });
      return;
    }
    if (data.startsWith('fwd_reply:')) {
      const othersF = await db.all(sql`SELECT state FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_question','awaiting_faq','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => []);
      await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_question','awaiting_faq','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => {});
      await db.update(pendingIntents).set({ state: 'awaiting_reply', kind: 'reply', srcMsgId: query.message.message_id }).where(eq(pendingIntents.id, pid)).run().catch(() => {});
      const diedF = [...new Set((othersF ?? []).map((r) => stateName(r.state, t)))];
      await editDM(t.fwdArmed(pend.postSub ? '#C' + pend.postSub : 'post ' + pend.postMsgId) + (diedF.length ? `\n${t.armSwitched(diedF.join(', '))}` : ''));
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.replyNow });
      return;
    }
    if (data.startsWith('fwd_report:')) {
      try {
        await api.editMessageReplyMarkup({
          chat_id: query.message.chat.id, message_id: query.message.message_id,
          reply_markup: { inline_keyboard: [
            [{ text: 'Spam', callback_data: `reportreason:${pid}:spam` }, { text: 'Abuse', callback_data: `reportreason:${pid}:abuse` }, { text: 'NSFW', callback_data: `reportreason:${pid}:nsfw` }],
            [{ text: 'Flood', callback_data: `reportreason:${pid}:flood` }, { text: 'Scam', callback_data: `reportreason:${pid}:scam` }, { text: 'Other', callback_data: `reportreason:${pid}:other` }],
            [{ text: '‹ Back', callback_data: `fwd_back:${pid}` }],
          ] },
        });
      } catch {}
      await api.answerCallbackQuery({ callback_query_id: query.id, text: T.reportWhy });
      return;
    }
    if (data.startsWith('fwd_back:')) {
      try {
        await api.editMessageReplyMarkup({
          chat_id: query.message.chat.id, message_id: query.message.message_id,
          reply_markup: { inline_keyboard: [[
            { text: 'Reply to this post', callback_data: `fwd_reply:${pid}` },
            { text: 'Report it', callback_data: `fwd_report:${pid}` },
          ]] },
        });
      } catch {}
      await api.answerCallbackQuery({ callback_query_id: query.id, text: T.backU });
      return;
    }
    if (data.startsWith('reportreason:')) {
      const key = data.split(':')[2];
      const ins = await db.insert(submissions).values({
        userId: owner.id, status: 'pending', mediaKind: 'report',
        text: key, refId: pend.postSub, refMsgId: pend.postMsgId,
      }).returning().run().catch(() => null);
      if (!ins) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: T.failedRetry });
        return;
      }
      const rs = ins[0];
      try {
        const card = await api.sendMessage({
          chat_id: ADMIN_GROUP_ID,
          text: `🚩 Report on ${pend.postSub ? '#C' + pend.postSub : 'post ' + pend.postMsgId} · 👤 ${await cardWho(owner)} · ${key}`,
          reply_markup: { inline_keyboard: [[
            { text: 'Remove', callback_data: `report_remove:${rs.id}` },
            { text: 'Dismiss', callback_data: `report_dismiss:${rs.id}` },
          ]] },
        });
        await db.update(submissions).set({ inboxCardId: card.message_id }).where(eq(submissions.id, rs.id)).run();
      } catch {
        await db.update(submissions).set({ status: 'rejected' }).where(eq(submissions.id, rs.id)).run();
        await api.answerCallbackQuery({ callback_query_id: query.id, text: T.failedRetry });
        return;
      }
      await drop();
      await editDM(t.reportSent(rs.id));
      await api.answerCallbackQuery({ callback_query_id: query.id, text: T.reportedU });
      return;
    }
  }

  // Staged-preview confirm/cancel: the staged submission's owner only.
  // Reply-prefix soft gate clear (owner only): "not a reply, continue".
  // Hold notice dies; preview stays so the owner can tap Sahkan next.
  if (data.startsWith('rplclear_')) {
    const id = Number(data.split('_')[1]);
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
    const owner = sub ? await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null) : null;
    if (!sub || !owner || query.from.id !== owner.tgId) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: sub ? T.notYou : T.gone });
      return;
    }
    const t = L(owner);
    if (sub.status !== 'unconfirmed') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.alreadyPreview });
      return;
    }
    await db.update(submissions).set({ rplCleared: 1 }).where(eq(submissions.id, id)).run().catch(() => {});
    await db.insert(audit).values({ adminId: 0, action: 'rpl_cleared', targetUserId: owner.id, reason: `#C${id}` }).run().catch(() => {});
    try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
    const srow = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
    const ids = Array.isArray(srow?.noticeIds) ? srow.noticeIds.filter((n) => n !== query.message.message_id) : [];
    await db.update(submissions).set({ noticeIds: ids }).where(eq(submissions.id, id)).run().catch(() => {});
    await api.answerCallbackQuery({ callback_query_id: query.id, text: t.replyPrefixCleared });
    return;
  }

  // Group-link soft gate clear (owner only): "not a group link, continue".
  // Hold notice dies; preview stays so the owner can tap Sahkan next.
  if (data.startsWith('grpclear_')) {
    const id = Number(data.split('_')[1]);
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
    const owner = sub ? await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null) : null;
    if (!sub || !owner || query.from.id !== owner.tgId) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: sub ? T.notYou : T.gone });
      return;
    }
    const t = L(owner);
    if (sub.status !== 'unconfirmed') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.alreadyPreview });
      return;
    }
    await db.update(submissions).set({ grpCleared: 1 }).where(eq(submissions.id, id)).run().catch(() => {});
    await db.insert(audit).values({ adminId: 0, action: 'grp_cleared', targetUserId: owner.id, reason: `#C${id}` }).run().catch(() => {});
    try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
    const srow = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
    const ids = Array.isArray(srow?.noticeIds) ? srow.noticeIds.filter((n) => n !== query.message.message_id) : [];
    await db.update(submissions).set({ noticeIds: ids }).where(eq(submissions.id, id)).run().catch(() => {});
    await api.answerCallbackQuery({ callback_query_id: query.id, text: t.grpCleared });
    return;
  }

  // Feedback preview Confirm/Cancel (owner only). Mirrors confirm_ but posts
  // a #F card straight to General — feedback is never published to channel.
  if (data.startsWith('fb_confirm_') || data.startsWith('fb_cancel_')) {
    const isGo = data.startsWith('fb_confirm_');
    const id = Number(data.split('_')[2]);
    const fb = await db.select().from(feedback).where(eq(feedback.id, id)).get().catch(() => null);
    const owner = fb ? await db.select().from(users).where(eq(users.id, fb.userId)).get().catch(() => null) : null;
    if (!fb || !owner || query.from.id !== owner.tgId) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: fb ? T.notYou : T.gone });
      return;
    }
    const t = L(owner);
    if (fb.status !== 'unconfirmed') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.alreadyPreview });
      return;
    }
    const dropBubbles = async () => {
      try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
      if (fb.previewMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: fb.previewMsgId }); } catch {} }
    };
    if (!isGo) {
      await db.update(feedback).set({ status: 'cancelled' }).where(eq(feedback.id, id)).run();
      await dropBubbles();
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.fbDiscarded });
      await sendMenu(query.message.chat.id, t).catch(() => {});
      return;
    }
    const r = await confirmFeedback(id, query.from.id);
    if (!r.fb) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: r.error ?? t.failedRetry });
      return;
    }
    await dropBubbles();
    await api.answerCallbackQuery({ callback_query_id: query.id, text: t.sentU });
    return;
  }

  if (data.startsWith('confirm_') || data.startsWith('cancelconf_')) {
    const isConfirm = data.startsWith('confirm_');
    const id = Number(data.split('_')[1]);
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
    const owner = sub ? await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null) : null;
    if (!sub || !owner || query.from.id !== owner.tgId) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: sub ? T.notYou : T.gone });
      return;
    }
    const t = L(owner);
    const collapsePreview = async (text) => {
      // Split preview: delete the action message (query.message) AND the stored
      // content message. Fallback collapses the action message only — the
      // buttonless content message is inert if left behind.
      const srow = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
      let gone = 0;
      try {
        await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id });
        gone++;
      } catch {}
      if (srow?.previewMsgId) {
        try {
          await api.deleteMessage({ chat_id: query.message.chat.id, message_id: srow.previewMsgId });
          gone++;
        } catch {}
      }
      // Transient caption hold/nudge notices die with the flow (both paths).
      for (const nid of (Array.isArray(srow?.noticeIds) ? srow.noticeIds : [])) {
        try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: nid }); } catch {}
      }
      if (gone === 2) return;
      try {
        await api.editMessageText({ chat_id: query.message.chat.id, message_id: query.message.message_id, text,
          reply_markup: { inline_keyboard: [] } });
      } catch {}
    };
    if (!isConfirm) {
      await db.update(submissions).set({ status: 'rejected' }).where(eq(submissions.id, id)).run();
      await collapsePreview(t.discarded);
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.discarded });
      await sendMenu(query.message.chat.id, t).catch(() => {});
      return;
    }
    const r = await confirmSubmission(id, query.from.id);
    if (!r.sub) {
      // Soft-gate blocks keep the preview alive (owner clears, then Sahkan).
      // Every other failure collapses — the toast vanishes, so DM visibility.
      if (r.error === t.replyPrefixErr || r.error === t.grpErr) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: r.error });
        try { await api.sendMessage({ chat_id: query.message.chat.id, text: `❌ ${r.error}` }); } catch {}
        return;
      }
      await collapsePreview(t.notSent(r.error ?? 'gagal'));
      await api.answerCallbackQuery({ callback_query_id: query.id, text: r.error ?? t.failedRetry });
      // Failures must be DM-visible: the toast vanishes and collapse deletes
      // all other evidence, leaving "nothing happened".
      try { await api.sendMessage({ chat_id: query.message.chat.id, text: `❌ ${t.notSent(r.error ?? 'gagal')}` }); } catch {}
      return;
    }
    await collapsePreview(t.sentToAdmins(r.sub.id));
    await api.answerCallbackQuery({ callback_query_id: query.id, text: t.sentU });
    return;
  }

  // Preview intent conversion: re-kind a staged submission (owner only).
  if (data.startsWith('convert_')) {
    const [, idStr, kind] = data.split('_');
    if (kind !== 'question' && kind !== 'lost' && kind !== 'found') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.unknownKind });
      return;
    }
    const id = Number(idStr);
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
    const owner = sub ? await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null) : null;
    if (!sub || !owner || query.from.id !== owner.tgId) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: sub ? T.notYou : T.gone });
      return;
    }
    const t = L(owner);
    if (sub.status !== 'unconfirmed') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.alreadyPreview });
      return;
    }
    await db.update(submissions).set({ kind, isQuestion: kind === 'question' ? 1 : 0 }).where(eq(submissions.id, id)).run();
    sub.kind = kind;
    sub.isQuestion = kind === 'question' ? 1 : 0;
    const newLabel = `${t.actionLead} ${t.preview(id, kind)}:${t.kindNote(KIND_TAGS[kind])}`;
    const newRow = { inline_keyboard: [[
      { text: `${t.confirmWord} (${KIND_TAGS[kind]})`, callback_data: `confirm_${id}` },
      { text: t.cancelBtn, callback_data: `cancelconf_${id}` },
    ]] };
    let convOk = true;
    try {
      await api.editMessageText({ chat_id: query.message.chat.id, message_id: query.message.message_id, text: newLabel });
    } catch { convOk = false; }
    try {
      await api.editMessageReplyMarkup({ chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: newRow });
    } catch { convOk = false; }
    if (!convOk) {
      // Rich action refused edits — rebuild it plain (content is headerless now,
      // so nothing else goes stale).
      try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
      try {
        await api.sendMessage({ chat_id: query.message.chat.id, text: newLabel.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(t.preview(id, kind), `<b>${t.preview(id, kind)}</b>`), parse_mode: 'HTML', reply_markup: newRow });
      } catch {}
    }
    await api.answerCallbackQuery({ callback_query_id: query.id, text: t.convertToast(KIND_TAGS[kind]) });
    try { await api.sendMessage({ chat_id: query.message.chat.id, text: t.convertGuide[kind] }); } catch {}
    return;
  }

  // Language pick (first /start, /changelanguage): DM owner only, no admin needed.
  if (data.startsWith('set_lang:')) {
    const lang = data.split(':')[1];
    if (lang !== 'ms' && lang !== 'en') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: '?' });
      return;
    }
    if (!query.message || query.message.chat?.id !== query.from.id) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: (STR[LANG] ?? STR.ms).notYou });
      return;
    }
    await db.update(users).set({ lang }).where(eq(users.tgId, query.from.id)).run().catch(() => {});
    const T = STR[lang];
    await api.answerCallbackQuery({ callback_query_id: query.id, text: lang === 'ms' ? 'Bahasa: BM.' : 'Language: EN.' });
    try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
    await sendStart(query.message.chat.id, query.from, T).catch(() => {});
    return;
  }

  // /start rich buttons: the DM owner only (chat.id == user id in private).
  if (data === 'go_faq' || data === 'go_chat' || data === 'send_conf' || data === 'ask_q' || data === 'faq_proceed' || data.startsWith('askcat:') || data.startsWith('tut:') || data === 'lostfound' || data === 'lost_new' || data === 'found_new' || data === 'dana_new' || data.startsWith('dana_sub:') || data === 'dana_back' || data === 'suggest_new' || data === 'info_new' || data === 'feedback_new' || data === 'iklan_info' || data === 'event_info' || data === 'grid_help' || data === 'grid_tut' || data === 'menu_noop' || data === 'noop_kind' || data === 'dismiss' || data.startsWith('armcancel:')) {
    // Stateless anywhere: deleting the bot's own bubble + paging the static
    // user tutorial. Everything else below mutates state → DM-locked.
    const freePass = data === 'dismiss' || data.startsWith('tut:');
    if (!freePass && (!query.message || query.message.chat?.id !== query.from.id)) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: T.notYou });
      return;
    }
    const btnUser = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
    const t = L(btnUser);
    if (data === 'dismiss') {
      try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.closedU });
      return;
    }
    if (data.startsWith('armcancel:')) {
      const which = data.split(':')[1];
      if (which !== 'question' && which !== 'lostfound' && which !== 'dana' && which !== 'suggest' && which !== 'info' && which !== 'feedback') {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.unknownKind });
        return;
      }
      const states = which === 'question' ? ['awaiting_question', 'awaiting_faq'] : which === 'dana' ? ['awaiting_dana'] : which === 'suggest' ? ['awaiting_suggest'] : which === 'info' ? ['awaiting_info'] : which === 'feedback' ? ['awaiting_feedback'] : ['awaiting_lost', 'awaiting_found'];
      const rows = [];
      for (const st of states) {
        const w = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, btnUser?.id ?? -1), eq(pendingIntents.state, st))).get().catch(() => null);
        if (w) rows.push(w);
      }
      if (!rows.length) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: which === 'question' ? t.noDraftQ : which === 'dana' ? t.noDraftDana : which === 'suggest' ? t.noDraftSuggest : which === 'info' ? t.noDraftInfo : which === 'feedback' ? t.noDraftFeedback : t.noDraftLF });
        return;
      }
      for (const w of rows) {
        await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
      }
      try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
      await api.answerCallbackQuery({ callback_query_id: query.id, text: which === 'question' ? t.qDiscarded : which === 'dana' ? t.danaDiscarded : which === 'suggest' ? t.suggestDiscarded : which === 'info' ? t.infoDiscarded : which === 'feedback' ? t.fbDiscarded : t.lfDiscarded });
      await sendMenu(query.message.chat.id, t).catch(() => {});
      return;
    }
    if (data === 'noop_kind') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.kindSepHint });
      return;
    }
    if (data === 'go_faq') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.faqSoon });
      try { await api.sendMessage({ chat_id: query.message.chat.id, text: t.faqSoon, reply_markup: { inline_keyboard: [[{ text: t.tutupBtn, callback_data: 'dismiss' }]] } }); } catch {}
      return;
    }
    if (data === 'send_conf') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.typeConf });
      try { await api.sendMessage({ chat_id: query.message.chat.id, text: await tag('sendGuidance', t.sendGuidance), reply_markup: { inline_keyboard: [[{ text: t.tutupBtn, callback_data: 'dismiss' }]] } }); } catch {}
      return;
    }
    // Menu separator: visual only.
    if (data === 'menu_noop') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: T.menuHead });
      return;
    }
    // Grid help/tutorial: same sends as the /help + /tutorial commands.
    if (data === 'grid_help' || data === 'grid_tut') {
      const hu = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      const ht = L(hu);
      try {
        if (data === 'grid_help') await api.sendMessage({ chat_id: query.message.chat.id, text: ht.help(TERMS_URL) + (query.from.id === SUPER_ADMIN_ID ? (hu?.lang === 'en' ? '\n/who <id> — identify a user (super-admin)' : '\n/who <id> — kenal pasti pengguna (super-admin)') : '') });
        else await api.sendMessage({ chat_id: query.message.chat.id, text: `${ht.tutTitle(0)}\n${ht.tutSteps[0]}`, reply_markup: tutRow(ht, 0) });
      } catch {}
      await api.answerCallbackQuery({ callback_query_id: query.id, text: data === 'grid_help' ? ht.btnHelp : ht.btnTut });
      return;
    }
    if (data.startsWith('tut:')) {
      const n = Math.min(Math.max(0, Number(data.slice(4)) || 0), t.tutSteps.length - 1);
      try {
        await api.editMessageText({ chat_id: query.message.chat.id, message_id: query.message.message_id, text: `${t.tutTitle(n)}\n${t.tutSteps[n]}`, reply_markup: tutRow(t, n) });
      } catch {}
      await api.answerCallbackQuery({ callback_query_id: query.id, text: `${n + 1}/${t.tutSteps.length}` });
      return;
    }
    if (data === 'ask_q') {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.startFirst });
        return;
      }
      const tq = L(owner);
      const othersQ = await db.all(sql`SELECT state FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => []);
      await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => {});
      await db.delete(pendingIntents).where(and(eq(pendingIntents.userId, owner.id), eq(pendingIntents.state, 'awaiting_question'))).run().catch(() => {});
      const oldGate = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, owner.id), eq(pendingIntents.state, 'awaiting_faq'))).get().catch(() => null);
      if (oldGate?.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: oldGate.srcMsgId }); } catch {} }
      await db.delete(pendingIntents).where(and(eq(pendingIntents.userId, owner.id), eq(pendingIntents.state, 'awaiting_faq'))).run().catch(() => {});
      const diedQ = [...new Set((othersQ ?? []).map((r) => stateName(r.state, tq)))];
      const switchQ = diedQ.length ? `\n${tq.armSwitched(diedQ.join(', '))}` : '';
      let armQ = null;
      try {
        const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag('faqGate', tq.faqGate + switchQ), reply_markup: { inline_keyboard: [[
          { text: tq.faqOpenBtn, url: FAQ_URL },
        ], [
          { text: tq.faqGoBtn, callback_data: 'faq_proceed' },
          { text: tq.cancelBtn, callback_data: 'armcancel:question' },
        ]] } });
        armQ = m?.message_id ?? null;
      } catch {}
      await db.insert(pendingIntents).values({ userId: owner.id, state: 'awaiting_faq', kind: 'question', srcMsgId: armQ }).run().catch(() => {});
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.sendQ });
      return;
    }
    // FAQ gate proceed: lazy time-gate (no scheduler on tgcloud) — the
    // interstitial's created_at is the prompt clock.
    if (data === 'faq_proceed') {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.startFirst });
        return;
      }
      const g = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, owner.id), eq(pendingIntents.state, 'awaiting_faq'))).orderBy(desc(pendingIntents.id)).get().catch(() => null);
      const tq = L(owner);
      if (!g) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: tq.noDraftQ });
        return;
      }
      const born = g.created instanceof Date ? Math.floor(g.created.getTime() / 1000) : Number(g.created) || 0;
      const age = Math.floor(Date.now() / 1000) - born;
      if (age < FAQ_GATE_SEC) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: tq.faqTooSoon(FAQ_GATE_SEC - age) });
        return;
      }
      await db.update(pendingIntents).set({ state: 'awaiting_question', kind: g.parked ? 'askpark' : 'askcat' }).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
      if (g.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: g.srcMsgId }); } catch {} }
      let pickId = null;
      try {
        const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag('faqPick', tq.faqPick), reply_markup: { inline_keyboard: [...ASK_L1, [{ text: tq.cancelBtn, callback_data: 'armcancel:question' }]] } });
        pickId = m?.message_id ?? null;
      } catch {}
      await db.update(pendingIntents).set({ srcMsgId: pickId }).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
      await api.answerCallbackQuery({ callback_query_id: query.id, text: tq.sendQ });
      return;
    }
    // Question category picker (post-gate): L1 categories, L2 sub-pickers for
    // servis/tempat/bas, self-serve link branches, guided leaf prompts. The
    // intent stays state=awaiting_question; kind=askcat marks "picking",
    // kind=question + text=<cat[ › sub]> marks "answering".
    if (data.startsWith('askcat:')) {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.startFirst });
        return;
      }
      const tq = L(owner);
      const g = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, owner.id), eq(pendingIntents.state, 'awaiting_question'))).orderBy(desc(pendingIntents.id)).get().catch(() => null);
      if (!g) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: tq.noDraftQ });
        return;
      }
      const tok = data.slice(7);
      const cancelRow = [[{ text: tq.cancelBtn, callback_data: 'armcancel:question' }]];
      const backRow = [[{ text: tq.askCatBack, callback_data: 'askcat:back' }, { text: tq.cancelBtn, callback_data: 'armcancel:question' }]];
      const setPicker = async (mid) => { await db.update(pendingIntents).set({ srcMsgId: mid }).where(eq(pendingIntents.id, g.id)).run().catch(() => {}); };
      // Parked question (auto-routed): stage it now with the picked category.
      const stageParked = async (catPath) => {
        let pc = null;
        try { pc = g.parked ? JSON.parse(g.parked) : null; } catch {}
        if (!pc || !pc.kind) return false;
        const staged = await submitConfession({ from: query.from, chatId: query.message.chat.id, messageId: null,
          content: { kind: pc.kind, text: pc.text ?? null, fileId: pc.fileId ?? null, caption: pc.caption ?? null },
          stripped: [], isQuestion: true });
        if (staged?.sub && catPath) {
          const [c, s] = String(catPath).split(' › ');
          await db.update(submissions).set({ askCat: c || null, askSub: s || null }).where(eq(submissions.id, staged.sub.id)).run().catch(() => {});
        }
        await db.delete(pendingIntents).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
        if (g.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: g.srcMsgId }); } catch {} }
        return true;
      };
      const flipAnswer = async (catPath, promptKey) => {
        if (await stageParked(catPath)) return true;
        await db.update(pendingIntents).set({ kind: 'question', text: catPath }).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
        if (g.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: g.srcMsgId }); } catch {} }
        try {
          const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag(`askPrompts.${promptKey}`, tq.askPrompts[promptKey]), reply_markup: { inline_keyboard: backRow } });
          await setPicker(m?.message_id ?? null);
        } catch {}
      };
      if (tok === 'skip') {
        if (await stageParked(null)) {
          await api.answerCallbackQuery({ callback_query_id: query.id, text: tq.sentU });
          return;
        }
        await db.update(pendingIntents).set({ kind: 'question', text: null }).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
        if (g.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: g.srcMsgId }); } catch {} }
        try {
          const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag('faqReady', tq.faqReady), reply_markup: { inline_keyboard: backRow } });
          await setPicker(m?.message_id ?? null);
        } catch {}
        await api.answerCallbackQuery({ callback_query_id: query.id, text: tq.sendQ });
        return;
      }
      if (tok === 'back') {
        // From prompts or L2: flip back to picking, resend L1, track it.
        await db.update(pendingIntents).set({ kind: 'askcat', text: null }).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
        if (g.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: g.srcMsgId }); } catch {} }
        try {
          const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag('faqPick', tq.faqPick), reply_markup: { inline_keyboard: [...ASK_L1, ...cancelRow] } });
          await setPicker(m?.message_id ?? null);
        } catch {}
        await api.answerCallbackQuery({ callback_query_id: query.id, text: tq.backU });
        return;
      }
      if (tok === 'servis' || tok === 'tempat' || tok === 'bas') {
        const titles = { servis: '🛠️ Servis apa?', tempat: '📍 Dalam atau luar UniSZA?', bas: '🚌 Bas ekspress atau soalan lain?' };
        const rows = tok === 'servis'
          ? [[{ text: '🏃 Runner', callback_data: 'askcat:sub:runner' }, { text: '🚕 Grab', callback_data: 'askcat:sub:grab' }], [{ text: '🧰 Servis Lain', callback_data: 'askcat:sub:servis_lain' }]]
          : tok === 'tempat'
            ? [[{ text: '🏫 Dalam UniSZA', callback_data: 'askcat:tempat_dalam' }, { text: '🌆 Luar UniSZA', callback_data: 'askcat:sub:luar' }]]
            : [[{ text: '📍 Lokasi pickup/drop', callback_data: 'askcat:bas_lokasi' }, { text: '💬 Soalan lain', callback_data: 'askcat:sub:soalan_lain' }]];
        try {
          await api.editMessageText({ chat_id: query.message.chat.id, message_id: query.message.message_id, text: titles[tok], reply_markup: { inline_keyboard: [...rows, [{ text: tq.askBack, callback_data: 'askcat:back' }]] } });
        } catch {
          if (g.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: g.srcMsgId }); } catch {} }
          try {
            const m = await api.sendMessage({ chat_id: query.message.chat.id, text: titles[tok], reply_markup: { inline_keyboard: [...rows, [{ text: tq.askBack, callback_data: 'askcat:back' }], ...cancelRow] } });
            await setPicker(m?.message_id ?? null);
          } catch {}
        }
        await api.answerCallbackQuery({ callback_query_id: query.id, text: titles[tok] });
        return;
      }
      if (tok === 'tempat_dalam' || tok === 'bas_lokasi') {
        const linkText = tok === 'tempat_dalam' ? `${tq.askLinkDalam}${MAP_URL}` : `${tq.askLinkBas}${BUS_URL}`;
        if (g.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: g.srcMsgId }); } catch {} }
        try {
          const m = await api.sendMessage({ chat_id: query.message.chat.id, text: `${linkText}\n\n${tq.askLinkMore}`, reply_markup: { inline_keyboard: [...ASK_L1, ...cancelRow] } });
          await setPicker(m?.message_id ?? null);
        } catch {}
        await api.answerCallbackQuery({ callback_query_id: query.id, text: tq.sentU });
        return;
      }
      const LEAVES = { makan: 'makan', sewa: 'sewa', barang: 'barang', tumpang: 'tumpang' };
      if (LEAVES[tok]) {
        const done = await flipAnswer(tok, tok);
        await api.answerCallbackQuery({ callback_query_id: query.id, text: done ? tq.sentU : tq.sendQ });
        return;
      }
      if (tok.startsWith('sub:')) {
        const key = tok.slice(4);
        const parents = { runner: 'servis', grab: 'servis', servis_lain: 'servis', luar: 'tempat', soalan_lain: 'bas' };
        if (!parents[key] || !tq.askPrompts[key]) {
          await api.answerCallbackQuery({ callback_query_id: query.id, text: tq.unknownKind });
          return;
        }
        const done = await flipAnswer(`${parents[key]} › ${key}`, key);
        await api.answerCallbackQuery({ callback_query_id: query.id, text: done ? tq.sentU : tq.sendQ });
        return;
      }
      await api.answerCallbackQuery({ callback_query_id: query.id, text: tq.unknownKind });
      return;
    }
    if (data === 'lostfound') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.lostFoundQ });
      try {
        await api.sendMessage({
          chat_id: query.message.chat.id,
          text: t.lfChoice,
          reply_markup: { inline_keyboard: [[
            { text: '🔍 Report Lost', callback_data: 'lost_new' },
            { text: '📦 Report Found', callback_data: 'found_new' },
          ], [
            { text: t.tutupBtn, callback_data: 'dismiss' },
          ]] },
        });
      } catch {}
      return;
    }
    if (data === 'lost_new' || data === 'found_new') {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: T.startFirst });
        return;
      }
      const lk = data === 'lost_new' ? 'lost' : 'found';
      const st = data === 'lost_new' ? 'awaiting_lost' : 'awaiting_found';
      const tl = L(owner);
      const othersL = await db.all(sql`SELECT state FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_question','awaiting_faq','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => []);
      await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_question','awaiting_faq','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => {});
      const diedL = [...new Set((othersL ?? []).map((r) => stateName(r.state, tl)).filter((n) => n !== tl.draftNames[lk]))];
      const switchL = diedL.length ? `\n${tl.armSwitched(diedL.join(', '))}` : '';
      const armText = (lk === 'lost' ? tl.lostArm : tl.foundArm) + switchL;
      let armL = null;
      try {
        const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag(lk === 'lost' ? 'lostArm' : 'foundArm', armText), reply_markup: { inline_keyboard: [[{ text: tl.cancelBtn, callback_data: 'armcancel:lostfound' }]] } });
        armL = m?.message_id ?? null;
      } catch {}
      await db.insert(pendingIntents).values({ userId: owner.id, state: st, kind: lk, srcMsgId: armL }).run().catch(() => {});
      await api.answerCallbackQuery({ callback_query_id: query.id, text: lk === 'lost' ? t.describeLost : t.describeFound });
      try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
      return;
    }
    // Iklan / event: guidance only (no staging) — iklan goes to the ad
    // section, events to the linked announcement channel.
    if (data === 'iklan_info' || data === 'event_info') {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.startFirst });
        return;
      }
      const gt = L(owner);
      try {
        await api.sendMessage({ chat_id: query.message.chat.id, text: await tag(data === 'iklan_info' ? 'iklanGuide' : 'eventGuide', data === 'iklan_info' ? gt.iklanGuide : gt.eventGuide),
          reply_markup: { inline_keyboard: [[{ text: gt.tutupBtn, callback_data: 'dismiss' }]] } });
      } catch {}
      await api.answerCallbackQuery({ callback_query_id: query.id, text: data === 'iklan_info' ? gt.btnIklan : gt.btnEvent });
      return;
    }
    // Dana L2: program vs derma kilat (shared #cariandana lead, card differs).
    if (data === 'dana_new') {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.startFirst });
        return;
      }
      const dt = L(owner);
      const othersD = await db.all(sql`SELECT state FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_question','awaiting_faq','awaiting_lost','awaiting_found','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => []);
      await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_question','awaiting_faq','awaiting_lost','awaiting_found','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => {});
      const diedD = [...new Set((othersD ?? []).map((r) => stateName(r.state, dt)).filter((n) => n !== dt.draftNames.dana))];
      const switchD = diedD.length ? `\n${dt.armSwitched(diedD.join(', '))}` : '';
      let pickD = null;
      try {
        const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag('danaPick', dt.danaPick + switchD), reply_markup: { inline_keyboard: [
          [{ text: '📚 Dana Program', callback_data: 'dana_sub:program' }, { text: '⚡ Derma Kilat', callback_data: 'dana_sub:kilat' }],
          [{ text: dt.askBack, callback_data: 'dana_back' }, { text: dt.cancelBtn, callback_data: 'dismiss' }],
        ] } });
        pickD = m?.message_id ?? null;
      } catch {}
      await db.insert(pendingIntents).values({ userId: owner.id, state: 'awaiting_dana', kind: 'danapick', srcMsgId: pickD }).run().catch(() => {});
      await api.answerCallbackQuery({ callback_query_id: query.id, text: dt.btnDana });
      try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
      return;
    }
    // Dana sub pick: flip to answering, subtype parked in intent text.
    if (data.startsWith('dana_sub:')) {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.startFirst });
        return;
      }
      const dt = L(owner);
      const g = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, owner.id), eq(pendingIntents.state, 'awaiting_dana'))).orderBy(desc(pendingIntents.id)).get().catch(() => null);
      if (!g || g.kind !== 'danapick') {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: dt.danaNudge });
        return;
      }
      const key = data.slice(9);
      if (key !== 'program' && key !== 'kilat') {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: dt.unknownKind });
        return;
      }
      await db.update(pendingIntents).set({ kind: 'dana', text: key }).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
      if (g.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: g.srcMsgId }); } catch {} }
      try {
        const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag('danaArm', dt.danaArm(key === 'kilat' ? '#dermakilat' : '#cariandana')), reply_markup: { inline_keyboard: [[{ text: dt.askBack, callback_data: 'dana_back' }, { text: dt.cancelBtn, callback_data: 'armcancel:dana' }]] } });
        await db.update(pendingIntents).set({ srcMsgId: m?.message_id ?? null }).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
      } catch {}
      await api.answerCallbackQuery({ callback_query_id: query.id, text: dt.btnDana });
      return;
    }
    // Dana back: from L2 → menu (drop the pick intent); from arm prompt →
    // back to the L2 picker (reset to picking).
    if (data === 'dana_back') {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.startFirst });
        return;
      }
      const dt = L(owner);
      const g = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, owner.id), eq(pendingIntents.state, 'awaiting_dana'))).orderBy(desc(pendingIntents.id)).get().catch(() => null);
      if (!g) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: dt.noDraftDana });
        return;
      }
      if (g.kind === 'danapick') {
        await db.delete(pendingIntents).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
        if (g.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: g.srcMsgId }); } catch {} }
        try { await sendMenu(query.message.chat.id, dt).catch(() => {}); } catch {}
        await api.answerCallbackQuery({ callback_query_id: query.id, text: dt.backU });
        return;
      }
      await db.update(pendingIntents).set({ kind: 'danapick', text: null }).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
      if (g.srcMsgId) { try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: g.srcMsgId }); } catch {} }
      try {
        const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag('danaPick', dt.danaPick), reply_markup: { inline_keyboard: [
          [{ text: '📚 Dana Program', callback_data: 'dana_sub:program' }, { text: '⚡ Derma Kilat', callback_data: 'dana_sub:kilat' }],
          [{ text: dt.askBack, callback_data: 'dana_back' }, { text: dt.cancelBtn, callback_data: 'dismiss' }],
        ] } });
        await db.update(pendingIntents).set({ srcMsgId: m?.message_id ?? null }).where(eq(pendingIntents.id, g.id)).run().catch(() => {});
      } catch {}
      await api.answerCallbackQuery({ callback_query_id: query.id, text: dt.backU });
      return;
    }
    // Suggest/info arm: shared block (mirror lost_new) — content stages bare-tagged.
    if (data === 'suggest_new' || data === 'info_new') {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.startFirst });
        return;
      }
      const sk = data === 'suggest_new' ? 'suggest' : 'info';
      const sst = data === 'suggest_new' ? 'awaiting_suggest' : 'awaiting_info';
      const st = L(owner);
      const othersS = await db.all(sql`SELECT state FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_question','awaiting_faq','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => []);
      await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_question','awaiting_faq','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => {});
      const diedS = [...new Set((othersS ?? []).map((r) => stateName(r.state, st)).filter((n) => n !== st.draftNames[sk]))];
      const switchS = diedS.length ? `\n${st.armSwitched(diedS.join(', '))}` : '';
      const armTextS = (sk === 'suggest' ? st.suggestArm : st.infoArm) + switchS;
      let armS = null;
      try {
        const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag(sk === 'suggest' ? 'suggestArm' : 'infoArm', armTextS), reply_markup: { inline_keyboard: [[{ text: st.cancelBtn, callback_data: `armcancel:${sk}` }]] } });
        armS = m?.message_id ?? null;
      } catch {}
      await db.insert(pendingIntents).values({ userId: owner.id, state: sst, kind: sk, srcMsgId: armS }).run().catch(() => {});
      await api.answerCallbackQuery({ callback_query_id: query.id, text: sk === 'suggest' ? st.btnSuggest : st.btnInfo });
      try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
      return;
    }
    // Feedback arm: single intent — content stages as an #F report (never published).
    if (data === 'feedback_new') {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.startFirst });
        return;
      }
      const ft = L(owner);
      const othersB = await db.all(sql`SELECT state FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_question','awaiting_faq','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info')`).catch(() => []);
      await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_question','awaiting_faq','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info')`).catch(() => {});
      const diedB = [...new Set((othersB ?? []).map((r) => stateName(r.state, ft)).filter((n) => n !== ft.draftNames.feedback))];
      const switchB = diedB.length ? `\n${ft.armSwitched(diedB.join(', '))}` : '';
      let armB = null;
      try {
        const m = await api.sendMessage({ chat_id: query.message.chat.id, text: await tag('feedbackArm', ft.feedbackArm + switchB), reply_markup: { inline_keyboard: [[{ text: ft.cancelBtn, callback_data: 'armcancel:feedback' }]] } });
        armB = m?.message_id ?? null;
      } catch {}
      await db.insert(pendingIntents).values({ userId: owner.id, state: 'awaiting_feedback', kind: 'feedback', srcMsgId: armB }).run().catch(() => {});
      await api.answerCallbackQuery({ callback_query_id: query.id, text: ft.btnFeedback });
      try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
      return;
    }
    const out = await openChatSession(query.from).catch(() => T.openFail);
    await api.answerCallbackQuery({ callback_query_id: query.id, text: out.slice(0, 180) });
    try { await api.sendMessage({ chat_id: query.message.chat.id, text: out }); } catch {}
    return;
  }

  if (!(await isAdmin(adminId))) {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Not for you.' });
    return;
  }
  await flushQueue(false).catch(() => {}); // drip-feed: release due queued posts
  const cid = (s) => Number(s);

  // Rich-probe tap (see /richprobe): proves tg-button-row delivery.
  if (data === 'richprobe_ok') {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Rich button works.' });
    return;
  }

  // /oldest pages: recomputed per tap (never stale). Post-gate = group-admin.
  if (data.startsWith('oldest:')) {
    const pg = await oldestPage(Number(data.slice(7)) || 0).catch(() => null);
    if (!pg) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Failed.' });
      return;
    }
    try {
      await api.editMessageText({ chat_id: query.message.chat.id, message_id: query.message.message_id, text: pg.text, reply_markup: pg.buttons ?? { inline_keyboard: [] } });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Page.' });
    return;
  }
  // Group-side dismiss (the DM block's dismiss is owner-only by chat check).
  if (data === 'dismiss') {
    try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: (STR.en ?? STR.ms).closedU });
    return;
  }
  // Session opener close button: any group admin can close (same as /endadminsession).
  if (data.startsWith('endchat_')) {
    const uid = Number(data.split('_')[1]);
    const target = Number.isFinite(uid) ? await db.select().from(users).where(eq(users.id, uid)).get().catch(() => null) : null;
    if (!target) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Gone.' });
      return;
    }
    await closeSession(target.id, adminId);
    try {
      await api.editMessageText({ chat_id: query.message.chat.id, message_id: query.message.message_id, text: `— chat closed with ${await cardWho(target)}`, reply_markup: { inline_keyboard: [] } });
    } catch {}
    try { await api.sendMessage({ chat_id: target.tgId, text: L(target).chatClosedUser }); await bumpOut(); } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Closed.' });
    return;
  }
  // Reply-template send: threaded anonymous relay to the card's author.
  if (data.startsWith('tpl_pick:')) {
    const [, idStr, key] = data.split(':');
    const TPL = { iklan1: 'tplIklan1', iklan2: 'tplIklan2', reply1: 'tplReply1', reply2: 'tplReply2', mention: 'tplMention', helpContact: 'tplHelpContact', helpShot: 'tplHelpShot', reject: 'tplReject' };
    const sub = await db.select().from(submissions).where(eq(submissions.id, Number(idStr))).get().catch(() => null);
    const body = TPL[key] ? STR.ms[TPL[key]] : null;
    const author = sub ? await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null) : null;
    if (!sub || !author || !body) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Gone.' });
      return;
    }
    await verdictDM(author.tgId, sub.userMessageId, body);
    await bumpOut();
    await db.insert(audit).values({ adminId, action: 'tpl_send', targetUserId: author.id, reason: `#C${sub.id}:${key}` }).run().catch(() => {});
    try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Sent ✓' });
    return;
  }
  // Admin tutorial pages (group surfaces stay English).
  if (data.startsWith('atut:')) {
    const T = STR.en ?? STR.ms;
    const n = Math.min(Math.max(0, Number(data.slice(5)) || 0), T.atutSteps.length - 1);
    try {
      await api.editMessageText({ chat_id: query.message.chat.id, message_id: query.message.message_id, text: `${T.atutTitle(n)}\n${T.atutSteps[n]}`, reply_markup: atutRow(n, T.atutSteps.length) });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: `${n + 1}/${T.atutSteps.length}` });
    return;
  }
  // Owner broadcast: draft Confirm/Discard. Sequential sends (fine at current
  // scale; chunk with progress edits if users ever pass low thousands).
  if (data.startsWith('announce_go:') || data.startsWith('announce_no:')) {
    if (query.from.id !== SUPER_ADMIN_ID) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Not for you.' });
      return;
    }
    const did = Number(data.split(':')[1]);
    const d = await db.select().from(pendingIntents).where(eq(pendingIntents.id, did)).get().catch(() => null);
    if (!d || d.state !== 'announce_draft') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Gone.' });
      return;
    }
    await db.delete(pendingIntents).where(eq(pendingIntents.id, did)).run().catch(() => {});
    try { await api.editMessageReplyMarkup({ chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch {}
    if (data.startsWith('announce_no:')) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Discarded.' });
      return;
    }
    const targets = await db.all(sql`SELECT tg_id FROM users WHERE banned = 0 AND dead = 0`).catch(() => []);
    let ok = 0;
    let fail = 0;
    for (const t of targets ?? []) {
      try { await api.sendMessage({ chat_id: Number(t.tg_id), text: d.text }); ok++; }
      catch (e) {
        fail++;
        if (/blocked|deactivated/i.test(String(e?.description ?? e?.message ?? ''))) await markDeadByTg(Number(t.tg_id));
      }
    }
    await bumpOut(ok);
    await db.insert(audit).values({ adminId: query.from.id, action: 'announce', targetUserId: null, reason: `sent:${ok} failed:${fail}` }).run().catch(() => {});
    try { await api.sendMessage({ chat_id: Number(d.postMsgId) || ADMIN_GROUP_ID, text: `📣 Blast done — sent ${ok}, failed ${fail}.` }); } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Blasted.' });
    return;
  }
  // /adminstats window switcher: recomputed per tap (never stale). Post-gate
  // means group-admin or ADMIN_IDS — same gate as /adminstats itself.
  if (data.startsWith('astats:')) {
    const days = data === 'astats:all' ? 0 : Number(data.slice(7)) || 30;
    const label = days === 0 ? 'all' : `${days}d`;
    const members = await groupAdmins().catch(() => []);
    const out = await adminStatsText(days, label, members, await dutyGreens().catch(() => null), await crownMap().catch(() => null)).catch(() => null);
    if (!out) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Failed.' });
      return;
    }
    try {
      await api.editMessageText({ chat_id: query.message.chat.id, message_id: query.message.message_id, text: out, reply_markup: astatsRow(days) });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: label });
    return;
  }
  // /list pagination: recomputed per tap (never stale). Gate = /list itself:
  // post-gate means group-admin or ADMIN_IDS (incl. super-admin DM).
  if (data.startsWith('list_more:')) {
    const [, uidStr, pStr] = data.split(':');
    const tu = await db.select().from(users).where(eq(users.id, Number(uidStr))).get().catch(() => null);
    if (!tu) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Gone.' });
      return;
    }
    const pg = await listPage(tu, Number(pStr)).catch(() => null);
    if (!pg) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Failed.' });
      return;
    }
    try {
      await api.editMessageText({ chat_id: query.message.chat.id, message_id: query.message.message_id, text: pg.text, reply_markup: pg.buttons ?? { inline_keyboard: [] } });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Page.' });
    return;
  }

  // ---- Accept → post anonymously to channel (first tap wins) ----
  // approved-undone cards stay actionable: Accept re-publishes as a new post.
  if (data.startsWith('accept:')) {
    const id = cid(data.slice(7));
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get();
    if (!sub || (sub.status !== 'pending' && sub.status !== 'warned' && sub.status !== 'approved-undone' && sub.status !== 'queued')) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already handled — see card.' });
      return;
    }
    const isRepublish = sub.status === 'approved-undone';
    if (sub.mediaKind === 'report') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Use Remove / Dismiss.' });
      return;
    }
    const userRow = await db.select().from(users).where(eq(users.id, sub.userId)).get();
    const t = L(userRow);
    // Per-kind serial (#ask1, #lost1…): MAX+1 with unique-index retry — the DB
    // constraint is the lock (separate isolates can't share memory).
    const kk = kindOf(sub);
    let seq = sub.kindSeq ?? null;
    if (kk && kk !== 'confession' && !NO_SERIAL.has(kk) && seq == null) {
      for (let i = 0; i < 8; i++) {
        const mx = await db.get(sql`SELECT MAX(kind_seq) AS m FROM submissions WHERE kind = ${kk}`).catch(() => ({ m: 0 }));
        const next = (mx?.m ?? 0) + 1;
        await db.run(sql`UPDATE submissions SET kind_seq = ${next} WHERE id = ${id} AND kind_seq IS NULL`).catch(() => null);
        const chk = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
        if (chk && chk.kindSeq === next) { seq = next; break; }
      }
      if (seq == null) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Numbering failed — try again.' });
        return;
      }
      sub.kindSeq = seq;
    }
    const seqLabel = seq && kk && KIND_TAGS[kk] ? ` · ${KIND_TAGS[kk]}${seq}` : '';
    // Drip-feed: not due (cooldown/quiet) → queue for the lazy flush.
    // Republish skips the queue (mod explicitly re-posting). Off when DRIP_FEED off.
    if (DRIP_FEED && sub.status !== 'approved-undone') {
      const due = await postDue().catch(() => ({ due: true }));
      if (!due.due) {
        if (sub.status === 'queued') {
          // Idempotent re-tap: no second stamp, no second DM.
          const pos0 = await queuePos(id).catch(() => 1);
          await api.answerCallbackQuery({ callback_query_id: query.id, text: `Already queued #C${id} (#${pos0}) — see card.` });
          return;
        }
        await db.update(submissions).set({ status: 'queued' }).where(eq(submissions.id, id)).run().catch(() => {});
        await db.insert(audit).values({ adminId, action: 'queue', targetUserId: sub.userId, reason: `#C${id}` }).run().catch(() => {});
        const pos = await queuePos(id).catch(() => 1);
        const when = due.quiet ? 'night pause — posts resume ~7am MYT' : `~${due.waitMin ?? '?'} min`;
        await editCard(query, `⏳ Queued — #${pos} (${when})`, { inline_keyboard: [[
          { text: '✅ Accept', callback_data: `accept:${id}` },
        ], [
          { text: '❌ Reject', callback_data: `reject:${id}` },
          { text: '⚠️ Warn', callback_data: `warn:${id}` },
        ], [
          { text: '⛔ BAN', callback_data: `ban:${id}` },
        ]] });
        await api.answerCallbackQuery({ callback_query_id: query.id, text: `Queued #C${id} (#${pos}).` });
        try {
          if (userRow) await verdictDM(userRow.tgId, sub.userMessageId, t.queuedHead(id, pos, when));
        } catch {}
        return;
      }
    }
    let channelIds = [];
    try {
      channelIds = await publishToChannel(sub);
    } catch (e) {
      const desc = String(e?.description ?? e?.message ?? e);
      console.error('channel post failed:', e?.description ?? e?.message ?? e);
      if (sub.refMsgId && /not found|reply/i.test(desc)) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Original post gone.' });
      } else {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Channel post failed — is the bot admin?' });
      }
      return;
    }
    await db.update(submissions).set({ status: 'approved', channelMessageIds: channelIds, acceptedBy: adminId }).where(eq(submissions.id, id)).run();
    await db.insert(audit).values({ adminId, action: isRepublish ? 'republish' : 'accept', targetUserId: sub.userId, reason: `#C${id}` }).run();
    const postUrl = channelIds.length ? await channelPostLink(channelIds[0]).catch(() => null) : null;
    await editCard(query, (isRepublish ? '🔁 Republished' : '✅ Accepted') + seqLabel + (channelIds.length ? ` · #${channelIds[0]}` : ''), { inline_keyboard: [[{ text: 'Undo', callback_data: `undo:${id}` }]] }, postUrl);
    await api.answerCallbackQuery({ callback_query_id: query.id, text: isRepublish ? `Republished #C${id}.` : `Published #C${id}.` });
    try {
      if (userRow && postUrl) await sendPublishedDM(userRow.tgId, id, isRepublish, postUrl, userRow.lang, sub.userMessageId);
      else if (userRow) await verdictDM(userRow.tgId, sub.userMessageId, T.publishedHead(id, isRepublish));
    } catch {}
    return;
  }

  // ---- Undo → delete channel post, fallback tombstone ----
  if (data.startsWith('undo:')) {
    const id = cid(data.slice(5));
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get();
    if (!sub || sub.status !== 'approved') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Nothing to undo.' });
      return;
    }
    const ids = Array.isArray(sub.channelMessageIds) ? sub.channelMessageIds : [];
    let ok = true;
    for (const mid of ids) {
      try {
        await api.deleteMessage({ chat_id: CHANNEL_ID, message_id: mid });
      } catch {
        ok = false;
        try {
          await api.editMessageText({ chat_id: CHANNEL_ID, message_id: mid, text: '[removed by mods]' });
          ok = true;
        } catch { ok = false; }
      }
    }
    await db.update(submissions).set({ status: 'approved-undone' }).where(eq(submissions.id, id)).run();
    await db.insert(audit).values({ adminId, action: 'undo', targetUserId: sub.userId, reason: `#C${id}` }).run();
    await editCard(query, '↩️ Undone', { inline_keyboard: [[
      { text: '✅ Accept', callback_data: `accept:${id}` },
    ], [
      { text: '❌ Reject', callback_data: `reject:${id}` },
      { text: '⚠️ Warn', callback_data: `warn:${id}` },
    ], [
      { text: '⛔ BAN', callback_data: `ban:${id}` },
    ]] });
    await api.answerCallbackQuery({ callback_query_id: query.id, text: ok ? `Undone #C${id}.` : 'Delete failed — remove manually.' });
    try {
      const u = await db.select().from(users).where(eq(users.id, sub.userId)).get();
      if (u) { await verdictDM(u.tgId, sub.userMessageId, L(u).undoRemoved(id)); await bumpOut(); }
    } catch {}
    return;
  }

  // ---- Warn → reason picker → apply ----
  if (data.startsWith('warn:') && !data.startsWith('warnreason:')) {
    const id = data.slice(5);
    try {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        reply_markup: warnReasonMarkup(id),
      });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Pick a warn reason.' });
    return;
  }
  // ---- Warn reason picked → review (confirm step, alert popup) ----
  if (data.startsWith('warnreason:')) {
    const [, idStr, key] = data.split(':');
    const id = cid(idStr);
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get();
    if (!sub || (sub.status !== 'pending' && sub.status !== 'warned' && sub.status !== 'approved-undone' && sub.status !== 'queued')) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already handled — see card.' });
      return;
    }
    const u = await db.select().from(users).where(eq(users.id, sub.userId)).get();
    const tier = WARN_TIERS[key] ?? 'ringan';
    const { light, medium } = u ? await warnCounts(u.id) : { light: 0, medium: 0 };
    let effect;
    if (tier === 'berat') effect = 'instant forever ban, no warning, no appeal';
    else if (tier === 'ringan') {
      const n = light + 1;
      effect = n <= 1 ? 'warn only (1/3)' : n === 2 ? `warn + auto ${RINGAN_SECOND_BAN_DAYS}d ban (2/3)` : 'warn + forever ban (3/3)';
    } else {
      const n = medium + 1;
      effect = n <= 1 ? `warn + auto ${SEDERHANA_BAN_DAYS}d ban (1/2)` : 'warn + forever ban (2/2)';
    }
    try {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        reply_markup: { inline_keyboard: [[
          { text: 'Confirm warn', callback_data: `warnapply:${idStr}:${key}` },
          { text: '‹ Back', callback_data: `warnback:${idStr}` },
        ]] },
      });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: `#C${id} · ${key} (${tier}) · L${light} M${medium}\n${effect}`, show_alert: true });
    return;
  }
  if (data.startsWith('warnback:')) {
    const id = data.slice(9);
    try {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        reply_markup: warnReasonMarkup(id),
      });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Back.' });
    return;
  }
  if (data.startsWith('warnapply:')) {
    const [, idStr, key] = data.split(':');
    const id = cid(idStr);
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get();
    if (!sub || (sub.status !== 'pending' && sub.status !== 'warned' && sub.status !== 'approved-undone' && sub.status !== 'queued')) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already handled — see card.' });
      return;
    }
    const u = await db.select().from(users).where(eq(users.id, sub.userId)).get();
    const tier = WARN_TIERS[key] ?? 'ringan';
    const days = (n) => new Date(Date.now() + n * 86400000);

    // Berat: no warning per terms — instant permanent ban, not appealable.
    if (tier === 'berat') {
      if (u) await db.update(users).set({ banned: 1, banReason: key, bannedUntil: null }).where(eq(users.id, u.id)).run();
      await db.insert(audit).values({ adminId, action: 'ban', targetUserId: sub.userId, reason: `#C${id} forever · ${key} (berat, no appeal)` }).run();
      await editCard(query, `🚫 Banned forever (${key} · berat)`, { inline_keyboard: [] });
      await api.answerCallbackQuery({ callback_query_id: query.id, text: `Banned forever (${key}).` });
      try {
        if (u) { await verdictDM(u.tgId, sub.userMessageId, `You have been banned forever. Goodbye.\nReason: ${key} (berat)\nNot appealable per channel rules.`); await bumpOut(); }
      } catch {}
      return;
    }

    // Ringan / sederhana: warn (+ escalating auto-ban), appealable.
    const { light, medium } = u ? await warnCounts(u.id) : { light: 0, medium: 0 };
    let line, dm, banUntil = undefined;
    if (tier === 'ringan') {
      const n = light + 1;
      if (u) await db.update(users).set({ warnLight: (u.warnLight ?? 0) + 1, warnCount: (u.warnCount ?? 0) + 1 }).where(eq(users.id, u.id)).run();
      if (n <= 1) {
        line = `⚠️ Warned (${key} · ringan 1/3)`;
        dm = `Amaran (ringan) for #C${id}.\nReason: ${key}\nNext offence → temporary ban. Appeals: ${APPEAL_CONTACT}`;
      } else if (n === 2) {
        banUntil = days(RINGAN_SECOND_BAN_DAYS);
        line = `🚫 Auto-banned ${fmtUntil(banUntil)} (${key} · ringan 2/3)`;
        dm = banNotice(banUntil, `${key} (ringan, 2nd offence)`, true);
      } else {
        banUntil = null;
        line = `🚫 Banned forever (${key} · ringan 3/3)`;
        dm = banNotice(null, `${key} (ringan, 3rd offence)`, true);
      }
    } else {
      const n = medium + 1;
      if (u) await db.update(users).set({ warnMedium: (u.warnMedium ?? 0) + 1, warnCount: (u.warnCount ?? 0) + 1 }).where(eq(users.id, u.id)).run();
      if (n <= 1) {
        banUntil = days(SEDERHANA_BAN_DAYS);
        line = `⚠️ Warned + auto-banned ${fmtUntil(banUntil)} (${key} · sederhana 1/2)`;
        dm = banNotice(banUntil, `${key} (sederhana, 1st offence)`, true);
      } else {
        banUntil = null;
        line = `🚫 Banned forever (${key} · sederhana 2/2)`;
        dm = banNotice(null, `${key} (sederhana, 2nd offence)`, true);
      }
    }
    await db.update(submissions).set({ status: 'warned' }).where(eq(submissions.id, id)).run();
    await db.insert(audit).values({ adminId, action: 'warn', targetUserId: sub.userId, reason: `#C${id} · ${key} (${tier})` }).run();
    if (banUntil !== undefined && u) {
      await db.update(users).set({ banned: 1, banReason: key, bannedUntil: banUntil }).where(eq(users.id, u.id)).run();
      await db.insert(audit).values({ adminId, action: 'ban', targetUserId: sub.userId, reason: `#C${id} ${fmtUntil(banUntil)} · ${key} (auto, ${tier})` }).run();
    }
    await editCard(query, line, { inline_keyboard: [] });
    await api.answerCallbackQuery({ callback_query_id: query.id, text: banUntil !== undefined ? `Warned + banned (${key}).` : `Warned #C${id} (${key}).` });
    try {
      if (u) {
        // ⚠️ on the staged message mirrors Reject's 👎 (best-effort).
        try {
          if (sub.userMessageId) await api.setMessageReaction({ chat_id: u.tgId, message_id: sub.userMessageId, reaction: [{ type: 'emoji', emoji: '⚠️' }] });
        } catch {}
        await verdictDM(u.tgId, sub.userMessageId, dm); await bumpOut();
      }
    } catch {}
    return;
  }

  // ---- Ban → duration → reason (submission-scoped, no raw tg_id) ----
  if ((data.startsWith('ban:') && !data.startsWith('bandur:') && !data.startsWith('banreason:'))) {
    const id = data.slice(4);
    try {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        reply_markup: { inline_keyboard: [[
          { text: '3d', callback_data: `bandur:${id}:3d` },
          { text: '7d', callback_data: `bandur:${id}:7d` },
          { text: '14d', callback_data: `bandur:${id}:14d` },
        ], [
          { text: '30d', callback_data: `bandur:${id}:30d` },
          { text: 'Forever', callback_data: `bandur:${id}:forever` },
        ], [
          { text: '‹ Back', callback_data: `back:${id}` },
        ]] },
      });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Pick ban duration. Custom: reply /ban YYYY-MM-DD reason' });
    return;
  }

  // Back → main Accept/Reject/Warn/Ban row.
  if (data.startsWith('back:')) {
    const id = data.slice(5);
    try {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        reply_markup: { inline_keyboard: [[
          { text: '✅ Accept', callback_data: `accept:${id}` },
        ], [
          { text: '❌ Reject', callback_data: `reject:${id}` },
          { text: '⚠️ Warn', callback_data: `warn:${id}` },
        ], [
          { text: '⛔ BAN', callback_data: `ban:${id}` },
        ]] },
      });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Back.' });
    return;
  }

  // Back → duration picker (from the ban reason step).
  if (data.startsWith('banback:')) {
    const id = data.slice(8);
    try {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        reply_markup: { inline_keyboard: [[
          { text: '3d', callback_data: `bandur:${id}:3d` },
          { text: '7d', callback_data: `bandur:${id}:7d` },
          { text: '14d', callback_data: `bandur:${id}:14d` },
        ], [
          { text: '30d', callback_data: `bandur:${id}:30d` },
          { text: 'Forever', callback_data: `bandur:${id}:forever` },
        ], [
          { text: '‹ Back', callback_data: `back:${id}` },
        ]] },
      });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Back.' });
    return;
  }
  if (data.startsWith('bandur:')) {
    const [, id, dur] = data.split(':');
    try {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        reply_markup: banReasonMarkup(id, dur),
      });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: `Duration ${dur} — now pick a reason.` });
    return;
  }
  // ---- Ban reason picked → review (confirm step, alert popup) ----
  if (data.startsWith('banreason:')) {
    const [, idStr, dur, key] = data.split(':');
    const id = cid(idStr);
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get();
    if (!sub) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Gone.' });
      return;
    }
    const tier = WARN_TIERS[key] ?? 'ringan';
    try {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        reply_markup: { inline_keyboard: [[
          { text: 'Confirm ban', callback_data: `banapply:${idStr}:${dur}:${key}` },
          { text: '‹ Back', callback_data: `banreasonback:${idStr}:${dur}` },
        ]] },
      });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: `#C${id} · ${dur} · ${key} (${tier})\nEffect: block ${fmtUntil(durToUntil(dur))}`, show_alert: true });
    return;
  }
  if (data.startsWith('banreasonback:')) {
    const [, id, dur] = data.split(':');
    try {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        reply_markup: banReasonMarkup(id, dur),
      });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Back.' });
    return;
  }
  if (data.startsWith('banapply:')) {
    const [, idStr, dur, key] = data.split(':');
    const id = cid(idStr);
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get();
    if (!sub) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Gone.' });
      return;
    }
    const u = await db.select().from(users).where(eq(users.id, sub.userId)).get();
    const until = durToUntil(dur);
    const appealable = (WARN_TIERS[key] ?? 'ringan') !== 'berat';
    if (u) await db.update(users).set({ banned: 1, banReason: key, bannedUntil: until }).where(eq(users.id, u.id)).run();
    await db.insert(audit).values({ adminId, action: 'ban', targetUserId: sub.userId, reason: `#C${id} ${fmtUntil(until)} · ${key}` }).run();
    await editCard(query, `🚫 Banned ${fmtUntil(until)} (${key})`, { inline_keyboard: [] });
    await api.answerCallbackQuery({ callback_query_id: query.id, text: `Banned ${fmtUntil(until)} (${key}).` });
    try {
      const threadId = query.message?.message_thread_id;
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...(threadId ? { message_thread_id: threadId } : {}), text: `#C${id} → banned ${u ? await cardWho(u) : ''} ${fmtUntil(until)} — ${key}` });
    } catch {}
    try {
      if (u) { await verdictDM(u.tgId, sub.userMessageId, banNotice(until, key, appealable)); await bumpOut(); }
    } catch {}
    return;
  }

  // ---- Reject: decline without warning (no count, no ban) ----
  if (data.startsWith('reject:')) {
    const id = cid(data.slice(7));
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
    if (!sub || (sub.status !== 'pending' && sub.status !== 'warned' && sub.status !== 'queued') || sub.mediaKind === 'report') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already handled — see card.' });
      return;
    }
    try {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id, message_id: query.message.message_id,
        reply_markup: { inline_keyboard: [[
          { text: '❌ Peraturan', callback_data: `rejreason:${id}:rules` },
          { text: '❌ Format', callback_data: `rejreason:${id}:format` },
        ], [
          { text: '❌ FAQ', callback_data: `rejreason:${id}:faq` },
          { text: '✍️ Custom', callback_data: `rejcustom:${id}` },
        ], [
          { text: 'Reject tanpa sebab', callback_data: `rejectnow:${id}` },
        ]] },
      });
    } catch {}
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Pick a reason.' });
    return;
  }
  if (data.startsWith('rejreason:')) {
    const [, idStr, key] = data.split(':');
    if (!['rules', 'format', 'faq'].includes(key)) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Unknown reason.' });
      return;
    }
    await finishReject(query, adminId, cid(idStr), key);
    return;
  }
  if (data.startsWith('rejectnow:')) {
    await finishReject(query, adminId, cid(data.split(':')[1]), null);
    return;
  }
  if (data.startsWith('rejcustom:')) {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Reply to the card with /msg <reason>.' });
    try {
      await api.sendMessage({ chat_id: query.message.chat.id, text: '✍️ Reply to this card with /msg <reason> — your text goes to the author as a DM.' });
    } catch {}
    return;
  }

  // ---- Reports: remove = delete the reported post, dismiss = collapse ----
  if (data.startsWith('report_remove:') || data.startsWith('report_dismiss:')) {
    const isRemove = data.startsWith('report_remove:');
    const id = cid(data.split(':')[1]);
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get();
    if (!sub || sub.status !== 'pending' || sub.mediaKind !== 'report') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already handled — see card.' });
      return;
    }
    const reporter = await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
    if (!isRemove) {
      await db.update(submissions).set({ status: 'rejected' }).where(eq(submissions.id, id)).run();
      await db.insert(audit).values({ adminId, action: 'report_dismiss', targetUserId: sub.userId, reason: `#C${id}` }).run();
      await editCard(query, 'Dismissed — no action', { inline_keyboard: [] });
      await api.answerCallbackQuery({ callback_query_id: query.id, text: `Report #C${id} dismissed.` });
      try {
        if (reporter) await verdictDM(reporter.tgId, sub.userMessageId, L(reporter).reportDismissed(id));
      } catch {}
      return;
    }
    let ok = true;
    if (sub.refMsgId) {
      try {
        await api.deleteMessage({ chat_id: CHANNEL_ID, message_id: sub.refMsgId });
      } catch {
        ok = false;
        try {
          await api.editMessageText({ chat_id: CHANNEL_ID, message_id: sub.refMsgId, text: '[removed by mods]' });
          ok = true;
        } catch { ok = false; }
      }
    } else {
      ok = false;
    }
    await db.update(submissions).set({ status: 'approved' }).where(eq(submissions.id, id)).run();
    await db.insert(audit).values({ adminId, action: 'report_remove', targetUserId: sub.userId, reason: `#C${id}` }).run();
    await editCard(query, ok ? '🗑️ Removed' : '⚠️ Remove failed — delete manually', { inline_keyboard: [] });
    await api.answerCallbackQuery({ callback_query_id: query.id, text: ok ? `Post removed (#C${id}).` : 'Delete failed — remove manually.' });
    try {
      if (reporter) await verdictDM(reporter.tgId, sub.userMessageId, L(reporter).reportUpheld(id));
    } catch {}
    try {
      if (ok && sub.refId) {
        const orig = await db.select().from(submissions).where(eq(submissions.id, sub.refId)).get().catch(() => null);
        const author = orig ? await db.select().from(users).where(eq(users.id, orig.userId)).get().catch(() => null) : null;
        if (author) await verdictDM(author.tgId, orig.userMessageId, L(author).authorRemoved(sub.refId));
      }
    } catch {}
    return;
  }

  // ---- Edit requests: apply edits the channel post, dismiss collapses ----
  if (data.startsWith('edit_apply:') || data.startsWith('edit_dismiss:')) {
    const isApply = data.startsWith('edit_apply:');
    const id = cid(data.split(':')[1]);
    const ed = await db.select().from(edits).where(eq(edits.id, id)).get().catch(() => null);
    if (!ed || ed.status !== 'pending') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already handled — see card.' });
      return;
    }
    const sub = await db.select().from(submissions).where(eq(submissions.id, ed.submissionId)).get().catch(() => null);
    const chanIds = Array.isArray(sub?.channelMessageIds) ? sub.channelMessageIds : [];
    const author = sub ? await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null) : null;
    if (!isApply) {
      await db.update(edits).set({ status: 'dismissed' }).where(eq(edits.id, id)).run();
      await db.insert(audit).values({ adminId, action: 'edit_dismiss', targetUserId: sub?.userId ?? null, reason: `#C${sub?.id ?? '?'}` }).run();
      await editCard(query, 'Edit dismissed', { inline_keyboard: [] });
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Dismissed.' });
      try {
        if (author) await verdictDM(author.tgId, sub?.userMessageId, L(author).editDismissed(sub?.id ?? '?'));
      } catch {}
      return;
    }
    if (!sub || sub.status !== 'approved' || !chanIds.length) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Nothing to edit — post is gone.' });
      return;
    }
    const editRaw = MASK_CONTACTS ? maskContacts(ed.newText ?? '').masked : (ed.newText ?? '');
    const editCore = PROFANITY_MASK ? censorProfanity(editRaw).censored : editRaw;
    const ek = kindOf(sub);
    const editBase = ek === 'dana' ? danaTag(sub) : (ek && KIND_TAGS[ek] ? KIND_TAGS[ek] : null);
    const editTag0 = editBase ? editBase + (sub?.kindSeq ?? '') : null;
    const editAsk = ek === 'question' && askCatLabel(sub) ? ` · ${askCatLabel(sub)}` : '';
    const editMasked = (editTag0 ? editTag0 + editAsk + '\n\n' : '') + editCore; // tags (+serials) survive edits
    const editAid = author ? await dispAid(author) : null;
    const editNum = `#${chanIds[0]}`; // public post number survives edits
    const editTag = `\n\n${editAid ? editNum + ' · ' + editAid : editNum}`;
    const editSpoiler = (body) => (editAid ? [{ type: 'spoiler', offset: body.length + 2 + editNum.length + 3, length: editAid.length }] : undefined);
    try {
      if (sub.mediaKind === 'text') {
        const body = editMasked.slice(0, 4096 - editTag.length);
        await api.editMessageText({ chat_id: CHANNEL_ID, message_id: chanIds[0], text: body + editTag, ...(editAid ? { entities: editSpoiler(body) } : {}) });
      } else {
        const capBase = editMasked.slice(0, 1024 - editTag.length);
        await api.editMessageCaption({ chat_id: CHANNEL_ID, message_id: chanIds[0], caption: capBase + editTag, ...(editAid ? { caption_entities: editSpoiler(capBase) } : {}) });
      }
    } catch (e) {
      const desc = String(e?.description ?? e?.message ?? e);
      if (/not found|message_id_invalid|message to edit/i.test(desc)) {
        // Post was deleted from the channel by hand — close everything out.
        await db.update(edits).set({ status: 'dismissed' }).where(eq(edits.id, id)).run();
        await db.update(submissions).set({ status: 'approved-undone' }).where(eq(submissions.id, sub.id)).run();
        await db.insert(audit).values({ adminId, action: 'edit_gone', targetUserId: sub.userId, reason: `#C${sub.id}` }).run();
        await editCard(query, 'Post gone from channel', { inline_keyboard: [] });
        await api.answerCallbackQuery({ callback_query_id: query.id, text: T.postDeleted });
        try {
          if (author) await verdictDM(author.tgId, sub.userMessageId, L(author).postGoneNew(sub.id));
        } catch {}
        return;
      }
      await api.answerCallbackQuery({ callback_query_id: query.id, text: T.editTooOld });
      return;
    }
    await db.update(edits).set({ status: 'applied' }).where(eq(edits.id, id)).run();
    if (sub.mediaKind === 'text') await db.update(submissions).set({ text: editMasked }).where(eq(submissions.id, sub.id)).run();
    else await db.update(submissions).set({ caption: editMasked }).where(eq(submissions.id, sub.id)).run();
    await db.insert(audit).values({ adminId, action: 'edit_apply', targetUserId: sub.userId, reason: `#C${sub.id}` }).run();
    await editCard(query, '✏️ Applied', { inline_keyboard: [] });
    await api.answerCallbackQuery({ callback_query_id: query.id, text: `Edit applied (#C${sub.id}).` });
    try {
      if (author) await verdictDM(author.tgId, sub.userMessageId, L(author).editApplied(sub.id));
    } catch {}
    return;
  }

  // ---- User delete requests: apply = remove channel posts, dismiss = keep ----
  if (data.startsWith('del_apply:') || data.startsWith('del_dismiss:')) {
    const isApply = data.startsWith('del_apply:');
    const id = cid(data.split(':')[1]);
    const dd = await db.select().from(deletes).where(eq(deletes.id, id)).get().catch(() => null);
    if (!dd || dd.status !== 'pending') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already handled — see card.' });
      return;
    }
    const sub = await db.select().from(submissions).where(eq(submissions.id, dd.submissionId)).get().catch(() => null);
    const chanIds = Array.isArray(sub?.channelMessageIds) ? sub.channelMessageIds : [];
    const author = sub ? await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null) : null;
    if (!isApply) {
      await db.update(deletes).set({ status: 'dismissed' }).where(eq(deletes.id, id)).run();
      await db.insert(audit).values({ adminId, action: 'del_dismiss', targetUserId: sub?.userId ?? null, reason: `#C${sub?.id ?? '?'}` }).run();
      await editCard(query, 'Delete dismissed', { inline_keyboard: [] });
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Dismissed.' });
      try {
        if (author) await verdictDM(author.tgId, sub?.userMessageId, L(author).delDismissed(sub?.id ?? '?'));
      } catch {}
      return;
    }
    if (!sub || (sub.status !== 'approved' && sub.status !== 'approved-undone') || !chanIds.length) {
      await db.update(deletes).set({ status: 'dismissed' }).where(eq(deletes.id, id)).run();
      await editCard(query, 'Nothing to delete — post is gone', { inline_keyboard: [] });
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Nothing to delete.' });
      return;
    }
    let gone = 0;
    for (const mid of chanIds) {
      try { await api.deleteMessage({ chat_id: CHANNEL_ID, message_id: mid }); gone++; } catch {}
    }
    await db.update(deletes).set({ status: 'applied' }).where(eq(deletes.id, id)).run();
    await db.update(submissions).set({ status: 'approved-undone' }).where(eq(submissions.id, sub.id)).run();
    await db.insert(audit).values({ adminId, action: 'del_apply', targetUserId: sub.userId, reason: `#C${sub.id} msgs:${gone}/${chanIds.length}` }).run();
    await editCard(query, '🗑️ Deleted', { inline_keyboard: [] });
    await api.answerCallbackQuery({ callback_query_id: query.id, text: `Deleted #C${sub.id}.` });
    try {
      if (author) await verdictDM(author.tgId, sub.userMessageId, L(author).delApplied(sub.id));
    } catch {}
    return;
  }

  // ---- Appeals: accept = unban + reset slate, reject = ban stands ----
  if (data.startsWith('appeal_accept:') || data.startsWith('appeal_reject:')) {
    const isAccept = data.startsWith('appeal_accept:');
    const id = cid(data.split(':')[1]);
    const ap = await db.select().from(appeals).where(eq(appeals.id, id)).get();
    if (!ap || ap.status !== 'pending') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already handled — see card.' });
      return;
    }
    const u = await db.select().from(users).where(eq(users.id, ap.userId)).get();
    if (isAccept) {
      if (u) await db.update(users).set({ banned: 0, banReason: null, bannedUntil: null, warnLight: 0, warnMedium: 0 }).where(eq(users.id, u.id)).run();
      await db.update(appeals).set({ status: 'accepted' }).where(eq(appeals.id, id)).run();
      await db.insert(audit).values({ adminId, action: 'appeal_accept', targetUserId: ap.userId, reason: `#A${id}` }).run();
      await editCard(query, '✅ Appeal accepted (unbanned)', { inline_keyboard: [] });
      await api.answerCallbackQuery({ callback_query_id: query.id, text: `Appeal #A${id} accepted.` });
      try {
        if (u) { await api.sendMessage({ chat_id: u.tgId, text: L(u).appealOk(id) }); await bumpOut(); }
      } catch {}
    } else {
      await db.update(appeals).set({ status: 'rejected' }).where(eq(appeals.id, id)).run();
      await db.insert(audit).values({ adminId, action: 'appeal_reject', targetUserId: ap.userId, reason: `#A${id}` }).run();
      await editCard(query, '❌ Appeal rejected (ban stands)', { inline_keyboard: [] });
      await api.answerCallbackQuery({ callback_query_id: query.id, text: `Appeal #A${id} rejected.` });
      try {
        if (u) { await api.sendMessage({ chat_id: u.tgId, text: L(u).appealNo(id) }); await bumpOut(); }
      } catch {}
    }
    return;
  }

  // Legacy per-user cards (close:/old ban:) — retired shape.
  if (data.startsWith('close:') || (data.startsWith('ban:') && data.includes('@'))) {
    await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Old card — resubmit.' });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Unknown button.' });
}

export default guarded(handle);
