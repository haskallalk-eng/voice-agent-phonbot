import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChipyBooking, ChipyBookingInput, ChipyBookingWriteResult } from '../../lib/api.js';
import { createChipyBooking } from '../../lib/api.js';
import { isoDate, normalizeServiceName, type CalendarServiceOption } from './model.js';

import { friendlyError } from './uiState.js';

export function BookingModal({
  date, onClose, onSave, createBookingApi, serviceOptions = [],
}: {
  date: Date;
  onClose: () => void;
  onSave: (booking: ChipyBooking, result: ChipyBookingWriteResult) => void;
  createBookingApi?: (data: ChipyBookingInput) => Promise<ChipyBookingWriteResult>;
  serviceOptions?: CalendarServiceOption[];
}) {
  const formId = useId();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [service, setService] = useState('');
  const [notes, setNotes] = useState('');
  const [time, setTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLockRef = useRef(false);

  const dateStr = isoDate(date);
  const serviceListId = `${formId}-service-options`;

  useEffect(() => {
    const normalized = normalizeServiceName(service);
    const match = serviceOptions.find((option) => normalizeServiceName(option.label) === normalized);
    if (!match) return;
    setDurationMinutes(match.durationMinutes);
    setBufferMinutes(match.bufferMinutes);
  }, [service, serviceOptions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || submitLockRef.current) return;
    if (!name) return;
    submitLockRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const slotTime = `${dateStr}T${time}:00`;
      const res = await (createBookingApi ?? createChipyBooking)({
        customer_name: name,
        customer_phone: phone.trim(),
        service: service || undefined,
        notes: notes || undefined,
        slot_time: slotTime,
        duration_minutes: durationMinutes,
        buffer_minutes: bufferMinutes,
      });
      onSave(res.booking, res);
    } catch (e: unknown) {
      setError(friendlyError(e, 'Termin konnte nicht angelegt werden. Bitte wähle eine andere Uhrzeit.'));
      setLoading(false);
      submitLockRef.current = false;
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overscroll-contain" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-white/10 p-6 space-y-5 shadow-[0_28px_90px_rgba(0,0,0,0.55)]" style={{ background: '#14141F' }} role="dialog" aria-modal="true" aria-labelledby="booking-modal-title">
        <div className="flex items-center justify-between">
          <div>
            <h3 id="booking-modal-title" className="text-base font-bold text-white">Neuer Termin</h3>
            <p className="text-sm text-white/40 mt-0.5">
              {date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}
            </p>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors text-xl" aria-label="Schließen">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor={`${formId}-time`} className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Uhrzeit</label>
            <input id={`${formId}-time`} type="time" value={time} onChange={e => setTime(e.target.value)} required
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          </div>
          <div>
            <label htmlFor={`${formId}-name`} className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Name *</label>
            <input id={`${formId}-name`} type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Kundenname"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          </div>
          <div>
            <label htmlFor={`${formId}-phone`} className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Telefon</label>
            <input id={`${formId}-phone`} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+49 123 456789"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          </div>
          <div>
            <label htmlFor={`${formId}-service`} className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Service</label>
            <input id={`${formId}-service`} type="text" value={service} onChange={e => setService(e.target.value)} list={serviceOptions.length ? serviceListId : undefined} placeholder="z.B. Haarschnitt, Beratung..."
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
            {serviceOptions.length > 0 && (
              <datalist id={serviceListId}>
                {serviceOptions.map((option) => <option key={option.label} value={option.label} />)}
              </datalist>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${formId}-duration`} className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Dauer</label>
              <input id={`${formId}-duration`} type="number" min={5} max={480} value={durationMinutes} onChange={e => setDurationMinutes(Number(e.target.value))}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
            </div>
            <div>
              <label htmlFor={`${formId}-buffer`} className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Puffer danach</label>
              <input id={`${formId}-buffer`} type="number" min={0} max={180} value={bufferMinutes} onChange={e => setBufferMinutes(Number(e.target.value))}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
            </div>
          </div>
          <div>
            <label htmlFor={`${formId}-notes`} className="block text-xs text-white/40 mb-1 uppercase tracking-wide">Notizen</label>
            <textarea id={`${formId}-notes`} value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optionale Hinweise…"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-none" />
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-100">
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-white/50 hover:text-white hover:border-white/20 transition-all">
              Abbrechen
            </button>
            <button type="submit" disabled={loading || !name || durationMinutes < 5 || bufferMinutes < 0}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>
              {loading ? 'Speichern…' : 'Termin anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
