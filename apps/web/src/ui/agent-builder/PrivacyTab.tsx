import React from 'react';
import type { AgentConfig } from '../../lib/api.js';
import { SectionCard, Field, Select, Toggle, IconPrivacy } from './shared.js';

export interface PrivacyTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function PrivacyTab({ config, onUpdate }: PrivacyTabProps) {
  return (
    <SectionCard title="Aufzeichnung & Datenschutz" icon={IconPrivacy}>
      <div className="space-y-6">
        <Toggle checked={config.recordCalls ?? false}
          onChange={(v) => onUpdate({ recordCalls: v })}
          label="Anrufe aufzeichnen" />
        {config.recordCalls && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-sm text-yellow-300 ml-14">
            Stelle sicher, dass Anrufer zu Beginn \u00fcber die Aufzeichnung informiert werden (DSGVO).
          </div>
        )}

        <Field label="Gespr\u00e4chsdaten aufbewahren">
          <Select value={String(config.dataRetentionDays ?? 30)}
            onChange={(e) => onUpdate({ dataRetentionDays: parseInt(e.target.value) })}>
            <option value="0">Nicht speichern (sofort l\u00f6schen)</option>
            <option value="7">7 Tage</option>
            <option value="30">30 Tage</option>
            <option value="90">90 Tage</option>
            <option value="365">1 Jahr</option>
          </Select>
        </Field>

        <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
          Alle Daten werden verschl\u00fcsselt gespeichert und nach Ablauf automatisch gel\u00f6scht. DSGVO-konform.
        </div>
      </div>
    </SectionCard>
  );
}
