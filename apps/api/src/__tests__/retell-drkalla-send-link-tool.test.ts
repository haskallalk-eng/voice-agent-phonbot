import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAppendTraceEvent = vi.fn(async () => {});
const mockGetCall = vi.fn();
const mockSendSms = vi.fn();

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
  formatSpokenSlotLabel: vi.fn(),
}));

vi.mock('../agent-config.js', () => ({
  readConfig: vi.fn(),
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
  sendSignupLinkSms: vi.fn(),
  sendDemoBookingConfirmationSms: vi.fn(),
  signupLinkUrl: vi.fn(() => 'https://phonbot.de/login'),
  sendSms: mockSendSms,
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
const { drkallaLinkToolSignature } = await import('../drkalla-link-tool.js');

function signedUrl() {
  return `/retell/tools/drkalla.send_link?drkalla_sig=${drkallaLinkToolSignature()}`;
}

async function postDrkallaLink(args: Record<string, unknown>) {
  const app = Fastify({ logger: false });
  await registerRetellWebhooks(app);
  await app.ready();
  try {
    return await app.inject({
      method: 'POST',
      url: signedUrl(),
      payload: {
        _retell_call_id: 'call-drkalla-1',
        _retell_agent_id: 'agent-drkalla',
        args,
      },
    });
  } finally {
    await app.close();
  }
}

describe('Retell DrKalla send_link tool', () => {
  beforeEach(() => {
    process.env.RETELL_TOOL_AUTH_SECRET = 'drkalla-link-test';
    mockQuery.mockReset();
    mockAppendTraceEvent.mockClear();
    mockGetCall.mockReset();
    mockSendSms.mockReset();
    mockGetCall.mockResolvedValue({
      call_id: 'call-drkalla-1',
      agent_id: 'agent-drkalla',
      from_number: '+491701234567',
      call_status: 'ongoing',
    });
    mockSendSms.mockResolvedValue({ ok: true, to: '+491701234567', sid: 'SM123' });
  });

  it('sends an official DrKalla link to the verified caller phone and lets the model claim only after success', async () => {
    const res = await postDrkallaLink({
      url: 'https://drkalla.com/products/lattafa-fakhar#details',
      label: 'Lattafa Fakhar',
      linkKind: 'product',
      customerPhone: '+499999999',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, smsSent: true });
    expect(mockSendSms).toHaveBeenCalledWith(expect.objectContaining({
      to: '+491701234567',
      kind: 'drkalla_link',
      body: expect.stringContaining('Lattafa Fakhar - https://drkalla.com/products/lattafa-fakhar'),
    }));
    expect(mockSendSms.mock.calls[0]?.[0]?.to).not.toBe('+499999999');
  });

  it('does not send the same DrKalla link twice in one live call', async () => {
    const first = await postDrkallaLink({
      url: 'https://drkalla.com/products/duplicate-test',
      label: 'Duplicate Test',
      linkKind: 'product',
    });
    const second = await postDrkallaLink({
      url: 'https://drkalla.com/products/duplicate-test',
      label: 'Duplicate Test',
      linkKind: 'product',
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, smsSent: true });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true, smsSent: false, duplicate: true });
    expect(mockSendSms).toHaveBeenCalledTimes(1);
  });

  it('blocks non-DrKalla links and instructs the model not to claim SMS delivery', async () => {
    const res = await postDrkallaLink({
      url: 'https://evil.example/products/lattafa-fakhar',
      label: 'Lattafa Fakhar',
      linkKind: 'product',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: false,
      smsSent: false,
      error: 'INVALID_DRKALLA_LINK',
    });
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('fails closed without the DrKalla tool signature', async () => {
    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/retell/tools/drkalla.send_link',
      payload: { args: { url: 'https://drkalla.com', label: 'Shop' } },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
    expect(mockSendSms).not.toHaveBeenCalled();
  });
});
