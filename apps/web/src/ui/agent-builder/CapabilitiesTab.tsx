import React, { useState, useEffect, useCallback } from 'react';
import type { AgentConfig, CallRoutingRule, LiveWebAccess } from '../../lib/api.js';
import { ForwardingHint } from '../ForwardingHint.js';
import {
  getCalendarStatus,
  getGoogleCalendarAuthUrl,
  getMicrosoftCalendarAuthUrl,
  connectCalcom,
  disconnectCalendar,
  getPhoneNumbers,
} from '../../lib/api.js';
import {
  SectionCard, Toggle,
  IconPhoneOut, IconPhoneOff, IconMicUpload, IconTicket, IconCalendar,
  IconBookOpen, IconCheckCircle, IconWebhook, IconGlobe,
  type SectionIconComp,
} from './shared.js';

export interface CapabilitiesTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function CapabilitiesTab({ config, onUpdate }: CapabilitiesTabProps) {
  // Load org's Phonbot phone numbers + forwarding info for loop-detection warning.
  // We rely on:
  //   • number          — every Phonbot inbound is a guaranteed loop target
  //   • customer_number — set only when /phone/verify-forwarding succeeded
  //   • forwarding_type — 'always' | 'no_answer', set during the same successful loop test
  //   • verified        — true when the loop test confirmed forwarding to this Phonbot inbound
  const [phoneInfo, setPhoneInfo] = useState<Array<{
    number: string;
    customerNumber?: string;
    forwardingType?: 'always' | 'no_answer';
    verified?: boolean;
  }>>([]);
  useEffect(() => {
    getPhoneNumbers()
      .then(res => setPhoneInfo((res.items ?? []).map(p => {
        const raw = p as Record<string, unknown>;
        const ftRaw = raw.forwarding_type as string | undefined;
        const ft: 'always' | 'no_answer' | undefined =
          ftRaw === 'always' || ftRaw === 'no_answer' ? ftRaw : undefined;
        return {
          number: (p.number ?? '').replace(/\s/g, ''),
          customerNumber: (raw.customer_number as string | undefined)?.replace(/\s/g, '') ?? undefined,
          forwardingType: ft,
          verified: (raw.verified as boolean | undefined) ?? false,
        };
      })))
      .catch(() => {});
  }, []);

  return (
    <>
      {/* Call Routing Rules */}
      <SectionCard title="Rufweiterleitung & Gesprächslogik" icon={IconPhoneOut}>
        <div className="flex items-start gap-2 mb-4 flex-wrap">
          <p className="text-sm text-white/50 flex-1 min-w-[16rem]">
            Definiere Regeln in natürlicher Sprache — der Agent erkennt die Situation und handelt automatisch.
          </p>
          <ForwardingHint />
        </div>
        <CallRoutingEditor
          phoneInfo={phoneInfo}
          items={config.callRoutingRules ?? []}
          onChange={(items) => onUpdate({ callRoutingRules: items })}
        />
      </SectionCard>

      {/* Calendar Integrations */}
      <SectionCard title="Kalender-Anbindung" icon={IconCalendar}>
        <p className="text-sm text-white/50 mb-4">
          Verbinde einen Kalender, damit dein Agent Termine prüfen und buchen kann.
        </p>
        <CalendarConnector
          integrations={config.calendarIntegrations ?? []}
          onChange={(items) => onUpdate({ calendarIntegrations: items })}
        />
      </SectionCard>

      {/* API Integrations moved to the "Webhooks & APIs" tab (WebhooksTab). */}

      {/* Live Web Access */}
      <SectionCard title="Live Website-Zugriff" icon={IconGlobe}>
        <p className="text-sm text-white/50 mb-4">
          Erlaube deinem Agent, während des Gesprächs aktuelle Infos von Webseiten abzurufen (z.B. Preise, Verfügbarkeit).
        </p>
        <LiveWebAccessEditor
          config={config.liveWebAccess ?? { enabled: false, allowedDomains: [] }}
          onChange={(v) => onUpdate({ liveWebAccess: v })}
        />
      </SectionCard>
    </>
  );
}

/* ── Call Routing Rules ── */

const ROUTING_EXAMPLES = [
  'Wenn der Kunde nach einer Reklamation fragt → Weiterleiten an Reklamationsabteilung',
  'Wenn der Anrufer "Notfall" sagt → Sofort weiterleiten an +49 170 1234567',
  'Wenn der Kunde 3x nach einem Mitarbeiter fragt → Weiterleiten an Zentrale',
  'Wenn der Anrufer nichts sagt nach 10 Sekunden → Höflich auflegen',
  'Wenn die Anfrage medizinisch dringend ist → Ticket erstellen mit Priorität Hoch',
];

type PhoneInfoItem = { number: string; customerNumber?: string; forwardingType?: 'always' | 'no_answer'; verified?: boolean };

function CallRoutingEditor({ items, onChange, phoneInfo = [] }: { items: CallRoutingRule[]; onChange: (v: CallRoutingRule[]) => void; phoneInfo?: PhoneInfoItem[] }) {
  const normalize = (n: string) => n.replace(/[\s\-()]/g, '');

  /**
   * Check if the transfer target would cause a loop.
   *
   * Inputs:
   *   - phoneInfo entries with verified=true → forwarding to Phonbot was
   *     CONFIRMED via /phone/verify-forwarding loop test
   *   - forwardingType ∈ {'always','no_answer'} is also set on confirmed entries
   *
   * Decisions:
   *   - target equals a Phonbot inbound  → definite loop
   *   - target equals a verified customer_number with type 'always'
   *                                      → definite loop
   *   - target equals a verified customer_number with type 'no_answer'
   *                                      → safe (Phonbot hangs up before
   *                                        the carrier triggers forwarding)
   *   - target equals an UNverified customer_number
   *                                      → maybe-loop warning, prompt user to
   *                                        run the test
   */
  function getLoopWarning(target: string): { type: 'loop' | 'maybe_loop' | null; forwardingType?: 'always' | 'no_answer' } {
    const t = normalize(target);
    if (t.length < 5) return { type: null };

    // Direct match: target IS one of the Phonbot numbers
    if (phoneInfo.some(p => normalize(p.number) === t)) {
      return { type: 'loop' };
    }

    const matchedPhone = phoneInfo.find(p => p.customerNumber && normalize(p.customerNumber) === t);
    if (matchedPhone) {
      if (matchedPhone.verified && matchedPhone.forwardingType === 'always') {
        return { type: 'loop', forwardingType: 'always' };
      }
      if (matchedPhone.verified && matchedPhone.forwardingType === 'no_answer') {
        return { type: null, forwardingType: 'no_answer' }; // safe
      }
      // Unverified customer_number record (legacy or old verify-forwarding fail)
      return { type: 'maybe_loop' };
    }

    return { type: null };
  }
  function add() {
    onChange([...items, {
      id: crypto.randomUUID(),
      description: '',
      action: 'transfer',
      target: '',
      enabled: true,
    }]);
  }

  function patch(i: number, p: Partial<CallRoutingRule>) {
    const next = [...items];
    next[i] = { ...next[i], ...p } as CallRoutingRule;
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  const ACTION_OPTIONS: { id: CallRoutingRule['action']; label: string; Icon: SectionIconComp }[] = [
    { id: 'transfer',  label: 'Weiterleiten',    Icon: IconPhoneOut },
    { id: 'hangup',    label: 'Auflegen',         Icon: IconPhoneOff },
    { id: 'voicemail', label: 'Mailbox',          Icon: IconMicUpload },
    { id: 'ticket',    label: 'Ticket',           Icon: IconTicket },
  ];

  return (
    <div className="space-y-3">
      {/* Examples hint */}
      {items.length === 0 && (
        <div className="bg-white/5 rounded-xl p-4 space-y-2">
          <span className="text-xs font-medium text-white/40">Beispiele:</span>
          <div className="space-y-1">
            {ROUTING_EXAMPLES.slice(0, 3).map((ex, i) => (
              <button key={i} onClick={() => {
                const parts = ex.split(' → ');
                onChange([...items, {
                  id: crypto.randomUUID(),
                  description: parts[0] ?? '',
                  action: ex.includes('auflegen') ? 'hangup' as const : ex.includes('Ticket') ? 'ticket' as const : 'transfer' as const,
                  target: parts[1] ?? '',
                  enabled: true,
                }]);
              }}
                className="block w-full text-left text-xs text-white/40 hover:text-orange-300 transition-colors py-1 px-2 rounded hover:bg-white/5">
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {items.map((rule, i) => (
        <div key={rule.id} className="bg-white/5 rounded-xl px-4 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <Toggle checked={rule.enabled} onChange={(v) => patch(i, { enabled: v })} label="" />
            <div className="flex-1 space-y-3">
              <textarea
                value={rule.description}
                onChange={(e) => patch(i, { description: e.target.value })}
                placeholder="Beschreibe die Situation in natürlicher Sprache… z.B. 'Wenn der Kunde nach dem Geschäftsführer fragt'"
                rows={2}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none resize-y"
              />
              <div className="flex gap-3 items-center">
                <span className="text-xs text-white/50 shrink-0">Dann →</span>
                <div className="flex gap-2">
                  {ACTION_OPTIONS.map((act) => (
                    <button key={act.id} onClick={() => patch(i, { action: act.id })}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        rule.action === act.id
                          ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                          : 'bg-white/5 text-white/50 border border-white/10 hover:border-white/20'
                      }`}>
                      <act.Icon size={12} /> {act.label}
                    </button>
                  ))}
                </div>
              </div>
              {(rule.action === 'transfer') && (
                <div className="space-y-2">
                  {(() => {
                    const warn = rule.target ? getLoopWarning(rule.target) : { type: null };
                    return (<>
                      <input
                        value={rule.target ?? ''}
                        onChange={(e) => patch(i, { target: e.target.value })}
                        placeholder="Ziel: Telefonnummer oder Abteilung (z.B. +49 170 1234567 oder 'Vertrieb')"
                        className={`w-full rounded-lg border bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none ${
                          warn.type ? 'border-amber-500/50' : 'border-white/10'
                        }`}
                      />
                      {warn.type === 'loop' && (
                        <div className="flex gap-2 items-start rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
                          <span className="text-red-400 text-sm shrink-0 mt-0.5">&#9888;</span>
                          <div className="text-xs text-red-300/90 leading-relaxed flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <strong>Endlosschleife!</strong>
                              <ForwardingHint />
                            </div>
                            <div className="mt-1">
                              {warn.forwardingType === 'always'
                                ? 'Diese Nummer hat eine „Immer weiterleiten"-Rufumleitung zu Phonbot. Ein Transfer hierhin erzeugt eine Endlosschleife.'
                                : 'Diese Nummer ist deine Phonbot-Nummer. Ein Transfer hierhin erzeugt eine Endlosschleife.'}
                            </div>
                            <span className="block mt-1.5 text-white/50">
                              <strong>Lösung:</strong> Trage deine <strong>Mobilnummer</strong> oder eine Nummer <strong>ohne Rufumleitung</strong> ein. Oder stelle auf &quot;Bei Nichtannahme&quot; um.
                            </span>
                          </div>
                        </div>
                      )}
                      {warn.type === 'maybe_loop' && (
                        <div className="flex gap-2 items-start rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                          <span className="text-amber-400 text-sm shrink-0 mt-0.5">&#9888;</span>
                          <div className="text-xs text-amber-300/90 leading-relaxed flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <strong>Mögliche Schleife:</strong>
                              <ForwardingHint />
                            </div>
                            <div className="mt-1">
                              Diese Nummer wurde noch nicht als Weiterleitung zu Phonbot bestätigt. Im Telefon-Tab den „Weiterleitung testen"-Button drücken — wenn die Weiterleitung auf „Immer" steht, entsteht eine Endlosschleife.
                            </div>
                          </div>
                        </div>
                      )}
                    </>);
                  })()}
                </div>
              )}
            </div>
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer mt-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>
      ))}

      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + Neue Regel hinzufügen
      </button>
    </div>
  );
}

/* ── Calendar Connector ── */

const CALENDAR_PROVIDERS: { id: 'google' | 'outlook' | 'calcom' | 'caldav'; Icon: SectionIconComp; name: string; desc: string }[] = [
  { id: 'google',  Icon: IconCalendar,    name: 'Google Calendar',     desc: 'Verbinde dein Google-Konto' },
  { id: 'outlook', Icon: IconBookOpen,    name: 'Microsoft Outlook',   desc: 'Outlook / Microsoft 365' },
  { id: 'calcom',  Icon: IconCheckCircle, name: 'Cal.com',             desc: 'Open-Source Terminbuchung' },
  { id: 'caldav',  Icon: IconWebhook,     name: 'CalDAV',              desc: 'Nextcloud, iCloud, etc.' },
];

function CalendarConnector({ integrations, onChange }: {
  integrations: AgentConfig['calendarIntegrations'] & {};
  onChange: (v: NonNullable<AgentConfig['calendarIntegrations']>) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [calcomKey, setCalcomKey] = useState('');
  const [showCalcomInput, setShowCalcomInput] = useState(false);
  const [serverConnection, setServerConnection] = useState<{ connected: boolean; provider: string | null; email: string | null } | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  // Load real calendar connection status from server
  const loadStatus = useCallback(async () => {
    try {
      const status = await getCalendarStatus();
      setServerConnection(status);
      // Sync server state into config integrations
      if (status.connected && status.provider) {
        const existing = integrations ?? [];
        const providerName = CALENDAR_PROVIDERS.find(p => p.id === status.provider)?.name ?? status.provider;
        const alreadyExists = existing.find(c => c.provider === status.provider);
        if (!alreadyExists) {
          onChange([...existing, {
            provider: status.provider as 'google' | 'outlook' | 'calcom' | 'caldav',
            connected: true,
            email: status.email ?? undefined,
            label: providerName,
          }]);
        } else if (!alreadyExists.connected) {
          onChange(existing.map(c => c.provider === status.provider ? { ...c, connected: true, email: status.email ?? undefined } : c));
        }
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function connectProvider(provider: typeof CALENDAR_PROVIDERS[number]['id']) {
    setLoading(true);
    try {
      if (provider === 'google') {
        const { url } = await getGoogleCalendarAuthUrl();
        window.open(url, '_blank', 'width=600,height=700');
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const s = await getCalendarStatus();
          if (s.connected && s.provider === 'google') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            void loadStatus();
          }
        }, 2000);
        if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = setTimeout(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, 120000);
      } else if (provider === 'outlook') {
        const { url } = await getMicrosoftCalendarAuthUrl();
        window.open(url, '_blank', 'width=600,height=700');
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const s = await getCalendarStatus();
          if (s.connected && s.provider === 'microsoft') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            void loadStatus();
          }
        }, 2000);
        if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = setTimeout(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, 120000);
      } else if (provider === 'calcom') {
        setShowCalcomInput(true);
        setLoading(false);
        return;
      } else {
        // CalDAV — not yet supported
        setLoading(false);
        return;
      }
    } catch { /* error handled by UI */ }
    setLoading(false);
  }

  async function handleCalcomConnect() {
    if (!calcomKey.trim()) return;
    setLoading(true);
    try {
      const result = await connectCalcom(calcomKey.trim());
      if (result.ok) {
        setShowCalcomInput(false);
        setCalcomKey('');
        void loadStatus();
      }
    } catch { /* non-fatal */ }
    setLoading(false);
  }

  async function handleDisconnect(provider: string) {
    setLoading(true);
    try {
      await disconnectCalendar();
      setServerConnection(null);
      onChange((integrations ?? []).filter(c => c.provider !== provider));
    } catch { /* non-fatal */ }
    setLoading(false);
  }

  const connected = (integrations ?? []).filter(c => c.connected);
  // Inline disconnect confirmation — expands underneath the row instead of
  // popping a modal, matches the chipy-design "quiet motion" rule.
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* Cal.com API Key input (modal-ish banner when user picks cal.com) */}
      {showCalcomInput && (
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-4 space-y-3">
          <p className="text-sm text-white/70">Cal.com API Key eingeben:</p>
          <input
            value={calcomKey}
            onChange={(e) => setCalcomKey(e.target.value)}
            placeholder="cal_live_..."
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
          />
          <div className="flex gap-2">
            <button onClick={handleCalcomConnect} disabled={loading || !calcomKey.trim()}
              className="px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50 cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              {loading ? 'Verbinde…' : 'Verbinden'}
            </button>
            <button onClick={() => { setShowCalcomInput(false); setCalcomKey(''); }}
              className="px-4 py-2 rounded-lg text-xs text-white/50 hover:text-white/70 bg-white/5 cursor-pointer">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Unified provider grid — each provider appears exactly once. When
          connected the row shows the email + green status + inline Trennen
          action with a confirmation expand underneath. No separate
          "Connected calendars" section above anymore (was a duplicate). */}
      <div className="grid grid-cols-2 gap-3">
        {CALENDAR_PROVIDERS.map((prov) => {
          const isConnected = connected.find(
            c => c.provider === prov.id || (prov.id === 'outlook' && c.provider === ('microsoft' as string)),
          );
          const isCalDAV = prov.id === 'caldav';
          const isConfirming = confirmDisconnect === (isConnected?.provider ?? '');

          return (
            <div key={prov.id} className={`rounded-xl border transition-all ${
              isConnected
                ? 'border-green-500/25 bg-green-500/[0.06]'
                : isCalDAV
                  ? 'border-white/10 bg-white/5 opacity-40'
                  : 'border-white/10 bg-white/5 hover:border-orange-500/40 hover:bg-white/10'
            }`}>
              {/* Row body */}
              <div className="flex items-center gap-3 p-4">
                <prov.Icon size={18} className={isConnected ? 'text-green-400 shrink-0' : 'text-white/50 shrink-0'} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{prov.name}</p>
                  <p className="text-xs text-white/40 truncate">
                    {isConnected ? (isConnected.email ?? 'Verbunden') : isCalDAV ? 'Bald verfügbar' : prov.desc}
                  </p>
                </div>
                {isConnected ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="flex items-center gap-1 text-[11px] text-green-400/80 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />Verbunden
                    </span>
                    <button
                      onClick={() => setConfirmDisconnect(isConnected.provider)}
                      disabled={loading || isConfirming}
                      className="text-xs text-white/35 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      Trennen
                    </button>
                  </div>
                ) : !isCalDAV ? (
                  <button
                    onClick={() => connectProvider(prov.id)}
                    disabled={loading}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer transition-all hover:brightness-110"
                    style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                  >
                    Verbinden
                  </button>
                ) : null}
              </div>

              {/* Inline disconnect confirm — expands under the row.
                  Chipy-design: red-tinted glass strip, destructive action on
                  the right, abbrechen as ghost on the left. */}
              {isConfirming && isConnected && (
                <div className="px-4 pb-4 -mt-1 border-t border-red-500/15 pt-3">
                  <p className="text-xs text-white/70 mb-2.5 leading-relaxed">
                    <span className="text-red-300">Sicher trennen?</span> Dein Agent kann nach dem Trennen keine Termine mehr in <span className="text-white">{prov.name}</span> eintragen oder prüfen — bis du's wieder verbindest.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setConfirmDisconnect(null)}
                      className="rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={async () => {
                        await handleDisconnect(isConnected.provider);
                        setConfirmDisconnect(null);
                      }}
                      disabled={loading}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-200 bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {loading ? 'Trenne…' : 'Ja, trennen'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
        Nach der Verbindung kann dein Agent freie Termine prüfen, Buchungen erstellen und Kalender-Konflikte erkennen.
      </div>
    </div>
  );
}

/* API-Integration editor lives in WebhooksTab.tsx — moved 2026-04-23 so
 * the Fähigkeiten-Tab stays focused on the in-call capabilities (routing,
 * calendar, live-web), and Webhooks + APIs sit together as the outbound
 * system-to-system surface. */

/* ── Live Web Access Editor ── */

function LiveWebAccessEditor({ config, onChange }: { config: LiveWebAccess; onChange: (v: LiveWebAccess) => void }) {
  const [domainInput, setDomainInput] = useState('');

  function addDomain() {
    const domain = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || config.allowedDomains.includes(domain)) return;
    onChange({ ...config, allowedDomains: [...config.allowedDomains, domain] });
    setDomainInput('');
  }

  return (
    <div className="space-y-4">
      <Toggle checked={config.enabled} onChange={(v) => onChange({ ...config, enabled: v })}
        label="Live-Zugriff auf Webseiten aktivieren" />

      {config.enabled && (
        <>
          <div>
            <span className="text-sm font-medium text-white/70 block mb-2">Erlaubte Domains</span>
            <div className="flex flex-wrap gap-2 mb-3">
              {config.allowedDomains.map((domain, i) => (
                <span key={i} className="flex items-center gap-1.5 bg-white/10 text-white/80 text-sm px-3 py-1.5 rounded-full">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-white/40 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
                  {domain}
                  <button onClick={() => onChange({
                    ...config,
                    allowedDomains: config.allowedDomains.filter((_, j) => j !== i),
                  })} className="text-white/30 hover:text-red-400 cursor-pointer transition-colors"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </span>
              ))}
              {config.allowedDomains.length === 0 && (
                <span className="text-sm text-white/30">Keine Domains — Agent hat keinen Webzugriff</span>
              )}
            </div>
            <div className="flex gap-2">
              <input value={domainInput} onChange={(e) => setDomainInput(e.target.value)}
                placeholder="z.B. meine-firma.de"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain())} />
              <button onClick={addDomain}
                className="rounded-lg bg-white/10 border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/15 transition-colors">
                + Hinzufügen
              </button>
            </div>
          </div>

          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3 text-xs text-orange-300">
            Der Agent kann aktuelle Preise, Produktinfos oder Verfügbarkeiten direkt von deiner Website lesen — in Echtzeit während des Gesprächs.
          </div>
        </>
      )}
    </div>
  );
}

/* ForwardingHint is imported from ../ForwardingHint.js — shared with
 * PhoneManager so the same orange pill + speech-bubble shows up on both
 * the Agent-Builder routing rules AND the Phone-Tab forwarding setup.
 */
