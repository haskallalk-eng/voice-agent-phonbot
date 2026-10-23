import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import twilio from 'twilio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ query: vi.fn(), reserve: vi.fn(), bind: vi.fn(), release: vi.fn(), settle: vi.fn(),
  redisSet: vi.fn(), redisDel: vi.fn(), fetch: vi.fn() }));
vi.mock('../db.js', () => ({ pool: { query: m.query } }));
vi.mock('../redis.js', () => ({ redis: { isOpen: true, set: m.redisSet, del: m.redisDel, get: vi.fn(async () => null) } }));
vi.mock('../usage.js', () => ({ tryReserveMinutes: m.reserve, bindMinutesReservation: m.bind,
  releaseMinutesReservation: m.release, reconcileMinutes: m.settle }));
const { triggerBridgeCall, registerTwilioBridge } = await import('../twilio-openai-bridge.js');
const RECORD = '11111111-1111-4111-8111-111111111111';
const RESERVATION = '22222222-2222-4222-8222-222222222222';
const SID = 'CA' + 'a'.repeat(32);
const OTHER_SID = 'CA' + 'b'.repeat(32);
const TOKEN = 'synthetic-twilio-auth-token';
const BASE = 'https://example.test';
const START = new Date('2026-10-23T10:00:00.000Z');
const URL = `/outbound/status/session-test?outbound_record_id=${RECORD}&usage_reservation_id=${RESERVATION}`;

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('TWILIO_AUTH_TOKEN', TOKEN);
  vi.stubEnv('WEBHOOK_BASE_URL', BASE);
  vi.stubGlobal('fetch', m.fetch);
  m.query.mockReset().mockResolvedValue({ rowCount: 1, rows: [{ id: RECORD, org_id: 'org-a', call_id: SID, created_at: START }] });
  m.reserve.mockReset().mockResolvedValue({ allowed: true, reservationId: RESERVATION });
  m.bind.mockReset().mockResolvedValue(undefined);
  m.release.mockReset().mockResolvedValue(undefined);
  m.settle.mockReset().mockResolvedValue(undefined);
  m.redisSet.mockReset().mockResolvedValue('OK');
  m.redisDel.mockReset().mockResolvedValue(1);
  m.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ sid: SID }), { status: 201 }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const creation = { orgId: 'org-a', toNumber: '+4915111111111', fromNumber: '+493012345678',
  prompt: 'synthetic test', webhookBase: BASE, twilioSid: 'AC' + '1'.repeat(32), twilioToken: TOKEN, outboundRecordId: RECORD };

async function appFixture() {
  const app = Fastify();
  await app.register(formbody);
  await app.register(websocket);
  await registerTwilioBridge(app);
  await app.ready();
  return app;
}

function signedStatus(app: Awaited<ReturnType<typeof appFixture>>, body: Record<string, string>, url = URL) {
  return app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': twilio.getExpectedTwilioSignature(TOKEN, BASE + url, body) } });
}

describe('Twilio creation reservation lifecycle', () => {
  it('includes signed durable correlation in callback URL and binds the real call SID', async () => {
    expect((await triggerBridgeCall(creation)).ok).toBe(true);
    expect(m.bind).toHaveBeenCalledWith('org-a', RESERVATION, SID);
    const sent = m.fetch.mock.calls[0]![1] as RequestInit;
    const callback = new globalThis.URL((sent.body as URLSearchParams).get('StatusCallback')!);
    expect(callback.searchParams.get('outbound_record_id')).toBe(RECORD);
    expect(callback.searchParams.get('usage_reservation_id')).toBe(RESERVATION);
    expect(m.release).not.toHaveBeenCalled();
  });

  it('checks outbound record ownership before reservation/provider request', async () => {
    m.query.mockResolvedValue({ rowCount: 0, rows: [] });
    expect((await triggerBridgeCall(creation)).error).toBe('NOT_YOUR_OUTBOUND_CALL');
    expect(m.reserve).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it('reserves nothing when local Twilio configuration is invalid', async () => {
    expect((await triggerBridgeCall({ ...creation, twilioToken: '' })).ok).toBe(false);
    expect(m.reserve).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it('releases the hold if session creation fails before any provider request', async () => {
    m.redisSet.mockRejectedValue(new Error('synthetic Redis failure'));
    await expect(triggerBridgeCall(creation)).rejects.toThrow('synthetic Redis failure');
    expect(m.release).toHaveBeenCalledWith('org-a', RESERVATION);
    expect(m.fetch).not.toHaveBeenCalled();
    expect(m.query).toHaveBeenLastCalledWith(expect.stringContaining("AND call_id IS NULL AND status = 'initiated'"), [RECORD, 'org-a']);
  });

  it('marks a quota-denied attempt failed without a provider request', async () => {
    m.reserve.mockResolvedValue({ allowed: false });
    expect((await triggerBridgeCall(creation)).error).toBe('USAGE_LIMIT_REACHED');
    expect(m.query).toHaveBeenLastCalledWith(expect.stringContaining("SET status = 'failed'"), [RECORD, 'org-a']);
    expect(m.release).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it('marks a rejected ledger activation failed without releasing an uncertain reservation', async () => {
    m.reserve.mockRejectedValue(new Error('USAGE_LEDGER_NOT_ACTIVATED'));
    await expect(triggerBridgeCall(creation)).rejects.toThrow('USAGE_LEDGER_NOT_ACTIVATED');
    expect(m.query).toHaveBeenLastCalledWith(expect.stringContaining("SET status = 'failed'"), [RECORD, 'org-a']);
    expect(m.release).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it('records definitive provider rejection even when Redis cleanup fails', async () => {
    m.fetch.mockResolvedValue(new Response('{}', { status: 400 }));
    m.redisDel.mockRejectedValue(new Error('synthetic Redis cleanup failure'));
    expect((await triggerBridgeCall(creation)).error).toBe('CALL_REJECTED');
    expect(m.release).toHaveBeenCalledWith('org-a', RESERVATION);
    expect(m.query).toHaveBeenLastCalledWith(expect.stringContaining("SET status = 'failed'"), [RECORD, 'org-a']);
  });

  it.each([400, 401, 403, 404, 422, 429])('releases the hold for definite provider rejection %i', async (status) => {
    m.fetch.mockResolvedValue(new Response('{}', { status }));
    expect((await triggerBridgeCall(creation)).error).toBe('CALL_REJECTED');
    expect(m.release).toHaveBeenCalledWith('org-a', RESERVATION);
    expect(m.bind).not.toHaveBeenCalled();
  });

  it.each([408, 409, 500, 503])('retains uncertain HTTP %i creation hold', async (status) => {
    m.fetch.mockResolvedValue(new Response('{}', { status }));
    expect((await triggerBridgeCall(creation)).error).toBe('CALL_CREATION_UNCONFIRMED');
    expect(m.release).not.toHaveBeenCalled();
    expect(m.query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'failed'"))).toBe(false);
  });

  it.each(['network-timeout', 'invalid-sid', 'bind-failure'])('retains uncertain %s hold', async (failure) => {
    if (failure === 'network-timeout') m.fetch.mockRejectedValue(new Error('synthetic timeout'));
    if (failure === 'invalid-sid') m.fetch.mockResolvedValue(new Response('{}', { status: 201 }));
    if (failure === 'bind-failure') m.bind.mockRejectedValue(new Error('synthetic bind failure'));
    await expect(triggerBridgeCall(creation)).rejects.toThrow();
    expect(m.release).not.toHaveBeenCalled();
    expect(m.query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'failed'"))).toBe(false);
  });
});

describe('signed Twilio terminal callbacks', () => {
  it.each([SID, null])('settles after Redis expiry using the reservation age, not an old draft date (bound SID %s)', async (bound) => {
    m.query.mockResolvedValue({ rowCount: 1, rows: [{ org_id: 'org-a', call_id: bound, created_at: new Date('2020-01-01') }] });
    const app = await appFixture();
    try {
      const res = await signedStatus(app, { CallSid: SID, CallStatus: 'completed', CallDuration: '61', org_id: 'untrusted-org' });
      expect(res.statusCode).toBe(200);
      expect(m.settle).toHaveBeenCalledWith('org-a', 1.02, { callId: SID, reservationId: RESERVATION });
    } finally { await app.close(); }
  });

  it('retries the same ledger identity and ignores late nonterminal statuses', async () => {
    const app = await appFixture();
    try {
      const body = { CallSid: SID, CallStatus: 'completed', CallDuration: '60' };
      expect((await signedStatus(app, body)).statusCode).toBe(200);
      expect((await signedStatus(app, body)).statusCode).toBe(200);
      expect(m.settle).toHaveBeenCalledTimes(2); // real ledger deduplicates this stable key
      expect(m.settle.mock.calls[0]).toEqual(m.settle.mock.calls[1]);
      m.query.mockClear();
      expect((await signedStatus(app, { CallSid: SID, CallStatus: 'ringing' })).statusCode).toBe(200);
      expect(m.query).not.toHaveBeenCalled();
      expect(m.settle).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });

  it.each([undefined, '', '-1', 'NaN', '1.2'])('does not guess missing/invalid duration %s', async (duration) => {
    const app = await appFixture();
    try {
      const body: Record<string, string> = { CallSid: SID, CallStatus: 'completed' };
      if (duration !== undefined) body.CallDuration = duration;
      expect((await signedStatus(app, body)).statusCode).toBe(400);
      expect(m.settle).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('rejects mismatched persisted SID before ledger settlement', async () => {
    const app = await appFixture();
    try {
      expect((await signedStatus(app, { CallSid: OTHER_SID, CallStatus: 'completed', CallDuration: '60' })).statusCode).toBe(409);
      expect(m.settle).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('fails closed when the ledger rejects conflicting repeated duration or reservation scope', async () => {
    m.settle.mockRejectedValue(new Error('USAGE_SETTLEMENT_CONFLICT'));
    const app = await appFixture();
    try {
      expect((await signedStatus(app, { CallSid: SID, CallStatus: 'failed', CallDuration: '0' })).statusCode).toBe(500);
      expect(m.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE outbound_calls'))).toBe(false);
      expect(m.redisDel).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('rejects forged callback signatures before DB access', async () => {
    const app = await appFixture();
    try {
      const res = await app.inject({ method: 'POST', url: URL, payload: 'CallStatus=completed',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'forged' } });
      expect(res.statusCode).toBe(403);
      expect(m.query).not.toHaveBeenCalled();
      expect(m.settle).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('rejects old callbacks without durable correlation instead of trusting an expired session', async () => {
    const app = await appFixture();
    try {
      expect((await signedStatus(app, { CallSid: SID, CallStatus: 'completed', CallDuration: '60' }, '/outbound/status/old-session')).statusCode).toBe(400);
      expect(m.settle).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
