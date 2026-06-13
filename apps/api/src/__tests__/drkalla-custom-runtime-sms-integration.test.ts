import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mirror the send_link tool test mocks so registerRetellWebhooks boots with no
// real DB/SMS/Retell, then prove the custom-runtime WS executor actually
// reaches the policied send_link endpoint via app.inject end to end.
const mockQuery = vi.fn();
const mockAppendTraceEvent = vi.fn(async () => {});
const mockGetCall = vi.fn();
const mockSendSms = vi.fn();

vi.mock('../db.js', () => ({ pool: { query: mockQuery } }));
vi.mock('../traces.js', () => ({ appendTraceEvent: mockAppendTraceEvent }));
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
vi.mock('../agent-config.js', () => ({ readConfig: vi.fn(), triggerCallback: vi.fn() }));
vi.mock('../customers.js', () => ({
  customerModuleActiveForAgentConfig: vi.fn(() => false),
  getActiveCustomerDetailsKeys: vi.fn(() => new Set()),
  normalizeCustomerModuleConfig: vi.fn(() => ({ active: false })),
  lookupCustomer: vi.fn(),
  upsertCustomer: vi.fn(),
}));
vi.mock('../tickets.js', () => ({ createTicket: vi.fn(), mergeTicketMetadata: vi.fn(async () => {}) }));
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
  return { ...actual, getCall: mockGetCall, deleteCall: vi.fn() };
});

const { registerRetellWebhooks } = await import('../retell-webhooks.js');
const { registerRetellDrkallaCustomLlmWs } = await import('../retell-drkalla-custom-llm-ws.js');
const { buildDrkallaProductNameDetector } = await import('../drkalla-product-name-detector.js');
const { buildDrkallaProductEvidenceLookup } = await import('../drkalla-product-evidence.js');

const TEST_SECRET = 'test-secret-123456';
const CALLER_PHONE = '+491701234567';

const detectProducts = buildDrkallaProductNameDetector([
  {
    productId: 'synthesis-color-cream',
    spokenName: 'Synthesis Color Cream',
    productKind: 'Haarfarbe/Farbcreme',
    url: 'https://drkalla.com/products/synthesis-color-cream',
    aliases: ['Synthesis Color Cream'],
  },
]);
const evidenceLookup = buildDrkallaProductEvidenceLookup([
  {
    handle: 'synthesis-color-cream',
    title: 'Synthesis Color Cream',
    vendor: 'Dr.Kalla Cosmetics',
    productType: 'Haarfarbe/Farbcreme',
    url: 'https://drkalla.com/products/synthesis-color-cream',
    variants: [{ price: '9.99', available: true }],
  },
]);

const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string) {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockAppendTraceEvent.mockClear();
  mockGetCall.mockReset();
  mockSendSms.mockReset();
  // Return a live call matching whichever call id the tool verifies, so each
  // test can use a fresh call id and avoid the per-call link dedupe leaking.
  mockGetCall.mockImplementation(async (id: string) => ({
    call_id: id,
    agent_id: 'agent-drkalla-canary',
    from_number: CALLER_PHONE,
    call_status: 'ongoing',
  }));
  mockSendSms.mockResolvedValue({ ok: true, to: CALLER_PHONE, sid: 'SM123' });
  setEnv('RETELL_TOOL_AUTH_SECRET', 'drkalla-link-test');
  setEnv('DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED', 'true');
  setEnv('DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET', TEST_SECRET);
  setEnv('DRKALLA_CUSTOM_RUNTIME_SMS_TOOL_ENABLED', 'true');
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function startServer(callId: string) {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await registerRetellWebhooks(app);
  await registerRetellDrkallaCustomLlmWs(app, {
    client: { complete: async () => '' },
    detectProducts,
    evidenceLookup,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return { app, url: `ws://127.0.0.1:${address.port}/retell/custom-llm/drkalla/auth/${TEST_SECRET}/${callId}` };
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function receive(ws: WebSocket): Promise<{ content: string; content_complete: boolean }> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    ws.once('error', reject);
  });
}

describe('DrKalla custom runtime SMS executor end-to-end', () => {
  it('sends the catalog product link to the verified caller phone on a confirmed offer', async () => {
    const { app, url } = await startServer('call-canary-send-1');
    const ws = await connect(url);

    // Turn 1: price question → deterministic offer (empty model) names the product.
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 1,
      transcript: [{ role: 'user', content: 'Wie kaufe ich die Synthesis Color Cream?' }],
    }));
    const offer = await receive(ws);
    expect(offer.content).toContain('per SMS schicken?');

    // Turn 2: caller confirms → WS executor injects into the send_link tool.
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 2,
      transcript: [{ role: 'user', content: 'Ja bitte.' }],
    }));
    const confirm = await receive(ws);

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    const smsArg = mockSendSms.mock.calls[0]?.[0] as { to: string; kind: string; body: string };
    expect(smsArg.to).toBe(CALLER_PHONE);
    expect(smsArg.kind).toBe('drkalla_link');
    expect(smsArg.body).toContain('https://drkalla.com/products/synthesis-color-cream');
    expect(confirm.content).toContain('per SMS geschickt');
    expect(confirm.content).not.toMatch(/\b(?:du|dir|dich)\b/i);

    ws.close();
    await app.close();
  });

  it('does not send a second SMS for the same link in one call (policy dedupe)', async () => {
    const { app, url } = await startServer('call-canary-dedupe-1');
    const ws = await connect(url);

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 1,
      transcript: [{ role: 'user', content: 'Wie kaufe ich die Synthesis Color Cream?' }],
    }));
    await receive(ws);
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 2,
      transcript: [{ role: 'user', content: 'Ja bitte.' }],
    }));
    await receive(ws);

    // Offer again, confirm again — the policy endpoint reports duplicate.
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 3,
      transcript: [{ role: 'user', content: 'Schick mir den Link zur Synthesis Color Cream nochmal.' }],
    }));
    await receive(ws);
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 4,
      transcript: [{ role: 'user', content: 'Ja bitte.' }],
    }));
    const secondConfirm = await receive(ws);

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(secondConfirm.content).toContain('schon geschickt');

    ws.close();
    await app.close();
  });

  it('stays truthful when the flag is off: no SMS, no false send claim', async () => {
    setEnv('DRKALLA_CUSTOM_RUNTIME_SMS_TOOL_ENABLED', 'false');
    const { app, url } = await startServer('call-canary-off-1');
    const ws = await connect(url);

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 1,
      transcript: [{ role: 'user', content: 'Wie kaufe ich die Synthesis Color Cream?' }],
    }));
    await receive(ws);
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 2,
      transcript: [{ role: 'user', content: 'Ja bitte.' }],
    }));
    const confirm = await receive(ws);

    expect(mockSendSms).not.toHaveBeenCalled();
    expect(confirm.content).toContain('noch nicht freigeschaltet');
    expect(confirm.content).not.toContain('geschickt');

    ws.close();
    await app.close();
  });
});
