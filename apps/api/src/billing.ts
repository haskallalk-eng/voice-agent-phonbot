import Stripe from 'stripe';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import type { JwtPayload } from './auth.js';
import { autoProvisionGermanNumber } from './phone.js';
import { sendPlanActivatedEmail, sendPaymentFailedEmail } from './email.js';

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

  const res = await pool.query('SELECT stripe_customer_id FROM orgs WHERE id = $1', [orgId]);
  const existing = res.rows[0]?.stripe_customer_id as string | null;
  if (existing) return existing;

  const customer = await stripe.customers.create({
    email,
    name: orgName,
    metadata: { orgId },
  });

  await pool!.query('UPDATE orgs SET stripe_customer_id = $1 WHERE id = $2', [customer.id, orgId]);
  return customer.id;
}

/**
 * Create a Stripe invoice item for overage minutes. Called from reconcileMinutes
 * when a call pushes minutes_used past minutes_limit. The item lands on the
 * customer's next invoice automatically.
 *
 * Only charges the NEW overage from this specific reconciliation, not the total.
 */
export async function chargeOverageMinutes(
  orgId: string,
  overageMinutes: number,
  ratePerMinute: number,
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

  try {
    await stripe.invoiceItems.create({
      customer: row.stripe_customer_id as string,
      amount: amountCents,
      currency: 'eur',
      description: `${overageMinutes} Min Überschreitung (${ratePerMinute.toFixed(2)} €/Min)`,
      metadata: { orgId, overageMinutes: String(overageMinutes), plan: row.plan as string },
    });
  } catch (err) {
    process.stderr.write(`[billing] overage invoice item failed for org=${orgId}: ${(err as Error).message}\n`);
  }
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
        process.stderr.write(`[billing] metadata.orgId=${metaOrgId} mismatch with stripe_customer_id→orgId=${dbOrgId}; trusting DB mapping\n`);
      }
      orgId = dbOrgId;
    }
  }
  if (!orgId) return;

  const priceId = sub.items.data[0]?.price.id ?? null;
  // Match against both monthly AND yearly price IDs
  const plan = Object.values(PLANS).find((p) => p.stripePriceId === priceId || p.stripePriceIdYearly === priceId)?.id ?? 'free';
  const minutesLimit = PLANS[plan as PlanId]?.minutesLimit ?? 30;

  // Check if this is a period renewal (reset minutes_used)
  const currentPeriodEnd = (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
  let resetMinutes = false;
  if (currentPeriodEnd && pool) {
    const existing = await pool.query(`SELECT current_period_end FROM orgs WHERE id = $1`, [orgId]);
    const oldEnd = existing.rows[0]?.current_period_end;
    if (oldEnd && new Date(oldEnd).getTime() !== currentPeriodEnd * 1000) {
      resetMinutes = true; // Period changed = new billing cycle
    }
  }

  await pool.query(
    `UPDATE orgs SET
      plan = $2,
      plan_status = $3,
      stripe_subscription_id = $4,
      plan_interval = $5,
      current_period_end = to_timestamp($6),
      minutes_limit = $7${resetMinutes ? ',\n      minutes_used = 0' : ''}
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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { orgId } },
      success_url: `${appUrl}/billing?success=1`,
      cancel_url: `${appUrl}/billing?canceled=1`,
      allow_promotion_codes: true,
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
      case 'customer.subscription.created': {
        const newSub = event.data.object as Stripe.Subscription;
        await syncSubscription(newSub);
        // Auto-provision a German phone number for new paying customers
        const newOrgId = newSub.metadata?.orgId;
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
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.orgId;
        if (orgId && pool) {
          const status = event.type === 'customer.subscription.paused' ? 'paused' : 'active';
          await pool.query(
            `UPDATE orgs SET plan_status = $1 WHERE id = $2`,
            [status, orgId],
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
          if (!r.rowCount) console.warn(`[billing] invoice.payment_failed: no org for sub ${subId}`);
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
