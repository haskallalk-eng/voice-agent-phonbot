/** Usage holds and actual consumption are separate, transactionally settled values. */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { PLANS, type PlanId } from './billing.js';
import { getVoiceSurcharge } from './voice-catalog.js';

export const DEFAULT_CALL_RESERVE_MINUTES = 5;
export const BLOCKED_PLAN_STATUSES = [
  'incomplete', 'incomplete_expired', 'past_due', 'unpaid', 'paused', 'canceled',
] as const;

export function getOverchargeRate(planId: string): number {
  return PLANS[planId as PlanId]?.overchargePerMinute ?? 0;
}

type OrgUsage = {
  id: string; minutes_used: number | string; minutes_reserved: number | string;
  minutes_limit: number | string; plan: string; plan_status: string; name: string;
};
type Reservation = { id: string; minutes: number | string; call_id: string | null; created_at: Date | string; state: 'held' | 'released' | 'settled' };
export type UsageReservation = { allowed: boolean; minutesUsed: number; minutesLimit: number; reservationId?: string };
export type UsageSettlementContext = { callId: string; agentId?: string; reservationId?: string; startedAt?: number };

function validMinutes(minutes: number, allowZero = false): number {
  if (!Number.isFinite(minutes) || minutes < 0 || (!allowZero && minutes === 0)) throw new Error('USAGE_MINUTES_INVALID');
  const rounded = Math.round(minutes * 100) / 100;
  if (!allowZero && rounded === 0) throw new Error('USAGE_MINUTES_INVALID');
  return rounded;
}
function validCallId(callId: string): void {
  if (typeof callId !== 'string' || !callId.trim() || callId.length > 256) throw new Error('USAGE_CALL_ID_REQUIRED');
}
function validReservationId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('USAGE_RESERVATION_INVALID');
}

async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error('USAGE_DATABASE_UNAVAILABLE');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
async function lockOrg(client: PoolClient, orgId: string): Promise<OrgUsage | undefined> {
  const result = await client.query<OrgUsage>(
    'SELECT id, minutes_used, minutes_reserved, minutes_limit, plan, plan_status, name FROM orgs WHERE id = $1 FOR UPDATE', [orgId],
  );
  return result.rows[0];
}
function occupied(org: OrgUsage): number { return Number(org.minutes_used) + Number(org.minutes_reserved); }
async function activatedAt(client: PoolClient): Promise<number> {
  const { rows } = await client.query('SELECT activated_at FROM usage_ledger_state WHERE singleton = true');
  const activated = rows[0]?.activated_at ? new Date(rows[0].activated_at).getTime() : NaN;
  if (!Number.isFinite(activated)) throw new Error('USAGE_LEDGER_NOT_ACTIVATED');
  return activated;
}

/** Capacity hold only. Paid plans have a soft cap; actual usage is billed at settlement. */
export async function tryReserveMinutes(orgId: string, minutes = DEFAULT_CALL_RESERVE_MINUTES): Promise<UsageReservation> {
  minutes = validMinutes(minutes);
  if (!pool) return { allowed: false, minutesUsed: 0, minutesLimit: 0 };
  return transaction(async (client) => {
    const org = await lockOrg(client, orgId);
    if (!org) return { allowed: false, minutesUsed: 0, minutesLimit: 0 };
    await activatedAt(client);
    const used = occupied(org);
    const limit = Number(org.minutes_limit);
    if ((BLOCKED_PLAN_STATUSES as readonly string[]).includes(org.plan_status)
      || (used + minutes > limit && getOverchargeRate(org.plan) <= 0)) {
      return { allowed: false, minutesUsed: used, minutesLimit: limit };
    }
    const reservationId = randomUUID();
    await client.query('INSERT INTO usage_reservations (id, org_id, minutes) VALUES ($1, $2, $3)', [reservationId, orgId, minutes]);
    await client.query('UPDATE orgs SET minutes_reserved = minutes_reserved + $2 WHERE id = $1', [orgId, minutes]);
    return { allowed: true, minutesUsed: used + minutes, minutesLimit: limit, reservationId };
  });
}

async function readReservation(client: PoolClient, orgId: string, reservationId: string): Promise<Reservation> {
  validReservationId(reservationId);
  const { rows } = await client.query<Reservation>('SELECT id, minutes, call_id, state, created_at FROM usage_reservations WHERE org_id = $1 AND id = $2 FOR UPDATE', [orgId, reservationId]);
  if (!rows[0]) throw new Error('USAGE_RESERVATION_NOT_FOUND');
  return rows[0];
}
async function releaseHold(client: PoolClient, org: OrgUsage, reservation: Reservation): Promise<void> {
  if (reservation.state !== 'held') return;
  if (Number(org.minutes_reserved) < Number(reservation.minutes)) throw new Error('USAGE_HOLD_INVARIANT_BROKEN');
  await client.query('UPDATE orgs SET minutes_reserved = minutes_reserved - $2 WHERE id = $1', [org.id, reservation.minutes]);
}

/** Call creation rejected before success: release the exact scoped hold, at most once. */
export async function releaseMinutesReservation(orgId: string, reservationId: string): Promise<void> {
  await transaction(async (client) => {
    const org = await lockOrg(client, orgId);
    if (!org) throw new Error('USAGE_ORG_NOT_FOUND');
    const reservation = await readReservation(client, orgId, reservationId);
    if (reservation.state !== 'held') return;
    await releaseHold(client, org, reservation);
    await client.query("UPDATE usage_reservations SET state = 'released', finished_at = now() WHERE id = $1", [reservation.id]);
  });
}

/** Bind successful creation; a webhook may already have settled the same reservation. */
export async function bindMinutesReservation(orgId: string, reservationId: string, callId: string): Promise<void> {
  validCallId(callId);
  await transaction(async (client) => {
    const org = await lockOrg(client, orgId);
    if (!org) throw new Error('USAGE_ORG_NOT_FOUND');
    const reservation = await readReservation(client, orgId, reservationId);
    if (reservation.call_id && reservation.call_id !== callId) throw new Error('USAGE_RESERVATION_CALL_MISMATCH');
    const settled = await client.query('SELECT call_id, reservation_id FROM usage_settlements WHERE org_id = $1 AND call_id = $2', [orgId, callId]);
    if (settled.rowCount) {
      if (settled.rows[0].reservation_id && settled.rows[0].reservation_id !== reservation.id) throw new Error('USAGE_RESERVATION_CALL_MISMATCH');
      await releaseHold(client, org, reservation);
      await client.query("UPDATE usage_reservations SET call_id = $2, state = 'settled', finished_at = COALESCE(finished_at, now()) WHERE id = $1", [reservation.id, callId]);
      await client.query('UPDATE usage_settlements SET reservation_id = $3 WHERE org_id = $1 AND call_id = $2 AND reservation_id IS NULL', [orgId, callId, reservation.id]);
      return;
    }
    if (reservation.state !== 'held') throw new Error('USAGE_RESERVATION_NOT_HELD');
    await client.query('UPDATE usage_reservations SET call_id = $2 WHERE id = $1', [reservation.id, callId]);
  });
}

async function queueInvoice(client: PoolClient, org: OrgUsage, callId: string, kind: 'overage' | 'premium_voice', minutes: number, rate: number, voiceId?: string): Promise<void> {
  const amount = Math.round(minutes * rate * 100);
  if (amount <= 0) return;
  const key = `${kind === 'overage' ? 'overage' : 'premium'}:${org.id}:${callId}`;
  const metadata = kind === 'overage'
    ? { orgId: org.id, overageMinutes: String(minutes), plan: org.plan }
    : { orgId: org.id, premiumMinutes: String(minutes), surcharge: String(rate) };
  const description = kind === 'overage'
    ? `${minutes} Min Überschreitung (${rate.toFixed(2)} €/Min)`
    : `${minutes.toFixed(2)} Min Premium-Stimme${voiceId ? ` "${voiceId}"` : ''} (+${rate.toFixed(2)} €/Min)`;
  // Durable invoice intent is committed with usage, before any Stripe effect.
  // The existing retryFailedInvoiceItems worker delivers this row after commit.
  await client.query(
    `INSERT INTO failed_invoice_items (org_id, kind, amount_cents, currency, description, idempotency_key, metadata, retry_count)
     VALUES ($1, $2, $3, 'eur', $4, $5, $6, 0)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [org.id, kind, amount, description, key, JSON.stringify(metadata)],
  );
}

/**
 * Commit actual consumption once per org/call. A reservation is released only
 * when the database proves it belongs to this org and call. Inbound calls with
 * no reservation add their full duration, never a guessed five-minute delta.
 */
export async function reconcileMinutes(orgId: string, actualMinutes: number, context: UsageSettlementContext): Promise<void> {
  actualMinutes = validMinutes(actualMinutes, true);
  validCallId(context.callId);
  if (context.reservationId !== undefined) validReservationId(context.reservationId);
  const settled = await transaction(async (client) => {
    const org = await lockOrg(client, orgId);
    if (!org) throw new Error('USAGE_ORG_NOT_FOUND');
    const activated = await activatedAt(client);
    const duplicate = await client.query('SELECT call_id, actual_minutes, reservation_id FROM usage_settlements WHERE org_id = $1 AND call_id = $2', [orgId, context.callId]);
    if (duplicate.rowCount) {
      const prior = duplicate.rows[0];
      if (Number(prior.actual_minutes) !== actualMinutes || (context.reservationId && prior.reservation_id !== context.reservationId)) throw new Error('USAGE_SETTLEMENT_CONFLICT');
      return undefined;
    }
    let reservation: Reservation | undefined;
    if (context.reservationId) {
      reservation = await readReservation(client, orgId, context.reservationId);
    } else {
      reservation = (await client.query<Reservation>('SELECT id, minutes, call_id, state, created_at FROM usage_reservations WHERE org_id = $1 AND call_id = $2 FOR UPDATE', [orgId, context.callId])).rows[0];
    }
    const startedAt = context.startedAt ?? (reservation ? new Date(reservation.created_at).getTime() : NaN);
    if (!Number.isFinite(startedAt) || startedAt < activated) throw new Error('USAGE_LEGACY_CALL_REQUIRES_REVIEW');
    if (reservation?.call_id && reservation.call_id !== context.callId) throw new Error('USAGE_RESERVATION_CALL_MISMATCH');
    if (reservation?.state === 'settled') throw new Error('USAGE_RESERVATION_ALREADY_SETTLED');
    if (reservation) {
      await releaseHold(client, org, reservation);
      await client.query("UPDATE usage_reservations SET call_id = $2, state = 'settled', finished_at = now() WHERE id = $1", [reservation.id, context.callId]);
    }
    const previous = Number(org.minutes_used);
    const total = Math.round((previous + actualMinutes) * 100) / 100;
    const limit = Number(org.minutes_limit);
    const overage = Math.round((Math.max(0, total - limit) - Math.max(0, previous - limit)) * 100) / 100;
    await client.query('UPDATE orgs SET minutes_used = $2 WHERE id = $1', [orgId, total]);
    await client.query(
      'INSERT INTO usage_settlements (org_id, call_id, reservation_id, actual_minutes, overage_minutes) VALUES ($1, $2, $3, $4, $5)',
      [orgId, context.callId, reservation?.id ?? null, actualMinutes, overage],
    );
    await queueInvoice(client, org, context.callId, 'overage', overage, getOverchargeRate(org.plan));
    if (context.agentId && actualMinutes > 0) {
      const voice = await client.query(
        `SELECT data->>'voice' AS voice_id FROM agent_configs WHERE org_id = $1
         AND (data->>'retellAgentId' = $2 OR data->>'retellCallbackAgentId' = $2) LIMIT 1`,
        [orgId, context.agentId],
      );
      const voiceId = voice.rows[0]?.voice_id as string | undefined;
      if (voiceId) await queueInvoice(client, org, context.callId, 'premium_voice', actualMinutes, getVoiceSurcharge(voiceId), voiceId);
    }
    return { ...org, minutes_used: total };
  });
  if (settled) await sendUsageWarning(orgId, settled).catch(() => {
    process.stderr.write('[usage] warning notification failed after settlement\n');
  });
}

async function sendUsageWarning(orgId: string, org: OrgUsage): Promise<void> {
  const limit = Number(org.minutes_limit);
  if (limit <= 0) return;
  const percent = Math.round(Number(org.minutes_used) / limit * 100);
  if (percent < 80) return;
  const { redis } = await import('./redis.js');
  if (!redis?.isOpen) return;
  // Highest reached threshold first. Warning failures do not undo settlement.
  const threshold = percent >= 100 ? 100 : 80;
  const claimed = await redis.set(`usage_warn:${orgId}:${threshold}`, '1', { NX: true, EX: 30 * 24 * 3600 }).catch(() => null);
  if (!claimed || !pool) return;
  const result = await pool.query("SELECT email FROM users WHERE org_id = $1 AND role = 'owner' AND is_active = true LIMIT 1", [orgId]);
  const email = result.rows[0]?.email as string | undefined;
  if (email) {
    const { sendUsageWarningEmail } = await import('./email.js');
    await sendUsageWarningEmail({ toEmail: email, orgName: org.name ?? 'Phonbot', minutesUsed: Number(org.minutes_used), minutesLimit: limit, percent }).catch(() => {});
  }
}

/** Read-only UI hint; only tryReserveMinutes authorizes capacity atomically. */
export async function checkUsageLimit(orgId: string): Promise<UsageReservation> {
  if (!pool) return { allowed: false, minutesUsed: 0, minutesLimit: 0 };
  const result = await pool.query<OrgUsage>(`SELECT minutes_used, minutes_reserved, minutes_limit, plan_status, plan FROM orgs WHERE id = $1
    AND EXISTS (SELECT 1 FROM usage_ledger_state WHERE singleton = true AND activated_at IS NOT NULL)`, [orgId]);
  const org = result.rows[0];
  if (!org) return { allowed: false, minutesUsed: 0, minutesLimit: 0 };
  const minutesUsed = occupied(org);
  const minutesLimit = Number(org.minutes_limit);
  return {
    allowed: !(BLOCKED_PLAN_STATUSES as readonly string[]).includes(org.plan_status)
      && (minutesUsed < minutesLimit || getOverchargeRate(org.plan) > 0),
    minutesUsed, minutesLimit,
  };
}
