# DEV_NOTES — solat tgcloud trial (`tgcloud-serverless/`)

Test bed for the rich prayer card on tgcloud. App `app9294438713`
(`@justfortesting_tgbot`), test channel `-1001267775431` (Test Channel).
Auth: `TGCLOUD_TOKEN` env per command (login needs TTY).

## Layout

* `tgcloud/schema.js` — `prayer_days` (day, zone, dates, hijri, times_json, main_msg_id, reminder_json). Replaces GAS Sheets + PropertiesService + Cache.
* `tgcloud/lib/config.js` — test ids, `TRG01`, header/prayers/footer copy. No tokens here.
* `tgcloud/lib/prayer.js` — `postDaily`, `tickReminders`, `dayStatus`, `buildBlocks`.
* `tgcloud/lib/errors.js` — `guarded`.
* `tgcloud/handlers/message.js` — owner-only (`ADMIN_IDS`) `/solat_today|tick|status`.
* `tgcloud/endpoints/cronDaily|cronTick|cronReset.js` — scheduler entries for `npx tgcloud run` (cronTick takes optional `nowMs` for simulated-time probes; cronReset wipes the day for clean re-tests).
* Root: `package.json`, `tgcloud.jsonc`, `deploy.py`, `.gitignore`. `testing-ground/ground.json` stays one level up (shared).

## Verified 10 Nov 2026

* Rich day card posts (`sendRichMessage`, table + divider + hashtags + zone button) — msg `373`, `376`.
* Plain-string `quote_rich_texts` (two table cells) lands on the unedited card — `dhuhr` probe green.
* Plain `quote` and cell-exact `quote` both `QUOTE_TEXT_INVALID` on rich content.
* Fallback: rich 400 → plain `sendMessage`.
* No card edit here (unlike GAS) — so plain-string quotes stay correct.

## Lessons

* `chat not found` on first run = bot not admin in the test channel. Add + re-run.
* Simulated ticks (`nowMs`) mark prayers done — use `cronReset` before clean re-tests.
* `tgcloud pull` with a stale snapshot duplicates the tree — verify with `status` + hashes after moves.

## Open

* No scheduler attached yet — ticks only run when something calls `run`. Workflows at `.github/workflows/solat-trial-*.yml` (repo root) need `TGCLOUD_TOKEN` secret + commit.
* Quota: 10-min tick ≈4300 min/mo over the 2000 free minutes on private repos.
* Live cutover runs through GAS, not this trial — this folder stays a probe bed.
* `cronProbeCombo.js`: combo proven (rich + inline in one call AND edit-after). Retire or keep — owner call.

## 11 Nov session (custom bodies + pre-ticks + rich reminders)

* Custom heads/bodies (Imsak, Syuruk-manual, Dhuha hadith), pre-ticks with custom pre texts + auto-delete, full-rich reminders with combo split (green rich row + inline next row).
* `pre_json` column migrated. Sim-verified (`posted` + `prePosted`), reset to clean cards after each probe.
* GAS is the live-bound copy; this trial mirrors it on demand.
