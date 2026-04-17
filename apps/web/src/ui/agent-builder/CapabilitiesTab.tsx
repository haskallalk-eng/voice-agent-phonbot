import React, { useState, useEffect, useCallback } from 'react';
import type { AgentConfig, CallRoutingRule, ApiIntegration, LiveWebAccess } from '../../lib/api.js';
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
  IconBookOpen, IconCheckCircle, IconWebhook, IconPlug, IconGlobe,
  type SectionIconComp,
} from './shared.js';

export interface CapabilitiesTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function CapabilitiesTab({ config, onUpdate }: CapabilitiesTabProps) {
  // Load org's Phonbot phone numbers + forwarding info for loop-detection warning
  const [phoneInfo, setPhoneInfo] = useState<Array<{ number: string; customerNumber?: string; forwardingType?: string }>>([]);
  useEffect(() => {
    getPhoneNumbers()
      .then(res => setPhoneInfo((res.items ?? []).map(p => ({
        number: (p.number ?? '').replace(/\s/g, ''),
        customerNumber: ((p as Record<string, unknown>).customer_number as string | undefined)?.replace(/\s/g, '') ?? undefined,
        forwardingType: (p as Record<string, unknown>).forwarding_type as string | undefined,
      }))))
      .catch(() => {});
  }, []);

  return (
    <>
      {/* Call Routing Rules */}
      <SectionCard title="Rufweiterleitung & Gesprächslogik" icon={IconPhoneOut}>
        <p className="text-sm text-white/50 mb-4">
          Definiere Regeln in natürlicher Sprache — der Agent erkennt die Situation und handelt automatisch.
        </p>
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

      {/* API Integrations */}
      <SectionCard title="API-Integrationen" icon={IconPlug}>
        <p className="text-sm text-white/50 mb-4">
          Verbinde externe Systeme (CRM, ERP, Buchungssysteme) — dein Agent kann während des Gesprächs darauf zugreifen.
        </p>
        <ApiIntegrationEditor
          items={config.apiIntegrations ?? []}
          onChange={(items) => onUpdate({ apiIntegrations: items })}
        />
      </SectionCard>

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

type PhoneInfoItem = { number: string; customerNumber?: string; forwardingType?: string };

function CallRoutingEditor({ items, onChange, phoneInfo = [] }: { items: CallRoutingRule[]; onChange: (v: CallRoutingRule[]) => void; phoneInfo?: PhoneInfoItem[] }) {
  const normalize = (n: string) => n.replace(/[\s\-()]/g, '');

  /** Check if the transfer target would cause a loop */
  function getLoopWarning(target: string): { type: 'loop' | 'maybe_loop' | null; forwardingType?: string } {
    const t = normalize(target);
    if (t.length < 5) return { type: null };

    // Direct match: target IS one of the Phonbot numbers
    if (phoneInfo.some(p => normalize(p.number) === t)) {
      return { type: 'loop' };
    }

    // Target matches a customer_number that has "always" forwarding → definite loop
    const matchedPhone = phoneInfo.find(p => p.customerNumber && normalize(p.customerNumber) === t);
    if (matchedPhone) {
      if (matchedPhone.forwardingType === 'always') return { type: 'loop', forwardingType: 'always' };
      if (matchedPhone.forwardingType === 'no_answer') return { type: null, forwardingType: 'no_answer' }; // safe
      return { type: 'maybe_loop', forwardingType: matchedPhone.forwardingType ?? 'unknown' }; // unknown → warn
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
                          <div className="text-xs text-red-300/90 leading-relaxed">
                            <strong>Endlosschleife!</strong> {warn.forwardingType === 'always'
                              ? 'Diese Nummer hat eine „Immer weiterleiten"-Rufumleitung zu Phonbot. Ein Transfer hierhin erzeugt eine Endlosschleife.'
                              : 'Diese Nummer ist deine Phonbot-Nummer. Ein Transfer hierhin erzeugt eine Endlosschleife.'}
                            <span className="block mt-1.5 text-white/50">
                              <strong>Lösung:</strong> Trage deine <strong>Mobilnummer</strong> oder eine Nummer <strong>ohne Rufumleitung</strong> ein. Oder stelle auf &quot;Bei Nichtannahme&quot; um.
                            </span>
                          </div>
                        </div>
                      )}
                      {warn.type === 'maybe_loop' && (
                        <div className="flex gap-2 items-start rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                          <span className="text-amber-400 text-sm shrink-0 mt-0.5">&#9888;</span>
                          <div className="text-xs text-amber-300/90 leading-relaxed">
                            <strong>Mögliche Schleife:</strong> Diese Nummer hat eine Rufumleitung zu Phonbot (Typ: {warn.forwardingType}). Prüfe im Telefon-Tab ob die Weiterleitung auf &quot;Bei Nichtannahme&quot; steht — sonst entsteht eine Endlosschleife.
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

  return (
    <div className="space-y-4">
      {/* Connected calendars */}
      {connected.length > 0 && (
        <div className="space-y-2 mb-2">
          {connected.map((cal) => (
            <div key={cal.provider} className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
              {(() => { const P = CALENDAR_PROVIDERS.find((p) => p.id === cal.provider); return P ? <P.Icon size={16} className="text-green-400 shrink-0" /> : null; })()}
              <div className="flex-1">
                <p className="text-sm text-white font-medium">{cal.label ?? cal.provider}</p>
                {cal.email && <p className="text-xs text-white/40">{cal.email}</p>}
              </div>
              <span className="flex items-center gap-1 text-xs text-green-400 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />Verbunden</span>
              <button onClick={() => handleDisconnect(cal.provider)} disabled={loading}
                className="text-white/30 hover:text-red-400 text-sm disabled:opacity-50 cursor-pointer">Trennen</button>
            </div>
          ))}
        </div>
      )}

      {/* Cal.com API Key input */}
      {showCalcomInput && (
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-4 space-y-3">
          <p className="text-sm text-white/70">Cal.com API Key eingeben:</p>
          <input
            value={calcomKey}
            onChange={(e) => setCalcomKey(e.target.value)}
            placeholder="cal_live_..."
            type="password"
            // F5: API keys are NOT user passwords — autocomplete='off' so Chrome
            // doesn't store them in the password manager and surface them in
            // unrelated forms. spellCheck off + autoCorrect off avoid mobile
            // mangling of the key.
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

      {/* Provider grid */}
      <div className="grid grid-cols-2 gap-3">
        {CALENDAR_PROVIDERS.map((prov) => {
          const isConnected = connected.find(c => c.provider === prov.id || (prov.id === 'outlook' && c.provider === ('microsoft' as string)));
          const isCalDAV = prov.id === 'caldav';
          return (
            <button key={prov.id} onClick={() => !isConnected && !isCalDAV && connectProvider(prov.id)}
              disabled={!!isConnected || loading || isCalDAV}
              className={`flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                isConnected
                  ? 'border-green-500/20 bg-green-500/5 opacity-60 cursor-default'
                  : isCalDAV
                    ? 'border-white/10 bg-white/5 opacity-40 cursor-default'
                    : 'border-white/10 bg-white/5 hover:border-orange-500/40 hover:bg-white/10 cursor-pointer'
              }`}>
              <prov.Icon size={18} className="text-white/50 shrink-0" />
              <div>
                <p className="text-sm font-medium text-white">{prov.name}</p>
                <p className="text-xs text-white/40">{isConnected ? 'Bereits verbunden' : isCalDAV ? 'Bald verfügbar' : prov.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
        Nach der Verbindung kann dein Agent freie Termine prüfen, Buchungen erstellen und Kalender-Konflikte erkennen.
      </div>
    </div>
  );
}

/* ── API Integration Editor ── */

function ApiIntegrationEditor({ items, onChange }: { items: ApiIntegration[]; onChange: (v: ApiIntegration[]) => void }) {
  function add() {
    onChange([...items, {
      id: crypto.randomUUID(),
      name: '',
      type: 'rest',
      baseUrl: '',
      authType: 'none',
      description: '',
      enabled: true,
    }]);
  }

  function patch(i: number, p: Partial<ApiIntegration>) {
    const next = [...items];
    next[i] = { ...next[i], ...p } as ApiIntegration;
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  return (
    <div className="space-y-3">
      {items.map((api, i) => (
        <div key={api.id} className="bg-white/5 rounded-xl px-4 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <Toggle checked={api.enabled} onChange={(v) => patch(i, { enabled: v })} label="" />
            <input value={api.name} onChange={(e) => patch(i, { name: e.target.value })}
              placeholder="Name (z.B. CRM, Buchungssystem)"
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none" />
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>

          <input value={api.baseUrl} onChange={(e) => patch(i, { baseUrl: e.target.value })}
            placeholder="https://api.mein-system.de/v1"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none" />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-white/50">Typ</span>
              <select value={api.type} onChange={(e) => patch(i, { type: e.target.value as ApiIntegration['type'] })}
                className="w-full mt-1 rounded-lg border border-white/10 bg-[#0F0F18] px-3 py-2 text-sm text-white outline-none">
                <option value="rest">REST API</option>
                <option value="webhook">Webhook</option>
                <option value="zapier">Zapier / Make</option>
              </select>
            </div>
            <div>
              <span className="text-xs text-white/50">Authentifizierung</span>
              <select value={api.authType} onChange={(e) => patch(i, { authType: e.target.value as ApiIntegration['authType'] })}
                className="w-full mt-1 rounded-lg border border-white/10 bg-[#0F0F18] px-3 py-2 text-sm text-white outline-none">
                <option value="none">Keine</option>
                <option value="apikey">API Key</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
              </select>
            </div>
          </div>

          {api.authType !== 'none' && (
            <input value={api.authValue ?? ''} onChange={(e) => patch(i, { authValue: e.target.value })}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={api.authType === 'apikey' ? 'API Key' : api.authType === 'bearer' ? 'Bearer Token' : 'user:password'}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none" />
          )}

          <textarea value={api.description} onChange={(e) => patch(i, { description: e.target.value })}
            placeholder="Wofür soll der Agent diese API nutzen? z.B. 'Kundendaten abrufen und Bestellstatus prüfen'"
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none resize-y" />
        </div>
      ))}

      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + API-Integration hinzufügen
      </button>

      <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
        Dein Agent kann während des Gesprächs Daten abrufen und senden — z.B. Kundenstatus prüfen, Bestellungen anlegen oder CRM-Einträge erstellen.
      </div>
    </div>
  );
}

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
