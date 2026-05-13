import { beforeEach, describe, expect, it, vi } from 'vitest';

type BookingRow = {
  id: string;
  org_id: string;
  staff_id: string;
  customer_name: string;
  customer_phone: string;
  service: string;
  notes: string | null;
  slot_time: Date;
  source_call_id: string | null;
  external_refs: Record<string, never>;
  duration_minutes: number;
  buffer_minutes: number;
};

const bookings: BookingRow[] = [];
let nextBookingId = 1;

function timePart(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function datePart(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(date);
}

function bookingBlock(row: BookingRow) {
  const end = new Date(row.slot_time.getTime() + (row.duration_minutes + row.buffer_minutes) * 60 * 1000);
  return {
    date: datePart(row.slot_time),
    start_time: timePart(row.slot_time),
    end_time: timePart(end),
  };
}

function findExactBooking(orgId: string, staffId: string, slotTime: string) {
  const requested = new Date(slotTime).getTime();
  return bookings.find((row) => row.org_id === orgId && row.staff_id === staffId && row.slot_time.getTime() === requested);
}

const mockClient = {
  query: vi.fn(async (sql: unknown, params: unknown[] = []) => {
    const text = String(sql);
    if (text.includes('BEGIN') || text.includes('COMMIT') || text.includes('ROLLBACK') || text.includes('pg_advisory_xact_lock')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM staff_chipy_bookings') && text.includes('slot_time <')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('INSERT INTO staff_chipy_bookings')) {
      const row: BookingRow = {
        id: `booking-${nextBookingId++}`,
        org_id: String(params[0]),
        staff_id: String(params[1]),
        customer_name: String(params[2]),
        customer_phone: String(params[3]),
        service: String(params[4]),
        notes: params[5] ? String(params[5]) : null,
        slot_time: new Date(String(params[6])),
        source_call_id: params[7] ? String(params[7]) : null,
        external_refs: {},
        duration_minutes: Number(params[8]),
        buffer_minutes: Number(params[9]),
      };
      bookings.push(row);
      return { rows: [{ id: row.id, source_call_id: row.source_call_id, external_refs: row.external_refs }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }),
  release: vi.fn(),
};

const mockPool = {
  query: vi.fn(async (sql: unknown, params: unknown[] = []) => {
    const text = String(sql);
    if (text.includes('SELECT id FROM calendar_staff')) {
      return { rows: [{ id: 'staff-dean' }], rowCount: 1 };
    }
    if (text.includes('FROM calendar_staff') && text.includes('WHERE org_id = $1 AND active = true')) {
      return {
        rows: [{
          id: 'staff-dean',
          org_id: 'org-jimmy',
          name: 'Dean',
          role: 'Stylist',
          services: [],
          color: '#22d3ee',
          active: true,
          sort_order: 0,
          created_at: new Date(),
          updated_at: new Date(),
        }],
        rowCount: 1,
      };
    }
    if (text.includes('FROM calendar_connections')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("SELECT data->'services' AS services")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('SELECT schedule FROM staff_chipy_schedules')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM staff_chipy_blocks')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM staff_chipy_bookings') && text.includes('(slot_time AT TIME ZONE')) {
      return { rows: bookings.map(bookingBlock), rowCount: bookings.length };
    }
    if (text.includes('FROM staff_chipy_bookings') && text.includes('slot_time = $3::timestamptz')) {
      const row = findExactBooking(String(params[0]), String(params[1]), String(params[2]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  }),
  connect: vi.fn(async () => mockClient),
};

vi.mock('../db.js', () => ({
  pool: mockPool,
}));

vi.mock('../redis.js', () => ({
  redis: null,
}));

vi.mock('../logger.js', () => {
  const noop = () => {};
  return {
    log: { info: noop, warn: noop, error: noop, debug: noop },
    logBg: () => noop,
  };
});

const { bookSlot } = await import('../calendar.js');

describe('staff calendar booking idempotency', () => {
  beforeEach(() => {
    bookings.length = 0;
    nextBookingId = 1;
    mockPool.query.mockClear();
    mockPool.connect.mockClear();
    mockClient.query.mockClear();
    mockClient.release.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T08:00:00.000Z'));
  });

  it('reuses an identical staff booking retry even when availability sees the existing booking as busy', async () => {
    const payload = {
      customerName: 'Max Mustermann',
      customerPhone: '+4917612345678',
      time: '2026-05-20T10:00:00',
      service: 'Herrenschnitt',
      staffId: 'staff-dean',
      durationMinutes: 30,
      bufferMinutes: 0,
    };

    const first = await bookSlot('org-jimmy', payload);
    const second = await bookSlot('org-jimmy', payload);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.bookingId).toBe(first.bookingId);
    expect(bookings).toHaveLength(1);
  });
});
