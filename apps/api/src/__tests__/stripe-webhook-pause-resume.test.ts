/**
 * Stripe webhook pause/resume integration tests — Audit-Round-16 (item 2 from
 * R15 Codex review MEDIUM B5).
 *
 * The previous round added resolveOrgIdFromSubscription() and migrated four
 * webhook branches onto it, but no test exercised the full Fastify-route +
 * signature-verification + branch-dispatch path. Without one, a future
 * refactor could silently drop the resolver call from a branch and only
 * surface the regression in production.
 *
 * Strategy: Codex Plan-Review HIGH D — DO NOT mock `constructEvent`. The
 * security-critical contract is raw-body capture + Stripe signature
 * verification. We sign each test event with the same `STRIPE_WEBHOOK_SECRET`
 * the route uses, so the verification path runs end-to-end.
 *
 * Mocked: pool (driven via vi.fn), Stripe SDK boundaries we don't exercise
 * (subscriptions.retrieve etc), email senders. Not mocked: stripe.webhooks
 * (its constructEvent is the unit under test) — we sign events with
 * `Stripe.webhooks.generateTestHeaderString`.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import Stripe from 'stripe';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: async () => ({
      query: (...args: unknown[]) => mockQuery(...args),
      release: () => {},
    }),
  },
  upsertWebhookHealth: vi.fn(),
}));

const mockWarn = vi.fn();
const mockError = vi.fn();
vi.mock('../logger.js', () => {
  const noop = () => {};
  return {
    log: { info: noop, warn: mockWarn, error: mockError, debug: noop },
    logBg: () => noop,
  };
});

vi.mock('../email.js', () => ({
  sendPlanActivatedEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPaymentFailedEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

// ── Test fixture secret ──────────────────────────────────────────────────

const TEST_WEBHOOK_SECRET = 'whsec_test_for_pause_resume_integration_tests_x';
vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy_for_billing_integration_tests');
vi.stubEnv('STRIPE_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
// Quiet down env-validation warnings during prod-like asserts
vi.stubEnv('NODE_ENV', 'test');
// Audit-Round-18 (Codex C2 fix): real Stripe price-IDs the PLANS lookup will
// match. Without these, the test would fall through to the "free" branch which
// R18's silent-fallback warning + suppression now catches separately.
vi.stubEnv('STRIPE_PRICE_STARTER', 'price_starter_test');
vi.stubEnv('STRIPE_PRICE_PRO', 'price_pro_test');

const { registerBilling } = await import('../billing.js');

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Sign a Stripe-event JSON payload the same way Stripe does, so
 * constructEvent verifies it against TEST_WEBHOOK_SECRET. Avoids mocking the
 * verification path — that would defeat the integration test's purpose.
 */
function signedPayload(event: object): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: TEST_WEBHOOK_SECRET,
  });
  return { rawBody, signature };
}

function makeSubscriptionEvent(
  type:
    | 'customer.subscription.paused'
    | 'customer.subscription.resumed'
    | 'customer.subscription.deleted'
    | 'customer.subscription.updated',
  opts: {
    id?: string;
    customerId?: string | null;
    metadataOrgId?: string | null;
    priceId?: string;
  } = {},
): object {
  const subId = opts.id ?? `sub_test_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    object: 'event',
    type,
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: subId,
        object: 'subscription',
        customer: opts.customerId ?? 'cus_test',
        metadata: opts.metadataOrgId === null ? {} : { orgId: opts.metadataOrgId ?? 'org-from-meta' },
        // syncSubscription reads `sub.items.data[0]?.plan.interval` (no second
        // optional-chain) — fixture must include `.plan` or the route crashes.
        // The deleted-test surfaced this; paused/resumed tests hit the same
        // path but happened not to crash because of upstream luck.
        items: { data: [{ price: { id: opts.priceId ?? 'price_test' }, plan: { interval: 'month' } }] },
        status: 'active',
      },
    },
  };
}

async function buildApp() {
  const app = Fastify();
  await app.register(jwt, { secret: 'test-secret-32-chars-minimum!!!' });
  await app.register(cookie, { secret: 'test-secret-32-chars-minimum!!!' });
  app.decorate('authenticate', async () => { /* no-op for these tests */ });
  // Mirror raw-body parser from index.ts:143 — required for signature-verify.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body: Buffer, done) => {
      (_req as FastifyRequest & { rawBody: Buffer }).rawBody = body;
      if (body.length === 0) return done(null, null);
      try {
        done(null, JSON.parse(body.toString()));
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)), undefined);
      }
    },
  );
  await registerBilling(app);
  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Stripe webhook /billing/webhook — pause/resume/deleted route integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    // mockReset() drops both call-history AND the .mockResolvedValueOnce
    // queue. clearAllMocks only does history — leftover queued resolutions
    // from a previous test would silently leak into the next, breaking the
    // dedup test (it would consume a stale "rowCount: 1, id: org-real"
    // queued earlier and skip the deduped branch).
    mockQuery.mockReset();
    mockWarn.mockReset();
    mockError.mockReset();
  });

  it('rejects events with an invalid signature (400)', async () => {
    const ev = makeSubscriptionEvent('customer.subscription.paused');
    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1234567890,v1=deadbeef',
      },
      payload: JSON.stringify(ev),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid signature' });
  });

  it('paused → resolver hit + UPDATE plan_status=paused', async () => {
    mockQuery
      // dedup INSERT (rowCount 1 = first time)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'x' }] })
      // syncSubscription SELECT (mapping)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'org-real' }] })
      // syncSubscription period-end SELECT
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // syncSubscription UPDATE orgs ... main row
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      // resolver SELECT (step 1: customer mapping)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'org-real' }] })
      // route UPDATE plan_status
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const ev = makeSubscriptionEvent('customer.subscription.paused', {
      customerId: 'cus_real',
      metadataOrgId: 'org-real',
    });
    const { rawBody, signature } = signedPayload(ev);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);

    // Find the plan_status UPDATE
    const planStatusCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('plan_status') && (c[0] as string).includes('UPDATE'),
    );
    expect(planStatusCall).toBeDefined();
    const params = planStatusCall![1] as unknown[];
    expect(params).toContain('paused');
    expect(params).toContain('org-real');
  });

  it('resumed → UPDATE plan_status=active', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'x' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'org-real' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'org-real' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const ev = makeSubscriptionEvent('customer.subscription.resumed', {
      customerId: 'cus_real',
      metadataOrgId: 'org-real',
    });
    const { rawBody, signature } = signedPayload(ev);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const planStatusCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('plan_status') && (c[0] as string).includes('UPDATE'),
    );
    expect(planStatusCall).toBeDefined();
    const params = planStatusCall![1] as unknown[];
    expect(params).toContain('active');
  });

  it('paused with NO resolvable orgId → log.warn + skip plan_status UPDATE', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'x' }] })
      // syncSubscription resolver: customer SELECT miss
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // resolver step 1 (customer): miss
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // resolver step 3 (subscription_id last-resort): miss
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const ev = makeSubscriptionEvent('customer.subscription.paused', {
      customerId: 'cus_orphan',
      metadataOrgId: null,
    });
    const { rawBody, signature } = signedPayload(ev);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);

    // No UPDATE on plan_status should have fired
    const planStatusCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('plan_status') && (c[0] as string).includes('UPDATE'),
    );
    expect(planStatusCall).toBeUndefined();

    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ evt: 'customer.subscription.paused' }),
      expect.stringContaining('plan_status update skipped'),
    );
  });

  it('deleted → resolver hit + minutes_used cap UPDATE (R17 coverage gap)', async () => {
    // Audit-Round-17: R16 covered paused/resumed but not deleted. The
    // deleted-branch is structurally similar (resolver → conditional UPDATE)
    // but mutates orgs.minutes_used = LEAST(minutes_used, minutes_limit) so
    // a returning user isn't locked out of their free plan.
    //
    // Capture any 500 root-cause via a default fallback (unconsumed fixtures
    // would return undefined and crash the route silently).
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'x' }] }) // dedup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'org-real' }] }) // syncSubscription: customer mapping
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // syncSubscription: UPDATE orgs (period-end check skipped — currentPeriodEnd undefined)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'org-real' }] }) // resolver step 1
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // route UPDATE minutes_used cap

    const ev = makeSubscriptionEvent('customer.subscription.deleted', {
      customerId: 'cus_real',
      metadataOrgId: 'org-real',
    });
    const { rawBody, signature } = signedPayload(ev);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const capCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('minutes_used = LEAST'),
    );
    expect(capCall).toBeDefined();
    const params = capCall![1] as unknown[];
    expect(params).toContain('org-real');
  });

  it('deleted with NO resolvable orgId → log.warn + skip cap UPDATE', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'x' }] }) // dedup
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // syncSubscription: customer miss
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // resolver step 1 miss
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // resolver step 3 miss

    const ev = makeSubscriptionEvent('customer.subscription.deleted', {
      customerId: 'cus_orphan',
      metadataOrgId: null,
    });
    const { rawBody, signature } = signedPayload(ev);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const capCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('minutes_used = LEAST'),
    );
    expect(capCall).toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ subId: expect.any(String) }),
      expect.stringContaining('minutes_used cap skipped'),
    );
  });

  it('duplicate event-id → returns 200 deduped without invoking resolver', async () => {
    // dedup INSERT: rowCount 0 → already processed
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const ev = makeSubscriptionEvent('customer.subscription.paused', {
      customerId: 'cus_real',
      metadataOrgId: 'org-real',
    });
    const { rawBody, signature } = signedPayload(ev);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, deduped: true });

    // Only ONE query (the dedup INSERT). Resolver never reached.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  // ── R18: subscription.updated coverage + downgrade-cap (billing MEDIUM-1) ──

  it('updated with downgrade (Pro→Starter) caps minutes_used to new limit', async () => {
    // R18: previously, a user mid-cycle plan-downgrade saw
    // minutes_used > minutes_limit immediately because the syncSubscription
    // UPDATE only set minutes_limit, not minutes_used. Fix: detect
    // newLimit < oldLimit and inline `minutes_used = LEAST(...)` in the
    // same UPDATE — atomic, no separate read-modify-write.
    //
    // Codex C2 cleanup: use an explicit Starter price-ID matched via
    // STRIPE_PRICE_STARTER env stub so the PLANS lookup hits a real plan
    // instead of relying on the unknown-price→free fallback (which R18's B2
    // fix now suppresses). Old limit = 1000 (test value > Starter's 360),
    // new limit = Starter (360) → downgrade detected.
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'x' }] }) // dedup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'org-real' }] }) // syncSubscription resolver SELECT
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ period_end_unix: '1735689600', minutes_limit: 1000 }],
      }) // pre-UPDATE SELECT (R18 widened to include minutes_limit)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE orgs

    const ev = makeSubscriptionEvent('customer.subscription.updated', {
      customerId: 'cus_real',
      metadataOrgId: 'org-real',
      priceId: 'price_starter_test', // matches STRIPE_PRICE_STARTER stub above
    });
    const { rawBody, signature } = signedPayload(ev);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);

    const updateCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('UPDATE orgs SET') &&
        (c[0] as string).includes('plan = $2'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0] as string).toContain('LEAST(minutes_used');
    // Bind-check (Codex C1): $7 is the new minutes_limit, here Starter = 360.
    const params = updateCall![1] as unknown[];
    expect(params[1]).toBe('starter'); // $2 plan
    expect(params[6]).toBe(360); // $7 minutes_limit (Starter default)
  });

  it('updated with UNKNOWN price.id → free-fallback BUT cap suppressed (R18 B2 safety)', async () => {
    // Codex Round-18 B2: a non-null price.id that doesn't map to any PLAN
    // used to silently fall through to 'free' (minutesLimit=30). With R18's
    // downgrade-cap, that would slam every active customer's minutes_used
    // down to 30. The B2 fix logs a warning AND suppresses the LEAST-cap
    // when matchedPlan is null — so the user keeps their minutes until ops
    // wires the new Stripe-Price-ID into PLANS.
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'x' }] }) // dedup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'org-real' }] }) // resolver
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ period_end_unix: '1735689600', minutes_limit: 360 }],
      }) // pre-UPDATE: Starter limit (360 > 30 free → would normally downgrade)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE orgs

    const ev = makeSubscriptionEvent('customer.subscription.updated', {
      customerId: 'cus_real',
      metadataOrgId: 'org-real',
      priceId: 'price_unknown_test', // NOT in PLANS — triggers free-fallback
    });
    const { rawBody, signature } = signedPayload(ev);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);

    const updateCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('UPDATE orgs SET') &&
        (c[0] as string).includes('plan = $2'),
    );
    expect(updateCall).toBeDefined();
    // CAP MUST BE SUPPRESSED — even though new (30) < old (360).
    expect(updateCall![0] as string).not.toContain('LEAST(minutes_used');
    // Warning was logged so ops can fix the missing PRICE-ID mapping.
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: 'price_unknown_test' }),
      expect.stringContaining('not mapped to any PLAN'),
    );
  });

  it('updated WITHOUT downgrade (same/upgrade) does NOT include LEAST cap', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'x' }] }) // dedup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'org-real' }] }) // resolver
      // Pre-UPDATE SELECT: old limit was 30 (free), new will also be 30 → no downgrade.
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ period_end_unix: '1735689600', minutes_limit: 30 }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE orgs

    const ev = makeSubscriptionEvent('customer.subscription.updated', {
      customerId: 'cus_real',
      metadataOrgId: 'org-real',
    });
    const { rawBody, signature } = signedPayload(ev);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);

    const updateCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('UPDATE orgs SET') &&
        (c[0] as string).includes('plan = $2'),
    );
    expect(updateCall).toBeDefined();
    // Same-or-upgrade: no LEAST cap, no minutes_used reset.
    expect(updateCall![0] as string).not.toContain('LEAST(minutes_used');
    expect(updateCall![0] as string).not.toContain('minutes_used = 0');
  });

  it('updated with first-subscription (oldLimit=null) does NOT cap', async () => {
    // First-subscription path: pre-UPDATE SELECT returns null period+limit
    // because the org has never had any subscription before. The downgrade
    // check requires oldLimit !== null, so no LEAST cap applies.
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'x' }] }) // dedup
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'org-real' }] }) // resolver
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ period_end_unix: null, minutes_limit: null }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // UPDATE orgs

    const ev = makeSubscriptionEvent('customer.subscription.updated', {
      customerId: 'cus_real',
      metadataOrgId: 'org-real',
    });
    const { rawBody, signature } = signedPayload(ev);

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const updateCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('UPDATE orgs SET') &&
        (c[0] as string).includes('plan = $2'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0] as string).not.toContain('LEAST(minutes_used');
  });
});
