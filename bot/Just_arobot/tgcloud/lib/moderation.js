import { db, api } from 'sdk';
import { sql, eq } from 'sdk/db';
import { users, submissions, parts, audit, hits } from '../schema.js';
import { WARN_TIERS, WARN_WINDOW_DAYS, CHANNEL_ID, ADMIN_GROUP_ID, EXEMPT_IDS, TEXT_HOURLY_LIMIT, TEXT_DAILY_LIMIT, POST_COOLDOWN_SEC, QUIET_START_UTC_H, QUIET_END_UTC_H, DRIP_FEED, TAP_LIMIT, TAP_WINDOW_SEC, TAP_NOTICE_SEC, LANG } from './config.js';
import { STR } from './strings.js';

// Shared moderation wording + warn-window counting.
// Ban DM voice (exact): temp → "temporary blocked until …", forever → "banned
// forever. Goodbye." — appealable bans append the /appeal hint (berat: none).

export function banNotice(until, reason, appealable = true) {
  const head = until
    ? `You have been temporary blocked until ${new Date(until).toISOString().slice(0, 10)}.`
    : 'You have been banned forever. Goodbye.';
  return `${head}\nReason: ${reason}${appealable ? '\n/appeal <text> to appeal.' : ''}`;
}

// A-id (diagram's A000 series): per-user anonymous number, join-ordered.
// Stored in users.anum (unique index); legacy U-xxxx aliases stay untouched and
// keep resolving. Lazy-assigned with MAX+1 retry — serverless-safe.
export async function aidOf(userRow) {
  if (!userRow) return '?';
  if (userRow.anum) return userRow.anum;
  for (let i = 0; i < 8; i++) {
    const mx = await db.get(sql`SELECT MAX(CAST(SUBSTR(anum, 2) AS INTEGER)) AS m FROM users WHERE anum LIKE 'A%'`).catch(() => ({ m: 0 }));
    const next = 'A' + String((mx?.m ?? 0) + 1).padStart(4, '0');
    try {
      await db.update(users).set({ anum: next }).where(eq(users.id, userRow.id)).run();
      return next;
    } catch {} // collision → retry with a fresh MAX
  }
  return String(userRow.tgId ?? '?');
}

// Deep link to a channel post. Public channel → t.me/<name>/<id>, private →
// t.me/c/<internal>/<id>. Resolved live via getChat (hourly cache); the c/ form
// (members-only) is the fallback.
let linkBase = null;
let linkAt = 0;
export async function channelPostLink(msgId) {
  if (!linkBase || Date.now() - linkAt > 3600000) {
    try {
      const c = await api.getChat({ chat_id: CHANNEL_ID });
      linkBase = c?.username ? `https://t.me/${c.username}` : `https://t.me/c/${String(CHANNEL_ID).slice(4)}`;
    } catch {
      linkBase = `https://t.me/c/${String(CHANNEL_ID).slice(4)}`;
    }
    linkAt = Date.now();
  }
  return `${linkBase}/${msgId}`;
}

// Group-visible identity: "<tgId>-<A-id>" (e.g. 7154716451-A0001).
export async function whoOf(userRow) {
  if (!userRow) return '?';
  return `${userRow.tgId}-${await aidOf(userRow)}`;
}

// Submission kind helpers (kind column is truth; legacy is_question backfills).
// Misdirected-intent nudge: guess question/lost/found/chat from raw text.
// Suggestion-only — callers must never auto-convert. confession kinds only.
const Q_OPENERS = /^(apa(kah)?|bagaimana(kah)?|kenapa|mengapa|bila(kah)?|mana(kah)?|berapa(kah)?|adakah|siapa(kah)?|what|when|where|why|how|can|could|is|are|do|does|did|who|which)\b/i;
export function detectIntent(text) {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (/hilang|tercicir|tertinggal|kehilangan|\blost\b|\bmissing\b|misplaced/i.test(t)) return 'lost';
  if (/jumpa|terjumpa|menemui|\bfound\b/i.test(t)) return 'found';
  if (t.endsWith('?') || Q_OPENERS.test(t)) return 'question';
  if (/\badmin\b|(^|[\s])min([\s,.!?]|$)/i.test(t)) return 'chat';
  return null;
}
export const KIND_TAGS = { question: '#ask', lost: '#lost', found: '#found' };
export const KIND_CARDS = { question: '❓ Question', lost: '🔍 Lost', found: '📦 Found' };
export function kindOf(sub) {
  if (!sub) return null;
  if (sub.kind && sub.kind !== 'confession') return sub.kind;
  return sub.isQuestion ? 'question' : null;
}

// Contact auto-mask: emails, URLs, @mentions, phone-ish digit runs (9+ digits,
// so years/dates survive). Returns masked text + hit count.
const MASK_TOKEN = '[hidden]';
export function maskContacts(text) {
  if (!text) return { masked: text, n: 0 };
  let n = 0;
  const out = text
    .replace(/\S+@\S+\.\S+/g, () => (n++, MASK_TOKEN))
    .replace(/https?:\/\/\S+|www\.\S+/gi, () => (n++, MASK_TOKEN))
    .replace(/@[A-Za-z0-9_]{2,}/g, () => (n++, MASK_TOKEN))
    .replace(/\+?\d[\d\s.\-]{6,}\d/g, (m) => (((m.match(/\d/g) || []).length >= 9 ? (n++, MASK_TOKEN) : m)));
  return { masked: out, n };
}

// Quiet hours (UTC window; default 16–23 = MYT 00:00–07:00) + post pacing.
export function isQuiet(now = Date.now()) {
  const h = new Date(now).getUTCHours();
  return QUIET_START_UTC_H <= QUIET_END_UTC_H
    ? (h >= QUIET_START_UTC_H && h < QUIET_END_UTC_H)
    : (h >= QUIET_START_UTC_H || h < QUIET_END_UTC_H);
}

export async function lastPostAt() {
  const r = await db.get(sql`SELECT MAX(created_at) AS m FROM audit WHERE action IN ('accept','republish')`).catch(() => null);
  const v = r?.m;
  if (!v) return 0;
  return v instanceof Date ? v.getTime() : Number(v) * 1000;
}

export async function postDue() {
  if (isQuiet()) return { due: false, waitMin: null, quiet: true };
  const wait = POST_COOLDOWN_SEC - (Date.now() - await lastPostAt()) / 1000;
  return wait <= 0 ? { due: true } : { due: false, waitMin: Math.ceil(wait / 60) };
}

// Tap-storm guard: max TAP_LIMIT taps per rolling window per user.
// Notice throttled (one per TAP_NOTICE_SEC) so the guard can't become the spam.
export async function tapAllowed(tgId) {
  if (EXEMPT_IDS.includes(tgId)) return { ok: true };
  const u = await db.select().from(users).where(eq(users.tgId, tgId)).get().catch(() => null);
  if (!u) return { ok: true };
  await db.run(sql`DELETE FROM hits WHERE created_at < unixepoch() - 3600`).catch(() => {});
  const c = await db.get(sql`SELECT COUNT(*) AS c FROM hits WHERE user_id = ${u.id} AND kind = 'tap' AND created_at > unixepoch() - ${TAP_WINDOW_SEC}`).catch(() => ({ c: 0 }));
  if ((c?.c ?? 0) >= TAP_LIMIT) {
    const n = await db.get(sql`SELECT COUNT(*) AS c FROM hits WHERE user_id = ${u.id} AND kind = 'tap_notice' AND created_at > unixepoch() - ${TAP_NOTICE_SEC}`).catch(() => ({ c: 0 }));
    let notify = false;
    if (!(n?.c ?? 0)) {
      await db.insert(hits).values({ userId: u.id, kind: 'tap_notice' }).run().catch(() => {});
      notify = true;
    }
    return { ok: false, notify };
  }
  await db.insert(hits).values({ userId: u.id, kind: 'tap' }).run().catch(() => {});
  return { ok: true };
}

// Text rate limits (rolling windows, raw unixepoch SQL like mediaAllowed).
export async function textAllowed(tgId, userId) {
  if (EXEMPT_IDS.includes(tgId)) return { ok: true };
  const base = sql`SELECT COUNT(*) AS c FROM submissions WHERE user_id = ${userId} AND media_kind = 'text' AND status != 'rejected' AND status != 'unconfirmed'`;
  const h = await db.get(sql`${base} AND created_at > unixepoch() - 3600`).catch(() => ({ c: 0 }));
  if ((h?.c ?? 0) >= TEXT_HOURLY_LIMIT) return { ok: false, which: `${TEXT_HOURLY_LIMIT}/hour` };
  const d = await db.get(sql`${base} AND created_at > unixepoch() - 86400`).catch(() => ({ c: 0 }));
  if ((d?.c ?? 0) >= TEXT_DAILY_LIMIT) return { ok: false, which: `${TEXT_DAILY_LIMIT}/day` };
  return { ok: true };
}

// Channel publish (shared by Accept-now and queue flush). Throws on failure;
// spoiler A-id tag, entities-based, never parse_mode.
export async function publishToChannel(sub) {
  const threadParams = sub.refMsgId ? { reply_parameters: { message_id: sub.refMsgId } } : {};
  const userRow = await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
  const authorAid = userRow ? await aidOf(userRow) : null;
  const tag = authorAid ? `\n\n${authorAid}` : '';
  const spoilerOf = (body) => (authorAid ? [{ type: 'spoiler', offset: body.length + 2, length: authorAid.length }] : undefined);
  const rows = await db.select().from(parts).where(eq(parts.submissionId, sub.id)).orderBy(parts.id).all().catch(() => []);
  const k = kindOf(sub);
  const leadTag = k && KIND_TAGS[k] ? KIND_TAGS[k] + (sub.kindSeq ?? '') : null; // #lost1… (null-seq rows: bare tag)
  const qp = leadTag ? leadTag + '\n\n' : ''; // questions/lost/found lead with the tag
  if (sub.mediaKind === 'text') {
    const core = (sub.text ?? '').slice(0, 4096 - tag.length - qp.length);
    const body = core ? qp + core : '(empty)';
    const m = await api.sendMessage({ chat_id: CHANNEL_ID, text: body + tag, ...(authorAid ? { entities: spoilerOf(body) } : {}), ...threadParams });
    return [m.message_id];
  }
  if (sub.mediaKind === 'photo' || sub.mediaKind === 'video') {
    const p = rows[0];
    if (!p) throw new Error('missing part');
    const capBase = qp + (sub.caption ?? '').slice(0, 1024 - tag.length - qp.length);
    const cap = capBase + tag;
    const m = sub.mediaKind === 'photo'
      ? await api.sendPhoto({ chat_id: CHANNEL_ID, photo: p.fileId, ...(capBase || tag ? { caption: cap } : {}), ...(authorAid ? { caption_entities: spoilerOf(capBase) } : {}), ...threadParams })
      : await api.sendVideo({ chat_id: CHANNEL_ID, video: p.fileId, ...(capBase || tag ? { caption: cap } : {}), ...(authorAid ? { caption_entities: spoilerOf(capBase) } : {}), ...threadParams });
    const ids = [m.message_id];
    if ((sub.caption ?? '').length > 1024 - tag.length - qp.length) {
      const extraBody = (sub.caption ?? '').slice(1024 - tag.length - qp.length, 5000 - tag.length);
      const extra = await api.sendMessage({ chat_id: CHANNEL_ID, text: extraBody + tag, ...(authorAid ? { entities: spoilerOf(extraBody) } : {}) });
      ids.push(extra.message_id);
    }
    return ids;
  }
  // album (legacy drain path)
  const albumCapBase = qp + (sub.caption ?? '').slice(0, 1024 - tag.length - qp.length);
  const media = rows.map((p, i) => ({
    type: p.type, media: p.fileId,
    ...(i === 0 && (albumCapBase || tag) ? { caption: albumCapBase + tag } : {}),
    ...(i === 0 && authorAid ? { caption_entities: spoilerOf(albumCapBase) } : {}),
  }));
  const sent = await api.sendMediaGroup({ chat_id: CHANNEL_ID, media });
  const ids = (Array.isArray(sent) ? sent : [sent]).map((m) => m.message_id);
  if ((sub.caption ?? '').length > 1024 - tag.length - qp.length) {
    const extraBody = (sub.caption ?? '').slice(1024 - tag.length - qp.length, 5000 - tag.length);
    const extra = await api.sendMessage({ chat_id: CHANNEL_ID, text: extraBody + tag, ...(authorAid ? { entities: spoilerOf(extraBody) } : {}) });
    ids.push(extra.message_id);
  }
  return ids;
}

export async function queuedCount() {
  const r = await db.get(sql`SELECT COUNT(*) AS c FROM submissions WHERE status = 'queued'`).catch(() => ({ c: 0 }));
  return r?.c ?? 0;
}

export async function queuePos(subId) {
  const r = await db.get(sql`SELECT COUNT(*) AS c FROM submissions WHERE status = 'queued' AND id < ${subId}`).catch(() => ({ c: 0 }));
  return (r?.c ?? 0) + 1;
}

async function sendQueueDM(tgId, subId, postUrl, lang) {
  const T = STR[lang ?? LANG] ?? STR.ms;
  const head = T.publishedHead(subId, false);
  const label = 'see the post';
  try {
    await api.sendMessage({ chat_id: tgId, text: `${head}\n${label}`, entities: [{ type: 'text_link', offset: head.length + 1, length: label.length, url: postUrl }] });
  } catch {
    await api.sendMessage({ chat_id: tgId, text: `${head}\n${postUrl}` }).catch(() => {});
  }
}

// Drain due queued posts (claim-then-publish, race-safe). Lazy: called on admin
// activity; force (/flush): oldest single item regardless of cooldown/quiet.
export async function flushQueue(force = false) {
  if (!DRIP_FEED && !force) return { posted: 0, queued: await queuedCount() };
  if (!force) {
    const d = await postDue().catch(() => ({ due: false }));
    if (!d.due) return { posted: 0, queued: await queuedCount() };
  }
  const items = await db.all(sql`SELECT * FROM submissions WHERE status IN ('queued','publishing') ORDER BY id`).catch(() => []);
  let posted = 0;
  for (const s of (force ? items.slice(0, 1) : items.slice(0, 3))) {
    if (!force) {
      const d = await postDue().catch(() => ({ due: false }));
      if (!d.due) break;
    }
    await db.update(submissions).set({ status: 'publishing' }).where(eq(submissions.id, s.id)).run().catch(() => {});
    const chk = await db.select().from(submissions).where(eq(submissions.id, s.id)).get().catch(() => null);
    if (!chk || chk.status !== 'publishing') continue; // lost the claim race
    try {
      const ids = await publishToChannel(chk);
      await db.update(submissions).set({ status: 'approved', channelMessageIds: ids, acceptedBy: 0 }).where(eq(submissions.id, s.id)).run();
      await db.insert(audit).values({ adminId: 0, action: 'accept', targetUserId: chk.userId, reason: `#C${s.id} (queue)` }).run().catch(() => {});
      const u = await db.select().from(users).where(eq(users.id, chk.userId)).get().catch(() => null);
      const url = ids.length ? await channelPostLink(ids[0]).catch(() => null) : null;
      if (chk.inboxCardId) {
        try {
          await api.editMessageText({
            chat_id: ADMIN_GROUP_ID, message_id: chk.inboxCardId,
            text: `#C${s.id} · ${chk.mediaKind} · 👤 ${u ? await aidOf(u) : '?'}` + (kindOf(chk) ? `\n${KIND_CARDS[kindOf(chk)]}${chk.kindSeq ? ` · ${KIND_TAGS[kindOf(chk)]}${chk.kindSeq}` : ''}` : '') + `\n✅ Accepted (from queue)`,
            reply_markup: { inline_keyboard: [[{ text: 'Undo', callback_data: `undo:${s.id}` }]] },
          });
        } catch {}
      }
      try {
        if (u && url) await sendQueueDM(u.tgId, s.id, url, u.lang);
        else if (u) await api.sendMessage({ chat_id: u.tgId, text: (STR[LANG] ?? STR.ms).publishedHead(s.id, false) });
      } catch {}
      posted++;
    } catch (e) {
      console.error('queue post failed:', s.id, e?.description ?? e?.message ?? e);
      await db.update(submissions).set({ status: 'queued' }).where(eq(submissions.id, s.id)).run().catch(() => {});
    }
  }
  return { posted, queued: await queuedCount() };
}

// Escalation counts: warns from the audit trail inside the rolling window,
// tier derived from the stored reason key (`#C5 · spam (sederhana)`).
// WARN_WINDOW_DAYS <= 0 falls back to the lifetime user columns.
export async function warnCounts(userId) {
  if (!WARN_WINDOW_DAYS || WARN_WINDOW_DAYS <= 0) {
    const u = await db.select().from(users).where(eq(users.id, userId)).get().catch(() => null);
    return { light: u?.warnLight ?? 0, medium: u?.warnMedium ?? 0 };
  }
  const rows = await db.all(sql`SELECT reason FROM audit WHERE target_user_id = ${userId} AND action = 'warn' AND created_at > unixepoch() - ${WARN_WINDOW_DAYS * 86400}`).catch(() => []);
  let light = 0;
  let medium = 0;
  for (const r of rows ?? []) {
    const m = /· (.+) \((ringan|sederhana|berat)\)\s*$/.exec(r?.reason ?? '');
    const tier = m ? m[2] : (WARN_TIERS[m?.[1] ?? ''] ?? null);
    if (tier === 'ringan') light++;
    else if (tier === 'sederhana') medium++;
  }
  return { light, medium };
}
