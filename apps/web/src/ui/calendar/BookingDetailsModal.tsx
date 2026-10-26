import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  bookingAccent,
  bookingBuffer,
  bookingDuration,
  bookingGroupMembers,
  bookingKey,
  bookingSourceLabel,
  dateToLocalMinutes,
  minutesLabel,
  type CalendarBooking,
} from './model.js';


export function BookingDetailsModal({
  booking, onClose, onOpenCustomer, onDelete, customerLookupError,
}: {
  booking: CalendarBooking;
  onClose: () => void;
  onOpenCustomer?: (booking: CalendarBooking) => void | Promise<void>;
  onDelete?: (booking: CalendarBooking) => void | Promise<void>;
  customerLookupError?: string | null;
}) {
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groupMembers = bookingGroupMembers(booking);
  const grouped = groupMembers.length > 1;
  const startMinutes = dateToLocalMinutes(booking.slot_time);
  const duration = bookingDuration(booking);
  const buffer = bookingBuffer(booking);
  const endMinutes = startMinutes + duration;
  const bufferEnd = endMinutes + buffer;
  const accent = bookingAccent(booking);
  const dateLabel = new Date(booking.slot_time).toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const headerTitle = grouped ? `${groupMembers.length} Termine gleichzeitig` : booking.customer_name;
  const bookingDeleteKey = bookingKey(booking);
  const confirmingSingleDelete = confirmingDeleteKey === bookingDeleteKey;
  const deletingSingle = deletingKey === bookingDeleteKey;

  async function handleDelete(target: CalendarBooking) {
    if (!onDelete) return;
    const targetKey = bookingKey(target);
    if (confirmingDeleteKey !== targetKey) {
      setConfirmingDeleteKey(targetKey);
      setError(null);
      return;
    }
    setDeletingKey(targetKey);
    setError(null);
    try {
      await onDelete(target);
      onClose();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Termin konnte nicht gelöscht werden.');
      setDeletingKey(null);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overscroll-contain" style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-white/10 shadow-[0_32px_120px_rgba(0,0,0,0.62)]" style={{ background: '#14141F' }} role="dialog" aria-modal="true" aria-labelledby="booking-details-title">
        <div className="relative border-b border-white/8 p-5">
          <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${accent}, rgba(32,217,255,0.7))` }} />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">Termindetails</p>
              <h3 id="booking-details-title" className="mt-1 truncate text-xl font-bold text-white">{headerTitle}</h3>
              <p className="mt-1 text-sm text-white/45">{bookingSourceLabel(booking)} · {dateLabel}</p>
            </div>
            <button onClick={onClose} className="rounded-xl px-2.5 py-1.5 text-xl leading-none text-white/35 transition-colors hover:bg-white/5 hover:text-white" aria-label="Schließen">×</button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">Uhrzeit</p>
              <p className="mt-1 text-lg font-bold text-white">{minutesLabel(startMinutes)}-{minutesLabel(endMinutes)}</p>
              <p className="mt-1 text-xs text-white/40">{duration} Minuten{buffer > 0 ? ` + ${buffer} Minuten Puffer` : ''}</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">Leistung</p>
              <p className="mt-1 text-sm font-semibold text-white">{booking.service || 'Termin'}</p>
              {buffer > 0 && <p className="mt-1 text-xs text-cyan-100/55">Blockiert bis {minutesLabel(bufferEnd)}</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/18 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">Kontakt</p>
            <p className="mt-2 text-sm text-white/70">{booking.customer_phone || 'Keine Telefonnummer hinterlegt'}</p>
          </div>

          {booking.notes && (
            <div className="rounded-2xl border border-white/8 bg-black/18 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/28">Notizen</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/62">{booking.notes}</p>
            </div>
          )}

          {grouped && (
            <div className="rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.055] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/55">Alle Termine in diesem Slot</p>
              <div className="mt-3 space-y-2">
                {groupMembers.map((member) => {
                  const memberKey = bookingKey(member);
                  const memberStart = dateToLocalMinutes(member.slot_time);
                  const memberDuration = bookingDuration(member);
                  const memberEnd = memberStart + memberDuration;
                  const memberConfirming = confirmingDeleteKey === memberKey;
                  const memberDeleting = deletingKey === memberKey;
                  const memberAccent = bookingAccent(member);
                  return (
                    <div key={memberKey} className="rounded-2xl border border-white/8 bg-black/18 p-3">
                      <div className="flex items-start gap-3">
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: memberAccent }} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-white">{member.customer_name}</p>
                            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold text-white/45">{bookingSourceLabel(member)}</span>
                          </div>
                          <p className="mt-1 text-xs text-white/50">{minutesLabel(memberStart)}-{minutesLabel(memberEnd)} · {memberDuration} min · {member.service || 'Termin'}</p>
                          {member.customer_phone && <p className="mt-0.5 text-[11px] text-white/32">{member.customer_phone}</p>}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {onOpenCustomer && (
                          <button type="button" onClick={() => { void onOpenCustomer(member); }} className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-100/80 hover:text-orange-50">
                            Kundenmodul öffnen
                          </button>
                        )}
                        {onDelete && (
                          <button type="button" onClick={() => { void handleDelete(member); }} disabled={memberDeleting} className={[
                            'rounded-xl border px-3 py-2 text-xs font-semibold transition-all disabled:opacity-50',
                            memberConfirming ? 'border-red-400/40 bg-red-500/20 text-red-50' : 'border-red-400/20 bg-red-500/10 text-red-100/70 hover:bg-red-500/15',
                          ].join(' ')}>
                            {memberDeleting ? 'Löscht...' : memberConfirming ? 'Löschen bestätigen' : 'Termin löschen'}
                          </button>
                        )}
                        {memberConfirming && (
                          <button type="button" onClick={() => { setConfirmingDeleteKey(null); setError(null); }} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/50 hover:text-white">
                            Abbrechen
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {confirmingDeleteKey && !grouped && (
            <div className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100/80">
              Bitte bestätige das Löschen bewusst. Der Termin wird aus diesem Kalender entfernt.
            </div>
          )}
          {(error || customerLookupError) && <div role="alert" className="rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100/80">{error || customerLookupError}</div>}

          {!grouped && <div className="flex flex-col gap-2 sm:flex-row">
            {onOpenCustomer && (
              <button type="button" onClick={() => { void onOpenCustomer(booking); }} className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_36px_rgba(255,91,10,0.18)]" style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>
                Kundenmodul öffnen
              </button>
            )}
            {onDelete && (
              <button type="button" onClick={() => { void handleDelete(booking); }} disabled={deletingSingle} className={[
                'rounded-xl border px-4 py-3 text-sm font-semibold transition-all disabled:opacity-50',
                confirmingSingleDelete ? 'border-red-400/40 bg-red-500/20 text-red-50' : 'border-red-400/20 bg-red-500/10 text-red-100/75 hover:bg-red-500/15',
                onOpenCustomer ? 'sm:w-44' : 'flex-1',
              ].join(' ')}>
                {deletingSingle ? 'Löscht...' : confirmingSingleDelete ? 'Löschen bestätigen' : 'Termin löschen'}
              </button>
            )}
            {confirmingSingleDelete && (
              <button type="button" onClick={() => { setConfirmingDeleteKey(null); setError(null); }} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/55 hover:text-white">
                Abbrechen
              </button>
            )}
          </div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
