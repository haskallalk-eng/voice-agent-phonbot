import React, { useState } from 'react';
import type { AgentConfig, ExtractedVariable, InboundWebhook, ApiIntegration } from '../../lib/api.js';
import { SectionCard, Input, Toggle, IconFileText, IconWebhook, IconPlug } from './shared.js';

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
