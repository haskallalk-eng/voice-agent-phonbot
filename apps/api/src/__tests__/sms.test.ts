import { afterEach, describe, expect, it, vi } from 'vitest';

describe('signup link SMS copy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not use a customer-name placeholder and includes the human meeting link', async () => {
    vi.stubEnv('APP_URL', 'https://phonbot.de');
    vi.stubEnv('PHONBOT_MEETING_URL', 'https://phonbot.de/kontakt/');

    const { buildSignupLinkSmsBody } = await import('../sms.js');
    const body = buildSignupLinkSmsBody();

    expect(body).toContain('Hi, hier ist Chipy von Phonbot nochmal.');
    expect(body).toContain('https://phonbot.de/login');
    expect(body).toContain('https://phonbot.de/kontakt/');
    expect(body).not.toMatch(/\[Name\]|{{\s*name\s*}}|customerName|Kundenname/i);
  });
});
