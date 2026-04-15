/**
 * Usage metering helpers.
 * Tracks minutes_used per org and enforces plan limits.
 */

import { pool } from './db.js';
import { PLANS, type PlanId } from './billing.js';

/**
 * Default minutes we reserve at call-start. Reconciled to actual at call-end
 * (Retell webhook). 5 min is a generous-but-bounded estimate that covers most
 * inbound calls; reconciliation refunds the unused part for shorter calls.
 *
 * The whole point of reserving is to close the E7 race: under the old
 * "check then increment at end" model, 10 parallel calls could each see
 * `allowed: true` and only deduct after the fact → over-limit billing.
 * With reservation, the limit-check and the deduct happen in ONE atomic SQL.
 */
export const DEFAULT_CALL_RESERVE_MINUTES = 5;

/**
 * Returns the per-minute overcharge rate for a given plan.
 */
export function getOverchargeRate(planId: string): number {
  return PLANS[planId as PlanId]?.overchargePerMinute ?? 0;
}

/**
 * Increment the minutes_used counter for an org (raw, non-atomic). Kept for
 * legacy paths that don't go through reservation. New code should use
 * `tryReserveMinutes` + `reconcileMinutes` instead.
 */
export async function incrementMinutesUsed(orgId: string, minutes: number): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE orgs SET minutes_used = minutes_used + $1 WHERE id = $2`,
    [minutes, orgId],
  );
}

/**
 * Atomic check-and-reserve: tries to bump `minutes_used` by `minutes`, but
 * ONLY if the new total stays within `minutes_limit` and the plan is not
 * paused/past_due/canceled. Returns the post-reservation usage on success
 * or `{allowed: false, ...}` on failure.
 *
 * Closes E7: read+update-in-one-statement means 10 parallel callers can't
 * each pass the check before the first one's deduct lands.
 */
export async function tryReserveMinutes(
  orgId: string,
  minutes: number = DEFAULT_CALL_RESERVE_MINUTES,
): Promise<{ allowed: boolean; minutesUsed: number; minutesLimit: number }> {
  if (!pool) {
    if (process.env.NODE_ENV === 'production') {
      return { allowed: false, minutesUsed: 0, minutesLimit: 0 };
    }
    return { allowed: true, minutesUsed: 0, minutesLimit: 9999 };
  }

  // The WHERE clause is the gate. RETURNING gives us the post-update state.
  // No transaction needed — a single UPDATE is atomic in PostgreSQL and
  // the predicate is evaluated against the current row at lock-acquisition
  // time, so concurrent updates serialise on the row lock.
  const res = await pool.query(
    `UPDATE orgs
     SET minutes_used = minutes_used + $2
     WHERE id = $1
       AND minutes_used + $2 <= minutes_limit
       AND plan_status NOT IN ('paused', 'past_due', 'canceled')
     RETURNING minutes_used, minutes_limit`,
    [orgId, minutes],
  );

  if (res.rows.length) {
    const { minutes_used, minutes_limit } = res.rows[0];
    return { allowed: true, minutesUsed: minutes_used, minutesLimit: minutes_limit };
  }

  // Reservation refused. Re-fetch so the caller can show useful numbers
  // (over-limit message etc.). If the org doesn't exist at all → all zeros.
  const fallback = await pool.query(
    `SELECT minutes_used, minutes_limit FROM orgs WHERE id = $1`,
    [orgId],
  );
  const row = fallback.rows[0];
  return {
    allowed: false,
    minutesUsed: row?.minutes_used ?? 0,
    minutesLimit: row?.minutes_limit ?? 0,
  };
}

/**
 * Reconciliation at call-end: adjusts the counter by the delta between what
 * we actually consumed and what we reserved. `delta = actual - reserved`.
 * Negative deltas (short calls) refund the over-reservation. We clamp to
 * GREATEST(0, ...) so a fast hangup before the actual minute counter ticked
 * doesn't push us into negative storage.
 */
export async function reconcileMinutes(
  orgId: string,
  reservedMinutes: number,
  actualMinutes: number,
): Promise<void> {
  if (!pool) return;
  const delta = actualMinutes - reservedMinutes;
  if (delta === 0) return;
  await pool.query(
    `UPDATE orgs SET minutes_used = GREATEST(0, minutes_used + $2) WHERE id = $1`,
    [orgId, delta],
  );
}

/**
 * Read-only check whether an org would be allowed to start a call right now.
 * Use this for UI gating (e.g. "Test-Call" button enabled/disabled), not for
 * actually authorising a call — that path MUST go through tryReserveMinutes
 * to win the race.
 */
export async function checkUsageLimit(orgId: string): Promise<{
  allowed: boolean;
  minutesUsed: number;
  minutesLimit: number;
}> {
  if (!pool) {
    // Production MUST have a DB — fail closed so a mis-deployed instance
    // can't silently authorise unlimited usage. Dev keeps the permissive
    // fallback so local developers don't need Postgres for every experiment.
    if (process.env.NODE_ENV === 'production') {
      return { allowed: false, minutesUsed: 0, minutesLimit: 0 };
    }
    return { allowed: true, minutesUsed: 0, minutesLimit: 9999 };
  }

  const res = await pool.query(
    `SELECT minutes_used, minutes_limit, plan_status FROM orgs WHERE id = $1`,
    [orgId],
  );

  if (!res.rows.length) {
    // Unknown org — deny
    return { allowed: false, minutesUsed: 0, minutesLimit: 0 };
  }

  const { minutes_used, minutes_limit, plan_status } = res.rows[0];
  // Block usage if subscription is paused, past_due, or canceled
  const blockedStatuses = new Set(['paused', 'past_due', 'canceled']);
  const statusBlocked = blockedStatuses.has(plan_status);

  return {
    allowed: !statusBlocked && minutes_used < minutes_limit,
    minutesUsed: minutes_used,
    minutesLimit: minutes_limit,
  };
}
