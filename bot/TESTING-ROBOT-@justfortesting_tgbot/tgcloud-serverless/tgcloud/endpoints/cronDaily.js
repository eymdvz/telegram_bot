// endpoints/cronDaily.js — scheduler entry: posts today's rich card.
// Trigger: npx tgcloud run endpoints/cronDaily '{}' (TGCLOUD_TOKEN env).
import { postDaily } from '../lib/prayer.js';

export default async function (input, ctx) {
  return postDaily();
}
