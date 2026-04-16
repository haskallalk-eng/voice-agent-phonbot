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
}

// Curated voice catalog per language. Only voices that are proven to
// sound natural + professional for each language. No random dumps.
//
// To add a voice: test it with a real conversation in that language,
// verify pronunciation of domain-specific terms (Terminbuchung, Friseur,
// etc.), then add here. Quality > quantity.
export const VOICE_CATALOG: Record<string, CuratedVoice[]> = {
  de: [
    { id: DEFAULT_VOICE_ID, name: 'Chipy (Standard)', gender: 'male', provider: 'cartesia', isDefault: true },
    { id: '11labs-Adrian', name: 'Adrian', gender: 'male', provider: 'elevenlabs' },
    { id: '11labs-Valentina', name: 'Valentina', gender: 'female', provider: 'elevenlabs' },
  ],
  en: [
    { id: 'retell-Marissa', name: 'Marissa', gender: 'female', provider: 'retell', isDefault: true },
    { id: 'retell-Josh', name: 'Josh', gender: 'male', provider: 'retell' },
  ],
  fr: [
    { id: 'retell-Sophie', name: 'Sophie', gender: 'female', provider: 'retell', isDefault: true },
  ],
  es: [
    { id: 'retell-Carlos', name: 'Carlos', gender: 'male', provider: 'retell', isDefault: true },
  ],
  it: [
    { id: 'retell-Giulia', name: 'Giulia', gender: 'female', provider: 'retell', isDefault: true },
  ],
  tr: [
    { id: 'retell-Elif', name: 'Elif', gender: 'female', provider: 'retell', isDefault: true },
  ],
  pl: [
    { id: 'retell-Anna', name: 'Anna', gender: 'female', provider: 'retell', isDefault: true },
  ],
  nl: [
    { id: 'retell-Emma', name: 'Emma', gender: 'female', provider: 'retell', isDefault: true },
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
