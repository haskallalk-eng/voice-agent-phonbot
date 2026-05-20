import Fastify from 'fastify';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAppendTraceEvent = vi.fn(async () => {});
const mockCreateTicket = vi.fn();
const mockSendTicketAckSms = vi.fn();
const mockReadConfig = vi.fn();
const mockTriggerCallback = vi.fn();
const mockGetCall = vi.fn();

vi.mock('../db.js', () => ({
  pool: { query: mockQuery },
}));

vi.mock('../traces.js', () => ({
  appendTraceEvent: mockAppendTraceEvent,
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
  readConfig: mockReadConfig,
  triggerCallback: mockTriggerCallback,
}));

vi.mock('../customers.js', () => ({
  customerModuleActiveForAgentConfig: vi.fn(() => false),
  getActiveCustomerDetailsKeys: vi.fn(() => new Set()),
  normalizeCustomerModuleConfig: vi.fn(() => ({ active: false })),
  lookupCustomer: vi.fn(),
  upsertCustomer: vi.fn(),
}));

vi.mock('../tickets.js', () => ({
  createTicket: mockCreateTicket,
  mergeTicketMetadata: vi.fn(async () => {}),
}));

vi.mock('../sms.js', () => ({
  sendBookingConfirmationSms: vi.fn(),
  sendTicketAckSms: mockSendTicketAckSms,
  sendSignupLinkSms: vi.fn(),
  sendDemoBookingConfirmationSms: vi.fn(),
  signupLinkUrl: vi.fn(() => 'https://phonbot.de/login'),
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

const SECRET = 'retell-ticket-tool-test';

function signToolContext(tenantId: string, agentId: string): string {
  return crypto.createHmac('sha256', SECRET).update(`${tenantId}:${agentId}`).digest('base64url');
}

function signedUrl(path: string) {
  const params = new URLSearchParams({
    tenant_id: 'tenant-1',
    tool_agent_id: 'agent-real',
    tool_sig: signToolContext('tenant-1', 'agent-real'),
  });
  return `${path}?${params.toString()}`;
}

async function postTicket(args: Record<string, unknown>) {
  const app = Fastify({ logger: false });
  await registerRetellWebhooks(app);
  await app.ready();
  try {
    return await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/ticket.create'),
      payload: {
        _retell_call_id: 'call-ticket-1',
        args,
      },
    });
  } finally {
    await app.close();
  }
}

describe('Retell ticket.create callback safety', () => {
  beforeEach(() => {
    process.env.RETELL_TOOL_AUTH_SECRET = SECRET;
    mockQuery.mockReset();
    mockAppendTraceEvent.mockClear();
    mockCreateTicket.mockReset();
    mockSendTicketAckSms.mockReset();
    mockReadConfig.mockReset();
    mockTriggerCallback.mockReset();
    mockGetCall.mockReset();
    mockGetCall.mockResolvedValue({
      call_id: 'call-ticket-1',
      agent_id: 'agent-real',
      call_status: 'ongoing',
    });
    mockReadConfig.mockResolvedValue({ fallback: { reason: 'handoff' } });
    mockSendTicketAckSms.mockResolvedValue({ ok: false, error: 'SMS_DISABLED' });
    mockTriggerCallback.mockResolvedValue({ ok: true, callId: 'callback-1' });
    mockCreateTicket.mockResolvedValue({
      id: 'ticket-1',
      status: 'open',
      reused: false,
      reason: 'Allgemeine Uebergabe',
      customer_name: 'Max',
      customer_phone: 'unknown',
      preferred_time: null,
      service: null,
      notes: null,
    });
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT org_id FROM agent_configs WHERE tenant_id')) {
        return { rows: [{ org_id: 'org-1' }], rowCount: 1 };
      }
      if (text.includes('FROM agent_configs') && text.includes("data->>'retellAgentId'")) {
        return { rows: [{ tenant_id: 'tenant-1', org_id: 'org-1' }], rowCount: 1 };
      }
      if (text.includes('SELECT name FROM orgs')) {
        return { rows: [{ name: 'Phonbot Test' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('does not auto-callback a model-supplied phone unless the caller confirmed it', async () => {
    const res = await postTicket({
      customerName: 'Max',
      customerPhone: '+491701234567',
      callbackRequested: true,
      preferredTime: 'jetzt',
      customerPhoneConfirmed: false,
    });

    expect(res.statusCode).toBe(200);
    expect(mockCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({ customerPhone: 'unknown' }),
      expect.objectContaining({ allowUnverifiedPhone: true }),
    );
    expect(mockTriggerCallback).not.toHaveBeenCalled();
    expect(res.json()).toMatchObject({
      ok: true,
      callbackScheduled: false,
    });
  });
});
