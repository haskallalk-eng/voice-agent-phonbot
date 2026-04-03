import React, { useState } from 'react';
import type { AgentConfig, CallRoutingRule, ApiIntegration, LiveWebAccess } from '../../lib/api.js';
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
  return (
    <>
      {/* Call Routing Rules */}
      <SectionCard title="Rufweiterleitung & Gespr\ächslogik" icon={IconPhoneOut}>
        <p className="text-sm text-white/50 mb-4">
          Definiere Regeln in nat\ürlicher Sprache — der Agent erkennt die Situation und handelt automatisch.
        </p>
        <CallRoutingEditor
          items={config.callRoutingRules ?? []}
          onChange={(items) => onUpdate({ callRoutingRules: items })}
        />
      </SectionCard>

      {/* Calendar Integrations */}
      <SectionCard title="Kalender-Anbindung" icon={IconCalendar}>
        <p className="text-sm text-white/50 mb-4">
          Verbinde einen Kalender, damit dein Agent Termine pr\üfen und buchen kann.
        </p>
        <CalendarConnector
          integrations={config.calendarIntegrations ?? []}
          onChange={(items) => onUpdate({ calendarIntegrations: items })}
        />
      </SectionCard>

      {/* API Integrations */}
      <SectionCard title="API-Integrationen" icon={IconPlug}>
        <p className="text-sm text-white/50 mb-4">
          Verbinde externe Systeme (CRM, ERP, Buchungssysteme) — dein Agent kann w\ährend des Gespr\ächs darauf zugreifen.
        </p>
        <ApiIntegrationEditor
          items={config.apiIntegrations ?? []}
          onChange={(items) => onUpdate({ apiIntegrations: items })}
        />
      </SectionCard>

      {/* Live Web Access */}
      <SectionCard title="Live Website-Zugriff" icon={IconGlobe}>
        <p className="text-sm text-white/50 mb-4">
          Erlaube deinem Agent, w\ährend des Gespr\ächs aktuelle Infos von Webseiten abzurufen (z.B. Preise, Verf\ügbarkeit).
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
  'Wenn der Kunde nach einer Reklamation fragt \→ Weiterleiten an Reklamationsabteilung',
  'Wenn der Anrufer "Notfall" sagt \→ Sofort weiterleiten an +49 170 1234567',
  'Wenn der Kunde 3x nach einem Mitarbeiter fragt \→ Weiterleiten an Zentrale',
  'Wenn der Anrufer nichts sagt nach 10 Sekunden \→ H\öflich auflegen',
  'Wenn die Anfrage medizinisch dringend ist \→ Ticket erstellen mit Priorit\ät Hoch',
];

function CallRoutingEditor({ items, onChange }: { items: CallRoutingRule[]; onChange: (v: CallRoutingRule[]) => void }) {
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
                const parts = ex.split(' \→ ');
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
                placeholder="Beschreibe die Situation in nat\ürlicher Sprache\… z.B. 'Wenn der Kunde nach dem Gesch\äftsf\ührer fragt'"
                rows={2}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none resize-y"
              />
              <div className="flex gap-3 items-center">
                <span className="text-xs text-white/50 shrink-0">Dann \→</span>
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
                <input
                  value={rule.target ?? ''}
                  onChange={(e) => patch(i, { target: e.target.value })}
                  placeholder="Ziel: Telefonnummer oder Abteilung (z.B. +49 170 1234567 oder 'Vertrieb')"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none"
                />
              )}
            </div>
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer mt-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>
      ))}

      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + Neue Regel hinzuf\ügen
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
  const connected = integrations?.filter((c) => c.connected) ?? [];

  function connect(provider: typeof CALENDAR_PROVIDERS[number]['id']) {
    // In production this would open OAuth flow -- here we add a placeholder
    const existing = integrations ?? [];
    if (existing.find((c) => c.provider === provider)) return;
    onChange([...existing, {
      provider,
      connected: false,
      label: CALENDAR_PROVIDERS.find((p) => p.id === provider)?.name ?? provider,
    }]);
  }

  function disconnect(provider: string) {
    onChange((integrations ?? []).filter((c) => c.provider !== provider));
  }

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
              <button onClick={() => disconnect(cal.provider)} className="text-white/30 hover:text-red-400 text-sm">Trennen</button>
            </div>
          ))}
        </div>
      )}

      {/* Provider grid */}
      <div className="grid grid-cols-2 gap-3">
        {CALENDAR_PROVIDERS.map((prov) => {
          const isConnected = (integrations ?? []).find((c) => c.provider === prov.id);
          return (
            <button key={prov.id} onClick={() => !isConnected && connect(prov.id)}
              disabled={!!isConnected}
              className={`flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                isConnected
                  ? 'border-green-500/20 bg-green-500/5 opacity-60 cursor-default'
                  : 'border-white/10 bg-white/5 hover:border-orange-500/40 hover:bg-white/10 cursor-pointer'
              }`}>
              <prov.Icon size={18} className="text-white/50 shrink-0" />
              <div>
                <p className="text-sm font-medium text-white">{prov.name}</p>
                <p className="text-xs text-white/40">{isConnected ? 'Bereits verbunden' : prov.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
        Nach der Verbindung kann dein Agent freie Termine pr\üfen, Buchungen erstellen und Kalender-Konflikte erkennen.
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
              placeholder={api.authType === 'apikey' ? 'API Key' : api.authType === 'bearer' ? 'Bearer Token' : 'user:password'}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none" />
          )}

          <textarea value={api.description} onChange={(e) => patch(i, { description: e.target.value })}
            placeholder="Wof\ür soll der Agent diese API nutzen? z.B. 'Kundendaten abrufen und Bestellstatus pr\üfen'"
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none resize-y" />
        </div>
      ))}

      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + API-Integration hinzuf\ügen
      </button>

      <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
        Dein Agent kann w\ährend des Gespr\ächs Daten abrufen und senden — z.B. Kundenstatus pr\üfen, Bestellungen anlegen oder CRM-Eintr\äge erstellen.
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
                + Hinzuf\ügen
              </button>
            </div>
          </div>

          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3 text-xs text-orange-300">
            Der Agent kann aktuelle Preise, Produktinfos oder Verf\ügbarkeiten direkt von deiner Website lesen — in Echtzeit w\ährend des Gespr\ächs.
          </div>
        </>
      )}
    </div>
  );
}
