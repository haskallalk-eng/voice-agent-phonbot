import React, { useState } from 'react';
import type { AgentConfig, ExtractedVariable, InboundWebhook, ApiIntegration, ApiEndpoint } from '../../lib/api.js';
import { SectionCard, Input, Toggle, IconFileText, IconWebhook, IconPlug } from './shared.js';

/** Server returns authValue as "__phonbot_auth_masked__:••••xyz9" so we never
 *  show the real secret in the browser. The UI displays the hint part; when
 *  the user re-saves without touching the field, the full sentinel round-trips
 *  and the server keeps the existing encrypted value. */
const AUTH_MASK_PREFIX = '__phonbot_auth_masked__';
function isMaskedAuth(v: string | undefined | null): boolean {
  return typeof v === 'string' && v.startsWith(AUTH_MASK_PREFIX);
}
function maskedHint(v: string | undefined | null): string {
  if (!isMaskedAuth(v)) return '';
  const hint = (v as string).slice(AUTH_MASK_PREFIX.length + 1);
  return hint || '••••';
}

export interface WebhooksTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function WebhooksTab({ config, onUpdate }: WebhooksTabProps) {
  return (
    <>
      <SectionCard title="Variablen extrahieren" icon={IconFileText}>
        <p className="text-sm text-white/50 mb-2">
          Definiere welche Informationen der Agent automatisch aus Gesprächen extrahieren soll.
        </p>
        <p className="text-xs text-white/40 mb-4">
          Nach jedem Anruf analysiert Chipy das Transkript und füllt diese Felder automatisch aus. Die extrahierten Werte landen als Metadaten am jeweiligen Ticket und werden im Webhook-Payload von <code className="bg-white/10 px-1.5 py-0.5 rounded">call.ended</code> und <code className="bg-white/10 px-1.5 py-0.5 rounded">ticket.created</code> mitgeliefert. Zusätzlich füllt Chipy immer ein Feld <code className="bg-white/10 px-1.5 py-0.5 rounded">sonstige_relevante_infos</code> mit allem, was erwähnenswert war — auch wenn du es nicht als eigene Variable definiert hast.
        </p>
        <VariableEditor
          items={config.extractedVariables ?? []}
          onChange={(items) => onUpdate({ extractedVariables: items })}
        />
      </SectionCard>

      <SectionCard title="Inbound Webhooks" icon={IconWebhook}>
        <p className="text-sm text-white/50 mb-4">
          Sende extrahierte Daten und Events automatisch an deine Systeme.
        </p>
        <WebhookEditor
          items={config.inboundWebhooks ?? []}
          onChange={(items) => onUpdate({ inboundWebhooks: items })}
        />
      </SectionCard>

      <SectionCard title="API-Integrationen" icon={IconPlug}>
        <p className="text-sm text-white/50 mb-4">
          Verbinde externe Systeme (CRM, ERP, Buchungssysteme) — dein Agent kann während des Gesprächs darauf zugreifen.
        </p>
        <ApiIntegrationEditor
          items={config.apiIntegrations ?? []}
          onChange={(items) => onUpdate({ apiIntegrations: items })}
        />
      </SectionCard>
    </>
  );
}

/* ── API Integration Editor (moved from CapabilitiesTab 2026-04-23) ── */

function ApiIntegrationEditor({ items, onChange }: { items: ApiIntegration[]; onChange: (v: ApiIntegration[]) => void }) {
  function add() {
    onChange([...items, {
      id: crypto.randomUUID(),
      name: '',
      type: 'webhook',
      baseUrl: '',
      authType: 'none',
      description: '',
      enabled: true,
      endpoints: [],
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
            placeholder={api.type === 'zapier' ? 'https://hooks.zapier.com/hooks/catch/…' : 'https://api.mein-system.de/v1'}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none" />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-white/50">Typ</span>
              <select value={api.type} onChange={(e) => patch(i, { type: e.target.value as ApiIntegration['type'] })}
                className="w-full mt-1 rounded-lg border border-white/10 bg-[#0F0F18] px-3 py-2 text-sm text-white outline-none">
                <option value="webhook">Webhook (einfach)</option>
                <option value="zapier">Zapier / Make</option>
                <option value="rest">REST API (mit Endpunkten)</option>
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
            <div>
              <input
                value={isMaskedAuth(api.authValue) ? '' : (api.authValue ?? '')}
                onChange={(e) => patch(i, { authValue: e.target.value })}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  isMaskedAuth(api.authValue)
                    ? `Gespeichert: ${maskedHint(api.authValue)} — leer lassen zum Behalten`
                    : (api.authType === 'apikey' ? 'API Key' : api.authType === 'bearer' ? 'Bearer Token' : 'user:password')
                }
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
                onFocus={(e) => {
                  // When the user focuses and the field is showing a mask sentinel,
                  // we keep the sentinel so an empty submit preserves the stored key;
                  // only overwrite when the user actually types.
                  if (isMaskedAuth(api.authValue)) e.currentTarget.value = '';
                }}
                onBlur={(e) => {
                  // If the user didn't type anything, restore the sentinel so it
                  // round-trips to the server.
                  if (e.currentTarget.value === '' && isMaskedAuth(api.authValue)) {
                    // no-op: state already has sentinel
                  }
                }}
              />
              <p className="text-[11px] text-white/35 mt-1">
                Schlüssel werden AES-256-verschlüsselt gespeichert und nur server-seitig entschlüsselt — Retell sieht sie nie.
              </p>
            </div>
          )}

          <textarea value={api.description} onChange={(e) => patch(i, { description: e.target.value })}
            placeholder={
              api.type === 'rest'
                ? "Was soll der Agent mit diesem System machen? z.B. 'Kundendaten und Bestellstatus abrufen'"
                : "Wann soll der Agent diese Integration nutzen? z.B. 'Am Ende jedes Anrufs alle Gesprächsdaten senden'"
            }
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none resize-y" />

          {api.type === 'rest' && (
            <EndpointsEditor
              endpoints={api.endpoints ?? []}
              onChange={(endpoints) => patch(i, { endpoints })}
            />
          )}
        </div>
      ))}

      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + Integration hinzufügen
      </button>

      <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50 space-y-1.5">
        <p><strong className="text-white/70">Webhook / Zapier</strong> — einfachster Fall: der Agent ruft die URL mit einem JSON-Payload auf, wenn das Gespräch es erfordert. Perfekt für „schick die Daten an mein CRM/Zapier/n8n".</p>
        <p><strong className="text-white/70">REST API</strong> — für Fachkunden: du deklarierst genau die Endpunkte die der Agent aufrufen darf (z.B. <code className="bg-white/10 px-1 rounded">GET /customers/&#123;id&#125;</code>). Der Agent kann <em>nur</em> diese Endpunkte live nutzen — kein Raten, kein Halluzinieren.</p>
      </div>
    </div>
  );
}

/* ── REST Endpoints sub-editor ── */

function EndpointsEditor({ endpoints, onChange }: { endpoints: ApiEndpoint[]; onChange: (v: ApiEndpoint[]) => void }) {
  function add() {
    onChange([...endpoints, {
      id: crypto.randomUUID(),
      name: '',
      method: 'GET',
      path: '',
      description: '',
      params: [],
    }]);
  }

  function patch(i: number, p: Partial<ApiEndpoint>) {
    const next = [...endpoints];
    next[i] = { ...next[i], ...p } as ApiEndpoint;
    onChange(next);
  }

  function remove(i: number) {
    onChange(endpoints.filter((_, j) => j !== i));
  }

  return (
    <div className="border-l-2 border-orange-500/20 pl-3 space-y-2">
      <p className="text-xs font-semibold text-white/60">Endpunkte</p>
      {endpoints.map((ep, i) => (
        <div key={ep.id} className="bg-white/[0.03] rounded-lg px-3 py-2.5 space-y-2">
          <div className="grid grid-cols-[6rem_1fr_auto] gap-2 items-center">
            <select value={ep.method} onChange={(e) => patch(i, { method: e.target.value as ApiEndpoint['method'] })}
              className="rounded-md border border-white/10 bg-[#0F0F18] px-2 py-1.5 text-xs text-white font-mono outline-none">
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
            </select>
            <input value={ep.path} onChange={(e) => patch(i, { path: e.target.value })}
              placeholder="/customers/{id}"
              className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white font-mono placeholder:text-white/25 focus:border-orange-500/50 outline-none" />
            <button onClick={() => remove(i)} className="text-white/25 hover:text-red-400 transition-colors cursor-pointer"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <input value={ep.name} onChange={(e) => patch(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() })}
            placeholder="Tool-Name (nur a–z, 0–9, _) — z.B. kunde_suchen"
            className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white font-mono placeholder:text-white/25 focus:border-orange-500/50 outline-none" />
          <input value={ep.description} onChange={(e) => patch(i, { description: e.target.value })}
            placeholder="Wann nutzt der Agent diesen Endpunkt? z.B. 'Kundendaten abrufen wenn Anrufer Kundennummer nennt'"
            className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white placeholder:text-white/25 focus:border-orange-500/50 outline-none" />

          <ParamsEditor
            params={ep.params ?? []}
            onChange={(params) => patch(i, { params })}
            pathPlaceholders={Array.from(ep.path.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map((m) => m[1] ?? '')}
          />
        </div>
      ))}
      <button onClick={add}
        className="w-full border border-dashed border-white/10 hover:border-orange-500/30 rounded-md py-1.5 text-xs text-white/35 hover:text-orange-400 transition-all">
        + Endpunkt hinzufügen
      </button>
    </div>
  );
}

function ParamsEditor({ params, onChange, pathPlaceholders }: {
  params: NonNullable<ApiEndpoint['params']>;
  onChange: (v: NonNullable<ApiEndpoint['params']>) => void;
  pathPlaceholders: string[];
}) {
  function add() {
    // Pre-fill with path placeholder if there's an unreferenced one
    const existingNames = new Set(params.map((p) => p.name));
    const suggestion = pathPlaceholders.find((p) => p && !existingNames.has(p)) ?? '';
    onChange([...params, { name: suggestion, type: 'string', description: '', required: !!suggestion }]);
  }
  function patch(i: number, p: Partial<NonNullable<ApiEndpoint['params']>[number]>) {
    const next = [...params];
    next[i] = { ...next[i], ...p } as NonNullable<ApiEndpoint['params']>[number];
    onChange(next);
  }
  function remove(i: number) {
    onChange(params.filter((_, j) => j !== i));
  }
  if (params.length === 0) {
    return (
      <button onClick={add}
        className="text-[11px] text-white/40 hover:text-orange-400 transition-colors underline decoration-dotted">
        + Parameter für diesen Endpunkt
      </button>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-white/40">Parameter</p>
      {params.map((p, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_6rem_auto_auto] gap-1.5 items-center">
          <input value={p.name} onChange={(e) => patch(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') })}
            placeholder="name"
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white font-mono placeholder:text-white/25 focus:border-orange-500/50 outline-none" />
          <input value={p.description} onChange={(e) => patch(i, { description: e.target.value })}
            placeholder="Beschreibung für den Agent"
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white placeholder:text-white/25 focus:border-orange-500/50 outline-none" />
          <select value={p.type} onChange={(e) => patch(i, { type: e.target.value as 'string' | 'number' | 'boolean' })}
            className="rounded border border-white/10 bg-[#0F0F18] px-1.5 py-1 text-[11px] text-white outline-none">
            <option value="string">Text</option>
            <option value="number">Zahl</option>
            <option value="boolean">Ja/Nein</option>
          </select>
          <label className="flex items-center gap-1 text-[11px] text-white/50 cursor-pointer">
            <input type="checkbox" checked={!!p.required} onChange={(e) => patch(i, { required: e.target.checked })}
              className="rounded border-white/20 bg-white/5 h-3 w-3" />
            Pflicht
          </label>
          <button onClick={() => remove(i)} className="text-white/25 hover:text-red-400 transition-colors cursor-pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      ))}
      <button onClick={add}
        className="text-[11px] text-white/40 hover:text-orange-400 transition-colors underline decoration-dotted mt-1">
        + Parameter hinzufügen
      </button>
    </div>
  );
}

/* ── Variable Editor ── */

function VariableEditor({ items, onChange }: { items: ExtractedVariable[]; onChange: (v: ExtractedVariable[]) => void }) {
  function add() {
    onChange([...items, { name: '', description: '', type: 'string', required: false }]);
  }

  function patch(i: number, p: Partial<ExtractedVariable>) {
    const next = [...items];
    next[i] = { ...next[i], ...p } as ExtractedVariable;
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  return (
    <div className="space-y-3">
      {items.map((v, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-center bg-white/5 rounded-xl px-4 py-3">
          <Input value={v.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Name (z.B. kundenname)" />
          <Input value={v.description} onChange={(e) => patch(i, { description: e.target.value })} placeholder="Beschreibung" />
          <select value={v.type} onChange={(e) => patch(i, { type: e.target.value as ExtractedVariable['type'] })}
            className="rounded-lg border border-white/10 bg-[#0F0F18] px-2 py-2 text-sm text-white text-center">
            <option value="string">Text</option>
            <option value="number">Zahl</option>
            <option value="boolean">Ja/Nein</option>
            <option value="date">Datum</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-white/50 cursor-pointer">
            <input type="checkbox" checked={v.required} onChange={(e) => patch(i, { required: e.target.checked })}
              className="rounded border-white/20 bg-white/5" />
            Pflicht
          </label>
          <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      ))}
      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + Variable hinzufügen
      </button>
    </div>
  );
}

/* ── Webhook Editor ── */

function WebhookEditor({ items, onChange }: { items: InboundWebhook[]; onChange: (v: InboundWebhook[]) => void }) {
  function add() {
    onChange([...items, {
      id: crypto.randomUUID(),
      name: '',
      url: '',
      events: ['call.ended'],
      enabled: true,
    }]);
  }

  function patch(i: number, p: Partial<InboundWebhook>) {
    const next = [...items];
    next[i] = { ...next[i], ...p } as InboundWebhook;
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  const EVENT_OPTIONS = ['call.started', 'call.ended', 'ticket.created', 'variable.extracted'];

  return (
    <div className="space-y-3">
      {items.map((wh, i) => (
        <div key={wh.id} className="bg-white/5 rounded-xl px-4 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <Toggle checked={wh.enabled} onChange={(v) => patch(i, { enabled: v })} label="" />
            <Input value={wh.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Name (z.B. CRM Webhook)" className="flex-1" />
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <Input value={wh.url} onChange={(e) => patch(i, { url: e.target.value })} placeholder="https://mein-crm.de/api/webhook" />
          <div>
            <span className="text-xs text-white/50">Events:</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {EVENT_OPTIONS.map((evt) => (
                <label key={evt} className="flex items-center gap-1.5 text-xs cursor-pointer text-white/60">
                  <input type="checkbox" checked={wh.events.includes(evt)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...wh.events, evt] : wh.events.filter((x) => x !== evt);
                      patch(i, { events: next });
                    }}
                    className="rounded border-white/20 bg-white/5 text-orange-500" />
                  <code className="bg-white/10 px-1.5 py-0.5 rounded">{evt}</code>
                </label>
              ))}
            </div>
          </div>
        </div>
      ))}
      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + Webhook hinzufügen
      </button>
    </div>
  );
}
