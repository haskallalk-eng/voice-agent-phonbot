// @vitest-environment jsdom
import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../lib/api.js';
import type { ChipyBooking, ChipyBookingWriteResult } from '../../lib/api.js';
import { BookingModal } from './BookingModal.js';
import { BookingDetailsModal } from './BookingDetailsModal.js';
import { StaffPanel } from './StaffPanel.js';

vi.mock('../../lib/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/api.js')>(),
  getCalendarStaff: vi.fn(), getStaffChipyCalendar: vi.fn(), getStaffChipyBookings: vi.fn(),
  getCalendarStatus: vi.fn(), getStaffExternalCalendarEvents: vi.fn(),
  createStaffChipyBooking: vi.fn(), createChipyBooking: vi.fn(),
}));

const booking: ChipyBooking = {
  id: 'synthetic-booking', customer_name: 'Anna Beispiel', customer_phone: '+493012345678',
  service: 'Beratung', notes: null, slot_time: '2026-10-26T09:00:00', duration_minutes: 45, buffer_minutes: 10,
};
const result: ChipyBookingWriteResult = { ok: true, booking };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fillBooking() {
  fireEvent.change(screen.getByLabelText('Name *'), { target: { value: booking.customer_name } });
  fireEvent.change(screen.getByLabelText('Telefon'), { target: { value: ` ${booking.customer_phone} ` } });
}

describe('booking dialogs', () => {
  it('preserves service duration and prevents duplicate requests while saving', async () => {
    let complete: (value: ChipyBookingWriteResult) => void = () => {};
    const create = vi.fn(() => new Promise<ChipyBookingWriteResult>(resolve => { complete = resolve; }));
    const onSave = vi.fn();
    render(<BookingModal date={new Date('2026-10-26T12:00:00')} onClose={vi.fn()} onSave={onSave}
      createBookingApi={create} serviceOptions={[{ label: 'Beratung', durationMinutes: 45, bufferMinutes: 10 }]} />);
    fillBooking();
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'Beratung' } });
    const form = screen.getByRole('dialog').querySelector('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      customer_name: booking.customer_name, customer_phone: booking.customer_phone,
      duration_minutes: 45, buffer_minutes: 10, slot_time: '2026-10-26T09:00:00',
    }));
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => complete(result));
    expect(onSave).toHaveBeenCalledWith(booking, result);
  });

  it('keeps a failed booking editable and allows retry', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('Zeit bereits belegt')).mockResolvedValueOnce(result);
    const onSave = vi.fn();
    render(<BookingModal date={new Date('2026-10-26T12:00:00')} onClose={vi.fn()} onSave={onSave} createBookingApi={create} />);
    fillBooking();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Termin anlegen' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Zeit bereits belegt');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Termin anlegen' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('requires confirmation before deleting the selected appointment', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<BookingDetailsModal booking={booking} onDelete={onDelete} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Termin löschen' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Termin löschen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Löschen bestätigen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith(booking);
  });

  it('keeps failed deletions open and displays the error', async () => {
    const onClose = vi.fn();
    render(<BookingDetailsModal booking={booking} onDelete={vi.fn().mockRejectedValue(new Error('Löschen fehlgeschlagen'))} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Termin löschen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Löschen bestätigen' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Löschen fehlgeschlagen');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps customer-search errors visible in the active dialog', () => {
    const onOpenCustomer = vi.fn();
    render(<BookingDetailsModal booking={booking} onClose={vi.fn()} onOpenCustomer={onOpenCustomer}
      customerLookupError="Mehrere passende Kunden gefunden" />);
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('Mehrere passende Kunden');
    fireEvent.click(screen.getByRole('button', { name: 'Kundenmodul öffnen' }));
    expect(onOpenCustomer).toHaveBeenCalledWith(booking);
  });
});

it('creates staff bookings for the selected employee without calling the business endpoint', async () => {
  vi.mocked(api.getCalendarStaff).mockResolvedValue({ staff: [
    { id: 'staff-a', name: 'Team A', role: null, color: null, services: [] },
    { id: 'staff-b', name: 'Team B', role: null, color: null, services: [] },
  ] });
  vi.mocked(api.getStaffChipyCalendar).mockResolvedValue({ schedule: {}, blocks: [], bookings: [] });
  vi.mocked(api.getStaffChipyBookings).mockResolvedValue({ bookings: [] });
  vi.mocked(api.getCalendarStatus).mockResolvedValue({ connected: false, provider: 'chipy' } as api.CalendarStatus);
  vi.mocked(api.getStaffExternalCalendarEvents).mockResolvedValue({ events: [] });
  vi.mocked(api.createStaffChipyBooking).mockResolvedValue(result);
  render(<StaffPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Team B' }));
  await waitFor(() => expect(api.getStaffChipyCalendar).toHaveBeenCalledWith('staff-b'));
  fireEvent.click(screen.getByRole('button', { name: '+ Termin' }));
  fillBooking();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Termin anlegen' }));
  await waitFor(() => expect(api.createStaffChipyBooking).toHaveBeenCalledTimes(1));
  expect(api.createStaffChipyBooking).toHaveBeenCalledWith('staff-b', expect.objectContaining({ customer_name: booking.customer_name }));
  expect(api.createChipyBooking).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
