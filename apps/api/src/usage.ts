/**
 * Usage metering helpers.
 * Tracks minutes_used per org and enforces plan limits.
 */

import { pool } from './db.js';
import { PLANS, type PlanId, chargeOverageMinutes } from './billing.js';

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

  // Paid plans (with overage rate > 0) use a soft cap: calls are allowed past
  // the limit, overage is billed via Stripe invoice items in reconcileMinutes.
  // Free plan (overcharge = 0) keeps the hard block.
  //
  // Step 1: try the strict within-limit reservation.
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

  // Step 2: within-limit reservation failed. For paid plans with overage,
  // allow the call anyway (soft cap) — overage is billed at call-end.
  const fallback = await pool.query(
    `SELECT minutes_used, minutes_limit, plan, plan_status FROM orgs WHERE id = $1`,
    [orgId],
  );
  const row = fallback.rows[0];
  if (!row) {
    return { allowed: false, minutesUsed: 0, minutesLimit: 0 };
  }

  const blockedStatuses = new Set(['paused', 'past_due', 'canceled']);
  if (blockedStatuses.has(row.plan_status)) {
    return { allowed: false, minutesUsed: row.minutes_used, minutesLimit: row.minutes_limit };
  }

  const rate = getOverchargeRate(row.plan as string);
  if (rate > 0) {
    // Paid plan with overage → allow and reserve (will be billed in reconcile)
    await pool.query(
      `UPDATE orgs SET minutes_used = minutes_used + $2 WHERE id = $1`,
      [orgId, minutes],
    );
    return {
      allowed: true,
      minutesUsed: (row.minutes_used as number) + minutes,
      minutesLimit: row.minutes_limit as number,
    };
  }

  // Free plan → hard block
  return {
    allowed: false,
    minutesUsed: row.minutes_used ?? 0,
    minutesLimit: row.minutes_limit ?? 0,
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

  // Atomic UPDATE RETURNING captures pre- and post-state in one statement,
  // eliminating the race condition where a parallel webhook could read stale
  // minutes_used between a separate SELECT and UPDATE.
  // CTE captures the pre-update state atomically, then applies the delta.
  // No race: both reads happen in the same statement execution.
  const res = await pool.query(
    `WITH pre AS (
       SELECT minutes_used AS old_used, minutes_limit, plan, name
       FROM orgs WHERE id = $1 FOR UPDATE
     )
     UPDATE orgs SET minutes_used = GREATEST(0, orgs.minutes_used + $2)
     FROM pre WHERE orgs.id = $1
     RETURNING orgs.minutes_used, pre.old_used, pre.minutes_limit, pre.plan, pre.name`,
    [orgId, delta],
  );

  if (!res.rowCount) return;
  const row = res.rows[0];
  const postUsed = (row.minutes_used ?? 0) as number;
  const preUsed = (row.old_used ?? 0) as number;
  const limit = (row.minutes_limit ?? 0) as number;
  const plan = (row.plan as string) ?? 'free';

  const overageBefore = Math.max(0, preUsed - limit);
  const overageAfter = Math.max(0, postUsed - limit);
  const newOverage = overageAfter - overageBefore;
  if (newOverage > 0) {
    const rate = getOverchargeRate(plan);
    chargeOverageMinutes(orgId, newOverage, rate).catch(() => {/* logged inside */});
  }

  // Usage warning emails at 80% and 100% thresholds.
  // Fire-and-forget — never block the webhook response for an email.
  if (row && limit > 0) {
    const pct = Math.round((postUsed / limit) * 100);
    const thresholds = [80, 100] as const;
    for (const t of thresholds) {
      if (pct >= t) {
        // Only send once per threshold: check Redis dedup key.
        // If Redis is unavailable, skip the email entirely (fail-closed).
        // Better: user misses a notification until Redis is back, vs.
        // getting duplicate emails on every single reconciliation.
        const { redis } = await import('./redis.js');
        if (!redis?.isOpen) break;
        const dedupKey = `usage_warn:${orgId}:${t}`;
        const claimed = await redis.set(dedupKey, '1', { NX: true, EX: 30 * 24 * 3600 }).catch(() => null);
        if (!claimed) continue; // already sent this cycle
        // Look up owner email
        const ownerRes = await pool.query(
          `SELECT u.email FROM users u WHERE u.org_id = $1 AND u.role = 'owner' AND u.is_active = true LIMIT 1`,
          [orgId],
        );
        const email = ownerRes.rows[0]?.email as string | undefined;
        if (email) {
          const { sendUsageWarningEmail } = await import('./email.js');
          sendUsageWarningEmail({
            toEmail: email,
            orgName: row.name ?? 'Phonbot',
            minutesUsed: row.minutes_used,
            minutesLimit: row.minutes_limit,
            percent: pct,
          }).catch(() => {/* logged inside */});
        }
        break; // only send the highest-threshold email
      }
    }
  }
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
