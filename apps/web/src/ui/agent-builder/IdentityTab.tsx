import React from 'react';
import type { AgentConfig, Voice } from '../../lib/api.js';
import { SectionCard, Field, Input, Select, Badge, LANGUAGES, LANGUAGE_VOICE_RECOMMENDATIONS, IconAgent } from './shared.js';
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
  // If the persisted voice-id no longer exists in the current language's
  // curated catalog, fall back to the catalog's default voice so the picker
  // trigger never shows a raw supplier-prefixed ID.
  React.useEffect(() => {
    if (voicesLoading || voices.length === 0 || !config.voice) return;
    const exists = voices.some((v) => v.voice_id === config.voice);
    if (!exists && voices[0]) {
      onUpdate({ voice: voices[0].voice_id });
    }
  }, [voices, voicesLoading, config.voice, onUpdate]);

  return (
    <>
      <SectionCard
        title="Identität"
        icon={IconAgent}
        className={voiceDropdownOpen ? 'relative z-10 overflow-visible' : ''}
        rightSlot={config.retellAgentId ? <Badge color="green">Aktiv</Badge> : undefined}
      >
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
        {(() => {
          const status = LANGUAGE_VOICE_RECOMMENDATIONS[config.language]?.nativeStatus ?? 'many';
          if (status === 'many') return null;
          const message = status === 'none' ? (
            <>
              Für diese Sprache gibt es <strong>keine muttersprachlich aufgenommene Stimme</strong>.
              Die angezeigten Stimmen sprechen die Sprache multilingual, mit leicht hörbarem Akzent.
              Für natürlichen Klang empfehlen wir, unten unter <strong>Eigene Stimme klonen</strong>
              eine muttersprachliche Aufnahme hochzuladen.
            </>
          ) : (
            <>
              Für diese Sprache haben wir nur <strong>wenige native Stimmen</strong>.
              Falls du einen bestimmten Charakter oder mehr Auswahl willst, lade unten unter
              <strong> Eigene Stimme klonen</strong> eine eigene Aufnahme hoch.
            </>
          );
          return (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200/90">
              <span className="text-base leading-none">!</span>
              <span>{message}</span>
            </div>
          );
        })()}
      </SectionCard>

      <VoiceClonePanel onVoiceCloned={onVoiceCloned} />
    </>
  );
}
