import React, { useState } from 'react';
import type { AgentConfig, ExtractedVariable, InboundWebhook } from '../../lib/api.js';
import { SectionCard, Input, Toggle, IconFileText, IconWebhook } from './shared.js';

export interface WebhooksTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function WebhooksTab({ config, onUpdate }: WebhooksTabProps) {
  return (
    <>
      <SectionCard title="Variablen extrahieren" icon={IconFileText}>
        <p className="text-sm text-white/50 mb-4">
          Definiere welche Informationen der Agent automatisch aus Gespr\u00e4chen extrahieren soll.
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
    </>
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
        + Variable hinzuf\u00fcgen
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
        + Webhook hinzuf\u00fcgen
      </button>
    </div>
  );
}
