import { db, api } from 'sdk';
import { eq, and } from 'sdk/db';
import { users, submissions, parts } from '../schema.js';
import { guarded } from '../lib/errors.js';
import { STR, L } from '../lib/strings.js';
import { maskContacts, detectGroupLink, KIND_TAGS, detectIntent, tag } from '../lib/moderation.js';
import { previewActionText, previewActionRow, previewRichAction } from './message.js';
import { MASK_CONTACTS, GROUP_LINK_URL } from '../lib/config.js';

// Caption fill-in: user edits their staged DM to add the missing caption.
// Only unconfirmed staged rows react; everything else is ignored silently.
// Private chat id == tg id is enforced so edits never cross between users.
const NEEDS_CAPTION = ['photo', 'video', 'document'];

async function handle(msg) {
  const chatId = msg.chat?.id;
  if (!chatId || msg.chat?.type !== 'private') return;
  if (msg.from?.id !== chatId || msg.from?.is_bot) return;
  const sub = await db.select().from(submissions)
    .where(and(eq(submissions.userMessageId, msg.message_id), eq(submissions.status, 'unconfirmed')))
    .get().catch(() => null);
  if (!sub) return;
  const u = await db.select().from(users).where(eq(users.id, sub.userId)).get().catch(() => null);
  if (!u || u.tgId !== chatId) return;
  const t = L(u);
  let newCap = msg.caption ?? (sub.mediaKind === 'text' ? msg.text : null);
  if (newCap == null) return;
  // Group-link gate recompute on the RAW edit (masking destroys URLs):
  // link in → held (fresh hold notice if it was clear); link out → released.
  const grpNow = detectGroupLink(newCap);
  if (MASK_CONTACTS) {
    const m = maskContacts(newCap);
    if (m.n) newCap = m.masked;
  }
  newCap = newCap.slice(0, 1024);
  // Never auto-release on edit (a stale buttoned notice would outlive the
  // flag) — link out still needs one clear tap; link in re-holds.
  await db.update(submissions).set({ caption: newCap, ...(sub.mediaKind === 'text' ? { text: newCap } : {}), ...(grpNow ? { grpCleared: 0 } : {}) }).where(eq(submissions.id, sub.id)).run().catch(() => {});
  if (grpNow && sub.grpCleared) {
    // Was clear, edit introduced a link — fresh hold notice (tracked).
    try {
      const nm = await api.sendMessage({ chat_id: chatId, text: t.grpHold(grpNow, GROUP_LINK_URL),
        reply_markup: { inline_keyboard: [[{ text: t.grpClearBtn, callback_data: `grpclear_${sub.id}` }], [{ text: t.cancelBtn, callback_data: `cancelconf_${sub.id}` }]] } });
      if (nm?.message_id) {
        const cur = await db.select().from(submissions).where(eq(submissions.id, sub.id)).get().catch(() => null);
        const ids = Array.isArray(cur?.noticeIds) ? cur.noticeIds : [];
        await db.update(submissions).set({ noticeIds: [...ids, nm.message_id] }).where(eq(submissions.id, sub.id)).run().catch(() => {});
      }
    } catch {}
  }
  if (sub.mediaKind !== 'text') {
    await db.update(parts).set({ caption: newCap }).where(eq(parts.submissionId, sub.id)).run().catch(() => {});
  }
  // Refresh the stale preview bubble (the action bubble never carries the
  // caption, so only the content message needs it). Rich-styled bubbles
  // refuse edits — rebuild + repoint instead. Stickers have no caption.
  if (sub.previewMsgId && sub.mediaKind !== 'sticker') {
    let fresh = false;
    try {
      if (sub.mediaKind === 'text') {
        await api.editMessageText({ chat_id: chatId, message_id: sub.previewMsgId, text: newCap.slice(0, 1000) || '(empty)' });
      } else {
        await api.editMessageCaption({ chat_id: chatId, message_id: sub.previewMsgId, caption: newCap });
      }
      fresh = true;
    } catch {}
    if (!fresh) {
      // Ordered rebuild: when the action id was stored, delete both and
      // resend content-then-action (plain shape, shared builder). Old rows
      // without an action id keep content-only rebuild (order may flip).
      const full = !!sub.actionMsgId;
      try { await api.deleteMessage({ chat_id: chatId, message_id: sub.previewMsgId }); } catch {}
      if (full) { try { await api.deleteMessage({ chat_id: chatId, message_id: sub.actionMsgId }); } catch {} }
      try {
        const p = sub.mediaKind === 'text' ? null
          : await db.select().from(parts).where(eq(parts.submissionId, sub.id)).orderBy(parts.id).get().catch(() => null);
        let m = null;
        if (sub.mediaKind === 'text') m = await api.sendMessage({ chat_id: chatId, text: newCap.slice(0, 1000) || '(empty)' });
        else if (sub.mediaKind === 'photo') m = await api.sendPhoto({ chat_id: chatId, photo: p.fileId, caption: newCap });
        else if (sub.mediaKind === 'video') m = await api.sendVideo({ chat_id: chatId, video: p.fileId, caption: newCap });
        else if (sub.mediaKind === 'voice') m = await api.sendVoice({ chat_id: chatId, voice: p.fileId, caption: newCap });
        else if (sub.mediaKind === 'document') m = await api.sendDocument({ chat_id: chatId, document: p.fileId, caption: newCap });
        const set = {};
        if (m?.message_id) set.previewMsgId = m.message_id;
        if (full && m) {
          const kk = sub.kind ?? 'confession';
          const ri = kk === 'confession' ? detectIntent(newCap ?? '') : null;
          const qn = (KIND_TAGS[kk] && kk !== 'confession') ? t.kindNote(KIND_TAGS[kk]) : '';
          // Rich-first with plain fallback — mirrors staging exactly.
          const aSegs = [t.actionLead + ' ', { type: 'bold', text: t.preview(sub.id, kk) }, ':' + qn];
          const threadToPreview = m?.message_id ? { reply_parameters: { message_id: m.message_id } } : {};
          let am = null;
          try {
            am = await api.sendRichMessage({ chat_id: chatId, rich_message: { blocks: [{ type: 'paragraph', text: aSegs }, ...previewRichAction(t, sub.id, kk, ri)] }, ...threadToPreview });
          } catch {
            try {
              am = await api.sendMessage({ chat_id: chatId, text: previewActionText(t, sub.id, kk, qn), parse_mode: 'HTML', reply_markup: previewActionRow(t, sub.id, kk, ri), ...threadToPreview });
            } catch {
              am = await api.sendMessage({ chat_id: chatId, text: previewActionText(t, sub.id, kk, qn).replace(/<[^>]+>/g, ''), reply_markup: previewActionRow(t, sub.id, kk, ri) });
            }
          }
          if (am?.message_id) set.actionMsgId = am.message_id;
        }
        if (Object.keys(set).length) await db.update(submissions).set(set).where(eq(submissions.id, sub.id)).run().catch(() => {});
      } catch {}
    }
  }
  if (NEEDS_CAPTION.includes(sub.mediaKind) && !(sub.caption || '').trim() && newCap.trim()) {
    try {
      const gm = await api.sendMessage({ chat_id: chatId, text: await tag('captionGot', t.captionGot(sub.id)) });
      if (gm?.message_id) {
        const cur = await db.select().from(submissions).where(eq(submissions.id, sub.id)).get().catch(() => null);
        const ids = Array.isArray(cur?.noticeIds) ? [...cur.noticeIds, gm.message_id] : [gm.message_id];
        await db.update(submissions).set({ noticeIds: ids }).where(eq(submissions.id, sub.id)).run().catch(() => {});
      }
    } catch {}
  }
}

export default guarded(handle);
