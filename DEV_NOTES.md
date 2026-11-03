# DEV_NOTES — telegram_bot

Latest: Checkpoint 9 — 04 Nov 2026.

## Checkpoint 9 — 04 Nov 2026 (Just_arobot: Malay + kinds + flow discipline)

Headspace: same short-burst loop, heavier Plan-mode use (user now says "discuss" or "dont edit" to force it). Screenshots as bug reports continued (typo'd commands, double Queued stamps, claim spin, dead-button leftover). Live-verify + `run`-smoke adopted after a silent-/start incident. Terse replies held.

What shipped (ALL UNCOMMITTED — `?? bot/Just_arobot/`, `?? package-lock.json`, origin still `3d623b9`; webhook in sync, 0 pending): safety trio (contact auto-mask, 5/hr+20/day text limits, drip-feed → parked OFF as hand-approval paces enough) with `MASK_CONTACTS/TEXT_LIMITS/DRIP_FEED` kill switches; text rate limits; role-aware `/help` + `/synccommands` autocomplete scopes (+`/list`, `/changelanguage`, `/dbstatus`, `/unbutton` later); `/mystats`; rich `/start` (Malay 5-section from owner's screenshots, personalized greeting, 2×3 grid, first-run BM/EN picker, `/changelanguage`, `sendMenu` on Cancel/Confirm-ack); `lib/strings.js` dict (128 keys ms+en, parity-checked, per-user `L(row)` threading; admin side + ban/warn voice stay English); question/lost/found kinds (`kind` + `kind_seq` unique, `#ask1/#lost1/#found1`, kind cards/tags, arm intents, `/cancel*`); claim flow built then CUT as overcomplicated (manual brokering; `claims` table retired unused; `/unbutton` strips the dead #C78 button); intent nudge (heuristics + always-on convert row + `convert_` owner-only kind flip); preview split (buttonless content + labeled action, `preview_msg_id`) then content/action inversion; interactive hygiene (previews/arms die on completion); flow discipline (session lock, arm switching, honest cancels, `chatOpenFor`); abuse control (3/min burst at staging, 10/min taps via `hits`, owner+admin bypass, slow-mode removed); A-id-only group revert (raw id DM-only) + `/who #C` + paged `/list` (status sections, 30/page, stateless cursor); opener markers mapped into `chatMap` (reply-to-opener routes; unlinked replies get guidance); 👎-on-Reject; green/red preview buttons + divider + centered-table hint (rich-first, plain fallbacks); `/dbstatus`; `stress_test.md`. Migrated clean throughout: `users.lang`, `submissions.{kind,kind_seq,is_question,preview_msg_id}`, `claims`, `hits`, `uidx_sub_kind_seq`.

Bugs + lessons:
17. Missing import (`TEXT_HOURLY_LIMIT`) killed `/start` with total silence — `node --check` can't catch it. New ritual: after pushes touching new identifiers, server-smoke via `npx tgcloud run handlers/message` with a synthetic payload (single-quote JSON5 — PowerShell strips inner double quotes).
18. `run` with fake ids: `chat not found` = handler ran fine; fake callback ids die at `answerCallbackQuery` AFTER new code executes — both are valid verification signals, not failures.
19. Callback TDZ: `cid` declared post-admin-gate; pre-gate blocks (claim) must use `Number()` — audit declaration order when adding early blocks.
20. Raw `db.all/get(sql...)` rows are snake_case (`src_msg_id`); builder rows are camelCase. Never mix assumptions.
21. `edit` with identical old/new is a no-op error (not silent); multi-match needs `replaceAll:true`; after any whole-block rewrite, re-read the region (two clobbers this session: `whoOf` deletion, `sendStart` opener) — verify structure, don't assume.
22. Shell python one-liners mangle backslash-heavy JS (a whole line got corrupted) — prefer `edit`, reserve shell for reads/counts. PowerShell has no heredoc, no `head`.
23. Typo'd slash commands die silently in group (`/snyccommands` vs `/synccommands`) — autocomplete (now synced) is the prevention.
24. Anonymous-admin sends arrive as GroupAnonymousBot (1087968824) → not admin → silence. Tell the user to send as themselves.
25. Removing a button handler orphans live keyboards (taps spin) — ship the strip path (`/unbutton`) with the removal.
26. Rich `editMessageReplyMarkup` left unverified — sidestepped by the preview split (markup edits only touch plain action messages) instead of tested. Debt if rich actions ever need edits.

Open threads: FAQ content (owner's soalan/jawapan); 5 parked rule-link URLs; ack copy corrections (owner to supply verbatim); live promotion (needs live token pasted here — BotFather transfer doesn't exist); ban/warn Malay voice; mass announcement; dupe guard + `/delete`; arm TTL (15 min) + two-way convert-back (both spec'd, unbuilt); stray root `package-lock.json`; commit pending explicit ask. Test debt: EN-locale paths lightly covered (owner tests BM-first); media-rich preview shapes unconfirmed (fallbacks hold).

## Checkpoint 8 — 02 Nov 2026 (Just_arobot confession queue, live rev 41)

Headspace: marathon builder session with Plan-mode interludes. User drove in short bursts ("ok go"), pasted getUpdates JSON + channel screenshots as bug reports, decided scope via quick questions. Live-verify-everything held all day: every push followed by user-run live tests. Keep replies terse, verify with shell, never git-commit unless asked. Plan mode flipped on/off 3× — when active, discuss only, plans go to `C:\Users\darkv\.opencode\plan`.

What shipped (ALL UNCOMMITTED — `?? bot/Just_arobot/`, `?? package-lock.json`, origin still `3d623b9`): full confession-to-channel bot on `@Just_arobot`, linked `app1232472975`, local rev 41, webhook in sync (`message, callback_query, message_reaction`, 0 pending). Arc: topic-per-user stub → single-queue `#C` inbox in General → timed bans (3d/7d/14d/30d/forever+custom) with duration→reason→confirm pickers → warn tiers from channel terms (flood/other→ringan warn→7d→forever; spam/abuse→sederhana warn+20d→forever; nsfw/scam→berat instant forever) → 60d rolling window (audit-derived) → appeals (`/appeal`, berat auto-rejected) → swipe-reply relay + threaded channel replies + forward disambiguation (Reply two-step/Report) → bidirectional reaction relay (bot-mirrored) → A-id cutover (`A0001…`, display `<tgId>-<A-id>`) → confirm-before-send (unconfirmed staging + preview) → edit flow (`/edit` → ✏️ card → in-place channel edit) → user-admin chat sessions (shared Topic 2 id 387, slow-mode 2min, 30min idle, cap 5, `/startchat` admin-initiated) → spoiler A-id tags on channel posts → Reject button → `see the post` hyperlinks (URL form auto-resolved). Schema (all migrated clean): users(+alias/anum/banned_until/warn_light/warn_medium), submissions(+ref/user_msg/topic/card/channel_ids), parts, appeals, pending_intents(+state), reply_map, sessions, chat_map, edits (+ legacy tickets/messages/topic_map). Docs: `bot/Just_arobot/plan.md §10` todo ladder, `bot/Just_arobot/feature.md`, `.opencode/plan/just_arobot-{confession-v1,batch2,promote,future}.md` (outside repo).

Bugs + lessons:
9. General topic (id 1) rejects `message_thread_id` (`400 message thread not found`) — omit the param for General (`inboxThread`/`threadOrInbox`/`chatThread` helpers). Never assume thread 1 is valid.
10. Builder `Date`-object WHERE params don't match unix-seconds timestamp columns (limit never tripped) — use raw SQL on `unixepoch()` (`mediaAllowed`, `warnCounts`). Never trust mode conversion in WHERE.
11. SQLite ALTER can't add UNIQUE columns — add plain column, then a separate unique index (`aliasIdx`, `anumsIdx` pattern).
12. Albums arrive as N separate webhook hits; lazy-flush needs a later hit to fire — retired albums entirely (1 photo/message + 1 media/day cap) instead of fighting serverless timing.
13. Cross-chat "Reply in…" arrives as `external_reply`, not `reply_to_message` — parse both.
14. Spoiler entity offset must skip the `\n\n` separator (off-by-two left `01` exposed while `A00` dotted). Compute offsets in code, verify visually.
15. PowerShell has no `head` — use `Select-Object -First` or plain output.
16. `edit` oldString spanning duplicated blocks confuses the matcher ("already in file") — anchor with unique surrounding context; prefer small sequential edits over whole-block rewrites.

Open threads: FAQ menu (needs soalan/jawapan content); live promotion to `@unijaconfession_chatbot` (blocked on account serverless access); exempt-list additions (paste ids); warn window parked at 60d lifetime-fallback; promote cron belongs to other bot, paid-messages future; show-my-profile KIV; stray root `package-lock.json` (91B, from wrong-cwd `npm install` — delete or ignore); `?? bot/Just_arobot/` commit pending explicit ask. Test debt: none open — last full pass green (confirm/A-id/edit + replies + chat sessions).

## Checkpoint 1 — 01 Nov 2026 (ask_the_robot live + shared rich docs)

Headspace: fast builder loop, live-verify-everything. User drives via short commands, expects push-and-test. Keep replies terse, verify with shell, never git-commit unless asked.

What shipped (all UNCOMMITTED — `?? bot/`, `?? docs/`, only `082ec89` on origin):
- `bot/ask_the_robot/` scaffolded (`npm create @tgcloud/bot`), linked `app6616621599`, rev 1+, webhook in sync. Handlers: `/start` split, `/list` last-10, `/clear`, unknown `/` → "Command not set yet", `callback_query` list/clear buttons, `/rich` html `tg-button-row` test, `/message1` prayer-table rich + green URL button to TRG01, `/dump` reply-to-JSON (remove before sharing). Schema: `messages` table + migrate applied.
- `bot/ask_the_robot/deploy.py` (`python deploy.py[--migrate]`, cwd-safe), `ONBOARDING.md` (new-device + handoff).
- `docs/rich-messages.md` curated from gmvmax-auto 04 Oct 2026 + buttons verified live 01 Nov 2026.
- Live proof: `/start` echo, counts 1→2, `/rich` buttons ok, `/message1` table ok.

Bugs + lessons:
1. Wrong-cwd `npx tgcloud` fetched `tgcloud@0.1.0-canary.0` (no `login`) — always run in `bot/ask_the_robot/` (`@tgcloud/cli 0.2.0`).
2. PowerShell `>>` is redirect — run lines separately or join with `;`.
3. `run` args: outer double + inner single JSON5.
4. `run` fake `id:1` → `BotApiError 400 chat not found` = handler ran fine; verify live.
5. Never invent rich type strings — spec anchor first, probe second.

- `/dump` removed 01 Nov 2026 (was: remove before sharing). Open threads: git add/commit pending explicit ask; second bot unplanned; MCP parked as knowledge only.

## Checkpoint 7 — 01 Nov 2026 (wrap-up, unpushed)

Headspace: long builder session, user driving in short bursts ("ok go"), live-verify-everything on private chat. Keep replies terse, verify with shell, never commit unless asked.

What shipped (ALL UNCOMMITTED — `?? DEV_NOTES.md`, `?? bot/`, `?? docs/`, origin still only `082ec89`): reliability port (guarded/errors.js+telegram.js lib, thread-aware sends, rich→plain fallback, Retry), `/probe` 32/32 ✅ live, `/probeone` 2-bubble ✅ live (verified-only version), All-Types dump → 14 new Works rows, batch-2 graduated into `/probeone` (unpushed, untested), `/dump` removed + ONBOARDING scrubbed.

Bugs + lessons:
6. `/dump` silence: old code dumped itself without a reply + swallowed sends in `guarded`. Fix pattern: no-reply guard message + header line + chunking, so silence becomes diagnosable. Never let a debug command fail silently.
7. Prefix commands: `/probeone` matches `startsWith('/probe')` — order `/probeone` block FIRST. Never add a command that is a prefix-extension without checking order.
8. PowerShell quoting broke the `node --check` loop (`\"` passed literally) — use single-quoted strings, `Join-Path $env:TEMP`. Retry with clean quoting before assuming syntax errors.

Open threads: `python deploy.py` (graduated probeone untested) → confirm 2 bigger bubbles; git add/commit `bot/`+`docs/`+`DEV_NOTES.md` pending explicit ask; next feature on user call.

## Checkpoint 2 — 01 Nov 2026 (reliability port from reference agent)

What shipped (UNCOMMITTED):
- New `tgcloud/lib/errors.js` (`guarded` wrapper) + `tgcloud/lib/telegram.js` (`replyParams` thread-aware, `sendRichFallback`, `saveEchoAndReply`, `alreadySaved`, `sendRetryPrompt`, `RETRY_DATA`). Both handlers wrapped; all sends thread-aware; `/message1`+`/rich` fall back to real plain text on 400 (no more "Rich send failed"); echo failures send Retry prompt; Retry re-runs via `reply_to_message` with double-save dedupe + button strip.
- Reference added: `https://github.com/megatzackry/Telegram-Serverless-Agent` linked in `docs/rich-messages.md` + `ONBOARDING.md` (adapted, not copied).
- Syntax verified: `node --check` on all 5 `tgcloud/*.js` (via `.mjs` copies) — clean. Not yet pushed; needs `python deploy.py` + live test.

## Checkpoint 3 — 01 Nov 2026 (/probe catalog + /dump hardening, unpushed)

- New `tgcloud/lib/probe.js`: 16 solo probes, all shapes copied from gmvmax-auto tg-probe/hourly.ts (heading, pre, list, blockquote, expandable_blockquote, pullquote, math, map, photo, table-striped-compact, details×2, divider, buttons-url, html-buttons-row, marked). `/probe` sends one msg each + ✅/❌ summary.
- `/dump` fixed: requires a real swipe-reply (else tells you), prints `msg <id> · <n> chars · rich: yes/no` header, chunks long JSON into 3500-char parts.
- Why old `/dump` went silent: undiagnosable from here — likely no reply attached, transient send swallowed by `guarded`, or webhook/revision drift. New header + `npx tgcloud webhook` check close that gap.
- Pending: `python deploy.py`, run `/probe`, record verdicts into `docs/rich-messages.md`.

## Checkpoint 4 — 01 Nov 2026 (All Types Demo dump → probe batch 2, unpushed)

- User dumped the full demo (msg 76, 8887 chars, rich:yes) — all shapes extracted into `docs/rich-messages.md` "Received-side shapes" section.
- `tgcloud/lib/probe.js` batch 2 (+16 = 32 probes): inline-format, anchor-pair, footnote, custom-emoji, date-time, inline-math, list-checkbox/ordered, pre-lang, details-open, pullquote-credit, map-full, link-inline, photo-file-id (dumped id), video-file-id (guessed mirror shape).
- Received≠sendable noted: photo/video arrays, collage, audio unprobed or experimental.
- Pending: `python deploy.py`, run `/probe` (∼34 msgs, private chat), paste ✅/❌ summary.

## Checkpoint 5 — 01 Nov 2026 (/probeone added, unpushed)

- `tgcloud/lib/probe.js`: batch tags (1 = first 16 verified, 2 = experimental).
- `/probeone` in `handlers/message.js` (placed BEFORE `/probe` — prefix match): bubble 1 = 13 batch-1 text shapes in one send, bubble 2 = map+photo, then ✅/❌ report. HTML pipe excluded (see `/rich`). No bisect.
- Pending: `python deploy.py`, run `/probe` + `/probeone`, paste summaries.

## Checkpoint 6 — 01 Nov 2026 (32/32 ✅, probeone graduated, unpushed)

- User ran both: `/probeone` ✅ text (13) + ✅ media; `/probe` 32/32 ✅ incl. anchor-pair, footnote, custom-emoji, photo-file-id (cross-bot reuse works), video-file-id (mirror guess confirmed).
- Batch concept removed from `probe.js`; `/probeone` now bundles ALL text shapes (25) + ALL media (map, photo, map-full, photo-file-id, video-file-id).
- `docs/rich-messages.md`: 14 new Works rows + batch-2 verdict header.
- Pending: `python deploy.py`, re-run `/probeone` (now 2 bigger bubbles), confirm.
  - Confirmed: `/probeone` returns 2 big bubbles ✅.
