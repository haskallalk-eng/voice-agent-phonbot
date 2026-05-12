import { describe, expect, it } from 'vitest';
import { normalizePhoneLight, toE164 } from './phone.js';

describe('spoken German phone normalization', () => {
  it('normalizes dictated German digit words before E.164 conversion', () => {
    expect(toE164('plus vier neun eins sieben sechs eins zwei drei vier fünf sechs sieben')).toBe('+491761234567');
  });

  it('keeps two- and three-block dictated numbers usable for validation', () => {
    expect(normalizePhoneLight('null eins sieben sechs 12 34 567').digits).toBe('01761234567');
  });
});
