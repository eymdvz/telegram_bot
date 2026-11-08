import { api } from 'sdk';
import { ADMIN_GROUP_ID, ADMIN_IDS, SUPER_ADMIN_ID } from './config.js';

// Bot-admin = anyone in ADMIN_IDS, or any admin/creator of the admin group.
// Group lookup is live (60s best-effort cache); ADMIN_IDS covers API hiccups
// and people removed from group admins. SUPER_ADMIN stays manual (privacy).

let cache = { at: 0, ids: [], members: [] };
const TTL_MS = 60000;

async function groupAdminMembers() {
  if (Date.now() - cache.at < TTL_MS) return cache.members;
  const list = await api.getChatAdministrators({ chat_id: ADMIN_GROUP_ID });
  const members = (list ?? [])
    .filter((m) => m?.user?.id && (m.status === 'administrator' || m.status === 'creator') && !m.user.is_bot)
    .map((m) => ({
      id: m.user.id,
      name: [m.user.first_name, m.user.last_name].filter(Boolean).join(' ') || 'admin',
      username: m.user.username ?? null,
      title: m.custom_title ?? null,
    }));
  cache = { at: Date.now(), ids: members.map((m) => m.id), members };
  return members;
}

// System-wide admin display: "<tag> - @username" (Name fallback).
// Owner always renders as owner regardless of group custom title.
export function adminDisplay(m) {
  const tag = m?.id === SUPER_ADMIN_ID ? '👑 owner' : (m?.title ? `🔰 ${m.title}` : '🔰 admin');
  const who = m?.username ? '@' + m.username : (m?.name || 'admin');
  return `${tag} - ${who}`;
}

// Cached member lookup by tg id (null when not a group admin).
export async function lookupAdmin(tgId) {
  const members = await groupAdmins().catch(() => []);
  return (members ?? []).find((m) => m.id === tgId) ?? null;
}
export async function groupAdmins() {
  try {
    return await groupAdminMembers();
  } catch (e) {
    console.error('getChatAdministrators failed:', e?.description ?? e?.message ?? e);
    return [];
  }
}

async function groupAdminIds() {
  try {
    if (Date.now() - cache.at < TTL_MS) return cache.ids;
    await groupAdminMembers();
    return cache.ids;
  } catch (e) {
    console.error('getChatAdministrators failed:', e?.description ?? e?.message ?? e);
    return cache.ids;
  }
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
