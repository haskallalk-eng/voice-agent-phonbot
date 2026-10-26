import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DailyCalendar, MonthlyCalendar, WeeklyCalendar } from './CalendarViews.js';
import { groupCalendarBookingsByStart, type CalendarBooking } from './model.js';

const booking: CalendarBooking = { id: 'synthetic-a', customer_name: 'Anna <Beispiel>', customer_phone: '', service: 'Beratung', notes: null, slot_time: '2026-10-26T10:00:00', duration_minutes: 30, buffer_minutes: 10 };
const noop = () => {};
afterEach(() => vi.useRealTimers());

describe('extracted calendar views', () => {
  it('renders the appointment in the day view with escaped customer text', () => {
    const html = renderToStaticMarkup(<DailyCalendar date={new Date('2026-10-26T12:00:00')} bookings={[booking]} blocks={[]} externalEvents={[]} onDateChange={noop} onBookingClick={noop} />);
    expect(html).toContain('Anna &lt;Beispiel&gt;');
    expect(html).not.toContain('Anna <Beispiel>');
    expect(html).toContain('Beratung');
  });
  it('renders the same appointment in the week view', () => {
    const html = renderToStaticMarkup(<WeeklyCalendar weekStart={new Date('2026-10-26T00:00:00')} bookings={[booking]} blocks={[]} externalEvents={[]} onWeekStartChange={noop} onBookingClick={noop} />);
    expect(html).toContain('Anna &lt;Beispiel&gt;');
    expect(html).toContain('Beratung');
  });
  it('retains grouped appointment counts and identity without mutating inputs', () => {
    const second = { ...booking, id: 'synthetic-b', customer_name: 'Berta Beispiel', calendarScope: 'staff' as const, staffId: 'staff-demo', staffName: 'Team B' };
    const originals = [booking, second];
    const grouped = groupCalendarBookingsByStart(originals);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.groupedBookings?.map(b => b.id).sort()).toEqual(['synthetic-a', 'synthetic-b']);
    expect(booking.customer_name).toBe('Anna <Beispiel>');
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00'));
    const html = renderToStaticMarkup(<MonthlyCalendar bookings={grouped} blocks={[]} onDayClick={noop} />);
    expect(html).toContain('2 gleichzeitig');
  });
});
