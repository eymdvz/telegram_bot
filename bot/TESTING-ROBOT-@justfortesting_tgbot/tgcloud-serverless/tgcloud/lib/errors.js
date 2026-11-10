// lib/errors.js — shared error discipline (same as bot/ask_the_robot).
export const guarded = (handler) => async (payload, ctx) => {
  try {
    return await handler(payload, ctx);
  } catch (err) {
    console.error('handler failed:', err?.description ?? err?.message ?? err);
  }
};
