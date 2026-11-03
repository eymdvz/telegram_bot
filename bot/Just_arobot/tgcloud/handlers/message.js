import { db, api } from 'sdk';
import { eq, and, desc, lt, sql } from 'sdk/db';
import { users, submissions, parts, audit, replyMap, appeals, pendingIntents, edits, sessions, chatMap, claims, hits } from '../schema.js';
import { guarded } from '../lib/errors.js';
import {
  ADMIN_GROUP_ID, INBOX_TOPIC_ID, CHANNEL_ID,
  ADMIN_IDS, SUPER_ADMIN_ID, MAX_ALBUM, ALBUM_WINDOW_MS,
  DAILY_MEDIA_LIMIT, TEXT_HOURLY_LIMIT, EXEMPT_IDS, TERMS_URL, WARN_TIERS, APPEAL_CONTACT,
  ADMIN_CHAT_TOPIC_ID, MAX_OPEN_SESSIONS, SESSION_IDLE_MIN, CHAT_SLOWMODE_SEC,
  MASK_CONTACTS, TEXT_LIMITS, DRIP_FEED, CHANNEL_URL, BURST_MSG_LIMIT, BURST_WINDOW_SEC, LANG,
} from '../lib/config.js';

// Confession-to-channel v1. Single inbox topic, anonymous cards (#C + alias).
// Plan: .opencode/plan/just_arobot-confession-v1.md

async function ensureUser(msg) {
  const tgId = msg.from?.id;
  if (!tgId) return null;
  // No alias stamped here — A-ids assign lazily via aidOf (unique, retry-safe).
  await db.insert(users)
    .values({ tgId, username: msg.from?.username ?? null })
    .onConflictDoNothing({ target: users.tgId })
    .run();
  const row = await db.select().from(users).where(eq(users.tgId, tgId)).get();
  if (row && (msg.from?.username ?? null) !== row.username) {
    await db.update(users).set({ username: msg.from?.username ?? null }).where(eq(users.id, row.id)).run();
  }
  return row;
}

function fmtUntil(until) {
  if (!until) return 'forever';
  const d = until instanceof Date ? until : new Date(until);
  return 'until ' + d.toISOString().slice(0, 10);
}

function parseBanArgs(argStr) {
  const s = (argStr || '').trim();
  if (!s) return { until: null, reason: 'no reason' };
  const ps = s.split(/\s+/);
  const head = ps[0].toLowerCase();
  let until = null;
  let matched = false;
  if (/^(forever|permanent|never|inf|infinite)$/.test(head)) { matched = true; until = null; }
  else if (/^(\d+)d$/i.test(head)) { matched = true; until = new Date(Date.now() + Number(head.match(/^(\d+)d$/i)[1]) * 86400000); }
  else if (/^\d+$/.test(head)) { matched = true; until = new Date(Date.now() + Number(head) * 86400000); }
  else if (/^\d{4}-\d{2}-\d{2}$/.test(head)) {
    matched = true;
    until = new Date(head + 'T00:00:00Z');
    if (isNaN(until.getTime())) until = null;
  }
  return { until, reason: matched ? (ps.slice(1).join(' ').trim() || 'no reason') : s };
}

export async function checkBan(userRow) {
  if (!userRow?.banned) return { blocked: null, justExpired: false };
  if (!userRow.bannedUntil) return { blocked: 'forever', justExpired: false };
  const until = userRow.bannedUntil instanceof Date ? userRow.bannedUntil : new Date(userRow.bannedUntil);
  if (until.getTime() <= Date.now()) {
    await db.update(users).set({ banned: 0, banReason: null, bannedUntil: null }).where(eq(users.id, userRow.id)).run();
    return { blocked: null, justExpired: true };
  }
  return { blocked: fmtUntil(until), justExpired: false };
}

import { isAdmin } from '../lib/admins.js';
import { banNotice, warnCounts, whoOf, aidOf, maskContacts, textAllowed, flushQueue, queuedCount, kindOf, KIND_TAGS, KIND_CARDS, detectIntent } from '../lib/moderation.js';
import { STR, L } from '../lib/strings.js';

// General topic (id 1) takes NO message_thread_id — passing 1 throws
// "Bad Request: message thread not found". Dedicated topics pass it normally.
const inboxThread = () => (INBOX_TOPIC_ID === 1 ? {} : { message_thread_id: INBOX_TOPIC_ID });
const threadOrInbox = (t) => {
  const id = t ?? INBOX_TOPIC_ID;
  return id === 1 ? {} : { message_thread_id: id };
};

// Command directory (A: role-aware /help texts · C: autocomplete scopes).
const USER_COMMANDS = [
  { command: 'start', description: 'Mula — cara confession berfungsi' },
  { command: 'help', description: 'Lihat semua arahan' },
  { command: 'status', description: 'Hantaran terkini anda' },
  { command: 'cancel', description: 'Tarik balik hantaran pending' },
  { command: 'cancelreply', description: 'Buang draf reply' },
  { command: 'cancelquestion', description: 'Buang draf soalan' },
  { command: 'cancellostfound', description: 'Buang draf lost/found' },
  { command: 'chat', description: 'Berbual dengan admin' },
  { command: 'endadminsession', description: 'Tutup admin chat' },
  { command: 'edit', description: 'Betulkan mesej (reply /edit)' },
  { command: 'appeal', description: 'Rayu ban (/appeal <teks>)' },
  { command: 'mystats', description: 'Jumlah confession anda' },
  { command: 'changelanguage', description: 'Tukar bahasa / Change language' },
];
const ADMIN_COMMANDS = [
  { command: 'help', description: 'Show admin commands' },
  { command: 'stats', description: 'Pending + queued counts' },
  { command: 'flush', description: 'Post oldest queued now' },
  { command: 'ban', description: 'Ban (reply to a card)' },
  { command: 'unban', description: 'Unban (reply or /unban <id>)' },
  { command: 'startchat', description: 'Open chat with a user (Topic 2)' },
  { command: 'unbutton', description: 'Strip keyboards off a post (#C)' },
  { command: 'dbstatus', description: 'Table counts + status mix' },
  { command: 'synccommands', description: 'Refresh autocomplete menus' },
  { command: 'list', description: 'User history by A-id (#C list)' },
];
const adminHelpText = () =>
  '/stats — pending + queued counts\n/flush — post oldest queued now\n/ban — reply to a card: /ban <duration> <reason>\n/unban — reply to a card, or /unban <user id>\n/startchat — reply to a user message, or /startchat <A-id>\n/unbutton — strip keyboards off a post: /unbutton <C-id>\n/dbstatus — table counts + status mix\n/synccommands — refresh autocomplete menus\nTip: swipe-reply on a card to message the user anonymously.';

// Push autocomplete menus: default (users), chat-administrators (mods),
// super-admin DM (users + /who). Run via /synccommands after command changes.
async function syncCommands() {
  const jobs = [
    api.setMyCommands({ commands: USER_COMMANDS }).catch((e) => e),
    api.setMyCommands({ commands: ADMIN_COMMANDS, scope: { type: 'chat_administrators', chat_id: ADMIN_GROUP_ID } }).catch((e) => e),
    api.setMyCommands({ commands: [...USER_COMMANDS, { command: 'who', description: 'Identify a user (super-admin)' }, { command: 'list', description: 'User history (super-admin)' }], scope: { type: 'chat', chat_id: SUPER_ADMIN_ID } }).catch((e) => e),
  ];
  const res = await Promise.all(jobs);
  return res.map((r) => (r === true ? 'ok' : 'FAIL:' + String(r?.description ?? r?.message ?? r).slice(0, 80)));
}

function cardButtons(cId) {
  return { inline_keyboard: [[
    { text: 'Accept', callback_data: `accept:${cId}` },
    { text: 'Reject', callback_data: `reject:${cId}` },
  ], [
    { text: 'Warn', callback_data: `warn:${cId}` },
    { text: 'Ban', callback_data: `ban:${cId}` },
  ]] };
}

function strippedFlags(msg) {
  const flags = [];
  if (msg.forward_origin || msg.forward_from_chat || msg.forward_from_message_id || msg.forward_date) flags.push('forward');
  if (msg.via_bot) flags.push('via_bot');
  if (msg.reply_markup) flags.push('buttons');
  return flags;
}

async function postCard(threadMsgId, sub, who, kindLabel, stripped, tag = null) {
  const stripNote = stripped.length ? `\n(stripped: ${stripped.join(',')})` : '';
  const card = await api.sendMessage({
    chat_id: ADMIN_GROUP_ID,
    ...inboxThread(),
    ...(threadMsgId ? { reply_parameters: { message_id: threadMsgId } } : {}),
    text: `${tag ? tag + '\n' : ''}#C${sub.id} · ${kindLabel} · 👤 ${who}${stripNote}`,
    reply_markup: cardButtons(sub.id),
  });
  await db.update(submissions).set({ inboxCardId: card.message_id }).where(eq(submissions.id, sub.id)).run();
  return card;
}

async function postSingleToInbox(sub, userRow, content, stripped, tag = null) {
  const who = await aidOf(userRow);
  let firstId = null;
  if (content.kind === 'text') {
    const m = await api.sendMessage({
      chat_id: ADMIN_GROUP_ID, ...inboxThread(),
      text: (content.text ?? '').slice(0, 4000) || '(empty)',
    });
    firstId = m.message_id;
    await db.update(submissions).set({ inboxMessageId: firstId }).where(eq(submissions.id, sub.id)).run();
    await postCard(firstId, sub, who, 'text', stripped, tag);
  } else {
    const cap = (content.caption ?? '');
    const short = cap.length <= 1024;
    let m;
    if (content.kind === 'photo') {
      m = await api.sendPhoto({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        photo: content.fileId, ...(short && cap ? { caption: cap.slice(0, 1024) } : {}),
      });
    } else {
      m = await api.sendVideo({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        video: content.fileId, ...(short && cap ? { caption: cap.slice(0, 1024) } : {}),
      });
    }
    firstId = m.message_id;
    await db.update(submissions).set({ inboxMessageId: firstId }).where(eq(submissions.id, sub.id)).run();
    await postCard(short ? firstId : null, sub, who, content.kind + (short ? '' : ' (long caption)'), stripped, tag);
    if (!short) {
      await api.sendMessage({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        text: `Caption for #C${sub.id}:\n${cap.slice(0, 3900)}`,
      });
    }
  }
}

async function flushAlbum(subId) {
  const sub = await db.select().from(submissions).where(eq(submissions.id, subId)).get();
  if (!sub || sub.status !== 'pending-album') return;
  const userRow = await db.select().from(users).where(eq(users.id, sub.userId)).get();
  if (!userRow) return;
  const rows = await db.select().from(parts).where(eq(parts.submissionId, subId)).orderBy(parts.id).all();
  if (!rows.length) {
    await db.update(submissions).set({ status: 'rejected' }).where(eq(submissions.id, subId)).run();
    return;
  }
  const media = rows.slice(0, MAX_ALBUM).map((p, i) => ({
    type: p.type,
    media: p.fileId,
    ...(i === 0 && sub.caption ? { caption: sub.caption.slice(0, 1024) } : {}),
  }));
  try {
    const sent = await api.sendMediaGroup({
      chat_id: ADMIN_GROUP_ID, ...inboxThread(), media,
    });
    const firstId = Array.isArray(sent) ? sent[0]?.message_id : sent?.message_id;
    await db.update(submissions).set({ status: 'pending', inboxMessageId: firstId ?? null, mediaCount: rows.length }).where(eq(submissions.id, subId)).run();
    await postCard(firstId ?? null, sub, await aidOf(userRow), `album (${rows.length})`, []);
    try {
      await api.sendMessage({ chat_id: userRow.tgId, text: `Received (#C${subId}, album of ${rows.length}). Admins will review.` });
    } catch {}
  } catch (e) {
    console.error('album flush failed:', e?.description ?? e?.message ?? e);
    await db.update(submissions).set({ status: 'pending', mediaCount: rows.length }).where(eq(submissions.id, subId)).run();
    await api.sendMessage({
      chat_id: ADMIN_GROUP_ID, ...inboxThread(),
      text: `#C${subId} · album (${rows.length}) · 👤 ${await aidOf(userRow)}\n(flush failed — see logs)`,
      reply_markup: cardButtons(subId),
    });
  }
}

async function flushStaleAlbums() {
  try {
    const cutoff = new Date(Date.now() - ALBUM_WINDOW_MS);
    const stale = await db.select().from(submissions)
      .where(and(eq(submissions.status, 'pending-album'), lt(submissions.created, cutoff)))
      .all();
    for (const s of stale) {
      try { await flushAlbum(s.id); } catch (e) { console.error('flush err', s.id, e?.message ?? e); }
    }
  } catch (e) { console.error('flushStale err:', e?.message ?? e); }
}

// Daily media cap: photo/video submissions per user per rolling 24h (text free).
// EXEMPT_IDS (owner + list) bypass. Rejected/withdrawn submissions don't count.
// Raw SQL on unixepoch(): the created_at column stores unix seconds, so the
// window comparison stays in seconds (no Date-mode conversion involved).
async function mediaAllowed(tgId, userId) {
  if (EXEMPT_IDS.includes(tgId)) return true;
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM submissions WHERE user_id = ${userId} AND created_at > unixepoch() - 86400 AND media_kind IN ('photo', 'video', 'album') AND status != 'rejected' AND status != 'unconfirmed'`).catch(() => ({ c: 0 }));
  return (row?.c ?? 0) < DAILY_MEDIA_LIMIT;
}

function extractContent(msg) {
  if (msg.media_group_id) {
    if (msg.photo?.length) return { kind: msg.video ? 'video' : 'photo', album: true, fileId: msg.video ? msg.video.file_id : msg.photo[msg.photo.length - 1].file_id, caption: msg.caption ?? null, groupId: msg.media_group_id };
    if (msg.video) return { kind: 'video', album: true, fileId: msg.video.file_id, caption: msg.caption ?? null, groupId: msg.media_group_id };
    return { kind: 'unsupported', album: true };
  }
  if (msg.photo?.length) return { kind: 'photo', fileId: msg.photo[msg.photo.length - 1].file_id, caption: msg.caption ?? null };
  if (msg.video) return { kind: 'video', fileId: msg.video.file_id, caption: msg.caption ?? null };
  if (msg.text) return { kind: 'text', text: msg.text };
  if (msg.voice || msg.video_note || msg.sticker || msg.document || msg.audio || msg.animation) return { kind: 'unsupported' };
  return { kind: 'empty' };
}

async function submissionByReply(replyId) {
  if (!replyId) return null;
  let s = await db.select().from(submissions).where(eq(submissions.inboxCardId, replyId)).get().catch(() => null);
  if (s) return s;
  return db.select().from(submissions).where(eq(submissions.inboxMessageId, replyId)).get().catch(() => null);
}

// Shared identity resolver (used by /who + /list): raw id, A-id, legacy
// alias, or #C submission (→ its author).
async function resolveUser(arg) {
  const a = (arg || '').trim().replace(/^#/, '');
  if (!a) return null;
  if (/^C\d+$/i.test(a)) {
    const s = await db.select().from(submissions).where(eq(submissions.id, Number(a.slice(1)))).get().catch(() => null);
    return s ? db.select().from(users).where(eq(users.id, s.userId)).get().catch(() => null) : null;
  }
  if (/^\d+$/.test(a)) return db.select().from(users).where(eq(users.tgId, Number(a))).get().catch(() => null);
  if (/^A\d+$/i.test(a)) return db.select().from(users).where(eq(users.anum, a.toUpperCase())).get().catch(() => null);
  return db.select().from(users).where(eq(users.alias, a)).get().catch(() => null);
}

const PAGE_N = 30;

// Paged history: sections rebuilt per page (`✅ Published (40)` headers stay
// global, items are the page slice). Stateless cursor — recomputed per tap.
export async function listPage(u, page = 0) {
  const rows = await db.select().from(submissions).where(eq(submissions.userId, u.id)).orderBy(submissions.id).all().catch(() => []);
  if (!rows?.length) return { text: 'No submissions.', buttons: null };
  const aid = await aidOf(u).catch(() => '?');
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_N));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = rows.slice(p * PAGE_N, p * PAGE_N + PAGE_N);
  const fmt = (s) => {
    const k = kindOf(s);
    const tag = s.mediaKind === 'report' ? '🚩' : (k && KIND_TAGS[k] ? KIND_TAGS[k] : '');
    return `#C${s.id}${tag}`;
  };
  const reps = rows.filter((r) => r.mediaKind === 'report');
  const core = rows.filter((r) => r.mediaKind !== 'report');
  const buckets = [
    ['✅ Published', ['approved', 'approved-undone']],
    ['⏳ Pending', ['pending', 'pending-album', 'unconfirmed', 'queued', 'publishing']],
    ['⚠️ Warned', ['warned']],
    ['❌ Rejected', ['rejected']],
  ];
  const lines = [`👤 ${aid} — ${total} total (page ${p + 1}/${pages})`];
  if (reps.length) lines.push(`🚩 Reports (${reps.length}): ${slice.filter((r) => r.mediaKind === 'report').map(fmt).join(' ')}`);
  for (const [label, statuses] of buckets) {
    const n = core.filter((r) => statuses.includes(r.status)).length;
    if (!n) continue;
    lines.push(`${label} (${n}): ${slice.filter((r) => r.mediaKind !== 'report' && statuses.includes(r.status)).map(fmt).join(' ')}`);
  }
  const nav = [];
  if (p > 0) nav.push({ text: '‹ Kembali', callback_data: `list_more:${u.id}:${p - 1}` });
  if (p < pages - 1) {
    const a = (p + 1) * PAGE_N + 1;
    const b = Math.min(total, (p + 2) * PAGE_N);
    nav.push({ text: `Seterusnya (${a}–${b}) ›`, callback_data: `list_more:${u.id}:${p + 1}` });
  }
  return { text: lines.join('\n'), buttons: nav.length ? { inline_keyboard: [nav] } : null };
}

async function applyBan(targetUser, adminId, threadId, until, reason) {
  await db.update(users).set({ banned: 1, banReason: reason, bannedUntil: until }).where(eq(users.id, targetUser.id)).run();
  await db.insert(audit).values({ adminId, action: 'ban', targetUserId: targetUser.id, reason: `${fmtUntil(until)} · ${reason}` }).run();
  if (threadId) {
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `Banned ${await aidOf(targetUser)} ${fmtUntil(until)} — ${reason}` });
  }
  try {
    await api.sendMessage({ chat_id: targetUser.tgId, text: banNotice(until, reason, true) });
  } catch {}
}

// Channel post → confession #C (reply threading). Scans posted id arrays;
// pre-map and non-confession posts resolve to null.
async function confessionOfChannelMsg(msgId) {
  const row = await db.get(sql`SELECT s.id AS id FROM submissions s, json_each(s.channel_message_ids) j WHERE j.value = ${msgId}`).catch(() => null);
  return row?.id ?? null;
}

// Shared intake, split in two: stage (preview + Confirm/Cancel, no inbox post)
// and confirmSubmission below (gates re-run, inbox post, ack).
// Used by DM intake and by DM-side forward buttons (imported in callback_query).
// opts: refId/refMsgId (reply threading), silent (caller messages the user itself).
// Returns { sub, error } — error is a user-facing string (also DMed unless silent).
export async function submitConfession({ from, chatId, messageId, content, stripped = [], refId = null, refMsgId = null, silent = false, isQuestion = false, kind = 'confession' }) {
  const say = async (text) => { if (!silent) { try { await api.sendMessage({ chat_id: chatId, text }); } catch {} } };
  const u = await ensureUser({ from });
  if (!u) return { sub: null, error: 'Unknown user.' };
  const T = L(u);
  const fresh = await db.select().from(users).where(eq(users.tgId, from.id)).get();
  const { blocked, justExpired } = await checkBan(fresh);
  if (blocked) {
    const err = T.blocked(blocked);
    await say(err);
    return { sub: null, error: err };
  }
  if (justExpired) await say(T.unblockedPreview);
  // Burst guard: max BURST_MSG_LIMIT staged messages per rolling window (EXEMPT bypass).
  if (!EXEMPT_IDS.includes(from.id)) {
    const b = await db.get(sql`SELECT COUNT(*) AS c FROM submissions WHERE user_id = ${u.id} AND created_at > unixepoch() - ${BURST_WINDOW_SEC}`).catch(() => ({ c: 0 }));
    if ((b?.c ?? 0) >= BURST_MSG_LIMIT) {
      const err = T.burst;
      await say(err);
      return { sub: null, error: err };
    }
  }
  // Contact auto-mask (emails, URLs, @mentions, phone-ish numbers → [hidden]).
  // Stored + previewed masked; card notes it via the stripped flags.
  // Contact auto-mask (kill switch: MASK_CONTACTS).
  if (MASK_CONTACTS && content.text) {
    const m = maskContacts(content.text);
    if (m.n) { content = { ...content, text: m.masked }; stripped = [...stripped, m.n > 1 ? `contact×${m.n}` : 'contact']; }
  }
  if (MASK_CONTACTS && content.caption) {
    const m = maskContacts(content.caption);
    if (m.n) { content = { ...content, caption: m.masked }; stripped = [...stripped, m.n > 1 ? `contact×${m.n}` : 'contact']; }
  }
  // No media-limit check at staging — enforced at confirm time.
  const k = isQuestion ? 'question' : kind;
  let sub;
  try {
    const ins = await db.insert(submissions).values({
      userId: u.id, status: 'unconfirmed', mediaKind: content.kind,
      text: content.kind === 'text' ? (content.text ?? null) : null,
      caption: content.caption ?? null,
      userMessageId: messageId ?? null,
      refId, refMsgId,
      isQuestion: k === 'question' ? 1 : 0,
      kind: k,
    }).returning().run();
    sub = ins[0];
  } catch (e) {
    const err = 'Gagal simpan: ' + String(e?.description ?? e?.message ?? e).slice(0, 160);
    console.error('submit save failed:', e?.description ?? e?.message ?? e);
    await say(err);
    return { sub: null, error: err };
  }
  if (content.kind !== 'text') {
    await db.insert(parts).values({ submissionId: sub.id, type: content.kind, fileId: content.fileId, caption: content.caption ?? null }).run();
  }
  if (stripped.length) {
    await db.insert(audit).values({ adminId: 0, action: 'stripped', targetUserId: u.id, reason: `#C${sub.id}: ${stripped.join(',')}` }).run().catch(() => {});
  }
  // Preview doubles as the ack. Media re-sent with buttons attached (long
  // captions ride a separate text message, same as inbox rules).
  const intent = k === 'confession' ? detectIntent(content.text ?? content.caption ?? '') : null;
  const intentLabel = intent === 'question' ? 'Question' : intent === 'lost' ? 'Lost' : intent === 'found' ? 'Found' : null;
  const buttons = { inline_keyboard: [[
    { text: T.confirmBtn, callback_data: `confirm_${sub.id}` },
    { text: T.cancelBtn, callback_data: `cancelconf_${sub.id}` },
  ], ...(k === 'confession' ? [
    [{ text: T.kindSep, callback_data: 'noop_kind' }],
    [
    { text: '❓ Question', callback_data: `convert_${sub.id}_question` },
    { text: '🔍 Lost', callback_data: `convert_${sub.id}_lost` },
    { text: '📦 Found', callback_data: `convert_${sub.id}_found` },
  ]] : []),
  ...(intent === 'chat' ? [[{ text: '💬 Chat dengan admin', callback_data: 'go_chat' }]] : [])] };
  // Split preview: pure content first, labeled action message after.
  const intentNote = intentLabel ? `\n(Nampak seperti ${intent === 'question' ? 'soalan' : intent === 'lost' ? 'lost' : 'found'} — tekan di bawah untuk post dengan ${KIND_TAGS[intent]}.)` : intent === 'chat' ? '\n(Nak berhubung dengan admin? Tekan di bawah.)' : '';
  const maskNote = stripped.some((s) => s.startsWith('contact')) ? T.maskNote : '';
  const qNote = (KIND_TAGS[k] && k !== 'confession') ? T.kindNote(KIND_TAGS[k]) : '';
  const aTitle = T.preview(sub.id, k);
  const aNotes = `${maskNote}${qNote}${intentNote}`;
  let previewId = null;
  // Action message owns every button (always editable: plain fallback; rich
  // attempt carries the green/red styles).
  const styledMain = [
    { text: T.confirmBtn, callback_data: `confirm_${sub.id}`, style: 'success' },
    { text: T.cancelBtn, callback_data: `cancelconf_${sub.id}`, style: 'danger' },
  ];
  const richAction = [
    { type: 'buttons', align: 'center', buttons: styledMain },
    ...(k === 'confession' ? [
      { type: 'divider' },
      { type: 'table', is_bordered: false, cells: [[{ text: T.kindHint, align: 'center', valign: 'middle' }]] },
      { type: 'buttons', align: 'center', buttons: [
        { text: '❓ Question', callback_data: `convert_${sub.id}_question` },
        { text: '🔍 Lost', callback_data: `convert_${sub.id}_lost` },
        { text: '📦 Found', callback_data: `convert_${sub.id}_found` },
      ] },
    ] : []),
    ...(intent === 'chat' ? [{ type: 'buttons', align: 'center', buttons: [{ text: '💬 Chat dengan admin', callback_data: 'go_chat' }] }] : []),
  ];
  try {
    if (content.kind === 'text') {
      const fullText = (content.text ?? '').slice(0, 1000) || '(empty)';
      try {
        const m = await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [{ type: 'paragraph', text: fullText }] } });
        previewId = m?.message_id ?? null;
      } catch {
        const m = await api.sendMessage({ chat_id: chatId, text: fullText });
        previewId = m?.message_id ?? null;
      }
    } else {
      const cap = (content.caption ?? '');
      if (cap.length <= 900) {
        const capText = cap.slice(0, 900) || '(empty)';
        const mediaBlock = content.kind === 'photo'
          ? { type: 'photo', photo: { type: 'photo', media: content.fileId } }
          : { type: 'video', video: { type: 'video', media: content.fileId } };
        try {
          const m = await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [mediaBlock, { type: 'paragraph', text: capText }] } });
          previewId = m?.message_id ?? null;
        } catch {
          const m = content.kind === 'photo'
            ? await api.sendPhoto({ chat_id: chatId, photo: content.fileId, caption: capText })
            : await api.sendVideo({ chat_id: chatId, video: content.fileId, caption: capText });
          previewId = m?.message_id ?? null;
        }
      } else {
        if (content.kind === 'photo') await api.sendPhoto({ chat_id: chatId, photo: content.fileId });
        else await api.sendVideo({ chat_id: chatId, video: content.fileId });
        const longText = cap.slice(0, 3900);
        try {
          const m = await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [{ type: 'paragraph', text: longText }] } });
          previewId = m?.message_id ?? null;
        } catch {
          const m = await api.sendMessage({ chat_id: chatId, text: longText });
          previewId = m?.message_id ?? null;
        }
      }
    }
    const actionSegs = [T.actionLead + ' ', { type: 'bold', text: aTitle }, ':' + aNotes];
    const actionHtml = `${T.actionLead} <b>${aTitle}</b>:${aNotes}`;
    try {
      await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [{ type: 'paragraph', text: actionSegs }, ...richAction] } });
    } catch {
      await api.sendMessage({ chat_id: chatId, text: actionHtml, parse_mode: 'HTML', reply_markup: buttons });
    }
    await db.update(submissions).set({ previewMsgId: previewId }).where(eq(submissions.id, sub.id)).run().catch(() => {});
  } catch (e) {
    const err = 'Pratonton gagal: ' + String(e?.description ?? e?.message ?? e).slice(0, 160);
    console.error('preview failed:', e?.description ?? e?.message ?? e);
    await say(err);
    return { sub, error: err };
  }
  return { sub, error: null };
}

// Confirm a staged submission: re-run gates, flip to pending, post to inbox.
// Tag/ack recomputed from the stored ref (replies thread correctly).
export async function confirmSubmission(subId, confirmerTgId) {
  const sub = await db.select().from(submissions).where(eq(submissions.id, subId)).get().catch(() => null);
  if (!sub || sub.status !== 'unconfirmed') return { sub: null, error: 'Hilang.' };
  const u = await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
  const T = L(u);
  if (!u || u.tgId !== confirmerTgId) return { sub: null, error: 'Bukan untuk anda.' };
  const { blocked } = await checkBan(u);
  if (blocked) {
    await db.update(submissions).set({ status: 'rejected' }).where(eq(submissions.id, subId)).run();
    return { sub: null, error: `Disekat (${blocked}).` };
  }
  if (sub.mediaKind !== 'text' && !(await mediaAllowed(u.tgId, u.id))) {
    return { sub: null, error: T.mediaLimit };
  }
  if (TEXT_LIMITS && sub.mediaKind === 'text') {
    const tl = await textAllowed(u.tgId, u.id);
    if (!tl.ok) return { sub: null, error: T.textLimit(tl.which) };
  }
  let content;
  if (sub.mediaKind === 'text') {
    content = { kind: 'text', text: sub.text };
  } else {
    const p = await db.select().from(parts).where(eq(parts.submissionId, subId)).orderBy(parts.id).get().catch(() => null);
    if (!p) return { sub: null, error: 'Kandungan hilang — hantar semula.' };
    content = { kind: p.type, fileId: p.fileId, caption: sub.caption };
  }
  await db.update(submissions).set({ status: 'pending' }).where(eq(submissions.id, subId)).run();
  const kConf = kindOf(sub);
  const tag = kConf ? KIND_CARDS[kConf] : ((sub.refId != null || sub.refMsgId != null) ? `↩️ Reply to ${sub.refId ? '#C' + sub.refId : 'post ' + sub.refMsgId}` : null);
  try {
    await postSingleToInbox(sub, u, content, [], tag);
  } catch (e) {
    console.error('inbox post failed:', e?.description ?? e?.message ?? e);
    await db.update(submissions).set({ status: 'rejected' }).where(eq(submissions.id, subId)).run();
    return { sub: null, error: 'Inbox gagal.' };
  }
  try {
    const kk = kConf ?? 'confession';
    await api.sendMessage({ chat_id: u.tgId, text: T.ackHead[kk] + '\n\n' + T.ackWarn + `\n\n(#C${sub.id})` });
  } catch {}
  await sendMenu(u.tgId, T).catch(() => {});
  return { sub, error: null };
}

// Dedicated admin-chat topic (0 = not configured). Same General rule: id 1 → no param.
const chatThread = () => (!ADMIN_CHAT_TOPIC_ID || ADMIN_CHAT_TOPIC_ID === 1 ? {} : { message_thread_id: ADMIN_CHAT_TOPIC_ID });

async function openSessionRow(u) {
  return db.select().from(sessions)
    .where(and(eq(sessions.userId, u.id), eq(sessions.status, 'open')))
    .get().catch(() => null);
}

async function closeSession(userId, closedBy) {
  await db.update(sessions).set({ status: 'closed', closedBy })
    .where(and(eq(sessions.userId, userId), eq(sessions.status, 'open')))
    .run().catch(() => {});
}

// Live open session, or 'expired' (auto-closed), or null.
async function liveSession(u) {
  const s = await openSessionRow(u);
  if (!s) return null;
  const last = s.lastMsgAt ? new Date(s.lastMsgAt).getTime()
    : s.created ? new Date(s.created).getTime() : Date.now();
  if (Date.now() - last > SESSION_IDLE_MIN * 60000) {
    await closeSession(u.id, 0);
    return 'expired';
  }
  return s;
}

// Open (non-expired) chat session for a tg id, or null. Used by the
// session lock (callback taps) — starting another flow mid-chat is refused.
export async function chatOpenFor(tgId) {
  const u = await db.select().from(users).where(eq(users.tgId, tgId)).get().catch(() => null);
  if (!u) return null;
  const s = await liveSession(u);
  return s && s !== 'expired' ? { sess: s, user: u } : null;
}

async function postChatMessage(sess, u, content, dmChatId) {
  const T = L(u);
  const last = sess.lastMsgAt ? new Date(sess.lastMsgAt).getTime() : 0;
  if (Date.now() - last < CHAT_SLOWMODE_SEC * 1000) {
    await api.sendMessage({ chat_id: dmChatId, text: `Slow down — one message per ${Math.round(CHAT_SLOWMODE_SEC / 60)} min in admin chat.` });
    return;
  }
  if (content.kind !== 'text' && !(await mediaAllowed(u.tgId, u.id))) {
    await api.sendMessage({ chat_id: dmChatId, text: T.mediaChatLimit });
    return;
  }
  if (content.kind !== 'text' && content.kind !== 'photo' && content.kind !== 'video') {
    await api.sendMessage({ chat_id: dmChatId, text: T.unsupported });
    return;
  }
  const who = await aidOf(u);
  let postedId = null;
  try {
    if (content.kind === 'text') {
      const m = await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `💬 ${who}:\n${content.text ?? ''}`.slice(0, 4000) });
      postedId = m.message_id;
    } else {
      const cap = `💬 ${who}${content.caption ? '\n' + content.caption : ''}`.slice(0, 1024);
      const m = content.kind === 'photo'
        ? await api.sendPhoto({ chat_id: ADMIN_GROUP_ID, ...chatThread(), photo: content.fileId, caption: cap })
        : await api.sendVideo({ chat_id: ADMIN_GROUP_ID, ...chatThread(), video: content.fileId, caption: cap });
      postedId = m.message_id;
    }
  } catch {
    await api.sendMessage({ chat_id: dmChatId, text: T.chatFailed });
    return;
  }
  if (postedId) {
    await db.insert(chatMap).values({ adminMsgId: postedId, userId: u.id }).onConflictDoNothing().run().catch(() => {});
  }
  await db.update(sessions).set({ lastMsgAt: new Date() }).where(eq(sessions.id, sess.id)).run().catch(() => {});
}

// Strong go_chat (FAQ/Chat buttons): ban gate → busy cap → open + Topic-2 marker.
// Returns user-facing text; the caller DMs it.
export async function openChatSession(from) {
  const u = await ensureUser({ from });
  if (!u) return 'Pengguna tidak diketahui.';
  const T = L(u);
  if (!ADMIN_CHAT_TOPIC_ID) return T.chatNotSetup;
  const fresh = await db.select().from(users).where(eq(users.tgId, from.id)).get();
  const gate = await checkBan(fresh);
  if (gate.blocked) return T.blocked(gate.blocked);
  let sess = await liveSession(u);
  if (sess === 'expired') sess = null;
  if (sess) return T.alreadyOpen;
  const allOpen = await db.select().from(sessions).where(eq(sessions.status, 'open')).all().catch(() => []);
  if (allOpen.filter((s) => s.userId !== u.id).length >= MAX_OPEN_SESSIONS) return T.busy;
  const ins = await db.insert(sessions).values({ userId: u.id, status: 'open' }).returning().run().catch(() => null);
  if (!ins) return 'Could not open chat — try again.';
  try {
    const marker = await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `— 💬 chat opened with ${await aidOf(u)}` });
    if (marker?.message_id) await db.insert(chatMap).values({ adminMsgId: marker.message_id, userId: u.id }).onConflictDoNothing().run().catch(() => {});
  } catch {}
  return T.openChatUser;
}

async function handleChatTopic(msg, text) {
  const T = STR[LANG] ?? STR.ms;
  const sender = msg.from?.id;
  if (msg.from?.is_bot) return;
  const replyId = msg.reply_to_message?.message_id ?? null;
  // Admin opens a chat with a user: reply-context or A-id / raw id.
  // Skips the busy cap (the admin accepts the load); banned users need /unban first.
  if (text.startsWith('/startchat')) {
    if (!(await isAdmin(sender))) return;
    let target = null;
    if (replyId) {
      const m = await db.select().from(chatMap).where(eq(chatMap.adminMsgId, replyId)).get().catch(() => null);
      if (m) target = await db.select().from(users).where(eq(users.id, m.userId)).get().catch(() => null);
      if (!target) {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: 'No such chat.' });
        return;
      }
    } else {
      const arg = text.slice(10).trim().replace(/^#/, '');
      if (/^\d+$/.test(arg)) target = await db.select().from(users).where(eq(users.tgId, Number(arg))).get().catch(() => null);
      else if (/^A\d+$/i.test(arg)) target = await db.select().from(users).where(eq(users.anum, arg.toUpperCase())).get().catch(() => null);
      else {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: 'Usage: /startchat <A-id> — or reply to their message.' });
        return;
      }
      if (!target) {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: 'No such user.' });
        return;
      }
    }
    const gateS = await checkBan(target);
    if (gateS.blocked) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `👤 ${await aidOf(target)} is banned — /unban first.` });
      return;
    }
    if (await openSessionRow(target)) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `Chat already open with ${await aidOf(target)}.` });
      return;
    }
    await db.insert(sessions).values({ userId: target.id, status: 'open' }).run().catch(() => {});
    await db.insert(audit).values({ adminId: sender, action: 'chat_start', targetUserId: target.id }).run().catch(() => {});
    const markerA = await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `— 💬 chat opened with ${await aidOf(target)} (admin)` });
    if (markerA?.message_id) await db.insert(chatMap).values({ adminMsgId: markerA.message_id, userId: target.id }).onConflictDoNothing().run().catch(() => {});
    try { await api.sendMessage({ chat_id: target.tgId, text: L(target).chatOpenedUser }); } catch {}
    return;
  }
  // Admin closes a chat: reply-context or A-id / raw id.
  if (text.startsWith('/endadminsession')) {
    if (!(await isAdmin(sender))) return;
    let target = null;
    if (replyId) {
      const m = await db.select().from(chatMap).where(eq(chatMap.adminMsgId, replyId)).get().catch(() => null);
      if (m) target = await db.select().from(users).where(eq(users.id, m.userId)).get().catch(() => null);
    } else {
      const arg = text.slice(16).trim().replace(/^#/, '');
      if (/^\d+$/.test(arg)) target = await db.select().from(users).where(eq(users.tgId, Number(arg))).get().catch(() => null);
      else if (/^A\d+$/i.test(arg)) target = await db.select().from(users).where(eq(users.anum, arg.toUpperCase())).get().catch(() => null);
      else {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: 'Usage: /endadminsession <A-id> — or reply to their message.' });
        return;
      }
    }
    if (!target) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: 'No such chat.' });
      return;
    }
    await closeSession(target.id, sender);
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `— chat closed with ${await aidOf(target)} (admin)` });
    try { await api.sendMessage({ chat_id: target.tgId, text: L(target).chatClosedUser }); } catch {}
    return;
  }
  if (text.startsWith('/')) return; // topic stays quiet; commands live in General
  // Admin swipe-reply → relay to that user, anonymous + audited.
  if (replyId && text) {
    if (!(await isAdmin(sender))) return;
    const m = await db.select().from(chatMap).where(eq(chatMap.adminMsgId, replyId)).get().catch(() => null);
    if (!m) {
      // Pre-fix opener markers were never mapped — point at a user message instead.
      if (msg.reply_to_message?.from?.is_bot) {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: 'Not linked — reply to one of the user\u2019s messages instead.' }).catch(() => {});
      }
      return;
    }
    const target = await db.select().from(users).where(eq(users.id, m.userId)).get().catch(() => null);
    if (!target) return;
    try {
      await api.sendMessage({ chat_id: target.tgId, text: `${(STR[LANG] ?? STR.ms).adminChatHead}\n${msg.text}`.slice(0, 4000) });
    } catch {
      try {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `👤 ${await aidOf(target)} unreachable — blocked bot or deleted account.` });
      } catch {}
      return;
    }
    await db.insert(audit).values({ adminId: sender, action: 'chat_reply', targetUserId: target.id }).run().catch(() => {});
    return;
  }
  // Plain messages among admins: ignored.
}

async function handleAdminGroup(msg, text) {
  const sender = msg.from?.id;
  const threadId = msg.message_thread_id ?? null;
  await flushQueue(false).catch(() => {}); // drip-feed: release due queued posts (no-op when DRIP_FEED off)
  if (text.startsWith('/stats')) {
    if (!(await isAdmin(sender))) return;
    const rows = await db.select().from(submissions).where(eq(submissions.status, 'pending')).all().catch(() => []);
    const alb = await db.$count(submissions, eq(submissions.status, 'pending-album')).catch(() => 0);
    const q = await queuedCount().catch(() => 0);
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `Pending: ${rows.length} · queued: ${q} · buffering albums: ${alb}` });
    return;
  }
  if (text.startsWith('/dbstatus')) {
    if (!(await isAdmin(sender))) return;
    const tables = { users, submissions, parts, appeals, pendingIntents, edits, sessions, chatMap, replyMap, audit, claims, hits };
    const lines = [];
    for (const [name, tbl] of Object.entries(tables)) {
      lines.push(`${name}: ${await db.$count(tbl).catch(() => '?')}`);
    }
    const byStatus = await db.all(sql`SELECT status, COUNT(*) AS c FROM submissions GROUP BY status`).catch(() => []);
    const edge = await db.get(sql`SELECT MIN(created_at) AS mn, MAX(created_at) AS mx FROM submissions`).catch(() => null);
    const fmtTs = (v) => {
      if (!v && v !== 0) return '—';
      try { return (v instanceof Date ? v : new Date(Number(v) * 1000)).toISOString().slice(0, 10); } catch { return '?'; }
    };
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId),
      text: `🗄️ DB status\n${lines.join('\n')}\n— by status: ${(byStatus ?? []).map((r) => `${r.status}:${r.c}`).join(' ') || '—'}\n— submissions: ${fmtTs(edge?.mn)} → ${fmtTs(edge?.mx)}` });
    return;
  }
  if (text.startsWith('/flush')) {
    if (!(await isAdmin(sender))) return;
    if (!DRIP_FEED) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Drip-feed is off — accepts post immediately.' });
      return;
    }
    const r = await flushQueue(true).catch(() => null);
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: r ? `Flushed ${r.posted} · queued left: ${r.queued}` : 'Flush failed.' });
    return;
  }
  if (text.startsWith('/unbutton')) {
    if (!(await isAdmin(sender))) return;
    const arg = text.slice(10).trim().replace(/^#/, '').replace(/^C/i, '');
    if (!/^\d+$/.test(arg)) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Usage: /unbutton <#C> — clears keyboards on its card + channel posts.' });
      return;
    }
    const s = await db.select().from(submissions).where(eq(submissions.id, Number(arg))).get().catch(() => null);
    if (!s) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'No such submission.' });
      return;
    }
    let n = 0;
    if (s.inboxCardId) {
      try { await api.editMessageReplyMarkup({ chat_id: ADMIN_GROUP_ID, message_id: s.inboxCardId, reply_markup: { inline_keyboard: [] } }); n++; } catch {}
    }
    for (const mid of (Array.isArray(s.channelMessageIds) ? s.channelMessageIds : [])) {
      try { await api.editMessageReplyMarkup({ chat_id: CHANNEL_ID, message_id: mid, reply_markup: { inline_keyboard: [] } }); n++; } catch {}
    }
    await db.insert(audit).values({ adminId: sender, action: 'unbutton', targetUserId: s.userId, reason: `#C${s.id}` }).run().catch(() => {});
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `Stripped ${n} keyboard(s) (#C${s.id}).` });
    return;
  }
  if (text.startsWith('/list')) {
    if (!(await isAdmin(sender))) return;
    const u = await resolveUser(text.slice(5).trim());
    if (!u) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'No such user — /list <A-id> (e.g. /list A0003).' });
      return;
    }
    const pg = await listPage(u, 0);
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: pg.text, ...(pg.buttons ? { reply_markup: pg.buttons } : {}) });
    return;
  }
  if (text.startsWith('/who')) {
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Use the bot DM (super-admin only).' });
    return;
  }
  if (text.startsWith('/help')) {
    if (!(await isAdmin(sender))) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Admins only.' });
      return;
    }
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: adminHelpText() });
    return;
  }
  if (text.startsWith('/synccommands')) {
    if (!(await isAdmin(sender))) return;
    const r = await syncCommands();
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `Commands synced [default/admin/dm]: ${r.join(' / ')}` });
    return;
  }
  if (text.startsWith('/richprobe')) {
    if (!(await isAdmin(sender))) return;
    let out;
    try {
      if (typeof api.sendRichMessage !== 'function') out = 'no sendRichMessage on api';
      else {
        const m = await api.sendRichMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), rich_message: { html: '<p>Rich probe — tap the button.</p><tg-button-row align="center"><tg-button type="callback_data" data="richprobe_ok">Tap me</tg-button></tg-button-row>' } });
        out = 'sent id ' + (m?.message_id ?? JSON.stringify(m).slice(0, 80));
      }
    } catch (e) { out = 'FAIL: ' + String(e?.description ?? e?.message ?? e).slice(0, 160); }
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `Rich probe: ${out}` });
    return;
  }
  // Mod commands: /ban (reply-to-card) and /unban (reply-to-card or <user id>).
  const replyId = msg.reply_to_message?.message_id ?? null;
  if (text.startsWith('/ban') || text.startsWith('/unban')) {
    if (!(await isAdmin(sender))) return;
    let target = null;
    if (replyId) {
      const sub = await submissionByReply(replyId);
      if (sub) target = await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
    } else if (text.startsWith('/unban')) {
      const arg = text.slice(6).trim();
      if (/^\d+$/.test(arg)) {
        target = await db.select().from(users).where(eq(users.tgId, Number(arg))).get().catch(() => null);
      } else {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Usage: /unban <user id> — or reply to a card.' });
        return;
      }
    }
    if (!target) {
      if (text.startsWith('/unban')) {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'No such user.' });
      }
      return;
    }
    if (text.startsWith('/unban')) {
      await db.update(users).set({ banned: 0, banReason: null, bannedUntil: null, warnLight: 0, warnMedium: 0 }).where(eq(users.id, target.id)).run();
      await db.insert(audit).values({ adminId: sender, action: 'unban', targetUserId: target.id }).run();
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `Unbanned ${await aidOf(target)}.` });
      try { await api.sendMessage({ chat_id: target.tgId, text: (STR[LANG] ?? STR.ms).unblocked }); } catch {}
      return;
    }
    if (!replyId) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Reply to a card: /ban <duration> <reason>.' });
      return;
    }
    const { until, reason } = parseBanArgs(text.slice(4));
    await applyBan(target, sender, threadId ?? INBOX_TOPIC_ID, until, reason);
    return;
  }
  // Swipe-reply to a card/content message → relay text to the user (admin-only).
  // Success: silent (no reaction). Failure: visible unreachable notice with id.
  if (replyId && text && !text.startsWith('/')) {
    if (!(await isAdmin(sender))) return;
    const sub = await submissionByReply(replyId);
    if (!sub || sub.status === 'rejected') return;
    const target = await db.select().from(users).where(eq(users.id, sub.userId)).get();
    if (!target) return;
    let sentId = null;
    try {
      const sent = await api.sendMessage({ chat_id: target.tgId, text: `${(STR[LANG] ?? STR.ms).adminHead(sub.id)}\n${msg.text}`.slice(0, 4000) });
      sentId = sent?.message_id ?? null;
    } catch {
      // Unreachable: user blocked the bot or deleted the account.
      // Post the id visibly — no reaction noise on success.
      try {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `👤 ${await aidOf(target)} unreachable — blocked bot or deleted account. (#C${sub.id})` });
      } catch {}
      return;
    }
    if (sentId) {
      await db.insert(replyMap).values({ userMsgId: sentId, adminMsgId: msg.message_id, submissionId: sub.id })
        .onConflictDoNothing().run().catch(() => {});
    }
    await db.insert(audit).values({ adminId: sender, action: 'reply', targetUserId: target.id, reason: `#C${sub.id}` }).run().catch(() => {});
    return;
  }
  // Plain (non-reply) group chat: ignored in v1.
}

// Bilingual language picker (works before any locale is known).
async function sendLangPicker(chatId) {
  try {
    await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [
      { type: 'paragraph', text: 'Pilih bahasa anda / Choose your language:' },
      { type: 'buttons', align: 'center', buttons: [
        { text: '🇲🇾 BM', callback_data: 'set_lang:ms' },
        { text: '🇬🇧 EN', callback_data: 'set_lang:en' },
      ] },
    ] } });
  } catch {
    await api.sendMessage({ chat_id: chatId, text: 'Pilih bahasa anda / Choose your language:',
      reply_markup: { inline_keyboard: [[{ text: '🇲🇾 BM', callback_data: 'set_lang:ms' }, { text: '🇬🇧 EN', callback_data: 'set_lang:en' }]] } }).catch(() => {});
  }
}

// Shared button grid (/start + compact menu) — single source so they can't drift.
function startGrid(T) {
  return {
    rich: [
      { type: 'buttons', align: 'center', buttons: [
        { text: T.btnSend, callback_data: 'send_conf' },
        { text: T.btnAsk, callback_data: 'ask_q' },
      ] },
      { type: 'buttons', align: 'center', buttons: [
        ...(CHANNEL_URL ? [{ text: '📢 Channel', url: CHANNEL_URL }] : []),
        { text: T.btnRules, url: TERMS_URL },
        { text: T.btnChat, callback_data: 'go_chat' },
      ] },
      { type: 'buttons', align: 'center', buttons: [
        { text: T.btnLF, callback_data: 'lostfound' },
      ] },
    ],
    markup: { inline_keyboard: [[
      { text: T.btnSend, callback_data: 'send_conf' },
      { text: T.btnAsk, callback_data: 'ask_q' },
    ], [
      ...(CHANNEL_URL ? [{ text: '📢 Channel', url: CHANNEL_URL }] : []),
      { text: T.btnRules, url: TERMS_URL },
      { text: T.btnChat, callback_data: 'go_chat' },
    ], [
      { text: T.btnLF, callback_data: 'lostfound' },
    ]] },
  };
}

// Compact menu (grid only, no long text) — sent after Cancel.
export async function sendMenu(chatId, T) {
  const g = startGrid(T);
  try {
    await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: g.rich } });
  } catch {
    await api.sendMessage({ chat_id: chatId, text: T.menuHead, reply_markup: g.markup }).catch(() => {});
  }
}

// Onboarding sender (locale passed in — first-run picker and /changelanguage
// choose it, /start reuses the saved one).
export async function sendStart(chatId, from, T) {
  const safeName = (from.first_name || from.username || 'kawan').replace(/[<>&]/g, '').slice(0, 40);
  const headText = T.startHead(safeName);
  const bodyText = T.startBody({
    limits: T.limitsLine({ media: DAILY_MEDIA_LIMIT, texts: TEXT_LIMITS ? TEXT_HOURLY_LIMIT : 0 }),
    mask: MASK_CONTACTS ? T.maskLine : '',
  });
  const g = startGrid(T);
  try {
    await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [
      { type: 'paragraph', text: [{ type: 'bold', text: headText }, bodyText] },
      ...g.rich,
    ] } });
  } catch {
    // Static text only — HTML-safe by construction (no user input interpolated).
    const onboard = `<b>${headText}</b>` + bodyText.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const buttons = g.markup;
    try {
      await api.sendMessage({ chat_id: chatId, text: onboard, parse_mode: 'HTML', reply_markup: buttons, disable_web_page_preview: true });
    } catch {
      await api.sendMessage({ chat_id: chatId, text: onboard.replace(/<[^>]+>/g, ''), reply_markup: buttons, disable_web_page_preview: true });
    }
  }
}

async function handle(msg) {
  await flushStaleAlbums().catch(() => {});
  const chatId = msg.chat?.id;
  const text = (msg.text || '').trim();
  if (!chatId) return;
  if (msg.from?.is_bot) return;

  if (chatId === ADMIN_GROUP_ID) {
    const tid = msg.message_thread_id ?? null;
    if (ADMIN_CHAT_TOPIC_ID && tid === ADMIN_CHAT_TOPIC_ID) {
      await handleChatTopic(msg, text);
      return;
    }
    await handleAdminGroup(msg, text);
    return;
  }
  if (msg.chat?.type !== 'private') return;
  const T = STR[LANG] ?? STR.ms;

  // Super-admin DM lookup — by numeric id or alias. Group use rejected.
  if (text.startsWith('/who')) {
    if (msg.from.id !== SUPER_ADMIN_ID) {
      await api.sendMessage({ chat_id: chatId, text: 'Not allowed.' });
      return;
    }
    const arg = text.slice(4).trim().replace(/^#/, '');
    if (!arg) {
      await api.sendMessage({ chat_id: chatId, text: 'Usage: /who <user id | A-id | #C-id> (e.g. /who 230757915, /who A0001, /who #C78)' });
      return;
    }
    const u = await resolveUser(arg);
    if (!u) {
      await api.sendMessage({ chat_id: chatId, text: 'No such user.' });
      return;
    }
    const wc = await warnCounts(u.id).catch(() => ({ light: 0, medium: 0 }));
    await api.sendMessage({ chat_id: chatId, text: `${await whoOf(u)} → @${u.username ?? '?'} · banned:${u.banned ? 1 : 0} warns:L${wc.light ?? 0}/M${wc.medium ?? 0} (60d)` });
    return;
  }
  if (text.startsWith('/list')) {
    if (msg.from.id !== SUPER_ADMIN_ID) {
      await api.sendMessage({ chat_id: chatId, text: 'Not allowed.' });
      return;
    }
    const u = await resolveUser(text.slice(5).trim());
    if (!u) {
      await api.sendMessage({ chat_id: chatId, text: 'No such user — /list <A-id> (e.g. /list A0003).' });
      return;
    }
    const pg = await listPage(u, 0);
    await api.sendMessage({ chat_id: chatId, text: `${await whoOf(u)}\n${pg.text}`, ...(pg.buttons ? { reply_markup: pg.buttons } : {}) });
    return;
  }

  if (text.startsWith('/start')) {
    const u = await ensureUser(msg);
    if (!u) return;
    if (!u.lang) {
      await sendLangPicker(chatId);
      return;
    }
    await sendStart(chatId, msg.from, L(u));
    return;
  }
  if (text.startsWith('/changelanguage')) {
    await ensureUser(msg);
    await sendLangPicker(chatId);
    return;
  }
  if (text.startsWith('/help')) {
    const hu = await db.select().from(users).where(eq(users.tgId, msg.from.id)).get().catch(() => null);
    const ht = L(hu);
    await api.sendMessage({ chat_id: chatId, text: ht.help(TERMS_URL) + (msg.from.id === SUPER_ADMIN_ID ? (hu?.lang === 'en' ? '\n/who <id> — identify a user (super-admin)' : '\n/who <id> — kenal pasti pengguna (super-admin)') : '') });
    return;
  }
  if (text.startsWith('/chat')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    if (!ADMIN_CHAT_TOPIC_ID) {
      await api.sendMessage({ chat_id: chatId, text: t.chatNotSetup });
      return;
    }
    const body = text.slice(5).trim();
    const freshC = await db.select().from(users).where(eq(users.tgId, msg.from.id)).get();
    const gateC = await checkBan(freshC);
    if (gateC.blocked) {
      await api.sendMessage({ chat_id: chatId, text: t.blocked(gateC.blocked) });
      return;
    }
    let sess = await liveSession(u);
    if (sess === 'expired') sess = null;
    if (!sess) {
      const allOpen = await db.select().from(sessions).where(eq(sessions.status, 'open')).all().catch(() => []);
      if (allOpen.filter((s) => s.userId !== u.id).length >= MAX_OPEN_SESSIONS) {
        await api.sendMessage({ chat_id: chatId, text: t.busy });
        return;
      }
      const ins = await db.insert(sessions).values({ userId: u.id, status: 'open' }).returning().run();
      sess = ins[0];
      const markerU = await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `— 💬 chat opened with ${await aidOf(u)}` });
      if (markerU?.message_id) await db.insert(chatMap).values({ adminMsgId: markerU.message_id, userId: u.id }).onConflictDoNothing().run().catch(() => {});
    }
    if (!body) {
      await api.sendMessage({ chat_id: chatId, text: t.chatting });
      return;
    }
    await postChatMessage(sess, u, { kind: 'text', text: body }, chatId);
    return;
  }
  if (text.startsWith('/endadminsession')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const s = await openSessionRow(u);
    if (!s) {
      await api.sendMessage({ chat_id: chatId, text: t.endNoSession });
      return;
    }
    await closeSession(u.id, u.tgId);
    if (ADMIN_CHAT_TOPIC_ID) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `— chat closed with ${await aidOf(u)} (user)` });
    }
    await api.sendMessage({ chat_id: chatId, text: t.chatClosedAck });
    return;
  }
  if (text.startsWith('/status')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const rows = await db.select().from(submissions).where(eq(submissions.userId, u.id)).orderBy(desc(submissions.id)).limit(1).all();
    const s = rows[0];
    const sessOpen = await openSessionRow(u);
    await api.sendMessage({ chat_id: chatId, text: (s ? t.latest(s.id, s.status) : t.noSubmissions) + (sessOpen ? t.chatOpenExtra : '') });
    return;
  }
  if (text.startsWith('/mystats')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const rows = await db.all(sql`SELECT status, COUNT(*) AS c FROM submissions WHERE user_id = ${u.id} AND media_kind != 'report' GROUP BY status`).catch(() => []);
    const c = (st) => (rows ?? []).filter((r) => r.status === st).reduce((a, r) => a + (r.c ?? 0), 0);
    const sent = (rows ?? []).reduce((a, r) => a + (r.status === 'unconfirmed' ? 0 : (r.c ?? 0)), 0);
    const wc = await warnCounts(u.id).catch(() => ({ light: 0, medium: 0 }));
    const T = L(u);
    await api.sendMessage({ chat_id: chatId, text: T.statsLine({ sent, pub: c('approved') + c('approved-undone'), q: c('queued') + c('publishing'), rev: c('pending') + c('unconfirmed'), w: c('warned'), rej: c('rejected'), l: wc.light ?? 0, m: wc.medium ?? 0 }) });
    return;
  }
  if (text.startsWith('/appeal')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const body = text.slice(7).trim();
    const freshA = await db.select().from(users).where(eq(users.tgId, msg.from.id)).get();
    const { blocked } = await checkBan(freshA);
    if (!blocked) {
      await api.sendMessage({ chat_id: chatId, text: t.notBanned });
      return;
    }
    // Berat bans are not appealable per channel terms — no card, instant answer.
    if (freshA?.banReason && WARN_TIERS[freshA.banReason] === 'berat') {
      await api.sendMessage({ chat_id: chatId, text: t.appealBerat });
      return;
    }
    if (!body) {
      await api.sendMessage({ chat_id: chatId, text: t.appealUsage });
      return;
    }
    const open = await db.select().from(appeals)
      .where(and(eq(appeals.userId, u.id), eq(appeals.status, 'pending')))
      .get().catch(() => null);
    if (open) {
      await api.sendMessage({ chat_id: chatId, text: t.appealOpen(open.id) });
      return;
    }
    const ins = await db.insert(appeals).values({ userId: u.id, text: body }).returning().run();
    const ap = ins[0];
    try {
      await api.sendMessage({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        text: `📨 Appeal #A${ap.id} · 👤 ${await aidOf(freshA)} · banned ${blocked}\n${body}`.slice(0, 3900),
        reply_markup: { inline_keyboard: [[
          { text: 'Accept (unban)', callback_data: `appeal_accept:${ap.id}` },
          { text: 'Reject', callback_data: `appeal_reject:${ap.id}` },
        ]] },
      });
    } catch (e) {
      console.error('appeal post failed:', e?.description ?? e?.message ?? e);
      await db.update(appeals).set({ status: 'rejected' }).where(eq(appeals.id, ap.id)).run();
      await api.sendMessage({ chat_id: chatId, text: t.appealFailed });
      return;
    }
    await api.sendMessage({ chat_id: chatId, text: t.appealSent(ap.id) });
    return;
  }
  if (text.startsWith('/cancelreply')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const w = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, u.id), eq(pendingIntents.state, 'awaiting_reply'))).get().catch(() => null);
    if (!w) {
      await api.sendMessage({ chat_id: chatId, text: t.noDraftReply });
      return;
    }
    // Only bot-owned arm messages die (kind 'reply' = converted choice prompt).
    // Pre-push rows point at the user's own forward — never touch those.
    if (w.srcMsgId && w.kind === 'reply') { try { await api.deleteMessage({ chat_id: chatId, message_id: w.srcMsgId }); } catch {} }
    await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    await api.sendMessage({ chat_id: chatId, text: t.replyDiscarded });
    return;
  }
  if (text.startsWith('/cancelquestion')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const w = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, u.id), eq(pendingIntents.state, 'awaiting_question'))).get().catch(() => null);
    if (!w) {
      await api.sendMessage({ chat_id: chatId, text: t.noDraftQ });
      return;
    }
    if (w.srcMsgId) { try { await api.deleteMessage({ chat_id: chatId, message_id: w.srcMsgId }); } catch {} }
    await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    await api.sendMessage({ chat_id: chatId, text: t.qDiscarded });
    return;
  }
  if (text.startsWith('/cancellostfound')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const ws = await db.all(sql`SELECT * FROM pending_intents WHERE user_id = ${u.id} AND state IN ('awaiting_lost','awaiting_found')`).catch(() => []);
    if (!ws?.length) {
      await api.sendMessage({ chat_id: chatId, text: t.noDraftLF });
      return;
    }
    for (const w of ws) {
      if (w.src_msg_id) { try { await api.deleteMessage({ chat_id: chatId, message_id: w.src_msg_id }); } catch {} }
      await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    }
    await api.sendMessage({ chat_id: chatId, text: t.lfDiscarded });
    return;
  }
  if (text.startsWith('/cancel')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const rows = await db.select().from(submissions).where(eq(submissions.userId, u.id)).orderBy(desc(submissions.id)).limit(1).all();
    const s = rows[0];
    if (s && (s.status === 'pending' || s.status === 'pending-album' || s.status === 'unconfirmed')) {
      await db.update(submissions).set({ status: 'rejected' }).where(eq(submissions.id, s.id)).run();
      await api.sendMessage({ chat_id: chatId, text: t.withdrawn(s.id) });
    } else {
      await api.sendMessage({ chat_id: chatId, text: t.nothingPending });
    }
    return;
  }
  // Edit request: reply to your own sent DM with /edit <new text>.
  // Text/caption only (media swaps would orphan threads). Approved posts only.
  if (text.startsWith('/edit')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const body = text.slice(5).trim();
    const targetMsgId = msg.reply_to_message?.message_id ?? null;
    const own = targetMsgId
      ? await db.select().from(submissions)
        .where(and(eq(submissions.userId, u.id), eq(submissions.userMessageId, targetMsgId)))
        .orderBy(desc(submissions.id)).get().catch(() => null)
      : null;
    if (!own) {
      await api.sendMessage({ chat_id: chatId, text: t.editUsage });
      return;
    }
    if (!body) {
      await api.sendMessage({ chat_id: chatId, text: t.editUsage });
      return;
    }
    if (own.status !== 'approved' || !(Array.isArray(own.channelMessageIds) ? own.channelMessageIds.length : 0)) {
      await api.sendMessage({ chat_id: chatId, text: own.status === 'pending' || own.status === 'unconfirmed'
        ? t.stillReview
        : t.goneResend });
      return;
    }
    const oldText = (own.mediaKind === 'text' ? own.text : own.caption) ?? '(no text)';
    const ins = await db.insert(edits).values({ submissionId: own.id, newText: body }).returning().run().catch(() => null);
    if (!ins) {
      await api.sendMessage({ chat_id: chatId, text: t.editStaged });
      return;
    }
    const ed = ins[0];
    try {
      await api.sendMessage({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        text: `✏️ Edit #C${own.id} · ${await aidOf(u)}\n− ${(oldText ?? '').slice(0, 900)}\n+ ${body.slice(0, 900)}`,
        reply_markup: { inline_keyboard: [[
          { text: 'Apply', callback_data: `edit_apply:${ed.id}` },
          { text: 'Dismiss', callback_data: `edit_dismiss:${ed.id}` },
        ]] },
      });
    } catch {
      await db.update(edits).set({ status: 'dismissed' }).where(eq(edits.id, ed.id)).run();
      await api.sendMessage({ chat_id: chatId, text: t.editSendFail });
      return;
    }
    await api.sendMessage({ chat_id: chatId, text: t.editSent(own.id) });
    return;
  }
  if (text.startsWith('/')) {
    await api.sendMessage({ chat_id: chatId, text: (STR[LANG] ?? STR.ms).unknownCmd });
    return;
  }

  // Intake: ban gate first (commands above already bypass it).
  const u0 = await ensureUser(msg);
  if (!u0) return;
  const t = L(u0);
  const fresh0 = await db.select().from(users).where(eq(users.tgId, msg.from.id)).get();
  const gate = await checkBan(fresh0);
  if (gate.blocked) {
    await closeSession(u0.id, 0);
    await api.sendMessage({ chat_id: chatId, text: t.blocked(gate.blocked) });
    return;
  }

  const content = extractContent(msg);
  if (content.kind === 'unsupported' || content.kind === 'empty') {
    await api.sendMessage({ chat_id: chatId, text: t.unsupported });
    return;
  }
  if (content.album) {
    content.album = false;
    if (content.kind === 'unsupported' || !content.fileId) {
      await api.sendMessage({ chat_id: chatId, text: t.unsupported });
      return;
    }
  }
  const stripped = strippedFlags(msg);

  // Forward routing: channel reply-share → reply queue; bare channel forward
  // → disambiguate (reply / report / new); other forwards → confession as-is.
  const fwdChat = msg.forward_from_chat ?? (msg.forward_origin?.type === 'channel' ? msg.forward_origin.chat : null);
  const fwdMsgId = msg.forward_from_message_id ?? msg.forward_origin?.message_id ?? null;
  const rpl = msg.reply_to_message ?? null;
  const rplFwdChat = rpl?.forward_from_chat ?? (rpl?.forward_origin?.type === 'channel' ? rpl.forward_origin.chat : null);
  const rplFwdMsgId = rpl?.forward_from_message_id ?? rpl?.forward_origin?.message_id ?? null;
  // Cross-chat reply ("Reply in..." → bot): arrives as external_reply, not reply_to_message.
  const extChat = msg.external_reply?.chat ?? null;
  const extMsgId = msg.external_reply?.message_id ?? null;
  const isExternalReplyShare = extChat && Number(extChat.id) === CHANNEL_ID && extMsgId;
  const isReplyShare = (rplFwdChat && Number(rplFwdChat.id) === CHANNEL_ID && rplFwdMsgId) || isExternalReplyShare;
  const isChannelFwd = !isReplyShare && fwdChat && Number(fwdChat.id) === CHANNEL_ID && fwdMsgId;

  if (isReplyShare) {
    const refMsg = Number(isExternalReplyShare ? extMsgId : rplFwdMsgId);
    const refSub = await confessionOfChannelMsg(refMsg);
    await submitConfession({ from: msg.from, chatId, messageId: msg.message_id ?? null, content, stripped,
      refId: refSub, refMsgId: refMsg });
    await flushStaleAlbums().catch(() => {});
    return;
  }
  if (isChannelFwd) {
    const refMsg = Number(fwdMsgId);
    const refSub = await confessionOfChannelMsg(refMsg);
    const snap = await db.insert(pendingIntents).values({
      userId: u0.id, srcMsgId: msg.message_id ?? null,
      postMsgId: refMsg, postSub: refSub,
      kind: content.kind, text: content.text ?? null,
      fileId: content.fileId ?? null, caption: content.caption ?? null,
    }).returning().run().catch(() => null);
    if (!snap) {
      await api.sendMessage({ chat_id: chatId, text: t.fwdStageFail });
      return;
    }
    const pid = snap[0].id;
    await api.sendMessage({
      chat_id: chatId,
      text: refSub ? t.fwdChoice(`#C${refSub}`) : t.fwdChoice('channel post'),
      reply_markup: { inline_keyboard: [[
        { text: 'Reply to this post', callback_data: `fwd_reply:${pid}` },
        { text: 'Report it', callback_data: `fwd_report:${pid}` },
      ]] },
    });
    return;
  }

  // Armed reply: user tapped "Reply to this post" earlier — this content IS the reply.
  // (Fresh forwards/reply-shares above take precedence and stay untouched.)
  const waiting = await db.select().from(pendingIntents)
    .where(and(eq(pendingIntents.userId, u0.id), eq(pendingIntents.state, 'awaiting_reply')))
    .orderBy(desc(pendingIntents.id)).limit(1).all().catch(() => []);
  const w = waiting[0];
  if (w && !isReplyShare && !isChannelFwd) {
    await submitConfession({ from: msg.from, chatId, messageId: msg.message_id ?? null, content, stripped,
      refId: w.postSub, refMsgId: w.postMsgId });
    await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    await flushStaleAlbums().catch(() => {});
    return;
  }

  // Armed question: user tapped "Tanya Soalan" earlier — this content IS the question.
  const waitingQ = await db.select().from(pendingIntents)
    .where(and(eq(pendingIntents.userId, u0.id), eq(pendingIntents.state, 'awaiting_question')))
    .orderBy(desc(pendingIntents.id)).limit(1).all().catch(() => []);
  const wq = waitingQ[0];
  if (wq && !isReplyShare && !isChannelFwd) {
    await submitConfession({ from: msg.from, chatId, messageId: msg.message_id ?? null, content, stripped, isQuestion: true });
    await db.delete(pendingIntents).where(eq(pendingIntents.id, wq.id)).run().catch(() => {});
    await flushStaleAlbums().catch(() => {});
    return;
  }

  // Armed lost/found: user picked Report Lost/Found earlier — this content IS the report.
  const waitingLF = await db.get(sql`SELECT * FROM pending_intents WHERE user_id = ${u0.id} AND state IN ('awaiting_lost','awaiting_found') ORDER BY id DESC LIMIT 1`).catch(() => null);
  if (waitingLF && !isReplyShare && !isChannelFwd) {
    await submitConfession({ from: msg.from, chatId, messageId: msg.message_id ?? null, content, stripped, kind: waitingLF.state === 'awaiting_lost' ? 'lost' : 'found' });
    await db.delete(pendingIntents).where(eq(pendingIntents.id, waitingLF.id)).run().catch(() => {});
    await flushStaleAlbums().catch(() => {});
    return;
  }

  // Open admin-chat session multiplexes plain DMs to Topic 2 (no confirm step).
  // Armed channel replies and fresh forwards above take precedence.
  const sessState = await liveSession(u0);
  if (sessState === 'expired') {
    await api.sendMessage({ chat_id: chatId, text: t.expiredChat });
  } else if (sessState) {
    await postChatMessage(sessState, u0, content, chatId);
    return;
  }

  // Plain intake (forwards from other chats land here, headers stripped).
  await submitConfession({ from: msg.from, chatId, messageId: msg.message_id ?? null, content, stripped });
  await flushStaleAlbums().catch(() => {});
}

export default guarded(handle);
