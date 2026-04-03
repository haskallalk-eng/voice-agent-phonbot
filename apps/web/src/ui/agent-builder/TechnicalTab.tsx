import React, { useState } from 'react';
import type { AgentConfig } from '../../lib/api.js';
import {
  SectionCard, Field, Input, Select, Toggle, Slider,
  IconMic, IconVolume, IconSliders, IconBookOpen,
  IconPhoneOff, IconBuilding, IconAgent, IconGlobe,
} from './shared.js';

export interface TechnicalTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function TechnicalTab({ config, onUpdate }: TechnicalTabProps) {
  return (
    <>
      <SectionCard title="Stimme & Geschwindigkeit" icon={IconMic}>
        <div className="space-y-5">
          <Slider value={config.speakingSpeed ?? 1.0} onChange={(v) => onUpdate({ speakingSpeed: v })}
            min={0.5} max={2.0} step={0.1}
            label="Sprechgeschwindigkeit" displayValue={`${(config.speakingSpeed ?? 1.0).toFixed(1)}x`} />

          <Slider value={config.temperature ?? 0.7} onChange={(v) => onUpdate({ temperature: v })}
            min={0} max={1} step={0.05}
            label="Kreativit\ät (Temperature)" displayValue={(config.temperature ?? 0.7).toFixed(2)} />

          <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
            <strong>Niedrig</strong> = konsistenter & faktisch \· <strong>Hoch</strong> = kreativer & spontaner
          </div>

          <Slider value={config.maxCallDuration ?? 300} onChange={(v) => onUpdate({ maxCallDuration: v })}
            min={30} max={1800} step={30}
            label="Max. Anrufdauer" displayValue={`${Math.floor((config.maxCallDuration ?? 300) / 60)}:${String((config.maxCallDuration ?? 300) % 60).padStart(2, '0')} Min`} />
        </div>
      </SectionCard>

      <SectionCard title="Hintergrundger\äusche" icon={IconVolume}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {([
            { id: 'off',    Icon: IconPhoneOff,  label: 'Keine' },
            { id: 'office', Icon: IconBuilding,  label: 'B\üro' },
            { id: 'cafe',   Icon: IconAgent,     label: 'Caf\é' },
            { id: 'nature', Icon: IconGlobe,     label: 'Natur' },
          ] as const).map((bg) => (
            <button key={bg.id} onClick={() => onUpdate({ backgroundSound: bg.id })}
              className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border transition-all cursor-pointer ${
                config.backgroundSound === bg.id
                  ? 'border-orange-500/40 bg-orange-500/8 text-white'
                  : 'border-white/[0.07] bg-white/[0.03] text-white/40 hover:border-white/15 hover:text-white/70'
              }`}>
              <bg.Icon size={18} className={config.backgroundSound === bg.id ? 'text-orange-400' : ''} />
              <span className="text-xs font-medium">{bg.label}</span>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Gespr\ächssteuerung" icon={IconSliders}>
        <div className="space-y-4">
          <Field label="Unterbrechungen">
            <Select value={config.interruptionMode ?? 'allow'}
              onChange={(e) => onUpdate({ interruptionMode: e.target.value as AgentConfig['interruptionMode'] })}>
              <option value="allow">Erlauben — Nat\ürliches Gespr\äch</option>
              <option value="hold">Kurz halten — Agent beendet Satz</option>
              <option value="block">Blockieren — Agent spricht ohne Pause</option>
            </Select>
          </Field>

          <Toggle checked={config.enableDtmf ?? false}
            onChange={(v) => onUpdate({ enableDtmf: v })}
            label="DTMF-Eingabe (Tastent\öne)" />
          {config.enableDtmf && (
            <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50 ml-14">
              Anrufer k\önnen \über die Telefontasten navigieren (z.B. \„Dr\ücken Sie 1 f\ür Termine\“).
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Fachbegriffe" icon={IconBookOpen}>
        <p className="text-sm text-white/50 mb-3">
          Begriffe die die KI korrekt aussprechen und verstehen soll (Produktnamen, Fachausdr\ücke, Fremdw\örter).
        </p>
        <VocabularyEditor
          items={config.customVocabulary ?? []}
          onChange={(items) => onUpdate({ customVocabulary: items })}
        />
      </SectionCard>
    </>
  );
}

/* ── Vocabulary Editor ── */

function VocabularyEditor({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');

  function add() {
    const term = input.trim();
    if (!term || items.includes(term)) return;
    onChange([...items, term]);
    setInput('');
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.map((term, i) => (
          <span key={i} className="flex items-center gap-1.5 bg-white/10 text-white/80 text-sm px-3 py-1.5 rounded-full">
            {term}
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-white/30 hover:text-red-400 cursor-pointer transition-colors"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </span>
        ))}
        {items.length === 0 && <span className="text-sm text-white/30">Noch keine Begriffe hinzugef\ügt</span>}
      </div>
      <div className="flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="z.B. Balayage, Keratin, HVAC\…"
          className="flex-1" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <button onClick={add}
          className="rounded-lg bg-white/10 border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/15 transition-colors">
          + Hinzuf\ügen
        </button>
      </div>
    </div>
  );
}
