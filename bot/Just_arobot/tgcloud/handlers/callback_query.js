import { db, api } from 'sdk';
import { eq, and, sql } from 'sdk/db';
import { users, submissions, audit, appeals, pendingIntents, edits } from '../schema.js';
import { guarded } from '../lib/errors.js';
import { isAdmin } from '../lib/admins.js';
import { banNotice, warnCounts, whoOf, aidOf, channelPostLink, publishToChannel, postDue, queuePos, flushQueue, maskContacts, kindOf, KIND_TAGS, tapAllowed } from '../lib/moderation.js';
import { STR, L } from '../lib/strings.js';
import { submitConfession, confirmSubmission, openChatSession, sendStart, sendMenu, chatOpenFor, listPage } from './message.js';
import { ADMIN_GROUP_ID, INBOX_TOPIC_ID, CHANNEL_ID, ADMIN_IDS, EXEMPT_IDS, WARN_TIERS, RINGAN_SECOND_BAN_DAYS, SEDERHANA_BAN_DAYS, APPEAL_CONTACT, DRIP_FEED, MASK_CONTACTS, LANG } from '../lib/config.js';

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
function handledEdit(oldText, line, admin) {
  const name = [admin?.first_name, admin?.last_name].filter(Boolean).join(' ') || 'admin';
  const base = (oldText ?? '').slice(0, 3000);
  const prefix = `${base}\n${line} by `;
  return {
    text: prefix + name,
    entities: [{ type: 'text_mention', offset: prefix.length, length: name.length, user: { id: admin.id, first_name: admin.first_name ?? name } }],
  };
}

async function editCard(query, line, buttons, linkUrl = null) {
  const ed = handledEdit(query.message?.text, line, query.from);
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
async function sendPublishedDM(tgId, subId, isRepublish, postUrl, lang) {
  const T = STR[lang ?? LANG] ?? STR.ms;
  const head = T.publishedHead(subId, isRepublish);
  const label = 'see the post';
  const text = `${head}\n${label}`;
  try {
    await api.sendMessage({ chat_id: tgId, text, entities: [{ type: 'text_link', offset: text.length - label.length, length: label.length, url: postUrl }] });
  } catch {
    await api.sendMessage({ chat_id: tgId, text: `${head}\n${postUrl}` }).catch(() => {});
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
const STATE_KIND = { awaiting_reply: 'reply', awaiting_question: 'question', awaiting_lost: 'lost', awaiting_found: 'found' };
const stateName = (s, t) => t.draftNames[STATE_KIND[s]] ?? s;

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
  const LOCKED_TAPS = ['fwd_reply:', 'fwd_report:', 'reportreason:', 'send_conf', 'ask_q', 'lostfound', 'lost_new', 'found_new'];
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
      const othersF = await db.all(sql`SELECT state FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_question','awaiting_lost','awaiting_found')`).catch(() => []);
      await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_question','awaiting_lost','awaiting_found')`).catch(() => {});
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
          text: `🚩 Report on ${pend.postSub ? '#C' + pend.postSub : 'post ' + pend.postMsgId} · 👤 ${await aidOf(owner)} · ${key}`,
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
      await collapsePreview(t.notSent(r.error ?? 'gagal'));
      await api.answerCallbackQuery({ callback_query_id: query.id, text: r.error ?? t.failedRetry });
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
  if (data === 'go_faq' || data === 'go_chat' || data === 'send_conf' || data === 'ask_q' || data === 'lostfound' || data === 'lost_new' || data === 'found_new' || data === 'noop_kind' || data === 'dismiss' || data.startsWith('armcancel:')) {
    if (!query.message || query.message.chat?.id !== query.from.id) {
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
      if (which !== 'question' && which !== 'lostfound') {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.unknownKind });
        return;
      }
      const states = which === 'question' ? ['awaiting_question'] : ['awaiting_lost', 'awaiting_found'];
      const rows = [];
      for (const st of states) {
        const w = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, btnUser?.id ?? -1), eq(pendingIntents.state, st))).get().catch(() => null);
        if (w) rows.push(w);
      }
      if (!rows.length) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: which === 'question' ? t.noDraftQ : t.noDraftLF });
        return;
      }
      for (const w of rows) {
        await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
      }
      try { await api.deleteMessage({ chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch {}
      await api.answerCallbackQuery({ callback_query_id: query.id, text: which === 'question' ? t.qDiscarded : t.lfDiscarded });
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
      try { await api.sendMessage({ chat_id: query.message.chat.id, text: t.sendGuidance, reply_markup: { inline_keyboard: [[{ text: t.tutupBtn, callback_data: 'dismiss' }]] } }); } catch {}
      return;
    }
    if (data === 'ask_q') {
      const owner = await db.select().from(users).where(eq(users.tgId, query.from.id)).get().catch(() => null);
      if (!owner) {
        await api.answerCallbackQuery({ callback_query_id: query.id, text: t.startFirst });
        return;
      }
      const tq = L(owner);
      const othersQ = await db.all(sql`SELECT state FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_lost','awaiting_found')`).catch(() => []);
      await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_lost','awaiting_found')`).catch(() => {});
      await db.delete(pendingIntents).where(and(eq(pendingIntents.userId, owner.id), eq(pendingIntents.state, 'awaiting_question'))).run().catch(() => {});
      const diedQ = [...new Set((othersQ ?? []).map((r) => stateName(r.state, tq)))];
      const switchQ = diedQ.length ? `\n${tq.armSwitched(diedQ.join(', '))}` : '';
      let armQ = null;
      try {
        const m = await api.sendMessage({ chat_id: query.message.chat.id, text: tq.askArm + switchQ, reply_markup: { inline_keyboard: [[{ text: tq.cancelBtn, callback_data: 'armcancel:question' }]] } });
        armQ = m?.message_id ?? null;
      } catch {}
      await db.insert(pendingIntents).values({ userId: owner.id, state: 'awaiting_question', kind: 'question', srcMsgId: armQ }).run().catch(() => {});
      await api.answerCallbackQuery({ callback_query_id: query.id, text: t.sendQ });
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
      const othersL = await db.all(sql`SELECT state FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_question','awaiting_lost','awaiting_found')`).catch(() => []);
      await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state IN ('awaiting_reply','awaiting_question','awaiting_lost','awaiting_found')`).catch(() => {});
      const diedL = [...new Set((othersL ?? []).map((r) => stateName(r.state, tl)).filter((n) => n !== tl.draftNames[lk]))];
      const switchL = diedL.length ? `\n${tl.armSwitched(diedL.join(', '))}` : '';
      const armText = (lk === 'lost' ? tl.lostArm : tl.foundArm) + switchL;
      let armL = null;
      try {
        const m = await api.sendMessage({ chat_id: query.message.chat.id, text: armText, reply_markup: { inline_keyboard: [[{ text: tl.cancelBtn, callback_data: 'armcancel:lostfound' }]] } });
        armL = m?.message_id ?? null;
      } catch {}
      await db.insert(pendingIntents).values({ userId: owner.id, state: st, kind: lk, srcMsgId: armL }).run().catch(() => {});
      await api.answerCallbackQuery({ callback_query_id: query.id, text: lk === 'lost' ? t.describeLost : t.describeFound });
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
    if (kk && kk !== 'confession' && seq == null) {
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
          { text: 'Accept', callback_data: `accept:${id}` },
          { text: 'Reject', callback_data: `reject:${id}` },
        ], [
          { text: 'Warn', callback_data: `warn:${id}` },
          { text: 'Ban', callback_data: `ban:${id}` },
        ]] });
        await api.answerCallbackQuery({ callback_query_id: query.id, text: `Queued #C${id} (#${pos}).` });
        try {
          if (userRow) await api.sendMessage({ chat_id: userRow.tgId, text: t.queuedHead(id, pos, when) });
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
    await editCard(query, (isRepublish ? '🔁 Republished' : '✅ Accepted') + seqLabel, { inline_keyboard: [[{ text: 'Undo', callback_data: `undo:${id}` }]] }, postUrl);
    await api.answerCallbackQuery({ callback_query_id: query.id, text: isRepublish ? `Republished #C${id}.` : `Published #C${id}.` });
    try {
      if (userRow && postUrl) await sendPublishedDM(userRow.tgId, id, isRepublish, postUrl, userRow.lang);
      else if (userRow) await api.sendMessage({ chat_id: userRow.tgId, text: T.publishedHead(id, isRepublish) });
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
      { text: 'Accept', callback_data: `accept:${id}` },
      { text: 'Reject', callback_data: `reject:${id}` },
    ], [
      { text: 'Warn', callback_data: `warn:${id}` },
      { text: 'Ban', callback_data: `ban:${id}` },
    ]] });
    await api.answerCallbackQuery({ callback_query_id: query.id, text: ok ? `Undone #C${id}.` : 'Delete failed — remove manually.' });
    try {
      const u = await db.select().from(users).where(eq(users.id, sub.userId)).get();
      if (u) await api.sendMessage({ chat_id: u.tgId, text: L(u).undoRemoved(id) });
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
        if (u) await api.sendMessage({ chat_id: u.tgId, text: `You have been banned forever. Goodbye.\nReason: ${key} (berat)\nNot appealable per channel rules.` });
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
      if (u) await api.sendMessage({ chat_id: u.tgId, text: dm });
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
          { text: 'Accept', callback_data: `accept:${id}` },
          { text: 'Reject', callback_data: `reject:${id}` },
        ], [
          { text: 'Warn', callback_data: `warn:${id}` },
          { text: 'Ban', callback_data: `ban:${id}` },
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
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...(threadId ? { message_thread_id: threadId } : {}), text: `#C${id} → banned ${u ? await aidOf(u) : ''} ${fmtUntil(until)} — ${key}` });
    } catch {}
    try {
      if (u) await api.sendMessage({ chat_id: u.tgId, text: banNotice(until, key, appealable) });
    } catch {}
    return;
  }

  // ---- Reject: decline without warning (no count, no ban) ----
  if (data.startsWith('reject:')) {
    const id = cid(data.slice(7));
    const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get();
    if (!sub || (sub.status !== 'pending' && sub.status !== 'warned' && sub.status !== 'queued') || sub.mediaKind === 'report') {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already handled — see card.' });
      return;
    }
    await db.update(submissions).set({ status: 'rejected' }).where(eq(submissions.id, id)).run();
    await db.insert(audit).values({ adminId, action: 'reject', targetUserId: sub.userId, reason: `#C${id}` }).run();
    await editCard(query, 'Rejected — not approved', { inline_keyboard: [] });
    await api.answerCallbackQuery({ callback_query_id: query.id, text: `Rejected #C${id}.` });
    try {
      const u = await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
      if (u) {
        // Community language: 👎 on the user's own message means rejected.
        try {
          if (sub.userMessageId) await api.setMessageReaction({ chat_id: u.tgId, message_id: sub.userMessageId, reaction: [{ type: 'emoji', emoji: '👎' }] });
        } catch {}
        await api.sendMessage({ chat_id: u.tgId, text: L(u).rejectUser(id) });
      }
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
        if (reporter) await api.sendMessage({ chat_id: reporter.tgId, text: L(reporter).reportDismissed(id) });
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
      if (reporter) await api.sendMessage({ chat_id: reporter.tgId, text: L(reporter).reportUpheld(id) });
    } catch {}
    try {
      if (ok && sub.refId) {
        const orig = await db.select().from(submissions).where(eq(submissions.id, sub.refId)).get().catch(() => null);
        const author = orig ? await db.select().from(users).where(eq(users.id, orig.userId)).get().catch(() => null) : null;
        if (author) await api.sendMessage({ chat_id: author.tgId, text: L(author).authorRemoved(sub.refId) });
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
        if (author) await api.sendMessage({ chat_id: author.tgId, text: L(author).editDismissed(sub?.id ?? '?') });
      } catch {}
      return;
    }
    if (!sub || sub.status !== 'approved' || !chanIds.length) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Nothing to edit — post is gone.' });
      return;
    }
    const editCore = MASK_CONTACTS ? maskContacts(ed.newText ?? '').masked : (ed.newText ?? '');
    const ek = kindOf(sub);
    const editMasked = (ek && KIND_TAGS[ek] ? KIND_TAGS[ek] + (sub?.kindSeq ?? '') + '\n\n' : '') + editCore; // tags (+serials) survive edits
    const editAid = author ? await aidOf(author) : null;
    const editTag = editAid ? `\n\n${editAid}` : '';
    const editSpoiler = (body) => (editAid ? [{ type: 'spoiler', offset: body.length + 2, length: editAid.length }] : undefined);
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
          if (author) await api.sendMessage({ chat_id: author.tgId, text: L(author).postGoneNew(sub.id) });
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
      if (author) await api.sendMessage({ chat_id: author.tgId, text: L(author).editApplied(sub.id) });
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
        if (u) await api.sendMessage({ chat_id: u.tgId, text: L(u).appealOk(id) });
      } catch {}
    } else {
      await db.update(appeals).set({ status: 'rejected' }).where(eq(appeals.id, id)).run();
      await db.insert(audit).values({ adminId, action: 'appeal_reject', targetUserId: ap.userId, reason: `#A${id}` }).run();
      await editCard(query, '❌ Appeal rejected (ban stands)', { inline_keyboard: [] });
      await api.answerCallbackQuery({ callback_query_id: query.id, text: `Appeal #A${id} rejected.` });
      try {
        if (u) await api.sendMessage({ chat_id: u.tgId, text: L(u).appealNo(id) });
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
