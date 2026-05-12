import Fastify from 'fastify';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAppendTraceEvent = vi.fn(async () => {});
const mockReadConfig = vi.fn();
const mockFindChipyBookingsForChange = vi.fn();
const mockCancelChipyBookingForChange = vi.fn();
const mockRescheduleChipyBookingForChange = vi.fn();
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
  findChipyBookingsForChange: mockFindChipyBookingsForChange,
  cancelChipyBookingForChange: mockCancelChipyBookingForChange,
  rescheduleChipyBookingForChange: mockRescheduleChipyBookingForChange,
}));

vi.mock('../agent-config.js', () => ({
  readConfig: mockReadConfig,
  triggerCallback: vi.fn(),
}));

vi.mock('../customers.js', () => ({
  customerModuleActiveForAgentConfig: vi.fn(() => false),
  getActiveCustomerDetailsKeys: vi.fn(() => new Set()),
  normalizeCustomerModuleConfig: vi.fn(() => ({ active: false })),
  lookupCustomer: vi.fn(),
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

const SECRET = 'retell-calendar-change-test';

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

async function postTool(path: string, args: Record<string, unknown>) {
  const app = Fastify({ logger: false });
  await registerRetellWebhooks(app);
  await app.ready();
  try {
    return await app.inject({
      method: 'POST',
      url: signedUrl(path),
      payload: {
        _retell_call_id: 'call-change-1',
        from_number: '+491701234567',
        args,
      },
    });
  } finally {
    await app.close();
  }
}

describe('Retell calendar change tools privacy contract', () => {
  beforeEach(() => {
    process.env.RETELL_TOOL_AUTH_SECRET = SECRET;
    mockQuery.mockReset();
    mockAppendTraceEvent.mockClear();
    mockFindChipyBookingsForChange.mockReset();
    mockCancelChipyBookingForChange.mockReset();
    mockRescheduleChipyBookingForChange.mockReset();
    mockGetCall.mockReset();
    mockGetCall.mockResolvedValue({
      call_id: 'call-change-1',
      agent_id: 'agent-real',
      from_number: '+491701234567',
      call_status: 'ongoing',
    });
    mockReadConfig.mockResolvedValue({});
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

  it('uses verified caller phone and never trusts spoofed model phone for findBookings', async () => {
    mockFindChipyBookingsForChange.mockResolvedValue({
      ok: true,
      status: 'found',
      matches: [{ changeToken: 'change-token', service: 'Schnitt', startAt: '2026-05-15T10:00:00.000Z', label: '2026-05-15 10:00', spokenLabel: 'Freitag um zehn Uhr' }],
      instruction: 'Bestaetigen lassen.',
    });

    const res = await postTool('/retell/tools/calendar.findBookings', {
      bookingId: 'raw-booking-id',
      customerPhone: '+49999999999',
      customerName: 'Max',
      currentTime: 'Freitag 10 Uhr',
    });

    expect(res.statusCode).toBe(200);
    expect(mockFindChipyBookingsForChange).toHaveBeenCalledWith('org-1', expect.objectContaining({
      customerPhone: '+491701234567',
      identityVerified: true,
      sourceCallId: 'call-change-1',
    }));
    expect(mockFindChipyBookingsForChange.mock.calls[0]?.[1]).not.toHaveProperty('bookingId');
  });

  it('passes only changeToken into cancel mutations', async () => {
    mockCancelChipyBookingForChange.mockResolvedValue({
      ok: true,
      status: 'cancelled',
      partial: false,
    });

    const res = await postTool('/retell/tools/calendar.cancel', {
      confirmed: true,
      bookingId: 'raw-booking-id',
      changeToken: 'change-token',
      customerPhone: '+49999999999',
    });

    expect(res.statusCode).toBe(200);
    expect(mockCancelChipyBookingForChange).toHaveBeenCalledWith('org-1', expect.objectContaining({
      changeToken: 'change-token',
      customerPhone: '+491701234567',
      identityVerified: true,
      sourceCallId: 'call-change-1',
    }));
    expect(mockCancelChipyBookingForChange.mock.calls[0]?.[1]).not.toHaveProperty('bookingId');
  });

  it('does not call cancel before explicit confirmation', async () => {
    const res = await postTool('/retell/tools/calendar.cancel', {
      changeToken: 'change-token',
      confirmed: false,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, status: 'confirmation_required' });
    expect(mockCancelChipyBookingForChange).not.toHaveBeenCalled();
  });
});
