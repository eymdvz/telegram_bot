# waktu-solat-rich (GAS test)

Rich-message port of the live prayer poster (`bot/Autobot-@autosent_robot/waktu-solat/`)
for the TEST channel only. Live GAS untouched.

## Files

| File | What |
|---|---|
| `Code.gs` | TEST config + entry points (`daily`, `fajr`…`isha`, `setup`, `resetToday`) |
| `SolatRich.gs` | Library: rich card, tick edit, quoted reminders, state |
| `appscript.json` | Manifest (`Asia/Singapore`, V8) |

## Setup

1. New Apps Script project → paste the 3 files (enable `appscript.json` via Project Settings).
2. Project Settings → Script Properties → `BOT_TOKEN` = test bot's Telegram token (BotFather format, NOT the tgcloud `app...` token).
3. Test bot must be admin in TEST channel `-1001267775431` (Test Channel) with Post Messages.
4. Run `setup()` once — creates the 04:45 trigger + posts the first card.

## Use

* `daily()` — posts today's rich card, re-arms per-prayer triggers.
* Prayer ticks (`fajr`…`isha`) — bold+highlight current row on the card, post quoted reminder.
* `resetToday()` — deletes today's card + reminders, clears state (clean re-test).

## State (Script Properties)

`SOLAT_TRG01_DAY/DATA/MAIN/REM` — day key, times JSON, card msg id, reminder msg ids. Replaces the live version's Sheets + `PropertiesService LAST_ID_*`.

## Verified (test channel)

* Rich day card (table + divider + hashtags + zone button) — `sendRichMessage`.
* Card edit bolds+marks current row — `editMessageText` with `rich_message`.
* Reminder carries a real quote of the row — `quote_rich_texts` with mirrored nesting.
* Fallbacks: rich fail → plain text; rich-edit fail → delete + repost.
