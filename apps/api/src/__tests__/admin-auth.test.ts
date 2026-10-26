import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn<(...args: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>>(async () => ({ rows: [], rowCount: 0 })) }));
vi.mock('../db.js', () => ({ pool: { query } }));
// Keep unrelated provider/email integrations offline; route registration,
// Fastify request lifecycle, JWT signing/verifying and admin gate remain real.
vi.mock('../demo.js', () => ({
  DEMO_END_INSTRUCTIONS: '', DEFAULT_SALES_PROMPT: '',
  buildDemoGeneralPrompt: vi.fn(), ensurePhonbotProductFacts: vi.fn(),
  flushDemoAgentCache: vi.fn(), bustSalesPromptCache: vi.fn(),
}));
vi.mock('../platform-baseline.js', () => ({ PLATFORM_BASELINE_PROMPT: '', bustPlatformBaselineCache: vi.fn(), ensurePlatformSafetyKernel: vi.fn() }));
vi.mock('../outbound-baseline.js', () => ({ OUTBOUND_BASELINE_PROMPT: '', bustOutboundBaselineCache: vi.fn(), ensureOutboundSafetyKernel: vi.fn() }));
vi.mock('../email.js', () => ({ sendSignupLinkEmail: vi.fn() }));
vi.mock('../agent-instructions.js', () => ({ buildAgentInstructions: vi.fn() }));
vi.mock('../prompt-eval.js', () => ({ buildPromptQaReport: vi.fn() }));
vi.mock('../sms.js', () => ({ humanMeetingUrl: vi.fn() }));
vi.mock('../retell.js', () => ({ DEFAULT_VOICE_ID: 'offline-voice', getDefaultRetellLlmModel: vi.fn() }));

const app = Fastify();
// Negative fixtures intentionally violate the application's declared JWT
// payload type; they must still be signed and rejected at the HTTP boundary.
function signFixture(payload: Record<string, unknown>) {
  return app.jwt.sign(payload as Parameters<typeof app.jwt.sign>[0]);
}
beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('OPENAI_API_KEY', 'offline-test-only');
  await app.register(jwt, { secret: randomUUID() });
  app.decorate('authenticate', async (request: Parameters<typeof app.authenticate>[0]) => { await request.jwtVerify(); });
  const { registerAdmin } = await import('../admin.js');
  const { registerLearningApi } = await import('../learning-api.js');
  await registerAdmin(app);
  await registerLearningApi(app);
  await app.ready();
});
beforeEach(() => { query.mockClear(); });
afterAll(async () => { await app.close(); vi.unstubAllEnvs(); });

describe.each(['/admin/leads', '/learning/templates/test-template/learnings'])('admin JWT gate: %s', (url) => {
  it.each([
    { admin: true },
    { admin: true, aud: 'phonbot:user' },
    { admin: false, aud: 'phonbot:admin' },
    { aud: 'phonbot:admin' },
    { admin: 'true', aud: 'phonbot:admin' },
    { admin: 1, aud: 'phonbot:admin' },
  ])('rejects insufficient or non-boolean claims %j before database access', async (claims) => {
    const response = await app.inject({ url, headers: { authorization: `Bearer ${signFixture(claims)}` } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Admin access required' });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Bearer invalid-token'])('rejects missing/invalid authentication %s', async (authorization) => {
    const response = await app.inject({ url, headers: authorization ? { authorization } : {} });
    expect(response.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an expired, otherwise valid admin token', async () => {
    const token = signFixture({ admin: true, aud: 'phonbot:admin', exp: 1 });
    const response = await app.inject({ url, headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('admits a verified boolean admin claim and the correct audience', async () => {
    const token = app.jwt.sign({ admin: true, aud: 'phonbot:admin' });
    const response = await app.inject({ url, headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(query).toHaveBeenCalled();
  });
});


describe.each(['/admin/users', '/admin/orgs'])('admin pagination: %s', url => {
  it('returns a bounded page and hasMore without exposing the lookahead row', async () => {
    const rows = Array.from({ length: 51 }, (_, id) => ({ id: `synthetic-${id}` }));
    query.mockResolvedValueOnce({ rows, rowCount: 51 });
    const token = app.jwt.sign({ admin: true, aud: 'phonbot:admin' });
    const response = await app.inject({ url: `${url}?limit=50&offset=50&search=Needle`, headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: rows.slice(0, 50), hasMore: true });
    expect(query.mock.calls[0]?.[1]).toEqual([51, 50, 'Needle']);
  });
  it('reports the final page and preserves the admin access boundary', async () => {
    const token = app.jwt.sign({ admin: true, aud: 'phonbot:admin' });
    const response = await app.inject({ url, headers: { authorization: `Bearer ${token}` } });
    expect(response.json()).toEqual({ items: [], hasMore: false });
    query.mockClear();
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
