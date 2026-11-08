import { db, api } from 'sdk';
import { sql, eq } from 'sdk/db';
import { fetch as sdkFetch } from 'sdk/fetch';
import { users, submissions, parts, audit, hits, duty, meta, crowns, faq } from '../schema.js';
import { WARN_TIERS, WARN_WINDOW_DAYS, CHANNEL_ID, ADMIN_GROUP_ID, EXEMPT_IDS, TEXT_HOURLY_LIMIT, TEXT_DAILY_LIMIT, POST_COOLDOWN_SEC, QUIET_START_UTC_H, QUIET_END_UTC_H, DRIP_FEED, TAP_LIMIT, TAP_WINDOW_SEC, TAP_NOTICE_SEC, LANG, SUPER_ADMIN_ID, MASK_MENTIONS, MASK_PHONES, FAQ_CSV_URL, PROFANITY_MASK } from './config.js';
import { STR } from './strings.js';
import { adminDisplay } from './admins.js';

// Shared moderation wording + warn-window counting.
// Ban DM voice (exact): temp → "temporary blocked until …", forever → "banned
// forever. Goodbye." — appealable bans append the /appeal hint (berat: none).

export function banNotice(until, reason, appealable = true) {
  const head = until
    ? `You have been temporary blocked until ${new Date(until).toISOString().slice(0, 10)}.`
    : 'You have been banned forever. Goodbye.';
  return `${head}\nReason: ${reason}${appealable ? '\n/appeal <text> to appeal.' : ''}`;
}

// UID (e.g. UID-001): per-user anonymous number, join-ordered. Legacy CID-###
// and A000 rows migrate forward (one-shot endpoints); parsers accept all three.
// Stored in users.anum (unique index); legacy U-xxxx aliases stay untouched and
// keep resolving. Lazy-assigned with MAX+1 retry — serverless-safe.
export async function aidOf(userRow) {
  if (!userRow) return '?';
  if (userRow.anum) return userRow.anum;
  for (let i = 0; i < 8; i++) {
    const mx = await db.get(sql`SELECT MAX(CAST(SUBSTR(anum, 5) AS INTEGER)) AS m FROM users WHERE anum LIKE 'UID-%'`).catch(() => ({ m: 0 }));
    const next = 'UID-' + String((mx?.m ?? 0) + 1).padStart(3, '0');
    try {
      await db.update(users).set({ anum: next }).where(eq(users.id, userRow.id)).run();
      return next;
    } catch {} // collision → retry with a fresh MAX
  }
  return String(userRow.tgId ?? '?');
}

// Public face: paid alias when set, else the CID. Channel footer, myAid line.
export async function dispAid(userRow) {
  if (userRow?.alias) return userRow.alias;
  return aidOf(userRow);
}

// Admin face: alias with the stable CID in sight (traceability kept).
export async function cardWho(userRow) {
  const a = await aidOf(userRow).catch(() => '?');
  return userRow?.alias ? `${userRow.alias} (${a})` : a;
}

// Alias rules (owner-set, paid perk): ≤16 chars, tight charset, CID-### shape
// refused, reserved tokens refused. Returns null when fine, else a reason.
const ALIAS_RESERVED = new Set(['admin', 'owner', 'mod', 'mods', 'min', 'bot', 'bots']);
export function aliasProblem(name) {
  const n = String(name ?? '').trim();
  if (!/^[A-Za-z0-9-]{2,16}$/.test(n)) return '2–16 aksara, A–Z 0–9 - sahaja.';
  if (/^(CID|UID)-\d+$/i.test(n)) return 'bentuk CID/UID-### dikhaskan untuk id automatik.';
  if (/^U-/i.test(n)) return 'bentuk U-* dikhaskan (legacy sistem).';
  if (String(n).toLowerCase().split(/[-_ ]+/).some((p) => ALIAS_RESERVED.has(p))) return 'nama terpelihara (admin/owner/mod/min/bot).';
  return null;
}

// Shared identity resolver: raw tg id, UID-###, legacy CID-###/A###, exact alias,
// case-insensitive alias fallback, legacy U-xxxx, or #C submission (→ author).
export async function resolveIdentity(arg) {
  const a = String(arg ?? '').trim().replace(/^#/, '');
  if (!a) return null;
  if (/^C\d+$/i.test(a)) {
    const s = await db.select().from(submissions).where(eq(submissions.id, Number(a.slice(1)))).get().catch(() => null);
    return s ? db.select().from(users).where(eq(users.id, s.userId)).get().catch(() => null) : null;
  }
  if (/^\d+$/.test(a)) return db.select().from(users).where(eq(users.tgId, Number(a))).get().catch(() => null);
  if (/^(UID-\d+|CID-\d+|A\d+)$/i.test(a)) return db.select().from(users).where(eq(users.anum, a.toUpperCase())).get().catch(() => null);
  const exact = await db.select().from(users).where(eq(users.alias, a)).get().catch(() => null);
  if (exact) return exact;
  if (/^[A-Za-z0-9-]{2,16}$/.test(a)) {
    const rows = await db.all(sql`SELECT * FROM users WHERE alias IS NOT NULL`).catch(() => []);
    const hit = (rows ?? []).find((r) => String(r.alias).toLowerCase() === a.toLowerCase());
    if (hit) return db.select().from(users).where(eq(users.id, hit.id)).get().catch(() => null);
  }
  return null;
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

// Owner-only identity: "<tgId>-<CID>" plus alias when set.
export async function whoOf(userRow) {
  if (!userRow) return '?';
  const a = await aidOf(userRow);
  return `${userRow.tgId}-${a}${userRow.alias ? ` aka ${userRow.alias}` : ''}`;
}

// Question categories (Tanya Soalan picker): fixed Malay labels so channel
// leads stay consistent across locales. ask_cat = top key, ask_sub = leaf.
export const ASK_CAT = {
  makan: '🍜 Makan', sewa: '🏠 Sewa', servis: '🛠️ Servis', barang: '📦 Barang',
  tempat: '📍 Tempat', tumpang: '🚗 Tumpang/Carpool', bas: '🚌 Bas',
};
export const ASK_SUB = {
  runner: '🏃 Runner', grab: '🚕 Grab', servis_lain: '🧰 Servis Lain',
  luar: '🌆 Luar UniSZA', soalan_lain: '💬 Soalan lain',
};
export function askCatLabel(sub) {
  if (!sub || sub.kind !== 'question' || !sub.askCat) return null;
  const c = ASK_CAT[sub.askCat];
  if (!c) return null;
  const s = sub.askSub ? ASK_SUB[sub.askSub] : null;
  return s ? `${c} › ${s}` : c;
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
export const KIND_TAGS = { question: '#ask', lost: '#lost', found: '#found', dana: '#cariandana', suggest: '#suggest', info: '#info' };
export const KIND_CARDS = { question: '❓ Question', lost: '🔍 Lost', found: '📦 Found', dana: '💰 Dana', suggest: '💡 Suggest', info: '📣 Info' };
// Dana sub-types (L2 picker): shared #cariandana lead, distinct card labels.
export const DANA_SUB = { program: '💰 Dana Program', kilat: '⚡ Derma Kilat' };
export function danaLabel(sub) {
  if (!sub || sub.kind !== 'dana' || !sub.askSub) return null;
  return DANA_SUB[sub.askSub] ?? null;
}
// Channel/edit lead tag: kilat gets its own #dermakilat, program shares #cariandana.
export function danaTag(sub) {
  if (sub && sub.kind === 'dana' && sub.askSub === 'kilat') return '#dermakilat';
  return KIND_TAGS.dana;
}
// Kinds without serials: bare-tag leads (#cariandana, #suggest, #info).
export const NO_SERIAL = new Set(['dana', 'suggest', 'info']);
export function kindOf(sub) {
  if (!sub) return null;
  if (sub.kind && sub.kind !== 'confession') return sub.kind;
  return sub.isQuestion ? 'question' : null;
}

// Contact auto-mask: emails + URLs always; @mentions/phones gated by
// MASK_MENTIONS/MASK_PHONES (both allowed per owner call). 9+ digit runs,
// so years/dates survive. Returns masked text + hit count.
const MASK_TOKEN = '[hidden]';
export function maskContacts(text) {
  // Owner call: usernames + phones allowed for now (MASK_MENTIONS /
  // MASK_PHONES re-enable each without a logic change). Emails + URLs
  // always masked. Returns masked text + hit count.
  if (!text) return { masked: text, n: 0 };
  let n = 0;
  let out = String(text)
    .replace(/\S+@\S+\.\S+/g, () => (n++, MASK_TOKEN))
    .replace(/https?:\/\/\S+|www\.\S+/gi, () => (n++, MASK_TOKEN));
  if (MASK_MENTIONS) out = out.replace(/@[A-Za-z0-9_]{2,}/g, () => (n++, MASK_TOKEN));
  if (MASK_PHONES) out = out.replace(/\+?\d[\d\s.\-]{6,}\d/g, (m) => (((m.match(/\d/g) || []).length >= 9 ? (n++, MASK_TOKEN) : m)));
  return { masked: out, n };
}

// Low-effort hard block (owner call: outright, uncounted). Runs on the raw
// text/caption before any DB insert so blocked tries never touch burst or
// text limits. Returns a reason key, or null when the text is fine. Empty
// input is skipped (caption/media gates own those).
const LOWQ_EXACT = new Set([
  'test', 'tes', 'try', 'cuba', 'cuba test', 'testing',
  'hai', 'hi', 'hey', 'hello', 'halo', 'salam', 'salam test',
  'ok', 'okay', 'okok', 'okey', 'baik',
  'lol', 'haha', 'hahaha', 'hahahaha', 'hehe', 'hehehe', 'hihi', 'hmm', 'hm',
  'first', 'pertama', 'assalamualaikum',
]);
const LOWQ_PUNCT_RE = /^[\s.\-–—?!…~*_+=\/\\|:'";,()\[\]{}<>^`]+$/;
const LOWQ_REPEAT_RE = /^(.)\1{3,}$/s;
const LOWQ_LAUGH_RE = /^(ha|he|hi|ho|hu|la|wa|wk|kk|ek|lol|wkwk|haha|hehe|hihi)+h?$/i;
export function isLowQuality(text) {
  if (text == null) return null;
  const raw = String(text);
  if (!raw.trim()) return null; // empty → other gates own it
  if ([...raw.trim()].length < 5) return 'short';
  const norm = raw.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) {
    // No alphanumerics at all (emoji-only etc.) and not tiny → punctuation art.
    if (LOWQ_PUNCT_RE.test(raw)) return 'punct';
    if ([...raw.trim()].length < 5) return 'short';
    return 'punct';
  }
  if (LOWQ_EXACT.has(norm)) return 'exact';
  const nospace = norm.replace(/ /g, '');
  if (LOWQ_REPEAT_RE.test(nospace)) return 'repeat';
  if (LOWQ_LAUGH_RE.test(nospace)) return 'laugh';
  if (LOWQ_PUNCT_RE.test(raw)) return 'punct';
  return null;
}

// Native poll helpers (V1.6.0). Question lives in sub.text; options/quiz
// flags ride poll_data. Render is shared by staging preview + inbox card
// (markAnswer exposes the quiz answer to mods only — never the channel).
export function pollRender(question, opts, correct = null, markAnswer = false) {
  const lines = [`📊 ${question ?? '(empty)'}`];
  (opts ?? []).forEach((o, i) => lines.push(`${i + 1}. ${o}${markAnswer && i === correct ? ' ✓' : ''}`));
  return lines.join('\n');
}
export function pollCensor(question, pd) {
  let n = 0;
  const q = censorProfanity(question ?? '');
  n += q.n;
  const opts = (pd?.options ?? []).map((o) => { const c = censorProfanity(o); n += c.n; return c.censored; });
  const ex = pd?.explain ? censorProfanity(pd.explain) : null;
  if (ex) n += ex.n;
  return { question: q.censored, options: opts, explain: ex ? ex.censored : null, n };
}

// Profanity auto-censor (channel surface only). Explicit verbatim forms for
// the owner's four; uniform first-last fallback for the rest (same length, so
// spoiler offsets stay valid). Word-root + \w* catches inflections
// (fucking, bodohnya). Returns censored text + hit count.
const PROFANITY_EXACT = { babi: 'b*bi', fuck: 'f**k', bodo: 'b*d*', bodoh: 'b*d*h' };
const PROFANITY_EXTRA = [
  'pukimak', 'kimak', 'lancau', 'cibai', 'sial', 'bangang', 'celaka', 'bahalol',
  'pantat', 'bontot', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'pussy',
  'slut', 'fucker',
];
const maskWord = (w) => (w.length <= 2 ? w[0] + '*' : w[0] + '*'.repeat(w.length - 2) + w[w.length - 1]);
export function censorProfanity(text) {
  if (!text) return { censored: text, n: 0 };
  let n = 0;
  let out = String(text);
  // Longest-first: `bodoh` must match before `bodo` (both verbatim).
  const exactKeys = Object.keys(PROFANITY_EXACT).sort((a, b) => b.length - a.length);
  for (const w of exactKeys) {
    const rep = PROFANITY_EXACT[w];
    out = out.replace(new RegExp(`\\b${w}\\w*`, 'gi'), (m) => (n++, rep + '*'.repeat(Math.max(0, m.length - w.length))));
  }
  for (const w of PROFANITY_EXTRA) {
    out = out.replace(new RegExp(`\\b${w}\\w*`, 'gi'), (m) => (n++, maskWord(m)));
  }
  return { censored: out, n };
}

// Copy-paste reply markers (r: / rep: / reply:, colon or dash, line-start).
// Returns the matched marker text, or null. Inline "reply kat komen" is safe:
// no line-start anchor, no colon/dash right after the word.
const RPL_PREFIX_RE = /^\s*(r|rep|reply)\s*[:\-–—]\s*\S/im;
export function detectReplyPrefix(text) {
  if (!text) return null;
  const m = String(text).match(RPL_PREFIX_RE);
  return m ? m[0].trim().slice(0, 24) : null;
}

// Group invite links (post 131701: privacy — member-visible groups attract
// scammers). Runs on RAW text before contact-masking destroys URLs. Returns
// the matched link head, or null. Own-channel refs (t.me/unijaconfession…)
// are excluded; bare t.me/<handle> otherwise holds (groups, channels, bots
// are indistinguishable by URL, and the gate is soft — one tap to clear).
const GRP_LINK_RES = [
  /t\.me\/\+[\w-]+/i, // private invite hash
  /t\.me\/joinchat\/[\w-]+/i, // legacy invite
  /telegram\.me\/\+[\w-]+/i,
  /telegram\.me\/joinchat\/[\w-]+/i,
  /chat\.whatsapp\.com\/[\w-]+/i, // WA group invite
  /t\.me\/(?!unijaconfession\b)[A-Za-z0-9_]{2,}/i, // bare handle minus own channel
  /telegram\.me\/(?!unijaconfession\b)[A-Za-z0-9_]{2,}/i,
];
export function detectGroupLink(text) {
  if (!text) return null;
  const s = String(text);
  for (const re of GRP_LINK_RES) {
    const m = s.match(re);
    if (m) return m[0].slice(0, 32);
  }
  return null;
}

// Ad-keyword nudge (post 61294 iklan ban + 68591 rumah-sewa ban). NUDGE ONLY:
// appends a caution line on the preview, blocks nothing. Returns the matched
// word, or null. Bare "bilik"/"pm"/prices never trigger alone (too noisy);
// prices need a goods-word in the same text. `servis` included by owner call
// (legit Servis ask-questions get the same harmless line).
const AD_WORD_RES = [
  /\bju(al|alan)\b/i, /\b(di|ter)ju(al|alan)\b/i, /\blet\s?go\b/i, /\bpreloved\b/i,
  /\bbundle\b/i, /\btiket\b/i, /\bready\s+sto(c?)k\b/i, /\bopen\s+order\b/i,
  /\bcod\b/i, /\bpostage\b/i, /\bberminat\s+pm\b/i, /\bpm\s+tepi\b/i,
  /\bservis\w*\b/i, /\bsewa\w*\b/i, /\bdisewa\b/i, /\brumah\s+sewa\b/i,
  /\bbilik\s+sewa\b/i, /\bbilik\s+untuk\s+disewa\b/i, /\bkekosongan\b/i,
  /\bhousemate\b/i, /\broommate\b/i, /\bdeposit\b/i, /\bmencari\s+rumah\b/i,
  /\bslot\b/i,
];
const AD_PRICE_RE = /\brm\s?\d|\d+\s?rm\b|\bringgit\b/i;
const AD_GOODS_RE = /\bju(al|alan)|tiket|preloved|bundle|sewa|deposit|bilik|buku|kasut|phone|dobi|basikal|dryer/i;
export function detectAdNudge(text) {
  if (!text) return null;
  const s = String(text);
  for (const re of AD_WORD_RES) {
    const m = s.match(re);
    if (m) return m[0].slice(0, 24);
  }
  if (AD_PRICE_RE.test(s) && AD_GOODS_RE.test(s)) return 'harga+barang';
  return null;
}

// Midnight mode: clock-auto (isQuiet window) with manual meta override.
// meta `midnight` absent = auto; '1' = force on; '0' = force off.
export async function midnightActive(now = Date.now()) {
  const r = await db.select().from(meta).where(eq(meta.key, 'midnight')).get().catch(() => null);
  if (r?.value === '1') return true;
  if (r?.value === '0') return false;
  return isQuiet(now);
}
export async function setMidnight(mode) {
  // mode: 'on' | 'off' | 'auto'. Insert-ignore then update (proven primitives).
  if (mode === 'auto') {
    await db.delete(meta).where(eq(meta.key, 'midnight')).run().catch(() => {});
    return;
  }
  const v = mode === 'on' ? '1' : '0';
  await db.insert(meta).values({ key: 'midnight', value: v }).onConflictDoNothing().run().catch(() => {});
  await db.update(meta).set({ value: v }).where(eq(meta.key, 'midnight')).run().catch(() => {});
}
// Debug mode: owner-only switch. Cards gain a ⚙️ id line (no tg_id — safe
// for admin eyes); full tg_id trails live only in /debuginfo owner DMs.
export async function debugOn() {
  const r = await db.select().from(meta).where(eq(meta.key, 'debug')).get().catch(() => null);
  return r?.value === '1';
}
export async function setDebug(on) {
  // Insert-ignore then update (proven primitives).
  if (on) {
    await db.insert(meta).values({ key: 'debug', value: '1' }).onConflictDoNothing().run().catch(() => {});
    await db.update(meta).set({ value: '1' }).where(eq(meta.key, 'debug')).run().catch(() => {});
  } else {
    await db.delete(meta).where(eq(meta.key, 'debug')).run().catch(() => {});
  }
}

// Maintenance mode: owner-pauser for new submissions (review side runs on).
// Singleton meta row `maintenance` = '1'/null. EXEMPT_IDS bypass at the gate.
export async function maintOn() {
  const r = await db.select().from(meta).where(eq(meta.key, 'maintenance')).get().catch(() => null);
  return r?.value === '1';
}
export async function setMaint(on) {
  // Insert-ignore then update = idempotent upsert from proven primitives.
  if (on) {
    await db.insert(meta).values({ key: 'maintenance', value: '1' }).onConflictDoNothing().run().catch(() => {});
    await db.update(meta).set({ value: '1' }).where(eq(meta.key, 'maintenance')).run().catch(() => {});
  } else {
    await db.delete(meta).where(eq(meta.key, 'maintenance')).run().catch(() => {});
  }
}
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

// FAQ sync: pull the Sheet CSV (link-shared Viewer) → upsert faq replica.
// Minimal RFC4180 parser (quoted fields span lines/commas; "" = quote).
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c === '\r') { /* skip */ }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const FAQ_COLS = ['key', 'category', 'question_ms', 'answer_ms', 'question_en', 'answer_en', 'sort', 'active', 'source'];

// Runtime has no global fetch — use the platform SDK client.
async function sheetCsv() {
  try {
    const r = await sdkFetch(FAQ_CSV_URL);
    if (!r.ok) return { ok: false, error: `sheet HTTP ${r.status}` };
    return { ok: true, text: await r.text() };
  } catch (e) {
    return { ok: false, error: 'pull failed: ' + String(e?.message ?? e).slice(0, 100) };
  }
}
export async function syncFaq() {
  const got = await sheetCsv().catch((e) => ({ ok: false, error: String(e?.message ?? e).slice(0, 120) }));
  if (!got.ok) return { ok: false, error: `${got.error ?? 'pull failed'} — check link-sharing (Viewer).` };
  const rows = parseCsv(got.text);
  if (!rows.length || rows[0].join(',').toLowerCase().replace(/\s/g, '') !== FAQ_COLS.join(',')) {
    return { ok: false, error: 'header mismatch — expected: ' + FAQ_COLS.join(',') };
  }
  const seen = new Set();
  let added = 0, updated = 0;
  for (const r of rows.slice(1)) {
    if (!r[0] || !r[0].trim()) continue; // skip blank rows
    const v = {
      key: r[0].trim(),
      category: (r[1] ?? '').trim() || null,
      questionMs: r[2] ?? null,
      answerMs: r[3] ?? null,
      questionEn: (r[4] ?? '').trim() || null,
      answerEn: (r[5] ?? '').trim() || null,
      sort: Number(r[6]) || 0,
      active: String(r[7] ?? '').trim().toUpperCase() === 'TRUE' ? 1 : 0,
      source: (r[8] ?? '').trim() || null,
    };
    seen.add(v.key);
    const old = await db.select().from(faq).where(eq(faq.key, v.key)).get().catch(() => null);
    if (!old) {
      await db.insert(faq).values(v).run().catch(() => {});
      added++;
    } else {
      const same = FAQ_COLS.slice(1).every((c) => {
        const col = { category: 'category', question_ms: 'questionMs', answer_ms: 'answerMs', question_en: 'questionEn', answer_en: 'answerEn', sort: 'sort', active: 'active', source: 'source' }[c];
        return (old[col] ?? null) === (v[col] ?? null);
      });
      if (!same) {
        const { key, ...rest } = v;
        await db.update(faq).set(rest).where(eq(faq.key, v.key)).run().catch(() => {});
        updated++;
      }
    }
  }
  // Keys gone from the sheet deactivate (master removed them).
  const all = await db.select().from(faq).all().catch(() => []);
  let deactivated = 0;
  for (const r of all ?? []) {
    if (!seen.has(r.key) && r.active !== 0) {
      await db.update(faq).set({ active: 0 }).where(eq(faq.key, r.key)).run().catch(() => {});
      deactivated++;
    }
  }
  const act = await db.get(sql`SELECT COUNT(*) AS c FROM faq WHERE active = 1`).catch(() => ({ c: 0 }));
  return { ok: true, added, updated, deactivated, total: seen.size, active: act?.c ?? 0 };
}

// SID tagging (phase 1: intake + ask surfaces): appends [key] to user-facing
// text when debug is on. Call as tag('faqNudge', T.faqNudge) — key names
// double as stable system ids (no numeric registry to rot). Toasts excluded.
export async function tag(key, text) {
  try { if (await debugOn()) return `${text}\n[${key}]`; } catch {}
  return text;
}

// Owner-only full record dump for /debuginfo (tg_id included — DM only).
// Audit match is substring LIKE so #C12 also catches #C123 — last 8 only.
export async function debugDump(id) {
  const sub = await db.select().from(submissions).where(eq(submissions.id, id)).get().catch(() => null);
  if (!sub) return null;
  const u = await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
  const intents = await db.all(sql`SELECT state, kind FROM pending_intents WHERE user_id = ${sub.userId} ORDER BY id DESC LIMIT 3`).catch(() => []);
  const trail = await db.all(sql`SELECT action, admin_id FROM audit WHERE reason LIKE ${'%#C' + id + '%'} ORDER BY id DESC LIMIT 8`).catch(() => []);
  const chan = Array.isArray(sub.channelMessageIds) ? sub.channelMessageIds.join(',') : (sub.channelMessageIds ?? '—');
  return [
    `#C${sub.id} · ${sub.kind ?? '?'} · ${sub.status}`,
    `user: ${u ? `${await cardWho(u)} (u${u.id}, tg ${u.tgId}, lang ${u.lang ?? '?'})` : 'gone'}`,
    `serials: kind_seq ${sub.kindSeq ?? '—'} · ask ${sub.askCat ?? '—'}/${sub.askSub ?? '—'}`,
    `msgs: user ${sub.userMessageId ?? '—'} · preview ${sub.previewMsgId ?? '—'} · action ${sub.actionMsgId ?? '—'} · inbox ${sub.inboxMessageId ?? '—'}/${sub.inboxCardId ?? '—'} · channel ${chan || '—'}`,
    `intents: ${(intents ?? []).map((r) => `${r.state}(${r.kind ?? '?'})`).join(' ') || '—'}`,
    `audit: ${(trail ?? []).map((r) => `${r.action}#${r.admin_id}`).join(' ') || '—'}`,
  ].join('\n');
}
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
  const base = sql`SELECT COUNT(*) AS c FROM submissions WHERE user_id = ${userId} AND (media_kind = 'text' OR media_kind = 'poll') AND status != 'rejected' AND status != 'unconfirmed' AND status != 'superseded'`;
  const h = await db.get(sql`${base} AND created_at > unixepoch() - 3600`).catch(() => ({ c: 0 }));
  if ((h?.c ?? 0) >= TEXT_HOURLY_LIMIT) return { ok: false, which: `${TEXT_HOURLY_LIMIT}/hour` };
  const d = await db.get(sql`${base} AND created_at > unixepoch() - 86400`).catch(() => ({ c: 0 }));
  if ((d?.c ?? 0) >= TEXT_DAILY_LIMIT) return { ok: false, which: `${TEXT_DAILY_LIMIT}/day` };
  return { ok: true };
}

// Channel publish (shared by Accept-now and queue flush). Throws on failure;
// spoiler CID tag, entities-based, never parse_mode. Footer carries the
// public post number `#<firstMsgId>` — stamped in a second pass (ids only
// exist after sending), best-effort non-blocking. Caption slices hold back
// NUM_RESERVE so the stamp never overflows a maxed caption.
const NUM_RESERVE = 24;
async function stampPostNumber(first, aid) {
  if (!first) return;
  const num = `#${first.id}`;
  const fullTag = `\n\n${aid ? num + ' · ' + aid : num}`;
  const ents = aid ? [{ type: 'spoiler', offset: first.pre.length + 2 + num.length + 3, length: aid.length }] : undefined;
  try {
    if (first.caption) await api.editMessageCaption({ chat_id: CHANNEL_ID, message_id: first.id, caption: first.pre + fullTag, ...(ents ? { caption_entities: ents } : {}) });
    else await api.editMessageText({ chat_id: CHANNEL_ID, message_id: first.id, text: first.pre + fullTag, ...(ents ? { entities: ents } : {}) });
  } catch (e) {
    console.error('number stamp failed:', e?.description ?? e?.message ?? e);
  }
}
export async function publishToChannel(sub) {
  const threadParams = sub.refMsgId ? { reply_parameters: { message_id: sub.refMsgId } } : {};
  const userRow = await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
  const authorAid = userRow ? await dispAid(userRow) : null;
  const tag = authorAid ? `\n\n${authorAid}` : '';
  const spoilerOf = (body) => (authorAid ? [{ type: 'spoiler', offset: body.length + 2, length: authorAid.length }] : undefined);
  const rows = await db.select().from(parts).where(eq(parts.submissionId, sub.id)).orderBy(parts.id).all().catch(() => []);
  const k = kindOf(sub);
  const baseTag = k === 'dana' ? danaTag(sub) : (k && KIND_TAGS[k] ? KIND_TAGS[k] : null);
  const leadTag = baseTag ? baseTag + (sub.kindSeq ?? '') : null; // #lost1… (null-seq rows: bare tag)
  const askLead = k === 'question' && askCatLabel(sub) ? ` · ${askCatLabel(sub)}` : '';
  const qp = leadTag ? leadTag + askLead + '\n\n' : ''; // questions/lost/found lead with the tag
  // Channel-only profanity censor (card + preview keep the original + kesat flag).
  const pubText = PROFANITY_MASK ? censorProfanity(sub.text ?? '').censored : (sub.text ?? '');
  const pubCap = PROFANITY_MASK ? censorProfanity(sub.caption ?? '').censored : (sub.caption ?? '');
  // Native poll (V1.6.0): anonymity enforced by construction —
  // is_anonymous is always true, no override path. Kind tags can't ride a
  // poll (no caption/entities), so polls post bare. Polls can't be edited
  // post-votes, so no number stamp either (ids still recorded).
  if (sub.mediaKind === 'poll') {
    const pd = sub.pollData ?? {};
    const pc = PROFANITY_MASK ? pollCensor(sub.text ?? '', pd) : { question: sub.text ?? '', options: pd.options ?? [], explain: pd.explain ?? null };
    const question = String(pc.question ?? '').slice(0, 255) || '(poll)';
    const options = (pc.options ?? []).slice(0, 10).map((o) => String(o ?? '').slice(0, 100)).filter((o) => o);
    if (options.length < 2) throw new Error('poll needs 2+ options');
    const isQuiz = pd.correct != null;
    const m = await api.sendPoll({
      chat_id: CHANNEL_ID,
      question, options: options.map((text) => ({ text })),
      is_anonymous: true, type: isQuiz ? 'quiz' : 'regular',
      ...(pd.multi ? { allows_multiple_answers: true } : {}),
      ...(isQuiz ? { correct_option_id: Math.min(Math.max(0, pd.correct), options.length - 1) } : {}),
      ...(isQuiz && pc.explain ? { explanation: pc.explain.slice(0, 200) } : {}),
      ...threadParams,
    });
    return [m.message_id];
  }
  if (sub.mediaKind === 'text') {
    const core = pubText.slice(0, 4096 - tag.length - qp.length - NUM_RESERVE);
    const body = core ? qp + core : '(empty)';
    const m = await api.sendMessage({ chat_id: CHANNEL_ID, text: body + tag, ...(authorAid ? { entities: spoilerOf(body) } : {}), ...threadParams });
    await stampPostNumber({ id: m.message_id, pre: body, caption: false }, authorAid);
    return [m.message_id];
  }
  if (sub.mediaKind === 'photo' || sub.mediaKind === 'video') {
    const p = rows[0];
    if (!p) throw new Error('missing part');
    const capBase = qp + pubCap.slice(0, 1024 - tag.length - qp.length - NUM_RESERVE);
    const cap = capBase + tag;
    const m = sub.mediaKind === 'photo'
      ? await api.sendPhoto({ chat_id: CHANNEL_ID, photo: p.fileId, ...(capBase || tag ? { caption: cap } : {}), ...(authorAid ? { caption_entities: spoilerOf(capBase) } : {}), ...threadParams })
      : await api.sendVideo({ chat_id: CHANNEL_ID, video: p.fileId, ...(capBase || tag ? { caption: cap } : {}), ...(authorAid ? { caption_entities: spoilerOf(capBase) } : {}), ...threadParams });
    const ids = [m.message_id];
    if (pubCap.length > 1024 - tag.length - qp.length - NUM_RESERVE) {
      const extraBody = pubCap.slice(1024 - tag.length - qp.length - NUM_RESERVE, 5000 - tag.length);
      const extra = await api.sendMessage({ chat_id: CHANNEL_ID, text: extraBody + tag, ...(authorAid ? { entities: spoilerOf(extraBody) } : {}) });
      ids.push(extra.message_id);
    }
    await stampPostNumber({ id: m.message_id, pre: capBase, caption: true }, authorAid);
    return ids;
  }
  if (sub.mediaKind === 'voice' || sub.mediaKind === 'document') {
    const p = rows[0];
    if (!p) throw new Error('missing part');
    const capBase = qp + pubCap.slice(0, 1024 - tag.length - qp.length - NUM_RESERVE);
    const cap = capBase + tag;
    const m = sub.mediaKind === 'voice'
      ? await api.sendVoice({ chat_id: CHANNEL_ID, voice: p.fileId, ...(capBase || tag ? { caption: cap } : {}), ...(authorAid ? { caption_entities: spoilerOf(capBase) } : {}), ...threadParams })
      : await api.sendDocument({ chat_id: CHANNEL_ID, document: p.fileId, ...(capBase || tag ? { caption: cap } : {}), ...(authorAid ? { caption_entities: spoilerOf(capBase) } : {}), ...threadParams });
    await stampPostNumber({ id: m.message_id, pre: capBase, caption: true }, authorAid);
    return [m.message_id];
  }
  if (sub.mediaKind === 'sticker') {
    const p = rows[0];
    if (!p) throw new Error('missing part');
    const m = await api.sendSticker({ chat_id: CHANNEL_ID, sticker: p.fileId, ...threadParams });
    const ids = [m.message_id];
    // Stickers carry no caption — the kind tag + A-id ride a text follow-up.
    const follow = qp + tag;
    if (follow.trim()) {
      const t = await api.sendMessage({ chat_id: CHANNEL_ID, text: follow, ...(authorAid ? { entities: spoilerOf(qp) } : {}) });
      ids.push(t.message_id);
      await stampPostNumber({ id: t.message_id, pre: qp, caption: false }, authorAid);
    }
    return ids;
  }
  // album (legacy drain path)
  const albumCapBase = qp + pubCap.slice(0, 1024 - tag.length - qp.length - NUM_RESERVE);
  const media = rows.map((p, i) => ({
    type: p.type, media: p.fileId,
    ...(i === 0 && (albumCapBase || tag) ? { caption: albumCapBase + tag } : {}),
    ...(i === 0 && authorAid ? { caption_entities: spoilerOf(albumCapBase) } : {}),
  }));
  const sent = await api.sendMediaGroup({ chat_id: CHANNEL_ID, media });
  const ids = (Array.isArray(sent) ? sent : [sent]).map((m) => m.message_id);
  if (pubCap.length > 1024 - tag.length - qp.length - NUM_RESERVE) {
    const extraBody = pubCap.slice(1024 - tag.length - qp.length - NUM_RESERVE, 5000 - tag.length);
    const extra = await api.sendMessage({ chat_id: CHANNEL_ID, text: extraBody + tag, ...(authorAid ? { entities: spoilerOf(extraBody) } : {}) });
    ids.push(extra.message_id);
  }
  await stampPostNumber({ id: ids[0], pre: albumCapBase, caption: true }, authorAid);
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

// BotFather-style stats helpers: hourly last-seen touch (clears dead on
// inbound — a message proves the account alive), daily outgoing counter,
// dead-flagging on 403-class send failures.
export async function touchSeen(u) {
  if (!u?.id) return;
  const last = u.lastSeen instanceof Date ? u.lastSeen.getTime() / 1000 : Number(u.lastSeen) || 0;
  if (Date.now() / 1000 - last < 3600 && !u.dead) return;
  await db.update(users).set({ lastSeen: sql`(unixepoch())`, dead: 0 }).where(eq(users.id, u.id)).run().catch(() => {});
}

export async function bumpOut(n = 1) {
  if (!(n > 0)) return;
  await db.run(sql`INSERT INTO day_out(day, n) VALUES (date('now'), ${n}) ON CONFLICT(day) DO UPDATE SET n = n + ${n}`).catch(() => {});
}

export async function markDeadByTg(tgId) {
  const u = await db.select().from(users).where(eq(users.tgId, tgId)).get().catch(() => null);
  if (u && !u.dead) await db.update(users).set({ dead: 1 }).where(eq(users.id, u.id)).run().catch(() => {});
}

// Admin performance: per-admin action counts from the audit trail + median
// triage latency (card created → admin stamp, via `#C<id>` reasons).
// mention_all rows are housekeeping, never counted.
const STAT_BUCKETS = [
  ['Accept', ['accept', 'republish', 'queue']],
  ['Reject', ['reject']],
  ['Warn', ['warn']],
  ['Ban', ['ban']],
  ['Undo', ['undo']],
  ['Appeals', ['appeal_accept', 'appeal_reject']],
];
const STAT_OTHER = ['report_remove', 'report_dismiss', 'edit_apply', 'edit_dismiss', 'edit_gone', 'reply', 'chat_reply', 'chat_start', 'unban', 'unbutton', 'stripped', 'note', 'unnote'];

function tsSec(v) {
  if (v == null) return null;
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtDurMs(s) {
  if (s < 60) return `${s} sec`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} hr`;
}

// On-duty greens (tg ids) for !all scoping + stats dots.
export async function dutyGreens() {
  const rows = await db.select().from(duty).where(eq(duty.on, 1)).all().catch(() => []);
  return new Set((rows ?? []).map((r) => Number(r.tgId)));
}

// /botstats: BotFather-style totals from our own tables. Blocked-known only
// grows when sends fail (same honesty rule as BotFather's footnote).
export async function botStatsText() {
  const u = await db.get(sql`SELECT COUNT(*) AS all, SUM(banned) AS ban, SUM(dead) AS dead, SUM(last_seen > unixepoch() - 604800) AS a7, SUM(last_seen > unixepoch() - 2592000) AS a30 FROM users`).catch(() => null);
  const s = await db.get(sql`SELECT COUNT(*) AS all FROM submissions`).catch(() => ({ all: 0 }));
  const bySt = await db.all(sql`SELECT status, COUNT(*) AS c FROM submissions GROUP BY status`).catch(() => []);
  const st = Object.fromEntries((bySt ?? []).map((r) => [r.status, r.c]));
  const kinds = await db.all(sql`SELECT kind, COUNT(*) AS c FROM submissions WHERE kind IS NOT NULL AND kind != 'confession' GROUP BY kind`).catch(() => []);
  const out7 = await db.get(sql`SELECT SUM(n) AS s FROM day_out WHERE day > date('now', '-7 days')`).catch(() => ({ s: 0 }));
  const in7 = await db.get(sql`SELECT COUNT(*) AS c FROM submissions WHERE created_at > unixepoch() - 604800`).catch(() => ({ c: 0 }));
  const blast = await db.get(sql`SELECT reason, created_at FROM audit WHERE action = 'announce' ORDER BY id DESC LIMIT 1`).catch(() => null);
  const pub = (st.approved ?? 0) + (st['approved-undone'] ?? 0);
  const rev = (st.pending ?? 0) + (st.unconfirmed ?? 0) + (st['pending-album'] ?? 0);
  const kline = (kinds ?? []).map((r) => `#${r.kind} ${r.c}`).join(' · ') || '—';
  const bts = blast?.created_at instanceof Date ? blast.created_at.toISOString().slice(0, 10)
    : blast?.created_at ? new Date(Number(blast.created_at) * 1000).toISOString().slice(0, 10) : null;
  return `📊 Bot stats\n\nUsers\nAll: ${u?.all ?? 0} · Banned: ${u?.ban ?? 0} · Blocked (known): ${u?.dead ?? 0}\nActive: ${u?.a7 ?? 0} (7d) · ${u?.a30 ?? 0} (30d)\n\nSubmissions\nAll: ${s?.all ?? 0} · ✅ ${pub} published · ⏳ ${st.queued ?? 0} queued · 👀 ${rev} in review · ❌ ${st.rejected ?? 0} rejected\nKinds: ${kline}\n\nBot talk (7d)\nOutgoing: ${out7?.s ?? 0} · Incoming: ${in7?.c ?? 0}\n\nLast blast: ${blast ? `${blast.reason} (${bts})` : 'never'}`;
}

// /oldest pages: 5 oldest awaiting-review cards per page, stateless cursor.
// Card links only render when inbox_card_id was stored (older rows predate it).
const OLDEST_N = 5;
export async function oldestPage(page = 0) {
  const total = await db.get(sql`SELECT COUNT(*) AS c FROM submissions WHERE status IN ('pending','pending-album','queued')`).catch(() => ({ c: 0 }));
  const n = Number(total?.c ?? 0);
  if (!n) return { text: 'Queue is clear — nothing awaiting review.', buttons: null };
  const pages = Math.max(1, Math.ceil(n / OLDEST_N));
  const p = Math.min(Math.max(0, page), pages - 1);
  const rows = await db.all(sql`SELECT id, kind, status, text, caption, inbox_card_id, created_at FROM submissions WHERE status IN ('pending','pending-album','queued') ORDER BY id ASC LIMIT ${OLDEST_N} OFFSET ${p * OLDEST_N}`).catch(() => []);
  const now = Math.floor(Date.now() / 1000);
  const age = (v) => {
    const s = Math.max(0, now - (v instanceof Date ? Math.floor(v.getTime() / 1000) : Number(v) || now));
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  };
  const gid = String(ADMIN_GROUP_ID).replace('-100', '');
  const lines = (rows ?? []).map((r) => {
    const k = r.kind && KIND_TAGS[r.kind] ? ` ${KIND_TAGS[r.kind]}` : '';
    const snip = String(r.text ?? r.caption ?? '').slice(0, 60).replace(/\n/g, ' ');
    const link = r.inbox_card_id ? ` — https://t.me/c/${gid}/${r.inbox_card_id}` : '';
    return `• #C${r.id}${k} — ${age(r.created_at)} waiting (${r.status})${snip ? `\n  “${snip}”` : ''}${link}`;
  });
  const nav = [];
  if (p > 0) nav.push({ text: '‹ Newer', callback_data: `oldest:${p - 1}` });
  if (p < pages - 1) nav.push({ text: `Older (${p * OLDEST_N + 6}–${Math.min(n, (p + 1) * OLDEST_N + 5)}) ›`, callback_data: `oldest:${p + 1}` });
  return { text: `🕰️ Oldest awaiting review (page ${p + 1}/${pages}, ${n} total)\n${lines.join('\n')}`, buttons: nav.length ? { inline_keyboard: [nav] } : null };
}

// Admin /tutorial pages (English on group surfaces). Same stateless pattern.
export function atutRow(n, total) {
  const nav = [];
  if (n > 0) nav.push({ text: '‹ Back', callback_data: `atut:${n - 1}` });
  if (n < total - 1) nav.push({ text: 'Next ›', callback_data: `atut:${n + 1}` });
  nav.push({ text: '✖ Close', callback_data: 'dismiss' });
  return { inline_keyboard: [nav] };
}

// /tutorial page buttons (localized labels passed in). Stateless cursor.
export function tutRow(t, n) {
  const nav = [];
  if (n > 0) nav.push({ text: t.tutBack, callback_data: `tut:${n - 1}` });
  if (n < t.tutSteps.length - 1) nav.push({ text: t.tutNext, callback_data: `tut:${n + 1}` });
  nav.push({ text: t.tutupBtn, callback_data: 'dismiss' });
  return { inline_keyboard: [nav] };
}

// /adminstats window switcher row (active window dotted). Shared by the
// command sender and the astats: callback editor.
export function astatsRow(days) {
  const b = (d, v) => (d === days ? `• ${v} •` : v);
  return { inline_keyboard: [[
    { text: b(7, '7d'), callback_data: 'astats:7' },
    { text: b(30, '30d'), callback_data: 'astats:30' },
    { text: b(0, 'all'), callback_data: 'astats:all' },
  ]] };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export async function adminStatsText(windowDays, label, members, dutyIds = null, crownIds = null) {
  const span = windowDays > 0 ? windowDays * 86400 : 0;
  // Raw-sql rows are snake_case (aliased short here). Card join is best-effort:
  // only `#C<id>` reasons resolve, the rest still count, just without latency.
  const q = span > 0
    ? sql`SELECT a.admin_id AS aid, a.action AS act, a.reason AS rsn, a.created_at AS at, s.created_at AS scat FROM audit a LEFT JOIN submissions s ON s.id = CAST(SUBSTR(a.reason, 3) AS INTEGER) WHERE a.action NOT IN ('mention_all', 'mention_active') AND a.created_at > unixepoch() - ${span}`
    : sql`SELECT a.admin_id AS aid, a.action AS act, a.reason AS rsn, a.created_at AS at, s.created_at AS scat FROM audit a LEFT JOIN submissions s ON s.id = CAST(SUBSTR(a.reason, 3) AS INTEGER) WHERE a.action NOT IN ('mention_all', 'mention_active')`;
  const rows = await db.all(q).catch(() => []);
  const byId = new Map();
  let sysQueue = 0;
  let sysMask = 0;
  for (const r of rows ?? []) {
    const aid = Number(r.aid);
    if (!Number.isFinite(aid)) continue;
    // Machine rows (adminId 0): queue auto-posts + contact masks — collapsed
    // into one trailing line, never ranked as a person.
    if (aid === 0) {
      if (r.act === 'stripped') sysMask++;
      else sysQueue++;
      continue;
    }
    if (!byId.has(aid)) byId.set(aid, { buckets: STAT_BUCKETS.map(() => 0), other: 0, lat: [] });
    const e = byId.get(aid);
    const act = String(r.act ?? '');
    const bi = STAT_BUCKETS.findIndex(([, acts]) => acts.includes(act));
    if (bi >= 0) e.buckets[bi]++;
    else if (STAT_OTHER.includes(act)) e.other++;
    const a = tsSec(r.at);
    const c = tsSec(r.scat);
    if (a != null && c != null && a >= c && a - c < 30 * 86400) e.lat.push(a - c);
  }
  if (!byId.size && !sysQueue && !sysMask) return `🏆 Admin stats (${label})\nNo admin actions in this window.`;
  const sysBits = [];
  if (sysQueue > 0) sysBits.push(`${sysQueue} queue posts`);
  if (sysMask > 0) sysBits.push(`${sysMask} contact masks`);
  const sysLine = sysBits.length ? `🤖 system (auto): ${sysBits.join(', ')}` : '';
  const names = new Map((members ?? []).map((m) => [m.id, m]));
  const ranked = [...byId.entries()]
    .map(([aid, e]) => ({ aid, e, total: e.buckets.reduce((x, y) => x + y, 0) + e.other }))
    .sort((a, b) => b.total - a.total);
  // Plain-word buckets — empty ones vanish, no codes.
  const words = ['✅ accepted', '❌ rejected', '⚠️ warnings', '⛔ bans', '↩️ undos', '📨 appeals'];
  const lines = ranked.map(({ aid, e, total }, i) => {
    const m = names.get(aid);
    const dot = dutyIds?.has(aid) ? '🟢 ' : '';
    const crown = crownIds?.get(aid) ? `${crownIds.get(aid)} ` : '';
    const who = m ? adminDisplay(m) : `id${aid}`;
    const parts = e.buckets.map((n, k) => (n > 0 ? `${words[k].split(' ')[0]} ${n} ${words[k].split(' ').slice(1).join(' ')}` : '')).filter(Boolean);
    if (e.other > 0) parts.push(`📦 ${e.other} other`);
    const med = median(e.lat);
    return `${i + 1}. ${dot}${who} — ${total} actions\n   ${parts.join(' · ') || '—'}${med != null ? `\n   ⏱️ median response: ${fmtDurMs(med)}` : ''}`;
  });
  if (sysLine) lines.push(sysLine);
  return `🏆 Admin stats (${label})\n${lines.join('\n\n')}`;
}

// /crown leaders: 30d most-actions + fastest median triage (min 5 actions).
// Same audit query as adminStatsText; ties break to the lower tg id.
// The owner is excluded (already 👑 owner everywhere; Telegram also refuses
// title changes on the group owner). Machine rows (adminId 0) never rank.
export async function crownLeaders(ownerId) {
  const rows = await db.all(sql`SELECT a.admin_id AS aid, a.action AS act, a.reason AS rsn, a.created_at AS at, s.created_at AS scat FROM audit a LEFT JOIN submissions s ON s.id = CAST(SUBSTR(a.reason, 3) AS INTEGER) WHERE a.action NOT IN ('mention_all', 'mention_active') AND a.created_at > unixepoch() - ${30 * 86400}`).catch(() => []);
  const byId = new Map();
  for (const r of rows ?? []) {
    const aid = Number(r.aid);
    if (!Number.isFinite(aid) || aid === 0 || aid === ownerId) continue;
    if (!byId.has(aid)) byId.set(aid, { total: 0, lat: [] });
    const e = byId.get(aid);
    const act = String(r.act ?? '');
    if (STAT_BUCKETS.some(([, acts]) => acts.includes(act)) || STAT_OTHER.includes(act)) e.total++;
    const a = tsSec(r.at);
    const c = tsSec(r.scat);
    if (a != null && c != null && a >= c && a - c < 30 * 86400) e.lat.push(a - c);
  }
  let actions = null;
  let triage = null;
  for (const [aid, e] of byId) {
    if (e.total < 1) continue;
    if (!actions || e.total > actions.total || (e.total === actions.total && aid < actions.aid)) actions = { aid, total: e.total };
    if (e.total >= 5) {
      const med = median(e.lat);
      if (med == null) continue;
      if (!triage || med < triage.med || (med === triage.med && aid < triage.aid)) triage = { aid, med, medTxt: fmtDurMs(med), total: e.total };
    }
  }
  return { actions, triage };
}

// Current crown holders for the /adminstats 👑/⚡ marker.
// Map of tgId → emoji (overall/actions → 👑, triage → ⚡).
export async function crownMap() {
  const rows = await db.select().from(crowns).all().catch(() => []);
  const m = new Map();
  for (const r of rows ?? []) {
    const id = Number(r.tgId);
    if (!Number.isFinite(id)) continue;
    const cur = m.get(id);
    const emo = r.category === 'triage' ? '⚡' : '👑';
    if (cur !== '👑') m.set(id, emo === '⚡' && cur ? cur : emo);
  }
  return m;
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
