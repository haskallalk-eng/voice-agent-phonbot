import Fastify from 'fastify';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'retell-retention-test-key';
vi.stubEnv('RETELL_API_KEY', SECRET);
vi.stubEnv('NODE_ENV', 'test');

const mockQuery = vi.fn(async (_sql: unknown, _params?: unknown[]) => ({ rowCount: 1, rows: [] as unknown[] }));
const mockDeleteCall = vi.fn(async (_callId: unknown) => {});
const mockGetOrgIdByAgentId = vi.fn(async (_agentId: unknown): Promise<string | null> => 'org-1');
const mockReconcileMinutes = vi.fn(async (_orgId: unknown, _minutes: unknown, _context: unknown) => {});
const mockMergeTicketMetadata = vi.fn(async (_callId: unknown, _orgId: unknown, _extracted: unknown) => {});
const mockFireInboundWebhooks = vi.fn(async (_orgId: unknown, _event: unknown, _payload: unknown) => {});
const mockAnalyzeCall = vi.fn(async (_orgId: unknown, _callId: unknown, _transcript: unknown, _metadata: unknown) => {});
const mockAnalyzeOutboundCall = vi.fn(async (_orgId: unknown, _callId: unknown, _transcript: unknown, _duration: unknown) => {});
const mockCheckForwardingVerificationMatch = vi.fn(async (_to: unknown, _from: unknown) => {});
let databaseAvailable = true;

vi.mock('../db.js', () => ({
  get pool() {
    return databaseAvailable ? { query: (sql: unknown, params?: unknown[]) => mockQuery(sql, params) } : null;
  },
}));

vi.mock('../tickets.js', () => ({
  createTicket: vi.fn(),
  mergeTicketMetadata: (callId: unknown, orgId: unknown, extracted: unknown) => mockMergeTicketMetadata(callId, orgId, extracted),
}));

vi.mock('../traces.js', () => ({ appendTraceEvent: vi.fn(async () => {}) }));
vi.mock('../usage.js', () => ({
  reconcileMinutes: (orgId: unknown, minutes: unknown, context: unknown) => mockReconcileMinutes(orgId, minutes, context),
}));
vi.mock('../calendar.js', () => ({
  findFreeSlots: vi.fn(),
  findFreeSlotsForAnyStaff: vi.fn(),
  bookSlot: vi.fn(),
  bookSlotForAnyStaff: vi.fn(),
  findChipyBookingsForChange: vi.fn(),
  cancelChipyBookingForChange: vi.fn(),
  rescheduleChipyBookingForChange: vi.fn(),
}));
vi.mock('../agent-config.js', () => ({
  triggerCallback: vi.fn(),
  readConfig: vi.fn(),
}));
vi.mock('../api-integrations.js', () => ({ executeIntegrationCall: vi.fn() }));
vi.mock('../insights.js', () => ({ analyzeCall: (orgId: unknown, callId: unknown, transcript: unknown, metadata: unknown) => mockAnalyzeCall(orgId, callId, transcript, metadata) }));
vi.mock('../outbound-insights.js', () => ({ analyzeOutboundCall: (orgId: unknown, callId: unknown, transcript: unknown, duration: unknown) => mockAnalyzeOutboundCall(orgId, callId, transcript, duration) }));
vi.mock('../org-id-cache.js', () => ({ getOrgIdByAgentId: (agentId: unknown) => mockGetOrgIdByAgentId(agentId) }));
vi.mock('../phone.js', () => ({
  checkForwardingVerificationMatch: (to: unknown, from: unknown) => mockCheckForwardingVerificationMatch(to, from),
}));
vi.mock('../retell.js', () => ({
  getCall: vi.fn(),
  deleteCall: (callId: unknown) => mockDeleteCall(callId),
}));
vi.mock('../inbound-webhooks.js', () => ({ fireInboundWebhooks: (orgId: unknown, event: unknown, payload: unknown) => mockFireInboundWebhooks(orgId, event, payload) }));
vi.mock('../sms.js', () => ({
  sendBookingConfirmationSms: vi.fn(async () => ({ ok: true })),
  sendTicketAckSms: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../demo.js', () => ({
  readDemoCallTemplate: vi.fn(async () => null),
  maybeSendDemoSignupLink: vi.fn(async () => {}),
  maybeSendDemoBookingConfirmation: vi.fn(async () => ({ ok: true })),
  demoRecordingDeclinedToolSignature: vi.fn(() => 'demo-recording-sig'),
  isKnownSalesCallbackAgent: vi.fn(async () => false),
}));
vi.mock('../pii.js', () => ({
  redactForToolResult: (value: string) => value,
  redactForTrace: (value: string) => value,
  redactPII: (value: string) => value,
}));
vi.mock('../agent-instructions.js', () => ({ RECORDING_CONSENT_PROMPT_VERSION: 'test-v1' }));
vi.mock('../logger.js', () => {
  const noop = () => {};
  return { log: { info: noop, warn: noop, error: noop, debug: noop } };
});
vi.mock('../customers.js', () => ({
  customerModuleActiveForAgentConfig: vi.fn(() => false),
  getActiveCustomerDetailsKeys: vi.fn(() => []),
  normalizeCustomerModuleConfig: vi.fn(() => ({ enabled: false })),
  lookupCustomer: vi.fn(async () => null),
  upsertCustomer: vi.fn(async () => null),
}));

const { registerRetellWebhooks } = await import('../retell-webhooks.js');

function signatureFor(body: string): string {
  const timestamp = String(Date.now());
  const digest = crypto.createHmac('sha256', SECRET).update(body + timestamp).digest('hex');
  return `v=${timestamp},d=${digest}`;
}

function mockRetentionPolicy(data: { recordCalls?: boolean; dataRetentionDays?: number }) {
  mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    if (text.includes('processed_retell_events')) {
      return { rowCount: 1, rows: [{ call_id: params?.[0] ?? 'call-1' }] };
    }
    if (text.includes('recording_declined_calls')) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes('FROM agent_configs')) {
      return { rowCount: 1, rows: [{ data }] };
    }
    return { rowCount: 1, rows: [] };
  });
}

async function buildApp() {
  const app = Fastify({ logger: false });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as typeof req & { rawBody?: string }).rawBody = body as string;
    done(null, JSON.parse(body as string));
  });
  await registerRetellWebhooks(app);
  await app.ready();
  return app;
}

function callEndedPayload(withTranscript: boolean) {
  return {
    event: 'call_ended',
    call: {
      call_id: withTranscript ? 'call-with-transcript' : 'call-without-transcript',
      agent_id: 'agent-1',
      start_timestamp: 1_700_000_000_000,
      end_timestamp: 1_700_000_060_000,
      duration_ms: 60_000,
      from_number: '+4915111111111',
      to_number: '+493012345678',
      ...(withTranscript ? { transcript: 'Kunde stimmt nicht zu.' } : {}),
      call_analysis: {
        custom_analysis_data: {
          customer_name: 'Max',
        },
      },
    },
  };
}

function callAnalyzedPayload() {
  return {
    event: 'call_analyzed',
    call: {
      call_id: 'call-analyzed-1',
      agent_id: 'agent-1',
      call_analysis: {
        custom_analysis_data: {
          customer_name: 'Max',
        },
      },
    },
  };
}

function platformCallbackPayload() {
  return {
    event: 'call_ended',
    call: {
      call_id: 'platform-callback-call',
      agent_id: 'phonbot-sales-agent',
      start_timestamp: 1_700_000_000_000,
      end_timestamp: 1_700_000_060_000,
      duration_ms: 60_000,
      from_number: '+493012345678',
      to_number: '+4915111111111',
      metadata: {
        source: 'website-callback',
        leadId: '11111111-1111-4111-8111-111111111111',
        outboundRecordId: '22222222-2222-4222-8222-222222222222',
      },
    },
  };
}

describe('Retell lifecycle retention enforcement', () => {
  beforeEach(() => {
    databaseAvailable = true;
    mockQuery.mockReset();
    mockDeleteCall.mockClear();
    mockGetOrgIdByAgentId.mockReset().mockResolvedValue('org-1');
    mockReconcileMinutes.mockReset().mockResolvedValue(undefined);
    mockMergeTicketMetadata.mockClear();
    mockFireInboundWebhooks.mockClear();
    mockAnalyzeCall.mockClear();
    mockAnalyzeOutboundCall.mockClear();
    mockCheckForwardingVerificationMatch.mockClear();
  });

  function callStartedPayload(callId: unknown = 'call-start-1', agentId = 'agent-1') {
    return {
      event: 'call_started',
      orgId: 'untrusted-body-org',
      call: { call_id: callId, agent_id: agentId, org_id: 'untrusted-call-org',
        from_number: '+4915111111111', to_number: '+493012345678', start_timestamp: 1_790_000_000_000 },
    };
  }

  function injectStarted(app: Awaited<ReturnType<typeof buildApp>>, payload: object, format = 'current') {
    const body = JSON.stringify(payload);
    const signature = format === 'legacy'
      ? crypto.createHmac('sha256', SECRET).update(body).digest('hex')
      : signatureFor(body);
    return app.inject({
      method: 'POST', url: '/retell/webhook', payload: body,
      headers: { 'content-type': 'application/json', 'x-retell-signature': signature },
    });
  }

  function simulateDurableClaims() {
    const claimed = new Set<string>();
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      expect(String(sql)).toContain('INSERT INTO processed_retell_events');
      expect(String(sql)).toContain('ON CONFLICT (call_id, event_type) DO NOTHING');
      const key = JSON.stringify(params);
      if (claimed.has(key)) return { rowCount: 0, rows: [] };
      claimed.add(key);
      await Promise.resolve();
      return { rowCount: 1, rows: [{ call_id: params?.[0] }] };
    });
  }

  it.each(['current', 'legacy'])('delivers a repeated %s-signed call_started event only once', async (format) => {
    simulateDurableClaims();
    const app = await buildApp();
    try {
      const first = await injectStarted(app, callStartedPayload(), format);
      const second = await injectStarted(app, callStartedPayload(), format);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ ok: true, deduped: true });
      expect(mockCheckForwardingVerificationMatch).toHaveBeenCalledTimes(1);
      expect(mockFireInboundWebhooks).toHaveBeenCalledTimes(1);
      expect(mockFireInboundWebhooks).toHaveBeenCalledWith('org-1', 'call.started', expect.objectContaining({ callId: 'call-start-1' }));
    } finally {
      await app.close();
    }
  });

  it.each(['current', 'legacy'])('allows only the winning database claim to dispatch concurrent %s requests', async (format) => {
    // The mock models the database unique constraint; this is a real-route test
    // of its winner/loser outcomes, not a PostgreSQL concurrency integration test.
    simulateDurableClaims();
    const app = await buildApp();
    try {
      const responses = await Promise.all(Array.from({ length: 3 }, () => injectStarted(app, callStartedPayload(), format)));
      expect(responses.every((res) => res.statusCode === 200)).toBe(true);
      expect(responses.filter((res) => res.json().deduped === true)).toHaveLength(2);
      expect(mockCheckForwardingVerificationMatch).toHaveBeenCalledTimes(1);
      expect(mockFireInboundWebhooks).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('dispatches distinct call IDs with org scope resolved from each agent, ignoring body scope', async () => {
    simulateDurableClaims();
    mockGetOrgIdByAgentId.mockImplementation(async (agentId) => agentId === 'agent-a' ? 'org-a' : 'org-b');
    const app = await buildApp();
    try {
      await injectStarted(app, callStartedPayload('call-a', 'agent-a'));
      await injectStarted(app, callStartedPayload('call-b', 'agent-b'));
      expect(mockFireInboundWebhooks).toHaveBeenCalledTimes(2);
      expect(mockFireInboundWebhooks).toHaveBeenNthCalledWith(1, 'org-a', 'call.started', expect.objectContaining({ callId: 'call-a', agentId: 'agent-a' }));
      expect(mockFireInboundWebhooks).toHaveBeenNthCalledWith(2, 'org-b', 'call.started', expect.objectContaining({ callId: 'call-b', agentId: 'agent-b' }));
    } finally {
      await app.close();
    }
  });

  it.each([null, '', '  ', 123, {}])('rejects an unusable call_started ID %j before effects', async (callId) => {
    const app = await buildApp();
    try {
      const res = await injectStarted(app, callStartedPayload(callId));
      expect(res.statusCode).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockCheckForwardingVerificationMatch).not.toHaveBeenCalled();
      expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects call_started without a call_id before effects', async () => {
    const app = await buildApp();
    try {
      const res = await injectStarted(app, { event: 'call_started', call: { agent_id: 'agent-1' } });
      expect(res.statusCode).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockCheckForwardingVerificationMatch).not.toHaveBeenCalled();
      expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(['no-database', 'claim-error', 'context-error'])('fails closed for call_started with %s', async (failure) => {
    databaseAvailable = failure !== 'no-database';
    if (failure === 'claim-error') mockQuery.mockRejectedValue(new Error('synthetic database outage'));
    if (failure === 'context-error') mockGetOrgIdByAgentId.mockRejectedValue(new Error('synthetic context outage'));
    const app = await buildApp();
    try {
      const res = await injectStarted(app, callStartedPayload());
      expect(res.statusCode).toBe(failure === 'no-database' ? 503 : 500);
      if (failure !== 'claim-error') expect(mockQuery).not.toHaveBeenCalled();
      expect(mockCheckForwardingVerificationMatch).not.toHaveBeenCalled();
      expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects a forged lifecycle request before database or provider side effects', async () => {
    const app = await buildApp();
    try {
      const body = JSON.stringify(callEndedPayload(true));
      const res = await app.inject({
        method: 'POST', url: '/retell/webhook', payload: body,
        headers: { 'content-type': 'application/json', 'x-retell-signature': '0'.repeat(64) },
      });
      expect(res.statusCode).toBe(401);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockReconcileMinutes).not.toHaveBeenCalled();
      expect(mockDeleteCall).not.toHaveBeenCalled();
      expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    ['call_ended', 'current'], ['call_ended', 'legacy'],
    ['call_analyzed', 'current'], ['call_analyzed', 'legacy'],
  ])('retries billing but skips other effects for a previously claimed %s event with %s HMAC', async (event, format) => {
    // Simulate the durable unique constraint reporting an existing event. This
    // verifies handler behavior, not the database's concurrency guarantees.
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    const app = await buildApp();
    try {
      const body = JSON.stringify(event === 'call_ended' ? callEndedPayload(true) : callAnalyzedPayload());
      const signature = format === 'legacy'
        ? crypto.createHmac('sha256', SECRET).update(body).digest('hex')
        : signatureFor(body);
      const res = await app.inject({
        method: 'POST', url: '/retell/webhook', payload: body,
        headers: { 'content-type': 'application/json', 'x-retell-signature': signature },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, deduped: true });
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0]![1]).toEqual([event === 'call_ended' ? 'call-with-transcript' : 'call-analyzed-1', event]);
      if (event === 'call_ended') {
        expect(mockReconcileMinutes).toHaveBeenCalledWith('org-1', 1, {
          callId: 'call-with-transcript', agentId: 'agent-1', reservationId: undefined, startedAt: 1_700_000_000_000,
        });
        expect(mockReconcileMinutes.mock.invocationCallOrder[0]).toBeLessThan(mockQuery.mock.invocationCallOrder[0]!);
      } else {
        expect(mockReconcileMinutes).not.toHaveBeenCalled();
      }
      expect(mockDeleteCall).not.toHaveBeenCalled();
      expect(mockMergeTicketMetadata).not.toHaveBeenCalled();
      expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
      expect(mockAnalyzeCall).not.toHaveBeenCalled();
      expect(mockAnalyzeOutboundCall).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('deletes the Retell call and skips transcript persistence when retention is disabled', async () => {
    mockRetentionPolicy({ recordCalls: true, dataRetentionDays: 0 });
    const app = await buildApp();
    const body = JSON.stringify(callEndedPayload(true));

    const res = await app.inject({
      method: 'POST',
      url: '/retell/webhook',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': signatureFor(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(mockDeleteCall).toHaveBeenCalledWith('call-with-transcript');
    expect(mockAnalyzeCall).not.toHaveBeenCalled();
    expect(mockMergeTicketMetadata).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('INSERT INTO call_transcripts'))).toBe(false);
    await app.close();
  });

  it.each([undefined, '11111111-1111-4111-8111-111111111111'])('passes actual inbound duration and optional reservation %s to the scoped ledger', async (reservationId) => {
    mockRetentionPolicy({ recordCalls: true, dataRetentionDays: 0 });
    const app = await buildApp();
    try {
      const event = callEndedPayload(true);
      const body = JSON.stringify({ ...event, call: { ...event.call, metadata: { usage_reservation_id: reservationId, org_id: 'untrusted-org' } } });
      const res = await app.inject({ method: 'POST', url: '/retell/webhook', payload: body,
        headers: { 'content-type': 'application/json', 'x-retell-signature': signatureFor(body) } });
      expect(res.statusCode).toBe(200);
      // No assumed five-minute subtraction: the ledger owns the hold amount.
      expect(mockReconcileMinutes).toHaveBeenCalledWith('org-1', 1, {
        callId: 'call-with-transcript', agentId: 'agent-1', reservationId, startedAt: 1_700_000_000_000,
      });
    } finally { await app.close(); }
  });

  it('does not acknowledge completion when the ledger rejects cross-org reservation metadata', async () => {
    mockRetentionPolicy({ recordCalls: true, dataRetentionDays: 0 });
    mockReconcileMinutes.mockRejectedValue(new Error('USAGE_RESERVATION_NOT_FOUND'));
    const app = await buildApp();
    try {
      const event = callEndedPayload(true);
      const body = JSON.stringify({ ...event, call: { ...event.call, metadata: { usage_reservation_id: '11111111-1111-4111-8111-111111111111' } } });
      const res = await app.inject({ method: 'POST', url: '/retell/webhook', payload: body,
        headers: { 'content-type': 'application/json', 'x-retell-signature': signatureFor(body) } });
      expect(res.statusCode).toBe(500);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
      expect(mockDeleteCall).not.toHaveBeenCalled();
      expect(mockAnalyzeCall).not.toHaveBeenCalled();
      expect(mockMergeTicketMetadata).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('retries the same ledger identity after settlement succeeds but event claiming fails', async () => {
    // This simulates the boundary after a ledger commit. Actual atomic ledger
    // deduplication is covered by usage-ledger PostgreSQL integration tests.
    mockQuery.mockRejectedValueOnce(new Error('synthetic claim failure'))
      .mockResolvedValue({ rowCount: 0, rows: [] });
    const app = await buildApp();
    try {
      const body = JSON.stringify(callEndedPayload(true));
      const send = () => app.inject({ method: 'POST', url: '/retell/webhook', payload: body,
        headers: { 'content-type': 'application/json', 'x-retell-signature': signatureFor(body) } });
      expect((await send()).statusCode).toBe(500);
      expect((await send()).statusCode).toBe(200);
      expect(mockReconcileMinutes).toHaveBeenCalledTimes(2);
      expect(mockReconcileMinutes.mock.calls[0]).toEqual(mockReconcileMinutes.mock.calls[1]);
      expect(mockQuery.mock.calls.every(([, params]) => params?.[1] === 'call_ended')).toBe(true);
      expect(mockDeleteCall).not.toHaveBeenCalled();
      expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('does not classify an ended customer call as an unknown agent when DB is unavailable', async () => {
    databaseAvailable = false;
    const app = await buildApp();
    try {
      const body = JSON.stringify(callEndedPayload(true));
      const res = await app.inject({ method: 'POST', url: '/retell/webhook', payload: body,
        headers: { 'content-type': 'application/json', 'x-retell-signature': signatureFor(body) } });
      expect(res.statusCode).toBe(503);
      expect(mockGetOrgIdByAgentId).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockReconcileMinutes).not.toHaveBeenCalled();
      expect(mockDeleteCall).not.toHaveBeenCalled();
      expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([
    { start_timestamp: undefined, end_timestamp: undefined, duration_ms: undefined },
    { end_timestamp: undefined, duration_ms: undefined },
    { start_timestamp: '1700000000000', duration_ms: undefined },
    { end_timestamp: 1_600_000_000_000, duration_ms: -1 },
    { start_timestamp: null, duration_ms: '60000' },
  ])('retries incomplete or invalid timing without a terminal claim (%j)', async (timing) => {
    const app = await buildApp();
    try {
      const event = callEndedPayload(true);
      const body = JSON.stringify({ ...event, call: { ...event.call, ...timing } });
      const res = await app.inject({ method: 'POST', url: '/retell/webhook', payload: body,
        headers: { 'content-type': 'application/json', 'x-retell-signature': signatureFor(body) } });
      expect(res.statusCode).toBe(503);
      expect(mockReconcileMinutes).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockDeleteCall).not.toHaveBeenCalled();
      expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([0, 61_000])('accepts signed duration %i without inventing a missing start timestamp', async (duration) => {
    mockRetentionPolicy({ recordCalls: true, dataRetentionDays: 0 });
    const app = await buildApp();
    try {
      const event = callEndedPayload(true);
      const reservationId = '11111111-1111-4111-8111-111111111111';
      const body = JSON.stringify({ ...event, call: { ...event.call,
        start_timestamp: undefined, end_timestamp: undefined, duration_ms: duration,
        metadata: { usage_reservation_id: reservationId } } });
      const res = await app.inject({ method: 'POST', url: '/retell/webhook', payload: body,
        headers: { 'content-type': 'application/json', 'x-retell-signature': signatureFor(body) } });
      expect(res.statusCode).toBe(200);
      expect(mockReconcileMinutes).toHaveBeenCalledWith('org-1', Math.round(duration / 600) / 100, {
        callId: 'call-with-transcript', agentId: 'agent-1', reservationId, startedAt: undefined,
      });
    } finally { await app.close(); }
  });

  it('also deletes no-transcript calls and does not fan out extracted variables', async () => {
    mockRetentionPolicy({ recordCalls: false, dataRetentionDays: 30 });
    const app = await buildApp();
    const body = JSON.stringify(callEndedPayload(false));

    const res = await app.inject({
      method: 'POST',
      url: '/retell/webhook',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': signatureFor(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(mockDeleteCall).toHaveBeenCalledWith('call-without-transcript');
    expect(mockMergeTicketMetadata).not.toHaveBeenCalled();
    expect(mockFireInboundWebhooks).toHaveBeenCalledWith(
      'org-1',
      'call.ended',
      expect.objectContaining({ variables: {} }),
    );
    await app.close();
  });

  it('tracks Retell retention for stored no-transcript calls', async () => {
    mockRetentionPolicy({ recordCalls: true, dataRetentionDays: 7 });
    const app = await buildApp();
    const body = JSON.stringify(callEndedPayload(false));

    const res = await app.inject({
      method: 'POST',
      url: '/retell/webhook',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': signatureFor(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(mockDeleteCall).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('INSERT INTO retell_call_retention'))).toBe(true);
    expect(mockFireInboundWebhooks).toHaveBeenCalledWith(
      'org-1',
      'call.ended',
      expect.objectContaining({ variables: { customer_name: 'Max' } }),
    );
    await app.close();
  });

  it('fails closed when retention policy lookup fails', async () => {
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('processed_retell_events')) {
        return { rowCount: 1, rows: [{ call_id: params?.[0] ?? 'call-1' }] };
      }
      if (text.includes('recording_declined_calls')) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes('FROM agent_configs')) {
        throw new Error('database unavailable');
      }
      return { rowCount: 1, rows: [] };
    });
    const app = await buildApp();
    const body = JSON.stringify(callEndedPayload(false));

    const res = await app.inject({
      method: 'POST',
      url: '/retell/webhook',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': signatureFor(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(500);
    expect(mockDeleteCall).not.toHaveBeenCalled();
    expect(mockMergeTicketMetadata).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('DELETE FROM processed_retell_events'))).toBe(true);
    await app.close();
  });

  it('fails closed when no retention policy row exists for a resolved org agent', async () => {
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('processed_retell_events')) {
        return { rowCount: 1, rows: [{ call_id: params?.[0] ?? 'call-1' }] };
      }
      if (text.includes('recording_declined_calls')) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes('FROM agent_configs')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    const app = await buildApp();
    const body = JSON.stringify(callEndedPayload(false));

    const res = await app.inject({
      method: 'POST',
      url: '/retell/webhook',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': signatureFor(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(500);
    expect(mockDeleteCall).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('DELETE FROM processed_retell_events'))).toBe(true);
    await app.close();
  });

  it('skips call_analyzed extraction side effects when recording was declined', async () => {
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('processed_retell_events')) {
        return { rowCount: 1, rows: [{ call_id: params?.[0] ?? 'call-analyzed-1' }] };
      }
      if (text.includes('recording_declined_calls')) {
        return { rowCount: 1, rows: [{ call_id: params?.[0] ?? 'call-analyzed-1' }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const app = await buildApp();
    const body = JSON.stringify(callAnalyzedPayload());

    const res = await app.inject({
      method: 'POST',
      url: '/retell/webhook',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': signatureFor(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, recordingDeclined: true });
    expect(mockDeleteCall).toHaveBeenCalledWith('call-analyzed-1');
    expect(mockMergeTicketMetadata).not.toHaveBeenCalled();
    expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
    await app.close();
  });

  it('deletes calls from unknown non-demo agents instead of acknowledging stored Retell data', async () => {
    mockGetOrgIdByAgentId.mockResolvedValueOnce(null);
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('processed_retell_events')) {
        return { rowCount: 1, rows: [{ call_id: params?.[0] ?? 'call-1' }] };
      }
      if (text.includes('recording_declined_calls')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    const app = await buildApp();
    const body = JSON.stringify(callEndedPayload(false));

    const res = await app.inject({
      method: 'POST',
      url: '/retell/webhook',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': signatureFor(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(mockDeleteCall).toHaveBeenCalledWith('call-without-transcript');
    expect(res.json()).toEqual({ ok: true, unknownAgentDeleted: true });
    await app.close();
  });

  it('does not delete known platform callback calls from the shared sales agent', async () => {
    mockGetOrgIdByAgentId.mockResolvedValueOnce(null);
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('processed_retell_events')) {
        return { rowCount: 1, rows: [{ call_id: params?.[0] ?? 'platform-callback-call' }] };
      }
      if (text.includes('recording_declined_calls')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    const app = await buildApp();
    const body = JSON.stringify(platformCallbackPayload());

    const res = await app.inject({
      method: 'POST',
      url: '/retell/webhook',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': signatureFor(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(mockDeleteCall).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('UPDATE outbound_calls'))).toBe(true);
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('UPDATE crm_leads'))).toBe(true);
    await app.close();
  });

  it('rolls back call_analyzed dedup when retention policy lookup fails', async () => {
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('processed_retell_events') && text.includes('INSERT INTO')) {
        return { rowCount: 1, rows: [{ call_id: params?.[0] ?? 'call-analyzed-1' }] };
      }
      if (text.includes('recording_declined_calls')) {
        return { rowCount: 0, rows: [] };
      }
      if (text.includes('FROM agent_configs')) {
        throw new Error('database unavailable');
      }
      return { rowCount: 1, rows: [] };
    });
    const app = await buildApp();
    const body = JSON.stringify(callAnalyzedPayload());

    const res = await app.inject({
      method: 'POST',
      url: '/retell/webhook',
      headers: {
        'content-type': 'application/json',
        'x-retell-signature': signatureFor(body),
      },
      payload: body,
    });

    expect(res.statusCode).toBe(500);
    expect(mockMergeTicketMetadata).not.toHaveBeenCalled();
    expect(mockFireInboundWebhooks).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('DELETE FROM processed_retell_events'))).toBe(true);
    await app.close();
  });
});
