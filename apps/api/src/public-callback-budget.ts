import { redis } from './redis.js';

export type CallbackBudget = { ok: true } | { ok: false; reason: 'limit' | 'unavailable' };

/** One shared UTC-hour budget for both public callback entry points.
 * Keep the existing demo counter key so a rollout cannot reset used capacity.
 * Failed downstream attempts retain their slot: an uncertain provider response
 * must not refund capacity and permit unbounded paid retries.
 */
export async function reservePublicCallback(): Promise<CallbackBudget> {
  const cap = Number(process.env.DEMO_GLOBAL_HOURLY_CAP ?? 200);
  if (!Number.isSafeInteger(cap) || cap <= 0 || !redis?.isReady) {
    return { ok: false, reason: 'unavailable' };
  }
  const hour = new Date().toISOString().slice(0, 13);
  try {
    const results = await redis.multi()
      .incr(`demo:global:callback:${hour}`)
      .expire(`demo:global:callback:${hour}`, 3700)
      .exec();
    const count = Number(results[0]);
    if (!Number.isSafeInteger(count) || count < 1) return { ok: false, reason: 'unavailable' };
    return count <= cap ? { ok: true } : { ok: false, reason: 'limit' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
