import { describe, it, expect } from 'vitest';
import {
  preserveForUserConfirmation,
  redactForEval,
  redactForLog,
  redactForPrompt,
  redactForShadow,
  redactForToolArgument,
  redactForToolResult,
  redactForTrace,
  redactPII,
  redactStructuredPII,
} from '../pii.js';

describe('PII redaction', () => {
  it('redacts email addresses', () => {
    expect(redactPII('Kontakt: max@example.com bitte')).toBe('Kontakt: [EMAIL] bitte');
  });

  it('redacts German phone numbers (national)', () => {
    expect(redactPII('Ruf mich an: 030 12345678')).toBe('Ruf mich an: [PHONE]');
    expect(redactPII('Mobil: 0176-12345678')).toBe('Mobil: [PHONE]');
  });

  it('redacts international phone numbers', () => {
    expect(redactPII('Call +49 30 12345678')).toBe('Call [PHONE]');
    expect(redactPII('+43 1 234 5678')).toBe('[PHONE]');
  });

  it('redacts German IBANs', () => {
    expect(redactPII('IBAN: DE89370400440532013000')).toBe('IBAN: [IBAN]');
  });

  it('redacts dates of birth (DD.MM.YYYY)', () => {
    expect(redactPII('Geboren am 12.03.1985')).toBe('Geboren am [DOB]');
    expect(redactPII('DOB: 01/06/1990')).toBe('DOB: [DOB]');
  });

  it('redacts German street addresses', () => {
    expect(redactPII('Wohnt in Musterstrasse 12')).toBe('Wohnt in [ADDRESS]');
    expect(redactPII('Hauptstr. 5a')).toContain('[ADDRESS]');
  });

  it('redacts credit card numbers', () => {
    expect(redactPII('Karte: 4111 1111 1111 1111')).toBe('Karte: [CC]');
  });

  it('handles null/undefined/empty', () => {
    expect(redactPII(null)).toBe('');
    expect(redactPII(undefined)).toBe('');
    expect(redactPII('')).toBe('');
  });

  it('does not redact normal business text', () => {
    const text = 'Termin am Dienstag um 14 Uhr für Herrenschnitt';
    expect(redactPII(text)).toBe(text);
  });

  it('redacts multiple PII in one string', () => {
    const input = 'Max Mustermann, max@test.de, +49 176 12345678, DE89370400440532013000';
    const result = redactPII(input);
    expect(result).toContain('[EMAIL]');
    expect(result).toContain('[PHONE]');
    expect(result).toContain('[IBAN]');
    expect(result).not.toContain('max@test.de');
    expect(result).not.toContain('+49 176');
  });

  it('exposes purpose-specific redaction helpers for logs, traces, evals, prompts, and tools', () => {
    const input = 'Mail max@test.de, Telefon 0176-12345678, IBAN DE89370400440532013000, DOB 12.03.1985.';
    for (const redact of [
      redactForLog,
      redactForTrace,
      redactForEval,
      redactForShadow,
      redactForPrompt,
      redactForToolArgument,
      redactForToolResult,
    ]) {
      const output = redact(input);
      expect(output).toContain('[EMAIL]');
      expect(output).toContain('[PHONE]');
      expect(output).toContain('[IBAN]');
      expect(output).toContain('[DOB]');
      expect(output).not.toContain('max@test.de');
      expect(output).not.toContain('0176-12345678');
    }
  });

  it('handles mixed German phrasing across common PII classes', () => {
    const input = 'Meine Mail ist eva@test.de, Telefon 030 12345678, Adresse Hauptstr. 5a, Karte 4111 1111 1111 1111.';
    const output = redactForEval(input);
    expect(output).toContain('[EMAIL]');
    expect(output).toContain('[PHONE]');
    expect(output).toContain('[ADDRESS]');
    expect(output).toContain('[CC]');
    expect(output).not.toContain('eva@test.de');
    expect(output).not.toContain('4111 1111 1111 1111');
  });

  it('preserves voice user-visible confirmation only when policy allows it', () => {
    const input = 'Ich bestaetige max@test.de und 0176-12345678.';
    expect(preserveForUserConfirmation(input, { policyAllowsUserVisibleConfirmation: true })).toBe(input);
    const blocked = preserveForUserConfirmation(input, { policyAllowsUserVisibleConfirmation: false });
    expect(blocked).toContain('[EMAIL]');
    expect(blocked).toContain('[PHONE]');
  });

  it('redacts nested tool payloads by purpose', () => {
    const payload = {
      customer: { email: 'max@test.de', phone: '+49 151 12345678' },
      notes: ['Adresse Musterstrasse 12', 'IBAN DE89370400440532013000'],
      ok: true,
    };
    const output = redactStructuredPII(payload, 'tool_result');
    expect(output.customer.email).toBe('[EMAIL]');
    expect(output.customer.phone).toBe('[PHONE]');
    expect(output.notes[0]).toBe('Adresse [ADDRESS]');
    expect(output.notes[1]).toBe('IBAN [IBAN]');
    expect(output.ok).toBe(true);
  });
});
