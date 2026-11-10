// endpoints/cronTick.js — scheduler entry: posts due prayer reminders.
// Trigger: npx tgcloud run endpoints/cronTick '{}'
// Test a specific prayer: npx tgcloud run endpoints/cronTick '{"nowMs": 1730000000000}'
import { tickReminders } from '../lib/prayer.js';

export default async function (input, ctx) {
  const nowMs = Number(input?.nowMs) || Date.now();
  return tickReminders(nowMs);
}
