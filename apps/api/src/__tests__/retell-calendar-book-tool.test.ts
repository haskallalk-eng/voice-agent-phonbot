import Fastify from 'fastify';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAppendTraceEvent = vi.fn(async () => {});
const mockBookSlot = vi.fn();
const mockBookSlotForAnyStaff = vi.fn();
const mockCreateTicket = vi.fn();
const mockSendTicketAckSms = vi.fn();
const mockSendBookingConfirmationSms = vi.fn();
const mockReadConfig = vi.fn();
const mockLookupCustomer = vi.fn();
const mockUpsertCustomer = vi.fn();

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
  bookSlotForAnyStaff: mockBookSlotForAnyStaff,
  findChipyBookingsForChange: vi.fn(),
  cancelChipyBookingForChange: vi.fn(),
  rescheduleChipyBookingForChange: vi.fn(),
}));

vi.mock('../agent-config.js', () => ({
  readConfig: mockReadConfig,
  triggerCallback: vi.fn(),
}));

vi.mock('../customers.js', () => ({
  customerModuleActiveForAgentConfig: vi.fn(() => false),
  getActiveCustomerDetailsKeys: vi.fn(() => new Set()),
  normalizeCustomerModuleConfig: vi.fn(() => ({ active: false })),
  lookupCustomer: mockLookupCustomer,
  upsertCustomer: mockUpsertCustomer,
}));

vi.mock('../tickets.js', () => ({
  createTicket: mockCreateTicket,
  mergeTicketMetadata: vi.fn(async () => {}),
}));

vi.mock('../sms.js', () => ({
  sendBookingConfirmationSms: mockSendBookingConfirmationSms,
  sendTicketAckSms: mockSendTicketAckSms,
}));

const { registerRetellWebhooks } = await import('../retell-webhooks.js');

const SECRET = 'retell-calendar-book-test';

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

async function postCalendarBook(args: Record<string, unknown>) {
  const app = Fastify({ logger: false });
  await registerRetellWebhooks(app);
  await app.ready();
  try {
    return await app.inject({
      method: 'POST',
      url: signedUrl('/retell/tools/calendar.book'),
      payload: {
        _retell_call_id: 'call-1',
        args,
      },
    });
  } finally {
    await app.close();
  }
}

describe('Retell calendar.book tool contract', () => {
  beforeEach(() => {
    process.env.RETELL_TOOL_AUTH_SECRET = SECRET;
    mockQuery.mockReset();
    mockAppendTraceEvent.mockClear();
    mockBookSlot.mockReset();
    mockBookSlotForAnyStaff.mockReset();
    mockCreateTicket.mockReset();
    mockSendTicketAckSms.mockReset();
    mockSendBookingConfirmationSms.mockReset();
    mockReadConfig.mockReset();
    mockLookupCustomer.mockReset();
    mockUpsertCustomer.mockReset();

    mockReadConfig.mockResolvedValue({});
    mockLookupCustomer.mockResolvedValue({ ok: true, status: 'not_found', customer: null });
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT org_id FROM agent_configs WHERE tenant_id')) {
        return { rows: [{ org_id: 'org-1' }], rowCount: 1 };
      }
      if (text.includes('FROM agent_configs') && text.includes("data->>'retellAgentId'")) {
        return { rows: [{ tenant_id: 'tenant-1', org_id: 'org-1' }], rowCount: 1 };
      }
      if (text.includes('FROM calendar_staff')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT name FROM orgs')) {
        return { rows: [{ name: 'Phonbot Test' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('refuses to book before explicit confirmation', async () => {
    const res = await postCalendarBook({
      customerName: 'Max Mustermann',
      customerPhone: '+4917612345678',
      preferredTime: '10.05.2026 10 Uhr',
      service: 'Beratung',
      confirmed: false,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: false,
      status: 'confirmation_required',
      error: 'CONFIRMATION_REQUIRED',
    });
    expect(mockBookSlot).not.toHaveBeenCalled();
    expect(mockCreateTicket).not.toHaveBeenCalled();
  });

  it('refuses to book when the customer name is missing or generic', async () => {
    const res = await postCalendarBook({
      customerName: 'Kunde',
      customerPhone: '+4917612345678',
      preferredTime: '10.05.2026 10 Uhr',
      service: 'Beratung',
      confirmed: true,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: false,
      status: 'customer_name_required',
      error: 'CUSTOMER_NAME_REQUIRED',
    });
    expect(mockBookSlot).not.toHaveBeenCalled();
    expect(mockCreateTicket).not.toHaveBeenCalled();
  });

  it('rejects past slots without creating a fallback ticket', async () => {
    mockBookSlot.mockResolvedValue({ ok: false, error: 'PAST_SLOT' });

    const res = await postCalendarBook({
      customerName: 'Max Mustermann',
      customerPhone: '+4917612345678',
      preferredTime: '18.04.2025 18 Uhr',
      service: 'Beratung',
      confirmed: true,
    });

    expect(res.statusCode).toBe(200);
    expect(mockBookSlot).toHaveBeenCalledTimes(1);
    expect(mockCreateTicket).not.toHaveBeenCalled();
    expect(res.json()).toMatchObject({
      ok: false,
      status: 'past_time_rejected',
      error: 'PAST_SLOT',
      fallback: false,
    });
  });

  it('keeps failed calendar booking plus fallback ticket as ok=false', async () => {
    mockBookSlot.mockResolvedValue({ ok: false, error: 'External calendar unavailable: google' });
    mockCreateTicket.mockResolvedValue({
      id: 'ticket-1',
      status: 'open',
      reused: false,
      customer_phone: '+4917612345678',
    });
    mockSendTicketAckSms.mockResolvedValue({ ok: false, error: 'SMS_DISABLED' });

    const res = await postCalendarBook({
      customerName: 'Max Mustermann',
      customerPhone: '+4917612345678',
      preferredTime: '10.05.2026 10 Uhr',
      service: 'Beratung',
      confirmed: true,
    });

    expect(res.statusCode).toBe(200);
    expect(mockBookSlot).toHaveBeenCalledTimes(1);
    expect(mockCreateTicket).toHaveBeenCalledTimes(1);
    expect(res.json()).toMatchObject({
      ok: false,
      status: 'fallback_ticket_created',
      fallback: true,
      ticketId: 'ticket-1',
      smsSent: false,
      deliveryInstruction: 'Keine SMS-Bestaetigung behaupten; smsSent ist false.',
    });
  });
});
