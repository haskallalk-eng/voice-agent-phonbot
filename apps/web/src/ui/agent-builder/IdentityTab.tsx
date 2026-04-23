import React from 'react';
import type { AgentConfig, Voice } from '../../lib/api.js';
import { SectionCard, Field, Input, Select, Badge, LANGUAGES, LANGUAGE_VOICE_RECOMMENDATIONS, IconAgent, IconBuilding } from './shared.js';
import { VoiceDropdown } from './VoiceDropdown.js';
import { VoiceClonePanel } from './VoiceClonePanel.js';
import { OpeningHoursEditor } from './OpeningHoursEditor.js';
import { ServicesEditor } from './ServicesEditor.js';
import { AdaptiveTextarea } from '../../components/AdaptiveTextarea.js';

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
  // curated catalog (e.g. a legacy "11labs-Carola" after we tightened the
  // native-only lineup), fall back to the catalog's default voice so the
  // picker trigger doesn't display a raw supplier-prefixed ID.
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
        rightSlot={config.retellAgentId ? <Badge color="green">Deployed</Badge> : undefined}
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
              Die angezeigten Stimmen sprechen die Sprache multilingual — mit
              leicht hörbarem Akzent. Für natürlichen Klang empfehlen wir,
              unten unter <strong>Eigene Stimme klonen</strong> eine muttersprachliche
              Aufnahme hochzuladen (ca. 30 Sekunden reichen).
            </>
          ) : (
            <>
              Für diese Sprache haben wir nur <strong>wenige native Stimmen</strong>.
              Falls du einen bestimmten Charakter oder mehr Auswahl willst,
              lade unten unter <strong>Eigene Stimme klonen</strong> eine eigene
              Aufnahme hoch (ca. 30 Sekunden reichen).
            </>
          );
          return (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200/90">
              <span className="text-base leading-none">💡</span>
              <span>{message}</span>
            </div>
          );
        })()}
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
            <AdaptiveTextarea
              value={config.businessDescription}
              onChange={(e) => onUpdate({ businessDescription: e.target.value })}
              placeholder="Was macht euer Unternehmen?"
              minRows={2}
              className="w-full rounded-xl bg-white/5 border border-white/10 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 outline-none text-sm text-white/85 px-3 py-2"
            />
          </Field>
          {/* Plain div wrapper instead of <Field>: OpeningHoursEditor contains
              buttons + nested focusables, and <Field> renders a <label> that
              would nest another label inside — invalid HTML and browser-
              dependent layout glitches. Labelling stays via the "Öffnungszeiten"
              heading. */}
          <div className="block">
            <span className="text-sm font-medium text-white/70">Öffnungszeiten</span>
            <div className="mt-1">
              <OpeningHoursEditor
                value={config.openingHours}
                onChange={(v) => onUpdate({ openingHours: v })}
              />
            </div>
          </div>
          <div className="block">
            <span className="text-sm font-medium text-white/70">Services / Angebote</span>
            <p className="text-[11px] text-white/40 mt-0.5 mb-2">Name, Preis und Dauer direkt erfassen — Chipy kann so sauber Preise nennen und Termine vorschlagen. Klick den Pfeil für Beschreibung, Preisspanne oder Tag.</p>
            <ServicesEditor
              value={config.services ?? []}
              legacyText={config.servicesText ?? ''}
              onChange={(next) => onUpdate({ services: next })}
              onConsumeLegacy={() => onUpdate({ servicesText: '' })}
            />
          </div>
        </div>
      </SectionCard>
    </>
  );
}
