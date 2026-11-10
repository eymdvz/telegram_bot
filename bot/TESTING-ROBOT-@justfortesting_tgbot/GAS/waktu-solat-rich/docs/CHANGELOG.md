# Changelog — waktu-solat-rich (GAS test)

### [v1.3] — 10 Nov 2026 — reorg + docs

* Moved to `GAS/waktu-solat-rich/` (`Code.gs` + `SolatRich.gs` + `appscript.json` + `docs/`).
* Added `docs/` trio: README, CHANGELOG, DEV_NOTES.
* Test channel pinned to `-1001267775431` in config.

### [v1.2] — 10 Nov 2026 — marked+bold current row

**Added**

* Current prayer row is highlighted AND bold (`marked` wrapping `bold`).
* `quote_rich_texts` mirrors the same nesting (API demands identical nesting).

**Verified**

* Highlight renders on mobile + desktop; quote lands on the edited card.

### [v1.1] — 10 Nov 2026 — real quotes on rich card

**Added**

* Reminders use `quote_rich_texts` with the two table cells (plain strings at the time).

**Fixed**

* `QUOTE_TEXT_INVALID` x2: plain `quote` never matches rich content; cell-exact text also rejected until the card-edit/formatting rule was understood.
* Card edit must run BEFORE the reminder so formatting is final; quote mirrors whatever the row shows (bold after edit).

### [v1.0] — 10 Nov 2026 — initial rich port

* Ported `v2.gs` + `Unisza/code.gs` to `SolatRich.gs` + test `Code.gs`.
* Rich day card via `sendRichMessage` (same blocks as the tgcloud trial).
* State in Script Properties (no Sheets); per-prayer triggers re-armed daily.
* Channel edit kept: try rich `editMessageText`, fall back to delete + repost.
