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
 *
 * Structure (2026-04-22 rework):
 *  - DE: 5 High Quality (incl. Chipy HQ) + 15 Standard (incl. Chipy Basic) = 20
 *  - Everything else: 4 High Quality + 15 Standard = 19 (no Chipy — that
 *    voice is a German-only clone)
 *  - No duplicate names within a language
 *  - `name` carries NO provider literal ('ElevenLabs' / 'Cartesia' etc.)
 *  - `tier` is the split the UI groups by ('High Quality Voice' / 'Standard')
 *  - `gender` stays English ('male'/'female'/'neutral') for API stability —
 *    the frontend translates to 'Männlich'/'Weiblich' at render time
 *
 * Note on voice_ids: every ID below is either already in use on phonbot.de
 * or a well-known Retell supplier-prefixed voice from the Retell catalog.
 * If an ID turns out to be wrong at deploy time, Retell will 4xx on the
 * agent-deploy call — easy to spot + swap in one line here.
 */

import { DEFAULT_VOICE_ID } from './retell.js';

export interface CuratedVoice {
  id: string;
  name: string;
  tier: 'hq' | 'standard';
  gender: 'male' | 'female' | 'neutral';
  /** Internal — which supplier the voice is served by. Kept for logging /
   *  billing only. Never displayed to end users. */
  provider: string;
  isDefault?: boolean;
  /**
   * Extra €/minute on top of the plan's base/overage rate when this voice
   * is used. Populated for every `tier: 'hq'` voice. Applied in
   * reconcileMinutes() at call-end via the voice recorded on the agent
   * config.
   */
  surchargePerMinute?: number;
}

// Surcharge applied to every High-Quality voice (same rate across all
// HQ voices — ElevenLabs multilingual). Kept as a constant so frontend +
// billing + this catalog agree on one number.
export const PREMIUM_VOICE_SURCHARGE_PER_MINUTE = 0.05;

const hq = (extra: Partial<CuratedVoice>): Partial<CuratedVoice> => ({
  tier: 'hq',
  provider: 'elevenlabs',
  surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE,
  ...extra,
});
const std = (extra: Partial<CuratedVoice>): Partial<CuratedVoice> => ({
  tier: 'standard',
  ...extra,
});

// ── Shared voice pools that work across all languages ───────────────────
// Retell's multilingual voices (ElevenLabs + Cartesia + OpenAI + Minimax)
// handle every language we ship — naming them the same across languages
// avoids 7× copy-paste. The per-language block below chooses a subset
// and picks the isDefault.

// High-Quality voices (non-Chipy) — available in every language.
// 4 voices = exactly what a non-DE language needs.
const SHARED_HQ: CuratedVoice[] = [
  { ...hq({ name: 'Marissa', gender: 'female' }), id: '11labs-Marissa' } as CuratedVoice,
  { ...hq({ name: 'Rachel',  gender: 'female' }), id: '11labs-Rachel'  } as CuratedVoice,
  { ...hq({ name: 'Anthony', gender: 'male'   }), id: '11labs-Anthony' } as CuratedVoice,
  { ...hq({ name: 'Santiago', gender: 'male'  }), id: '11labs-Santiago' } as CuratedVoice,
];

// Standard voices (non-Chipy) — available in every language.
// 15 voices = exactly what a non-DE language needs.
// Ordered so the UI shows all female first, then all male, neutral last.
const SHARED_STANDARD: CuratedVoice[] = [
  // Weiblich (8)
  { ...std({ name: 'Eva',     gender: 'female' }), id: 'cartesia-Eva'    } as CuratedVoice,
  { ...std({ name: 'Lina',    gender: 'female' }), id: 'cartesia-Lina'   } as CuratedVoice,
  { ...std({ name: 'Cleo',    gender: 'female' }), id: 'cartesia-Cleo'   } as CuratedVoice,
  { ...std({ name: 'Emma',    gender: 'female' }), id: 'cartesia-Emma'   } as CuratedVoice,
  { ...std({ name: 'Isabel',  gender: 'female' }), id: 'cartesia-Isabel' } as CuratedVoice,
  { ...std({ name: 'Elena',   gender: 'female' }), id: 'cartesia-Elena'  } as CuratedVoice,
  { ...std({ name: 'Nova',    gender: 'female' }), id: 'openai-Nova'     } as CuratedVoice,
  { ...std({ name: 'Carola',  gender: 'female' }), id: 'openai-Carola'   } as CuratedVoice,
  // Männlich (6)
  { ...std({ name: 'Adam',   gender: 'male' }), id: 'cartesia-Adam'   } as CuratedVoice,
  { ...std({ name: 'Pierre', gender: 'male' }), id: 'cartesia-Pierre' } as CuratedVoice,
  { ...std({ name: 'Manuel', gender: 'male' }), id: 'cartesia-Manuel' } as CuratedVoice,
  { ...std({ name: 'Max',    gender: 'male' }), id: 'minimax-Max'     } as CuratedVoice,
  { ...std({ name: 'Louis',  gender: 'male' }), id: 'minimax-Louis'   } as CuratedVoice,
  { ...std({ name: 'Echo',   gender: 'male' }), id: 'openai-echo'     } as CuratedVoice,
  // Neutral (1)
  { ...std({ name: 'Alloy',  gender: 'neutral' }), id: 'openai-alloy' } as CuratedVoice,
];

// DE gets the two Chipy clones on top.
const DE_VOICES: CuratedVoice[] = [
  // Chipy in HQ sits up front as the default voice of the product.
  {
    id: DEFAULT_VOICE_ID, // ElevenLabs Hassieb-Kalla clone
    name: 'Chipy',
    tier: 'hq',
    gender: 'male',
    provider: 'elevenlabs',
    isDefault: true,
    surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE,
  },
  ...SHARED_HQ,
  // Chipy Basic heads the Standard tier.
  {
    id: 'custom_voice_28bd4920fa6523c6ac8c4e527b', // Cartesia Chipy clone
    name: 'Chipy Basic',
    tier: 'standard',
    gender: 'male',
    provider: 'cartesia',
  },
  ...SHARED_STANDARD,
];

// Non-DE languages: same 19-voice list, different default.
// Same IDs because the underlying Retell voices are multilingual.
function buildLang(defaultVoiceId: string): CuratedVoice[] {
  return [
    ...SHARED_HQ.map((v) => ({ ...v, isDefault: v.id === defaultVoiceId })),
    ...SHARED_STANDARD.map((v) => ({ ...v, isDefault: v.id === defaultVoiceId })),
  ];
}

export const VOICE_CATALOG: Record<string, CuratedVoice[]> = {
  de: DE_VOICES,
  en: buildLang('11labs-Marissa'),
  fr: buildLang('11labs-Marissa'),
  es: buildLang('11labs-Santiago'),
  it: buildLang('11labs-Marissa'),
  tr: buildLang('minimax-Max'),
  pl: buildLang('cartesia-Lina'),
  nl: buildLang('cartesia-Emma'),
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
 * Providers that count as "High Quality" (triggers +5 Ct/Min surcharge).
 * Exposed for voice-clone panel's default-provider heuristic; frontend
 * uses the `tier` field directly.
 */
const PREMIUM_PROVIDERS = new Set(['elevenlabs', '11labs', 'eleven_labs']);

export function isPremiumProvider(provider: string | undefined | null): boolean {
  if (!provider) return false;
  return PREMIUM_PROVIDERS.has(provider.toLowerCase());
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
  // Fallback: voice_id prefix hints at provider (e.g. "11labs-Marissa").
  // Retell-side voice IDs that start with a premium supplier slug get the
  // same surcharge as catalog entries.
  const lower = voiceId.toLowerCase();
  if (lower.startsWith('11labs-') || lower.startsWith('elevenlabs-')) {
    return PREMIUM_VOICE_SURCHARGE_PER_MINUTE;
  }
  return 0;
}
