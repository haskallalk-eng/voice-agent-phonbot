/**
 * Usage metering helpers.
 * Tracks minutes_used per org and enforces plan limits.
 */

import { pool } from './db.js';
import { PLANS, type PlanId } from './billing.js';

/**
 * Returns the per-minute overcharge rate for a given plan.
 */
export function getOverchargeRate(planId: string): number {
  return PLANS[planId as PlanId]?.overchargePerMinute ?? 0;
}

/**
 * Increment the minutes_used counter for an org.
 */
export async function incrementMinutesUsed(orgId: string, minutes: number): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE orgs SET minutes_used = minutes_used + $1 WHERE id = $2`,
    [minutes, orgId],
  );
}

/**
 * Check whether an org is still within its usage limit.
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
