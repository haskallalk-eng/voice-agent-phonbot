import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  count: 0, open: true, duplicate: false,
  query: vi.fn<(...args: unknown[]) => Promise<{ rows: Record<string, string>[]; rowCount: number }>>(),
  call: vi.fn(), email: vi.fn(), sms: vi.fn(), keys: [] as string[],
}));
vi.mock('../db.js', () => ({ pool: { query: state.query } }));
vi.mock('../redis.js', () => ({ redis: {
  get isOpen() { return state.open; },
  get isReady() { return state.open; },
  get: vi.fn(async () => 'synthetic-sales-agent'),
  multi: () => {
    const transaction = {
      incr(key: string) { state.keys.push(key); return transaction; },
      expire() { return transaction; },
      async exec() { return [++state.count, true]; },
    };
    return transaction;
  },
} }));
vi.mock('../retell.js', () => ({ createPhoneCall: state.call, DEFAULT_VOICE_ID: 'offline-voice' }));
vi.mock('../email.js', () => ({ sendSignupLinkEmail: state.email }));
vi.mock('../sms.js', () => ({ sendSignupLinkSms: state.sms, signupLinkUrl: () => 'https://example.test/signup' }));
vi.mock('../twilio-openai-bridge.js', () => ({ triggerBridgeCall: vi.fn() }));
const app = Fastify();
const payload = { name: 'Synthetic Person', email: 'synthetic@example.test', phone: '+493012345678', privacyConsent: true, turnstileToken: 'valid-token' };
const paths = ['/demo/callback', '/outbound/website-callback'];
beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'offline-test-secret');
  vi.stubEnv('RETELL_OUTBOUND_NUMBER', '+493012345679');
  vi.stubEnv('WEBHOOK_BASE_URL', 'https://example.test');
  vi.stubEnv('ALLOWED_PHONE_PREFIXES', '+49,+43,+41');
  app.decorate('authenticate', async () => {});
  const { registerDemo } = await import('../demo.js');
  const { registerOutbound } = await import('../outbound-agent.js');
  await registerDemo(app);
  await registerOutbound(app);
  await app.ready();
});
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { count: 0, open: true, duplicate: false, keys: [] });
  vi.stubEnv('DEMO_GLOBAL_HOURLY_CAP', '2');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
  state.query.mockImplementation(async sql => String(sql).includes('SELECT 1 FROM crm_leads')
    ? { rows: [], rowCount: state.duplicate ? 1 : 0 }
    : { rows: [{ id: 'synthetic-record' }], rowCount: 1 });
  state.call.mockResolvedValue({ call_id: 'synthetic-call' });
  state.email.mockResolvedValue({ ok: true });
  state.sms.mockResolvedValue({ ok: true });
});
afterAll(async () => { await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe.each(paths)('%s', url => {
  it('rejects missing or expired tokens before side effects', async () => {
    const missing = await app.inject({ method: 'POST', url, payload: { ...payload, turnstileToken: '' } });
    expect(missing.statusCode).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] }) })));
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(403);
    expect(state.count).toBe(0);
    expect(state.query).not.toHaveBeenCalled();
    expect(state.call).not.toHaveBeenCalled();
    expect(state.sms).not.toHaveBeenCalled();
  });
  it('refuses a disconnected budget before sending messages or starting calls', async () => {
    state.open = false;
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(503);
    expect(state.query).not.toHaveBeenCalled();
    expect(state.call).not.toHaveBeenCalled();
    expect(state.email).not.toHaveBeenCalled();
  });
  it('honours the country policy before reserving capacity', async () => {
    expect((await app.inject({ method: 'POST', url, payload: { ...payload, phone: '+12025550123' } })).statusCode).toBe(400);
    expect(state.count).toBe(0);
    expect(state.call).not.toHaveBeenCalled();
  });
  it('does not repeat a call when the database records a recent lead', async () => {
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
    state.duplicate = true;
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
    expect(state.call).toHaveBeenCalledTimes(1);
  });
});
it('shares one budget across both routes and different IPs', async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => app.inject({
    method: 'POST', url: paths[i % 2]!, remoteAddress: `192.0.2.${i + 1}`,
    payload: { ...payload, phone: `+4930123456${10 + i}` },
  })));
  expect(responses.filter(response => response.statusCode === 200)).toHaveLength(2);
  expect(responses.filter(response => response.statusCode === 429)).toHaveLength(6);
  expect(state.call).toHaveBeenCalledTimes(2);
  expect(new Set(state.keys).size).toBe(1);
});
