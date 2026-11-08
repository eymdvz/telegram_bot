// Test env config — per plan.md §7, edited per `login` target, never tokens here.
export const ADMIN_GROUP_ID = -1003996987649;
export const INBOX_TOPIC_ID = 1; // General topic of Test group
export const CHANNEL_ID = -1001779734656; // Live Channel — bot must be admin (post + delete)
export const ADMIN_IDS = [230757915];
export const SUPER_ADMIN_ID = 230757915;
export const SUPER_IDS = [SUPER_ADMIN_ID, 7154716451]; // owner + co-owner (full parity: gates, /who, debug, exempt)
export const isSuper = (id) => SUPER_IDS.includes(Number(id));
export const MAX_ALBUM = 10; // legacy (album buffering retired) — kept for drain
export const ALBUM_WINDOW_MS = 30000; // legacy drain window
export const DAILY_MEDIA_LIMIT = 4; // photo/video/voice/sticker/doc submissions per user per rolling 24h (text free)
export const TEXT_HOURLY_LIMIT = 5; // text confessions per user per rolling hour
export const TEXT_DAILY_LIMIT = 20; // text confessions per user per rolling 24h
export const POST_COOLDOWN_SEC = 1800; // drip-feed: min gap between channel posts
export const QUIET_START_UTC_H = 16; // night pause start (16 UTC = 00:00 MYT)
export const QUIET_END_UTC_H = 23; // night pause end (23 UTC = 07:00 MYT)
// Safety-trio kill switches (flip + push; no migrate).
export const MASK_CONTACTS = true; // master mask switch (staging + edits)
export const MASK_MENTIONS = false; // mask @usernames (off = allowed, owner call)
export const MASK_PHONES = false; // mask phone numbers (off = allowed, owner call — watch abuse)
export const TEXT_LIMITS = true; // 5 texts/hour + 20/day rolling (EXEMPT_IDS bypass)
export const LOWQ_BLOCK = true; // hard-block low-effort intake (<5 chars, test/hai/dots…) — no card, uncounted
export const PROFANITY_MASK = true; // auto-censor curses on channel posts (card keeps original + kesat flag)
export const DRIP_FEED = false; // cooldown + night pause queue (off = Accept posts at once)
export const EXEMPT_IDS = [230757915, 7154716451]; // owner + co-owner — bypass limits/maintenance
// Warn tiers per channel terms (sites.google.com/view/unija-confession/info/terms-policies).
export const WARN_TIERS = { flood: 'ringan', other: 'ringan', spam: 'sederhana', abuse: 'sederhana', nsfw: 'berat', scam: 'berat' };
export const RINGAN_SECOND_BAN_DAYS = 7; // 2nd ringan → temp ban (terms allow 1/7/14/30; adjust via /ban)
export const SEDERHANA_BAN_DAYS = 20; // every sederhana warn carries a 20d ban per terms
export const TERMS_URL = 'https://sites.google.com/view/unija-confession/info/terms-policies';
export const APPEAL_CONTACT = '@unija_minbot'; // ringan + sederhana appealable; berat is not
export const WARN_WINDOW_DAYS = 60; // rolling window for warn escalation (0 = lifetime)
// Admin-user direct chat (diagram's Topic 2). ADMIN_CHAT_TOPIC_ID = 0 until the
// topic exists — /chat then answers "not set up yet".
export const ADMIN_CHAT_TOPIC_ID = 11009;
export const MAX_OPEN_SESSIONS = 5; // concurrent chats across users (others get "busy")
export const SESSION_IDLE_MIN = 30; // auto-close after this many idle minutes
export const CHAT_SLOWMODE_SEC = 0; // min gap between a user's chat messages (0 = off)
export const BURST_MSG_LIMIT = 3; // max staged messages per rolling window (abuse guard)
export const BURST_WINDOW_SEC = 60;
export const TAP_LIMIT = 10; // max button taps per rolling window (abuse guard)
export const TAP_WINDOW_SEC = 60;
export const TAP_NOTICE_SEC = 300; // one slow-down notice per this many seconds

export const VERSION = 'V 1.8.1 081126'; // user-visible bot version (V <maj>.<min>.<patch> DDMMYY; bump per slice, shown by /changelog)

export const ALL_COOLDOWN_SEC = 60; // shared cooldown on owner !all mention blasts

export const FAQ_URL = 'https://t.me/unijaconfession/66437'; // channel FAQ index (answers live in its comment threads)
export const MAP_URL = 'https://unija-map.vercel.app/kgb'; // UniJA campus map (Tempat › Dalam self-serve)
export const BUS_URL = 'https://sites.google.com/view/student-unija/gong-badak-kota/bus-stop'; // express bus pickup/drop (Bas › Lokasi self-serve)
export const REPLY_GUIDE_URL = 'https://t.me/unijaconfession/46470'; // how-to-reply post (reply-prefix gate notice links here)
export const REJECT_LIST_URL = 'https://t.me/unijaconfession/46990'; // reject-list post (tutorial step 3 links here)
export const IKLAN_URL = 'https://t.me/unijaconfession/109676'; // iklan niaga section (iklan grid button links here)
export const IKLAN_RULES_URL = 'https://t.me/unijaconfession/61294'; // iklan ban announcement (rules link)
export const EVENT_URL = 'https://t.me/officialUniSZAannouncement?direct'; // linked announcement channel (event grid button links here)
export const FAQ_SHEET_ID = '1FDYoghlBc46nykSQOXNZeec5hMMQNH9e1Zo49lqgnjo'; // "Unija FAQ" master (link-shared Viewer; /faqsync pulls CSV)
export const FAQ_CSV_URL = `https://docs.google.com/spreadsheets/d/${FAQ_SHEET_ID}/export?format=csv`;
export const GROUP_LINK_URL = 'https://t.me/unijaconfession/131701'; // group-link ban post (group-link gate notice links here)
export const FAQ_GATE_SEC = 15; // min pause between FAQ prompt and Dah-semak proceed
// Public channel link for the /start button (paste the t.me/... link; empty = rules-only).
export const CHANNEL_URL = '';
// Linked discussion group (channel comments live here; 0 = wiring off).
export const DISCUSSION_GROUP_ID = 0;
// User-DM language (keys of STR in lib/strings.js). Admin group side stays English.
export const LANG = 'ms';
