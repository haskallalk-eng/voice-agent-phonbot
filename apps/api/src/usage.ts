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
 * Plan statuses that block usage. Mirrors Stripe subscription.status lifecycle:
 * - `incomplete` / `incomplete_expired`: initial payment not confirmed (blocks
 *   the subscription.created-before-checkout.completed race where plan='starter'
 *   lands in DB before the charge is captured).
 * - `past_due`: invoice retry in progress.
 * - `unpaid`: all retries failed.
 * - `paused` / `canceled`: user/operator action.
 *
 * Allowed: `active`, `trialing` (legitimate trial), and `free` (no Stripe sub).
 */
export const BLOCKED_PLAN_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'past_due',
  'unpaid',
  'paused',
  'canceled',
] as const;

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

  // Plan IDs that permit billable overage past the limit (soft cap). Computed
  // from PLANS at call time so adding a new paid plan propagates automatically.
  // Free / zero-rate plans get hard-blocked when over limit.
  const paidPlans = Object.values(PLANS)
    .filter((p) => p.overchargePerMinute > 0)
    .map((p) => p.id);

  // ATOMIC reservation in a single SQL statement.
  //
  // The old flow (fast-path UPDATE → SELECT fallback → conditional UPDATE)
  // had a TOCTOU race window on the paid-plan soft cap: 10 parallel callers
  // could all read the same stale minutes_used via the SELECT before any
  // UPDATE landed, each then issue their own UPDATE, and bump the counter
  // by 10× the intended amount — effectively unbounded overage reservation.
  //
  // Here everything happens inside one Postgres statement kernel:
  //   1. `locked` CTE grabs a SELECT ... FOR UPDATE row-lock on the org.
  //   2. `decision` CTE evaluates the branch:
  //        - blocked status (incomplete / past_due / paused / …)  → deny
  //        - minutes_used + reserve ≤ limit                       → allow (within)
  //        - plan is paid (rate > 0)                              → allow (overage)
  //        - else (free plan over limit)                          → deny (hard)
  //   3. `applied` CTE performs the UPDATE only when the decision allows.
  //   4. Final SELECT returns the decision + post-state to JS.
  //
  // Parallel callers serialize on the row lock and observe each other's
  // deductions. No overshooting possible.
  const res = await pool.query(
    `WITH locked AS (
       SELECT id, minutes_used, minutes_limit, plan, plan_status
       FROM orgs WHERE id = $1 FOR UPDATE
     ),
     decision AS (
       SELECT
         id, minutes_used, minutes_limit,
         CASE
           WHEN plan_status IN ('incomplete','incomplete_expired','past_due','unpaid','paused','canceled')
             THEN 'blocked'
           WHEN minutes_used + $2 <= minutes_limit
             THEN 'within_limit'
           WHEN plan = ANY($3::text[])
             THEN 'overage_allowed'
           ELSE 'hard_blocked'
         END AS decision
       FROM locked
     ),
     applied AS (
       UPDATE orgs
       SET minutes_used = orgs.minutes_used + $2
       FROM decision
       WHERE orgs.id = decision.id
         AND decision.decision IN ('within_limit', 'overage_allowed')
       RETURNING orgs.id, orgs.minutes_used AS new_used
     )
     SELECT
       d.decision AS decision,
       COALESCE(a.new_used, d.minutes_used) AS minutes_used,
       d.minutes_limit
     FROM decision d
     LEFT JOIN applied a ON a.id = d.id`,
    [orgId, minutes, paidPlans],
  );

  if (!res.rowCount) {
    // Org not found → deny (matches prior behaviour).
    return { allowed: false, minutesUsed: 0, minutesLimit: 0 };
  }
  const row = res.rows[0];
  const allowed = row.decision === 'within_limit' || row.decision === 'overage_allowed';
  return {
    allowed,
    minutesUsed: Number(row.minutes_used ?? 0),
    minutesLimit: Number(row.minutes_limit ?? 0),
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
  const blockedStatuses = new Set<string>(BLOCKED_PLAN_STATUSES);
  const statusBlocked = blockedStatuses.has(plan_status);

  return {
    allowed: !statusBlocked && minutes_used < minutes_limit,
    minutesUsed: minutes_used,
    minutesLimit: minutes_limit,
  };
}
