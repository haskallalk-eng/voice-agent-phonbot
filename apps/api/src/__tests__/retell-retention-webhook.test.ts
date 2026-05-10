import Fastify from 'fastify';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'retell-retention-test-key';
vi.stubEnv('RETELL_API_KEY', SECRET);
vi.stubEnv('NODE_ENV', 'test');

const mockQuery = vi.fn(async (_sql: unknown, _params?: unknown[]) => ({ rowCount: 1, rows: [] as unknown[] }));
const mockDeleteCall = vi.fn(async (_callId: unknown) => {});
const mockGetOrgIdByAgentId = vi.fn(async (_agentId: unknown): Promise<string | null> => 'org-1');
const mockReconcileMinutes = vi.fn(async (_orgId: unknown, _reserved: unknown, _minutes: unknown, _agentId: unknown, _callId: unknown) => {});
const mockMergeTicketMetadata = vi.fn(async (_callId: unknown, _orgId: unknown, _extracted: unknown) => {});
const mockFireInboundWebhooks = vi.fn(async (_orgId: unknown, _event: unknown, _payload: unknown) => {});
const mockAnalyzeCall = vi.fn(async (_orgId: unknown, _callId: unknown, _transcript: unknown, _metadata: unknown) => {});
const mockAnalyzeOutboundCall = vi.fn(async (_orgId: unknown, _callId: unknown, _transcript: unknown, _duration: unknown) => {});

vi.mock('../db.js', () => ({
  pool: { query: (sql: unknown, params?: unknown[]) => mockQuery(sql, params) },
}));

vi.mock('../tickets.js', () => ({
  createTicket: vi.fn(),
  mergeTicketMetadata: (callId: unknown, orgId: unknown, extracted: unknown) => mockMergeTicketMetadata(callId, orgId, extracted),
}));

vi.mock('../traces.js', () => ({ appendTraceEvent: vi.fn(async () => {}) }));
vi.mock('../usage.js', () => ({
  reconcileMinutes: (orgId: unknown, reserved: unknown, minutes: unknown, agentId: unknown, callId: unknown) =>
    mockReconcileMinutes(orgId, reserved, minutes, agentId, callId),
  DEFAULT_CALL_RESERVE_MINUTES: 5,
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
vi.mock('../phone.js', () => ({ checkForwardingVerificationMatch: vi.fn(async () => {}) }));
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
}));
vi.mock('../pii.js', () => ({ redactPII: (value: string) => value }));
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
    mockQuery.mockReset();
    mockDeleteCall.mockClear();
    mockGetOrgIdByAgentId.mockClear();
    mockReconcileMinutes.mockClear();
    mockMergeTicketMetadata.mockClear();
    mockFireInboundWebhooks.mockClear();
    mockAnalyzeCall.mockClear();
    mockAnalyzeOutboundCall.mockClear();
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
