import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDrkallaFaqMatcher } from '../drkalla-faq-match.js';

const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/drkalla-rag/drkalla-faq.json'), 'utf8'));
const match = buildDrkallaFaqMatcher(raw.entries);

describe('DrKalla curated FAQ matcher', () => {
  const hits: Array<[string, string]> = [
    ['Was kostet der Versand?', 'shipping-cost'],
    ['Wie lange dauert die Lieferung?', 'delivery-time'],
    ['Liefert ihr nach Österreich?', 'delivery-countries'],
    ['Kann ich telefonisch bestellen?', 'phone-order'],
    ['Wie kann ich bezahlen?', 'payment'],
    ['Kann ich das zurückgeben?', 'returns'],
    ['Sind die Produkte vegan?', 'vegan-cruelty-free'],
    ['Wie werde ich Profikunde?', 'profi-access'],
    ['Bekomme ich eine Rechnung?', 'invoice'],
    ['Kann ich die Ware abholen?', 'pickup'],
  ];
  for (const [q, id] of hits) {
    it(`matches "${q}" -> ${id}`, () => {
      expect(match(q)?.id).toBe(id);
    });
  }

  const misses = [
    'Ich suche eine Haarfarbe.',
    'Was kostet die Haarfarbe?',     // price question, not shipping
    'Was ist die günstigste Haarfarbe?',
    'Hallo, wie geht es dir?',
    'Wann habt ihr geöffnet?',       // contact, handled elsewhere
    '',
  ];
  for (const q of misses) {
    it(`does not match "${q}"`, () => {
      expect(match(q)).toBeNull();
    });
  }

  it('matches the owner-approved policy entries (2026-07-04)', () => {
    expect(match('Gibt es einen Mindestbestellwert?')?.id).toBe('min-order');
    expect(match('Ab wann ist der Versand kostenlos?')?.id).toBe('free-shipping-threshold');
    expect(match('Gibt es einen Mindestbestellwert?')?.answer).toContain('Mindestbestellwert gibt es bei uns nicht');
    expect(match('Ab wann ist der Versand kostenlos?')?.answer).toContain('49 Euro');
  });

  it('returns curated, Sie-form answers with no abbreviations/symbols', () => {
    const a = match('Was kostet der Versand?')?.answer ?? '';
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toMatch(/\b(?:du|dich|dir|dein)\b/i);
    expect(a).not.toMatch(/&|%|z\.B\.|bzw\./);
  });
});
