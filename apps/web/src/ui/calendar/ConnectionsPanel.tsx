import { useEffect, useState } from 'react';
import type { CalendarProvider, CalendarStatus } from '../../lib/api.js';
import {
  connectCalcom,
  disconnectCalendar,
  getCalendarStatus,
  getGoogleCalendarAuthUrl,
  getMicrosoftCalendarAuthUrl,
} from '../../lib/api.js';
import { FoxLogo } from '../FoxLogo.js';
import { IconMicrosoftWindow } from '../PhonbotIcons.js';

import { getProviderConnection } from './configuration.js';

export function ConnectionsPanel({ onStatusChange }: { onStatusChange: (s: CalendarStatus) => void }) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calcomKey, setCalcomKey] = useState('');
  const [calcomLoading, setCalcomLoading] = useState(false);
  const [calcomError, setCalcomError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  // Inline confirm instead of browser confirm() — chipy-design prefers
  // in-card affordances over system dialogs for quiet moments.
  const [confirmDisconnect, setConfirmDisconnect] = useState<Exclude<CalendarProvider, 'chipy'> | null>(null);

  async function loadStatus() {
    setLoading(true); setError(null);
    try { const d = await getCalendarStatus(); setStatus(d); onStatusChange(d); }
    catch (e: unknown) { setError((e instanceof Error ? e.message : null) ?? 'Fehler'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendarConnected') === 'true' || params.get('calendarError')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('calendarConnected'); url.searchParams.delete('calendarError');
      window.history.replaceState({}, '', url.toString());
      if (params.get('calendarError')) setError(`OAuth fehlgeschlagen: ${params.get('calendarError')}`);
    }
    loadStatus();

    // Listen for postMessage from OAuth popup (the callback page closes
    // itself and sends { type: 'calendarConnected' } to the opener).
    function onMessage(e: MessageEvent) {
      // Only accept messages from our own origin (not from random iframes/windows)
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'calendarConnected') {
        loadStatus();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      {/* Skeleton: connection status card */}
      <div className="glass rounded-2xl p-5 border border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-white/8" />
          <div>
            <div className="h-4 w-40 bg-white/10 rounded mb-1" />
            <div className="h-3 w-24 bg-white/5 rounded" />
          </div>
        </div>
        <div className="h-8 w-36 bg-white/8 rounded-lg" />
      </div>
      {/* Skeleton: schedule grid */}
      <div className="glass rounded-2xl p-5 border border-white/10">
        <div className="h-4 w-32 bg-white/10 rounded mb-4" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="h-16 rounded-lg bg-white/5" />
          ))}
        </div>
      </div>
    </div>
  );

  // Shared helper: runs disconnect + reloads status. Wrapped so the inline
  // confirm strip and any other trigger uses exactly one code path.
  async function runDisconnect(provider: Exclude<CalendarProvider, 'chipy'>) {
    setDisconnectLoading(true);
    try {
      await disconnectCalendar(provider);
      await loadStatus();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Trennen fehlgeschlagen');
    } finally {
      setDisconnectLoading(false);
      setConfirmDisconnect(null);
    }
  }

  // Small inline-confirm strip rendered under a connected provider row
  // instead of a modal. Same design in both CalendarPage and CapabilitiesTab
  // so the disconnect-flow feels identical everywhere.
  function InlineConfirmStrip({ provider, providerLabel }: { provider: Exclude<CalendarProvider, 'chipy'>; providerLabel: string }) {
    if (confirmDisconnect !== provider) return null;
    return (
      <div className="px-5 pb-4 -mt-1 border-t border-red-500/15 pt-3">
        <p className="text-xs text-white/70 mb-2.5 leading-relaxed">
          <span className="text-red-300">Sicher trennen?</span> Dein Agent kann nach dem Trennen keine Termine mehr in <span className="text-white">{providerLabel}</span> eintragen oder prüfen — bis du's wieder verbindest.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setConfirmDisconnect(null)}
            className="rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
            Abbrechen
          </button>
          <button onClick={() => { void runDisconnect(provider); }} disabled={disconnectLoading}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-200 bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 transition-colors disabled:opacity-50 cursor-pointer">
            {disconnectLoading ? 'Trenne…' : 'Ja, trennen'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl p-4 border border-red-500/20 bg-red-500/5">
          <p className="text-sm text-red-300">{error}</p>
          <button onClick={loadStatus} className="mt-2 text-xs text-white/40 hover:text-white/60 transition-colors">Erneut versuchen</button>
        </div>
      )}

      {/* The old top "Connected provider" card was removed 2026-04-23 —
          each provider now appears exactly once in the grid below with its
          status + disconnect action inline. */}

      <div className="space-y-3">
        <p className="text-xs text-white/40 mb-3">
          Verbinde einen Kalender, damit dein Agent Termine prüfen und buchen kann.
        </p>
        {(status as CalendarStatus | null)?.expired && (
          <div className="rounded-xl px-4 py-3 mb-2 text-xs" style={{ background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.2)', color: '#FB923C' }}>
            Deine {(status as CalendarStatus).expiredProvider === 'google' ? 'Google' : (status as CalendarStatus).expiredProvider === 'microsoft' ? 'Microsoft' : ''}-Verbindung ist abgelaufen. Bitte neu verbinden.
          </div>
        )}

        <div className="space-y-3">
          {/* Google */}
          {(() => {
            const conn = getProviderConnection(status, 'google');
            const isConnected = Boolean(conn?.connected);
            return (
              <div className="rounded-2xl hover:bg-white/[0.04] transition-all" style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(66,133,244,0.08)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" className="fancy-star"><defs><linearGradient id="gglCal" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#4285F4"/><stop offset="33%" stopColor="#34A853"/><stop offset="66%" stopColor="#FBBC05"/><stop offset="100%" stopColor="#EA4335"/></linearGradient></defs><path d="M12 1C12.8 7.6 16.4 11.2 23 12c-6.6.8-10.2 4.4-11 11-.8-6.6-4.4-10.2-11-11C7.6 11.2 11.2 7.6 12 1z" fill="url(#gglCal)"/></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-white">Google Calendar</p>
                    <p className="text-[11px] text-white/30 truncate">{isConnected ? conn?.email ?? 'Verbunden' : 'OAuth 2.0'}</p>
                  </div>
                  {isConnected ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="flex items-center gap-1.5 text-[11px] text-green-400/80 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Verbunden</span>
                      <button onClick={() => setConfirmDisconnect('google')} disabled={disconnectLoading || Boolean(confirmDisconnect)}
                        className="text-[11px] text-white/35 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer">
                        Trennen
                      </button>
                    </div>
                  ) : (
                    <button onClick={async () => { setGoogleLoading(true); try { const { url } = await getGoogleCalendarAuthUrl(); window.location.href = url; } catch { setGoogleLoading(false); } }}
                      disabled={googleLoading}
                      className="shrink-0 rounded-lg px-4 py-2 font-semibold text-xs text-white disabled:opacity-50 transition-all hover:brightness-110 cursor-pointer"
                      style={{ background: 'linear-gradient(135deg, #4285F4, #34A853, #FBBC05, #EA4335)', backgroundSize: '300% 300%', animation: 'fancy-bg 4s ease infinite' }}>
                      {googleLoading ? 'Verbinde…' : 'Verbinden'}
                    </button>
                  )}
                </div>
                {isConnected && <InlineConfirmStrip provider="google" providerLabel="Google Calendar" />}
              </div>
            );
          })()}

          {/* Microsoft */}
          {(() => {
            const conn = getProviderConnection(status, 'microsoft');
            const isConnected = Boolean(conn?.connected);
            return (
              <div className="rounded-2xl hover:bg-white/[0.04] transition-all" style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-[#00BCF2]" style={{ background: 'rgba(0,120,212,0.08)' }}>
                    <IconMicrosoftWindow size={19} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-white">Microsoft Outlook</p>
                    <p className="text-[11px] text-white/30 truncate">{isConnected ? conn?.email ?? 'Verbunden' : 'Office 365 / Outlook.com'}</p>
                  </div>
                  {isConnected ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="flex items-center gap-1.5 text-[11px] text-green-400/80 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Verbunden</span>
                      <button onClick={() => setConfirmDisconnect('microsoft')} disabled={disconnectLoading || Boolean(confirmDisconnect)}
                        className="text-[11px] text-white/35 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer">
                        Trennen
                      </button>
                    </div>
                  ) : (
                    <button onClick={async () => { setMicrosoftLoading(true); try { const { url } = await getMicrosoftCalendarAuthUrl(); window.location.href = url; } catch { setMicrosoftLoading(false); } }}
                      disabled={microsoftLoading}
                      className="shrink-0 rounded-lg px-4 py-2 font-semibold text-xs text-white disabled:opacity-50 transition-all hover:brightness-110 cursor-pointer"
                      style={{ background: 'linear-gradient(135deg, #0078D4, #00BCF2)' }}>
                      {microsoftLoading ? 'Verbinde…' : 'Verbinden'}
                    </button>
                  )}
                </div>
                {isConnected && <InlineConfirmStrip provider="microsoft" providerLabel="Microsoft Outlook" />}
              </div>
            );
          })()}

          {/* Cal.com */}
          {(() => {
            const conn = getProviderConnection(status, 'calcom');
            const isConnected = Boolean(conn?.connected);
            return (
              <div className="rounded-2xl px-5 py-4 hover:bg-white/[0.04] transition-all" style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.08)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#20d9ff" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-white">Cal.com</p>
                    <p className="text-[11px] text-white/30">{isConnected ? 'Verbunden' : 'API Key'}</p>
                  </div>
                  {isConnected && (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="flex items-center gap-1.5 text-[11px] text-green-400/80 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Verbunden</span>
                      <button onClick={() => setConfirmDisconnect('calcom')} disabled={disconnectLoading || Boolean(confirmDisconnect)}
                        className="text-[11px] text-white/35 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer">
                        Trennen
                      </button>
                    </div>
                  )}
                </div>
                {!isConnected && (
                  <div className="flex gap-2 mt-3">
                    <input type="text" value={calcomKey} onChange={e => setCalcomKey(e.target.value)} placeholder="cal_live_xxxx…"
                      className="flex-1 rounded-lg px-3 py-2 text-sm text-white placeholder-white/15 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} />
                    <button onClick={async () => { setCalcomLoading(true); setCalcomError(null); try { await connectCalcom(calcomKey); setCalcomKey(''); await loadStatus(); } catch (e: unknown) { setCalcomError((e instanceof Error ? e.message : null) ?? 'Fehler'); } finally { setCalcomLoading(false); } }}
                      disabled={calcomLoading || !calcomKey.trim()}
                      className="shrink-0 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer transition-all hover:brightness-110"
                      style={{ background: 'rgba(255,91,10,0.06)', border: '1px solid rgba(255,91,10,0.12)' }}>
                      <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}>
                        {calcomLoading ? '…' : 'Verbinden'}
                      </span>
                    </button>
                    {calcomError && <p className="text-xs text-red-300 mt-2">{calcomError}</p>}
                  </div>
                )}
                {isConnected && <InlineConfirmStrip provider="calcom" providerLabel="Cal.com" />}
              </div>
            );
          })()}

          {/* Chipy (built-in) */}
          <div className="flex items-center gap-4 rounded-2xl px-5 py-4" style={{ background: 'rgba(255,91,10,0.03)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,91,10,0.08)' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, rgba(255,91,10,0.1), rgba(32,217,255,0.06))' }}>
              <FoxLogo size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-white">Chipy Kalender</p>
              <p className="text-[11px] text-white/30">Eingebaut — immer aktiv</p>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-green-400/70 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Aktiv</span>
          </div>
        </div>
      </div>
    </div>
  );
}
