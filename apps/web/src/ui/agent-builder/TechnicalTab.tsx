import React from 'react';
import type { AgentConfig } from '../../lib/api.js';
import {
  SectionCard, Field, Select, Toggle, Slider,
  IconMic, IconSliders,
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
            label="Kreativität (Temperature)" displayValue={(config.temperature ?? 0.7).toFixed(2)} />

          <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
            <strong>Niedrig</strong> = konsistenter & faktisch \· <strong>Hoch</strong> = kreativer & spontaner
          </div>

          <Slider value={config.maxCallDuration ?? 300} onChange={(v) => onUpdate({ maxCallDuration: v })}
            min={30} max={1800} step={30}
            label="Max. Anrufdauer" displayValue={`${Math.floor((config.maxCallDuration ?? 300) / 60)}:${String((config.maxCallDuration ?? 300) % 60).padStart(2, '0')} Min`} />
        </div>
      </SectionCard>

      <SectionCard title="Gesprächssteuerung" icon={IconSliders}>
        <div className="space-y-4">
          <Field label="Unterbrechungen">
            <Select value={config.interruptionMode ?? 'allow'}
              onChange={(e) => onUpdate({ interruptionMode: e.target.value as AgentConfig['interruptionMode'] })}>
              <option value="allow">Erlauben — Natürliches Gespräch</option>
              <option value="hold">Kurz halten — Agent beendet Satz</option>
              <option value="block">Blockieren — Agent spricht ohne Pause</option>
            </Select>
          </Field>

          <Toggle checked={config.enableDtmf ?? false}
            onChange={(v) => onUpdate({ enableDtmf: v })}
            label="DTMF-Eingabe (Tastentöne)" />
          {config.enableDtmf && (
            <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50 ml-14">
              Anrufer können über die Telefontasten navigieren (z.B. „Drücken Sie 1 für Termine\“).
            </div>
          )}
        </div>
      </SectionCard>

    </>
  );
}
