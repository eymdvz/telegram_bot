import { db, api } from 'sdk';
import { eq, and, or, desc, lt, sql } from 'sdk/db';
import { users, submissions, parts, audit, replyMap, appeals, pendingIntents, edits, deletes, sessions, chatMap, hits, notes, duty, dayOut, crowns, meta, feedback } from '../schema.js';
import { guarded } from '../lib/errors.js';
import {
  ADMIN_GROUP_ID, INBOX_TOPIC_ID, CHANNEL_ID,
  ADMIN_IDS, SUPER_ADMIN_ID, MAX_ALBUM, ALBUM_WINDOW_MS,
  DAILY_MEDIA_LIMIT, TEXT_HOURLY_LIMIT, EXEMPT_IDS, TERMS_URL, WARN_TIERS, APPEAL_CONTACT,
  ADMIN_CHAT_TOPIC_ID, MAX_OPEN_SESSIONS, SESSION_IDLE_MIN, CHAT_SLOWMODE_SEC,
  MASK_CONTACTS, TEXT_LIMITS, DRIP_FEED, CHANNEL_URL, BURST_MSG_LIMIT, BURST_WINDOW_SEC, LANG, ALL_COOLDOWN_SEC,
  REPLY_GUIDE_URL, GROUP_LINK_URL, FAQ_URL, LOWQ_BLOCK, PROFANITY_MASK, DISCUSSION_GROUP_ID,
} from '../lib/config.js';

// Confession-to-channel v1. Single inbox topic, anonymous cards (#C + alias).
// Plan: .opencode/plan/just_arobot-confession-v1.md

async function ensureUser(msg) {
  const tgId = msg.from?.id;
  if (!tgId) return null;
  // No alias stamped here — UIDs assign lazily via aidOf (unique, retry-safe).
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

import { isAdmin, groupAdmins, adminDisplay, lookupAdmin } from '../lib/admins.js';
import { banNotice, warnCounts, whoOf, cardWho, dispAid, aidOf, resolveIdentity, aliasProblem, maskContacts, detectReplyPrefix, detectGroupLink, detectAdNudge, isLowQuality, censorProfanity, pollRender, pollCensor, textAllowed, flushQueue, queuedCount, kindOf, KIND_TAGS, KIND_CARDS, danaLabel, danaTag, detectIntent, adminStatsText, astatsRow, oldestPage, tutRow, atutRow, dutyGreens, touchSeen, bumpOut, markDeadByTg, botStatsText, askCatLabel, crownLeaders, crownMap, maintOn, setMaint, midnightActive, setMidnight, syncFaq, debugOn, setDebug, debugDump, tag } from '../lib/moderation.js';
import { STR, L } from '../lib/strings.js';
import { CHANGELOG } from '../lib/changelog.js';
import { VERSION } from '../lib/config.js';

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
  { command: 'canceldana', description: 'Buang draf cari dana' },
  { command: 'cancelsuggest', description: 'Buang draf suggestion' },
  { command: 'cancelinfo', description: 'Buang draf info' },
  { command: 'cancelfeedback', description: 'Buang draf feedback' },
  { command: 'chat', description: 'Berbual dengan admin' },
  { command: 'endadminsession', description: 'Tutup admin chat' },
  { command: 'edit', description: 'Betulkan mesej (reply /edit)' },
  { command: 'appeal', description: 'Rayu ban (/appeal <teks>)' },
  { command: 'mystats', description: 'Jumlah confession anda' },
  { command: 'tutorial', description: 'Panduan guna bot' },
  { command: 'changelog', description: 'Versi + apa yang baru' },
  { command: 'changelanguage', description: 'Tukar bahasa / Change language' },
];
const ADMIN_COMMANDS = [
  { command: 'help', description: 'Show admin commands' },
  { command: 'stats', description: 'Pending + queued counts' },
  { command: 'botstats', description: 'Bot-wide totals (users, talk)' },
  { command: 'flush', description: 'Post oldest queued now' },
  { command: 'ban', description: 'Ban (reply to a card)' },
  { command: 'unban', description: 'Unban (reply or /unban <id>)' },
  { command: 'startchat', description: 'Open chat with a user (Topic 2)' },
  { command: 'unbutton', description: 'Strip keyboards off a post (#C)' },
  { command: 'dbstatus', description: 'Table counts + status mix' },
  { command: 'synccommands', description: 'Refresh autocomplete menus' },
  { command: 'list', description: 'User history by UID (#C list)' },
  { command: 'adminstats', description: 'Admin leaderboard (7d/30d/all)' },
  { command: 'crown', description: 'Monthly crowns (owner)' },
  { command: 'faqsync', description: 'Pull Sheet FAQ to DB (owner)' },
  { command: 'setcid', description: 'Set paid alias (owner)' },
  { command: 'clearcid', description: 'Clear alias (owner)' },
  { command: 'tpl', description: 'Reply templates (reply to card)' },
  { command: 'msg', description: 'Custom DM to card author (reply)' },
  { command: 'debugmode', description: 'ID markers on cards (owner)' },
  { command: 'debuginfo', description: 'Full #C dump to owner DM (owner)' },
  { command: 'maintenance', description: 'Pause/resume intake (owner)' },
  { command: 'midnight', description: 'Midnight notice auto/on/off (owner)' },
  { command: 'recent', description: 'Latest mod actions' },
  { command: 'oldest', description: 'Longest-waiting queue items' },
  { command: 'note', description: 'Pin a note on a user (reply or UID)' },
  { command: 'unnote', description: 'Clear a user note' },
  { command: 'notes', description: 'List all active notes' },
  { command: 'onduty', description: 'Toggle your on-duty flag' },
  { command: 'dutyroster', description: 'Who is on duty' },
  { command: 'announce', description: 'Draft a broadcast (owner)' },
  { command: 'cancelannounce', description: 'Drop the draft (owner)' },
  { command: 'tutorial', description: 'How-to guide' },
  { command: 'changelog', description: 'Version + recent changes' },
];
const adminHelpText = () =>
  '/stats — pending + queued counts\n/botstats — bot-wide totals (users, submissions, talk)\n/flush — post oldest queued now\n/ban — reply to a card: /ban <duration> <reason>\n/unban — reply to a card, or /unban <user id>\n/startchat — reply to a user message, or /startchat <UID>\n/unbutton — strip keyboards off a post: /unbutton <C-id>\n/dbstatus — table counts + status mix\n/adminstats — admin leaderboard: /adminstats [7d|30d|all]\n/crown — monthly crowns: most actions + fastest triage (owner)\n/faqsync — pull Sheet FAQ rows to DB (owner)\n/setcid — set paid alias: /setcid <UID> <Name> (owner)\n/clearcid — clear alias (owner)\n/tpl — reply templates: reply to a card, or /tpl #C<id>\n/msg — custom DM: reply to a card with /msg <text>\n/maintenance — pause/resume new submissions: /maintenance [on|off] (owner)\n/midnight — midnight notice: /midnight [on|off|auto] (owner)\n/debugmode — id markers on cards: /debugmode [on|off] (owner)\n/debuginfo — full #C dump to owner DM: /debuginfo #C<id> (owner)\n/recent — latest mod actions: /recent [n]\n/oldest — longest-waiting queue items\n/note — reply pins a card note; /note <UID>|#C<id> <text> for author/card\n/unnote — reply clears card notes; /unnote <UID> clears the author note\n/notes — list all active notes\n/onduty — toggle your on-duty flag (!all pings greens)\n/dutyroster — who is on duty\n/announce — draft a broadcast: /announce <text> (owner; Confirm to blast)\n/tutorial — how-to guide\n/changelog — version + recent changes\n/synccommands — refresh autocomplete menus\nTip: swipe-reply on a card to message the user anonymously.';

// Push autocomplete menus: default (users), chat-administrators (mods),
// super-admin DM (users + /who). Run via /synccommands after command changes.
async function syncCommands() {
  const jobs = [
    api.setMyCommands({ commands: USER_COMMANDS }).catch((e) => e),
    api.setMyCommands({ commands: ADMIN_COMMANDS, scope: { type: 'chat_administrators', chat_id: ADMIN_GROUP_ID } }).catch((e) => e),
    api.setMyCommands({ commands: [...USER_COMMANDS, { command: 'who', description: 'Identify a user (super-admin)' }, { command: 'list', description: 'User history (super-admin)' }, { command: 'announce', description: 'Draft a broadcast (owner)' }, { command: 'cancelannounce', description: 'Drop the draft (owner)' }, { command: 'debuginfo', description: 'Full #C dump (owner)' }, { command: 'strings', description: 'Review UI copy, paged (owner)' }], scope: { type: 'chat', chat_id: SUPER_ADMIN_ID } }).catch((e) => e),
  ];
  const res = await Promise.all(jobs);
  return res.map((r) => (r === true ? 'ok' : 'FAIL:' + String(r?.description ?? r?.message ?? r).slice(0, 80)));
}

function cardButtons(cId) {
  return { inline_keyboard: [[
    { text: '✅ Accept', callback_data: `accept:${cId}` },
  ], [
    { text: '❌ Reject', callback_data: `reject:${cId}` },
    { text: '⚠️ Warn', callback_data: `warn:${cId}` },
  ], [
    { text: '⛔ BAN', callback_data: `ban:${cId}` },
  ]] };
}

function strippedFlags(msg) {
  const flags = [];
  if (msg.forward_origin || msg.forward_from_chat || msg.forward_from_message_id || msg.forward_date) flags.push('forward');
  if (msg.via_bot) flags.push('via_bot');
  if (msg.reply_markup) flags.push('buttons');
  return flags;
}

// Shared plain preview-action (staging + edit-rebuilds): labeled text + rows.
// Rich styling lives only in staging's first attempt; rebuilds reuse this
// plain shape (same precedent as the convert fallback).
export function previewActionText(T, subId, k, aNotes) {
  return `${T.actionLead} <b>${T.preview(subId, k)}</b>:${aNotes}`;
}
export function previewActionRow(T, subId, k, intent) {
  return { inline_keyboard: [[
    { text: T.confirmBtn, callback_data: `confirm_${subId}` },
    { text: T.cancelBtn, callback_data: `cancelconf_${subId}` },
  ], ...(k === 'confession' ? [
    [{ text: T.kindSep, callback_data: 'noop_kind' }],
    [
    { text: '❓ Question', callback_data: `convert_${subId}_question` },
    { text: '🔍 Lost', callback_data: `convert_${subId}_lost` },
    { text: '📦 Found', callback_data: `convert_${subId}_found` },
  ]] : []),
  ...(intent === 'chat' ? [[{ text: '💬 Chat dengan admin', callback_data: 'go_chat' }]] : [])] };
}

// Rich action blocks (green/red Confirm row + convert table). Staging sends
// these first and falls back to previewActionRow; rebuilds do the same.
export function previewRichAction(T, subId, k, intent) {
  return [
    { type: 'buttons', align: 'center', buttons: [
      { text: T.confirmBtn, callback_data: `confirm_${subId}`, style: 'success' },
      { text: T.cancelBtn, callback_data: `cancelconf_${subId}`, style: 'danger' },
    ] },
    ...(k === 'confession' ? [
      { type: 'divider' },
      { type: 'table', is_bordered: false, cells: [[{ text: T.kindHint, align: 'center', valign: 'middle' }]] },
      { type: 'buttons', align: 'center', buttons: [
        { text: '❓ Question', callback_data: `convert_${subId}_question` },
        { text: '🔍 Lost', callback_data: `convert_${subId}_lost` },
        { text: '📦 Found', callback_data: `convert_${subId}_found` },
      ] },
    ] : []),
    ...(intent === 'chat' ? [{ type: 'buttons', align: 'center', buttons: [{ text: '💬 Chat dengan admin', callback_data: 'go_chat' }] }] : []),
  ];
}

async function postCard(threadMsgId, sub, who, kindLabel, stripped, tag = null) {
  const stripNote = stripped.length ? `\n(stripped: ${stripped.join(',')})` : '';
  const note = await db.select().from(notes).where(eq(notes.userId, sub.userId)).get().catch(() => null);
  let noteLine = '';
  if (note?.text) {
    const by = await lookupAdmin(Number(note.adminId)).catch(() => null);
    noteLine = `\n📝 ${note.text.slice(0, 300)}${by ? ` — ${adminDisplay(by)}` : ''}`;
  }
  const card = await api.sendMessage({
    chat_id: ADMIN_GROUP_ID,
    ...inboxThread(),
    ...(threadMsgId ? { reply_parameters: { message_id: threadMsgId } } : {}),
    text: `${tag ? tag + '\n' : ''}#C${sub.id} · ${kindLabel} · 👤 ${who}${stripNote}${noteLine}${await debugOn().catch(() => false) ? `\n⚙️ #C${sub.id} · u${sub.userId} · ${sub.kind ?? '?'} · ${sub.status}` : ''}`,
    reply_markup: cardButtons(sub.id),
  });
  await db.update(submissions).set({ inboxCardId: card.message_id }).where(eq(submissions.id, sub.id)).run();
  return card;
}

async function postSingleToInbox(sub, userRow, content, stripped, tag = null) {
  const who = await cardWho(userRow);
  let firstId = null;
  if (content.kind === 'text') {
    const m = await api.sendMessage({
      chat_id: ADMIN_GROUP_ID, ...inboxThread(),
      text: (content.text ?? '').slice(0, 4000) || '(empty)',
    });
    firstId = m.message_id;
    await db.update(submissions).set({ inboxMessageId: firstId }).where(eq(submissions.id, sub.id)).run();
    await postCard(firstId, sub, who, 'text', stripped, tag);
  } else if (content.kind === 'poll') {
    // Quiz answer marked for mods only — the channel poll hides nothing extra.
    const pd = content.pollData ?? {};
    const m = await api.sendMessage({
      chat_id: ADMIN_GROUP_ID, ...inboxThread(),
      text: pollRender(content.text, pd.options, pd.correct, true).slice(0, 4000) || '(empty)',
    });
    firstId = m.message_id;
    await db.update(submissions).set({ inboxMessageId: firstId }).where(eq(submissions.id, sub.id)).run();
    await postCard(firstId, sub, who, `poll${pd.correct != null ? ' (quiz)' : ''}`, stripped, tag);
  } else {
    const cap = (content.caption ?? '');
    const short = cap.length <= 1024;
    let m;
    if (content.kind === 'photo') {
      m = await api.sendPhoto({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        photo: content.fileId, ...(short && cap ? { caption: cap.slice(0, 1024) } : {}),
      });
    } else if (content.kind === 'video') {
      m = await api.sendVideo({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        video: content.fileId, ...(short && cap ? { caption: cap.slice(0, 1024) } : {}),
      });
    } else if (content.kind === 'voice') {
      m = await api.sendVoice({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        voice: content.fileId, ...(short && cap ? { caption: cap.slice(0, 1024) } : {}),
      });
    } else if (content.kind === 'sticker') {
      m = await api.sendSticker({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        sticker: content.fileId,
      });
    } else {
      m = await api.sendDocument({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        document: content.fileId, ...(short && cap ? { caption: cap.slice(0, 1024) } : {}),
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
    await postCard(firstId ?? null, sub, await cardWho(userRow), `album (${rows.length})`, []);
    try {
      await api.sendMessage({ chat_id: userRow.tgId, text: `Received (#C${subId}, album of ${rows.length}). Admins will review.` });
    } catch {}
  } catch (e) {
    console.error('album flush failed:', e?.description ?? e?.message ?? e);
    await db.update(submissions).set({ status: 'pending', mediaCount: rows.length }).where(eq(submissions.id, subId)).run();
    await api.sendMessage({
      chat_id: ADMIN_GROUP_ID, ...inboxThread(),
      text: `#C${subId} · album (${rows.length}) · 👤 ${await cardWho(userRow)}\n(flush failed — see logs)`,
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

// Daily media cap: media submissions per user per rolling 24h (text free).
// EXEMPT_IDS (owner + list) bypass. Rejected/withdrawn submissions don't count.
// Raw SQL on unixepoch(): the created_at column stores unix seconds, so the
// window comparison stays in seconds (no Date-mode conversion involved).
async function mediaAllowed(tgId, userId) {
  if (EXEMPT_IDS.includes(tgId)) return true;
  const row = await db.get(sql`SELECT COUNT(*) AS c FROM submissions WHERE user_id = ${userId} AND created_at > unixepoch() - 86400 AND media_kind IN ('photo', 'video', 'album', 'voice', 'sticker', 'document') AND status != 'rejected' AND status != 'unconfirmed'`).catch(() => ({ c: 0 }));
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
  if (msg.voice) return { kind: 'voice', fileId: msg.voice.file_id, caption: msg.caption ?? null };
  if (msg.sticker) return { kind: 'sticker', fileId: msg.sticker.file_id };
  if (msg.document) return { kind: 'document', fileId: msg.document.file_id, caption: msg.caption ?? null };
  if (msg.audio) {
    const aTag = `${msg.audio.performer ?? ''} - ${msg.audio.title ?? ''}`.trim();
    return { kind: 'document', fileId: msg.audio.file_id, caption: msg.caption ?? (aTag === '-' ? null : aTag) };
  }
  if (msg.video_note || msg.animation) return { kind: 'unsupported' };
  if (msg.poll) {
    // Native poll (V1.6.0): question + options ride through; <2 options
    // can't re-post as a poll — refuse with the standard notice.
    const opts = (msg.poll.options ?? []).map((o) => o?.text ?? '').filter((t) => t.trim()).slice(0, 10);
    if (opts.length < 2) return { kind: 'unsupported' };
    return { kind: 'poll', text: msg.poll.question ?? '',
      pollData: { options: opts,
        correct: msg.poll.type === 'quiz' ? (msg.poll.correct_option_id ?? null) : null,
        multi: msg.poll.allows_multiple_answers ? 1 : 0,
        explain: msg.poll.explanation ?? null } };
  }
  return { kind: 'empty' };
}

async function submissionByReply(replyId) {
  if (!replyId) return null;
  let s = await db.select().from(submissions).where(eq(submissions.inboxCardId, replyId)).get().catch(() => null);
  if (s) return s;
  s = await db.select().from(submissions).where(eq(submissions.inboxMessageId, replyId)).get().catch(() => null);
  if (s) return s;
  // Preview/action bubbles (split preview stores preview_msg_id) — replying
  // any bot bubble quoting the submission resolves to it.
  return db.select().from(submissions).where(eq(submissions.previewMsgId, replyId)).get().catch(() => null);
}

// Shared identity resolver (used by /who + /list): delegates to the
// UID-aware helper (raw id, UID-###, legacy CID-###/A###, alias, #C submission).
async function resolveUser(arg) {
  return resolveIdentity(arg);
}

const PAGE_N = 30;

// Paged history: sections rebuilt per page (`✅ Published (40)` headers stay
// global, items are the page slice). Stateless cursor — recomputed per tap.
export async function listPage(u, page = 0) {
  const rows = await db.select().from(submissions).where(eq(submissions.userId, u.id)).orderBy(submissions.id).all().catch(() => []);
  if (!rows?.length) return { text: 'No submissions.', buttons: null };
  const aid = await cardWho(u).catch(() => '?');
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

async function applyBan(targetUser, adminId, threadId, until, reason, scope = 'bot') {
  await db.update(users).set({ banned: 1, banReason: reason, bannedUntil: until }).where(eq(users.id, targetUser.id)).run();
  // Telegram-side enforcement runs before the audit so the outcome rides along.
  const tg = scope === 'bot' ? [] : await tgEnforce(targetUser.tgId, scope, until).catch(() => []);
  const tgNote = tg.length ? ` · ${tg.join(',')}` : '';
  await db.insert(audit).values({ adminId, action: 'ban', targetUserId: targetUser.id, reason: `${fmtUntil(until)} · ${reason}${tgNote}` }).run();
  if (threadId) {
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `Banned ${await cardWho(targetUser)} ${fmtUntil(until)} — ${reason}${tgNote}` });
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
export async function submitConfession({ from, chatId, messageId, content, stripped = [], refId = null, refMsgId = null, silent = false, isQuestion = false, kind = 'confession', askSub = null }) {
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
  // Maintenance mode: new staging paused (review side runs on). EXEMPT bypass.
  if (!EXEMPT_IDS.includes(from.id) && await maintOn().catch(() => false)) {
    const err = T.maintenance;
    await say(err);
    return { sub: null, error: err };
  }
  // Burst guard: max BURST_MSG_LIMIT staged messages per rolling window (EXEMPT bypass).
  if (!EXEMPT_IDS.includes(from.id)) {
    const b = await db.get(sql`SELECT COUNT(*) AS c FROM submissions WHERE user_id = ${u.id} AND created_at > unixepoch() - ${BURST_WINDOW_SEC} AND status != 'superseded'`).catch(() => ({ c: 0 }));
    if ((b?.c ?? 0) >= BURST_MSG_LIMIT) {
      const err = T.burst;
      await say(err);
      return { sub: null, error: err };
    }
  }
  // Low-effort hard block: before any DB insert, so blocked tries never
  // touch burst/text limits (owner call: outright, uncounted). EXEMPT bypass.
  if (LOWQ_BLOCK && !EXEMPT_IDS.includes(from.id)) {
    const lowTarget = (content.text ?? content.caption ?? '').trim();
    if (lowTarget && isLowQuality(lowTarget)) {
      const err = T.lowQ;
      await say(err);
      return { sub: null, error: err };
    }
  }
  // Contact auto-mask (emails, URLs, @mentions, phone-ish numbers → [hidden]).
  // Stored + previewed masked; card notes it via the stripped flags.
  // Group-link detect runs on RAW text first — masking destroys URLs.
  const grpMark = detectGroupLink(content.text ?? content.caption ?? '');
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
  // Soft reply-prefix gate: copy-paste replies (r:/rep:/reply:) hold at staging
  // until the owner clears ("not a reply") or cancels. Detected on masked text
  // so confirm-time re-detection sees the same string.
  const rplMark = detectReplyPrefix(content.text ?? content.caption ?? '');
  // Single live draft (V1.7.0): a new staging supersedes older unconfirmed
  // rows — old preview bubbles die (best-effort delete), stale buttons hit
  // the 'unconfirmed' guards. Runs post-gates so refused content (lowQ,
  // burst, bans) never kills the live draft.
  const priors = await db.select().from(submissions)
    .where(and(eq(submissions.userId, u.id), eq(submissions.status, 'unconfirmed')))
    .orderBy(desc(submissions.id)).all().catch(() => []);
  const replaced = [];
  for (const p of priors ?? []) {
    await db.update(submissions).set({ status: 'superseded' }).where(eq(submissions.id, p.id)).run().catch(() => {});
    replaced.push(`#C${p.id}`);
    const dead = [p.previewMsgId, p.actionMsgId, ...(Array.isArray(p.noticeIds) ? p.noticeIds : [])].filter(Boolean);
    for (const mid of dead) {
      try { await api.deleteMessage({ chat_id: chatId, message_id: mid }); } catch {}
    }
  }
  const k = isQuestion ? 'question' : kind;
  let sub;
  try {
    const ins = await db.insert(submissions).values({
      userId: u.id, status: 'unconfirmed', mediaKind: content.kind,
      text: (content.kind === 'text' || content.kind === 'poll') ? (content.text ?? null) : null,
      caption: content.caption ?? null,
      pollData: content.kind === 'poll' ? (content.pollData ?? null) : null,
      userMessageId: messageId ?? null,
      refId, refMsgId,
      isQuestion: k === 'question' ? 1 : 0,
      kind: k,
      askSub: askSub ?? null, // dana subtype at staging (program/kilat) so the preview tag is exact
      grpCleared: grpMark ? 0 : 1, // group-link hold starts held; edits recompute
    }).returning().run();
    sub = ins[0];
  } catch (e) {
    const err = 'Gagal simpan: ' + String(e?.description ?? e?.message ?? e).slice(0, 160);
    console.error('submit save failed:', e?.description ?? e?.message ?? e);
    await say(err);
    return { sub: null, error: err };
  }
  if (replaced.length) await say(await tag('draftReplaced', T.draftReplaced(replaced.join(', '), `#C${sub.id}`)));
  // Polls carry no file part (question + options ride the submission row).
  if (content.kind !== 'text' && content.kind !== 'poll') {
    await db.insert(parts).values({ submissionId: sub.id, type: content.kind, fileId: content.fileId, caption: content.caption ?? null }).run();
  }
  if (stripped.length) {
    await db.insert(audit).values({ adminId: 0, action: 'stripped', targetUserId: u.id, reason: `#C${sub.id}: ${stripped.join(',')}` }).run().catch(() => {});
  }
  // Preview doubles as the ack. Media re-sent with buttons attached (long
  // captions ride a separate text message, same as inbox rules).
  const intent = k === 'confession' ? detectIntent(content.text ?? content.caption ?? '') : null;
  const intentLabel = intent === 'question' ? 'Question' : intent === 'lost' ? 'Lost' : intent === 'found' ? 'Found' : null;
  const buttons = previewActionRow(T, sub.id, k, intent);
  // Split preview: pure content first, labeled action message after.
  const intentNote = intentLabel ? `\n(Nampak seperti ${intent === 'question' ? 'soalan' : intent === 'lost' ? 'lost' : 'found'} — tekan di bawah untuk post dengan ${KIND_TAGS[intent]}.)` : intent === 'chat' ? '\n(Nak berhubung dengan admin? Tekan di bawah.)' : '';
  const maskNote = stripped.some((s) => s.startsWith('contact')) ? T.maskNote : '';
  const qNote = (KIND_TAGS[k] && k !== 'confession') ? T.kindNote(k === 'dana' ? danaTag(sub) : KIND_TAGS[k]) : '';
  const aTitle = T.preview(sub.id, k);
  const midNite = await midnightActive().catch(() => false);
  // Declared-intent kinds skip the ad nudge (suggest allows prices, dana
  // collects money) — plain confessions still nudge as today.
  const adHit = (k === 'suggest' || k === 'dana') ? null : detectAdNudge(content.text ?? content.caption ?? '');
  // Curse heads-up: user sees at staging that the channel gets censored text.
  // Polls check question + options (caption N/A).
  const curseHit = PROFANITY_MASK
    ? (content.kind === 'poll' ? pollCensor(content.text ?? '', content.pollData).n : censorProfanity(content.text ?? content.caption ?? '').n)
    : 0;
  const aNotes = `${maskNote}${qNote}${intentNote}${midNite ? `\n${T.midnight}` : ''}${adHit ? `\n${T.adNudge}` : ''}${curseHit ? T.curseNote : ''}${content.kind === 'poll' ? T.pollNote : ''}${(from.id === SUPER_ADMIN_ID && await debugOn().catch(() => false)) ? `\n⚙️ #C${sub.id} · u${u.id} · ${k} · unconfirmed` : ''}`;
  let previewId = null;
  // Action message owns every button (always editable: plain fallback; rich
  // attempt carries the green/red styles).
  const richAction = previewRichAction(T, sub.id, k, intent);
  try {
    let pvN = 2; // content bubble + action bubble (3 when long captions split)
    if (content.kind === 'text') {
      const fullText = (content.text ?? '').slice(0, 1000) || '(empty)';
      try {
        const m = await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [{ type: 'paragraph', text: fullText }] } });
        previewId = m?.message_id ?? null;
      } catch {
        const m = await api.sendMessage({ chat_id: chatId, text: fullText });
        previewId = m?.message_id ?? null;
      }
    } else if (content.kind === 'poll') {
      const m = await api.sendMessage({ chat_id: chatId, text: pollRender(content.text, content.pollData?.options).slice(0, 1000) || '(empty)' });
      previewId = m?.message_id ?? null;
    } else if (content.kind === 'photo' || content.kind === 'video') {
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
        pvN = 3;
        const longText = cap.slice(0, 3900);
        try {
          const m = await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [{ type: 'paragraph', text: longText }] } });
          previewId = m?.message_id ?? null;
        } catch {
          const m = await api.sendMessage({ chat_id: chatId, text: longText });
          previewId = m?.message_id ?? null;
        }
      }
    } else {
      // voice / sticker / document: plain preview bubble (no rich shape).
      const cap = (content.caption ?? '').slice(0, 1024) || null;
      if (content.kind === 'voice') {
        const m = await api.sendVoice({ chat_id: chatId, voice: content.fileId, ...(cap ? { caption: cap } : {}) });
        previewId = m?.message_id ?? null;
      } else if (content.kind === 'sticker') {
        const m = await api.sendSticker({ chat_id: chatId, sticker: content.fileId });
        previewId = m?.message_id ?? null;
      } else {
        const m = await api.sendDocument({ chat_id: chatId, document: content.fileId, ...(cap ? { caption: cap } : {}) });
        previewId = m?.message_id ?? null;
      }
    }
    const actionSegs = [T.actionLead + ' ', { type: 'bold', text: aTitle }, ':' + aNotes];
    const actionHtml = `${T.actionLead} <b>${aTitle}</b>:${aNotes}`;
    let actionId = null;
    const threadToPreview = previewId ? { reply_parameters: { message_id: previewId } } : {};
    try {
      const am = await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [{ type: 'paragraph', text: actionSegs }, ...richAction] }, ...threadToPreview });
      actionId = am?.message_id ?? null;
    } catch {
      try {
        const am = await api.sendMessage({ chat_id: chatId, text: actionHtml, parse_mode: 'HTML', reply_markup: buttons, ...threadToPreview });
        actionId = am?.message_id ?? null;
      } catch {
        // Threaded sends unsupported — unthreaded, unstyled, still functional.
        const am = await api.sendMessage({ chat_id: chatId, text: actionHtml.replace(/<[^>]+>/g, ''), reply_markup: buttons });
        actionId = am?.message_id ?? null;
      }
    }
    await db.update(submissions).set({ previewMsgId: previewId, actionMsgId: actionId }).where(eq(submissions.id, sub.id)).run().catch(() => {});
    await bumpOut(pvN);
  } catch (e) {
    const err = 'Pratonton gagal: ' + String(e?.description ?? e?.message ?? e).slice(0, 160);
    console.error('preview failed:', e?.description ?? e?.message ?? e);
    await say(err);
    return { sub, error: err };
  }
  if ((content.kind === 'photo' || content.kind === 'video' || content.kind === 'document') && !(content.caption || '').trim()) {
    if (!silent) {
      try {
        const nm = await api.sendMessage({ chat_id: chatId, text: await tag('needCaption', T.needCaption) });
        if (nm?.message_id) await db.update(submissions).set({ noticeIds: [nm.message_id] }).where(eq(submissions.id, sub.id)).run().catch(() => {});
      } catch {}
    } else {
      await say(await tag('needCaption', T.needCaption));
    }
  } else if (content.kind === 'voice' && !(content.caption || '').trim()) {
    if (!silent) {
      try {
        const nm = await api.sendMessage({ chat_id: chatId, text: await tag('voiceNudge', T.voiceNudge) });
        if (nm?.message_id) await db.update(submissions).set({ noticeIds: [nm.message_id] }).where(eq(submissions.id, sub.id)).run().catch(() => {});
      } catch {}
    } else {
      await say(await tag('voiceNudge', T.voiceNudge));
    }
  }
  // Reply-prefix hold notice (appends to noticeIds — dies on Confirm/Cancel;
  // the Batal button reuses cancelconf, the clear button clears the gate).
  if (rplMark) {
    if (!silent) {
      try {
        const nm = await api.sendMessage({ chat_id: chatId, text: await tag('replyPrefixHold', T.replyPrefixHold(rplMark, REPLY_GUIDE_URL)),
          reply_markup: { inline_keyboard: [[{ text: T.rplClearBtn, callback_data: `rplclear_${sub.id}` }], [{ text: T.cancelBtn, callback_data: `cancelconf_${sub.id}` }]] } });
        if (nm?.message_id) {
          const cur = await db.select().from(submissions).where(eq(submissions.id, sub.id)).get().catch(() => null);
          const ids = Array.isArray(cur?.noticeIds) ? cur.noticeIds : [];
          await db.update(submissions).set({ noticeIds: [...ids, nm.message_id] }).where(eq(submissions.id, sub.id)).run().catch(() => {});
        }
      } catch {}
    } else {
      await say(await tag('replyPrefixHold', T.replyPrefixHold(rplMark, REPLY_GUIDE_URL)));
    }
  }
  // Group-link hold notice (same shape as reply-prefix: clear-or-cancel).
  if (grpMark) {
    if (!silent) {
      try {
        const nm = await api.sendMessage({ chat_id: chatId, text: await tag('grpHold', T.grpHold(grpMark, GROUP_LINK_URL)),
          reply_markup: { inline_keyboard: [[{ text: T.grpClearBtn, callback_data: `grpclear_${sub.id}` }], [{ text: T.cancelBtn, callback_data: `cancelconf_${sub.id}` }]] } });
        if (nm?.message_id) {
          const cur = await db.select().from(submissions).where(eq(submissions.id, sub.id)).get().catch(() => null);
          const ids = Array.isArray(cur?.noticeIds) ? cur.noticeIds : [];
          await db.update(submissions).set({ noticeIds: [...ids, nm.message_id] }).where(eq(submissions.id, sub.id)).run().catch(() => {});
        }
      } catch {}
    } else {
      await say(await tag('grpHold', T.grpHold(grpMark, GROUP_LINK_URL)));
    }
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
  // Reply-prefix soft gate: marker present and owner hasn't cleared it.
  // The cleared flag survives edits — clear once, Confirm freely after.
  if (!sub.rplCleared && detectReplyPrefix(sub.text ?? sub.caption ?? '')) {
    return { sub: null, error: T.replyPrefixErr };
  }
  // Group-link soft gate: flag-only (stored text is masked — URLs are gone —
  // so staging + edits own detection; Confirm just enforces the flag).
  if (!sub.grpCleared) {
    return { sub: null, error: T.grpErr };
  }
  // Low-effort re-check at Confirm (edits may have shrunk the text after
  // staging). Same hard block, same uncounted shape.
  if (LOWQ_BLOCK && !EXEMPT_IDS.includes(u.tgId)) {
    const lowTarget = (sub.text ?? sub.caption ?? '').trim();
    if (lowTarget && isLowQuality(lowTarget)) {
      return { sub: null, error: T.lowQ };
    }
  }
  if (sub.mediaKind !== 'text' && sub.mediaKind !== 'poll' && !(await mediaAllowed(u.tgId, u.id))) {
    return { sub: null, error: T.mediaLimit };
  }
  // Polls count as text for rate limits (they're reader-facing posts, not media).
  if (TEXT_LIMITS && (sub.mediaKind === 'text' || sub.mediaKind === 'poll')) {
    const tl = await textAllowed(u.tgId, u.id);
    if (!tl.ok) return { sub: null, error: T.textLimit(tl.which) };
  }
  // Caption gate: photo/video/document need context for readers. Voice gets a
  // nudge at staging instead; stickers carry no caption at all.
  if ((sub.mediaKind === 'photo' || sub.mediaKind === 'video' || sub.mediaKind === 'document') && !(sub.caption || '').trim()) {
    return { sub: null, error: T.needCaption };
  }
  let content;
  if (sub.mediaKind === 'text') {
    content = { kind: 'text', text: sub.text };
  } else if (sub.mediaKind === 'poll') {
    content = { kind: 'poll', text: sub.text, pollData: sub.pollData ?? null };
  } else {
    const p = await db.select().from(parts).where(eq(parts.submissionId, subId)).orderBy(parts.id).get().catch(() => null);
    if (!p) return { sub: null, error: 'Kandungan hilang — hantar semula.' };
    content = { kind: p.type, fileId: p.fileId, caption: sub.caption };
  }
  await db.update(submissions).set({ status: 'pending' }).where(eq(submissions.id, subId)).run();
  const kConf = kindOf(sub);
  const askTag = kConf === 'question' ? askCatLabel(sub) : null;
  const danaTag = kConf === 'dana' ? danaLabel(sub) : null;
  const base = danaTag ?? (kConf ? KIND_CARDS[kConf] : null);
  const cardTag = kConf ? base + (askTag ? ` · ${askTag}` : '') : ((sub.refId != null || sub.refMsgId != null) ? `↩️ Reply to ${sub.refId ? '#C' + sub.refId : 'post ' + sub.refMsgId}` : null);
  // Profanity flag for the card (channel gets the censored text; card keeps
  // the original so mods see intent).
  let profFlag = [];
  if (PROFANITY_MASK) {
    const ph = content.kind === 'poll'
      ? pollCensor(content.text ?? '', content.pollData).n
      : censorProfanity(content.text ?? content.caption ?? '').n;
    if (ph) profFlag = [ph > 1 ? `kesat×${ph}` : 'kesat'];
  }
  try {
    await postSingleToInbox(sub, u, content, profFlag, cardTag);
  } catch (e) {
    console.error('inbox post failed:', e?.description ?? e?.message ?? e);
    await db.update(submissions).set({ status: 'rejected' }).where(eq(submissions.id, subId)).run();
    return { sub: null, error: 'Inbox gagal.' };
  }
  try {
    const kk = kConf ?? 'confession';
    const midNite = await midnightActive().catch(() => false); // recomputed: clock may have flipped since staging
    const ackText = T.ackHead[kk] + '\n\n' + T.ackWarn + (midNite ? `\n\n${T.midnight}` : '') + `\n\n${T.refLine(sub.id)}` + ((u.tgId === SUPER_ADMIN_ID && await debugOn().catch(() => false)) ? `\n⚙️ #C${subId} · u${u.id} · ${kk} · pending` : '');
    // Threaded under the user's original message; plain fallback if it's gone.
    // Total failure is DM-visible (never silent — lesson 32).
    // The ack id is stored (ackMsgId) so reply-to-ack gets the short guide.
    let ackId = null;
    try {
      const am = await api.sendMessage({ chat_id: u.tgId, text: await tag(`ackHead.${kk}`, ackText), ...(sub.userMessageId ? { reply_parameters: { message_id: sub.userMessageId } } : {}) });
      ackId = am?.message_id ?? null;
    } catch {
      try {
        const am = await api.sendMessage({ chat_id: u.tgId, text: await tag(`ackHead.${kk}`, ackText) });
        ackId = am?.message_id ?? null;
      } catch {
        try {
          const am = await api.sendMessage({ chat_id: u.tgId, text: T.sentToAdmins(sub.id) });
          ackId = am?.message_id ?? null;
        } catch {}
      }
    }
    if (ackId) await db.update(submissions).set({ ackMsgId: ackId }).where(eq(submissions.id, subId)).run().catch(() => {});
    await bumpOut();
  } catch {}
  await sendMenu(u.tgId, T).catch(() => {});
  return { sub, error: null };
}

// Bot feedback (bug/idea → admin General as #F cards, never published).
// Own lightweight staging: ban + burst gates, text/photo/video only,
// split preview with fb_confirm_/fb_cancel_ row. Works during maintenance.
export async function submitFeedback({ from, chatId, messageId, content }) {
  const say = async (text) => { try { await api.sendMessage({ chat_id: chatId, text }); } catch {} };
  const u = await ensureUser({ from });
  if (!u) return { fb: null, error: 'Unknown user.' };
  const T = L(u);
  const fresh = await db.select().from(users).where(eq(users.tgId, from.id)).get();
  const { blocked } = await checkBan(fresh);
  if (blocked) {
    const err = T.blocked(blocked);
    await say(err);
    return { fb: null, error: err };
  }
  if (!['text', 'photo', 'video'].includes(content.kind)) {
    const err = T.unsupported;
    await say(err);
    return { fb: null, error: err };
  }
  if (!EXEMPT_IDS.includes(from.id)) {
    const b = await db.get(sql`SELECT COUNT(*) AS c FROM feedback WHERE user_id = ${u.id} AND created_at > unixepoch() - ${BURST_WINDOW_SEC} AND status != 'superseded'`).catch(() => ({ c: 0 }));
    if ((b?.c ?? 0) >= BURST_MSG_LIMIT) {
      const err = T.burst;
      await say(err);
      return { fb: null, error: err };
    }
  }
  // Low-effort hard block (same shape as confession staging: pre-insert, uncounted).
  if (LOWQ_BLOCK && !EXEMPT_IDS.includes(from.id)) {
    const lowTarget = (content.text ?? content.caption ?? '').trim();
    if (lowTarget && isLowQuality(lowTarget)) {
      const err = T.lowQ;
      await say(err);
      return { fb: null, error: err };
    }
  }
  // Single live draft (V1.7.0, feedback mirror): supersede older unconfirmed
  // reports, delete their preview bubbles best-effort.
  const priorsFb = await db.select().from(feedback)
    .where(and(eq(feedback.userId, u.id), eq(feedback.status, 'unconfirmed')))
    .orderBy(desc(feedback.id)).all().catch(() => []);
  const replacedFb = [];
  for (const p of priorsFb ?? []) {
    await db.update(feedback).set({ status: 'superseded' }).where(eq(feedback.id, p.id)).run().catch(() => {});
    replacedFb.push(`#F${p.id}`);
    for (const mid of [p.previewMsgId, p.actionMsgId].filter(Boolean)) {
      try { await api.deleteMessage({ chat_id: chatId, message_id: mid }); } catch {}
    }
  }
  let fb;
  try {
    const ins = await db.insert(feedback).values({
      userId: u.id, status: 'unconfirmed', mediaKind: content.kind,
      text: content.kind === 'text' ? (content.text ?? null) : null,
      caption: content.caption ?? null,
      fileId: content.fileId ?? null,
      userMessageId: messageId ?? null,
      version: VERSION,
    }).returning().run();
    fb = ins[0];
  } catch (e) {
    const err = 'Gagal simpan: ' + String(e?.description ?? e?.message ?? e).slice(0, 160);
    await say(err);
    return { fb: null, error: err };
  }
  if (replacedFb.length) await say(await tag('draftReplaced', T.draftReplaced(replacedFb.join(', '), `#F${fb.id}`)));
  // Split preview: content bubble + labeled action bubble (plain shape —
  // feedback previews never need rich styles).
  let previewId = null;
  try {
    if (content.kind === 'text') {
      const m = await api.sendMessage({ chat_id: chatId, text: (content.text ?? '').slice(0, 1000) || '(empty)' });
      previewId = m?.message_id ?? null;
    } else {
      const cap = (content.caption ?? '').slice(0, 900) || '(empty)';
      const m = content.kind === 'photo'
        ? await api.sendPhoto({ chat_id: chatId, photo: content.fileId, caption: cap })
        : await api.sendVideo({ chat_id: chatId, video: content.fileId, caption: cap });
      previewId = m?.message_id ?? null;
    }
    const am = await api.sendMessage({ chat_id: chatId, text: `${T.actionLead} ${T.fbPreview(fb.id)}:`,
      reply_markup: { inline_keyboard: [[{ text: T.confirmWord, callback_data: `fb_confirm_${fb.id}` }, { text: T.cancelBtn, callback_data: `fb_cancel_${fb.id}` }]] },
      ...(previewId ? { reply_parameters: { message_id: previewId } } : {}) });
    await db.update(feedback).set({ previewMsgId: previewId, actionMsgId: am?.message_id ?? null }).where(eq(feedback.id, fb.id)).run().catch(() => {});
    await bumpOut(2);
  } catch (e) {
    const err = 'Pratonton gagal: ' + String(e?.description ?? e?.message ?? e).slice(0, 160);
    await say(err);
    return { fb, error: err };
  }
  return { fb, error: null };
}

// Confirm a feedback report: flip to posted, #F card to General, threaded ack.
export async function confirmFeedback(fbId, confirmerTgId) {
  const fb = await db.select().from(feedback).where(eq(feedback.id, fbId)).get().catch(() => null);
  if (!fb || fb.status !== 'unconfirmed') return { fb: null, error: 'Hilang.' };
  const u = await db.select().from(users).where(eq(users.id, fb.userId)).get().catch(() => null);
  const T = L(u);
  if (!u || u.tgId !== confirmerTgId) return { fb: null, error: 'Bukan untuk anda.' };
  const { blocked } = await checkBan(u);
  if (blocked) {
    await db.update(feedback).set({ status: 'cancelled' }).where(eq(feedback.id, fbId)).run();
    return { fb: null, error: `Disekat (${blocked}).` };
  }
  await db.update(feedback).set({ status: 'posted' }).where(eq(feedback.id, fbId)).run();
  const aid = await cardWho(u).catch(() => null);
  const head = `#F${fbId} 📩 Feedback · 👤 ${aid ?? ('id' + u.tgId)} · ${fb.version ?? VERSION}`;
  const body = (fb.mediaKind === 'text' ? fb.text : fb.caption) ?? '(empty)';
  try {
    if (fb.mediaKind === 'photo') await api.sendPhoto({ chat_id: ADMIN_GROUP_ID, photo: fb.fileId, caption: `${head}\n\n${body}`.slice(0, 1024) });
    else if (fb.mediaKind === 'video') await api.sendVideo({ chat_id: ADMIN_GROUP_ID, video: fb.fileId, caption: `${head}\n\n${body}`.slice(0, 1024) });
    else await api.sendMessage({ chat_id: ADMIN_GROUP_ID, text: `${head}\n\n${body}`.slice(0, 4096) });
  } catch (e) {
    console.error('feedback post failed:', e?.description ?? e?.message ?? e);
    return { fb: null, error: 'Hantar gagal.' };
  }
  try {
    await api.sendMessage({ chat_id: u.tgId, text: T.feedbackAck(fbId), ...(fb.userMessageId ? { reply_parameters: { message_id: fb.userMessageId } } : {}) });
  } catch {
    try { await api.sendMessage({ chat_id: u.tgId, text: T.feedbackAck(fbId) }); } catch {}
  }
  await bumpOut();
  await sendMenu(u.tgId, T).catch(() => {});
  return { fb, error: null };
}

// Dedicated admin-chat topic (0 = not configured). Same General rule: id 1 → no param.
const chatThread = () => (!ADMIN_CHAT_TOPIC_ID || ADMIN_CHAT_TOPIC_ID === 1 ? {} : { message_thread_id: ADMIN_CHAT_TOPIC_ID });
// Deep link to the admin-chat topic (origin-thread confirmations point here
// when a chat is opened from elsewhere).
const chatTopicLink = () => (ADMIN_CHAT_TOPIC_ID && ADMIN_CHAT_TOPIC_ID !== 1)
  ? `https://t.me/c/${String(ADMIN_GROUP_ID).replace('-100', '')}/${ADMIN_CHAT_TOPIC_ID}` : null;

// Admin opens a chat with a user: reply-context or UID / raw id.
// Works from any group topic; answers land in the origin thread, the session
// marker lives in Topic 2. Banned users need /unban first (busy cap skipped).
async function cmdStartchat(msg, text, thread, inChatTopic) {
  const sender = msg.from?.id;
  if (!(await isAdmin(sender))) return;
  const replyId = msg.reply_to_message?.message_id ?? null;
  let target = null;
  if (replyId) {
    const m = await db.select().from(chatMap).where(eq(chatMap.adminMsgId, replyId)).get().catch(() => null);
    if (m) target = await db.select().from(users).where(eq(users.id, m.userId)).get().catch(() => null);
    // Reply-to-card: resolve the card's submission author too.
    if (!target) {
      const s = await submissionByReply(replyId).catch(() => null);
      if (s) target = await db.select().from(users).where(eq(users.id, s.userId)).get().catch(() => null);
    }
  }
  if (!target) {
    // Fallthrough: quoted sends (topic quotes, accidental replies) still
    // honor an explicit identity instead of dying on the map miss.
    const arg = text.slice(10).split('@')[0].trim().replace(/^#/, '');
    if (/^\d+$/.test(arg)) target = await db.select().from(users).where(eq(users.tgId, Number(arg))).get().catch(() => null);
    else if (arg) target = await resolveIdentity(arg).catch(() => null);
    else if (!arg) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...thread, text: 'Give the user UID — e.g. /startchat UID-001 (or reply to their card/message).' });
      return;
    } else if (!replyId) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...thread, text: 'Usage: /startchat <UID> — or reply to their message.' });
      return;
    } else {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...thread, text: 'No such chat.' });
      return;
    }
  }
  if (!target) {
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...thread, text: 'No such user.' });
    return;
  }
  const gateS = await checkBan(target);
  if (gateS.blocked) {
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...thread, text: `👤 ${await cardWho(target)} is banned — /unban first.` });
    return;
  }
  if (await openSessionRow(target)) {
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...thread, text: `Chat already open with ${await cardWho(target)}.` });
    return;
  }
  await db.insert(sessions).values({ userId: target.id, status: 'open' }).run().catch(() => {});
  await db.insert(audit).values({ adminId: sender, action: 'chat_start', targetUserId: target.id }).run().catch(() => {});
  let unreachable = false;
  try { await api.sendMessage({ chat_id: target.tgId, text: L(target).chatOpenedUser }); await bumpOut(); }
  catch { unreachable = true; }
  const markerA = await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `— 💬 chat opened with ${await cardWho(target)} (admin)${unreachable ? ' (user unreachable — blocked?)' : ''}\n↩️ Reply to this message to start chatting.`,
    reply_markup: { inline_keyboard: [[{ text: '✖ Close chat', callback_data: `endchat_${target.id}` }]] } });
  if (markerA?.message_id) await db.insert(chatMap).values({ adminMsgId: markerA.message_id, userId: target.id }).onConflictDoNothing().run().catch(() => {});
  if (!inChatTopic) {
    const link = chatTopicLink();
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...thread, text: `— 💬 chat opened with ${await cardWho(target)}${unreachable ? ' (user unreachable — blocked?)' : ''}${link ? ` — continue in Topic 2: ${link}` : ''}` }).catch(() => {});
  }
}

// Admin closes a chat: reply-context or UID / raw id. Origin-thread answers.
async function cmdEndSession(msg, text, thread) {
  const sender = msg.from?.id;
  if (!(await isAdmin(sender))) return;
  const replyId = msg.reply_to_message?.message_id ?? null;
  let target = null;
  if (replyId) {
    const m = await db.select().from(chatMap).where(eq(chatMap.adminMsgId, replyId)).get().catch(() => null);
    if (m) target = await db.select().from(users).where(eq(users.id, m.userId)).get().catch(() => null);
    // Reply-to-card: resolve the card's submission author too.
    if (!target) {
      const s = await submissionByReply(replyId).catch(() => null);
      if (s) target = await db.select().from(users).where(eq(users.id, s.userId)).get().catch(() => null);
    }
  } else {
    const arg = text.slice(16).split('@')[0].trim().replace(/^#/, '');
    if (/^\d+$/.test(arg)) target = await db.select().from(users).where(eq(users.tgId, Number(arg))).get().catch(() => null);
    else if (arg) target = await resolveIdentity(arg).catch(() => null);
    else {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...thread, text: 'Usage: /endadminsession <UID> — or reply to their message.' });
      return;
    }
  }
  if (!target) {
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...thread, text: 'No such chat.' });
    return;
  }
  await closeSession(target.id, sender);
  await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...thread, text: `— chat closed with ${await cardWho(target)} (admin)` });
  try { await api.sendMessage({ chat_id: target.tgId, text: L(target).chatClosedUser }); await bumpOut(); } catch {}
}

async function openSessionRow(u) {
  return db.select().from(sessions)
    .where(and(eq(sessions.userId, u.id), eq(sessions.status, 'open')))
    .get().catch(() => null);
}

export async function closeSession(userId, closedBy) {
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

// Discussion-group wiring test: a reply to an auto-forwarded channel post
// stages as an anonymous reply-confession (preview/confirm in the user's
// DM — needs /start once, else staging fails visibly at preview).
// Everything else in the group is ignored (chatter, nested comment replies,
// commands). NOTE: the group reply itself stays public under the user's own
// name — only the channel post is anonymous.
async function handleDiscussion(msg) {
  const rpl = msg.reply_to_message ?? null;
  if (!rpl) return;
  const fwdChat = rpl.forward_from_chat ?? (rpl.forward_origin?.type === 'channel' ? rpl.forward_origin.chat : null);
  const fwdMsgId = rpl.forward_from_message_id ?? rpl.forward_origin?.message_id ?? null;
  if (!fwdChat || Number(fwdChat.id) !== CHANNEL_ID || !fwdMsgId) return;
  const content = extractContent(msg);
  if (content.kind === 'unsupported' || content.kind === 'empty') return;
  if ((content.text ?? '').trim().startsWith('/')) return; // misfired command
  const dmId = msg.from?.id;
  if (!dmId) return;
  const refMsg = Number(fwdMsgId);
  const refSub = await confessionOfChannelMsg(refMsg).catch(() => null);
  await submitConfession({ from: msg.from, chatId: dmId, messageId: null, content, stripped: strippedFlags(msg), refId: refSub, refMsgId: refMsg });
  await flushStaleAlbums().catch(() => {});
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
  if (content.kind !== 'text' && content.kind !== 'photo' && content.kind !== 'video' && content.kind !== 'voice' && content.kind !== 'sticker' && content.kind !== 'document') {
    await api.sendMessage({ chat_id: dmChatId, text: T.unsupported });
    return;
  }
  const who = await cardWho(u);
  let postedId = null;
  try {
    if (content.kind === 'text') {
      const m = await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `💬 ${who}:\n${content.text ?? ''}`.slice(0, 4000) });
      postedId = m.message_id;
    } else if (content.kind === 'sticker') {
      const m = await api.sendSticker({ chat_id: ADMIN_GROUP_ID, ...chatThread(), sticker: content.fileId });
      postedId = m.message_id;
    } else {
      const cap = `💬 ${who}${content.caption ? '\n' + content.caption : ''}`.slice(0, 1024);
      const m = content.kind === 'photo'
        ? await api.sendPhoto({ chat_id: ADMIN_GROUP_ID, ...chatThread(), photo: content.fileId, caption: cap })
        : content.kind === 'video'
          ? await api.sendVideo({ chat_id: ADMIN_GROUP_ID, ...chatThread(), video: content.fileId, caption: cap })
          : content.kind === 'voice'
            ? await api.sendVoice({ chat_id: ADMIN_GROUP_ID, ...chatThread(), voice: content.fileId, caption: cap })
            : await api.sendDocument({ chat_id: ADMIN_GROUP_ID, ...chatThread(), document: content.fileId, caption: cap });
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
    const marker = await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `— 💬 chat opened with ${await cardWho(u)}\n↩️ Reply to this message to start chatting.`,
      reply_markup: { inline_keyboard: [[{ text: '✖ Close chat', callback_data: `endchat_${u.id}` }]] } });
    if (marker?.message_id) await db.insert(chatMap).values({ adminMsgId: marker.message_id, userId: u.id }).onConflictDoNothing().run().catch(() => {});
  } catch {}
  return T.openChatUser;
}

async function handleChatTopic(msg, text) {
  const T = STR[LANG] ?? STR.ms;
  const sender = msg.from?.id;
  if (msg.from?.is_bot) return;
  const replyId = msg.reply_to_message?.message_id ?? null;
  // Admin opens a chat with a user: shared command, works from any topic.
  if (text.startsWith('/startchat')) {
    await cmdStartchat(msg, text, threadOrInbox(ADMIN_CHAT_TOPIC_ID), true).catch(() => {});
    return;
  }
  // Admin closes a chat: shared command, works from any topic.
  if (text.startsWith('/endadminsession')) {
    await cmdEndSession(msg, text, threadOrInbox(ADMIN_CHAT_TOPIC_ID)).catch(() => {});
    return;
  }
  // Other slash commands route to the group router (never relayed to users).
  if (text.startsWith('/')) return handleAdminGroup(msg, text);
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
      await bumpOut();
    } catch {
      try {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `👤 ${await cardWho(target)} unreachable — blocked bot or deleted account.` });
      } catch {}
      return;
    }
    await db.insert(audit).values({ adminId: sender, action: 'chat_reply', targetUserId: target.id }).run().catch(() => {});
    return;
  }
  // Plain messages among admins: ignored.
}

// Owner broadcast draft (shared by group + owner-DM entry points). Origin chat
// rides in postMsgId so the blast report returns to where it was ordered.
async function draftAnnounce(chatId, thread, body, fromMsg) {
  if (!body) {
    await api.sendMessage({ chat_id: chatId, ...thread, text: 'Usage: /announce <text> — preview first, then Confirm to blast. /cancelannounce drops the draft.' });
    return;
  }
  const owner = await ensureUser(fromMsg);
  await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state = 'announce_draft'`).catch(() => {});
  const reach = await db.get(sql`SELECT COUNT(*) AS c FROM users WHERE banned = 0 AND dead = 0`).catch(() => ({ c: '?' }));
  const draft = await db.insert(pendingIntents).values({ userId: owner.id, state: 'announce_draft', text: body.slice(0, 3500), postMsgId: chatId }).returning().run().catch(() => null);
  const did = draft?.[0]?.id ?? null;
  if (!did) {
    await api.sendMessage({ chat_id: chatId, ...thread, text: 'Draft failed.' });
    return;
  }
  await api.sendMessage({ chat_id: chatId, ...thread,
    text: `📣 Announcement preview (to ~${reach?.c ?? '?'} users, banned/dead skipped):\n\n${body.slice(0, 3500)}`,
    reply_markup: { inline_keyboard: [[
      { text: 'Confirm blast', callback_data: `announce_go:${did}` },
      { text: 'Discard', callback_data: `announce_no:${did}` },
    ]] } });
}

async function dropAnnounce(chatId, thread, fromMsg) {
  const owner = await ensureUser(fromMsg);
  await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${owner.id} AND state = 'announce_draft'`).catch(() => {});
  await api.sendMessage({ chat_id: chatId, ...thread, text: 'Announcement draft dropped.' });
}

async function handleAdminGroup(msg, text) {
  const sender = msg.from?.id;
  const threadId = msg.message_thread_id ?? null;
  await flushQueue(false).catch(() => {}); // drip-feed: release due queued posts (no-op when DRIP_FEED off)
  // Owner-only mass mention: trigger groupwide, blast lands in General (never
  // Topic 2). Non-owners get silence (mirrors the anonymous-admin rule).
  if (text.startsWith('!all') || text.startsWith('!active')) {
    if (sender !== SUPER_ADMIN_ID) return;
    const greensOnly = text.startsWith('!active');
    const note = (greensOnly ? text.slice(7) : text.slice(4)).trim();
    const act = greensOnly ? 'mention_active' : 'mention_all';
    const members = await groupAdmins().catch(() => []);
    if (!members.length) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'No admins found.' });
      return;
    }
    let targets = members;
    let fallback = false;
    if (greensOnly) {
      const greens = await dutyGreens().catch(() => new Set());
      const on = members.filter((m) => greens.has(m.id));
      if (on.length) targets = on;
      else fallback = true;
    }
    // Offsets are UTF-16 units on both sides — compute from the same string.
    let body = `📢${note ? ' ' + note : ''}\n`;
    if (fallback) body += `⚠️ No one on duty — pinged all.\n`;
    const entities = [];
    for (const m of targets) {
      const disp = adminDisplay(m);
      const at = body.length;
      body += `${disp}\n`;
      if (!m.username) entities.push({ type: 'text_mention', offset: at, length: disp.length, user: { id: m.id, first_name: m.name } });
    }
    try {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, text: body, ...(entities.length ? { entities } : {}) });
    } catch {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, text: body }).catch(() => {});
    }
    await db.insert(audit).values({ adminId: sender, action: act, targetUserId: null, reason: note.slice(0, 120) || null }).run().catch(() => {});
    return;
  }
  // Chat commands work from every topic (origin-thread answers inside).
  if (text.startsWith('/startchat')) {
    await cmdStartchat(msg, text, threadOrInbox(threadId), threadId === ADMIN_CHAT_TOPIC_ID).catch(() => {});
    return;
  }
  if (text.startsWith('/endadminsession')) {
    await cmdEndSession(msg, text, threadOrInbox(threadId)).catch(() => {});
    return;
  }
  if (text.startsWith('/announce')) {
    if (sender !== SUPER_ADMIN_ID) return;
    await draftAnnounce(ADMIN_GROUP_ID, threadOrInbox(threadId), text.slice(9).trim(), msg);
    return;
  }
  if (text.startsWith('/cancelannounce')) {
    if (sender !== SUPER_ADMIN_ID) return;
    await dropAnnounce(ADMIN_GROUP_ID, threadOrInbox(threadId), msg);
    return;
  }
  if (text.startsWith('/onduty')) {
    if (!(await isAdmin(sender))) return;
    const cur = await db.select().from(duty).where(eq(duty.tgId, sender)).get().catch(() => null);
    const nowOn = !(cur?.on);
    if (cur) await db.update(duty).set({ on: nowOn ? 1 : 0, updated: sql`(unixepoch())` }).where(eq(duty.id, cur.id)).run().catch(() => {});
    else await db.insert(duty).values({ tgId: sender, on: 1 }).run().catch(() => {});
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId),
      text: nowOn ? 'You are on duty 🟢 — !active will ping you.' : 'Off duty ⚪ — !active will skip you (!all still pings everyone).' });
    return;
  }
  if (text.startsWith('/dutyroster')) {
    if (!(await isAdmin(sender))) return;
    const members = await groupAdmins().catch(() => []);
    const rows = await db.select().from(duty).all().catch(() => []);
    const flag = new Map((rows ?? []).map((r) => [Number(r.tgId), r]));
    const now = Math.floor(Date.now() / 1000);
    const stale = (r) => {
      const u = r?.updated instanceof Date ? Math.floor(r.updated.getTime() / 1000) : Number(r?.updated) || now;
      return Math.floor((now - u) / 86400);
    };
    const fmt = (m) => {
      const r = flag.get(m.id);
      const extra = r?.on ? (stale(r) >= 7 ? ` ⏳ ${stale(r)}d` : '') : '';
      return `${adminDisplay(m)}${extra}`;
    };
    const on = members.filter((m) => flag.get(m.id)?.on);
    const off = members.filter((m) => !flag.get(m.id)?.on);
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId),
      text: `🟢 On duty (${on.length})\n${on.map((m) => '• ' + fmt(m)).join('\n') || '—'}\n⚪ Off (${off.length})\n${off.map((m) => '• ' + fmt(m)).join('\n') || '—'}` });
    return;
  }
  if (text.startsWith('/oldest')) {
    if (!(await isAdmin(sender))) return;
    const pg = await oldestPage(0).catch(() => null);
    if (!pg) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Queue lookup failed.' });
      return;
    }
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: pg.text, ...(pg.buttons ? { reply_markup: pg.buttons } : {}) });
    return;
  }
  if (text.startsWith('/tutorial')) {
    if (!(await isAdmin(sender))) return;
    const T = STR.en ?? STR.ms;
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `${T.atutTitle(0)}\n${T.atutSteps[0]}`, reply_markup: atutRow(0, T.atutSteps.length) });
    return;
  }
  if (text.startsWith('/notes')) {
    if (!(await isAdmin(sender))) return;
    const rows = await db.all(sql`SELECT n.user_id AS uid, n.text AS txt, n.admin_id AS aid, n.created_at AS at, n.submission_id AS sub, u.anum AS anum, s.status AS st FROM notes n LEFT JOIN users u ON u.id = n.user_id LEFT JOIN submissions s ON s.id = n.submission_id ORDER BY n.id DESC LIMIT 30`).catch(() => []);
    if (!rows?.length) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'No active notes.' });
      return;
    }
    const members = await groupAdmins().catch(() => []);
    const names = new Map((members ?? []).map((m) => [m.id, m]));
    const now = Math.floor(Date.now() / 1000);
    const age = (v) => {
      const s = Math.max(0, now - (v instanceof Date ? Math.floor(v.getTime() / 1000) : Number(v) || now));
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
      return `${Math.floor(s / 86400)}d ago`;
    };
    const lines = rows.map((r) => {
      const m = names.get(Number(r.aid));
      const by = m ? adminDisplay(m) : `id${r.aid}`;
      const head = r.sub != null ? `#C${r.sub}${r.st ? ` (${r.st})` : ''}` : `👤 ${r.anum ?? '?'}`;
      return `• ${head} — “${String(r.txt ?? '').slice(0, 120)}”\n  ${by}, ${age(r.at)}`;
    });
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId),
      text: `📝 Active notes (${rows.length}${rows.length >= 30 ? ', first 30' : ''})\n${lines.join('\n')}` });
    return;
  }
  if (text.startsWith('/note') || text.startsWith('/unnote')) {
    if (!(await isAdmin(sender))) return;
    const isUn = text.startsWith('/unnote');
    // Menu-tapped commands arrive as /note@BotName — strip the suffix first.
    const raw = (isUn ? text.slice(7) : text.slice(5)).trim().replace(/^@\S+\s*/, '');
    const rpl = msg.reply_to_message ?? null;
    let rplSub = rpl ? await submissionByReply(rpl.message_id) : null;
    if (rpl && !rplSub) {
      // Fallback: the reply preview itself quotes the card (`#C117`) — the
      // replied bubble (content/action copy) may never have been stored.
      const m = /#C(\d+)/.exec(`${rpl.text ?? ''}\n${rpl.caption ?? ''}`);
      if (m) rplSub = await db.select().from(submissions).where(eq(submissions.id, Number(m[1]))).get().catch(() => null);
    }
    const first = raw.split(/\s+/)[0] ?? '';
    // Card note: `#C<num> <text>` anywhere, or reply + non-identity text.
    // Author note: `<UID|alias> <text>` (reply + identity also works).
    let cardSub = null;
    let target = null;
    let body = raw;
    if (/^#?C\d+$/i.test(first)) {
      cardSub = await db.select().from(submissions).where(eq(submissions.id, Number(first.replace(/^#?C/i, '')))).get().catch(() => null);
      body = raw.slice(first.length).trim();
      if (!cardSub) {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'No such submission.' });
        return;
      }
    } else if (rplSub) {
      const sp = raw.indexOf(' ');
      const idPart = sp < 0 ? raw : raw.slice(0, sp);
      const maybe = idPart ? await resolveUser(idPart) : null;
      if (maybe) {
        target = maybe;
        body = sp < 0 ? '' : raw.slice(sp + 1).trim();
      } else {
        cardSub = rplSub;
        body = raw;
      }
    } else {
      const sp = raw.indexOf(' ');
      const idPart = sp < 0 ? raw : raw.slice(0, sp);
      body = sp < 0 ? '' : raw.slice(sp + 1).trim();
      if (idPart) target = await resolveUser(idPart);
    }
    const byMember = await lookupAdmin(sender).catch(() => null);
    const byLine = byMember ? adminDisplay(byMember) : 'admin';
    if (isUn) {
      // Reply → clear card notes on that card (delete thread replies too).
      // Identity → clear the author note.
      if (cardSub) {
        const rows = await db.select().from(notes).where(eq(notes.submissionId, cardSub.id)).all().catch(() => []);
        for (const n of rows ?? []) {
          if (n.cardMsgId) { try { await api.deleteMessage({ chat_id: ADMIN_GROUP_ID, message_id: n.cardMsgId }); } catch {} }
          await db.delete(notes).where(eq(notes.id, n.id)).run().catch(() => {});
        }
        await db.insert(audit).values({ adminId: sender, action: 'unnote', targetUserId: cardSub.userId, reason: `card notes cleared on #C${cardSub.id}` }).run().catch(() => {});
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `📝 Card notes cleared on #C${cardSub.id}.` });
        return;
      }
      if (!target) {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Usage: reply to a card, or /unnote <UID> · /unnote #C<id>.' });
        return;
      }
      const aid = await cardWho(target).catch(() => '?');
      const mine = await db.select().from(notes).where(eq(notes.userId, target.id)).all().catch(() => []);
      for (const n of (mine ?? []).filter((r) => r.submissionId == null)) {
        await db.delete(notes).where(eq(notes.id, n.id)).run().catch(() => {});
      }
      await db.insert(audit).values({ adminId: sender, action: 'unnote', targetUserId: target.id, reason: `cleared for ${aid}` }).run().catch(() => {});
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `📝 Author note cleared for 👤 ${aid}.` });
      return;
    }
    if (cardSub) {
      if (!body) {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Usage: reply with /note <text>, or /note #C<id> <text>.' });
        return;
      }
      const t = body.slice(0, 300);
      let noteMsg = null;
      try {
        const sent = await api.sendMessage({ chat_id: ADMIN_GROUP_ID,
          ...(cardSub.inboxCardId ? { reply_parameters: { message_id: cardSub.inboxCardId } } : {}),
          text: `📝 Note on #C${cardSub.id}: ${t}\n— ${byLine}` });
        noteMsg = sent?.message_id ?? null;
      } catch {
        try {
          const sent = await api.sendMessage({ chat_id: ADMIN_GROUP_ID, text: `📝 Note on #C${cardSub.id}: ${t}\n— ${byLine}` });
          noteMsg = sent?.message_id ?? null;
        } catch {}
      }
      await db.insert(notes).values({ userId: cardSub.userId, adminId: sender, text: t, submissionId: cardSub.id, cardMsgId: noteMsg }).run().catch(() => {});
      await db.insert(audit).values({ adminId: sender, action: 'note', targetUserId: cardSub.userId, reason: `on #C${cardSub.id}` }).run().catch(() => {});
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `📝 Note pinned on #C${cardSub.id}.` });
      return;
    }
    if (!target || !body) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Usage: reply with /note <text> (card note), or /note <UID> <text> (author note).' });
      return;
    }
    const t = body.slice(0, 300);
    const aid = await cardWho(target).catch(() => '?');
    const mine = await db.select().from(notes).where(eq(notes.userId, target.id)).all().catch(() => []);
    const ex = (mine ?? []).find((r) => r.submissionId == null);
    if (ex) await db.update(notes).set({ text: t, adminId: sender }).where(eq(notes.id, ex.id)).run().catch(() => {});
    else await db.insert(notes).values({ userId: target.id, adminId: sender, text: t }).run().catch(() => {});
    await db.insert(audit).values({ adminId: sender, action: 'note', targetUserId: target.id, reason: `set for ${aid}` }).run().catch(() => {});
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `📝 Author note ${ex ? 'updated' : 'set'} for 👤 ${aid}:\n${t}` });
    return;
  }
  if (text.startsWith('/recent')) {
    if (!(await isAdmin(sender))) return;
    const nArg = text.slice(7).trim().match(/^(\d+)$/);
    const n = Math.min(30, Math.max(1, nArg ? Number(nArg[1]) : 10));
    const tail = await db.all(sql`SELECT admin_id, action, reason, created_at FROM audit ORDER BY id DESC LIMIT ${n}`).catch(() => []);
    if (!tail?.length) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'No mod actions yet.' });
      return;
    }
    const members = await groupAdmins().catch(() => []);
    const names = new Map((members ?? []).map((m) => [m.id, m.username ? '@' + m.username : m.name]));
    const now = Math.floor(Date.now() / 1000);
    const rel = (v) => {
      const s = Math.max(0, now - (v instanceof Date ? Math.floor(v.getTime() / 1000) : Number(v) || now));
      if (s < 60) return `${s}s ago`;
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
      return `${Math.floor(s / 86400)}d ago`;
    };
    const lines = tail.map((r) => {
      const aid = Number(r.admin_id);
      const m = names.get(aid);
      const who = aid === 0 ? 'system' : (m ? adminDisplay(m) : `id${r.admin_id}`);
      return `• ${rel(r.created_at)} — ${who}: ${r.action}${r.reason ? ` ${r.reason}` : ''}`;
    });
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `🕘 Recent mod actions\n${lines.join('\n')}` });
    return;
  }
  if (text.startsWith('/adminstats')) {
    if (!(await isAdmin(sender))) return;
    const arg = text.slice(11).trim().toLowerCase();
    const m = arg.match(/^(\d+)\s*d?$/);
    const days = arg === 'all' ? 0 : (m ? Number(m[1]) : 30);
    const label = days === 0 ? 'all' : `${days}d`;
    const members = await groupAdmins().catch(() => []);
    const out = await adminStatsText(days, label, members, await dutyGreens().catch(() => null), await crownMap().catch(() => null)).catch(() => 'Stats failed.');
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: out, reply_markup: astatsRow(days) });
    return;
  }
  // Owner-only monthly crown (bot-side honor — Telegram only lets the bot set
  // titles for admins it promoted itself, so no custom titles; holders get
  // 👑/⚡ markers in /adminstats instead). Same admin both → overall winner.
  // Silent for non-owners, like !all.
  if (text.startsWith('/crown')) {
    if (sender !== SUPER_ADMIN_ID) return;
    const lead = await crownLeaders(SUPER_ADMIN_ID).catch(() => null);
    if (!lead || (!lead.actions && !lead.triage)) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: '👑 No admin actions in the last 30d — no crown.' });
      return;
    }
    const members = await groupAdmins().catch(() => []);
    const names = new Map((members ?? []).map((m) => [m.id, m]));
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const mLabel = `${MON[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
    const mKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const overall = lead.actions && lead.triage && lead.actions.aid === lead.triage.aid;
    const wins = overall
      ? [{ aid: lead.actions.aid, cat: 'overall', title: '👑 Top Mod',
           stat: `${lead.actions.total} actions · ⏱️ ${lead.triage.medTxt} median`, head: 'overall winner' }]
      : [
          ...(lead.actions ? [{ aid: lead.actions.aid, cat: 'actions', title: '👑 Most Active',
            stat: `${lead.actions.total} actions in 30d`, head: 'most actions' }] : []),
          ...(lead.triage ? [{ aid: lead.triage.aid, cat: 'triage', title: '⚡ Fastest',
            stat: `⏱️ ${lead.triage.medTxt} median (${lead.triage.total} actions)`, head: 'fastest triage' }] : []),
        ];
    await db.run(sql`DELETE FROM crowns`).catch(() => {});
    for (const w of wins) {
      await db.insert(crowns).values({ category: w.cat, tgId: w.aid, month: mKey, title: w.title }).run().catch(() => {});
    }
    let body = `👑 Monthly crown — ${mLabel}\n`;
    const entities = [];
    for (const w of wins) {
      const m = names.get(w.aid);
      const disp = m ? adminDisplay(m) : `id${w.aid}`;
      const at = body.length;
      body += `\n${w.title} ${disp} — ${w.head}\n${w.stat}\n`;
      if (m && !m.username) entities.push({ type: 'text_mention', offset: at + w.title.length + 2, length: disp.length, user: { id: m.id, first_name: m.name } });
    }
    body += `\nHolders carry 👑/⚡ in /adminstats.`;
    try {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: body, ...(entities.length ? { entities } : {}) });
    } catch {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: body }).catch(() => {});
    }
    await db.insert(audit).values({ adminId: sender, action: 'crown', targetUserId: null, reason: wins.map((w) => `${w.cat}:${w.aid}`).join(',') || null }).run().catch(() => {});
    return;
  }
  // Owner-only maintenance toggle: pauses NEW staging (review side runs on).
  // Bare = status. EXEMPT users bypass the pause (owner can still test).
  if (text.startsWith('/maintenance')) {
    if (sender !== SUPER_ADMIN_ID) return;
    const arg = text.slice(12).trim().toLowerCase();
    if (arg === 'on' || arg === 'off') {
      await setMaint(arg === 'on').catch(() => {});
      await db.insert(audit).values({ adminId: sender, action: 'maintenance', targetUserId: null, reason: arg }).run().catch(() => {});
    }
    const on = await maintOn().catch(() => false);
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId),
      text: on ? '🛠️ Maintenance ON — new submissions paused (review side runs on). /maintenance off to resume.' : '✅ Maintenance OFF — submissions open.' });
    return;
  }
  // Owner-only midnight override: auto (clock) / on / off. Bare = status.
  if (text.startsWith('/midnight')) {
    if (sender !== SUPER_ADMIN_ID) return;
    const arg = text.slice(9).trim().toLowerCase();
    if (arg === 'on' || arg === 'off' || arg === 'auto') {
      await setMidnight(arg).catch(() => {});
      await db.insert(audit).values({ adminId: sender, action: 'midnight', targetUserId: null, reason: arg }).run().catch(() => {});
    }
    const row = await db.select().from(meta).where(eq(meta.key, 'midnight')).get().catch(() => null);
    const mode = !row ? 'auto (clock)' : row.value === '1' ? 'forced ON' : 'forced OFF';
    const active = await midnightActive().catch(() => false);
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId),
      text: `🌙 Midnight: ${mode} — notice ${active ? 'SHOWING (12–7am MYT window)' : 'off'}.` });
    return;
  }
  // Owner-only debug switch + full #C dump (dump lands in owner DM).
  if (text.startsWith('/debugmode')) {
    if (sender !== SUPER_ADMIN_ID) return;
    const arg = text.slice(11).trim().toLowerCase();
    if (arg === 'on' || arg === 'off') {
      await setDebug(arg === 'on').catch(() => {});
      await db.insert(audit).values({ adminId: sender, action: 'debugmode', targetUserId: null, reason: arg }).run().catch(() => {});
    }
    const on = await debugOn().catch(() => false);
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId),
      text: on ? '⚙️ Debug ON — cards carry id markers (no tg_id on surfaces).' : '⚙️ Debug OFF.' });
    return;
  }
  if (text.startsWith('/debuginfo')) {
    if (sender !== SUPER_ADMIN_ID) return;
    const arg = text.slice(10).trim().replace(/^#C?/i, '');
    if (!/^\d+$/.test(arg)) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Usage: /debuginfo #C<id>.' });
      return;
    }
    const dump = await debugDump(Number(arg)).catch(() => null);
    try { await api.sendMessage({ chat_id: sender, text: dump ?? 'Nothing found.' }); } catch {}
    try { await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `⚙️ #C${arg} dump sent to your DM.` }); } catch {}
    return;
  }
  if (text.startsWith('/botstats')) {
    if (!(await isAdmin(sender))) return;
    const out = await botStatsText().catch(() => 'Stats failed.');
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: out });
    return;
  }
  // Owner-only paid alias: /setcid <UID|alias|tg-id> <Name> · /clearcid <id>.
  if (text.startsWith('/setcid') || text.startsWith('/clearcid')) {
    if (sender !== SUPER_ADMIN_ID) return;
    const clear = text.startsWith('/clearcid');
    const rest = (clear ? text.slice(9) : text.slice(7)).trim().split(/\s+/);
    const target = await resolveIdentity(rest[0] ?? '').catch(() => null);
    if (!target) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: clear ? 'Usage: /clearcid <UID|alias|tg-id>.' : 'Usage: /setcid <UID|alias|tg-id> <Name>.' });
      return;
    }
    if (clear) {
      await db.update(users).set({ alias: null }).where(eq(users.id, target.id)).run().catch(() => {});
      await db.insert(audit).values({ adminId: sender, action: 'alias_clear', targetUserId: target.id }).run().catch(() => {});
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `🏷️ Alias cleared — back to ${await aidOf(target)}.` });
      return;
    }
    const name = rest.slice(1).join(' ');
    const problem = aliasProblem(name);
    if (problem) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `🏷️ Rejected: ${problem}` });
      return;
    }
    const dupe = await db.all(sql`SELECT id FROM users WHERE alias IS NOT NULL AND LOWER(alias) = ${String(name).toLowerCase()}`).catch(() => []);
    if ((dupe ?? []).some((r) => r.id !== target.id)) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: '🏷️ Taken — pick another.' });
      return;
    }
    const r = await db.update(users).set({ alias: String(name).trim() }).where(eq(users.id, target.id)).run().catch(() => null);
    if (!r) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: '🏷️ Save failed (unique clash?) — try again.' });
      return;
    }
    await db.insert(audit).values({ adminId: sender, action: 'alias_set', targetUserId: target.id, reason: String(name).trim().slice(0, 60) }).run().catch(() => {});
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `🏷️ ${await aidOf(target)} is now “${String(name).trim()}”.` });
    return;
  }
  // Owner-only FAQ sync: Sheet CSV → faq replica. Silent for others.
  if (text.startsWith('/faqsync')) {
    if (sender !== SUPER_ADMIN_ID) return;
    const r = await syncFaq().catch(() => ({ ok: false, error: 'sync crashed' }));
    await db.insert(audit).values({ adminId: sender, action: 'faqsync', targetUserId: null, reason: r.ok ? `+${r.added} ~${r.updated} -${r.deactivated} (${r.active}/${r.total} active)` : `FAILED: ${r.error}` }).run().catch(() => {});
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId),
      text: r.ok ? `📖 FAQ synced — ${r.total} rows (${r.active} active): +${r.added} new, ~${r.updated} updated, -${r.deactivated} pruned.` : `📖 FAQ sync failed: ${r.error ?? 'unknown'}` });
    return;
  }
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
    const tables = { users, submissions, parts, appeals, pendingIntents, edits, sessions, chatMap, replyMap, audit, hits, notes, duty, dayOut };
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
  // Reply templates: reply to a card (or /tpl #C) → picker → threaded relay.
  // Text only; paired /ban steps stay manual (ban DMs already notify).
  if (text.startsWith('/tpl')) {
    if (!(await isAdmin(sender))) return;
    let sub = null;
    if (replyId) sub = await submissionByReply(replyId).catch(() => null);
    if (!sub) {
      const arg = text.slice(4).trim().replace(/^#/, '').replace(/^C/i, '');
      if (/^\d+$/.test(arg)) sub = await db.select().from(submissions).where(eq(submissions.id, Number(arg))).get().catch(() => null);
    }
    if (!sub) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Usage: reply to a card with /tpl, or /tpl #C<id>.' });
      return;
    }
    const rows = [
      [{ text: 'Iklan warn', callback_data: `tpl_pick:${sub.id}:iklan1` }, { text: 'Iklan final', callback_data: `tpl_pick:${sub.id}:iklan2` }],
      [{ text: 'Reply warn', callback_data: `tpl_pick:${sub.id}:reply1` }, { text: 'Reply final', callback_data: `tpl_pick:${sub.id}:reply2` }],
      [{ text: 'Mention name', callback_data: `tpl_pick:${sub.id}:mention` }, { text: 'Alasan reject', callback_data: `tpl_pick:${sub.id}:reject` }],
      [{ text: 'Help contact', callback_data: `tpl_pick:${sub.id}:helpContact` }, { text: 'Help screenshot', callback_data: `tpl_pick:${sub.id}:helpShot` }],
    ];
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `📋 Reply templates — tap to send to #C${sub.id}:`, reply_markup: { inline_keyboard: rows } });
    return;
  }
  // Custom verdict message: reply to a card with /msg <text> → threaded DM.
  // No status change (pairs with Reject/Warn/Ban or stands alone).
  if (text.startsWith('/msg')) {
    if (!(await isAdmin(sender))) return;
    const body = text.slice(4).trim();
    const sub = replyId ? await submissionByReply(replyId).catch(() => null) : null;
    if (!sub || !body) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Usage: reply to a card with /msg <text>.' });
      return;
    }
    const target = await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
    if (!target) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'No such user.' });
      return;
    }
    try {
      if (target) {
        if (sub.userMessageId) await api.sendMessage({ chat_id: target.tgId, text: body, reply_parameters: { message_id: sub.userMessageId } });
        else await api.sendMessage({ chat_id: target.tgId, text: body });
        await bumpOut();
      }
    } catch {}
    await db.insert(audit).values({ adminId: sender, action: 'msg_custom', targetUserId: target.id, reason: `#C${sub.id}: ${body.slice(0, 120)}` }).run().catch(() => {});
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `✉️ Custom message sent for #C${sub.id}.` });
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
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'No such user — /list <UID> (e.g. /list UID-003).' });
      return;
    }
    const pg = await listPage(u, 0);
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: pg.text, ...(pg.buttons ? { reply_markup: pg.buttons } : {}) });
    return;
  }
  if (text.startsWith('/changelog')) {
    if (!(await isAdmin(sender))) return;
    const last = [...CHANGELOG].slice(-5).reverse();
    const lines = last.map((e) => `• V${e.v} (${e.date})\n  ${e.en}`);
    await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `🤖 Bot version ${VERSION}\n${lines.join('\n')}` });
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
      const tg = await tgLift(target.tgId).catch(() => []);
      const tgNote = tg.length ? ` · ${tg.join(',')}` : '';
      await db.insert(audit).values({ adminId: sender, action: 'unban', targetUserId: target.id, reason: tgNote || null }).run();
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `Unbanned ${await cardWho(target)}.${tgNote}` });
      try { await api.sendMessage({ chat_id: target.tgId, text: (STR[LANG] ?? STR.ms).unblocked }); await bumpOut(); } catch {}
      return;
    }
    if (!replyId) {
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: 'Reply to a card: /ban <duration> <reason> [group|channel|all].' });
      return;
    }
    let { until, reason } = parseBanArgs(text.slice(4));
    // Optional trailing scope token (bot default): group = full group ban,
    // channel = channel ban, all = both. Tier auto-bans choose their own.
    let scope = 'bot';
    const sm = reason.match(/\s+(group|channel|all)$/i);
    if (sm) {
      const w = sm[1].toLowerCase();
      scope = w === 'group' ? 'ban-group' : w === 'channel' ? 'ban-channel' : 'ban-all';
      reason = reason.slice(0, sm.index).trim() || 'no reason';
    }
    await applyBan(target, sender, threadId ?? INBOX_TOPIC_ID, until, reason, scope);
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
    const rtext = `${(STR[LANG] ?? STR.ms).adminHead(sub.id)}\n${msg.text}`.slice(0, 4000);
    const rthread = sub.userMessageId ? { reply_parameters: { message_id: sub.userMessageId } } : {};
    try {
      try {
        const sent = await api.sendMessage({ chat_id: target.tgId, text: rtext, ...rthread });
        sentId = sent?.message_id ?? null;
      } catch {
        const sent = await api.sendMessage({ chat_id: target.tgId, text: rtext });
        sentId = sent?.message_id ?? null;
      }
      await bumpOut();
    } catch {
      // Unreachable: user blocked the bot or deleted the account.
      await markDeadByTg(target.tgId);
      // Post the id visibly — no reaction noise on success.
      try {
        await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...threadOrInbox(threadId), text: `👤 ${await cardWho(target)} unreachable — blocked bot or deleted account. (#C${sub.id})` });
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
// Layout: confession → ask/LF → iklan/event/dana → divider → chat/channel/rules
// → help/tutorial. The inline shape uses a noop separator row (rich divider).
function startGrid(T) {
  return {
    rich: [
      { type: 'buttons', align: 'center', buttons: [
        { text: T.btnSend, callback_data: 'send_conf' },
      ] },
      { type: 'buttons', align: 'center', buttons: [
        { text: T.btnAsk, callback_data: 'ask_q' },
        { text: T.btnLF, callback_data: 'lostfound' },
      ] },
      { type: 'buttons', align: 'center', buttons: [
        { text: T.btnIklan, callback_data: 'iklan_info' },
        { text: T.btnEvent, callback_data: 'event_info' },
        { text: T.btnDana, callback_data: 'dana_new' },
      ] },
      { type: 'buttons', align: 'center', buttons: [
        { text: T.btnSuggest, callback_data: 'suggest_new' },
        { text: T.btnInfo, callback_data: 'info_new' },
      ] },
      { type: 'divider' },
      { type: 'buttons', align: 'center', buttons: [
        { text: T.btnChat, callback_data: 'go_chat' },
        ...(CHANNEL_URL ? [{ text: '📢 Channel', url: CHANNEL_URL }] : []),
        { text: T.btnRules, url: TERMS_URL },
      ] },
      { type: 'buttons', align: 'center', buttons: [
        { text: T.btnHelp, callback_data: 'grid_help' },
        { text: T.btnTut, callback_data: 'grid_tut' },
      ] },
      { type: 'buttons', align: 'center', buttons: [
        { text: T.btnFeedback, callback_data: 'feedback_new' },
      ] },
    ],
    markup: { inline_keyboard: [[
      { text: T.btnSend, callback_data: 'send_conf' },
    ], [
      { text: T.btnAsk, callback_data: 'ask_q' },
      { text: T.btnLF, callback_data: 'lostfound' },
    ], [
      { text: T.btnIklan, callback_data: 'iklan_info' },
      { text: T.btnEvent, callback_data: 'event_info' },
      { text: T.btnDana, callback_data: 'dana_new' },
    ], [
      { text: T.btnSuggest, callback_data: 'suggest_new' },
      { text: T.btnInfo, callback_data: 'info_new' },
    ], [
      { text: '────────', callback_data: 'menu_noop' },
    ], [
      { text: T.btnChat, callback_data: 'go_chat' },
      ...(CHANNEL_URL ? [{ text: '📢 Channel', url: CHANNEL_URL }] : []),
      { text: T.btnRules, url: TERMS_URL },
    ], [
      { text: T.btnHelp, callback_data: 'grid_help' },
      { text: T.btnTut, callback_data: 'grid_tut' },
    ], [
      { text: T.btnFeedback, callback_data: 'feedback_new' },
    ]] },
  };
}

// Uniform cancel ending: notice text, then the menu bubble. All Batal and
// /cancel* paths end here so exits never strand the user without navigation.
export async function cancelEnd(chatId, T, text) {
  try { await api.sendMessage({ chat_id: chatId, text }); } catch {}
  await sendMenu(chatId, T).catch(() => {});
}

// Compact menu (header + grid) — sent after Cancel. Header rides a
// single centered table cell (paragraphs render left-aligned). opts.silent
// pings less (used for the /start follow-up bubble).
export async function sendMenu(chatId, T, opts = {}) {
  const g = startGrid(T);
  const quiet = opts.silent ? { disable_notification: true } : {};
  try {
    await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [{ type: 'table', is_bordered: false, cells: [[{ text: T.menuHead, align: 'center', valign: 'middle' }]] }, ...g.rich] }, ...quiet });
  } catch {
    await api.sendMessage({ chat_id: chatId, text: T.menuHead, reply_markup: g.markup, ...quiet }).catch(() => {});
  }
}

// Onboarding sender (locale passed in — first-run picker and /changelanguage
// choose it, /start reuses the saved one). Split bubbles: onboarding text
// first, menu second (silent) — same menu both shapes see everywhere.
export async function sendStart(chatId, from, T) {
  const safeName = (from.first_name || from.username || 'kawan').replace(/[<>&]/g, '').slice(0, 40);
  const headText = T.startHead(safeName);
  // Own UID under the greeting (DM-only, zero leak; lazy-assigns if missing).
  const uRow = await db.select().from(users).where(eq(users.tgId, from.id)).get().catch(() => null);
  const ownAid = uRow ? await dispAid(uRow).catch(() => null) : null;
  const headAid = uRow?.alias ? (ownAid ? `\n${T.myCuid(ownAid)}` : '') : (ownAid ? `\n${T.myAid(ownAid)}` : '');
  const bodyText = T.startBody({
    limits: T.limitsLine({ media: DAILY_MEDIA_LIMIT, texts: TEXT_LIMITS ? TEXT_HOURLY_LIMIT : 0 }),
    mask: MASK_CONTACTS ? T.maskLine : '',
  });
  // Split bubbles: onboarding text first, menu second (silent).
  // `\n§§\n` markers in the body become real dividers (rich) or ─── lines.
  const chunks = String(bodyText).split('\n§§\n');
  const blocks = [{ type: 'paragraph', text: [{ type: 'bold', text: headText }, headAid, chunks[0] ?? ''] }];
  for (const c of chunks.slice(1)) blocks.push({ type: 'divider' }, { type: 'paragraph', text: c });
  const flatBody = chunks.join('\n──────────\n');
  try {
    await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks } });
  } catch {
    // Static text only — HTML-safe by construction (no user input interpolated).
    const onboard = `<b>${headText}</b>` + headAid.replace(/&/g, '&amp;').replace(/</g, '&lt;') + flatBody.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    try {
      await api.sendMessage({ chat_id: chatId, text: onboard, parse_mode: 'HTML', disable_web_page_preview: true });
    } catch {
      await api.sendMessage({ chat_id: chatId, text: onboard.replace(/<[^>]+>/g, ''), disable_web_page_preview: true });
    }
  }
  await sendMenu(chatId, T, { silent: true }).catch(() => {});
}

// pending_intents state → draft name key (arm-switch notices; mirrors callback).
const ARM_STATE_KIND = { awaiting_reply: 'reply', awaiting_question: 'question', awaiting_faq: 'question', awaiting_lost: 'lost', awaiting_found: 'found', awaiting_dana: 'dana', awaiting_suggest: 'suggest', awaiting_info: 'info', awaiting_feedback: 'feedback' };

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
  // Discussion-group wiring test: replies to auto-forwarded channel posts
  // stage as anonymous reply-confessions (preview/confirm happen in DM).
  if (DISCUSSION_GROUP_ID && chatId === DISCUSSION_GROUP_ID) {
    await handleDiscussion(msg);
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
      await api.sendMessage({ chat_id: chatId, text: 'Usage: /who <user id | UID | #C-id> (e.g. /who 230757915, /who UID-001, /who #C78)' });
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
  if (text.startsWith('/debuginfo')) {
    if (msg.from.id !== SUPER_ADMIN_ID) {
      await api.sendMessage({ chat_id: chatId, text: 'Not allowed.' });
      return;
    }
    const arg = text.slice(10).trim().replace(/^#C?/i, '');
    if (!/^\d+$/.test(arg)) {
      await api.sendMessage({ chat_id: chatId, text: 'Usage: /debuginfo #C<id>.' });
      return;
    }
    const dump = await debugDump(Number(arg)).catch(() => null);
    await api.sendMessage({ chat_id: chatId, text: dump ?? 'Nothing found.' });
    return;
  }
  if (text.startsWith('/strings')) {
    if (msg.from.id !== SUPER_ADMIN_ID) {
      await api.sendMessage({ chat_id: chatId, text: 'Not allowed.' });
      return;
    }
    const keys = Object.keys(STR.ms);
    const per = 15;
    const pages = Math.max(1, Math.ceil(keys.length / per));
    const p = Math.min(Math.max(1, Number(text.slice(8).trim()) || 1), pages);
    const lines = keys.slice((p - 1) * per, p * per).map((k) => {
      const bv = String(STR.ms[k]);
      const ev = String((STR.en ?? {})[k] ?? '—');
      return `• ${k}\n  BM: ${bv.slice(0, 180)}${bv.length > 180 ? '…' : ''}\n  EN: ${ev.slice(0, 180)}${ev.length > 180 ? '…' : ''}`;
    });
    await api.sendMessage({ chat_id: chatId, text: `📝 Strings (page ${p}/${pages}, ${keys.length} keys)\n${lines.join('\n')}\n/strings ${p < pages ? p + 1 : 1} for ${p < pages ? 'next' : 'first'}` });
    return;
  }
  if (text.startsWith('/list')) {
    if (msg.from.id !== SUPER_ADMIN_ID) {
      await api.sendMessage({ chat_id: chatId, text: 'Not allowed.' });
      return;
    }
    const u = await resolveUser(text.slice(5).trim());
    if (!u) {
      await api.sendMessage({ chat_id: chatId, text: 'No such user — /list <UID> (e.g. /list UID-003).' });
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
    // Deep link (?start=confess from channel-DM card): same landing as the
    // send_conf button — guidance text + Tutup, then their next message stages.
    const param = text.replace(/^\/start(@[A-Za-z0-9_]+)?/, '').trim().split(/\s+/)[0].toLowerCase();
    if (param === 'confess') {
      const ht = L(u);
      await api.sendMessage({ chat_id: chatId, text: ht.sendGuidance, reply_markup: { inline_keyboard: [[{ text: ht.tutupBtn, callback_data: 'dismiss' }]] } });
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
  if (text.startsWith('/announce')) {
    if (msg.from.id !== SUPER_ADMIN_ID) return;
    await draftAnnounce(chatId, {}, text.slice(9).trim(), msg);
    return;
  }
  if (text.startsWith('/cancelannounce')) {
    if (msg.from.id !== SUPER_ADMIN_ID) return;
    await dropAnnounce(chatId, {}, msg);
    return;
  }
  if (text.startsWith('/tutorial')) {
    const hu = await db.select().from(users).where(eq(users.tgId, msg.from.id)).get().catch(() => null);
    const ht = L(hu);
    await api.sendMessage({ chat_id: chatId, text: `${ht.tutTitle(0)}\n${ht.tutSteps[0]}`, reply_markup: tutRow(ht, 0) });
    return;
  }
  if (text.startsWith('/changelog')) {
    const hu = await db.select().from(users).where(eq(users.tgId, msg.from.id)).get().catch(() => null);
    const lang = hu?.lang === 'en' ? 'en' : 'ms';
    const last = [...CHANGELOG].slice(-5).reverse();
    const lines = last.map((e) => `• V${e.v} (${e.date})\n  ${e[lang]}`);
    await api.sendMessage({ chat_id: chatId, text: lang === 'en' ? `🤖 Bot version ${VERSION}\n${lines.join('\n')}` : `🤖 Versi bot ${VERSION}\n${lines.join('\n')}` });
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
      const markerU = await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `— 💬 chat opened with ${await cardWho(u)}\n↩️ Reply to this message to start chatting.`,
        reply_markup: { inline_keyboard: [[{ text: '✖ Close chat', callback_data: `endchat_${u.id}` }]] } });
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
      await api.sendMessage({ chat_id: ADMIN_GROUP_ID, ...chatThread(), text: `— chat closed with ${await cardWho(u)} (user)` });
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
        text: `📨 Appeal #A${ap.id} · 👤 ${await cardWho(freshA)} · banned ${blocked}\n${body}`.slice(0, 3900),
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
      await cancelEnd(chatId, t, t.noDraftReply);
      return;
    }
    // Only bot-owned arm messages die (kind 'reply' = converted choice prompt).
    // Pre-push rows point at the user's own forward — never touch those.
    if (w.srcMsgId && w.kind === 'reply') { try { await api.deleteMessage({ chat_id: chatId, message_id: w.srcMsgId }); } catch {} }
    await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    await cancelEnd(chatId, t, t.replyDiscarded);
    return;
  }
  if (text.startsWith('/cancelquestion')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const w = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, u.id), eq(pendingIntents.state, 'awaiting_question'))).get().catch(() => null)
      ?? await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, u.id), eq(pendingIntents.state, 'awaiting_faq'))).get().catch(() => null);
    if (!w) {
      await cancelEnd(chatId, t, t.noDraftQ);
      return;
    }
    if (w.srcMsgId) { try { await api.deleteMessage({ chat_id: chatId, message_id: w.srcMsgId }); } catch {} }
    await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    await cancelEnd(chatId, t, t.qDiscarded);
    return;
  }
  if (text.startsWith('/cancellostfound')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const ws = await db.all(sql`SELECT * FROM pending_intents WHERE user_id = ${u.id} AND state IN ('awaiting_lost','awaiting_found')`).catch(() => []);
    if (!ws?.length) {
      await cancelEnd(chatId, t, t.noDraftLF);
      return;
    }
    for (const w of ws) {
      if (w.src_msg_id) { try { await api.deleteMessage({ chat_id: chatId, message_id: w.src_msg_id }); } catch {} }
      await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    }
    await cancelEnd(chatId, t, t.lfDiscarded);
    return;
  }
  if (text.startsWith('/canceldana')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const w = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, u.id), eq(pendingIntents.state, 'awaiting_dana'))).get().catch(() => null);
    if (!w) {
      await cancelEnd(chatId, t, t.noDraftDana);
      return;
    }
    if (w.srcMsgId) { try { await api.deleteMessage({ chat_id: chatId, message_id: w.srcMsgId }); } catch {} }
    await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    await cancelEnd(chatId, t, t.danaDiscarded);
    return;
  }
  if (text.startsWith('/cancelsuggest')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const w = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, u.id), eq(pendingIntents.state, 'awaiting_suggest'))).get().catch(() => null);
    if (!w) {
      await cancelEnd(chatId, t, t.noDraftSuggest);
      return;
    }
    if (w.srcMsgId) { try { await api.deleteMessage({ chat_id: chatId, message_id: w.srcMsgId }); } catch {} }
    await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    await cancelEnd(chatId, t, t.suggestDiscarded);
    return;
  }
  if (text.startsWith('/cancelinfo')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const w = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, u.id), eq(pendingIntents.state, 'awaiting_info'))).get().catch(() => null);
    if (!w) {
      await cancelEnd(chatId, t, t.noDraftInfo);
      return;
    }
    if (w.srcMsgId) { try { await api.deleteMessage({ chat_id: chatId, message_id: w.srcMsgId }); } catch {} }
    await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    await cancelEnd(chatId, t, t.infoDiscarded);
    return;
  }
  if (text.startsWith('/cancelfeedback')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const w = await db.select().from(pendingIntents).where(and(eq(pendingIntents.userId, u.id), eq(pendingIntents.state, 'awaiting_feedback'))).get().catch(() => null);
    if (!w) {
      await cancelEnd(chatId, t, t.noDraftFeedback);
      return;
    }
    if (w.srcMsgId) { try { await api.deleteMessage({ chat_id: chatId, message_id: w.srcMsgId }); } catch {} }
    await db.delete(pendingIntents).where(eq(pendingIntents.id, w.id)).run().catch(() => {});
    await cancelEnd(chatId, t, t.fbDiscarded);
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
      await cancelEnd(chatId, t, t.withdrawn(s.id));
    } else {
      await cancelEnd(chatId, t, t.nothingPending);
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
    // Native polls are immutable post-votes (Telegram offers no edit API).
    if (own.mediaKind === 'poll') {
      await api.sendMessage({ chat_id: chatId, text: t.editPollNo });
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
        text: `✏️ Edit #C${own.id} · ${await cardWho(u)}\n− ${(oldText ?? '').slice(0, 900)}\n+ ${body.slice(0, 900)}`,
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
  // Delete request: reply to your own sent DM with /delete (no body needed).
  // Approved posts only — stages a mod card (Apply/Dismiss), mirrors /edit.
  if (text.startsWith('/delete')) {
    const u = await ensureUser(msg);
    if (!u) return;
    const t = L(u);
    const targetMsgId = msg.reply_to_message?.message_id ?? null;
    const own = targetMsgId
      ? await db.select().from(submissions)
        .where(and(eq(submissions.userId, u.id), eq(submissions.userMessageId, targetMsgId)))
        .orderBy(desc(submissions.id)).get().catch(() => null)
      : null;
    if (!own) {
      await api.sendMessage({ chat_id: chatId, text: t.delUsage });
      return;
    }
    if (own.status !== 'approved' || !(Array.isArray(own.channelMessageIds) ? own.channelMessageIds.length : 0)) {
      await api.sendMessage({ chat_id: chatId, text: own.status === 'pending' || own.status === 'unconfirmed'
        ? t.stillReview
        : t.goneResend });
      return;
    }
    const dup = await db.select().from(deletes)
      .where(and(eq(deletes.submissionId, own.id), eq(deletes.status, 'pending')))
      .orderBy(desc(deletes.id)).get().catch(() => null);
    if (dup) {
      await api.sendMessage({ chat_id: chatId, text: t.delStaged(own.id) });
      return;
    }
    const oldText = (own.mediaKind === 'text' ? own.text : own.mediaKind === 'poll' ? pollRender(own.text, own.pollData?.options) : own.caption) ?? '(no text)';
    const ins = await db.insert(deletes).values({ submissionId: own.id }).returning().run().catch(() => null);
    if (!ins) {
      await api.sendMessage({ chat_id: chatId, text: t.delSendFail });
      return;
    }
    const dd = ins[0];
    try {
      await api.sendMessage({
        chat_id: ADMIN_GROUP_ID, ...inboxThread(),
        text: `🗑️ Delete #C${own.id} · ${await cardWho(u)}\n− ${(oldText ?? '').slice(0, 900)}`,
        reply_markup: { inline_keyboard: [[
          { text: 'Apply', callback_data: `del_apply:${dd.id}` },
          { text: 'Dismiss', callback_data: `del_dismiss:${dd.id}` },
        ]] },
      });
    } catch {
      await db.update(deletes).set({ status: 'dismissed' }).where(eq(deletes.id, dd.id)).run();
      await api.sendMessage({ chat_id: chatId, text: t.delSendFail });
      return;
    }
    await api.sendMessage({ chat_id: chatId, text: t.delSent(own.id) });
    return;
  }
  if (text.startsWith('/')) {
    await api.sendMessage({ chat_id: chatId, text: (STR[LANG] ?? STR.ms).unknownCmd });
    return;
  }

  // Intake: ban gate first (commands above already bypass it).
  const u0 = await ensureUser(msg);
  if (!u0) return;
  await touchSeen(u0).catch(() => {});
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

  // Shared reply guide (short #C one-liner for our own bubbles, full guide
  // otherwise). Refusal branches (FAQ gate, category/sub-type picks) call it
  // first — a reply is never the content they wait for. The late intercept
  // below reuses it for everything the armed states didn't consume.
  const replyGuide = async () => {
    const rplId = rpl.message_id ?? null;
    const own = rplId ? await db.select().from(submissions)
      .where(and(eq(submissions.userId, u0.id), or(eq(submissions.ackMsgId, rplId), eq(submissions.previewMsgId, rplId), eq(submissions.actionMsgId, rplId))))
      .orderBy(desc(submissions.id)).get().catch(() => null) : null;
    const guide = own && rplId === own.ackMsgId
      ? { key: 'replyAck', text: t.replyAck(own.id) }
      : own
        ? { key: 'replyPreview', text: t.replyPreview(own.id) }
        : { key: 'replyDirect', text: t.replyDirect };
    await api.sendMessage({ chat_id: chatId, text: await tag(guide.key, guide.text) });
  };

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

  // FAQ gate: user tapped "Tanya Soalan" but hasn't passed Dah-semak —
  // refuse everything (nothing stages) until faq_proceed flips the intent.
  const waitingF = await db.select().from(pendingIntents)
    .where(and(eq(pendingIntents.userId, u0.id), eq(pendingIntents.state, 'awaiting_faq')))
    .orderBy(desc(pendingIntents.id)).limit(1).all().catch(() => []);
  if (waitingF[0] && !isReplyShare && !isChannelFwd) {
    if (rpl) { await replyGuide(); return; }
    await api.sendMessage({ chat_id: chatId, text: await tag('faqNudge', t.faqNudge) });
    return;
  }

  // Armed question: user tapped "Tanya Soalan" earlier — this content IS the question.
  const waitingQ = await db.select().from(pendingIntents)
    .where(and(eq(pendingIntents.userId, u0.id), eq(pendingIntents.state, 'awaiting_question')))
    .orderBy(desc(pendingIntents.id)).limit(1).all().catch(() => []);
  const wq = waitingQ[0];
  // Still picking a category (kind=askcat/askpark) — refuse content until they tap.
  if (wq && (wq.kind === 'askcat' || wq.kind === 'askpark') && !isReplyShare && !isChannelFwd) {
    if (rpl) { await replyGuide(); return; }
    await api.sendMessage({ chat_id: chatId, text: await tag('askNudge', t.askNudge) });
    return;
  }
  if (wq && !isReplyShare && !isChannelFwd) {
    const staged = await submitConfession({ from: msg.from, chatId, messageId: msg.message_id ?? null, content, stripped, isQuestion: true });
    if (staged?.sub && wq.text) {
      const [c, s] = String(wq.text).split(' › ');
      await db.update(submissions).set({ askCat: c || null, askSub: s || null }).where(eq(submissions.id, staged.sub.id)).run().catch(() => {});
    }
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

  // Armed dana: user picked a sub-type earlier — this content IS the fund hunt.
  const waitingDana = await db.select().from(pendingIntents)
    .where(and(eq(pendingIntents.userId, u0.id), eq(pendingIntents.state, 'awaiting_dana')))
    .orderBy(desc(pendingIntents.id)).limit(1).all().catch(() => []);
  const wd = waitingDana[0];
  // Still picking a sub-type (kind=danapick) — refuse content until they tap.
  if (wd && wd.kind === 'danapick' && !isReplyShare && !isChannelFwd) {
    if (rpl) { await replyGuide(); return; }
    await api.sendMessage({ chat_id: chatId, text: await tag('danaNudge', t.danaNudge) });
    return;
  }
  if (wd && !isReplyShare && !isChannelFwd) {
    const stagedD = await submitConfession({ from: msg.from, chatId, messageId: msg.message_id ?? null, content, stripped, kind: 'dana', askSub: (wd.text === 'program' || wd.text === 'kilat') ? wd.text : null });
    await db.delete(pendingIntents).where(eq(pendingIntents.id, wd.id)).run().catch(() => {});
    await flushStaleAlbums().catch(() => {});
    return;
  }

  // Armed suggest/info: user tapped the grid button earlier — this content
  // IS the suggestion or community notice (bare tags, no serials).
  const waitingSI = await db.get(sql`SELECT * FROM pending_intents WHERE user_id = ${u0.id} AND state IN ('awaiting_suggest','awaiting_info') ORDER BY id DESC LIMIT 1`).catch(() => null);
  if (waitingSI && !isReplyShare && !isChannelFwd) {
    await submitConfession({ from: msg.from, chatId, messageId: msg.message_id ?? null, content, stripped, kind: waitingSI.state === 'awaiting_suggest' ? 'suggest' : 'info' });
    await db.delete(pendingIntents).where(eq(pendingIntents.id, waitingSI.id)).run().catch(() => {});
    await flushStaleAlbums().catch(() => {});
    return;
  }

  // Armed feedback: user tapped Bot Feedback earlier — this content IS the report.
  const waitingFb = await db.select().from(pendingIntents)
    .where(and(eq(pendingIntents.userId, u0.id), eq(pendingIntents.state, 'awaiting_feedback')))
    .orderBy(desc(pendingIntents.id)).limit(1).all().catch(() => []);
  const wf = waitingFb[0];
  if (wf && !isReplyShare && !isChannelFwd) {
    await submitFeedback({ from: msg.from, chatId, messageId: msg.message_id ?? null, content });
    await db.delete(pendingIntents).where(eq(pendingIntents.id, wf.id)).run().catch(() => {});
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

  // Direct replies are never intake (owner call: replying to a bot/own
  // message must not stage a new confession). Channel reply-shares returned
  // earlier; /edit-by-reply is a command and returned above; armed states
  // above keep consuming (their taps own the next message).
  // Reply-to-our-own-bubble (ack/preview/action) gets a one-liner with the
  // #C id; anything else gets the full guide (shared helper above).
  if (rpl && !isReplyShare && !isChannelFwd) {
    await replyGuide();
    return;
  }

  // Auto-route: unarmed question-lookalike → question module (park + gate).
  // Content parks in the intent; category pick stages it, no retyping.
  // Skipped under maintenance (plain staging refuses with the notice instead).
  const maintBlock = !EXEMPT_IDS.includes(msg.from.id) && await maintOn().catch(() => false);
  if (!isReplyShare && !isChannelFwd && !maintBlock
    && detectIntent(content.text ?? content.caption ?? '') === 'question') {
    const othersA = await db.all(sql`SELECT state FROM pending_intents WHERE user_id = ${u0.id} AND state IN ('awaiting_reply','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => []);
    await db.run(sql`DELETE FROM pending_intents WHERE user_id = ${u0.id} AND state IN ('awaiting_reply','awaiting_lost','awaiting_found','awaiting_dana','awaiting_suggest','awaiting_info','awaiting_feedback')`).catch(() => {});
    await db.delete(pendingIntents).where(and(eq(pendingIntents.userId, u0.id), eq(pendingIntents.state, 'awaiting_question'))).run().catch(() => {});
    await db.delete(pendingIntents).where(and(eq(pendingIntents.userId, u0.id), eq(pendingIntents.state, 'awaiting_faq'))).run().catch(() => {});
    const diedA = [...new Set((othersA ?? []).map((r) => t.draftNames[ARM_STATE_KIND[r.state]] ?? r.state))];
    const switchA = diedA.length ? `\n${t.armSwitched(diedA.join(', '))}` : '';
    const park = JSON.stringify({ kind: content.kind, text: content.text ?? null, fileId: content.fileId ?? null, caption: content.caption ?? null });
    let armA = null;
    try {
      const m = await api.sendMessage({ chat_id: chatId, text: await tag('faqGate', t.faqGate + switchA + '\n' + t.autoQParked), reply_markup: { inline_keyboard: [[
        { text: t.faqOpenBtn, url: FAQ_URL },
      ], [
        { text: t.faqGoBtn, callback_data: 'faq_proceed' },
        { text: t.cancelBtn, callback_data: 'armcancel:question' },
      ]] } });
      armA = m?.message_id ?? null;
    } catch {}
    await db.insert(pendingIntents).values({ userId: u0.id, state: 'awaiting_faq', kind: 'question', srcMsgId: armA, parked: park }).run().catch(() => {});
    await flushStaleAlbums().catch(() => {});
    return;
  }

  // Plain intake (forwards from other chats land here, headers stripped).
  await submitConfession({ from: msg.from, chatId, messageId: msg.message_id ?? null, content, stripped });
  await flushStaleAlbums().catch(() => {});
}

export default guarded(handle);
