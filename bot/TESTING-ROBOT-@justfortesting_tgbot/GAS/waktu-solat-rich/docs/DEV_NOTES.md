# DEV_NOTES — waktu-solat-rich (GAS test)

## Lessons (all verified live in test channel)

1. **Quote must mirror card formatting exactly.** Plain `quote` never matches rich content (`QUOTE_TEXT_INVALID`). `quote_rich_texts` works, but each element must equal the cell with identical type + nesting: plain cells → plain strings; bolded row → `{bold}` objects; marked+bold row → `{marked:{bold}}`. Order in this trial: edit card first, then quote mirrors the edit.
2. **Rich edit is real.** `editMessageText` with `rich_message` edits a rich card in place (keeps message id + thread). Unverified before this trial; delete+repost stays as fallback.
3. **Bot API ids are integers.** Script Properties returns strings — coerce with `parseInt` before `deleteMessages` (it takes int array, not strings).
4. **Triggers eat themselves.** `daily()` wipes one-shot prayer triggers but must spare handlers `setup` + `daily`, or the schedule dies the first morning.
5. **`t.me/c/` strips `-100`.** `-1001267775431` → `t.me/c/1267775431/...`. Full rule: `docs/chat-ids-and-links.md`.
6. **Token discipline.** GAS `BOT_TOKEN` is the BotFather token; the tgcloud `app...` token only works for the CLI. Wrong one → `chat not found` on every call.

## Open

* Live cutover: port `SolatRich.gs` + live values into `bot/Autobot-@autosent_robot/waktu-solat/`; keep old files one day as backup. No posting until `setup()` runs there.
* tgcloud trial (`../tgcloud-serverless/`) has no card edit, so its plain-string quotes stay correct — mirroring only matters where the card is edited.

## 10 Nov session (reorg + docs)

* Project moved to `GAS/waktu-solat-rich/` (`Code.gs` + `SolatRich.gs` + `appscript.json` + `docs/`); test channel `-1001267775431` confirmed in config.
* `marked`+`bold` nesting verified live (screenshot green); quote mirrors `{marked:{bold}}`.
* Sibling work (not in this folder): `tgcloud-serverless` trial, `.github` solat workflows, `docs/chat-ids-and-links.md` at repo root.
