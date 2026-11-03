import { api } from 'sdk';
import { ADMIN_GROUP_ID, ADMIN_IDS } from './config.js';

// Bot-admin = anyone in ADMIN_IDS, or any admin/creator of the admin group.
// Group lookup is live (60s best-effort cache); ADMIN_IDS covers API hiccups
// and people removed from group admins. SUPER_ADMIN stays manual (privacy).

let cache = { at: 0, ids: [] };
const TTL_MS = 60000;

async function groupAdminIds() {
  if (Date.now() - cache.at < TTL_MS) return cache.ids;
  const list = await api.getChatAdministrators({ chat_id: ADMIN_GROUP_ID });
  const ids = (list ?? [])
    .filter((m) => m?.user?.id && (m.status === 'administrator' || m.status === 'creator'))
    .map((m) => m.user.id);
  cache = { at: Date.now(), ids };
  return ids;
}

export async function isAdmin(tgId) {
  if (!tgId) return false;
  if (ADMIN_IDS.includes(tgId)) return true;
  try {
    return (await groupAdminIds()).includes(tgId);
  } catch (e) {
    console.error('getChatAdministrators failed:', e?.description ?? e?.message ?? e);
    return false;
  }
}
