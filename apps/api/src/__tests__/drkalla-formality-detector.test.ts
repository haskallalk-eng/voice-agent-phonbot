import { describe, expect, it } from 'vitest';
import { detectDrkallaDuForm } from '../drkalla-formality-detector.js';
import {
  DRKALLA_PROFI_LINK_QUESTION,
  DRKALLA_PROFI_PRICE_DISCLOSURE,
  DRKALLA_SMS_NOT_WIRED_TEXT,
} from '../drkalla-custom-llm-responder.js';
import { buildDrkallaContactAnswer } from '../drkalla-contact-facts.js';

describe('DrKalla du/Sie formality detector', () => {
  it('flags du-pronouns with high confidence', () => {
    const r = detectDrkallaDuForm('Ich schicke dir den Link.');
    expect(r.hasDuForm).toBe(true);
    expect(r.confidence).toBe('high');
    expect(r.slips).toContain('dir');
  });

  it('flags the possessive du-family (dein/deine/...)', () => {
    expect(detectDrkallaDuForm('Wie ist deine Frage?').slips).toContain('deine');
    expect(detectDrkallaDuForm('Das ist dein Produkt.').slips).toContain('dein');
  });

  it('rates a lone du-verb (no pronoun) as medium', () => {
    const r = detectDrkallaDuForm('Brauchst noch etwas?');
    expect(r.hasDuForm).toBe(true);
    expect(r.confidence).toBe('medium');
    expect(r.slips).toEqual(['brauchst']);
  });

  it('returns clean for proper Sie-form text', () => {
    const r = detectDrkallaDuForm('Kann ich Ihnen sonst noch helfen? Ich schicke Ihnen den Link.');
    expect(r.hasDuForm).toBe(false);
    expect(r.confidence).toBe('none');
    expect(r.slips).toEqual([]);
  });

  it('does not false-positive on words that merely contain du/dir/dich/dein/weiss', () => {
    // Duft, durch, Dusche, direkt, dicht, weiß(colour), Dienst, selbst
    const tricky = 'Der Duft geht durch die Dusche. Direkt und dicht. Die Farbe ist weiß. Unser Dienst ist selbsterklaerend.';
    const r = detectDrkallaDuForm(tricky);
    expect(r.hasDuForm).toBe(false);
    expect(r.slips).toEqual([]);
  });

  it('does not match "weiß" the colour but does match "weißt" the verb', () => {
    expect(detectDrkallaDuForm('Die Tönung ist weiß.').hasDuForm).toBe(false);
    expect(detectDrkallaDuForm('Du weißt das sicher.').slips).toEqual(expect.arrayContaining(['du', 'weißt']));
  });

  it('handles empty/whitespace input', () => {
    expect(detectDrkallaDuForm('').hasDuForm).toBe(false);
    expect(detectDrkallaDuForm('   ').confidence).toBe('none');
  });
});

describe('DrKalla hardcoded outputs are Sie-clean (invariant lock)', () => {
  const hardcoded: Array<[string, string]> = [
    ['profi price disclosure', DRKALLA_PROFI_PRICE_DISCLOSURE],
    ['profi link question', DRKALLA_PROFI_LINK_QUESTION],
    ['sms not wired', DRKALLA_SMS_NOT_WIRED_TEXT],
    ['contact hours', buildDrkallaContactAnswer('hours') ?? ''],
    ['contact address', buildDrkallaContactAnswer('address') ?? ''],
    ['contact email', buildDrkallaContactAnswer('email') ?? ''],
    ['contact anfahrt', buildDrkallaContactAnswer('anfahrt') ?? ''],
  ];
  it.each(hardcoded)('"%s" never slips into du-form', (_label, text) => {
    expect(detectDrkallaDuForm(text).hasDuForm).toBe(false);
  });
});
