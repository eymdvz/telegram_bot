// endpoints/cronDaily.js — scheduler entry: posts today's rich card.
// Preview a highlighted row: npx tgcloud run endpoints/cronDaily "{ current: 'asr' }"
import { postDaily } from '../lib/prayer.js';

export default async function (input, ctx) {
  return postDaily(input?.current || null);
}
