import { describe, it, expect } from 'vitest';
import { isPlausiblePhone, normalizePhoneLight } from '@vas/shared';

describe('normalizePhoneLight', () => {
  it('preserves leading + and strips non-digits', () => {
    expect(normalizePhoneLight('+49 30 1234-5678')).toEqual({
      digits: '493012345678',
      normalized: '+493012345678',
    });
  });

  it('handles national format without +', () => {
    expect(normalizePhoneLight('030 12345678')).toEqual({
      digits: '03012345678',
      normalized: '03012345678',
    });
  });
});

describe('isPlausiblePhone', () => {
  it('accepts valid German numbers', () => {
    expect(isPlausiblePhone('+49 30 12345678')).toBe(true);
    expect(isPlausiblePhone('030 12345678')).toBe(true);
    expect(isPlausiblePhone('+4917612345678')).toBe(true);
  });

  it('accepts Austrian and Swiss numbers', () => {
    expect(isPlausiblePhone('+43 1 234 5678')).toBe(true);
    expect(isPlausiblePhone('+41 44 123 4567')).toBe(true);
  });

  it('rejects too-short numbers', () => {
    expect(isPlausiblePhone('12345')).toBe(false);
  });

  it('rejects too-long numbers (>15 digits)', () => {
    expect(isPlausiblePhone('+49123456789012345')).toBe(false);
  });

  // DE premium-rate blocked
  it('blocks German 0900 premium-rate', () => {
    expect(isPlausiblePhone('0900 1234567')).toBe(false);
    expect(isPlausiblePhone('+49 900 1234567')).toBe(false);
  });

  it('blocks German 0180 service numbers', () => {
    expect(isPlausiblePhone('0180 1234567')).toBe(false);
  });

  it('blocks German 0137 mass-traffic', () => {
    expect(isPlausiblePhone('0137 1234567')).toBe(false);
  });

  it('blocks German 0700 personal numbering', () => {
    expect(isPlausiblePhone('0700 1234567')).toBe(false);
  });

  // International premium blocked (T-30)
  it('blocks US 1-900 premium', () => {
    expect(isPlausiblePhone('+1 900 1234567')).toBe(false);
  });

  it('blocks UK 44-871 business-rate', () => {
    expect(isPlausiblePhone('+44 871 1234567')).toBe(false);
  });

  it('blocks UK 44-70 personal numbering', () => {
    expect(isPlausiblePhone('+44 70 12345678')).toBe(false);
  });

  it('blocks Swiss 090x premium', () => {
    expect(isPlausiblePhone('+41 901 123456')).toBe(false);
  });

  it('blocks Austrian 0930 premium', () => {
    expect(isPlausiblePhone('+43 930 123456')).toBe(false);
  });
});
