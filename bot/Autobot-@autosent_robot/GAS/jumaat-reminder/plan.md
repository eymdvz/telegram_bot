# Jumaat Reminder — fix + improve plan

Source: `code.gs` (Friday 8am sedekah photo post → pin → 17:00 unpin, live `@unijaconfession`).
Read-through findings are the backlog below. Test everything in a GAS test copy first (same pattern as `TESTING-ROBOT/.../GAS/daily-reminder/`); live file stays frozen until verified.

## Batch 1 — hardening (no visible change)
1. Owner-DM failure alerts (bot token + network + API 400s all go silent today — only `Logger`).
2. Caption `Markdown` → `HTML` (underscore-proof; same bug class as iklan v1.0).
3. Test rehearsal path: `TEST_MODE` Script Property flipping targets to test channel (no live fire while editing).
4. Doc fix: comment says 12 PM, code sends 8am — correct the comment.
5. Unpin timezone: `setHours(17)` uses script tz; pin it to Asia/Kuala_Lumpur explicitly.

## Batch 2 — content (visible)
6. Second button `🎲 Masjid Rawak` → `sedekah.je/rawak` (caption already advertises it as text).
7. Rotating caption/image pool (4–8 variants, pick by ISO week number) — fights Friday blindness.
8. Optional: rich-card conversion with "Kenapa Jumaat?" collapsible (iklan pattern) if caption gets cramped.

## Explicitly out
- Callback/pledge counter buttons — need a webhook receiver; this project is trigger-only GAS.
- Merging into daily-reminder — different cadence, keep projects separate.

## Test procedure (test copy)
1. Paste code + Script Properties (`BOT_TOKEN` test bot, `TEST_MODE=true`).
2. Run send fn manually → verify photo + buttons + pin in test channel.
3. Break the token → verify owner-DM alert arrives → restore.
4. Force Friday path (temporarily lower trigger or call directly), verify 17:00 unpin + trigger self-delete.
5. Leave overnight only after 1–4 green; then port to live file.
