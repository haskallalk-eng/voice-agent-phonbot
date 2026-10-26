import type { ChipyBooking, Customer } from '../../lib/api.js';

type BookingIdentity = Pick<ChipyBooking, 'customer_name' | 'customer_phone'>;
type CustomerIdentity = Pick<Customer, 'id' | 'full_name' | 'phone' | 'phone_normalized'>;
export type CustomerMatch<T> =
  | { status: 'matched'; customer: T }
  | { status: 'not_found' | 'ambiguous' | 'incomplete' };

export const CUSTOMER_LOOKUP_LIMIT = 500;

/** Formatting only: no suffix matching or inferred country code. */
export function normalizeLookupPhone(value: string | null | undefined): string {
  const raw = value?.trim() ?? '';
  if (!/^\+?[\d\s()./-]+$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '').replace(/^00/, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

function normalizeName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
}

/** Search candidates are not identities. Only one complete match may be opened. */
export function findBookingCustomer<T extends CustomerIdentity>(booking: BookingIdentity, customers: T[]): CustomerMatch<T> {
  const phone = normalizeLookupPhone(booking.customer_phone);
  const name = normalizeName(booking.customer_name);
  // A supplied, contradictory or malformed phone must never fall back to a name.
  if (booking.customer_phone.trim() && !phone) return { status: 'not_found' };
  const matches = customers.filter((customer) => phone
    ? normalizeLookupPhone(customer.phone_normalized || customer.phone) === phone
    : Boolean(name) && normalizeName(customer.full_name) === name);
  const unique = [...new Map(matches.map(customer => [customer.id, customer])).values()];
  if (unique.length > 1) return { status: 'ambiguous' };
  return unique[0] ? { status: 'matched', customer: unique[0] } : { status: 'not_found' };
}

export async function resolveBookingCustomer<T extends CustomerIdentity>(
  booking: BookingIdentity,
  search: (query: string, limit: number) => Promise<{ items: T[] }>,
): Promise<CustomerMatch<T> & { query: string }> {
  const phone = normalizeLookupPhone(booking.customer_phone);
  const queries = [...new Set((booking.customer_phone.trim()
    ? phone ? [phone, booking.customer_phone.trim()] : []
    : [booking.customer_name.trim()]).filter(Boolean))];
  if (!queries.length) return { status: 'not_found', query: '' };
  // Collect all bounded results before deciding; a later query can expose a duplicate.
  const results = await Promise.all(queries.map(query => search(query, CUSTOMER_LOOKUP_LIMIT)));
  const query = queries[0]!;
  if (results.some(result => result.items.length >= CUSTOMER_LOOKUP_LIMIT)) return { status: 'incomplete', query };
  return { ...findBookingCustomer(booking, results.flatMap(result => result.items)), query };
}

export function customerLookupMessage(status: 'not_found' | 'ambiguous' | 'incomplete'): string {
  if (status === 'ambiguous') return 'Mehrere passende Kunden gefunden. Bitte den Kunden im Kundenmodul auswählen.';
  if (status === 'incomplete') return 'Die Kundensuche liefert zu viele Treffer. Bitte den Kunden im Kundenmodul auswählen.';
  return 'Zu diesem Termin wurde kein eindeutig passender Kunde gefunden. Bitte Name und Telefonnummer prüfen.';
}
