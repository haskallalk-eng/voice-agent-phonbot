import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({ pool: null }));
vi.mock('../email.js', () => ({ sendTicketNotification: vi.fn(async () => {}) }));
vi.mock('../agent-config.js', () => ({ triggerCallback: vi.fn(async () => ({ ok: true })) }));

const { createTicket } = await import('../tickets.js');

describe('createTicket', () => {
  it('treats empty optional text fields as missing instead of rejecting fallback tickets', async () => {
    const ticket = await createTicket({
      tenantId: 'tenant-1',
      source: 'phone',
      sessionId: 'call-1',
      reason: 'calendar-unavailable',
      customerName: '',
      customerPhone: '+4915111111111',
      preferredTime: '',
      service: '',
      notes: '',
    });

    expect(ticket.customer_name).toBeNull();
    expect(ticket.preferred_time).toBeNull();
    expect(ticket.service).toBeNull();
    expect(ticket.notes).toBeNull();
  });
});
