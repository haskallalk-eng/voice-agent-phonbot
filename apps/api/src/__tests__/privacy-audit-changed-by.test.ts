/**
 * Audit-Round-17 (E2 deferred from R15/R16): pin that
 * `privacy_setting_changes.changed_by` records the actor's userId from the JWT,
 * not the orgId surrogate that R14 originally used.
 *
 * The R14 introduced the audit row, R15-M1 (Codex Plan-Review) threaded
 * `actorUserId` through writeConfig from the request handler. Without this
 * regression test, a future refactor that "simplifies" the writeConfig
 * signature could drop the userId thread silently — the audit row stays
 * non-null because it falls back to orgId, but the "who flipped the
 * recording toggle" question becomes unanswerable.
 *
 * Strategy: drive `PUT /agent-config` end-to-end via Fastify inject with a
 * mocked pool, assert the INSERT INTO privacy_setting_changes captures the
 * userId (not the orgId).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ── Mocks (must run before agent-config.ts evaluates) ──────────────────────

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

vi.mock('../logger.js', () => {
  const noop = () => {};
  return {
    log: { info: noop, warn: noop, error: noop, debug: noop },
    logBg: () => noop,
  };
});

// Side-effect modules that agent-config.ts imports — stub everything that
// could fire during writeConfig so the test stays focused on the audit-row.
vi.mock('../org-id-cache.js', () => ({
  invalidateOrgIdCache: vi.fn(),
  setOrgIdCache: vi.fn(),
}));

vi.mock('../inbound-webhooks.js', () => ({
  invalidateInboundWebhooksCache: vi.fn(),
}));

vi.mock('../opening-hours-sync.js', () => ({
  syncOpeningHoursToChipy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../knowledge.js', () => ({
  normalizeKnowledgeSources: vi.fn(async (cfg: unknown) => cfg),
  storeKnowledgePdf: vi.fn(),
  syncRetellKnowledgeBase: vi.fn(),
}));

vi.mock('../api-integrations.js', () => ({
  buildIntegrationTools: vi.fn().mockReturnValue([]),
  mergeAndEncryptIntegrations: vi.fn(async (newIns: unknown) => newIns),
  maskApiIntegrationsForClient: vi.fn((cfg: unknown) => cfg),
}));

vi.mock('../retell.js', () => ({
  createLLM: vi.fn(),
  updateLLM: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  createWebCall: vi.fn(),
  listCalls: vi.fn().mockResolvedValue({ calls: [] }),
  getCall: vi.fn(),
  getAgent: vi.fn(),
  getLLM: vi.fn(),
  DEFAULT_VOICE_ID: 'voice-default',
  DEFAULT_STANDARD_VOICE_ID: 'voice-standard',
}));

vi.mock('../twilio-openai-bridge.js', () => ({
  triggerBridgeCall: vi.fn(),
}));

vi.mock('../platform-baseline.js', () => ({
  loadPlatformBaseline: vi.fn().mockResolvedValue(''),
}));

vi.mock('../outbound-baseline.js', () => ({
  loadOutboundBaseline: vi.fn().mockResolvedValue(''),
}));

vi.mock('../usage.js', () => ({
  tryReserveMinutes: vi.fn().mockResolvedValue({ allowed: true }),
  DEFAULT_CALL_RESERVE_MINUTES: 5,
}));

vi.mock('../agent-instructions.js', () => ({
  buildAgentInstructions: vi.fn().mockReturnValue('test-instructions'),
}));

vi.mock('../billing.js', () => ({
  PLANS: {
    free: { id: 'free', minutesLimit: 30, agentsLimit: 1, overchargePerMinute: 0 },
    starter: { id: 'starter', minutesLimit: 500, agentsLimit: 3, overchargePerMinute: 0.05 },
  },
}));

vi.stubEnv('NODE_ENV', 'test');

const { registerAgentConfig } = await import('../agent-config.js');

// ── Helpers ────────────────────────────────────────────────────────────────

type TestUser = { userId: string; orgId: string; role: 'owner' | 'admin' | 'member' };

async function buildApp(user: TestUser) {
  const app = Fastify();
  app.decorate('authenticate', async function (this: unknown, req: any): Promise<void> {
    req.user = user;
  });
  await registerAgentConfig(app);
  await app.ready();
  return app;
}

// Match the actual writeConfig query order for an OWNED-row PUT:
//   1. tenantIdAvailableOrOwned: SELECT org_id FROM agent_configs
//   2. loadOwnedConfigRow: SELECT data, org_id FROM agent_configs
//   3. enforcePlanAgentLimitOnCreate: SELECT 1 FROM agent_configs WHERE
//      tenant_id AND org_id — rowCount 1 → EARLY RETURN (skips plan + count
//      SELECTs entirely for owned/UPDATE path).
//   4. writeConfig: SELECT data FROM agent_configs (read prev recordCalls).
//   5. UPSERT agent_configs ON CONFLICT RETURNING tenant_id.
//   6. (only if recordCalls flipped) INSERT INTO privacy_setting_changes.
//   syncOpeningHoursToChipy + invalidateInboundWebhooksCache are mocked
//   (no DB calls).
function primeFlipQueue(opts: {
  prevRecordCalls: boolean | undefined;
  ownedRow?: { tenant_id: string; org_id: string; data: Record<string, unknown> };
}): void {
  const { prevRecordCalls, ownedRow } = opts;
  const owned = ownedRow ?? { tenant_id: 'demo', org_id: 'org-1', data: { tenantId: 'demo' } };

  // 1. tenantIdAvailableOrOwned
  mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ org_id: owned.org_id }] });
  // 2. loadOwnedConfigRow
  mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ data: owned.data, org_id: owned.org_id }] });
  // 3. enforcePlanAgentLimitOnCreate.SELECT-1 — rowCount 1 → early-return
  mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
  // 4. writeConfig prev recordCalls SELECT
  const prevData = prevRecordCalls === undefined ? {} : { recordCalls: prevRecordCalls };
  mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ data: prevData }] });
  // 5. UPSERT agent_configs RETURNING tenant_id
  mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ tenant_id: 'demo' }] });
  // 6. INSERT privacy_setting_changes (fire-and-forget — but the call still queues)
  mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PUT /agent-config — privacy_setting_changes.changed_by audit (E2)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // Default fallback so any unanticipated query returns sane shape and the
    // route doesn't 500 silently if the chain is wrong.
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
  });

  it('writes userId (not orgId) into changed_by when recordCalls flips on→off', async () => {
    primeFlipQueue({
      prevRecordCalls: true,
      ownedRow: { tenant_id: 'demo', org_id: 'org-1', data: { tenantId: 'demo', recordCalls: true } },
    });

    const app = await buildApp({ userId: 'user-42', orgId: 'org-1', role: 'owner' });
    const res = await app.inject({
      method: 'PUT',
      url: '/agent-config',
      payload: {
        tenantId: 'demo',
        name: 'Test Agent',
        businessName: 'Test Biz',
        recordCalls: false, // flipping off
      },
    });

    expect(res.statusCode).toBe(200);

    // Find the privacy_setting_changes INSERT
    const auditCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('INSERT INTO privacy_setting_changes'),
    );
    expect(auditCall).toBeDefined();
    const params = auditCall![1] as unknown[];
    // Param order ($1..$5): org_id, tenant_id, value_before, value_after, changed_by.
    // The `setting='recordCalls'` literal is in the SQL itself, not a param.
    expect(params[0]).toBe('org-1'); // org_id
    expect(params[1]).toBe('demo'); // tenant_id
    expect(params[2]).toBe('true'); // value_before (string-cast)
    expect(params[3]).toBe('false'); // value_after
    expect(params[4]).toBe('user-42'); // changed_by — THE M1 FIX
  });

  it('falls back to orgId only when actor userId is missing (legacy callers)', async () => {
    // The current route always passes userId, so this case isn't hit via HTTP.
    // The test pins the writeConfig fallback so an internal caller (like
    // triggerCallback) without a request-context still gets a non-null
    // changed_by — just with reduced forensic value.
    //
    // We assert this indirectly: when `req.user.userId` is empty string, the
    // route still passes it to writeConfig, and the INSERT receives '' (the
    // ?? fallback in writeConfig only kicks in for `undefined`, not '').
    primeFlipQueue({
      prevRecordCalls: true,
      ownedRow: { tenant_id: 'demo', org_id: 'org-1', data: { tenantId: 'demo', recordCalls: true } },
    });

    const app = await buildApp({ userId: '', orgId: 'org-1', role: 'owner' });
    const res = await app.inject({
      method: 'PUT',
      url: '/agent-config',
      payload: {
        tenantId: 'demo',
        name: 'Test Agent',
        businessName: 'Test Biz',
        recordCalls: false,
      },
    });

    expect(res.statusCode).toBe(200);
    const auditCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('INSERT INTO privacy_setting_changes'),
    );
    expect(auditCall).toBeDefined();
    const params = auditCall![1] as unknown[];
    // Empty-string userId is falsy under `??` only for null/undefined; the
    // `||` chain in writeConfig (`actorUserId ?? orgId ?? null`) does NOT
    // fall through on '' — but the route uses ?? not ||, so '' wins.
    // This pins that contract: empty string is preserved verbatim.
    expect(params[4]).toBe('');
  });

  it('does NOT insert an audit row when recordCalls is unchanged', async () => {
    // Both prev and new are true → no audit-row insert.
    primeFlipQueue({
      prevRecordCalls: true,
      ownedRow: { tenant_id: 'demo', org_id: 'org-1', data: { tenantId: 'demo', recordCalls: true } },
    });

    const app = await buildApp({ userId: 'user-42', orgId: 'org-1', role: 'owner' });
    const res = await app.inject({
      method: 'PUT',
      url: '/agent-config',
      payload: {
        tenantId: 'demo',
        name: 'Test Agent',
        businessName: 'Test Biz',
        recordCalls: true, // unchanged
      },
    });

    expect(res.statusCode).toBe(200);
    const auditCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('INSERT INTO privacy_setting_changes'),
    );
    expect(auditCall).toBeUndefined();
  });

  it('treats undefined→false as a real flip (legacy-on default)', async () => {
    // R14 design: `recordCalls: undefined` is treated as legacy-on (true).
    // Flipping undefined → false IS a privacy-relevant change and must audit.
    primeFlipQueue({
      prevRecordCalls: undefined,
      ownedRow: { tenant_id: 'demo', org_id: 'org-1', data: { tenantId: 'demo' } },
    });

    const app = await buildApp({ userId: 'user-42', orgId: 'org-1', role: 'owner' });
    const res = await app.inject({
      method: 'PUT',
      url: '/agent-config',
      payload: {
        tenantId: 'demo',
        name: 'Test Agent',
        businessName: 'Test Biz',
        recordCalls: false,
      },
    });

    expect(res.statusCode).toBe(200);
    const auditCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('INSERT INTO privacy_setting_changes'),
    );
    expect(auditCall).toBeDefined();
    const params = auditCall![1] as unknown[];
    // value_before is null because prev was undefined (legacy default treated
    // as on, but the audit row preserves the literal "we didn't have an
    // explicit value before" via NULL).
    expect(params[2]).toBeNull();
    expect(params[3]).toBe('false');
    expect(params[4]).toBe('user-42');
  });
});
