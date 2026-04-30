/**
 * Integration test for POST /admin/agents/backfill-industry — Audit-Round-16
 * (item E1 from R15 Codex review).
 *
 * The route was added in R14 and has accreted: admin/aud-gating, curated-key
 * validation, advisory_xact_lock, two-phase write (configs in tx, transcripts
 * batched outside the lock — R16). Unit-testing the resolver was insufficient;
 * this pins the route's contract end-to-end through Fastify inject.
 *
 * Strategy: mock pool with a per-call queue, mock authenticate so we can drive
 * `req.user` directly, sign nothing — just check the auth claim. The advisory
 * lock SQL is observable as a query call, the dedup-INSERT race is not in
 * scope here (covered by E3).
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import Fastify from 'fastify';

// ── Mocks (must run before billing.ts/insights.ts evaluate) ───────────────

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();

vi.mock('../db.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: async () => ({
      query: (...args: unknown[]) => mockClientQuery(...args),
      release: () => mockRelease(),
    }),
  },
  upsertWebhookHealth: vi.fn(),
}));

const mockWarn = vi.fn();
const mockInfo = vi.fn();
vi.mock('../logger.js', () => {
  const noop = () => {};
  return {
    log: { info: mockInfo, warn: mockWarn, error: noop, debug: noop },
    logBg: () => noop,
  };
});

vi.mock('../satisfaction-signals.js', () => ({
  computeSatisfactionScore: vi.fn().mockReturnValue(0),
  extractSignalsFromCall: vi.fn().mockResolvedValue({}),
  storeSatisfactionData: vi.fn(),
}));

vi.mock('../pii.js', () => ({ redactPII: (s: string) => s }));

vi.stubEnv('OPENAI_API_KEY', 'test-key');
vi.stubEnv('NODE_ENV', 'test');

const { registerInsights } = await import('../insights.js');

// ── Fastify test app ──────────────────────────────────────────────────────

type TestUser = { admin?: boolean; aud?: string; email?: string; userId?: string; orgId?: string; role?: string };

async function buildApp(user: TestUser | null = null) {
  const app = Fastify();
  // Stub authenticate: assigns the supplied user (or 401 if null) without
  // running JWT verification. Lets us drive admin-vs-user paths cleanly.
  // Explicit `Promise<void>` return type matches Fastify's onRequest hook
  // signature (.decorate is loosely-typed; the route invokes via
  // `{ onRequest: [app.authenticate] }` which expects a void-Promise hook).
  app.decorate('authenticate', async function (this: unknown, req: any, reply: any): Promise<void> {
    if (!user) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }
    req.user = user;
  });
  await registerInsights(app);
  await app.ready();
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /admin/agents/backfill-industry — route integration', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockRelease.mockReset();
    mockWarn.mockReset();
    mockInfo.mockReset();
  });

  it('rejects non-admin user JWT with 403 (admin claim missing)', async () => {
    const app = await buildApp({
      admin: false,
      aud: 'phonbot:user',
      userId: 'u1',
      orgId: 'org1',
      role: 'owner',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/backfill-industry',
      payload: { tenantId: 'demo', industry: 'hairdresser' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('Platform-admin only');
    // Route never reached the SQL layer.
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('rejects admin JWT without correct aud (phonbot:admin) with 403', async () => {
    // admin: true but aud is wrong — would slip through a naive check.
    const app = await buildApp({
      admin: true,
      aud: 'phonbot:user', // ← wrong audience, regular session token
      email: 'fake@admin.de',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/backfill-industry',
      payload: { tenantId: 'demo', industry: 'hairdresser' },
    });
    expect(res.statusCode).toBe(403);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('rejects industry not in CURATED_INDUSTRY_KEYS with 400', async () => {
    const app = await buildApp({ admin: true, aud: 'phonbot:admin', email: 'a@b.de' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/backfill-industry',
      payload: { tenantId: 'demo', industry: 'spaceship-repair' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INVALID_INDUSTRY');
    expect(Array.isArray(body.validKeys)).toBe(true);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when tenantId does not exist in agent_configs', async () => {
    const app = await buildApp({ admin: true, aud: 'phonbot:admin', email: 'a@b.de' });
    mockClientQuery
      // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // SELECT cfg → empty
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      // ROLLBACK
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/backfill-industry',
      payload: { tenantId: 'ghost', industry: 'hairdresser' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('TENANT_NOT_FOUND');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when tenant already has industry set', async () => {
    const app = await buildApp({ admin: true, aud: 'phonbot:admin', email: 'a@b.de' });
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // lock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ org_id: 'org1', industry: 'restaurant' }] }) // SELECT cfg
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // ROLLBACK

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/backfill-industry',
      payload: { tenantId: 'demo', industry: 'hairdresser' },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('ALREADY_TAGGED');
    expect(body.currentIndustry).toBe('restaurant');
  });

  it('dryRun returns 200 with counts and rolls back without writing', async () => {
    const app = await buildApp({ admin: true, aud: 'phonbot:admin', email: 'a@b.de' });
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // lock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ org_id: 'org1', industry: null }] }) // SELECT cfg
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ cnt: '42' }] }) // SELECT COUNT transcripts
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // ROLLBACK

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/backfill-industry',
      payload: { tenantId: 'demo', industry: 'hairdresser', dryRun: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dryRun).toBe(true);
    expect(body.wouldUpdateTranscripts).toBe(42);
    expect(body.industry).toBe('hairdresser');
    // No UPDATE call should have run on the client (only SELECTs + ROLLBACK).
    const updateCall = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE'),
    );
    expect(updateCall).toBeUndefined();
  });

  it('happy path: applies UPDATE on configs in tx, batches transcripts after', async () => {
    const app = await buildApp({ admin: true, aud: 'phonbot:admin', email: 'a@b.de' });
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // lock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ org_id: 'org1', industry: null }] }) // SELECT cfg
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ cnt: '500' }] }) // COUNT transcripts
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ tenant_id: 'demo' }] }) // UPDATE configs
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // COMMIT

    // Phase 2 runs on `pool.query` (not client). One batch returns 500
    // (less than batch-size 1000) so the loop exits after 1 iteration.
    mockQuery.mockResolvedValueOnce({ rowCount: 500, rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/backfill-industry',
      payload: { tenantId: 'demo', industry: 'hairdresser' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(1);
    expect(body.transcriptsUpdated).toBe(500);
    expect(body.remaining).toBe(0);
    // Phase-1 client released exactly once.
    expect(mockRelease).toHaveBeenCalledTimes(1);
    // Phase-2 batched UPDATE used pool.query, not client.query.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const phase2Sql = mockQuery.mock.calls[0]![0] as string;
    expect(phase2Sql).toContain('UPDATE call_transcripts');
    expect(phase2Sql).toContain('LIMIT $3');
  });

  it('uses pg_advisory_xact_lock with a deterministic key for the tenantId', async () => {
    // Codex Round-16 (E3): the lock is the advisory_xact_lock that serializes
    // concurrent admin calls per-tenant. Without it, two parallel POSTs both
    // pre-pass the 409-gate and both proceed to UPDATE — the conditional
    // WHERE makes only one win on configs, but the loser would falsely report
    // `ok: true, processed: 0` instead of 409. This test pins the lock SQL
    // shape and the deterministic key derivation; an in-process race-test
    // requires a real Postgres which we don't have in CI.
    const app = await buildApp({ admin: true, aud: 'phonbot:admin', email: 'a@b.de' });
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ org_id: 'org1', industry: null }] }) // SELECT cfg
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ cnt: '0' }] }) // COUNT
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ tenant_id: 'demo' }] }) // UPDATE configs
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // COMMIT
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // phase 2 batch (empty)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/backfill-industry',
      payload: { tenantId: 'demo', industry: 'hairdresser' },
    });
    expect(res.statusCode).toBe(200);

    // Find the advisory-lock SELECT and check the key shape.
    const lockCall = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock'),
    );
    expect(lockCall).toBeDefined();
    expect((lockCall![0] as string)).toContain('$1::bigint');
    const lockParam = (lockCall![1] as unknown[])[0];
    // BigInt-as-string, 19 digits or fewer (signed int64 fits in <=20 chars
    // including '-'); deterministic for the same tenantId.
    expect(typeof lockParam).toBe('string');
    expect(/^-?\d+$/.test(lockParam as string)).toBe(true);

    // Re-derive the expected key the same way the route does:
    //   sha1('industry-backfill:<tenantId>').readBigInt64BE(0).toString()
    const crypto = await import('node:crypto');
    const expected = crypto.createHash('sha1')
      .update('industry-backfill:demo')
      .digest()
      .readBigInt64BE(0)
      .toString();
    expect(lockParam).toBe(expected);
  });

  it('serializes concurrent calls: second call sees the first commit and 409s', async () => {
    // Simulate the post-lock state: by the time the SECOND admin call's
    // SELECT runs, the FIRST call has already committed industry='restaurant'.
    // The second call must hit the 409 gate. (Without the lock this race
    // would slip through and write a no-op.)
    const app = await buildApp({ admin: true, aud: 'phonbot:admin', email: 'a@b.de' });
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // pg_advisory_xact_lock (waits then acquires)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ org_id: 'org1', industry: 'restaurant' }] }) // SELECT cfg — first call already wrote
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // ROLLBACK

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/backfill-industry',
      payload: { tenantId: 'demo', industry: 'hairdresser' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).currentIndustry).toBe('restaurant');
    // No UPDATE on configs — second caller correctly skipped.
    const updateCall = mockClientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE agent_configs'),
    );
    expect(updateCall).toBeUndefined();
  });

  it('happy path with NO transcripts to backfill skips the batch loop entirely', async () => {
    const app = await buildApp({ admin: true, aud: 'phonbot:admin', email: 'a@b.de' });
    mockClientQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ org_id: 'org1', industry: null }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ cnt: '0' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ tenant_id: 'demo' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    // Phase 2: first batch returns 0 → loop exits immediately. We still need
    // to queue ONE pool.query response because the route DOES enter the loop
    // and fires the first iteration to learn it's empty.
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/agents/backfill-industry',
      payload: { tenantId: 'demo', industry: 'hairdresser' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.transcriptsUpdated).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1); // exactly one batch attempt
  });
});
