import React from 'react';
import type { AgentConfig } from '../../lib/api.js';
import {
  SectionCard, Field, Select, Toggle, Slider,
  IconMic, IconSliders,
} from './shared.js';
import {
  TECHNICAL_MODE_PRESETS,
  deriveTechnicalRuntimeSettings,
  formatCallDuration,
  type InterruptionMode,
} from '../../../../../packages/shared/src/technical.js';

export interface TechnicalTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function TechnicalTab({ config, onUpdate }: TechnicalTabProps) {
  const runtime = deriveTechnicalRuntimeSettings(config);
  const preset = TECHNICAL_MODE_PRESETS[runtime.interruptionMode];
  function applyMode(mode: InterruptionMode) {
    const next = TECHNICAL_MODE_PRESETS[mode];
    onUpdate({
      interruptionMode: mode,
      responsiveness: next.responsiveness,
      interruptionSensitivity: next.interruptionSensitivity,
      enableBackchannel: next.enableBackchannel,
    });
  }

  return (
    <>
      <div className="mb-5 rounded-2xl border border-cyan-500/15 bg-cyan-500/8 px-4 py-3 text-sm text-cyan-100/85">
        Diese Werte greifen beim naechsten Deploy wirklich in Retell. Die Vorschau unten zeigt dir die aktive Laufzeit-Konfiguration.
      </div>

      <SectionCard title="Stimme & Modell" icon={IconMic}>
        <div className="space-y-5">
          <Slider
            value={runtime.voiceSpeed}
            onChange={(v) => onUpdate({ speakingSpeed: v })}
            min={0.5}
            max={2.0}
            step={0.1}
            label="Sprechgeschwindigkeit"
            displayValue={`${runtime.voiceSpeed.toFixed(1)}x`}
          />

          <Slider
            value={runtime.modelTemperature}
            onChange={(v) => onUpdate({ temperature: v })}
            min={0}
            max={1}
            step={0.05}
            label="Kreativitaet"
            displayValue={runtime.modelTemperature.toFixed(2)}
          />

          <Slider
            value={runtime.maxCallDurationSeconds}
            onChange={(v) => onUpdate({ maxCallDuration: v })}
            min={60}
            max={7200}
            step={60}
            label="Max. Anrufdauer"
            displayValue={formatCallDuration(runtime.maxCallDurationSeconds)}
          />

          <div className="rounded-xl bg-white/5 px-4 py-3 text-xs leading-relaxed text-white/50">
            <strong className="text-white/65">Kreativitaet niedrig</strong> wirkt konsistenter und faktischer.
            {' '}
            <strong className="text-white/65">Hoeher</strong> klingt spontaner, kann aber freier formulieren.
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Gespraechsfluss" icon={IconSliders}>
        <div className="space-y-5">
          <Field label="Unterbrechungs-Profil">
            <Select
              value={runtime.interruptionMode}
              onChange={(e) => applyMode(e.target.value as InterruptionMode)}
            >
              <option value="allow">Natuerlich - leicht unterbrechbar</option>
              <option value="hold">Kurz halten - etwas kontrollierter</option>
              <option value="block">Ohne Unterbrechung - am ruhigsten</option>
            </Select>
          </Field>

          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
            <div className="text-sm font-medium text-white/80">{preset.label}</div>
            <p className="mt-1 text-xs leading-relaxed text-white/45">{preset.description}</p>
          </div>

          <Slider
            value={runtime.responsiveness}
            onChange={(v) => onUpdate({ responsiveness: v })}
            min={0}
            max={1}
            step={0.05}
            label="Reaktionsgeschwindigkeit"
            displayValue={runtime.responsiveness.toFixed(2)}
          />

          <Slider
            value={runtime.interruptionSensitivity}
            onChange={(v) => onUpdate({ interruptionSensitivity: v })}
            min={0}
            max={1}
            step={0.05}
            label="Unterbrechbarkeit"
            displayValue={runtime.interruptionSensitivity.toFixed(2)}
          />

          <Toggle
            checked={runtime.enableBackchannel}
            onChange={(v) => onUpdate({ enableBackchannel: v })}
            label="Kurze Hoersignale erlauben"
          />
          <div className="rounded-xl bg-white/5 px-4 py-3 text-xs leading-relaxed text-white/50 ml-14">
            Kleine Einwuerfe wie "mhm" oder "okay" lassen den Agenten natuerlicher wirken, koennen aber in sehr formellen Setups stoeren.
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Tasteneingabe" icon={IconSliders}>
        <div className="space-y-4">
          <Toggle
            checked={runtime.allowUserDtmf}
            onChange={(v) => onUpdate({ enableDtmf: v })}
            label="DTMF-Eingabe erlauben"
          />
          <div className="rounded-xl bg-white/5 px-4 py-3 text-xs leading-relaxed text-white/50 ml-14">
            Anrufer koennen dann ueber die Telefontastatur Eingaben machen, etwa fuer Menues oder Verifizierungsschritte.
          </div>
        </div>
      </SectionCard>
    </>
  );
}
