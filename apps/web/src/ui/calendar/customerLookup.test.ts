import { describe, expect, it, vi } from 'vitest';
import { CUSTOMER_LOOKUP_LIMIT, findBookingCustomer, normalizeLookupPhone, resolveBookingCustomer } from './customerLookup.js';

const booking = { customer_name: 'Anna Beispiel', customer_phone: '' };
const customer = (id: string, full_name = 'Anna Beispiel', phone: string | null = null) => ({ id, full_name, phone, phone_normalized: phone });

describe('calendar customer identity', () => {
  it('does not open Johanna when a partial Anna search returns her first', () => {
    expect(findBookingCustomer({ ...booking, customer_name: 'Anna' }, [customer('other', 'Johanna Beispiel')]).status).toBe('not_found');
  });
  it('finds the unique full name after an unrelated first candidate', () => {
    const exact = customer('right');
    expect(findBookingCustomer(booking, [customer('wrong', 'Johanna Beispiel'), exact])).toEqual({ status: 'matched', customer: exact });
  });
  it('treats duplicate full names as ambiguous', () => {
    expect(findBookingCustomer(booking, [customer('a'), customer('b')]).status).toBe('ambiguous');
  });
  it('normalizes whitespace and case without accepting partial names', () => {
    expect(findBookingCustomer({ ...booking, customer_name: ' ANNA   BEISPIEL ' }, [customer('a')]).status).toBe('matched');
  });
  it('matches complete international phone numbers with formatting or 00 prefix', () => {
    const exact = customer('a', 'Anna Beispiel', '+49 30 12345678');
    expect(findBookingCustomer({ ...booking, customer_phone: '0049-30-12345678' }, [exact])).toEqual({ status: 'matched', customer: exact });
  });
  it('does not treat phone suffixes as identity', () => {
    expect(findBookingCustomer({ ...booking, customer_phone: '12345678' }, [customer('a', 'Anna Beispiel', '+49 30 12345678')]).status).toBe('not_found');
  });
  it('does not fall back to a matching name when the provided phone disagrees', () => {
    expect(findBookingCustomer({ ...booking, customer_phone: '+493012345678' }, [customer('a', 'Anna Beispiel', '+493087654321')]).status).toBe('not_found');
  });
  it.each(['123', '+49ext12345678', '---'])('rejects malformed or too-short provided phone %s', phone => {
    expect(findBookingCustomer({ ...booking, customer_phone: phone }, [customer('a')]).status).toBe('not_found');
  });
  it('does not invent a customer from missing identity or empty results', () => {
    expect(findBookingCustomer({ customer_name: '', customer_phone: '' }, [customer('a', '')]).status).toBe('not_found');
    expect(findBookingCustomer(booking, []).status).toBe('not_found');
  });
  it('does not choose between distinct customers sharing one phone', () => {
    const phone = '+493012345678';
    expect(findBookingCustomer({ ...booking, customer_phone: phone }, [customer('a', 'Anna', phone), customer('b', 'Berta', phone)]).status).toBe('ambiguous');
  });
  it('deduplicates the same customer returned by multiple searches', async () => {
    const exact = customer('a', 'Anna Beispiel', '+493012345678');
    const search = vi.fn(async () => ({ items: [exact] }));
    expect((await resolveBookingCustomer({ ...booking, customer_phone: '+49 30 12345678' }, search)).status).toBe('matched');
    expect(search).toHaveBeenCalledWith('493012345678', 500);
  });
  it('waits for every query before accepting a phone match', async () => {
    const phone = '+493012345678';
    const search = vi.fn().mockResolvedValueOnce({ items: [customer('a', 'Anna', phone)] })
      .mockResolvedValueOnce({ items: [customer('b', 'Berta', phone)] });
    expect((await resolveBookingCustomer({ ...booking, customer_phone: phone }, search)).status).toBe('ambiguous');
  });
  it('refuses apparent uniqueness when a response reaches the search limit', async () => {
    const items = Array.from({ length: CUSTOMER_LOOKUP_LIMIT }, (_, i) => customer(String(i), i ? 'Other' : booking.customer_name));
    expect((await resolveBookingCustomer(booking, async () => ({ items }))).status).toBe('incomplete');
  });
  it('does not turn a failed search into a successful partial result', async () => {
    const search = vi.fn().mockResolvedValueOnce({ items: [customer('a', 'Anna', '+493012345678')] }).mockRejectedValueOnce(new Error('unavailable'));
    await expect(resolveBookingCustomer({ ...booking, customer_phone: '+49 30 12345678' }, search)).rejects.toThrow('unavailable');
  });
  it('does not search without usable identity', async () => {
    const search = vi.fn();
    expect((await resolveBookingCustomer({ customer_name: '', customer_phone: '' }, search)).status).toBe('not_found');
    expect(search).not.toHaveBeenCalled();
  });
  it('keeps national and international numbering distinct without a country context', () => {
    expect(normalizeLookupPhone('030 12345678')).not.toBe(normalizeLookupPhone('+49 30 12345678'));
  });
});
