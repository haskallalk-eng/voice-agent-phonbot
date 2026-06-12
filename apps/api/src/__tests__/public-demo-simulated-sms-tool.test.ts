import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  pool: null,
}));

vi.mock('../redis.js', () => ({
  redis: null,
}));

vi.mock('../logger.js', () => {
  const noop = () => {};
  return {
    log: { info: noop, warn: noop, error: noop, debug: noop },
    logBg: () => noop,
  };
});

const {
  PUBLIC_PHONE_DEMO_PROMPT,
  publicDemoTools,
} = await import('../scripts/sync-public-demo-phone.js');
const {
  buildPublicDemoSimulatedSmsBody,
  PUBLIC_DEMO_TEST_LINK,
} = await import('../public-demo-sms-tool.js');

describe('public demo simulated SMS tool A/B regression', () => {
  it('A can only refuse SMS vaguely; B exposes a simulated SMS tool with a test link', () => {
    const legacyToolNames = ['end_call', 'recording_declined'];
    const legacyAnswer =
      'Gern, in dieser Demo kann ich keine echte SMS senden. Ich kann dir aber den Text formulieren.';

    expect(legacyToolNames).not.toContain('demo_send_test_sms');
    expect(legacyAnswer).not.toContain('Testlink');

    const tools = publicDemoTools('https://example.test');
    const toolNames = tools.map((tool) => tool.name);
    const smsTool = tools.find((tool) => tool.name === 'demo_send_test_sms');

    expect(toolNames).toEqual(expect.arrayContaining(['end_call', 'recording_declined', 'demo_send_test_sms']));
    expect(smsTool).toBeDefined();
    expect(smsTool?.url).toContain('/retell/tools/demo_send_test_sms?demo_sig=');
    expect(smsTool?.description).toContain('simuliert');
    expect(smsTool?.description).toContain('keinen echten SMS-Versand');
    expect(smsTool?.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['smsKind'],
    });
  });

  it('B prompt tells the agent to use the simulated SMS tool instead of stopping at a refusal', () => {
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('demo_send_test_sms');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('simulierte Demo-SMS');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Testlink');
    expect(PUBLIC_PHONE_DEMO_PROMPT).toContain('Behaupte niemals echten SMS-Versand');
  });

  it('builds a short simulated appointment SMS containing the PhoneBot test link', () => {
    const body = buildPublicDemoSimulatedSmsBody({
      smsKind: 'appointment_confirmation',
      customerName: 'Hassib',
      service: 'Herrenschnitt',
      date: 'morgen',
      time: 'zehn Uhr',
    });

    expect(body).toContain('PhoneBot Demo');
    expect(body).toContain('simuliert');
    expect(body).toContain('Herrenschnitt');
    expect(body).toContain('morgen');
    expect(body).toContain('zehn Uhr');
    expect(body).toContain(PUBLIC_DEMO_TEST_LINK);
    expect(body.length).toBeLessThanOrEqual(240);
  });
});
