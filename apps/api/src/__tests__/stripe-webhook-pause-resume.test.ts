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
  type: 'customer.subscription.paused' | 'customer.subscription.resumed' | 'customer.subscription.deleted',
  opts: { id?: string; customerId?: string | null; metadataOrgId?: string | null } = {},
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
        items: { data: [{ price: { id: 'price_test' }, plan: { interval: 'month' } }] },
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
});
