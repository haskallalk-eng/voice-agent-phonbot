import Fastify from 'fastify';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAppendTraceEvent = vi.fn(async () => {});
const mockReadConfig = vi.fn();
const mockLookupCustomer = vi.fn();
const mockUpsertCustomer = vi.fn();
const mockCustomerModuleActiveForAgentConfig = vi.fn(() => true);
const mockNormalizeCustomerModuleConfig = vi.fn(() => ({ active: true }));
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
  triggerCallback: vi.fn(),
}));

vi.mock('../customers.js', () => ({
  customerModuleActiveForAgentConfig: mockCustomerModuleActiveForAgentConfig,
  getActiveCustomerDetailsKeys: vi.fn(() => new Set()),
  normalizeCustomerModuleConfig: mockNormalizeCustomerModuleConfig,
  lookupCustomer: mockLookupCustomer,
  upsertCustomer: mockUpsertCustomer,
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

const SECRET = 'retell-customer-lookup-test';

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

async function postCustomerTool(path: string, args: Record<string, unknown>, extraPayload: Record<string, unknown> = {}) {
  const app = Fastify({ logger: false });
  await registerRetellWebhooks(app);
  await app.ready();
  try {
    return await app.inject({
      method: 'POST',
      url: signedUrl(path),
      payload: {
        _retell_call_id: 'call-lookup-1',
        from_number: '+491701234567',
        args,
        ...extraPayload,
      },
    });
  } finally {
    await app.close();
  }
}

async function postCustomerLookup(args: Record<string, unknown>) {
  return postCustomerTool('/retell/tools/customer.lookup', args);
}

const privateCustomer = {
  id: 'cust-private',
  full_name: 'Anna Vertraulich',
  customer_type: 'existing',
  status: 'active',
  last_seen_at: '2026-05-01T10:00:00.000Z',
};

describe('Retell customer.lookup privacy contract', () => {
  beforeEach(() => {
    process.env.RETELL_TOOL_AUTH_SECRET = SECRET;
    mockQuery.mockReset();
    mockAppendTraceEvent.mockClear();
    mockLookupCustomer.mockReset();
    mockUpsertCustomer.mockReset();
    mockGetCall.mockReset();
    mockGetCall.mockResolvedValue({
      call_id: 'call-lookup-1',
      agent_id: 'agent-real',
      from_number: '+491701234567',
      call_status: 'ongoing',
    });
    mockReadConfig.mockResolvedValue({ customerModule: { active: true } });
    mockCustomerModuleActiveForAgentConfig.mockReturnValue(true);
    mockNormalizeCustomerModuleConfig.mockReturnValue({ active: true });
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

  it('does not expose customer identity or ids for name-only matches', async () => {
    mockLookupCustomer.mockResolvedValue({
      ok: true,
      status: 'matched',
      matchType: 'name',
      customer: privateCustomer,
      candidates: [{ ...privateCustomer, score: 0.92 }],
      instruction: 'Name erkannt.',
    });

    const res = await postCustomerLookup({ customerName: 'Anna Vertraulich' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.status).toBe('identity_required');
    expect(body.candidateCount).toBe(1);
    expect(JSON.stringify(body)).not.toContain('Anna Vertraulich');
    expect(JSON.stringify(body)).not.toContain('cust-private');
    expect(body.customer).toBeUndefined();
    expect(body.candidates).toBeUndefined();
  });

  it('keeps exact phone matches minimal and does not return names or internal ids', async () => {
    mockLookupCustomer.mockResolvedValue({
      ok: true,
      status: 'matched',
      matchType: 'phone',
      customer: privateCustomer,
      instruction: 'Nummer erkannt.',
    });

    const res = await postCustomerLookup({ customerPhone: '+491701234567' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.status).toBe('matched');
    expect(body.matchType).toBe('phone');
    expect(body.customer).toEqual({
      customerType: 'existing',
      status: 'active',
      lastSeenAt: '2026-05-01T10:00:00.000Z',
    });
    expect(JSON.stringify(body)).not.toContain('Anna Vertraulich');
    expect(JSON.stringify(body)).not.toContain('cust-private');
  });

  it('does not trust model-supplied customerPhone for customer.upsert identity', async () => {
    mockUpsertCustomer.mockResolvedValue({
      id: 'cust-saved',
      full_name: 'Max Mustermann',
    });

    const res = await postCustomerTool('/retell/tools/customer.upsert', {
      customerName: 'Max Mustermann',
      customerPhone: '+49999999999',
      service: 'Schnitt',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(mockUpsertCustomer).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+491701234567',
    }));
    expect(JSON.stringify(body)).not.toContain('cust-saved');
    expect(body.customerId).toBeUndefined();
  });
});
