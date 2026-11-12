# Rich messages — reference (curated)

Source: `marketer/2-gmvmax/gmvmax-auto/telegram_message.md` + `tg-rich-messages.md`, verified 04 Oct 2026 on owner clients. Full ~100-class catalog stays there; this is the safe subset to avoid repeat bugs.

Reference agent: https://github.com/megatzackry/Telegram-Serverless-Agent — borrowed `guarded` errors, `Delivery` (thread-aware replies, rich→plain fallback, Retry button); patterns adapted, not copied.

## Limits

32,768 chars · 500 blocks · 16 nesting levels · 50 media · 20 table columns.

## Send chain (do not reorder)

1. `sendRichMessage {blocks}` → 2. `sendRichMessage {html}` (`\n` → `<br/>`) → 3. legacy `sendMessage` (HTML parse_mode). A failed blocks-shape falls through automatically — a bad guess never kills the message.

## Works (in daily report use)

| Shape | Notes |
|---|---|
| `paragraph` | Title + totals. |
| `table` (`striped+compact`, `is_header` + `align` cells) | Stripes desktop only; mobile flat. |
| `details` (all 3 summary shapes) | Collapsibles. |
| `divider` | |
| `markdown` / `html` shorthand | Bold/italic/code/link rendered. `{html}` is the fallback pipe. |
| `heading` (`size` 1–6) | Round 2 verified. |
| `pre` | Mono block with copy button. |
| `blockquote` (`blocks[]`) | Side-bar quote. |
| `expandable_blockquote` | Collapsible quote. |
| `pullquote` | Centered quote. |
| `list` (`items:[{blocks:[paragraph]}]`) | Bullets rendered. |
| `mathematical_expression` (`expression`, LaTeX) | Rendered `E=mc²`. |
| `map` (`location:{latitude,longitude}`) | Accepted. |
| `photo` (`photo:{type:"photo", media:URL}`) | Public URLs fetched directly, no `file_id` needed. Vercel-protected `public/` URLs blocked — use external hosts. |
| `tg-button-row` + `tg-button type="callback_data"` (`{html}` pipe) | Verified live in `ask_the_robot` via `/rich` 01 Nov 2026. Reuses `callback_query` list/clear. |
| `anchor` + `anchor_link` | In-message jump links; anchor must ship with content, never solo. Verified 01 Nov 2026. |
| `reference` / `reference_link` + `superscript` + `footer` | Footnotes. Verified 01 Nov 2026. |
| `custom_emoji` (`custom_emoji_id` + `alternative_text`) | Rendered with demo IDs; IDs are set-dependent. Verified 01 Nov 2026. |
| `date_time` (`unix_time` + `date_time_format`) | Verified 01 Nov 2026. |
| inline `mathematical_expression` | Works inside paragraph `text[]`, not just block. Verified 01 Nov 2026. |
| `list` checkbox + ordered + `label` | `has_checkbox`/`is_checked`, `type:"1"`+`value`. Verified 01 Nov 2026. |
| `pre` + `language` | Syntax tag accepted. Verified 01 Nov 2026. |
| `details` + `is_open: true` | Starts expanded. Verified 01 Nov 2026. |
| `pullquote` + `credit` | Verified 01 Nov 2026. |
| `map` + `zoom`/`width`/`height`/`caption:{text}` | Verified 01 Nov 2026. |
| inline `url` / `email_address` | Verified 01 Nov 2026 (`text_mention` untested — bot-only). |
| inline `underline` / `strikethrough` / `spoiler` / `code` | Verified 01 Nov 2026. |
| `video` file_id (`{video:{type:"video",media}}`) | Photo-mirror guess CONFIRMED 01 Nov 2026. |
| cross-bot `file_id` reuse | Dumped photo id re-sent by our bot ✅ 01 Nov 2026. Treat as working but not archival (expiry). |

RichText inline: `{type:"bold", text}` works (cell/title). Rest via html shorthand.

## Partial (accepted but limited)

- Cell HTML string (`<b>` in table cell text): `ok:true` but clients show raw tags — never use. Whole-cell bold max.
- `anchor` (`name` only): `RICH_MESSAGE_EMPTY` alone — invisible, needs link pairing.
- Table stripes: desktop only, mobile ignores.

## Not working (do not retry without re-probe)

- `header` block — rejected.
- Paragraph/cell text as segment arrays — no such RichText form.
- `thinking` — `RICH_MESSAGE_BLOCK_UNSUPPORTED`, drafts/streaming only (`sendRichMessageDraft`).
- `TextQuote` — not a rich block (reply-quote object). Use `blockquote`/`pullquote`.
- Guessed strings (`section_heading`, `preformatted`, `block_quotation`, `pull_quotation`, `expandable_block_quotation`, flat `{items:[{text}]}`, flat map lat/lon, URL-string photo) — wrong shapes.

## Client notes

- Mobile renders tables flat (no stripes) with wallpaper showing through; desktop shows stripes.
- Wide 6-col tables need sideways scroll on mobile, clip/wrap on desktop — short names mitigate.
- `?keep=1` probe messages must be hand-deleted in the topic.
- Collage grids only when ALL tiles are square; mixed rectangle/video stacks (client layout, verified 11 Nov 2026 via H07 square+square).
- Expandable blockquote needs ~10+ lines to collapse; short ones render open (threshold, verified 11 Nov 2026 via H04 12-line).
- Ephemeral: mobile renders in-topic, desktop pins to General (verified 11 Nov 2026; reply anchor doesn't fix desktop — mobile is reference).

## Received-side shapes (All Types Demo dump, msg 76, 01 Nov 2026)

Dumped via `/dump` (8887 chars). Received `RichMessage` reuses as send `blocks` EXCEPT media arrays.

**Verdict 01 Nov 2026: all 16 batch-2 probes ✅** on the owner's client — including `anchor-pair`, `footnote`, `custom-emoji`, `photo-file-id` (cross-bot file_id reuse works), and `video-file-id` (photo-mirror guess confirmed). All graduated into `/probeone`; rows above merged into the Works table.

- Inline text entities (all inside `text[]` arrays): `underline`, `strikethrough`, `spoiler`, `code`, `marked`, plus `bold`/`italic`. Batch-2 probe `inline-format`.
- `anchor` (`name`) + inline `anchor_link` (`text`, `anchor_name`) — jump links. Anchor alone is known-fail on send; combined pair in probe `anchor-pair`.
- Footnote system: paragraph `reference` (`text`, `name`) + inline `reference_link` (`text: {superscript}`, `reference_name`) + `footer` block. Probe `footnote`.
- Inline `custom_emoji` (`custom_emoji_id`, `alternative_text`) — IDs are set-dependent, may fail outside the demo. Probe `custom-emoji`.
- Inline `date_time` (`text`, `unix_time`, `date_time_format`). Probe `date-time`.
- Inline `mathematical_expression` inside paragraph text (not just block). Probe `inline-math`.
- `list` items: `label` (`•`/`1.`), checkbox (`has_checkbox`, `is_checked`), ordered (`type:"1"`, `value`). Probes `list-checkbox`, `list-ordered`.
- `pre` + `language`. Probe `pre-lang`.
- `details` + `is_open: true` with plain string summary. Probe `details-open`.
- `pullquote` + `credit`. Probe `pullquote-credit`.
- `map` + `zoom`/`width`/`height`/`caption:{text}`. Probe `map-full`.
- Inline `url` (`text`, `url`), `email_address` (`text`, `email_address`), `text_mention` (`text`, `user{id,…}` — bot-only, untested). Probe `link-inline` (url+email).
- Received `photo` = size array (`file_id` per size); send = `{photo:{type:"photo",media}}`. Cross-bot `file_id` reuse unproven. Probe `photo-file-id` uses the dumped id.
- Received `video`/`audio` carry full metadata; send shape guessed as photo-mirror `{video:{type:"video",media}}`. Probe `video-file-id` — guess, ❌ is data.
- Received-only (not probed): `collage` of photos, `audio` block, `footer` outside footnote (covered by `footnote` probe).

## Past-bug guards

1. Never put fallible media inside an all-or-nothing blocks send (covers travel solo or not at all).
2. Never invent type strings — read spec anchors first, probe second.
3. Verify media URLs by content-type header, never by browser.
