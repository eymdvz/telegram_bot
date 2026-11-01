# DEV_NOTES — ask_the_robot

Latest: Checkpoint 7 — 01 Nov 2026.

## Checkpoint 1 — 01 Nov 2026 (bot live, memory + rich working)

Headspace: same as root — short commands, live test each push. Serverless rules apply: only `tgcloud/*.js` deploys, `push` never migrates, every `db` awaited, no FKs.

What shipped (UNCOMMITTED, parent `telegram_bot` clean except `082ec89`):
- Link `app6616621599`, webhook `.../app6616621599/webhook`, `allowed_updates: message,callback_query`, in sync.
- `tgcloud/schema.js`: `messages` table, migrated.
- `tgcloud/handlers/message.js`: `/start`+count, `/list`, `/clear`, `/rich` (html buttons + legacy fallback), `/message1` (prayer blocks + centered `success` URL button), `/dump` (reply-to JSON ≤3500 chars), unknown `/` notice, save+count with legacy buttons.
- `tgcloud/handlers/callback_query.js`: `list`/`clear` taps.
- `deploy.py`, `ONBOARDING.md` added.

Bugs + lessons: see root DEV_NOTES 1–5 (cwd package, `>>`, quoting, fake-id 400, no invented types).

Open threads: drop `/dump` before sharing; commit pending explicit ask; next feature on user call.

## Checkpoint 2 — 01 Nov 2026 (reliability port, unpushed)

- `tgcloud/lib/errors.js`, `tgcloud/lib/telegram.js` added; both handlers use them (see root DEV_NOTES).
- No schema change → `push` only, no `migrate`.
- Pending: `python deploy.py`, live test `/start /list /clear /rich /message1`, echo-fail Retry path.

## Checkpoint 3 — 01 Nov 2026 (/probe + /dump fix, unpushed)

- `tgcloud/lib/probe.js` added; `/probe` + hardened `/dump` in `handlers/message.js`.
- Pending: `python deploy.py`, run `/probe`, paste ✅/❌ summary back to record verdicts.

## Checkpoint 4 — 01 Nov 2026 (probe batch 2, unpushed)

- `tgcloud/lib/probe.js` now 32 probes (batch 2 from demo dump).
- Pending: `python deploy.py`, run `/probe`, paste summary.

## Checkpoint 5 — 01 Nov 2026 (/probeone, unpushed)

- `/probeone`: 2 bubbles (text bundle + media) + report. Verified-only, no bisect.
- Pending: `python deploy.py`, run `/probe` + `/probeone`, paste summaries.

## Checkpoint 6 — 01 Nov 2026 (32/32 ✅, unpushed)

- `/probeone` graduated: all 25 text + 5 media. Batch tags removed.
- Pending: `python deploy.py`, re-run `/probeone`, confirm 2 big bubbles render.
  - Confirmed ✅ (verified-only version; graduated 25+5 version unpushed).

## Checkpoint 7 — 01 Nov 2026 (wrap-up, unpushed)

- Session arc: reliability port → probe catalog (32/32 ✅) → probeone (2 bubbles ✅) → dump removal. All live-verified except graduated probeone.
- Bugs: see root DEV_NOTES 6–8 (dump silence, prefix order, PS quoting).
- Open: deploy + confirm graduated `/probeone`; commit pending explicit ask.
