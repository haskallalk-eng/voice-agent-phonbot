import Fastify from 'fastify';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAppendTraceEvent = vi.fn(async () => {});
const mockGetCall = vi.fn();

vi.mock('../db.js', () => ({
  pool: { query: mockQuery },
}));

vi.mock('../traces.js', () => ({
  appendTraceEvent: mockAppendTraceEvent,
}));

vi.mock('../retell.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../retell.js')>();
  return {
    ...actual,
    getCall: mockGetCall,
    deleteCall: vi.fn(),
  };
});

const { registerRetellWebhooks } = await import('../retell-webhooks.js');

const SECRET = 'retell-tool-auth-test';

function signToolContext(tenantId: string, agentId?: string): string {
  const payload = agentId ? `${tenantId}:${agentId}` : tenantId;
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function signedUrl(path: string, tenantId: string, agentId?: string) {
  const params = new URLSearchParams({
    tenant_id: tenantId,
    tool_sig: signToolContext(tenantId, agentId),
  });
  if (agentId) params.set('tool_agent_id', agentId);
  return `${path}?${params.toString()}`;
}

describe('Retell tool authentication', () => {
  beforeEach(() => {
    process.env.RETELL_TOOL_AUTH_SECRET = SECRET;
    mockQuery.mockReset();
    mockAppendTraceEvent.mockClear();
    mockGetCall.mockReset();
    mockGetCall.mockResolvedValue({
      call_id: 'call-1',
      agent_id: 'agent-real',
      from_number: '+491701234567',
      call_status: 'ongoing',
    });
  });

  it('rejects body-only agent_id on mutating tool endpoints', async () => {
    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/retell/tools/calendar.book',
      payload: {
        agent_id: 'agent_known_to_attacker',
        args: {
          customerName: 'Test Kunde',
          customerPhone: '+4915111111111',
          preferredTime: 'Mo 10:00',
          service: 'Test',
        },
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
    await app.close();
  });

  it('rejects legacy tenant-only signed tool URLs before mutation', async () => {
    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/recording.declined', 'tenant-1'),
      payload: {
        _retell_call_id: 'call-1',
        _retell_agent_id: 'agent-1',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'tool tenant mismatch', code: 'SIGNED_AGENT_REQUIRED' });
    expect(mockQuery).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects signed mutating tool calls without a live Retell call id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ org_id: 'org-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', org_id: 'org-1' }], rowCount: 1 });

    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/calendar.book', 'tenant-1', 'agent-real'),
      payload: {
        _retell_agent_id: 'agent-real',
        args: {
          customerName: 'Test Kunde',
          customerPhone: '+4915111111111',
          preferredTime: 'Mo 10:00',
          service: 'Test',
          confirmed: true,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'CALL_ID_REQUIRED' });
    expect(mockAppendTraceEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects signed mutating tool calls for ended Retell calls', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ org_id: 'org-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', org_id: 'org-1' }], rowCount: 1 });
    mockGetCall.mockResolvedValueOnce({
      call_id: 'call-ended',
      agent_id: 'agent-real',
      from_number: '+491701234567',
      call_status: 'ended',
      end_timestamp: Date.now(),
    });

    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/calendar.book', 'tenant-1', 'agent-real'),
      payload: {
        _retell_call_id: 'call-ended',
        _retell_agent_id: 'agent-real',
        args: {
          customerName: 'Test Kunde',
          customerPhone: '+4915111111111',
          preferredTime: 'Mo 10:00',
          service: 'Test',
          confirmed: true,
        },
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'CALL_NOT_ACTIVE' });
    await app.close();
  });

  it('still stores recording decline for an already-ended Retell call', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ org_id: 'org-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', org_id: 'org-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockGetCall.mockResolvedValueOnce({
      call_id: 'call-ended',
      agent_id: 'agent-real',
      from_number: '+491701234567',
      call_status: 'ended',
      end_timestamp: Date.now(),
    });

    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/recording.declined', 'tenant-1', 'agent-real'),
      payload: {
        _retell_call_id: 'call-ended',
        _retell_agent_id: 'agent-real',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(String(mockQuery.mock.calls[2]?.[0])).toContain('INSERT INTO recording_declined_calls');
    await app.close();
  });

  it('fail-closes recording decline storage when Retell getCall is temporarily unavailable', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ org_id: 'org-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', org_id: 'org-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockGetCall.mockRejectedValueOnce(new Error('retell unavailable'));

    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/recording.declined', 'tenant-1', 'agent-real'),
      payload: {
        _retell_call_id: 'call-race',
        _retell_agent_id: 'agent-real',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(String(mockQuery.mock.calls[2]?.[0])).toContain('INSERT INTO recording_declined_calls');
    await app.close();
  });

  it('rejects a body agent_id that does not match the signed tool agent', async () => {
    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/recording.declined', 'tenant-1', 'agent-real'),
      payload: {
        _retell_call_id: 'call-1',
        _retell_agent_id: 'agent-other',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'tool tenant mismatch', code: 'TENANT_AGENT_MISMATCH' });
    expect(mockQuery).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts a signed tenant+agent URL without trusting body agent_id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ org_id: 'org-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', org_id: 'org-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/recording.declined', 'tenant-1', 'agent-real'),
      payload: {
        _retell_call_id: 'call-1',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[1]?.[1]).toEqual(['agent-real', 'tenant-1']);
    await app.close();
  });

  it('does not treat external tool args.agent_id as Retell context when the URL is signed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ org_id: 'org-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', org_id: 'org-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/recording.declined', 'tenant-1', 'agent-real'),
      payload: {
        _retell_call_id: 'call-1',
        args: {
          agent_id: 'customer-crm-agent-42',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockQuery.mock.calls[1]?.[1]).toEqual(['agent-real', 'tenant-1']);
    await app.close();
  });
});
