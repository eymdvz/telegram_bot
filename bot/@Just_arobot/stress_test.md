# Just_arobot — stress test plan

Hammer with a second (non-exempt) account. The owner account bypasses every
guard, so testing from it proves nothing.

## Guard tests (second account → bot DM)

1. **Burst** — 4 texts within a minute. Expect: 3 previews, 4th refused
   `Slow down`. Cleanup: Cancel the previews.
2. **Taps** — tap preview buttons 11+ times fast. Expect: ~11th tap answers
   `Slow down`, rest die silently. Cleanup: none (first tap consumes it).
3. **Text limits** — Confirm 6 texts within the hour. Expect: 6th refused
   `5/hour`. Cleanup: Reject the 5 cards in group.
4. **Media limit** — send 2 photos, Confirm both. Expect: 2nd refused `1/day`.
   Cleanup: Reject/handle the 1st card.

## Flow tests (group + channel)

5. **Double-tap race** — Accept the same card twice fast (or two admins at
   once). Expect: one post, second tap answers `Already queued/handled`.
   Cleanup: Undo if needed.
6. **Reaction storm** — spam reactions on a channel post, remove, re-add.
   Expect: no crash, last state wins. Cleanup: none.

## Watch

- `npx tgcloud webhook` → `pending updates` stays 0 (backlog = platform
  queuing, not bot speed).
- Duplicated channel posts = real failure; everything else is cosmetic.

## Red lines

- Bans only between your own two accounts, never real users.
- No mass-Accept of throwaways (each Accept is a public post — Undo after).
- Report back only: duplicates, identity leaks, errors.
