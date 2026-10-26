import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/db.js', () => ({ pool: { query } }));
// Keep unrelated provider/email integrations offline; route registration,
// Fastify request lifecycle, JWT signing/verifying and admin gate remain real.
vi.mock('../src/demo.js', () => ({
  DEMO_END_INSTRUCTIONS: '', DEFAULT_SALES_PROMPT: '',
  buildDemoGeneralPrompt: vi.fn(), ensurePhonbotProductFacts: vi.fn(),
  flushDemoAgentCache: vi.fn(), bustSalesPromptCache: vi.fn(),
}));
vi.mock('../src/platform-baseline.js', () => ({ PLATFORM_BASELINE_PROMPT: '', bustPlatformBaselineCache: vi.fn(), ensurePlatformSafetyKernel: vi.fn() }));
vi.mock('../src/outbound-baseline.js', () => ({ OUTBOUND_BASELINE_PROMPT: '', bustOutboundBaselineCache: vi.fn(), ensureOutboundSafetyKernel: vi.fn() }));
vi.mock('../src/email.js', () => ({ sendSignupLinkEmail: vi.fn() }));
vi.mock('../src/agent-instructions.js', () => ({ buildAgentInstructions: vi.fn() }));
vi.mock('../src/prompt-eval.js', () => ({ buildPromptQaReport: vi.fn() }));
vi.mock('../src/sms.js', () => ({ humanMeetingUrl: vi.fn() }));
vi.mock('../src/retell.js', () => ({ DEFAULT_VOICE_ID: 'offline-voice', getDefaultRetellLlmModel: vi.fn() }));


const app = Fastify();
let client: pg.Client | undefined;
let token: string;
beforeAll(async () => {
  // Explicit disposable loopback database only. Never read DATABASE_URL.
  if (process.env.USAGE_TEST_DATABASE !== 'phonbot_usage_test' || !process.env.USAGE_TEST_DATABASE_PASSWORD) {
    throw new Error('An explicit disposable phonbot_usage_test database is required.');
  }
  const port = Number(process.env.USAGE_TEST_DATABASE_PORT ?? '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local test port');
  client = new pg.Client({ host: '127.0.0.1', port, user: 'phonbot_usage_test', database: 'phonbot_usage_test',
    password: process.env.USAGE_TEST_DATABASE_PASSWORD, ssl: false, connectionTimeoutMillis: 2000, statement_timeout: 5000 });
  await client.connect();
  // Session-local tables disappear on disconnect; no persistent schema mutation.
  await client.query(`
    CREATE TEMP TABLE orgs (id text PRIMARY KEY, name text, slug text, plan text, plan_status text,
      is_active boolean, created_at timestamptz, minutes_used int, minutes_limit int);
    CREATE TEMP TABLE users (id text PRIMARY KEY, email text, role text, created_at timestamptz, is_active boolean, org_id text);
    CREATE TEMP TABLE agent_configs (org_id text);
    CREATE TEMP TABLE admin_read_audit_log (admin_email text, route text, params text, result_count int, ip text);
    INSERT INTO orgs SELECT lpad(i::text, 3, '0'), CASE WHEN i = 1 THEN 'Needle Company' ELSE 'Company ' || i END,
      'company-' || i, 'starter', 'active', true, '2026-10-26', 0, 100 FROM generate_series(1, 65) i;
    INSERT INTO users SELECT lpad(i::text, 3, '0'), CASE WHEN i = 1 THEN 'needle@example.test' ELSE 'user-' || i || '@example.test' END,
      'owner', '2026-10-26', true, lpad(i::text, 3, '0') FROM generate_series(1, 65) i;
  `);
  query.mockImplementation((sql: string, values: unknown[]) => client!.query(sql, values));
  vi.stubEnv('OPENAI_API_KEY', 'offline-test-only');
  await app.register(jwt, { secret: randomUUID() });
  app.decorate('authenticate', async (request: Parameters<typeof app.authenticate>[0]) => { await request.jwtVerify(); });
  const { registerAdmin } = await import('../src/admin.js');
  await registerAdmin(app);
  await app.ready();
  token = app.jwt.sign({ admin: true, aud: 'phonbot:admin' });
});
afterAll(async () => { await app.close(); await client?.end(); vi.unstubAllEnvs(); });
async function get(url: string) {
  const response = await app.inject({ url, headers: { authorization: `Bearer ${token}` } });
  expect(response.statusCode).toBe(200);
  return response.json<{ items: { id: string }[]; hasMore: boolean }>();
}
describe.each(['/admin/users', '/admin/orgs'])('real PostgreSQL pagination %s', path => {
  it('retrieves all 65 records without gaps despite identical timestamps', async () => {
    const first = await get(path);
    const second = await get(`${path}?offset=50`);
    expect(first.items).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(15);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(65);
  });
  it('finds a record beyond the first page and treats search metacharacters literally', async () => {
    const found = await get(`${path}?search=NEEDLE`);
    expect(found.items.map(row => row.id)).toEqual(['001']);
    expect(found.hasMore).toBe(false);
    expect((await get(`${path}?search=%25`)).items).toEqual([]);
    expect((await get(`${path}?search=${encodeURIComponent("' OR true --")}`)).items).toEqual([]);
  });
});
