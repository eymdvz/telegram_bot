# ONBOARDING — ask_the_robot

Per-bot device setup + handoff. Tokens stay local; code travels via git.

## New device

1. `git clone <repo> && cd telegram_bot/bot/ask_the_robot`
2. `npm install`
3. `npx tgcloud login` — token: `@BotFather → ask_the_robot → Serverless → CLI Access` (`app…:…`). Saved to gitignored `.tgcloud/`, never commit it.
4. `npx tgcloud pull && npx tgcloud status` — clean = in sync with cloud.
5. Edit `tgcloud/`, then `python deploy.py` (`npx tgcloud push`) or `python deploy.py --migrate` when `schema.js` changed.
6. Verify: `npx tgcloud webhook` (in sync), test `/start /list /clear /rich /message1 /probe /probeone` live.

## Handoff rules

- `git push` ≠ `tgcloud push`. Code vs cloud deploy are separate.
- If `push` rejects (cloud revision moved), `npx tgcloud fetch` then `npx tgcloud pull`, re-apply local edits, push again. No `--force` unless sure.
- Deploys never touch DB: `push` reports, `migrate` applies.
- Secrets: `TELEGRAM_*` live in hosting env only. `git status` must never show tokens.
- Remove `/dump` before sharing — it exposes raw chat JSON.

## Reference

- https://github.com/megatzackry/Telegram-Serverless-Agent — same tgcloud stack; adapted `guarded` errors, thread-aware `replyParams`, rich→plain fallback, Retry button. Link, don't copy; verify before porting more.
