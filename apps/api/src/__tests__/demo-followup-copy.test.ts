import { describe, expect, it } from 'vitest';

import { displayGreetingName } from '../email.js';
import { buildDemoBookingConfirmationSmsBody, buildSignupLinkSmsBody } from '../sms.js';

describe('demo follow-up copy', () => {
  it('filters placeholder and generic names from email greetings', () => {
    for (const name of ['[Name]', '{{name}}', 'unknown', 'unbekannt', 'Kunde', 'Gast']) {
      expect(displayGreetingName(name)).toBeNull();
    }
    expect(displayGreetingName('Max Mustermann')).toBe('Max Mustermann');
  });

  it('does not include marketing links in pure demo booking confirmations', () => {
    const body = buildDemoBookingConfirmationSmsBody({
      service: 'Herrenschnitt',
      preferredTime: 'Dienstag 14 Uhr',
    });

    expect(body).toContain('Demo-Terminbestaetigung');
    expect(body).toContain('Simulation');
    expect(body).not.toContain('/login');
    expect(body).not.toContain('/kontakt');
    expect(body).not.toContain('Testlink');
  });

  it('keeps signup-link SMS neutral and name-free', () => {
    const body = buildSignupLinkSmsBody();

    expect(body).toContain('Chipy von Phonbot');
    expect(body).toContain('/login');
    expect(body).toContain('/kontakt/');
    expect(body).not.toContain('[Name]');
  });
});
