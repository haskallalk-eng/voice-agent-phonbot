import { useEffect, useState } from 'react';
import { getCalendarStatus, connectCalcom, disconnectCalendar, getGoogleCalendarAuthUrl, getMicrosoftCalendarAuthUrl, getChippyCalendar, saveChippySchedule, addChippyBlock, removeChippyBlock } from '../lib/api.js';
import type { ChippySchedule, ChippyBlock, ChippyBooking } from '../lib/api.js';

type CalendarStatus = {
  connected: boolean;
  provider: string | null;
  email: string | null;
};

export function CalendarPage() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cal.com connect form
  const [calcomKey, setCalcomKey] = useState('');
  const [calcomLoading, setCalcomLoading] = useState(false);
  const [calcomError, setCalcomError] = useState<string | null>(null);

  // Google OAuth
  const [googleLoading, setGoogleLoading] = useState(false);

  // Microsoft OAuth
  const [microsoftLoading, setMicrosoftLoading] = useState(false);

  // Disconnect
  const [disconnectLoading, setDisconnectLoading] = useState(false);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const data = await getCalendarStatus();
      setStatus(data);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  }

  // Handle OAuth callback: ?calendarConnected=true or ?calendarError=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('calendarConnected');
    const calendarError = params.get('calendarError');
    if (connected === 'true' || calendarError) {
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete('calendarConnected');
      url.searchParams.delete('calendarError');
      window.history.replaceState({}, '', url.toString());
      if (calendarError) {
        setError(`Google OAuth fehlgeschlagen: ${calendarError}`);
      }
    }
    loadStatus();
  }, []);

  async function handleCalcomConnect() {
    setCalcomLoading(true);
    setCalcomError(null);
    try {
      await connectCalcom(calcomKey);
      setCalcomKey('');
      await loadStatus();
    } catch (e: unknown) {
      setCalcomError((e instanceof Error ? e.message : null) ?? 'Verbindung fehlgeschlagen');
    } finally {
      setCalcomLoading(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Kalender wirklich trennen?')) return;
    setDisconnectLoading(true);
    try {
      await disconnectCalendar();
      await loadStatus();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Fehler beim Trennen');
    } finally {
      setDisconnectLoading(false);
    }
  }

  const providerIcon = (provider: string | null) => {
    if (provider === 'google') return '🟢';
    if (provider === 'calcom') return '🔵';
    if (provider === 'microsoft') return '🪟';
    return '📅';
  };

  const providerLabel = (provider: string | null) => {
    if (provider === 'google') return 'Google Calendar';
    if (provider === 'calcom') return 'Cal.com';
    if (provider === 'microsoft') return 'Microsoft Outlook';
    return provider ?? '—';
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white px-6 py-10">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute -top-60 left-1/3 w-[600px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 65%)' }}
        />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">📅 Kalender</h1>
          <p className="text-white/50 text-sm">
            Verbinde deinen Kalender damit dein Agent Termine buchen kann.
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <span className="w-6 h-6 rounded-full border-2 border-orange-400 border-t-transparent spin" />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="glass rounded-2xl p-5 border border-red-500/20 bg-red-500/5 mb-6">
            <p className="text-sm text-red-300">⚠️ {error}</p>
            <button
              onClick={loadStatus}
              className="mt-3 text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Erneut versuchen
            </button>
          </div>
        )}

        {/* Connected state */}
        {!loading && status?.connected && (
          <div className="glass rounded-2xl p-6 border border-white/10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                  style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(6,182,212,0.2))' }}
                >
                  {providerIcon(status.provider)}
                </div>
                <div>
                  <h3 className="font-semibold text-white">{providerLabel(status.provider)}</h3>
                  {status.email && (
                    <p className="text-sm text-white/50 mt-0.5">{status.email}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                    <span className="text-xs text-green-400">Verbunden</span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={disconnectLoading}
                className="shrink-0 px-4 py-2 rounded-xl text-sm text-red-300 border border-red-500/20
                  hover:bg-red-500/10 hover:border-red-500/40 transition-all duration-200 disabled:opacity-50"
              >
                {disconnectLoading ? 'Trennen…' : 'Kalender trennen'}
              </button>
            </div>

            <div className="mt-5 pt-5 border-t border-white/5">
              <p className="text-xs text-white/40">
                Dein Agent kann jetzt automatisch Termine in deinem Kalender eintragen.
                Eingehende Terminanfragen werden direkt gebucht.
              </p>
            </div>
          </div>
        )}

        {/* Not connected state */}
        {!loading && !status?.connected && (
          <div className="space-y-4">
            <p className="text-sm text-white/40 mb-6">
              Kein Kalender verbunden. Wähle einen Anbieter um loszulegen:
            </p>

            {/* Google Calendar */}
            <div className="glass rounded-2xl p-6 border border-white/10 hover:border-white/20 transition-all duration-300">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                    style={{ background: 'rgba(34,197,94,0.1)' }}
                  >
                    🟢
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Google Calendar</h3>
                    <p className="text-sm text-white/50 mt-0.5">
                      Verbinde deinen Google-Kalender via OAuth
                    </p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setGoogleLoading(true);
                    try {
                      const { url } = await getGoogleCalendarAuthUrl();
                      window.location.href = url;
                    } catch (e: unknown) {
                      setError((e instanceof Error ? e.message : null) ?? 'Google OAuth konnte nicht gestartet werden');
                      setGoogleLoading(false);
                    }
                  }}
                  disabled={googleLoading}
                  className="shrink-0 rounded-xl px-5 py-2.5 font-semibold text-sm text-white disabled:opacity-50
                    transition-all duration-300 hover:shadow-[0_0_24px_rgba(249,115,22,0.4)] hover:scale-[1.02]"
                  style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
                >
                  {googleLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />
                      Verbinde…
                    </span>
                  ) : (
                    'Mit Google verbinden →'
                  )}
                </button>
              </div>
            </div>

            {/* Microsoft Outlook */}
            <div className="glass rounded-2xl p-6 border border-white/10 hover:border-white/20 transition-all duration-300">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                    style={{ background: 'rgba(0,120,212,0.12)' }}
                  >
                    🪟
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">Microsoft Outlook</h3>
                    <p className="text-sm text-white/50 mt-0.5">
                      Office 365 / Outlook.com via OAuth
                    </p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setMicrosoftLoading(true);
                    try {
                      const { url } = await getMicrosoftCalendarAuthUrl();
                      window.location.href = url;
                    } catch (e: unknown) {
                      setError((e instanceof Error ? e.message : null) ?? 'Microsoft OAuth konnte nicht gestartet werden');
                      setMicrosoftLoading(false);
                    }
                  }}
                  disabled={microsoftLoading}
                  className="shrink-0 rounded-xl px-5 py-2.5 font-semibold text-sm text-white disabled:opacity-50
                    transition-all duration-300 hover:shadow-[0_0_24px_rgba(0,120,212,0.4)] hover:scale-[1.02]"
                  style={{ background: 'linear-gradient(to right, #0078D4, #00BCF2)' }}
                >
                  {microsoftLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />
                      Verbinde…
                    </span>
                  ) : (
                    'Mit Microsoft verbinden →'
                  )}
                </button>
              </div>
            </div>

            {/* Cal.com */}
            <div className="glass rounded-2xl p-6 border border-white/10 hover:border-white/20 transition-all duration-300">
              <div className="flex items-center gap-4 mb-5">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                  style={{ background: 'rgba(59,130,246,0.1)' }}
                >
                  🔵
                </div>
                <div>
                  <h3 className="font-semibold text-white">Cal.com</h3>
                  <p className="text-sm text-white/50 mt-0.5">
                    Verbinde über deinen Cal.com API Key
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-wide">
                    API Key
                  </label>
                  <input
                    type="text"
                    value={calcomKey}
                    onChange={(e) => setCalcomKey(e.target.value)}
                    placeholder="cal_live_xxxx…"
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30
                      focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                  />
                  <details className="mt-2">
                    <summary className="text-xs text-white/30 cursor-pointer hover:text-white/50 transition-colors">
                      Wo finde ich meinen API Key?
                    </summary>
                    <p className="mt-2 text-xs text-white/40 leading-relaxed pl-2 border-l border-white/10">
                      Cal.com → Settings → Developer → API Keys → New API Key erstellen.
                      Wähle alle nötigen Berechtigungen (Availability, Bookings).
                    </p>
                  </details>
                </div>

                {calcomError && (
                  <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                    ⚠️ {calcomError}
                  </p>
                )}

                <button
                  onClick={handleCalcomConnect}
                  disabled={calcomLoading || !calcomKey.trim()}
                  className="self-end rounded-xl px-5 py-2.5 font-semibold text-sm text-white disabled:opacity-50
                    transition-all duration-300 hover:shadow-[0_0_24px_rgba(59,130,246,0.4)]"
                  style={{ background: 'linear-gradient(to right, #3B82F6, #F97316)' }}
                >
                  {calcomLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />
                      Verbinde…
                    </span>
                  ) : (
                    'Verbinden →'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Chippy Kalender */}
        <ChippyPanel />
      </div>
    </div>
  );
}

// ── Chippy Kalender Panel ─────────────────────────────────────────────────────

const DAY_NAMES: Record<string, string> = {
  '1': 'Montag', '2': 'Dienstag', '3': 'Mittwoch',
  '4': 'Donnerstag', '5': 'Freitag', '6': 'Samstag', '0': 'Sonntag',
};
const DAY_ORDER = ['1','2','3','4','5','6','0'];

const DEFAULT_SCHEDULE: ChippySchedule = {
  '0': { enabled: false, start: '09:00', end: '17:00' },
  '1': { enabled: true,  start: '09:00', end: '17:00' },
  '2': { enabled: true,  start: '09:00', end: '17:00' },
  '3': { enabled: true,  start: '09:00', end: '17:00' },
  '4': { enabled: true,  start: '09:00', end: '17:00' },
  '5': { enabled: true,  start: '09:00', end: '17:00' },
  '6': { enabled: false, start: '09:00', end: '17:00' },
};

function ChippyPanel() {
  const [schedule, setSchedule] = useState<ChippySchedule>(DEFAULT_SCHEDULE);
  const [blocks, setBlocks] = useState<ChippyBlock[]>([]);
  const [bookings, setBookings] = useState<ChippyBooking[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newBlockDate, setNewBlockDate] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');

  useEffect(() => {
    getChippyCalendar().then((d) => {
      setSchedule({ ...DEFAULT_SCHEDULE, ...d.schedule });
      setBlocks(d.blocks);
      setBookings(d.bookings);
    }).catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await saveChippySchedule(schedule);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally { setSaving(false); }
  }

  async function handleAddBlock() {
    if (!newBlockDate) return;
    try {
      const res = await addChippyBlock(newBlockDate, newBlockReason || undefined);
      setBlocks(prev => [...prev, { id: res.id, date: newBlockDate, reason: newBlockReason || null }]);
      setNewBlockDate('');
      setNewBlockReason('');
    } catch { /* ignore */ }
  }

  async function handleRemoveBlock(id: string) {
    try {
      await removeChippyBlock(id);
      setBlocks(prev => prev.filter(b => b.id !== id));
    } catch { /* ignore */ }
  }

  return (
    <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-6">
      <div>
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          🐾 Chippy Kalender
        </h2>
        <p className="text-sm text-white/40 mt-1">
          Kein Google oder Outlook? Kein Problem — trag hier deine Verfügbarkeit ein. Dein Agent nutzt diese Zeiten automatisch.
        </p>
      </div>

      {/* Weekly schedule */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">Wochentage</p>
        {DAY_ORDER.map((dow) => {
          const day = schedule[dow] ?? DEFAULT_SCHEDULE[dow]!;
          return (
            <div key={dow} className="flex items-center gap-3">
              {/* Toggle */}
              <button
                onClick={() => setSchedule(s => ({ ...s, [dow]: { ...day, enabled: !day.enabled } }))}
                className={`w-10 h-5 rounded-full transition-all shrink-0 ${day.enabled ? 'bg-orange-500' : 'bg-white/10'}`}
              >
                <span className={`block w-4 h-4 rounded-full bg-white mx-0.5 transition-transform ${day.enabled ? 'translate-x-5' : ''}`} />
              </button>
              {/* Day name */}
              <span className={`w-24 text-sm ${day.enabled ? 'text-white' : 'text-white/30'}`}>
                {DAY_NAMES[dow]}
              </span>
              {/* Times */}
              {day.enabled ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={day.start}
                    onChange={(e) => setSchedule(s => ({ ...s, [dow]: { ...day, start: e.target.value } }))}
                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                  />
                  <span className="text-white/30 text-xs">bis</span>
                  <input
                    type="time"
                    value={day.end}
                    onChange={(e) => setSchedule(s => ({ ...s, [dow]: { ...day, end: e.target.value } }))}
                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                  />
                </div>
              ) : (
                <span className="text-xs text-white/20">nicht verfügbar</span>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
        style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
      >
        {saving ? 'Speichern…' : saved ? 'Gespeichert ✓' : 'Verfügbarkeit speichern'}
      </button>

      {/* Date blocks */}
      <div className="space-y-3 pt-2 border-t border-white/5">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-widest pt-2">Nicht verfügbar an</p>
        <p className="text-xs text-white/30">Trag Urlaub, Krankheit oder einzelne freie Tage ein. Der Agent schlägt diese Tage nicht vor.</p>

        {blocks.length > 0 && (
          <div className="space-y-1.5">
            {blocks.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                <div>
                  <span className="text-sm text-white font-medium">{b.date}</span>
                  {b.reason && <span className="ml-2 text-xs text-white/40">{b.reason}</span>}
                </div>
                <button
                  onClick={() => handleRemoveBlock(b.id)}
                  className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                >
                  Entfernen
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="date"
            value={newBlockDate}
            onChange={(e) => setNewBlockDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500/50"
          />
          <input
            type="text"
            value={newBlockReason}
            onChange={(e) => setNewBlockReason(e.target.value)}
            placeholder="Grund (optional)"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
          />
          <button
            onClick={handleAddBlock}
            disabled={!newBlockDate}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-white/10 hover:bg-white/15 disabled:opacity-30 transition-all"
          >
            Sperren
          </button>
        </div>
      </div>

      {/* Upcoming bookings */}
      {bookings.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-white/5">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest pt-2">Kommende Termine</p>
          {bookings.map((b) => (
            <div key={b.id} className="rounded-xl bg-white/5 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{b.customer_name}</span>
                <span className="text-xs text-orange-400">
                  {new Date(b.slot_time).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="text-xs text-white/40 mt-0.5">
                {b.customer_phone}{b.service ? ` · ${b.service}` : ''}{b.notes ? ` · ${b.notes}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
