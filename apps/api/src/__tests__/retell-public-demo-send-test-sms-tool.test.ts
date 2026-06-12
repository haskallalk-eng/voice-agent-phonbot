import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAppendTraceEvent = vi.fn(async () => {});
const mockGetCall = vi.fn();

vi.mock('../db.js', () => ({
  pool: null,
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
const { PUBLIC_DEMO_TEST_LINK, publicDemoSmsToolSignature } = await import('../public-demo-sms-tool.js');

function signedUrl() {
  return `/retell/tools/demo_send_test_sms?demo_sig=${publicDemoSmsToolSignature()}`;
}

async function postPublicDemoSms(args: Record<string, unknown>, url = signedUrl()) {
  const app = Fastify({ logger: false });
  await registerRetellWebhooks(app);
  await app.ready();
  try {
    return await app.inject({
      method: 'POST',
      url,
      payload: {
        _retell_call_id: 'call-public-demo-1',
        _retell_agent_id: 'agent-public-demo',
        args,
      },
    });
  } finally {
    await app.close();
  }
}

describe('Retell public demo send_test_sms tool', () => {
  beforeEach(() => {
    process.env.RETELL_TOOL_AUTH_SECRET = 'public-demo-sms-test';
    mockAppendTraceEvent.mockClear();
    mockGetCall.mockReset();
    mockGetCall.mockResolvedValue({
      call_id: 'call-public-demo-1',
      agent_id: 'agent-public-demo',
      from_number: '+491701234567',
      call_status: 'ongoing',
    });
  });

  it('returns a simulated SMS with a test link and never reports real SMS delivery', async () => {
    const res = await postPublicDemoSms({
      smsKind: 'appointment_confirmation',
      customerName: 'Hassib',
      service: 'Herrenschnitt',
      date: 'morgen',
      time: 'zehn Uhr',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      smsSent: false,
    });
    expect(res.json().message).toContain('Simulierte Demo-SMS');
    expect(res.json().message).toContain('Herrenschnitt');
    expect(res.json().message).toContain(PUBLIC_DEMO_TEST_LINK);
    expect(res.json().instruction).toContain('keine echte SMS');
    expect(mockAppendTraceEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'demo:phone',
      tool: 'demo_send_test_sms',
      output: expect.objectContaining({
        simulated: true,
        simulatedSmsSent: true,
        testLink: PUBLIC_DEMO_TEST_LINK,
      }),
    }));
  });

  it('fails closed without the demo tool signature', async () => {
    const res = await postPublicDemoSms({ smsKind: 'test_link' }, '/retell/tools/demo_send_test_sms');

    expect(res.statusCode).toBe(401);
  });
});
