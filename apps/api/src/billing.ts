import crypto from 'node:crypto';
import Stripe from 'stripe';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import type { JwtPayload } from './auth.js';
import { materializePendingFromSession } from './auth.js';
import { autoProvisionGermanNumber } from './phone.js';
import { sendPlanActivatedEmail, sendPaymentFailedEmail } from './email.js';
import { log } from './logger.js';

// ── Stripe client ─────────────────────────────────────────────────────────────

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY ?? '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

export const stripe = STRIPE_SECRET
  ? new Stripe(STRIPE_SECRET)
  : null;

// ── Plan definitions ──────────────────────────────────────────────────────────

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    minutesLimit: 30,
    agentsLimit: 1,
    phoneNumbersLimit: 0,
    overchargePerMinute: 0,
    stripePriceId: null,
    stripePriceIdYearly: null,
  },
  nummer: {
    id: 'nummer',
    name: 'Nummer',
    price: 8.99,
    minutesLimit: 70,
    agentsLimit: 1,
    phoneNumbersLimit: 1,
    overchargePerMinute: 0.22,
    stripePriceId: process.env.STRIPE_PRICE_NUMMER ?? null,
    stripePriceIdYearly: process.env.STRIPE_PRICE_NUMMER_YEARLY ?? null,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 79,
    minutesLimit: 360,
    agentsLimit: 1,
    phoneNumbersLimit: 1,
    overchargePerMinute: 0.22,
    stripePriceId: process.env.STRIPE_PRICE_STARTER ?? null,
    stripePriceIdYearly: process.env.STRIPE_PRICE_STARTER_YEARLY ?? null,
  },
  pro: {
    id: 'pro',
    name: 'Professional',
    price: 179,
    minutesLimit: 1000,
    agentsLimit: 3,
    phoneNumbersLimit: 3,
    overchargePerMinute: 0.20,
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
    stripePriceIdYearly: process.env.STRIPE_PRICE_PRO_YEARLY ?? null,
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    price: 349,
    minutesLimit: 2400,
    agentsLimit: 10,
    phoneNumbersLimit: 10,
    overchargePerMinute: 0.15,
    stripePriceId: process.env.STRIPE_PRICE_AGENCY ?? null,
    stripePriceIdYearly: process.env.STRIPE_PRICE_AGENCY_YEARLY ?? null,
  },
} as const;

export type PlanId = keyof typeof PLANS;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrCreateStripeCustomer(orgId: string, email: string, orgName: string): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured');
  if (!pool) throw new Error('Database not configured');

  // Fast path: already bound to a Stripe Customer.
  const fast = await pool.query('SELECT stripe_customer_id FROM orgs WHERE id = $1', [orgId]);
  const existing = fast.rows[0]?.stripe_customer_id as string | null;
  if (existing) return existing;

  // Slow path with transaction + row lock to prevent TOCTOU:
  // parallel checkouts for the same org would otherwise each see NULL,
  // each call stripe.customers.create, and the second UPDATE would
  // orphan the first Customer (still billable, never referenced).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT stripe_customer_id FROM orgs WHERE id = $1 FOR UPDATE',
      [orgId],
    );
    const stillExisting = locked.rows[0]?.stripe_customer_id as string | null;
    if (stillExisting) {
      await client.query('COMMIT');
      return stillExisting;
    }

    const customer = await stripe.customers.create({
      email,
      name: orgName,
      metadata: { orgId },
    });

    await client.query(
      'UPDATE orgs SET stripe_customer_id = $1 WHERE id = $2',
      [customer.id, orgId],
    );
    await client.query('COMMIT');
    return customer.id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {/* already rolled back */});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Create a Stripe invoice item for overage minutes. Called from reconcileMinutes
 * when a call pushes minutes_used past minutes_limit. The item lands on the
 * customer's next invoice automatically.
 *
 * Only charges the NEW overage from this specific reconciliation, not the total.
 *
 * Reliability:
 *   - idempotencyKey is mandatory under the hood; if the caller doesn't supply
 *     a stable one (overageKey, usually built from callId), we generate a UUID
 *     fallback so two invocations within a single process never accidentally
 *     create two invoice items for one call.
 *   - On Stripe failure: ONE silent retry after 2s, then persist into
 *     failed_invoice_items with the same idempotency_key so the cron can
 *     retry it later without risking a double-charge.
 *   - Success and failure both log structured Pino events (visible to Sentry)
 *     so money-loss never goes silent.
 */
export async function chargeOverageMinutes(
  orgId: string,
  overageMinutes: number,
  ratePerMinute: number,
  overageKey?: string,
): Promise<void> {
  if (!stripe || !pool || overageMinutes <= 0 || ratePerMinute <= 0) return;

  const res = await pool.query(
    `SELECT stripe_customer_id, plan, name FROM orgs WHERE id = $1`,
    [orgId],
  );
  const row = res.rows[0];
  if (!row?.stripe_customer_id) return; // free plan or no Stripe customer

  const amountCents = Math.round(overageMinutes * ratePerMinute * 100);
  if (amountCents <= 0) return;

  const description = `${overageMinutes} Min Überschreitung (${ratePerMinute.toFixed(2)} €/Min)`;
  const metadata = { orgId, overageMinutes: String(overageMinutes), plan: row.plan as string };
  const idempotencyKey = overageKey ?? `overage:${orgId}:${crypto.randomUUID()}`;

  await chargeWithRetryAndPersist({
    customer: row.stripe_customer_id as string,
    amountCents,
    description,
    metadata,
    idempotencyKey,
    kind: 'overage',
    orgId,
  });
}

/**
 * Premium-voice surcharge. Applied on every minute of a call when the agent
 * uses a voice flagged with `surchargePerMinute > 0` in voice-catalog.ts
 * (e.g. the ElevenLabs Chipy clone: €0.05/min). Unlike overage, this charges
 * ALL call minutes — not just the ones past the plan quota — because the
 * higher TTS cost applies per minute regardless of plan.
 *
 * Lands on the customer's next Stripe invoice as a separate line item so
 * the billing is transparent. Same retry+persist semantics as
 * chargeOverageMinutes — see chargeWithRetryAndPersist for details.
 */
export async function chargePremiumVoiceMinutes(
  orgId: string,
  minutes: number,
  surchargePerMinute: number,
  voiceName?: string,
  surchargeKey?: string,
): Promise<void> {
  if (!stripe || !pool || minutes <= 0 || surchargePerMinute <= 0) return;

  const res = await pool.query(
    `SELECT stripe_customer_id, name FROM orgs WHERE id = $1`,
    [orgId],
  );
  const row = res.rows[0];
  if (!row?.stripe_customer_id) return; // free plan or not yet in Stripe

  const amountCents = Math.round(minutes * surchargePerMinute * 100);
  if (amountCents <= 0) return;

  const description = `${minutes.toFixed(2)} Min Premium-Stimme${voiceName ? ` "${voiceName}"` : ''} (+${surchargePerMinute.toFixed(2)} €/Min)`;
  const metadata = { orgId, premiumMinutes: String(minutes), surcharge: String(surchargePerMinute) };
  const idempotencyKey = surchargeKey ?? `premium:${orgId}:${crypto.randomUUID()}`;

  await chargeWithRetryAndPersist({
    customer: row.stripe_customer_id as string,
    amountCents,
    description,
    metadata,
    idempotencyKey,
    kind: 'premium_voice',
    orgId,
  });
}

// ── Retry-and-persist core (used by both charge functions) ────────────────────

interface ChargeAttempt {
  customer: string;
  amountCents: number;
  description: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
  kind: 'overage' | 'premium_voice';
  orgId: string;
}

/**
 * Try to create the Stripe invoice item once, retry exactly once after a
 * 2-second pause if it fails, and on permanent failure persist the attempt
 * into failed_invoice_items so the cron can pick it up later.
 *
 * The same idempotencyKey threads through all paths (initial call → retry →
 * cron retry) so Stripe will refuse to create a duplicate even in pathological
 * race conditions where two retries land at the same instant.
 *
 * Returns when (a) Stripe accepted the item, or (b) the failure is parked
 * in the queue. Never throws — money loss must be loud, not crashy.
 */
async function chargeWithRetryAndPersist(attempt: ChargeAttempt): Promise<void> {
  if (!stripe) return;

  const params: Stripe.InvoiceItemCreateParams = {
    customer: attempt.customer,
    amount: attempt.amountCents,
    currency: 'eur',
    description: attempt.description,
    metadata: attempt.metadata,
  };
  const opts: Stripe.RequestOptions = { idempotencyKey: attempt.idempotencyKey };

  // Attempt 1
  try {
    await stripe.invoiceItems.create(params, opts);
    log.info(
      { orgId: attempt.orgId, kind: attempt.kind, amountCents: attempt.amountCents, idempotencyKey: attempt.idempotencyKey },
      'stripe invoice item created',
    );
    return;
  } catch (err1) {
    log.warn(
      { err: (err1 as Error).message, orgId: attempt.orgId, kind: attempt.kind, idempotencyKey: attempt.idempotencyKey },
      'stripe invoice item attempt 1 failed — retrying in 2s',
    );
  }

  await new Promise((r) => setTimeout(r, 2000));

  // Attempt 2 (same idempotencyKey — Stripe dedups if attempt 1 actually succeeded server-side)
  try {
    await stripe.invoiceItems.create(params, opts);
    log.info(
      { orgId: attempt.orgId, kind: attempt.kind, amountCents: attempt.amountCents, idempotencyKey: attempt.idempotencyKey },
      'stripe invoice item created on retry',
    );
    return;
  } catch (err2) {
    // Park the attempt in the dead-letter queue so a cron job can retry it
    // without forgetting. Same idempotencyKey ensures Stripe will not create
    // a duplicate even if the previous attempts actually went through.
    const errMsg = (err2 as Error).message;
    log.error(
      { err: errMsg, orgId: attempt.orgId, kind: attempt.kind, amountCents: attempt.amountCents, idempotencyKey: attempt.idempotencyKey },
      'stripe invoice item failed twice — parking in failed_invoice_items for cron retry',
    );
    if (!pool) return;
    await pool.query(
      `INSERT INTO failed_invoice_items (org_id, kind, amount_cents, currency, description, idempotency_key, metadata, last_error, retry_count, last_retry_at)
       VALUES ($1, $2, $3, 'eur', $4, $5, $6, $7, 2, now())
       ON CONFLICT (idempotency_key) DO UPDATE
         SET last_error = EXCLUDED.last_error,
             last_retry_at = now(),
             retry_count = failed_invoice_items.retry_count + 1`,
      [
        attempt.orgId,
        attempt.kind,
        attempt.amountCents,
        attempt.description,
        attempt.idempotencyKey,
        JSON.stringify(attempt.metadata),
        errMsg,
      ],
    ).catch((dbErr: Error) =>
      // Even the persistence failed — last-resort log so it shows up in Sentry
      log.error(
        { err: dbErr.message, orgId: attempt.orgId, kind: attempt.kind, amountCents: attempt.amountCents, idempotencyKey: attempt.idempotencyKey },
        'failed_invoice_items persistence failed — manual intervention required',
      ),
    );
  }
}

/**
 * Cron-triggered retry of items parked in failed_invoice_items.
 * Walks the pending rows oldest-first, caps retries at 5 per item, marks
 * succeeded_at on success. Same idempotencyKey is reused so a successful
 * older retry that we missed will dedup.
 */
export async function retryFailedInvoiceItems(): Promise<void> {
  if (!stripe || !pool) return;

  const res = await pool.query(
    `SELECT id, org_id, kind, amount_cents, currency, description, idempotency_key, metadata
     FROM failed_invoice_items
     WHERE succeeded_at IS NULL AND retry_count < 5
     ORDER BY created_at ASC
     LIMIT 20`,
  );

  for (const row of res.rows) {
    const customerRes = await pool.query(
      `SELECT stripe_customer_id FROM orgs WHERE id = $1`,
      [row.org_id],
    );
    const customer = customerRes.rows[0]?.stripe_customer_id as string | null;
    if (!customer) {
      // Org gone or never had a customer — mark as succeeded so we stop trying
      await pool.query(
        `UPDATE failed_invoice_items SET succeeded_at = now(), last_error = 'org_or_customer_gone' WHERE id = $1`,
        [row.id],
      ).catch(() => {});
      continue;
    }
    const metadata = (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) ?? {};
    try {
      await stripe.invoiceItems.create(
        {
          customer,
          amount: row.amount_cents as number,
          currency: (row.currency as string) ?? 'eur',
          description: (row.description as string) ?? undefined,
          metadata,
        },
        { idempotencyKey: row.idempotency_key as string },
      );
      await pool.query(
        `UPDATE failed_invoice_items SET succeeded_at = now() WHERE id = $1`,
        [row.id],
      );
      log.info(
        { orgId: row.org_id, kind: row.kind, amountCents: row.amount_cents, idempotencyKey: row.idempotency_key, retry: row.retry_count + 1 },
        'failed_invoice_items: retry succeeded',
      );
    } catch (err) {
      const errMsg = (err as Error).message;
      await pool.query(
        `UPDATE failed_invoice_items
           SET retry_count = retry_count + 1,
               last_retry_at = now(),
               last_error = $2
         WHERE id = $1`,
        [row.id, errMsg],
      );
      log.warn(
        { err: errMsg, orgId: row.org_id, kind: row.kind, amountCents: row.amount_cents, idempotencyKey: row.idempotency_key, retry: row.retry_count + 1 },
        'failed_invoice_items: retry failed',
      );
    }
  }
}

/**
 * Audit-Round-15 (M3 from R14 Codex review): resolve a Stripe-Subscription to
 * a Phonbot orgId using a defence-in-depth chain.
 *
 *   1. `stripe_customer_id` → orgs.id  (canonical, persisted at customer-create)
 *   2. `metadata.orgId`                (set at subscription-create, can be edited)
 *   3. `stripe_subscription_id` → orgs.id (last-resort, R16 Codex Plan-Review B4)
 *
 * Step 1 wins on mismatch with step 2 — a dashboard operator can edit
 * subscription metadata, but the customer record is the source of truth, and
 * silently mutating the wrong org's billing state would be a serious incident.
 *
 * Step 3 was added in R16 to handle import-orphan edge cases: subscriptions
 * created out-of-band (Stripe-CLI, support-team, manual-import) where neither
 * the customer-mapping nor metadata was populated, but a previous webhook
 * already persisted `orgs.stripe_subscription_id` via syncSubscription. Without
 * this, a `subscription.deleted` for such a sub silently no-ops.
 *
 * Returns null only if all three resolutions fail — the caller should log +
 * skip rather than guess.
 */
export async function resolveOrgIdFromSubscription(sub: Stripe.Subscription): Promise<string | null> {
  if (!pool) return null;
  const metaOrgId = sub.metadata?.orgId ?? null;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

  // Step 1 — customer mapping wins.
  if (customerId) {
    const mapRes = await pool.query<{ id: string }>(
      `SELECT id FROM orgs WHERE stripe_customer_id = $1 LIMIT 1`,
      [customerId],
    );
    const dbOrgId = mapRes.rows[0]?.id ?? null;
    if (dbOrgId) {
      if (metaOrgId && metaOrgId !== dbOrgId) {
        log.warn(
          { metaOrgId, dbOrgId, customerId, subId: sub.id },
          'billing: metadata.orgId mismatch with stripe_customer_id mapping; trusting DB',
        );
      }
      return dbOrgId;
    }
  }

  // Step 2 — trust metadata.
  if (metaOrgId) return metaOrgId;

  // Step 3 — last-resort: subscription_id mapping (R16 Codex MEDIUM B4).
  if (sub.id) {
    const subRes = await pool.query<{ id: string }>(
      `SELECT id FROM orgs WHERE stripe_subscription_id = $1 LIMIT 1`,
      [sub.id],
    );
    const dbOrgId = subRes.rows[0]?.id ?? null;
    if (dbOrgId) {
      log.warn(
        { subId: sub.id, customerId: customerId ?? null },
        'billing: orgId resolved via subscription_id last-resort fallback (no customer-mapping or metadata.orgId)',
      );
      return dbOrgId;
    }
  }

  return null;
}

// NOTE: Free plan minutes are one-time (no monthly reset).
// Paid plans reset at billing period renewal via syncSubscription.
async function syncSubscription(sub: Stripe.Subscription) {
  // Defence-in-depth: metadata.orgId is trusted (webhook is signed, we set it
  // at subscription creation) but a dashboard operator can edit metadata on a
  // live subscription. Cross-check against the stripe_customer_id → orgId
  // mapping we persisted at customer-create time. If they disagree, prefer
  // the DB and warn — prevents a fat-fingered metadata edit from shifting
  // billing state onto a different org.
  if (!pool) return;
  const metaOrgId = sub.metadata?.orgId;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  let orgId = metaOrgId;
  if (customerId) {
    const mapRes = await pool.query(
      `SELECT id FROM orgs WHERE stripe_customer_id = $1 LIMIT 1`,
      [customerId],
    );
    const dbOrgId = mapRes.rows[0]?.id as string | undefined;
    if (dbOrgId) {
      if (metaOrgId && metaOrgId !== dbOrgId) {
        log.warn({ metaOrgId, dbOrgId, customerId, subId: sub.id }, 'billing: metadata.orgId mismatch with stripe_customer_id mapping; trusting DB');
      }
      orgId = dbOrgId;
    }
  }
  if (!orgId) return;

  const priceId = sub.items.data[0]?.price.id ?? null;
  // Match against both monthly AND yearly price IDs
  const matchedPlan = Object.values(PLANS).find((p) => p.stripePriceId === priceId || p.stripePriceIdYearly === priceId)?.id ?? null;
  const plan = matchedPlan ?? 'free';
  const minutesLimit = PLANS[plan as PlanId]?.minutesLimit ?? 30;
  // Audit-Round-18 (Codex review B2): a non-null price.id that doesn't map to
  // any PLAN was previously a silent free-fallback. R18's downgrade-cap makes
  // that destructive — the fall-through would now also slam minutes_used down
  // to 30. log.warn so a freshly-added Stripe-Price-ID we forgot to wire up
  // surfaces in Sentry instead of quietly capping every active customer's
  // usage. The cap-suppression below uses this flag.
  if (priceId && !matchedPlan) {
    log.warn(
      { subId: sub.id, orgId, priceId },
      'billing: stripe price.id not mapped to any PLAN — falling back to free; minutes_used cap suppressed for safety',
    );
  }
  const planFromUnknownPrice = priceId !== null && matchedPlan === null;

  // Check if this is a period renewal (reset minutes_used).
  // Stripe sends current_period_end as Unix seconds; Postgres stores TIMESTAMPTZ.
  // Comparing via `new Date(oldEnd).getTime() !== cpe*1000` drifts under DST
  // transitions and can mis-fire in both directions (false reset OR missed reset).
  // Compare via EXTRACT(EPOCH) in SQL so both sides are integer Unix seconds.
  const currentPeriodEnd = (sub as unknown as { current_period_end?: number }).current_period_end ?? null;

  // Audit-Round-19 (2026-04-26 audit billing MEDIUM-4 + Codex R18 review D1):
  // wrap the pre-UPDATE SELECT and the UPDATE in a single transaction with
  // `SELECT ... FOR UPDATE` on the orgs row. The previous shape did two
  // separate pool.query calls — webhook + sofort-sync running in parallel
  // could both read the same `oldMinutesLimit` / `period_end_unix`, both
  // make the same branch decision (resetMinutes / downgrade), then both
  // UPDATE. Last-writer-wins meant the *value* converged to the right
  // state in most cases, but the period-end-renewal check can mis-fire
  // when both runs see the OLD period_end → both decide resetMinutes=true →
  // first writes period_end + minutes_used=0 → second wipes minutes_used
  // again even though the user already used minutes during the gap.
  //
  // FOR UPDATE serializes the readers; the second one waits for the first
  // commit, then re-reads the now-fresh period_end (so its
  // `oldEndUnix === currentPeriodEnd` check correctly sees no rollover and
  // skips the reset).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Audit-Round-18 (billing MEDIUM-1): widen pre-UPDATE SELECT to include
    // minutes_limit so we can detect a mid-cycle DOWNGRADE.
    // Audit-Round-19 (billing MEDIUM-4): FOR UPDATE locks the orgs row so
    // a parallel syncSubscription serialises behind us.
    const existing = await client.query<{
      period_end_unix: string | null;
      minutes_limit: number | null;
    }>(
      `SELECT EXTRACT(EPOCH FROM current_period_end)::bigint AS period_end_unix,
              minutes_limit
       FROM orgs WHERE id = $1
       FOR UPDATE`,
      [orgId],
    );

    const oldEndUnix = existing.rows[0]?.period_end_unix;
    const oldMinutesLimit = (existing.rows[0]?.minutes_limit as number | undefined) ?? null;

    let resetMinutes = false;
    // oldEndUnix is null when the org has never had a period set (first subscription).
    // We only reset when we have a previous period AND it's actually different.
    if (currentPeriodEnd && oldEndUnix != null && Number(oldEndUnix) !== currentPeriodEnd) {
      resetMinutes = true; // Period changed = new billing cycle
    }

    // Downgrade-cap: only cap when (a) there's a real previous limit (not first
    // subscription), (b) the new limit is strictly smaller, (c) we are NOT
    // already resetting minutes_used to 0 (a period-rollover wipes the counter
    // anyway), AND (d) the new plan came from a real PLAN match — not from the
    // silent free-fallback for an unknown stripe price.id (Codex R18 B2).
    // Composing the column expression inline keeps the UPDATE atomic.
    const downgrade = oldMinutesLimit !== null && minutesLimit < oldMinutesLimit && !planFromUnknownPrice;
    const minutesUsedExpr = resetMinutes
      ? ',\n      minutes_used = 0'
      : (downgrade ? ',\n      minutes_used = LEAST(minutes_used, $7::int)' : '');

    await client.query(
      `UPDATE orgs SET
        plan = $2,
        plan_status = $3,
        stripe_subscription_id = $4,
        plan_interval = $5,
        current_period_end = to_timestamp($6),
        minutes_limit = $7${minutesUsedExpr}
       WHERE id = $1`,
      [
        orgId,
        plan,
        sub.status,
        sub.id,
        sub.items.data[0]?.plan.interval ?? null,
        currentPeriodEnd,
        minutesLimit,
      ],
    );

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function registerBilling(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] };

  // GET /billing/plans — public, no auth
  app.get('/billing/plans', async () => {
    return {
      plans: Object.values(PLANS).map(({ id, name, price, minutesLimit, agentsLimit, stripePriceIdYearly }) => ({
        id, name, price, minutesLimit, agentsLimit,
        hasYearly: stripePriceIdYearly !== null,
      })),
    };
  });

  // GET /billing/status — current org billing state
  app.get('/billing/status', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });

    const res = await pool.query(
      `SELECT plan, plan_status, plan_interval, current_period_end, minutes_used, minutes_limit
       FROM orgs WHERE id = $1`,
      [orgId],
    );
    if (!res.rows[0]) return reply.status(404).send({ error: 'Org not found' });

    const row = res.rows[0];
    const planDef = PLANS[row.plan as PlanId] ?? PLANS.free;

    return {
      plan: row.plan,
      planName: planDef.name,
      planStatus: row.plan_status,
      planInterval: row.plan_interval,
      currentPeriodEnd: row.current_period_end,
      minutesUsed: row.minutes_used,
      minutesLimit: row.minutes_limit,
      minutesRemaining: Math.max(0, row.minutes_limit - row.minutes_used),
      // Overage price (€/min) from the plan definition — single source
      // of truth so the builder doesn't need a hardcoded table.
      overchargePerMinute: planDef.overchargePerMinute,
    };
  });

  // POST /billing/checkout — create Stripe Checkout Session
  app.post('/billing/checkout', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId, userId } = req.user as JwtPayload;
    if (!stripe || !pool) return reply.status(503).send({ error: 'Stripe not configured' });

    const parsed = z.object({
      planId: z.enum(['nummer', 'starter', 'pro', 'agency']).default('nummer'),
      interval: z.enum(['month', 'year']).default('month'),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid plan selection' });
    const { planId, interval } = parsed.data;
    const plan = PLANS[planId];

    const priceId = interval === 'year' ? plan.stripePriceIdYearly : plan.stripePriceId;
    if (!priceId) {
      return reply.status(400).send({
        error: interval === 'year'
          ? 'Yearly price not configured for this plan (set STRIPE_PRICE_*_YEARLY)'
          : 'Stripe price not configured for this plan',
      });
    }

    const userRes = await pool.query(
      'SELECT u.email, o.name FROM users u JOIN orgs o ON o.id = u.org_id WHERE u.id = $1',
      [userId],
    );
    if (!userRes.rows[0]) return reply.status(404).send({ error: 'User not found' });
    const { email, name } = userRes.rows[0];

    const customerId = await getOrCreateStripeCustomer(orgId, email, name);
    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

    // Professional plan-change flow: if the customer already has an active
    // (or trialing / past_due) subscription, update it in-place via
    // stripe.subscriptions.update with proration_behavior='create_prorations'.
    // Stripe then credits the unused time of the old plan and charges the
    // new plan pro-rata. Without this, every upgrade would open a SECOND
    // Checkout session → two parallel subscriptions → double-billing until
    // the old one is manually canceled.
    const existing = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10,
    });
    const activeSub = existing.data.find((s) =>
      ['active', 'trialing', 'past_due'].includes(s.status),
    );

    if (activeSub) {
      const itemId = activeSub.items.data[0]?.id;
      if (!itemId) {
        return reply.status(500).send({ error: 'Existing subscription has no items — contact support' });
      }
      const currentPriceId = activeSub.items.data[0]?.price?.id;
      if (currentPriceId === priceId) {
        // No-op: user picked their current plan. Redirect back with a note.
        return { url: `${appUrl}/billing?success=1&noop=1` };
      }
      const updated = await stripe.subscriptions.update(activeSub.id, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: 'create_prorations',
        metadata: { orgId },
      });
      // Sync to DB immediately using the response we already have. Without this,
      // customer.subscription.updated lands ~500ms–2s later and the user sees
      // the stale plan on /billing/status right after redirect. The async
      // webhook is still fine as a consistency backstop — syncSubscription is
      // idempotent and will no-op if the state already matches.
      try {
        await syncSubscription(updated);
      } catch (err) {
        req.log.warn({ err: (err as Error).message, orgId, subId: updated.id }, 'post-update syncSubscription failed; relying on webhook');
      }
      return { url: `${appUrl}/billing?success=1&changed=1` };
    }

    // First-time subscription — open Stripe Checkout for card capture.
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { orgId } },
      success_url: `${appUrl}/billing?success=1`,
      cancel_url: `${appUrl}/billing?canceled=1`,
      allow_promotion_codes: true,
      // VAT-ID Collection: B2B-EU reverse-charge support.
      tax_id_collection: { enabled: true },
      // Stripe Tax — guard so billing keeps working until the Stripe Tax
      // dashboard side (DE registration + product tax codes) is configured.
      // Flip STRIPE_AUTOMATIC_TAX=1 once Stripe Tax is live.
      ...(process.env.STRIPE_AUTOMATIC_TAX === '1'
        ? { automatic_tax: { enabled: true } }
        : {}),
    });

    return { url: session.url };
  });

  // POST /billing/portal — Stripe Customer Portal (manage/cancel)
  app.post('/billing/portal', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!stripe || !pool) return reply.status(503).send({ error: 'Stripe not configured' });

    const res = await pool.query('SELECT stripe_customer_id FROM orgs WHERE id = $1', [orgId]);
    const customerId = res.rows[0]?.stripe_customer_id as string | null;
    if (!customerId) return reply.status(400).send({ error: 'No billing account found' });

    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/billing`,
    });

    return { url: session.url };
  });

  // POST /billing/webhook — Stripe events (no auth, signature check instead)
  // Raw body is captured via a custom content-type parser registered in index.ts
  app.post('/billing/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!stripe) return reply.status(503).send({ error: 'Stripe not configured' });

    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

    try {
      // req.body is set to the raw Buffer by the stripe-webhook content-type parser
      const rawBody = (req as FastifyRequest & { rawBody?: Buffer | string }).rawBody ?? '';
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch {
      return reply.status(400).send({ error: 'Invalid signature' });
    }

    // Idempotency: Stripe retries on any non-2xx or timeout. Without dedup, a
    // retried invoice.paid would re-reset the billing period; a retried
    // subscription.deleted would re-cascade cleanup. INSERT with ON CONFLICT
    // DO NOTHING atomically claims the event — if no RETURNING row, we've
    // already processed this event and skip. Respond 200 so Stripe doesn't
    // retry further.
    if (pool) {
      try {
        const claim = await pool.query(
          `INSERT INTO processed_stripe_events (event_id, event_type)
           VALUES ($1, $2)
           ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
          [event.id, event.type],
        );
        if (!claim.rowCount) {
          req.log.info({ eventId: event.id, type: event.type }, 'stripe webhook duplicate — skipping');
          return reply.status(200).send({ ok: true, deduped: true });
        }
      } catch (err) {
        // If dedup fails (e.g. table missing on first migrate), fall through and
        // process the event once — better at-least-once than failing webhooks.
        req.log.warn({ err: (err as Error).message }, 'stripe webhook dedup check failed, processing anyway');
      }
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        // Stripe-first registration flow: the user paid via /auth/checkout-start
        // and the pending_registrations row hasn't been materialized yet. Do it
        // now so the user+org exist before customer.subscription.created runs
        // (which relies on o.stripe_customer_id to find the org).
        const session = event.data.object as Stripe.Checkout.Session;
        const pendingId = session.metadata?.pendingRegistrationId;
        if (pendingId) {
          const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
          try {
            const res = await materializePendingFromSession(session.id, customerId);
            req.log.info({ sessionId: session.id, userId: res?.userId ?? null }, 'pending registration materialized via webhook');
          } catch (err) {
            req.log.error({ err: (err as Error).message, sessionId: session.id }, 'materialize pending from webhook failed');
          }
        }
        break;
      }
      case 'customer.subscription.created': {
        const newSub = event.data.object as Stripe.Subscription;
        await syncSubscription(newSub);
        // Auto-provision a German phone number for new paying customers.
        // Stripe-first checkouts (no orgId in metadata) still get provisioned:
        // resolveOrgIdFromSubscription handles both paths (metadata-first +
        // stripe_customer_id fallback). Audit-Round-15: previously inlined
        // here with a slightly different shape; consolidating onto the helper
        // so future Stripe-event branches share one resolution path.
        const newOrgId = await resolveOrgIdFromSubscription(newSub);
        if (newOrgId && newSub.status === 'active') {
          autoProvisionGermanNumber(newOrgId).catch((err: unknown) => {
            req.log.warn({ err: (err as Error).message, orgId: newOrgId }, 'auto-provision phone after subscription.created failed');
          });
          if (pool) {
            pool.query(`SELECT u.email, o.name, o.plan, o.minutes_limit FROM users u JOIN orgs o ON o.id = u.org_id WHERE u.org_id = $1 AND u.role = 'owner' LIMIT 1`, [newOrgId])
              .then(res => {
                const r = res.rows[0];
                if (r?.email) sendPlanActivatedEmail({ toEmail: r.email, orgName: r.name ?? 'Phonbot', planName: r.plan ?? 'Starter', minutesLimit: r.minutes_limit ?? 500 })
                  .catch((e: unknown) => req.log.warn({ err: (e as Error).message }, 'plan-activated email send failed'));
              }).catch((e: unknown) => req.log.warn({ err: (e as Error).message, orgId: newOrgId }, 'plan-activated owner lookup failed'));
          }
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscription(sub);
        // On subscription.deleted: re-entry to free plan. syncSubscription
        // sets plan=free + minutes_limit=30 (or whatever current free is) but
        // does NOT touch minutes_used. A user who burned 350 min on Starter
        // would otherwise come back to free with minutes_used > minutes_limit
        // and be unable to test their own agent. Cap to the new limit so a
        // returning user can at least keep using whatever's left of their
        // free allowance — without giving them a fresh refill.
        if (event.type === 'customer.subscription.deleted' && pool) {
          // Audit-Round-15 (M3): resolve via stripe_customer_id mapping with
          // metadata fallback, not bare metadata.orgId. A dashboard-edited
          // metadata could otherwise reset the wrong org's minutes.
          const orgId = await resolveOrgIdFromSubscription(sub);
          if (orgId) {
            await pool.query(
              `UPDATE orgs SET minutes_used = LEAST(minutes_used, minutes_limit) WHERE id = $1`,
              [orgId],
            ).catch((err: Error) =>
              log.error({ err: err.message, orgId }, 'billing: free-plan minutes_used reset failed'),
            );
          } else {
            log.warn(
              { subId: sub.id, customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id },
              'billing: subscription.deleted with no resolvable orgId — minutes_used cap skipped',
            );
          }
        }
        break;
      }
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        const sub = event.data.object as Stripe.Subscription;
        // Audit-Round-15 (M3): same resolution path. A pause/resume webhook
        // with edited metadata could otherwise toggle the wrong org's
        // plan_status to 'paused' and lock them out of their dashboard.
        const orgId = await resolveOrgIdFromSubscription(sub);
        if (orgId && pool) {
          const status = event.type === 'customer.subscription.paused' ? 'paused' : 'active';
          await pool.query(
            `UPDATE orgs SET plan_status = $1 WHERE id = $2`,
            [status, orgId],
          );
        } else if (!orgId) {
          log.warn(
            { subId: sub.id, evt: event.type, customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id },
            'billing: subscription pause/resume with no resolvable orgId — plan_status update skipped',
          );
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoiceRaw = event.data.object as unknown as Record<string, unknown>;
        const rawSub = invoiceRaw.subscription;
        const subId = typeof rawSub === 'string'
          ? rawSub
          : (rawSub != null && typeof rawSub === 'object' && 'id' in (rawSub as Record<string, unknown>)) ? ((rawSub as Record<string, unknown>).id as string) : null;
        if (subId && pool) {
          const r = await pool.query(
            `UPDATE orgs SET plan_status = 'past_due' WHERE stripe_subscription_id = $1`,
            [subId],
          );
          if (!r.rowCount) req.log.warn({ subId }, 'invoice.payment_failed: no org matches stripe_subscription_id');
          // Send payment failed email
          const orgRes = await pool.query(
            `SELECT u.email, o.name FROM users u JOIN orgs o ON o.id = u.org_id WHERE o.stripe_subscription_id = $1 AND u.role = 'owner' LIMIT 1`, [subId],
          );
          const owner = orgRes.rows[0];
          if (owner?.email) sendPaymentFailedEmail({ toEmail: owner.email, orgName: owner.name ?? 'Phonbot' })
            .catch((e: unknown) => req.log.warn({ err: (e as Error).message }, 'payment-failed email send failed'));
        }
        break;
      }
    }

    return { received: true };
  });
}
