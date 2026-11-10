
This updated documentation reflects the recent changes made to the **UNISZA Confession Bot**, including the transition to HTML parsing and the implementation of a multi-button layout for the commercial (Iklan Niaga) broadcasts.

---

# 📘 UNISZA Confession Bot Documentation (v1.1)

## 1. Overview

The **UNISZA Confession Bot** (@autosent_robot) is an automated utility for managing the UniJa Confession Telegram ecosystem. It schedules religious reminders, maintenance stickers, and specialized commercial advertisement posts that link directly to comment threads.

## 2. Core Features

* **Dynamic Scheduled Broadcasts:** Automated delivery of Al-Mulk, Selawat, and Midnight Stickers.
* **Dual-Platform Posting:** Syncs messages between the main Channel and the Discussion Group.
* **Smart Ad Threading:** Posts ads into a specific group thread and generates a "Jump Link" button on the channel post for easy navigation.
* **Auto-Cleanup (Maintenance):** Automatically deletes the previous day's advertisement/reminders to keep the channel feed clean.
* **HTML Parsing:** Uses HTML mode for channel posts to ensure compatibility with Telegram handles containing underscores (e.g., `@iklansewa_unisza`).

---

## 3. Configuration System (`CONFIG`)

### Message Schema Extensions

| Property            | Description                                                                       |
| :------------------ | :-------------------------------------------------------------------------------- |
| `caption`         | Now supports HTML tags (e.g., `<b>`, `<i>`, `<a>`).                         |
| `extraButtonText` | The label for the second interactive button.                                      |
| `extraButtonUrl`  | The destination link for the second button.                                       |
| `deletePrevious`  | Boolean; if true, the bot wipes the last message of this category before posting. |

---

## 4. Technical Workflow

### The Broadcast Logic (`executeBroadcast`)

1. **Old Message Deletion:** Checks `PropertiesService` for `LAST_ID_` and attempts to delete the previous iteration of the message.
2. **Group Sync:**
   * Sends a Markdown-formatted instruction to the discussion group.
   * Targets the specific "Iklan Niaga" thread using `parentMessageId`.
3. **Link Generation:** Captures the Group Message ID to create a deep link (e.g., `https://t.me/unijaconfession/123?comment=456`).
4. **Channel Delivery (HTML Mode):**
   * Sends the photo and caption to the channel.
   * **Parsing Mode:** Switched to **HTML** to prevent errors when Telegram handles or text contain special characters like underscores (`_`).
   * **Buttons:** Attaches an inline keyboard with two buttons (Thread Link and External Link).

---

## 5. Security & Error Handling

* **Exception Muting:** The script uses `muteHttpExceptions: true` to prevent the Daily Reset trigger from failing if a message was already manually deleted.
* **State Persistence:** Message IDs are stored in `PropertiesService` to maintain "memory" across script executions.

---
