import { describe, expect, it, vi } from 'vitest';
import {
  readPaidPlanPreselection,
  startPaidCheckoutSignupAndClearOnSuccess,
  type StartCheckoutSignupFn,
} from './loginCheckout.js';

class MemoryStorage {
  private readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const form = {
  orgName: 'Phonbot Test',
  email: 'test@example.com',
  phone: '+4915111111111',
  password: 'secret-pass',
};

const legalConfirmation = {
  isBusiness: true,
  termsAccepted: true,
  privacyAccepted: true,
  avvAccepted: true,
} as const;

describe('paid checkout signup preselection', () => {
  it('keeps paid preselection in session storage when checkout creation fails', async () => {
    const storage = new MemoryStorage();
    storage.setItem('preselectedPlan', 'starter');
    storage.setItem('preselectedInterval', 'year');
    const startCheckoutSignup = vi.fn(async () => {
      throw new Error('Stripe unavailable');
    }) as StartCheckoutSignupFn;
    const { plan, interval } = readPaidPlanPreselection(storage);

    await expect(startPaidCheckoutSignupAndClearOnSuccess({
      form,
      plan: plan!,
      interval,
      legalConfirmation,
      storage,
      startCheckoutSignup,
    })).rejects.toThrow('Stripe unavailable');

    expect(storage.getItem('preselectedPlan')).toBe('starter');
    expect(storage.getItem('preselectedInterval')).toBe('year');
  });

  it('clears paid preselection only after checkout creation succeeds', async () => {
    const storage = new MemoryStorage();
    storage.setItem('preselectedPlan', 'pro');
    storage.setItem('preselectedInterval', 'month');
    const startCheckoutSignup = vi.fn(async () => ({ url: 'https://checkout.stripe.test/session' })) as StartCheckoutSignupFn;
    const { plan, interval } = readPaidPlanPreselection(storage);

    await expect(startPaidCheckoutSignupAndClearOnSuccess({
      form,
      plan: plan!,
      interval,
      legalConfirmation,
      storage,
      startCheckoutSignup,
    })).resolves.toBe('https://checkout.stripe.test/session');

    expect(startCheckoutSignup).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'pro',
      interval: 'month',
      email: 'test@example.com',
    }));
    expect(storage.getItem('preselectedPlan')).toBeNull();
    expect(storage.getItem('preselectedInterval')).toBeNull();
  });
});
