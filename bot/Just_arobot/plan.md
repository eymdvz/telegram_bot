# plan.md — Just_arobot feedback inbox (Livegram-style)

## 1. Goal

Anonymous-ish feedback inbox: users DM the bot, admins triage and reply from a
private group with topics. Test on `@Just_arobot`, promote the same code to live
bot `@unijaconfession_chatbot` (different Telegram account, tgcloud/serverless
access pending).

## 2. Bots and accounts

| Role | Bot | Account | State |
|------|-----|---------|-------|
| Test | `@Just_arobot` | this account | tgcloud link available — build + verify here |
| Live | `@unijaconfession_chatbot` | other account (owner-controlled) | serverless access NOT yet granted — no `login`/`push` until then |

Promotion = same code, different link: `npx tgcloud login` to test bot → push +
migrate + verify; later `login` to live bot → push + migrate + verify. No code
fork. Live group ID / topic set / admin IDs differ per environment (never
hardcode — see §7).

## 3. Hosting (decision)

This folder follows the repo pattern: **tgcloud** (V8 isolate, `push` deploys,
`migrate` syncs schema, webhook managed). Siblings: `bot/ask_the_robot/`.

Options considered:
- **tgcloud (chosen):** zero ops, matches repo ritual, built-in `db`/`api`.
  Constraint: no filesystem, no npm at runtime — so no sqlite file; the
  platform tables are the fast store, external DB via `fetch` only if needed.
- **Vercel serverless:** webhook route, 60s kill, cron daily-only. sqlite only
  as disposable `/tmp` cache (wiped on cold start), Neon/Supabase as truth.
- **VPS:** only option with a real persistent sqlite file. Own uptime/backups.

External DB (Neon vs Supabase) deferred until after the flow is agreed. On
tgcloud the platform db covers v1; external attaches later via `fetch` without
rewriting handlers.

## 4. Flow — private group/topics inbox

```mermaid
flowchart TD
  U[User DM to bot] --> B{handlers/message}
  B -->|/start /help /status /cancel| P[answer directly]
  B -->|plain message| C{banned?}
  C -->|yes| X[drop + notice]
  C -->|no| S[upsert users + get-or-create open ticket + insert messages row]
  S --> T{topic exists for user?}
  T -->|no| N[createForumTopic in admin group + insert topic_map]
  T -->|yes| F[forward to admin topic: header + user msg + Ban/Close buttons]
  N --> F
  F --> G[Admin group topic]
  G -->|admin swipe-reply| R[relay text back to user DM + insert messages row]
  G -->|/ban /unban /close /note + buttons| A[apply + audit row]
```

Rules: one open ticket per user (v1). Ban checked before anything is stored as a
ticket message. Admin group is invite-only; bot must be admin with
`can_manage_topics`. Topic-per-user; fallback to single topic with `#T<ticket>`
headers if topics are disabled.

## 5. Commands

Public (user DM): `/start` (what the bot is + consent), `/help`, `/status`
(open/closed), `/cancel` (close own ticket), `/delete_my_data`. Anything else =
ticket message.

Admin (group topics only, allowlist IDs): swipe-reply = answer; `/ban <reason>`,
`/unban`, `/close`, `/note <text>` (internal, never relayed), `/broadcast`
(double-confirm), `/stats` (open tickets, msgs/24h). Buttons: `Ban`, `Close`
under each forwarded message (`ban:<userId>` / `close:<ticketId>`).

## 6. Schema (`tgcloud/schema.js`)

`users` (tg_id unique, banned flag) · `tickets` (user_id, status, topic_id) ·
`messages` (ticket_id, direction `in`/`out`, tg_message_id, text) · `topic_map`
(topic_id↔user_id, hot read path) · `audit` (admin actions). No FKs (runtime
has them off). Schema change → `push` reports, `migrate` applies.

## 7. Secrets and env (per bot link, never in git)

Bot token lives in the tgcloud link (`.tgcloud/`, gitignored), not in code.
Config that differs test↔live (admin group id, admin IDs, live username):
keep in a `tgcloud/lib/config.js` constant edited per `login` target, or an
endpoint-set table — decided at live-promotion time. Never commit tokens.

## 8. Test → live checklist

1. `cd bot/Just_arobot` + `npm install` (local CLI only).
2. `npx tgcloud login` → test `@Just_arobot`; `push`; `migrate`; `webhook` sync check.
3. Live-verify on test: `/start`, user msg → topic created → admin reply → user
   receives; `/ban` → blocked; `/close` → `/status` closed.
4. When live account gets serverless: `login` → `@unijaconfession_chatbot`;
   `push`; `migrate`; set group/admin config; repeat step 3 on live.
5. `deploy.py` mirrors `ask_the_robot` (`python deploy.py[--migrate]`).

## 9. Open items

- Admin group for test (id?) + admin allowlist.
- External DB need (v1 platform db likely enough — confirm after flow test).
- `/broadcast` scope (all users vs open-ticket users) + rate guard.
- Media/file support in relay (v1 text-first?).

## 10. TODO (confession-queue pivot, Nov 2026)

- [x] Single inbox topic queue (`-1002435146176`, topic General) + anonymous `#C` cards
- [x] Admin cards show numeric user id (`👤 <tg_id>`) — no clickable profile in group
- [x] Owner profile lookup in private chat only: DM `/who <user id>` (super-admin)
- [x] Album support DROPPED — every photo/video posts singly, immediately
- [x] Daily media limit: 1 photo/video per user per rolling 24h, text free
- [x] Limit exemptions: `EXEMPT_IDS` (owner + list) — paste extra ids to extend
- [x] Admin swipe-reply on card/content → relay to user DM (silent OK; unreachable posts id notice)
- [x] Reaction relay both ways (bot mirrors emoji set; removals mirror too)
- [x] Reactions on admin-reply DMs loop back to the admin's group message
- [x] Warn tiers per terms: flood/other→ringan (warn, 2nd=7d, 3rd=forever) · spam/abuse→sederhana (warn+20d, 2nd=forever) · nsfw/scam→berat (instant forever, no appeal) · /unban resets slate · terms URL in /help
- [x] Ban appeals: /appeal in DM → card with Accept(unban)/Reject · berat auto-rejected · 1 pending appeal max
- [x] 60-day warn window (WARN_WINDOW_DAYS; audit-derived counts; /who shows in-window)
- [x] Ban DM voice centralized (lib/moderation.js banNotice): temp/appealable/berat forms
- [x] /unban <user id> in group (reply-to-card still works; bare form shows usage)
- [x] Back buttons on all pickers (reason→duration→main row)
- [x] Tier labels on reason buttons (· ringan/sederhana/berat) + confirm step with alert review for warn/ban
- [x] Channel replies: reply-share → ↩️ queue card → Accept threads under post (gone-post guard)
- [x] Channel forwards → disambiguate (Reply / Report) via staged intents (reply = two-step: arm → type; /cancelreply aborts)
- [x] Reports: preset reason → 🚩 card with Remove (delete+tombstone, both sides notified) / Dismiss
- [x] Bot-admin = group admins live (getChatAdministrators, 60s cache) + ADMIN_IDS fallback
- [x] Confirm-before-send (unconfirmed staging + preview + Confirm/Cancel; gates at confirm)
- [x] A-id cutover (A0001… series, lazy MAX+1; group surface shows A-id; /who resolves A/raw/legacy)
- [x] Edit flow (reply-to-own-DM /edit → ✏️ card → Apply edits channel text/caption / Dismiss)
- [x] User-admin chat sessions (Topic 2 shared; /chat opens, plain DMs route, slow-mode 2min, 30min idle, cap 5; /endadminsession both sides; swipe-reply relay + chat_map)
- [x] Admin-initiated chat (/startchat by reply or A-id; skips busy cap; banned need /unban first)
- [x] Group identity format `<tgId>-<A-id>` (e.g. 7154716451-A0001) on cards, chat lines, notices
- [x] Channel posts carry spoiler A-id tag (entities-based; preserved through edits)
- [x] Reject button (decline without warn/ban; both sides stamped/notified)
- [x] Post hyperlinks (`see the post` on Published DMs + accept stamps; URL form auto-resolved)
- [x] Contact auto-mask (emails/URLs/@mentions/phone-ish → `[hidden]` at staging; edits too; card `stripped: contact`)
- [x] Text rate limits (5/hour, 20/day rolling; EXEMPT_IDS bypass; enforced at confirm)
- [x] Drip-feed queue (30-min cooldown, MYT night pause; Accept queues with position; lazy flush on admin activity; `/flush` forces; `/stats` shows queued; re-tap idempotent) — parked OFF 04 Nov 2026 (approval-by-hand paces enough at current volume)
- [x] Command directory (role-aware `/help`: user/admin/super-admin; `/synccommands` pushes autocomplete scopes)
- [x] Safety kill switches (`MASK_CONTACTS` / `TEXT_LIMITS` / `DRIP_FEED` in config; `/start` text + `/flush` follow)
- [x] `/mystats` (DM totals: sent/published/queued/in-review/warned/rejected + 60d warn ladder; in `/help` + autocomplete)
- [x] Onboarding `/start` (how-it-works + rules + Channel/Rules URL buttons; `CHANNEL_URL` in config)
- [x] Rich `/start` (blocks: bold header paragraph + centered URL buttons; HTML+inline fallback; `/richprobe` admin probe)
- [x] `/start` action row (💬 Chat with admin → auto-opens session; ❓ FAQ → English in-development; owner-only taps)
- [x] Tanya Soalan flow (2×2 `/start` grid; `ask_q` arms question intent; `is_question` column; ❓ cards; `#ask` prefix on posts + edits; `/cancelquestion`)
- [x] Lost & Found (`kind` column; third `/start` row → Report Lost/Found; 🔍/📦 cards + `#lost`/`#found`; `/cancellostfound`; claim buttons cut 04 Nov 2026 — brokering is manual)
- [x] Per-kind serials (`kind_seq` + unique index; `#ask1`/`#lost1`/`#found1` leads, fresh from 1; race-safe retry; `/unbutton` strip command)
- [x] Intent nudge (question/lost/found/chat heuristics on confession previews; opt-in convert row; chat shortcut)
- [x] Interactive-message hygiene (previews/retired-forwards/L&F choice delete on completion, collapse fallback; notices + /start grid + cards stay)
- [x] Abuse control (burst: 3 msgs/min refused at staging; taps: 10/min via `hits` table, notice throttled; owner+admins bypass; chat slow-mode removed)
- [x] BM/EN per-user language (`users.lang`; first `/start` picker; `/changelanguage`; `STR.en` mirror; per-user locale threading; global `LANG` fallback)
- [x] Flow discipline (arm DMs die on cancel via `srcMsgId`; session lock on new-flow taps; arm switching with notices; honest cancels; pre-push reply rows exempt from deletion)
- [x] Convert parity (flow-guidance DM per kind; kind-visible `Sahkan (#tag)` row)
- [x] A-id-only group (raw tg_id off all group surfaces; `/who` resolves id/A-id/alias/`#C`)
- [x] `/list` (user history: totals + `#C` list with status/kind markers; DM super-admin, group admins)
- [x] `/list` pages (status sections, 30/page, Seterusnya/Kembali, recomputed per tap)
- [x] Preview headers per kind (`Normal Confession/Soalan/Lost/Found`) + type separator line
- [x] Cancel → compact menu (shared grid helper, no long text)
- [x] Convert markup fallback (rich markup-edit attempt; delete + plain rebuild on refusal)
- [x] Split preview (buttonless content + plain/styled action message; `preview_msg_id`; convert edits action, content best-effort)
- [x] Content/action inversion (pure content bubble; labeled action `Mesej diatas ialah *…*` + notes; convert refreshes action only)
- [x] Dismiss everywhere (`Tutup ✖` on guidance/choice DMs; `Batal` on arm DMs = full cancel)
- [x] Malay user side (`lib/strings.js` dict + `LANG`; your `/start` 5-section + `Alright` ack; 👎-on-Reject; admin group stays English; ban/warn voice deferred)
- [x] `/dbstatus` (admin table counts + status mix + range; byte-size unavailable on platform)
- [ ] Live promotion: `@unijaconfession_chatbot` link + channel/admin config
