/**
 * Curated voice catalog — only language-optimized voices.
 *
 * Each language gets a hand-picked set of voices that sound natural in
 * that language. When the user switches language in the AgentBuilder,
 * the voice picker filters to this set and auto-selects the default.
 *
 * Voice IDs reference Retell's built-in + custom voices. Update when
 * new high-quality voices become available. The DEFAULT_VOICE_ID (Chipy)
 * is the fallback for DE if nothing else is configured.
 */

import { DEFAULT_VOICE_ID } from './retell.js';

export interface CuratedVoice {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'neutral';
  provider: string;
  isDefault?: boolean;
  preview?: string;
  /**
   * Extra €/minute on top of the plan's base/overage rate when this voice
   * is used. Covers the higher TTS cost of premium providers (ElevenLabs
   * Multilingual v2 ≈ 2–3× Cartesia). Displayed in the UI so users opt in
   * knowingly. Applied in reconcileMinutes() at call-end via the voice
   * recorded on the agent config.
   */
  surchargePerMinute?: number;
}

// Curated voice catalog per language. Only voices that are proven to
// sound natural + professional for each language. No random dumps.
//
// To add a voice: test it with a real conversation in that language,
// verify pronunciation of domain-specific terms (Terminbuchung, Friseur,
// etc.), then add here. Quality > quantity.
export const VOICE_CATALOG: Record<string, CuratedVoice[]> = {
  de: [
    { id: DEFAULT_VOICE_ID, name: 'Chipy (Standard, Premium)', gender: 'male', provider: 'elevenlabs', isDefault: true, surchargePerMinute: 0.05 },
    { id: 'custom_voice_28bd4920fa6523c6ac8c4e527b', name: 'Chipy (Cartesia, Standard)', gender: 'male', provider: 'cartesia' },
    { id: 'cartesia-Eva', name: 'Eva', gender: 'female', provider: 'cartesia' },
    { id: 'cartesia-Lina', name: 'Lina', gender: 'female', provider: 'cartesia' },
    { id: 'minimax-Max', name: 'Max', gender: 'male', provider: 'minimax' },
    { id: 'openai-Carola', name: 'Carola', gender: 'female', provider: 'openai' },
    { id: '11labs-Carola', name: 'Carola (ElevenLabs)', gender: 'female', provider: 'elevenlabs' },
  ],
  en: [
    { id: 'cartesia-Cleo', name: 'Cleo', gender: 'female', provider: 'cartesia', isDefault: true },
    { id: 'cartesia-Adam', name: 'Adam', gender: 'male', provider: 'cartesia' },
    { id: 'openai-Nova', name: 'Nova', gender: 'female', provider: 'openai' },
    { id: '11labs-Marissa', name: 'Marissa', gender: 'female', provider: 'elevenlabs' },
    { id: '11labs-Anthony', name: 'Anthony', gender: 'male', provider: 'elevenlabs' },
  ],
  fr: [
    { id: 'cartesia-Emma', name: 'Emma', gender: 'female', provider: 'cartesia', isDefault: true },
    { id: 'cartesia-Pierre', name: 'Pierre', gender: 'male', provider: 'cartesia' },
    { id: 'minimax-Louis', name: 'Louis', gender: 'male', provider: 'minimax' },
    { id: 'minimax-Camille', name: 'Camille', gender: 'female', provider: 'minimax' },
  ],
  es: [
    { id: 'cartesia-Isabel', name: 'Isabel', gender: 'female', provider: 'cartesia', isDefault: true },
    { id: 'cartesia-Manuel', name: 'Manuel', gender: 'male', provider: 'cartesia' },
    { id: 'cartesia-Elena', name: 'Elena', gender: 'female', provider: 'cartesia' },
    { id: '11labs-Santiago', name: 'Santiago', gender: 'male', provider: 'elevenlabs' },
  ],
  it: [
    { id: 'cartesia-Eva', name: 'Eva', gender: 'female', provider: 'cartesia', isDefault: true },
  ],
  tr: [
    { id: 'minimax-Max', name: 'Max', gender: 'male', provider: 'minimax', isDefault: true },
  ],
  pl: [
    { id: 'cartesia-Lina', name: 'Lina', gender: 'female', provider: 'cartesia', isDefault: true },
  ],
  nl: [
    { id: 'cartesia-Emma', name: 'Emma', gender: 'female', provider: 'cartesia', isDefault: true },
  ],
};

/**
 * Get the default voice ID for a given language.
 * Falls back to DE Chipy if language not in catalog.
 */
export function getDefaultVoiceForLanguage(language: string): string {
  const voices = VOICE_CATALOG[language];
  if (!voices?.length) return DEFAULT_VOICE_ID;
  const defaultVoice = voices.find(v => v.isDefault);
  return defaultVoice?.id ?? voices[0]!.id;
}

/**
 * Get curated voices for a language. Returns empty array for unknown languages
 * (frontend should fall back to showing all voices via /voices endpoint).
 */
export function getVoicesForLanguage(language: string): CuratedVoice[] {
  return VOICE_CATALOG[language] ?? [];
}

/**
 * Look up the per-minute surcharge for a given voice_id across all languages.
 * Returns 0 for unknown voices or voices without a surcharge.
 *
 * Used by reconcileMinutes() at call-end: the agent's configured voice_id
 * is resolved against this table and any surcharge is added to the Stripe
 * invoice item on top of the plan's overage rate.
 */
export function getVoiceSurcharge(voiceId: string): number {
  for (const voices of Object.values(VOICE_CATALOG)) {
    const match = voices.find((v) => v.id === voiceId);
    if (match?.surchargePerMinute && match.surchargePerMinute > 0) {
      return match.surchargePerMinute;
    }
  }
  return 0;
}
