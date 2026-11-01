# DEV_NOTES — telegram_bot

Latest: Checkpoint 7 — 01 Nov 2026.

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
