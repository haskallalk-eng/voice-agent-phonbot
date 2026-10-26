import { ApiError, type Customer } from '../../lib/api.js';
import type { CalendarViewMode } from './model.js';

const CUSTOMER_FOCUS_STORAGE_KEY = 'phonbot_focus_customer';

export function storeCustomerFocus(customer: Customer, search: string) {
  try {
    sessionStorage.setItem(CUSTOMER_FOCUS_STORAGE_KEY, JSON.stringify({ id: customer.id, search }));
  } catch {
    // Non-critical: the ID deep-link still works for customers in the loaded list.
  }
}

export function friendlyError(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.userMessage || fallback;
  if (e instanceof Error) return e.message.replace(/^API \d+:\s*/, '') || fallback;
  return fallback;
}

export function initialCalendarView(): CalendarViewMode {
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches) return 'day';
  return 'week';
}
