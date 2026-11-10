# Changelog — waktu-solat-rich (GAS test)

### [v2.4] — 11 Nov 2026 — Ramadan mode (GAS only)

* Auto-on when hijri month is `09`; backup Gregorian window `2027-02-08`→`2027-03-09` (Raya 2027-03-10); `RAMADAN` flag: auto/true/false.
* Subuh/Maghrib get puasa day lines; Isyak gets terawih `malam ke N+1` or Raya line — decided by tomorrow's actual hijri (no 29/30 table).
* `TEST_HIJRI` (+`TEST_HIJRI_NEXT`) override to preview without waiting.

### [v2.3] — 11 Nov 2026 — combo split: rich green + inline next

* Reminder rich row is timetable-green only; next-prayer button moves to a plain inline row (card jump). Combo shape proven by probe first.

### [v2.2] — 11 Nov 2026 — full-rich reminders

* Reminders go `sendRichMessage`: paragraph + optional blockquote body + 2-button row (next-prayer + green timetable), same reply + mirrored quote.
* Plain `sendMessage` + 2-row keyboard stays as automatic fallback on rich 400.
* Probe endpoint retired (shape proven: rich reply + quote accepted).

### [v2.1] — 10 Nov 2026 — buttons moved to reminders

* Card back to one `Waktu Solat TRG01` button (5-across squeezed on mobile).
* Each full reminder gains a second-row timetable button. Plain inline buttons take client styling (green is rich-only).

### [v2.0] — 10 Nov 2026 — 5 prayer buttons on card

* Day card's single zone button → 5 buttons (Subuh/Zohor/Asar/Maghrib/Isyak), all opening the TRG01 timetable URL.

### [v1.9] — 10 Nov 2026 — custom pre texts + pre auto-delete

* Pre-tick template: `⏰ Menghampiri Waktu {this} {time} (Waktu {prev} berbaki 10 minit lagi).`
* Zohor pre carries the custom istiwa' line (`{time}` filled at runtime).
* Full reminder deletes its own pre-notice (already-gone tolerated).

### [v1.8] — 10 Nov 2026 — drop morning pre-ticks

* Removed `preFajr`/`preDhuha` (preFajr ≈ imsak time = noise, dawn stays quiet).
* Pre-ticks now: Zohor, Asar, Maghrib, Isyak only, both files.

### [v1.7] — 10 Nov 2026 — custom bodies + manual syuruk + 10-min heads-up

* Per-prayer `head`/`body`: Imsak sahur line, Syuruk manual text, Dhuha hadith in `<blockquote>`.
* `syuruk()` added — manual only, still no auto trigger.
* 10-min heads-up (`preFajr()`… light reply, no card edit) auto-armed for all except Syuruk + Imsak; `PRE` state tracked + cleaned by `resetToday`.

### [v1.6] — 10 Nov 2026 — syuruk silent row

* `🌄 Syuruk` added between Subuh and Dhuha, card-only (`noTick`: no trigger, no reminder — sunrise is a forbidden-prayer window).
* Next-prayer buttons skip silent rows (Subuh → Dhuha).

### [v1.5] — 10 Nov 2026 — imsak + dhuha rows

* Table grows to 7 rows: `⏳ Imsak` (native API time = fajr−10min) above Subuh, `🌅 Dhuha` between Subuh and Zohor.
* Everything downstream (triggers, card edit, quotes, reminders) is key-driven — no other changes.

### [v1.4] — 10 Nov 2026 — on-time ticks

* Prayer triggers arm 60s early; `edits()` sleeps the remainder so posts land on the exact time (GAS fires late, never early; cap 120s).

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
