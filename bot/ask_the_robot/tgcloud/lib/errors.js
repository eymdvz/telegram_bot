// lib/errors.js — shared error discipline.
// Pattern adapted from https://github.com/megatzackry/Telegram-Serverless-Agent
// (AppError + guarded). A handler that throws is logged, never surfaced to Telegram.

export const guarded = (handler) => async (payload, ctx) => {
  try {
    return await handler(payload, ctx);
  } catch (err) {
    console.error('handler failed:', err?.description ?? err?.message ?? err);
  }
};
