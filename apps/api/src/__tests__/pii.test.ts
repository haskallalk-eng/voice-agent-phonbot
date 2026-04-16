import { describe, it, expect } from 'vitest';
import { redactPII } from '../pii.js';

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
    expect(redactPII('Wohnt in Musterstraße 12')).toBe('Wohnt in [ADDRESS]');
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
});
