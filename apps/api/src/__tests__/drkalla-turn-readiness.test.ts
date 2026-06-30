import { describe, expect, it, vi } from 'vitest';
import { scoreDrkallaTurnReadiness } from '../drkalla-turn-readiness.js';
import { looksIncompleteDrkallaUtterance } from '../drkalla-turn-completeness.js';

describe('scoreDrkallaTurnReadiness — holds while the caller is mid-build', () => {
  it.each([
    'Ich möchte mein Produkt irgendwie kaufen. Und', // real call 2026-06-14
    'Ich hätte gern ein Shampoo für',
    'Geben Sie mir bitte ein',
    'Also ähm',
  ])('holds on dangling utterance: "%s"', (text) => {
    const r = scoreDrkallaTurnReadiness(text);
    expect(r.decision).toBe('hold');
    expect(r.readiness).toBeLessThan(0.5);
  });

  it.each([
    'Ich gehe zum',
    'Das kommt vom',
    'Ich brauche das fürs',
  ])('holds on a trailing contracted preposition: "%s"', (text) => {
    const r = scoreDrkallaTurnReadiness(text);
    expect(r.decision).toBe('hold');
    expect(r.reasons).toContain('dangling-contracted');
  });

  it.each([
    'sind meine lockigen',   // live 2026-06-29: agent jumped in on "Da", cut off by "Haare"
    'Ich habe trockene',
    'Das sind so krause',
    'Meine Haare sind ziemlich strapazierte', // attributive inflection still mid-build
  ])('holds on a trailing attributive descriptor adjective (noun still to come): "%s"', (text) => {
    expect(scoreDrkallaTurnReadiness(text).decision).toBe('hold');
  });

  it('holds on an utterance that ends on a comma (list/clause in progress)', () => {
    const r = scoreDrkallaTurnReadiness('Ich suche ein Shampoo, ein Serum,');
    expect(r.decision).toBe('hold');
    expect(r.reasons).toContain('trailing-comma');
  });
});

describe('scoreDrkallaTurnReadiness — descriptor heuristic stays precise (no false holds)', () => {
  it.each([
    'Meine Haare sind trocken',   // PREDICATIVE bare adjective — a complete turn
    'Ich wasche meine Haare',     // plural noun ending -e is NOT an adjective
    'Ich möchte eine Maske',      // feminine noun ending -e is NOT an adjective
    'Ich nehme die rote Farbe',   // adjective is not the LAST token
    'Ich hätte gern eine Spülung',
  ])('does NOT hold a complete noun phrase / predicative adjective: "%s"', (text) => {
    expect(scoreDrkallaTurnReadiness(text).decision).toBe('respond');
  });

  it.each([
    'nimm die schwarze',          // nominalized elliptical answer = "the black one"
    'ich will die blonde',
    'eher die dunkle',
  ])('does NOT hold a nominalized elliptical answer (definite article + descriptor): "%s"', (text) => {
    expect(scoreDrkallaTurnReadiness(text).decision).toBe('respond');
  });

  it('a descriptor reply to the agent\'s OWN question is a complete answer (not held)', () => {
    // The agent asked e.g. "Wie sind Ihre Haare?" — "voll trockene" / "die schwarze"
    // is the caller's complete elliptical answer; never go silent on it.
    expect(scoreDrkallaTurnReadiness('voll trockene', { pendingQuestion: true }).decision).toBe('respond');
    expect(scoreDrkallaTurnReadiness('die schwarze', { pendingQuestion: true }).decision).toBe('respond');
    // A short answer with a trailing ASR comma is likewise complete with a pending question.
    expect(scoreDrkallaTurnReadiness('Eher das günstige,', { pendingQuestion: true }).decision).toBe('respond');
  });

  it('but a possessive + attributive descriptor still holds (the noun is genuinely coming)', () => {
    expect(scoreDrkallaTurnReadiness('sind meine lockigen').decision).toBe('hold');
  });
});

describe('scoreDrkallaTurnReadiness — responds when the turn is complete', () => {
  it.each([
    'Ich möchte ein Shampoo kaufen.',
    'Was kostet die Synthesis Color Cream?',
    'Haben Sie das auf Lager?',
    'ja',
    'nein danke',
  ])('responds on a complete turn: "%s"', (text) => {
    const r = scoreDrkallaTurnReadiness(text);
    expect(r.decision).toBe('respond');
    expect(r.readiness).toBeGreaterThanOrEqual(0.5);
  });

  it('treats an empty opener as respond (greeting path handles it)', () => {
    expect(scoreDrkallaTurnReadiness('').decision).toBe('respond');
  });

  it('always returns a probability in [0,1]', () => {
    for (const t of ['', 'ja', 'Ich möchte für', 'Was kostet das?', 'Ich gehe zum']) {
      const r = scoreDrkallaTurnReadiness(t);
      expect(r.readiness).toBeGreaterThanOrEqual(0);
      expect(r.readiness).toBeLessThanOrEqual(1);
    }
  });
});

describe('scoreDrkallaTurnReadiness — pendingQuestion reduces false holds', () => {
  it('a short reply to the agent\'s own question is complete (answer-to-question)', () => {
    const r = scoreDrkallaTurnReadiness('ja gerne', { pendingQuestion: true });
    expect(r.decision).toBe('respond');
    expect(r.reasons).toContain('answer-to-question');
  });

  it('but a dangling reply still holds even with a pending question', () => {
    const r = scoreDrkallaTurnReadiness('ja und', { pendingQuestion: true });
    expect(r.decision).toBe('hold'); // dangling beats answer-to-question
  });
});

describe('env threshold cannot be misconfigured into a false hold', () => {
  it('never holds a complete turn even at the maximum env threshold', async () => {
    vi.resetModules();
    vi.stubEnv('DRKALLA_TURN_HOLD_THRESHOLD', '0.95');
    const mod = await import('../drkalla-turn-readiness.js');
    expect(mod.scoreDrkallaTurnReadiness('Ich nehme die rote Farbe').decision).toBe('respond');
    expect(mod.scoreDrkallaTurnReadiness('Was kostet das?').decision).toBe('respond');
    expect(mod.scoreDrkallaTurnReadiness('ja gerne', { pendingQuestion: true }).decision).toBe('respond');
    // a clear dangle still holds at any threshold
    expect(mod.scoreDrkallaTurnReadiness('Ich möchte für').decision).toBe('hold');
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('a non-numeric env threshold falls back to the safe default', async () => {
    vi.resetModules();
    vi.stubEnv('DRKALLA_TURN_HOLD_THRESHOLD', 'not-a-number');
    const mod = await import('../drkalla-turn-readiness.js');
    expect(mod.scoreDrkallaTurnReadiness('Ich nehme die rote Farbe').decision).toBe('respond');
    expect(mod.scoreDrkallaTurnReadiness('Ich möchte für').decision).toBe('hold');
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe('parity with the proven completeness detector (no NEW false holds)', () => {
  it.each([
    'Ich möchte ein Shampoo kaufen.',
    'Was empfehlen Sie mir?',
    'ja',
    'nein danke',
    'Ich nehme das', // trailing demonstrative "das" — deliberately answered, not held
    'Rufen Sie mich an', // separable prefix "an" — answered, not held
  ])('never holds where the core detector says complete: "%s"', (text) => {
    if (!looksIncompleteDrkallaUtterance(text) && !/zum$|zur$|vom$|beim$|fürs$/.test(text)) {
      expect(scoreDrkallaTurnReadiness(text).decision).toBe('respond');
    }
  });
});
