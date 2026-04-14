import React from 'react';
import type { AgentConfig, Voice } from '../../lib/api.js';
import { SectionCard, Field, Input, TextArea, Select, Badge, LANGUAGES, LANGUAGE_VOICE_RECOMMENDATIONS, IconAgent, IconBuilding } from './shared.js';
import { VoiceDropdown } from './VoiceDropdown.js';
import { VoiceClonePanel } from './VoiceClonePanel.js';

export interface IdentityTabProps {
  config: AgentConfig;
  voices: Voice[];
  voicesLoading: boolean;
  voiceDropdownOpen: boolean;
  voiceDropdownRef: React.RefObject<HTMLDivElement | null>;
  onUpdate: (patch: Partial<AgentConfig>) => void;
  onVoiceDropdownToggle: () => void;
  onVoiceSelect: (id: string) => void;
  onVoiceCloned: (voice: Voice) => void;
}

export function IdentityTab({
  config,
  voices,
  voicesLoading,
  voiceDropdownOpen,
  voiceDropdownRef,
  onUpdate,
  onVoiceDropdownToggle,
  onVoiceSelect,
  onVoiceCloned,
}: IdentityTabProps) {
  return (
    <>
      <SectionCard title="Identität" icon={IconAgent} className={voiceDropdownOpen ? 'relative z-10 overflow-visible' : ''}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Agent-Name">
            <Input value={config.name} onChange={(e) => onUpdate({ name: e.target.value })} placeholder="z.B. Lisa" />
          </Field>
          <Field label="Sprache">
            <Select value={config.language} onChange={(e) => {
              const newLang = e.target.value as AgentConfig['language'];
              const rec = LANGUAGE_VOICE_RECOMMENDATIONS[newLang];
              onUpdate(rec ? { language: newLang, voice: rec.voiceId } : { language: newLang });
            }}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </Select>
          </Field>
          <Field label="Stimme">
            <VoiceDropdown
              voices={voices}
              loading={voicesLoading}
              currentVoiceId={config.voice}
              dropdownOpen={voiceDropdownOpen}
              dropdownRef={voiceDropdownRef}
              onOpenToggle={onVoiceDropdownToggle}
              onSelect={onVoiceSelect}
            />
          </Field>
        </div>
        {LANGUAGE_VOICE_RECOMMENDATIONS[config.language]?.native === false && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200/90">
            <span className="text-base leading-none">💡</span>
            <span>
              Für diese Sprache gibt es keine speziell optimierte native Stimme.
              Für beste Qualität empfehlen wir, unten im Bereich <strong>Eigene Stimme klonen</strong> eine
              muttersprachliche Aufnahme hochzuladen (ca. 30 Sekunden reichen).
            </span>
          </div>
        )}
        {config.retellAgentId && (
          <div className="mt-3 flex items-center gap-3 text-xs text-white/50">
            <Badge color="green">Deployed</Badge>
            <span>Agent: <code className="font-mono">{config.retellAgentId}</code></span>
          </div>
        )}
      </SectionCard>

      {/* Voice cloning panel */}
      <VoiceClonePanel onVoiceCloned={onVoiceCloned} />

      <SectionCard title="Business-Informationen" icon={IconBuilding}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Firmenname">
            <Input value={config.businessName} onChange={(e) => onUpdate({ businessName: e.target.value })} placeholder="Friseur Müller" />
          </Field>
          <Field label="Adresse">
            <Input value={config.address} onChange={(e) => onUpdate({ address: e.target.value })} placeholder="Hauptstr. 12, 10115 Berlin" />
          </Field>
        </div>
        <div className="mt-4 space-y-4">
          <Field label="Beschreibung">
            <TextArea rows={2} value={config.businessDescription} onChange={(e) => onUpdate({ businessDescription: e.target.value })} placeholder="Was macht euer Unternehmen?" />
          </Field>
          <Field label="Öffnungszeiten">
            <TextArea rows={2} value={config.openingHours} onChange={(e) => onUpdate({ openingHours: e.target.value })} placeholder="Mo–Fr 9–18 Uhr, Sa 10–14 Uhr" />
          </Field>
          <Field label="Services / Angebote">
            <TextArea rows={2} value={config.servicesText} onChange={(e) => onUpdate({ servicesText: e.target.value })} placeholder="Haarschnitt, Färben, Beratung…" />
          </Field>
        </div>
      </SectionCard>
    </>
  );
}
