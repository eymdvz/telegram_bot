# Chat IDs and links — reference

One place for the ID/link rules that bite once per project.

## ID shapes

| What | Looks like | Example (test env) |
|---|---|---|
| User / bot | positive | `230757915` |
| Basic group | small negative | `-123456789` |
| Supergroup / channel | `-100...` (13–14 digits) | `-1001267775431` (Test Channel), `-1002435146176` (Test group) |

Live (do not post here): channel `-1001779734656`, group `-1002010542998`.

Upgrading a basic group to a supergroup **changes its ID** (old one dies with `chat not found`). A topic id on a basic-looking id is the tell — forward a message from the group to a helper bot below for the live id.

## Helper bots for finding ids

* `@userinfobot` — forward it any message; it replies with the chat id (works for groups, channels, topics).
* `@id_bot` — same job, alternate bot. Use when the first is down.
* `@RawDataBot` — full raw update JSON (message ids, thread ids, reply structures). For debugging topics/threads when an id alone isn't enough.
* `@JsonDumpBot` — message JSON dump. Alternate raw viewer when you want the JSON shape fast.

Use one of these whenever an id is in doubt instead of guessing — wrong ids fail silently or `chat not found` at 3am.

## `t.me/c/` links (private chats)

Strip the `-100` prefix, then append message (and topic) ids:

* Channel message: `https://t.me/c/1267775431/373` (from `-1001267775431`, msg `373`)
* Forum topic message: `https://t.me/c/2435146176/1/811` (chat `2435146176`, topic `1`, msg `811`)
* Discussion-thread jump: `https://t.me/<channel>/<channelMsg>?comment=<groupMsgId>`

Only members can open these. The bot posting them needs no extra rights; the reader needs access.

## Public links

Chats with an `@username` use `https://t.me/<username>/<msgId>` — no stripping. Prefer these in user-facing buttons whenever the chat has a username.

## Web client form

`https://web.telegram.org/k/#-<stripped>` — same stripped number, e.g. `#-2435146176`. Same rule, different costume.

## Hall of mistakes

1. **Keeping the `100`**: `t.me/c/1002435146176` points at a chat that doesn't exist. Always strip `-100`.
2. **Quoting the full id in code comments as a link**: write the link form next to it or the next person will copy-paste wrong.
3. **Basic-group id after upgrade**: `chat not found` on a previously working id → re-resolve via `@userinfobot`, update config + `ground.json`.
