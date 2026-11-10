# DEV_NOTES — telegram_bot

Latest: Checkpoint 12 — 10 Nov 2026.

## Checkpoint 12 — 10 Nov 2026 (solat rich trial → GAS wins → reorg + docs)

Headspace: probe-driven loop with docs as weapons — user pasted Bot API screenshots (`quote`, `quote_rich_texts`, `RichText`, `RichTextMarked`) and each one turned into a green probe within minutes. Plan mode on/off 4×; "explain like im5" held for the cron/VPS/quota stretch. Trial lived in `bot/TESTING-ROBOT-@justfortesting_tgbot` throughout; live GAS untouched.

What shipped (ALL UNCOMMITTED except agents_skills): tgcloud trial on `app9294438713` (`tgcloud-serverless/`: `prayer_days`, `cronDaily/cronTick/cronReset`, test channel `-1001267775431` card `376` rich + `fajr` reminder quoted); GAS `waktu-solat-rich` v1.0→v1.2 (`SolatRich.gs`: rich card, rich card-edit, `quote_rich_texts` mirrored, marked+bold current row — all user-verified live in test channel); reorg (`GAS/` vs `tgcloud-serverless/`, `testing-ground/ground.json` + `channel_name`, workflows repointed, stale root `tgcloud/` + `node_modules/` + `.tgcloud/` removed after hash check); `.github/workflows/solat-trial-{daily,tick}.yml` (needs `TGCLOUD_TOKEN` secret + commit); `docs/chat-ids-and-links.md` (+helper bots); session-handoff SKILL.md patched (docs/ check + placement ask) and PUSHED to agents_skills (`07afc41`).

Bugs + lessons:
58. Rich cards reject plain `quote` (`QUOTE_TEXT_INVALID` x2 — full-line and cell-exact both fail). `quote_rich_texts` with exact cell texts passes. Quote index covers regular text only.
59. Quote must mirror card formatting AND nesting exactly (bolded row → `{bold}` objects; marked+bold → `{marked:{bold}}`). Always edit card first, then quote mirrors the edit.
60. `editMessageText` with `rich_message` edits rich cards in place (was unverified; now green in GAS). Delete+repost stays fallback.
61. Bot API ids are integers — GAS PropertiesService strings need `parseInt` before `deleteMessages`.
62. `daily()` trigger wipe must spare `setup`+`daily` handlers or the schedule dies the first morning.
63. `t.me/c/` strips `-100` (`t.me/c/100...` = nonexistent chat). Same for web `#-...` form.
64. `tgcloud pull` with a stale snapshot duplicates the tree at the wrong root — verify with `status` + file hashes after moving project folders.
65. tgcloud has no clock — no internal scheduler. External GitHub Actions can't hit endpoints directly (401, initData verified) — must run `npx tgcloud run` with `TGCLOUD_TOKEN`. Cron-job.org-style pingers don't work.

Open threads: live GAS cutover (user call; keep old files 1 day backup); `TGCLOUD_TOKEN` secret for Actions (user); quota watch (10-min tick ≈4300 vs 2000 free min on private repos).

## Checkpoint 11 — 08 Nov 2026 (filters → polls → live promotion)

Headspace: marathon verification-driven loop, user testing live on-device between pushes (screenshots as bug reports: fallback ack, faqNudge-on-gibberish, reply-guide demo, dead Inbox). Plan mode toggled 4× (filters, reply-ack fit, delete flow, disable-wiring) — "explain like im5" for the parked four worked well. Terse held. Two folders now: `bot/@Just_arobot` (test bed) + `bot/@unijaconfession_chatbot` (live copy, diverged: live ids + co-owner only).

What shipped (ALL UNCOMMITTED — origin still `96857a0`; `bot/Just_arobot/` delete + `bot/@*/` untracked): V1.4.0 reject reasons + `/msg` + ⚠️-on-warn; ack outage saga (fallback fired → `tag()` exonerated by probe → E1/E2 diag → **shadow**: local `const tag` hid the helper → `cardTag` rename → user-confirmed green); V1.5.0 auto-filters (`isLowQuality` hard block uncounted, `censorProfanity` verbatim-4 + first-last fallback, `kesat` card flag, `LOWQ_BLOCK`/`PROFANITY_MASK`); curse staging notice; V1.5.1 direct-reply intercept (`replyDirect`); V1.5.2 short guides (`ackMsgId`, reply-to-ack/preview one-liners); gibberish-vs-FAQ probe (`detectIntent` null — gate state, not classification); V1.6.0 native polls (`poll_data`, `pollRender`/`pollCensor`, `sendPoll` anonymous-enforced, quiz ✓ on card, `/edit` refused, user-confirmed live post); pollNote + tutorial-poll copy; EN-locale translation pass (rej*/lowQ/curse; `tpl*` stay verbatim); V1.7.0 single live draft (`superseded`, bubbles deleted, burst/text ignore it) + fixed polls-bypass-limits bug; V1.7.1 reply-first refusals (shared `replyGuide`); V1.7.2 discussion wiring (built, tested, then **disabled** to 0 per owner — group replies stay plain chatter); V1.8.0 `/delete` flow (`deletes` table, Apply/Dismiss, `approved-undone`, user-confirmed); V1.8.1 group-safe tutorial (`dismiss`/`tut:` bypass DM lock). LIVE: `bot/@unijaconfession_chatbot` folder copy, token via `TGCLOUD_TOKEN` (login needs TTY), full push (11 modules) + fresh migrate (23 tables) + webhook in sync; live ids (channel `-1001779734656`, group `-1003996987649` after stale basic-id `chat not found`); co-owner `7154716451` full parity (`SUPER_IDS`/`isSuper`, 👑 stays owner). Migrated: `submissions.{ack_msg_id,poll_data}`, `deletes`. Parity 217/217.

Bugs + lessons:
50. Cloud flakes hit compiles too — identical-content push failed then passed byte-identical. Always retry once before bisecting; flake-check is step zero.
51. The edit tool consumes its anchor: using a line as oldString to "prepend before it" deletes it. Never anchor-insert on the target line itself — anchor on the following line or re-add it (burned 4× this session: moderation comment, `verdictDM` sig, `editMasked` dup, `postChatMessage` head).
52. Helper-vs-local name collision (`const tag` card label shadowed imported `tag()`) survives probes and reads — grep every new helper name against locals in scope before first use.
53. New media kinds must join every enumeration: polls bypassed text limits (`media_kind='text'` filter) until patched. Arm-switch lists, cancels, guards, imports — same rule as ever.
54. `TGCLOUD_TOKEN` env per-command works when `login` demands a TTY; fresh folder = full first push, no snapshot needed.
55. Basic→supergroup upgrade kills the old id (`chat not found`); a topic id on a basic-looking id is the tell. Forward from the group to @userinfobot for the live id.
56. DM-locked button families break group-posted surfaces (`/tutorial` close → "Bukan untuk anda") — carve stateless callbacks (`dismiss`, static pagers) out of the lock.
57. Gate-state vs classification: gibberish got `faqNudge` from a pre-armed `awaiting_faq`, not from `detectIntent` (probed null on all three). Probe the classifier before "fixing" detection.
58. Discussion wiring anonymity boundary: group replies stay public under the author's name — only channel re-posts are anonymous. Say it before building, not after.

Open threads: COMMIT (still everything since `96857a0`, rename + 2 folders — needs explicit ask); live guide URLs still point at test-channel posts (FAQ 66437, reply 46470, reject list, terms); live Topic-2 `11009` unverified (chat sessions untested on live); parked: per-category hashtag serials (dropped for now), minta-link phrases, announce batching; `feature.md` stale at V1.4.0 (refresh debt); test/live drift discipline (live-only: ids, co-owner). Test debt: EN paths translated but live-tested BM-first; poll quiz + `/delete` dismiss paths user-verified apply-only.

## Checkpoint 10 — 05 Nov 2026 (soft gates + crown + teaser)

Headspace: user drove via question-tool picks ("what next" → options → Tutorial links → Group-link refuse → crown), screenshots as bug reports (admin-rights panel, @just_arobot profile, /crown announcements with raw errors). Typo-hunt on the old bot name (`@unijacofession_chatbot`) turned into a posted new-bot teaser (I reviewed copy: caught truncated bullet, "Adming", "usefull"). Terse replies held; webfetch used once to settle a platform dispute with docs.

What shipped (ALL UNCOMMITTED — origin still `96857a0`; webhook in sync +`edited_message`, 0 pending; `V 1.0.5` → `V 1.0.11`): categorized ask (L1 8 cats + Servis/Tempat/Bas L2, MAP/BUS_URL self-serves, guided prompts, `ask_cat`/`ask_sub` on card + `#ask` lead + edits, back-to-categories everywhere after a guard bug briefly showed "hantar soalan anda"); reply-prefix soft gate (`rpl_cleared`; colon-or-dash line-start, clear-or-cancel notice, preview kept on blocked Confirm, Batal reuses `cancelconf`); tutorial step 3 links (46470 + 46990, both locales); group-link soft gate (`grp_cleared` default 1; raw-text detect pre-mask, flag-only Confirm, edits re-hold-never-release, own-channel excluded, `grpclear_`); monthly crown (`/crown` owner-only silent; 30d most-actions + fastest-median ≥5, double-win → overall; title saga → bot-side honor with `crowns` table + 👑/⚡ markers in `/adminstats` all windows); `feature.md` full refresh to V 1.0.11. Migrated clean: `submissions.{ask_cat,ask_sub,rpl_cleared,grp_cleared}`, `crowns`.

Bugs + lessons:
37. Owner must be excluded from leaderboards (title set on group owner fails; owner already 👑) — `crownLeaders(ownerId)` skips SUPER_ADMIN_ID.
38. `setChatAdministratorCustomTitle` only works for bot-promoted admins (docs-verified: "promoted by the bot"); `setChatMemberTag` is regular-members-only + no emoji. Owner-promoted admins are untouchable → bot-side honors (announce + stats markers), no title code.
39. Never auto-release a hold on edit (stale buttoned notices outlive the flag; Batal would discard a clean submission) — group-link edits re-hold only, one clear tap after link-out.
40. Group-link Confirm is flag-only (masking destroys URLs) — staging + edits own detection; reply-prefix re-detects (markers survive masking).
41. `return { sub, error: null };` appears twice in message.js (staging + confirm) — anchor gate edits with surrounding context.
42. A wrong-edit attempt is cheap if caught immediately (abandon + redo the right one in the next call); never stack edits on a mistaken base.

Open threads: live promotion (token still needed; teaser live, users on old bot); minta-link + ad-keyword nudge (need owner's BM phrasing lists — asked, paused); `/faqsync` (Sheet seeded 27 rows, unbuilt); announce batching at scale; ban/warn Malay voice; commit pending explicit ask. Test debt: EN-locale paths light; /crown title path deleted (nothing to test); media-rich previews live-tested BM-first.

### Addendum — V 1.0.12/1.0.13 (maintenance + midnight)

Maintenance (`/maintenance [on|off]`, `meta` switch, EXEMPT bypass) and midnight (`midnightActive` + `/midnight [on|off|auto]`, 🌙 on preview + ack) shipped with the `meta` table; tutorial step 3 carries the maintenance/midnight line; `feature.md` refreshed to V 1.0.13; strings at 162 keys parity. Lesson 43: never gut a table in a "small" edit — one wrong-oldString emptied `crowns` and needed a restore (caught by immediate re-read).

### Addendum 2 — V 1.0.14→1.0.24 (nudge → feedback → everywhere)

Ad-nudge (word lists + price+goods, preview-only; copy tuned to student sellers, `usefull`/`Adming`-class typos caught pre-push); threaded verdicts (`verdictDM`, appeals plain for lack of link); contacts unmasked (usernames+phones, `MASK_MENTIONS`/`MASK_PHONES`); iklan/event/dana grid module (dana L2 program/kilat, `#dermakilat` split after a "still shows #cariandana" screenshot, back-buttons); suggest/info bare-tag kinds (+nudge-skip); main-menu relayout (5→6 rows, centered header cell, split `/start` bubbles, `§§` section dividers); cancel→menu everywhere; public post numbers (message-id footer, second-pass stamp); feedback module (`feedback` table, `#F` cards); chat-commands-everywhere (the `/startchat` saga: reply-context trap → A-id fallthrough → card resolution → shared cmds + slash firewall + close button + opener instructions).

Bugs + lessons:
44. `replaceAll:true` across locales contaminates (EN text landed in ms block; duplicate keys resolve last-wins so it "worked" — caught by grep, not by tests). Never replaceAll across locale blocks; anchor with neighbors.
45. Single-line edits that "succeed" can still clobber (dropped `return`/`if` twice, ate `closeSession` body once) — every structural edit gets a re-read of the region before push, no exceptions.
46. Reply-context is sticky: topic quotes + accidental swipe-replies set `reply_to_message` on commands. Design command handlers to honor explicit args DESPITE reply context (fallthrough), not instead of it.
47. `/startchat` lived only in Topic 2 while the comment said "commands live in General" (neither was true) — audit handler placement, not comments, when users report "nothing happen".
48. Onboarding strings are load-bearing layout: `§§` split-markers give dividers without new keys; `maskLine`/`startBody` copy must track mask-policy changes (stale "contacts hidden" caught during dana slice).
49. Tgcloud `push` compiles server-side — `node --check` green is necessary but not sufficient (the missing-comma push failure). Always check `strings.js` explicitly; parity script is regex, not a parser.

Open threads: live promotion (token; `bot/@BotName` convention); minta-link (paused, needs phrases); `/faqsync` (unbuilt); announce batching; ban/warn Malay voice; commit pending explicit ask (origin still `96857a0`). Test debt: EN paths light; feedback `#F` flow live-tested BM-first.

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
