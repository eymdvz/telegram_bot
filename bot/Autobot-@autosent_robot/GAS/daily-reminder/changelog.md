
# 📜 Changelog

### [v1.1] - 2024-05-22

**Added**

- **Multi-Button Support:** Implemented an `extraButton` system within the `iklanNiaga` category.
- **Emoji Branding:** Added icons (`📝`, `🏘️`) to inline buttons to improve UI/UX.
- **HTML Parsing Integration:** Changed `parse_mode` from `Markdown` to `HTML` for channel broadcasts to fix a bug where underscores in usernames (e.g., `@iklansewa_unisza`) caused the bot to fail.

**Fixed**

- **Underscore Crash:** Resolved an issue where the bot failed to post to the channel if the caption contained an unclosed markdown symbol.
- **Caption Formatting:** Updated `iklanNiaga` caption with improved spacing and bold HTML tags.

**Changed**

- **Button Layout:** Updated the inline keyboard to display two buttons side-by-side for the "Iklan Niaga" post.
- **Logic Refinement:** Optimized the `executeBroadcast` function to handle both Sticker objects and Message objects more cleanly.

---

### [v1.0] - Initial Release

- Basic scheduling for Al-Mulk, Selawat, and Midnight Stickers.
- Single-button "Jump Link" for advertisements.
- Basic auto-delete functionality.
- Markdown-only parsing.
