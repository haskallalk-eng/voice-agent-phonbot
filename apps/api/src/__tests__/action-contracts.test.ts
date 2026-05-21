import { describe, expect, it } from 'vitest';
import { ACTION_CONTRACTS } from '../action-contracts.js';

describe('action contracts', () => {
  it('marks mutating calendar tools as requiring confirmation', () => {
    expect(ACTION_CONTRACTS.calendarBook.requiredFields).toContain('confirmed');
    expect(ACTION_CONTRACTS.calendarCancel.requiredFields).toContain('confirmed');
    expect(ACTION_CONTRACTS.calendarReschedule.requiredFields).toContain('confirmed');
  });

  it('requires strong identity for existing appointment changes', () => {
    expect(ACTION_CONTRACTS.calendarFindBookings.identityRequirement).toBe('verified_phone_or_confirmed_email');
    expect(ACTION_CONTRACTS.calendarCancel.identityRequirement).toBe('verified_phone_or_confirmed_email');
    expect(ACTION_CONTRACTS.calendarReschedule.identityRequirement).toBe('verified_phone_or_confirmed_email');
  });

  it('records forbidden claims for every mutating action', () => {
    for (const contract of Object.values(ACTION_CONTRACTS)) {
      if (contract.mayMutate) {
        expect(contract.forbiddenClaimsWithoutSuccess.length).toBeGreaterThan(0);
      }
    }
  });
});

