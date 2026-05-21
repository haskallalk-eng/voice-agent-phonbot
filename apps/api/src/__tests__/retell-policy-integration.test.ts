import Fastify from 'fastify';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAppendTraceEvent = vi.fn(async () => {});
const mockBookSlot = vi.fn();
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
  bookSlot: mockBookSlot,
  bookSlotForAnyStaff: vi.fn(),
  findChipyBookingsForChange: vi.fn(),
  cancelChipyBookingForChange: vi.fn(),
  rescheduleChipyBookingForChange: vi.fn(),
  formatSpokenSlotLabel: vi.fn(),
}));

vi.mock('../agent-config.js', () => ({
  readConfig: vi.fn(async () => ({})),
  triggerCallback: vi.fn(),
}));

vi.mock('../customers.js', () => ({
  customerModuleActiveForAgentConfig: vi.fn(() => false),
  getActiveCustomerDetailsKeys: vi.fn(() => new Set()),
  normalizeCustomerModuleConfig: vi.fn(() => ({ active: false })),
  lookupCustomer: vi.fn(async () => ({ ok: true, status: 'not_found', customer: null })),
  upsertCustomer: vi.fn(),
}));

vi.mock('../tickets.js', () => ({
  createTicket: vi.fn(),
  mergeTicketMetadata: vi.fn(async () => {}),
}));

vi.mock('../sms.js', () => ({
  sendBookingConfirmationSms: vi.fn(),
  sendTicketAckSms: vi.fn(),
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

const SECRET = 'retell-policy-integration-test';

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

describe('Retell policy integration', () => {
  beforeEach(() => {
    process.env.RETELL_TOOL_AUTH_SECRET = SECRET;
    mockQuery.mockReset();
    mockAppendTraceEvent.mockClear();
    mockBookSlot.mockReset();
    mockGetCall.mockReset();
    mockGetCall.mockResolvedValue({
      call_id: 'call-live',
      agent_id: 'agent-real',
      from_number: '+491701234567',
      call_status: 'ongoing',
    });
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT org_id FROM agent_configs WHERE tenant_id')) {
        return { rows: [{ org_id: 'org-1' }], rowCount: 1 };
      }
      if (text.includes('FROM agent_configs') && text.includes("data->>'retellAgentId'")) {
        return { rows: [{ tenant_id: 'tenant-1', org_id: 'org-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('blocks calendar.book without confirmed=true before backend mutation', async () => {
    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/calendar.book'),
      payload: {
        _retell_call_id: 'call-live',
        _retell_agent_id: 'agent-real',
        args: {
          customerName: 'Mina',
          service: 'Haarschnitt',
          preferredTime: '22.05.2026 10 Uhr',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: false,
      status: 'blocked',
      error: 'CONFIRMATION_REQUIRED',
    });
    expect(mockBookSlot).not.toHaveBeenCalled();
    await app.close();
  });
});

