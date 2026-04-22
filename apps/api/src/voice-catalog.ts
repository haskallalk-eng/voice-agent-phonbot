/**
 * Curated voice catalog — per-language native names.
 *
 * Every language gets its own line-up of voices with culturally
 * appropriate names. Under the hood we reuse a handful of multilingual
 * Retell voice_ids (ElevenLabs Multilingual v2, Cartesia Sonic, OpenAI,
 * Minimax) — the same voice engine handles every language, the display
 * name is what's localised so the picker reads natively.
 *
 * Structure (2026-04-23):
 *  - DE: 5 High Quality (incl. Chipy HQ) + 15 Standard (incl. Chipy Basic) = 20
 *  - EN / FR / ES / IT / TR / PL / NL: 4 HQ + 15 Std = 19 (no Chipy —
 *    Chipy is a German-only clone)
 *  - No duplicate names within a language
 *  - `name` carries NO provider literal
 *  - `tier` is the split the UI groups on ('High Quality Voice' / 'Standard')
 *  - `gender` stays English in API for stability — frontend translates
 *    to 'Männlich' / 'Weiblich' / 'Neutral' at render time
 *
 * Note on voice_ids: every multilingual voice_id below is either already
 * shipped on phonbot.de or a well-known Retell supplier-prefixed voice.
 * If an ID turns out to be wrong at deploy time, Retell will 4xx on the
 * agent-deploy call — easy to spot + swap in one line.
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
  surchargePerMinute?: number;
}

export const PREMIUM_VOICE_SURCHARGE_PER_MINUTE = 0.05;

// ── Voice-ID catalogue (IDs used across every language block) ────────
// Grouped by tier + gender so per-language blocks can cherry-pick and
// just rename for the locale.
const HQ_IDS = {
  f1: '11labs-Marissa',
  f2: '11labs-Rachel',
  m1: '11labs-Anthony',
  m2: '11labs-Santiago',
} as const;

const STD_IDS = {
  // 8 female + 6 male + 1 neutral — matches the non-Chipy Standard slots
  // we need per language. DE slots Chipy Basic in addition (see DE block).
  f1: 'cartesia-Eva',
  f2: 'cartesia-Lina',
  f3: 'cartesia-Cleo',
  f4: 'cartesia-Emma',
  f5: 'cartesia-Isabel',
  f6: 'cartesia-Elena',
  f7: 'openai-Nova',
  f8: 'openai-Carola',
  m1: 'cartesia-Adam',
  m2: 'cartesia-Pierre',
  m3: 'cartesia-Manuel',
  m4: 'minimax-Max',
  m5: 'minimax-Louis',
  m6: 'openai-echo',
  n1: 'openai-alloy',
} as const;

const CHIPY_HQ_ID = DEFAULT_VOICE_ID;                        // ElevenLabs Hassieb-Kalla
const CHIPY_STD_ID = 'custom_voice_28bd4920fa6523c6ac8c4e527b'; // Cartesia Chipy

// ── DE (20) ───────────────────────────────────────────────────────────
const DE_VOICES: CuratedVoice[] = [
  // High Quality
  { id: CHIPY_HQ_ID,      name: 'Chipy',   tier: 'hq',       gender: 'male',    provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f1,        name: 'Lena',    tier: 'hq',       gender: 'female',  provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f2,        name: 'Sophie',  tier: 'hq',       gender: 'female',  provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m1,        name: 'Lukas',   tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m2,        name: 'Tobias',  tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  // Standard — Weiblich
  { id: CHIPY_STD_ID,     name: 'Chipy Basic', tier: 'standard', gender: 'male',   provider: 'cartesia' },
  { id: STD_IDS.f1,       name: 'Eva',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f2,       name: 'Lina',    tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f3,       name: 'Nora',    tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f4,       name: 'Emma',    tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f5,       name: 'Clara',   tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f6,       name: 'Greta',   tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f7,       name: 'Mia',     tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.f8,       name: 'Hannah',  tier: 'standard', gender: 'female',  provider: 'openai' },
  // Standard — Männlich
  { id: STD_IDS.m1,       name: 'Jonas',   tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m2,       name: 'Stefan',  tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m3,       name: 'Daniel',  tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m4,       name: 'Max',     tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m5,       name: 'Ben',     tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m6,       name: 'Tim',     tier: 'standard', gender: 'male',    provider: 'openai' },
];

// ── EN (19) ───────────────────────────────────────────────────────────
const EN_VOICES: CuratedVoice[] = [
  { id: HQ_IDS.f1,  name: 'Marissa',   tier: 'hq',       gender: 'female',  provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f2,  name: 'Rachel',    tier: 'hq',       gender: 'female',  provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m1,  name: 'Anthony',   tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m2,  name: 'James',     tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: STD_IDS.f1, name: 'Ava',       tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f2, name: 'Charlotte', tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f3, name: 'Sophia',    tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f4, name: 'Emma',      tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f5, name: 'Isabelle',  tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f6, name: 'Olivia',    tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f7, name: 'Nova',      tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.f8, name: 'Chloe',     tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.m1, name: 'Noah',      tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m2, name: 'Oliver',    tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m3, name: 'Liam',      tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m4, name: 'Max',       tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m5, name: 'William',   tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m6, name: 'Ethan',     tier: 'standard', gender: 'male',    provider: 'openai' },
  { id: STD_IDS.n1, name: 'Alloy',     tier: 'standard', gender: 'neutral', provider: 'openai' },
];

// ── FR (19) ───────────────────────────────────────────────────────────
const FR_VOICES: CuratedVoice[] = [
  { id: HQ_IDS.f1,  name: 'Céline',    tier: 'hq',       gender: 'female',  provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f2,  name: 'Juliette',  tier: 'hq',       gender: 'female',  provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m1,  name: 'Antoine',   tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m2,  name: 'Étienne',   tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: STD_IDS.f1, name: 'Chloé',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f2, name: 'Sarah',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f3, name: 'Élodie',    tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f4, name: 'Emma',      tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f5, name: 'Marion',    tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f6, name: 'Anaïs',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f7, name: 'Manon',     tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.f8, name: 'Camille',   tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.m1, name: 'Hugo',      tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m2, name: 'Pierre',    tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m3, name: 'Thomas',    tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m4, name: 'Maxime',    tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m5, name: 'Louis',     tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m6, name: 'Julien',    tier: 'standard', gender: 'male',    provider: 'openai' },
  { id: STD_IDS.n1, name: 'Alloy',     tier: 'standard', gender: 'neutral', provider: 'openai' },
];

// ── ES (19) ───────────────────────────────────────────────────────────
const ES_VOICES: CuratedVoice[] = [
  { id: HQ_IDS.m2,  name: 'Santiago',  tier: 'hq',       gender: 'male',    provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f1,  name: 'Lucía',     tier: 'hq',       gender: 'female',  provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f2,  name: 'Carmen',    tier: 'hq',       gender: 'female',  provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m1,  name: 'Álvaro',    tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: STD_IDS.f5, name: 'Isabel',    tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f6, name: 'Elena',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f1, name: 'Sofía',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f2, name: 'Paula',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f3, name: 'Laura',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f4, name: 'Daniela',   tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f7, name: 'Valentina', tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.f8, name: 'Rocío',     tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.m3, name: 'Manuel',    tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m1, name: 'Diego',     tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m2, name: 'Javier',    tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m4, name: 'Mateo',     tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m5, name: 'Sebastián', tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m6, name: 'Carlos',    tier: 'standard', gender: 'male',    provider: 'openai' },
  { id: STD_IDS.n1, name: 'Alloy',     tier: 'standard', gender: 'neutral', provider: 'openai' },
];

// ── IT (19) ───────────────────────────────────────────────────────────
const IT_VOICES: CuratedVoice[] = [
  { id: HQ_IDS.f1,  name: 'Giulia',    tier: 'hq',       gender: 'female',  provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f2,  name: 'Sofia',     tier: 'hq',       gender: 'female',  provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m1,  name: 'Alessandro',tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m2,  name: 'Matteo',    tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: STD_IDS.f1, name: 'Eva',       tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f2, name: 'Chiara',    tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f3, name: 'Martina',   tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f4, name: 'Francesca', tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f5, name: 'Alessia',   tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f6, name: 'Elena',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f7, name: 'Lucia',     tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.f8, name: 'Valentina', tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.m1, name: 'Luca',      tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m2, name: 'Marco',     tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m3, name: 'Giovanni',  tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m4, name: 'Stefano',   tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m5, name: 'Andrea',    tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m6, name: 'Davide',    tier: 'standard', gender: 'male',    provider: 'openai' },
  { id: STD_IDS.n1, name: 'Alloy',     tier: 'standard', gender: 'neutral', provider: 'openai' },
];

// ── TR (19) ───────────────────────────────────────────────────────────
const TR_VOICES: CuratedVoice[] = [
  { id: HQ_IDS.f1,  name: 'Zeynep',    tier: 'hq',       gender: 'female',  provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f2,  name: 'Ayşe',      tier: 'hq',       gender: 'female',  provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m1,  name: 'Mehmet',    tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m2,  name: 'Emre',      tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: STD_IDS.f1, name: 'Elif',      tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f2, name: 'Merve',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f3, name: 'Selin',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f4, name: 'Deniz',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f5, name: 'Esra',      tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f6, name: 'Büşra',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f7, name: 'Gamze',     tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.f8, name: 'Ceren',     tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.m1, name: 'Can',       tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m2, name: 'Burak',     tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m3, name: 'Ahmet',     tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m4, name: 'Kaan',      tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m5, name: 'Ali',       tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m6, name: 'Okan',      tier: 'standard', gender: 'male',    provider: 'openai' },
  { id: STD_IDS.n1, name: 'Alloy',     tier: 'standard', gender: 'neutral', provider: 'openai' },
];

// ── PL (19) ───────────────────────────────────────────────────────────
const PL_VOICES: CuratedVoice[] = [
  { id: HQ_IDS.f1,  name: 'Zofia',     tier: 'hq',       gender: 'female',  provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f2,  name: 'Anna',      tier: 'hq',       gender: 'female',  provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m1,  name: 'Piotr',     tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m2,  name: 'Tomasz',    tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: STD_IDS.f1, name: 'Katarzyna', tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f2, name: 'Magdalena', tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f3, name: 'Julia',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f4, name: 'Ewa',       tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f5, name: 'Natalia',   tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f6, name: 'Karolina',  tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f7, name: 'Olga',      tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.f8, name: 'Agnieszka', tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.m1, name: 'Jakub',     tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m2, name: 'Michał',    tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m3, name: 'Marcin',    tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m4, name: 'Paweł',     tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m5, name: 'Adam',      tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m6, name: 'Krzysztof', tier: 'standard', gender: 'male',    provider: 'openai' },
  { id: STD_IDS.n1, name: 'Alloy',     tier: 'standard', gender: 'neutral', provider: 'openai' },
];

// ── NL (19) ───────────────────────────────────────────────────────────
const NL_VOICES: CuratedVoice[] = [
  { id: HQ_IDS.f1,  name: 'Sanne',     tier: 'hq',       gender: 'female',  provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f2,  name: 'Lotte',     tier: 'hq',       gender: 'female',  provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m1,  name: 'Thomas',    tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m2,  name: 'Lars',      tier: 'hq',       gender: 'male',    provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: STD_IDS.f1, name: 'Emma',      tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f2, name: 'Sophie',    tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f3, name: 'Julia',     tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f4, name: 'Lisa',      tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f5, name: 'Eva',       tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f6, name: 'Anna',      tier: 'standard', gender: 'female',  provider: 'cartesia' },
  { id: STD_IDS.f7, name: 'Fleur',     tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.f8, name: 'Noor',      tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.m1, name: 'Daan',      tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m2, name: 'Sem',       tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m3, name: 'Lucas',     tier: 'standard', gender: 'male',    provider: 'cartesia' },
  { id: STD_IDS.m4, name: 'Finn',      tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m5, name: 'Jan',       tier: 'standard', gender: 'male',    provider: 'minimax' },
  { id: STD_IDS.m6, name: 'Bram',      tier: 'standard', gender: 'male',    provider: 'openai' },
  { id: STD_IDS.n1, name: 'Alloy',     tier: 'standard', gender: 'neutral', provider: 'openai' },
];

export const VOICE_CATALOG: Record<string, CuratedVoice[]> = {
  de: DE_VOICES,
  en: EN_VOICES,
  fr: FR_VOICES,
  es: ES_VOICES,
  it: IT_VOICES,
  tr: TR_VOICES,
  pl: PL_VOICES,
  nl: NL_VOICES,
};

/** Default voice ID per language. Falls back to DE Chipy. */
export function getDefaultVoiceForLanguage(language: string): string {
  const voices = VOICE_CATALOG[language];
  if (!voices?.length) return DEFAULT_VOICE_ID;
  const defaultVoice = voices.find(v => v.isDefault);
  return defaultVoice?.id ?? voices[0]!.id;
}

/** Curated voices for a language. Empty array when language is unknown. */
export function getVoicesForLanguage(language: string): CuratedVoice[] {
  return VOICE_CATALOG[language] ?? [];
}

/** Premium providers (HQ tier). Exposed so voice-clone panel knows which
 *  uploads trigger the +5 Ct/Min surcharge at clone time. */
const PREMIUM_PROVIDERS = new Set(['elevenlabs', '11labs', 'eleven_labs']);
export function isPremiumProvider(provider: string | undefined | null): boolean {
  if (!provider) return false;
  return PREMIUM_PROVIDERS.has(provider.toLowerCase());
}

/**
 * Look up the per-minute surcharge for a given voice_id across all languages.
 * Used by reconcileMinutes() at call-end.
 */
export function getVoiceSurcharge(voiceId: string): number {
  for (const voices of Object.values(VOICE_CATALOG)) {
    const match = voices.find((v) => v.id === voiceId);
    if (match?.surchargePerMinute && match.surchargePerMinute > 0) {
      return match.surchargePerMinute;
    }
  }
  const lower = voiceId.toLowerCase();
  if (lower.startsWith('11labs-') || lower.startsWith('elevenlabs-')) {
    return PREMIUM_VOICE_SURCHARGE_PER_MINUTE;
  }
  return 0;
}
