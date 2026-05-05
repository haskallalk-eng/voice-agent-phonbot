/**
 * Voice catalog — only native voices per language.
 *
 * Rules (2026-04-23 rewrite):
 *  - A voice appears in a language's catalog ONLY if it genuinely
 *    sounds native in that language. Multilingual-transfer voices
 *    (English 11labs actors speaking non-English, OpenAI/Minimax
 *    outside English, etc.) are not mixed in, so the picker can't
 *    steer a customer into an accented voice by accident.
 *  - When no native voices exist for a locale, we still ship a small
 *    multilingual fallback so the feature works — but flag the
 *    language `nativeStatus: 'none'` so the UI surfaces the
 *    "upload your own clone for best quality" banner.
 *  - Languages with a narrow native catalog (≤ 6 voices) get
 *    `nativeStatus: 'few'` so the UI still nudges the user toward
 *    a clone for more variety.
 *
 * Native classification:
 *  - Custom clones (CHIPY_*): native only for the language they were
 *    recorded in (DE).
 *  - Cartesia Sonic: native for the 15 Sonic-supported locales
 *    (en/de/fr/es/it/pt/nl/pl/tr/ja/ko/zh/ru/hi/sv).
 *  - ElevenLabs 11labs-* voice IDs: native only for English (actors
 *    are English-speakers; other languages are Multilingual-v2 transfer).
 *  - OpenAI (alloy/nova/echo): native only for English (the seed
 *    recordings are English).
 *  - Minimax: excluded from native lineups everywhere (unclear
 *    recording language).
 */

import { DEFAULT_STANDARD_VOICE_ID, DEFAULT_VOICE_ID } from './retell.js';

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

export type NativeStatus = 'many' | 'few' | 'none';

export const PREMIUM_VOICE_SURCHARGE_PER_MINUTE = 0.05;

// ── Voice-ID catalogue (shared across language blocks) ─────────────────
const HQ_IDS = {
  f1: '11labs-Marissa',
  f2: '11labs-Rachel',
  m1: '11labs-Anthony',
  m2: '11labs-Santiago',
} as const;

const STD_IDS = {
  f1: 'cartesia-Eva',
  f2: 'cartesia-Lina',
  f3: 'cartesia-Cleo',
  f4: 'cartesia-Emma',
  f5: 'cartesia-Isabel',
  f6: 'cartesia-Elena',
  f7: 'openai-Nova',
  m1: 'cartesia-Adam',
  m2: 'cartesia-Pierre',
  m3: 'cartesia-Manuel',
  m6: 'openai-echo',
  n1: 'openai-alloy',
} as const;

const CHIPY_HQ_ID = DEFAULT_VOICE_ID;             // ElevenLabs Susi (DE), quality-first default
const CHIPY_STD_ID = DEFAULT_STANDARD_VOICE_ID;   // Cartesia German Conversational Woman, Sonic 3
const DE_HQ_IDS = {
  ben: 'custom_voice_74a89687ae8c8f1ad19e239e7c',
  otto: 'custom_voice_3426c893b24dd3173a963f232c',
  mila: 'custom_voice_725e2277b354e8b7054d53be8c',
} as const;

// ── Builders ───────────────────────────────────────────────────────────

type NineNames = {
  f1: string; f2: string; f3: string; f4: string; f5: string; f6: string;
  m1: string; m2: string; m3: string;
};

/**
 * 9-voice Cartesia Standard lineup (6 female + 3 male) for any of the 15
 * Sonic-native locales. Caller decides whether to prepend HQ voices.
 */
function buildCartesiaStd(names: NineNames): CuratedVoice[] {
  return [
    { id: STD_IDS.f1, name: names.f1, tier: 'standard', gender: 'female', provider: 'cartesia' },
    { id: STD_IDS.f2, name: names.f2, tier: 'standard', gender: 'female', provider: 'cartesia' },
    { id: STD_IDS.f3, name: names.f3, tier: 'standard', gender: 'female', provider: 'cartesia' },
    { id: STD_IDS.f4, name: names.f4, tier: 'standard', gender: 'female', provider: 'cartesia' },
    { id: STD_IDS.f5, name: names.f5, tier: 'standard', gender: 'female', provider: 'cartesia' },
    { id: STD_IDS.f6, name: names.f6, tier: 'standard', gender: 'female', provider: 'cartesia' },
    { id: STD_IDS.m1, name: names.m1, tier: 'standard', gender: 'male',   provider: 'cartesia' },
    { id: STD_IDS.m2, name: names.m2, tier: 'standard', gender: 'male',   provider: 'cartesia' },
    { id: STD_IDS.m3, name: names.m3, tier: 'standard', gender: 'male',   provider: 'cartesia' },
  ];
}

/**
 * 2-voice Cartesia Standard lineup (1F + 1M) for locales where we don't
 * have enough name material for nine. Caller marks first voice as default.
 */
function buildCartesiaMini(names: { f: string; m: string }): CuratedVoice[] {
  return [
    { id: STD_IDS.f1, name: names.f, tier: 'standard', gender: 'female', provider: 'cartesia', isDefault: true },
    { id: STD_IDS.m1, name: names.m, tier: 'standard', gender: 'male',   provider: 'cartesia' },
  ];
}

/**
 * 3-voice multilingual fallback for locales with NO native recordings.
 * These voices will speak the target language with a noticeable accent;
 * the UI surfaces the "upload your own clone" banner so users know.
 */
function buildFallbackLineup(names: { hqF1: string; hqM1: string; stdF1: string }): CuratedVoice[] {
  return [
    { id: HQ_IDS.f1,  name: names.hqF1,  tier: 'hq',       gender: 'female', provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
    { id: HQ_IDS.m1,  name: names.hqM1,  tier: 'hq',       gender: 'male',   provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
    { id: STD_IDS.f7, name: names.stdF1, tier: 'standard', gender: 'female', provider: 'openai' },
  ];
}

/** Mark the first entry of a list as `isDefault`. */
function withDefault(voices: CuratedVoice[]): CuratedVoice[] {
  return voices.map((v, i) => (i === 0 ? { ...v, isDefault: true } : v));
}

// ── DE — 19 native + multilingual-HQ voices ────────────────────────────
// Tier-Zusammensetzung:
//  • Chipy (HQ) = ElevenLabs Hassieb-Kalla custom clone, vollständig DE-nativ
//  • Chipy Basic (Standard) = Cartesia Chipy clone, DE-nativ
//  • 8× Cartesia Sonic Standard (DE-nativ über Sonic-DE)
//  • 8× ElevenLabs Multilingual-v2 (HQ): die englischen 11labs-Actors klingen
//    seit Multilingual-v2 (2024) auf DE sehr ordentlich — nicht 100 % nativ,
//    aber deutlich höher in akustischer Qualität (Stimm-Tiefe, Atmung,
//    Mikro-Pausen) als die DE-nativen Standard-Stimmen. Aktiviert via
//    Retell's Default-11labs-Library — kein BYO-Key nötig. +5 Ct/Min
//    Surcharge wie alle HQ-Voices.
// Current Chipy defaults are intentionally vendor voices, not the older clones:
// HQ = native German ElevenLabs, Standard = German Cartesia Sonic.
// 2026-05: Chipy HQ is Susi, a native German ElevenLabs community voice.
// Ben, Otto, and Mila are native German HQ alternatives for Agent Builder.
const DE_VOICES: CuratedVoice[] = [
  { id: CHIPY_HQ_ID,        name: 'Chipy HQ',       tier: 'hq',       gender: 'female', provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: CHIPY_STD_ID,       name: 'Chipy Standard', tier: 'standard', gender: 'female', provider: 'cartesia' },
  { id: DE_HQ_IDS.ben,      name: 'Ben HQ',         tier: 'hq',       gender: 'male',   provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: DE_HQ_IDS.otto,     name: 'Otto HQ',        tier: 'hq',       gender: 'male',   provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: DE_HQ_IDS.mila,     name: 'Mila HQ',        tier: 'hq',       gender: 'female', provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  // ── ElevenLabs HQ (Multilingual-v2 auf Deutsch) ─────────────────────
  { id: '11labs-Sarah',     name: 'Sarah',       tier: 'hq',       gender: 'female', provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: '11labs-Charlotte', name: 'Charlotte',   tier: 'hq',       gender: 'female', provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: '11labs-Matilda',   name: 'Matilda',     tier: 'hq',       gender: 'female', provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: '11labs-Lily',      name: 'Lily',        tier: 'hq',       gender: 'female', provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: '11labs-Daniel',    name: 'Daniel HQ',   tier: 'hq',       gender: 'male',   provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: '11labs-Brian',     name: 'Brian',       tier: 'hq',       gender: 'male',   provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: '11labs-Adam',      name: 'Adam',        tier: 'hq',       gender: 'male',   provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: '11labs-James',     name: 'James',       tier: 'hq',       gender: 'male',   provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  // ── Cartesia Sonic Standard (DE-nativ) ──────────────────────────────
  ...buildCartesiaStd({
    f1: 'Eva',   f2: 'Lina',   f3: 'Nora',    f4: 'Emma',  f5: 'Clara',  f6: 'Greta',
    m1: 'Jonas', m2: 'Stefan', m3: 'Daniel',
  }),
];

// ── EN — 16 native voices ──────────────────────────────────────────────
// 11labs actors are native English. OpenAI seed voices are English.
// Cartesia Sonic is native English. Full stack is genuine EN.
const EN_VOICES: CuratedVoice[] = [
  { id: HQ_IDS.f1,  name: 'Marissa', tier: 'hq', gender: 'female', provider: 'elevenlabs', isDefault: true, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.f2,  name: 'Rachel',  tier: 'hq', gender: 'female', provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m1,  name: 'Anthony', tier: 'hq', gender: 'male',   provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  { id: HQ_IDS.m2,  name: 'James',   tier: 'hq', gender: 'male',   provider: 'elevenlabs', surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE },
  ...buildCartesiaStd({
    f1: 'Ava',  f2: 'Charlotte', f3: 'Sophia', f4: 'Emma', f5: 'Isabelle', f6: 'Olivia',
    m1: 'Noah', m2: 'Oliver',    m3: 'Liam',
  }),
  { id: STD_IDS.f7, name: 'Nova',  tier: 'standard', gender: 'female',  provider: 'openai' },
  { id: STD_IDS.m6, name: 'Ethan', tier: 'standard', gender: 'male',    provider: 'openai' },
  { id: STD_IDS.n1, name: 'Alloy', tier: 'standard', gender: 'neutral', provider: 'openai' },
];

// ── FR / ES / IT / TR / PL / NL — 9 native voices each ─────────────────
// Cartesia-native only. No HQ tier: 11labs actors are English natives
// and would read these locales with a strong English accent.
const FR_VOICES: CuratedVoice[] = withDefault(buildCartesiaStd({
  f1: 'Chloé',  f2: 'Sarah',  f3: 'Élodie',  f4: 'Emma',  f5: 'Marion', f6: 'Anaïs',
  m1: 'Hugo',   m2: 'Pierre', m3: 'Thomas',
}));

const ES_VOICES: CuratedVoice[] = withDefault(buildCartesiaStd({
  f1: 'Sofía',  f2: 'Paula',  f3: 'Laura',   f4: 'Daniela', f5: 'Isabel', f6: 'Elena',
  m1: 'Diego',  m2: 'Javier', m3: 'Manuel',
}));

const IT_VOICES: CuratedVoice[] = withDefault(buildCartesiaStd({
  f1: 'Giulia',  f2: 'Chiara',  f3: 'Martina', f4: 'Francesca', f5: 'Alessia', f6: 'Elena',
  m1: 'Luca',    m2: 'Marco',   m3: 'Giovanni',
}));

const TR_VOICES: CuratedVoice[] = withDefault(buildCartesiaStd({
  f1: 'Elif',    f2: 'Merve',  f3: 'Selin',   f4: 'Deniz', f5: 'Esra',    f6: 'Büşra',
  m1: 'Can',     m2: 'Burak',  m3: 'Ahmet',
}));

const PL_VOICES: CuratedVoice[] = withDefault(buildCartesiaStd({
  f1: 'Katarzyna', f2: 'Magdalena', f3: 'Julia', f4: 'Ewa', f5: 'Natalia', f6: 'Karolina',
  m1: 'Jakub',     m2: 'Michał',    m3: 'Marcin',
}));

const NL_VOICES: CuratedVoice[] = withDefault(buildCartesiaStd({
  f1: 'Sanne',  f2: 'Lotte',  f3: 'Julia',   f4: 'Lisa',  f5: 'Eva',     f6: 'Anna',
  m1: 'Daan',   m2: 'Sem',    m3: 'Lucas',
}));

// ── PT / RU / JA / KO / ZH / HI / SV — 2 native voices each ────────────
// Cartesia Sonic covers these natively but we have less name material,
// so lineup is compact (1F + 1M). UI will show the "few voices — clone
// for more variety" banner.
const PT_VOICES = buildCartesiaMini({ f: 'Beatriz',  m: 'Miguel' });
const RU_VOICES = buildCartesiaMini({ f: 'Anna',     m: 'Aleksandr' });
const JA_VOICES = buildCartesiaMini({ f: 'Sakura',   m: 'Haruto' });
const KO_VOICES = buildCartesiaMini({ f: 'Ji-woo',   m: 'Min-jun' });
const ZH_VOICES = buildCartesiaMini({ f: 'Mei',      m: 'Jun' });
const HI_VOICES = buildCartesiaMini({ f: 'Priya',    m: 'Arjun' });
const SV_VOICES = buildCartesiaMini({ f: 'Ingrid',   m: 'Oskar' });

// ── AR / DA / FI / NO / CS / SK / HU / RO / EL / BG / HR / UK / ID / MS / VI ──
// NO native recordings at any supplier. 3-voice multilingual fallback;
// UI shows "no native voice — upload your own clone" banner.
const AR_VOICES = buildFallbackLineup({ hqF1: 'Layla',    hqM1: 'Omar',       stdF1: 'Noor' });
const DA_VOICES = buildFallbackLineup({ hqF1: 'Frida',    hqM1: 'Anders',     stdF1: 'Mathilde' });
const FI_VOICES = buildFallbackLineup({ hqF1: 'Aino',     hqM1: 'Eetu',       stdF1: 'Saara' });
const NO_VOICES = buildFallbackLineup({ hqF1: 'Nora',     hqM1: 'Henrik',     stdF1: 'Ida' });
const CS_VOICES = buildFallbackLineup({ hqF1: 'Eliška',   hqM1: 'Jakub',      stdF1: 'Tereza' });
const SK_VOICES = buildFallbackLineup({ hqF1: 'Natália',  hqM1: 'Samuel',     stdF1: 'Ema' });
const HU_VOICES = buildFallbackLineup({ hqF1: 'Zsófia',   hqM1: 'Bence',      stdF1: 'Anna' });
const RO_VOICES = buildFallbackLineup({ hqF1: 'Ioana',    hqM1: 'Andrei',     stdF1: 'Elena' });
const EL_VOICES = buildFallbackLineup({ hqF1: 'Eleni',    hqM1: 'Nikos',      stdF1: 'Sofia' });
const BG_VOICES = buildFallbackLineup({ hqF1: 'Maria',    hqM1: 'Ivan',       stdF1: 'Viktoria' });
const HR_VOICES = buildFallbackLineup({ hqF1: 'Ana',      hqM1: 'Luka',       stdF1: 'Mia' });
const UK_VOICES = buildFallbackLineup({ hqF1: 'Olena',    hqM1: 'Andriy',     stdF1: 'Sofia' });
const ID_VOICES = buildFallbackLineup({ hqF1: 'Siti',     hqM1: 'Budi',       stdF1: 'Ayu' });
const MS_VOICES = buildFallbackLineup({ hqF1: 'Nurul',    hqM1: 'Aiman',      stdF1: 'Hana' });
const VI_VOICES = buildFallbackLineup({ hqF1: 'Linh',     hqM1: 'Minh',       stdF1: 'Thu' });

export const VOICE_CATALOG: Record<string, CuratedVoice[]> = {
  de: DE_VOICES,
  en: EN_VOICES,
  fr: FR_VOICES,
  es: ES_VOICES,
  it: IT_VOICES,
  tr: TR_VOICES,
  pl: PL_VOICES,
  nl: NL_VOICES,
  pt: PT_VOICES,
  ru: RU_VOICES,
  ja: JA_VOICES,
  ko: KO_VOICES,
  zh: ZH_VOICES,
  hi: HI_VOICES,
  sv: SV_VOICES,
  ar: AR_VOICES,
  da: DA_VOICES,
  fi: FI_VOICES,
  no: NO_VOICES,
  cs: CS_VOICES,
  sk: SK_VOICES,
  hu: HU_VOICES,
  ro: RO_VOICES,
  el: EL_VOICES,
  bg: BG_VOICES,
  hr: HR_VOICES,
  uk: UK_VOICES,
  id: ID_VOICES,
  ms: MS_VOICES,
  vi: VI_VOICES,
};

/**
 * How native the voice lineup is for a given language:
 *  - 'many' → ≥ 8 genuinely native voices. No banner.
 *  - 'few'  → 1–7 native voices. Banner: "limited selection".
 *  - 'none' → 0 native voices, showing multilingual fallbacks. Banner:
 *             "no native voice — upload a clone for best quality".
 */
export const NATIVE_STATUS: Record<string, NativeStatus> = {
  // Rich native catalogs
  de: 'many', en: 'many', fr: 'many', es: 'many', it: 'many', tr: 'many', pl: 'many', nl: 'many',
  // Cartesia-native but compact (2 voices each)
  pt: 'few', ru: 'few', ja: 'few', ko: 'few', zh: 'few', hi: 'few', sv: 'few',
  // No native recordings — fallback-only
  ar: 'none', da: 'none', fi: 'none', no: 'none', cs: 'none', sk: 'none', hu: 'none',
  ro: 'none', el: 'none', bg: 'none', hr: 'none', uk: 'none', id: 'none', ms: 'none', vi: 'none',
};

export function getNativeStatus(language: string): NativeStatus {
  return NATIVE_STATUS[language] ?? 'none';
}

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
