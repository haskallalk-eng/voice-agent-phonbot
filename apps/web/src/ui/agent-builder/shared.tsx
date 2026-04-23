import React, { useState } from 'react';
import {
  IconAgent,
  IconChevronDown,
  IconStar,
  IconBrain,
  IconKnowledge,
  IconBuilding,
  IconVolume,
  IconSliders,
  IconBookOpen,
  IconMessageSquare,
  IconTemplate,
  IconGlobe,
  IconFileText,
  IconPlug,
  IconCheckCircle,
  IconAlertTriangle,
  IconInfo,
  IconMic,
  IconPhoneOut,
  IconPhoneOff,
  IconTicket,
  IconCalendar,
  IconCapabilities,
  IconPrivacy,
  IconWebhook,
  IconPlay,
  IconMicUpload,
  IconRefresh,
  IconDeploy,
} from '../PhonbotIcons.js';
import type { AgentConfig } from '../../lib/api.js';

/* ── Shared Types ── */

export type IconComp = React.FC<{ size?: number; className?: string }>;
export type SectionIconComp = React.FC<{ size?: number; className?: string }>;
export type Tab = 'identity' | 'knowledge' | 'behavior' | 'capabilities' | 'technical' | 'privacy' | 'webhooks' | 'preview';

/* ── Constants ── */

export const LANGUAGES = [
  // Tier 1 — full curated voice line-ups (19–20 voices each, including Chipy for DE)
  { id: 'de', label: '🇩🇪 Deutsch' },
  { id: 'en', label: '🇬🇧 English' },
  { id: 'fr', label: '🇫🇷 Français' },
  { id: 'es', label: '🇪🇸 Español' },
  { id: 'it', label: '🇮🇹 Italiano' },
  { id: 'tr', label: '🇹🇷 Türkçe' },
  { id: 'pl', label: '🇵🇱 Polski' },
  { id: 'nl', label: '🇳🇱 Nederlands' },
  // Tier 2 — ElevenLabs Multilingual v2 coverage, 6-voice starter sets
  { id: 'pt', label: '🇵🇹 Português' },
  { id: 'ru', label: '🇷🇺 Русский' },
  { id: 'ja', label: '🇯🇵 日本語' },
  { id: 'ko', label: '🇰🇷 한국어' },
  { id: 'zh', label: '🇨🇳 中文' },
  { id: 'ar', label: '🇸🇦 العربية' },
  { id: 'hi', label: '🇮🇳 हिन्दी' },
  { id: 'sv', label: '🇸🇪 Svenska' },
  { id: 'da', label: '🇩🇰 Dansk' },
  { id: 'fi', label: '🇫🇮 Suomi' },
  { id: 'no', label: '🇳🇴 Norsk' },
  { id: 'cs', label: '🇨🇿 Čeština' },
  { id: 'sk', label: '🇸🇰 Slovenčina' },
  { id: 'hu', label: '🇭🇺 Magyar' },
  { id: 'ro', label: '🇷🇴 Română' },
  { id: 'el', label: '🇬🇷 Ελληνικά' },
  { id: 'bg', label: '🇧🇬 Български' },
  { id: 'hr', label: '🇭🇷 Hrvatski' },
  { id: 'uk', label: '🇺🇦 Українська' },
  { id: 'id', label: '🇮🇩 Indonesia' },
  { id: 'ms', label: '🇲🇾 Bahasa Melayu' },
  { id: 'vi', label: '🇻🇳 Tiếng Việt' },
] as const;

export const CHIPY_VOICE_ID = 'custom_voice_28bd4920fa6523c6ac8c4e527b';

export const LANGUAGE_VOICE_RECOMMENDATIONS: Record<string, { voiceId: string; native: boolean }> = {
  // Tier 1 — native defaults we picked by hand
  de: { voiceId: CHIPY_VOICE_ID,     native: true  },
  en: { voiceId: 'cartesia-Cleo',    native: true  },
  fr: { voiceId: 'cartesia-Emma',    native: true  },
  es: { voiceId: 'cartesia-Isabel',  native: true  },
  it: { voiceId: CHIPY_VOICE_ID,     native: false },
  tr: { voiceId: CHIPY_VOICE_ID,     native: false },
  pl: { voiceId: CHIPY_VOICE_ID,     native: false },
  nl: { voiceId: CHIPY_VOICE_ID,     native: false },
  // Tier 2 — all use the ElevenLabs Multilingual v2 pool. The `native:true`
  // flag drops the "upload your own clone" nudge, since these share the HQ
  // pool which is already language-optimised by ElevenLabs.
  pt: { voiceId: '11labs-Marissa', native: true },
  ru: { voiceId: '11labs-Marissa', native: true },
  ja: { voiceId: '11labs-Marissa', native: true },
  ko: { voiceId: '11labs-Marissa', native: true },
  zh: { voiceId: '11labs-Marissa', native: true },
  ar: { voiceId: '11labs-Marissa', native: true },
  hi: { voiceId: '11labs-Marissa', native: true },
  sv: { voiceId: '11labs-Marissa', native: true },
  da: { voiceId: '11labs-Marissa', native: true },
  fi: { voiceId: '11labs-Marissa', native: true },
  no: { voiceId: '11labs-Marissa', native: true },
  cs: { voiceId: '11labs-Marissa', native: true },
  sk: { voiceId: '11labs-Marissa', native: true },
  hu: { voiceId: '11labs-Marissa', native: true },
  ro: { voiceId: '11labs-Marissa', native: true },
  el: { voiceId: '11labs-Marissa', native: true },
  bg: { voiceId: '11labs-Marissa', native: true },
  hr: { voiceId: '11labs-Marissa', native: true },
  uk: { voiceId: '11labs-Marissa', native: true },
  id: { voiceId: '11labs-Marissa', native: true },
  ms: { voiceId: '11labs-Marissa', native: true },
  vi: { voiceId: '11labs-Marissa', native: true },
};

export const KNOWN_TOOLS = ['calendar.findSlots', 'calendar.book', 'ticket.create'] as const;

/**
 * Role templates — each role is a composable identity the user can
 * combine. Assembly (see assembleRolePrompt) produces one single
 * "Du bist ..." intro, a bullet list of selected capabilities, then one
 * `## Section` block per role. Designed so two or three roles stacked
 * never contradict each other ("Du bist Empfang" AND "Du bist Notdienst"
 * collapses into "Du bist ein Telefonassistent mit zwei Rollen").
 */
export const PROMPT_TEMPLATES: {
  id: string;
  Icon: IconComp;
  accent: string;
  /** Primary brand hex used for section-card borders + subtle bg tint. */
  hex: string;
  name: string;
  capability: string;
  block: string;
}[] = [
  {
    id: 'reception',
    Icon: IconBuilding,
    accent: 'text-orange-400',
    hex: '#F97316',
    name: 'Empfang / Zentrale',
    capability: 'Anrufer empfangen und an die richtige Stelle leiten',
    block: `## Empfang
Begrüße jeden Anrufer freundlich, finde heraus worum es geht und leite ihn zielgerichtet weiter. Wenn das Anliegen unklar bleibt oder niemand sofort übernehmen kann, erstelle ein Rückruf-Ticket mit Name, Telefonnummer und Kurzbeschreibung.`,
  },
  {
    id: 'appointment',
    Icon: IconCalendar,
    accent: 'text-cyan-400',
    hex: '#06B6D4',
    name: 'Terminbuchung',
    capability: 'Termine vereinbaren und verbindlich bestätigen',
    block: `## Terminbuchung
Wenn der Anrufer einen Termin möchte: Frage nach Datum, Uhrzeit und Art des Termins, prüfe die Verfügbarkeit über das Kalender-Tool und biete maximal drei Optionen gruppiert nach Tag an. Bestätige den Termin erst nach erfolgreicher Buchung; bei Fehlschlag entschuldige dich kurz und leg ein Rückruf-Ticket an, damit nichts verloren geht.`,
  },
  {
    id: 'support',
    Icon: IconSliders,
    accent: 'text-violet-400',
    hex: '#A78BFA',
    name: 'Kundensupport',
    capability: 'Probleme aufnehmen und Support-Tickets erstellen',
    block: `## Kundensupport
Höre dem Kunden aufmerksam zu und lasse ihn das Problem vollständig schildern. Stelle präzise Rückfragen zu Produkt, Fehlerbild und Dringlichkeit. Löse einfache Fragen direkt; bei komplexeren oder technischen Problemen erstelle ein Ticket mit allen relevanten Details und bestätige dem Kunden die Bearbeitungszeit.`,
  },
  {
    id: 'orders',
    Icon: IconTicket,
    accent: 'text-amber-400',
    hex: '#FBBF24',
    name: 'Bestellannahme',
    capability: 'Bestellungen entgegennehmen und bestätigen',
    block: `## Bestellannahme
Nimm Bestellungen strukturiert auf: Artikel, Menge, Sonderwünsche, Lieferadresse und Wunschzeit. Lies die Bestellung vor dem Bestätigen einmal komplett vor ("Ich habe notiert: …, korrekt?"). Nenne eine realistische Lieferzeit-Spanne statt einer harten Zusage. Bei Unsicherheit leg ein Ticket an und kündige einen Rückruf zur Bestätigung an.`,
  },
  {
    id: 'emergency',
    Icon: IconAlertTriangle,
    accent: 'text-red-400',
    hex: '#F87171',
    name: 'Notdienst / After-Hours',
    capability: 'Notfälle erkennen, priorisieren und weiterleiten',
    block: `## Notdienst
Erkenne Notfall-Anliegen am Ton und an Schlüsselwörtern (Wasserschaden, Gasgeruch, medizinische Dringlichkeit, Einbruch, Ausfall kritischer Systeme). Sammle unverzüglich Name, Rückrufnummer und eine präzise Beschreibung der Situation. Leite aktiv weiter oder erstelle ein hoch-priorisiertes Notfall-Ticket. Bleibe dabei ruhig und sachlich; blase die Lage nicht unnötig auf.
Versuche NIEMALS, den Notfall selbst zu lösen oder den Anrufer zur Selbsthilfe anzuleiten — keine Erste-Hilfe-Anweisungen, keine technischen Schritte, keine „probier mal X"-Tipps. Deine einzige Aufgabe ist Lage erfassen und an Fachpersonal weiterleiten. Bei akuter Lebensgefahr verweise auf 112 bzw. den zuständigen Notruf.`,
  },
  {
    id: 'info',
    Icon: IconInfo,
    accent: 'text-sky-400',
    hex: '#38BDF8',
    name: 'Auskunft & FAQ',
    capability: 'Häufige Fragen zu Öffnungszeiten, Preisen und Services beantworten',
    block: `## Auskunft & FAQ
Beantworte Standardfragen zu Öffnungszeiten, Services, Preisen und Standort anhand der hinterlegten Business-Informationen. Wenn eine Information fehlt, erfinde nichts — sage offen, dass du das gerade nicht sicher weißt, und biete einen Rückruf oder eine Nachricht an.`,
  },
];

/**
 * Generic-assistant fallback used when no roles are selected. Exported so
 * the UI preview shows the same text the agent will actually see.
 */
export function generalAssistantBlock(businessName: string): string {
  const business = businessName || 'deinem Unternehmen';
  return `Du bist ein freundlicher allgemeiner Telefonassistent für ${business}. Höre dem Anrufer zu, finde heraus worum es geht und hilf so gut du kannst. Wenn du etwas nicht beantworten kannst, erstelle ein Rückruf-Ticket.`;
}

/** Intro line (1 or 2 sentences depending on role count). */
export function roleIntro(businessName: string, roleCount: number): string {
  const business = businessName || 'deinem Unternehmen';
  if (roleCount === 0) return '';
  if (roleCount === 1) return `Du bist der freundliche Telefonassistent von ${business}.`;
  return `Du bist der freundliche Telefonassistent von ${business}. Du übernimmst gleichzeitig mehrere Rollen für dieses Unternehmen.`;
}

/** Task list bullet block (depends on active roles). */
export function roleTaskList(roles: typeof PROMPT_TEMPLATES): string {
  if (roles.length === 0) return '';
  return `Deine Aufgaben:\n${roles.map((r) => `- ${r.capability}`).join('\n')}`;
}

/**
 * Assemble a system prompt from 0..n selected role ids, with optional
 * per-role block overrides from the customer's own edits. Always produces
 * exactly one "Du bist …"-Intro, one flat task list, then one block per
 * role (override if present, default otherwise). Empty selection falls
 * back to the generic assistant block.
 */
export function assembleRolePrompt(
  roleIds: string[],
  businessName: string,
  overrides: Record<string, string> = {},
): string {
  const roles = PROMPT_TEMPLATES.filter((t) => roleIds.includes(t.id));
  if (roles.length === 0) return generalAssistantBlock(businessName);
  const intro = roleIntro(businessName, roles.length);
  const tasks = roleTaskList(roles);
  const blocks = roles
    .map((r) => {
      const ov = overrides[r.id];
      return typeof ov === 'string' && ov.trim().length > 0 ? ov : r.block;
    })
    .join('\n\n');
  return `${intro}\n\n${tasks}\n\n${blocks}`;
}

export type PromptSection = { id: string; label: string; Icon: SectionIconComp; accent: string; hex: string; description: string; text: string };

export const PROMPT_SECTIONS: PromptSection[] = [
  {
    id: 'greeting', label: 'Begrüßung', Icon: IconAgent, accent: 'text-orange-400', hex: '#F97316',
    description: 'Wie der Agent Anrufer begrüßt',
    text: `Begrüße jeden Anrufer herzlich: "Guten Tag, willkommen bei {businessName}, mein Name ist {agentName} — wie kann ich Ihnen helfen?" Passe die Tageszeit an.`,
  },
  {
    id: 'tone', label: 'Tonalität', Icon: IconVolume, accent: 'text-cyan-400', hex: '#06B6D4',
    description: 'Sprachstil & Persönlichkeit',
    text: `Spreche ruhig, klar und professionell. Verwende eine freundliche, empathische Sprache. Vermeide Fachjargon. Höre aktiv zu und bestätige das Gehörte mit kurzen Phrasen wie "Ich verstehe" oder "Gerne helfe ich Ihnen".`,
  },
  {
    id: 'appointment', label: 'Terminbuchung', Icon: IconCalendar, accent: 'text-violet-400', hex: '#A78BFA',
    description: 'Termin finden und buchen',
    text: `Wenn ein Anrufer einen Termin möchte: Frage nach gewünschtem Datum, Uhrzeit und Art des Termins. Prüfe die Verfügbarkeit. Biete 2–3 Optionen an. Bestätige den Termin mit Datum, Uhrzeit und Ort. Frage bei Unklarheiten präzise nach.`,
  },
  {
    id: 'ticket', label: 'Ticket erstellen', Icon: IconTicket, accent: 'text-amber-400', hex: '#FBBF24',
    description: 'Anliegen als Ticket erfassen',
    text: `Erstelle ein Ticket wenn das Anliegen komplex ist, eine Bearbeitung durch das Team erfordert oder du das Problem nicht sofort lösen kannst. Erfasse: Name, Telefonnummer, Art des Anliegens und alle Details. Bestätige die Erstellung mit Ticketnummer.`,
  },
  {
    id: 'routing', label: 'Weiterleitung', Icon: IconPhoneOut, accent: 'text-sky-400', hex: '#38BDF8',
    description: 'Anruf weiterleiten',
    text: `Leite Anrufe weiter wenn das Anliegen außerhalb deines Bereichs liegt, der Anrufer nach einer bestimmten Person fragt oder eine persönliche Bearbeitung nötig ist. Kündige die Weiterleitung freundlich an und nenne die Wartezeit.`,
  },
  {
    id: 'afterhours', label: 'After-Hours', Icon: IconAlertTriangle, accent: 'text-red-400', hex: '#F87171',
    description: 'Außerhalb der Öffnungszeiten',
    text: `Außerhalb der Öffnungszeiten teile mit, dass {businessName} aktuell geschlossen ist, und nenne die Öffnungszeiten. Bei dringendem Anliegen: Notfall-Kontakt nennen oder Ticket mit Priorität "Dringend" erstellen. Sonst Rückruf anbieten.`,
  },
  {
    id: 'faq', label: 'FAQ & Auskunft', Icon: IconBookOpen, accent: 'text-indigo-400', hex: '#818CF8',
    description: 'Häufige Fragen beantworten',
    text: `Beantworte häufige Fragen anhand des hinterlegten Wissens: Öffnungszeiten, Preise, Services, Standort und Anfahrt. Wenn du eine Antwort nicht sicher kennst, sage das ehrlich und biete Alternativen an.`,
  },
  {
    id: 'escalation', label: 'Eskalation', Icon: IconSliders, accent: 'text-rose-400', hex: '#FB7185',
    description: 'An menschlichen Mitarbeiter übergeben',
    text: `Übergib an einen Mitarbeiter wenn: der Anrufer es ausdrücklich verlangt, du eine Frage nicht beantworten kannst, der Anrufer sehr aufgebracht ist oder das Anliegen rechtlicher Natur ist. Kündige die Übergabe freundlich an.`,
  },
  {
    id: 'privacy', label: 'Datenschutz', Icon: IconPrivacy, accent: 'text-emerald-400', hex: '#34D399',
    description: 'DSGVO-konform handeln',
    text: `Behandle persönliche Daten vertraulich. Frage nicht nach mehr Informationen als nötig. Gib keine Kundendaten an unbekannte Dritte weiter. Bestätige keine personenbezogenen Daten gegenüber unbekannten Anrufern.`,
  },
  {
    id: 'closing', label: 'Gesprächsabschluss', Icon: IconPhoneOff, accent: 'text-teal-400', hex: '#2DD4BF',
    description: 'Gespräch professionell beenden',
    text: `Beende jedes Gespräch freundlich. Fasse die besprochenen Punkte kurz zusammen. Frage ob du noch anderweitig helfen kannst. Verabschiedsformel: "Ich wünsche Ihnen noch einen angenehmen Tag, auf Wiederhören!"`,
  },
  {
    id: 'upsell', label: 'Zusatzangebote', Icon: IconStar, accent: 'text-yellow-400', hex: '#FACC15',
    description: 'Passende Angebote erwähnen',
    text: `Weise bei passender Gelegenheit auf relevante Angebote hin — ohne aufdringlich zu sein. Erwähne nur Angebote, die zum Anliegen des Anrufers passen. Formuliere als Vorschlag, nicht als Verkaufsgespräch. Respektiere ein "Nein" sofort.`,
  },
  {
    id: 'multilingual', label: 'Mehrsprachig', Icon: IconGlobe, accent: 'text-lime-400', hex: '#A3E635',
    description: 'Mehrere Sprachen unterstützen',
    text: `Erkenne die Sprache des Anrufers und antworte in derselben Sprache, sofern du diese beherrschst. Wechsle nahtlos die Sprache wenn der Anrufer wechselt. Bei unbekannten Sprachen bitte höflich auf Deutsch oder Englisch weiterzusprechen.`,
  },
];

export const TABS: { id: Tab; label: string; Icon: SectionIconComp }[] = [
  { id: 'identity',     label: 'Identität',    Icon: IconAgent },
  { id: 'knowledge',    label: 'Wissen',       Icon: IconKnowledge },
  { id: 'behavior',     label: 'Verhalten',    Icon: IconMessageSquare },
  { id: 'capabilities', label: 'Fähigkeiten',  Icon: IconCapabilities },
  { id: 'technical',    label: 'Technik',      Icon: IconSliders },
  { id: 'privacy',      label: 'Datenschutz',  Icon: IconPrivacy },
  { id: 'webhooks',     label: 'Schnittstellen', Icon: IconWebhook },
  { id: 'preview',      label: 'Vorschau',     Icon: IconPlay },
];

/* ── Default config values for merging ── */

export const DEFAULT_CONFIG_VALUES: Partial<AgentConfig> = {
  speakingSpeed: 1.0,
  temperature: 0.7,
  maxCallDuration: 300,
  backgroundSound: 'off',
  customVocabulary: [],
  enableDtmf: false,
  interruptionMode: 'allow',
  recordCalls: false,
  dataRetentionDays: 30,
  knowledgeSources: [],
  extractedVariables: [],
  inboundWebhooks: [],
  callRoutingRules: [],
  calendarIntegrations: [],
  apiIntegrations: [],
  liveWebAccess: { enabled: false, allowedDomains: [] },
};

/* ── Small UI Components ── */

export function SectionCard({ title, icon: Icon, children, collapsible = false, className = '', accent = 'text-orange-400' }: {
  title: string;
  icon?: SectionIconComp;
  children: React.ReactNode;
  collapsible?: boolean;
  className?: string;
  accent?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`rounded-2xl border border-white/[0.07] bg-white/[0.03] mb-5 overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => collapsible && setOpen(!open)}
        className={`flex items-center gap-3 w-full text-left px-5 py-4 ${collapsible ? 'cursor-pointer hover:bg-white/[0.03] transition-colors' : 'cursor-default'}`}
      >
        {Icon && (
          <span className={`shrink-0 ${accent}`}>
            <Icon size={17} />
          </span>
        )}
        <h3 className="text-sm font-semibold text-white/90 flex-1 tracking-wide">{title}</h3>
        {collapsible && (
          <IconChevronDown size={15} className={`text-white/25 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-white/70">{label}</span>
      {hint && <span className="text-xs text-white/40 ml-2">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white
        placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none
        disabled:opacity-50 disabled:cursor-not-allowed ${props.className ?? ''}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white
        placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none resize-y ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-white/10 bg-[#0F0F18] px-3 py-2 text-sm text-white
        focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none ${props.className ?? ''}`}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-orange-500' : 'bg-white/10'}`}
      >
        <span
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
      <span className="text-sm text-white/70">{label}</span>
    </label>
  );
}

export function Slider({ value, onChange, min, max, step, label, displayValue }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step: number;
  label: string; displayValue: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-white/70">{label}</span>
        <span className="text-sm font-mono text-orange-400">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-orange-500"
      />
    </div>
  );
}

export function Badge({ children, color = 'orange' }: { children: React.ReactNode; color?: 'orange' | 'cyan' | 'green' | 'red' }) {
  const colors = {
    orange: 'bg-orange-500/20 text-orange-300',
    cyan: 'bg-cyan-500/20 text-cyan-300',
    green: 'bg-green-500/20 text-green-400',
    red: 'bg-red-500/20 text-red-400',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[color]}`}>{children}</span>;
}

/* ── Re-export icons used by multiple tab components ── */

export {
  IconAgent,
  IconChevronDown,
  IconStar,
  IconBrain,
  IconKnowledge,
  IconBuilding,
  IconVolume,
  IconSliders,
  IconBookOpen,
  IconMessageSquare,
  IconTemplate,
  IconGlobe,
  IconFileText,
  IconPlug,
  IconCheckCircle,
  IconAlertTriangle,
  IconInfo,
  IconMic,
  IconPhoneOut,
  IconPhoneOff,
  IconTicket,
  IconCalendar,
  IconCapabilities,
  IconPrivacy,
  IconWebhook,
  IconPlay,
  IconMicUpload,
  IconRefresh,
  IconDeploy,
  IconInsights,
} from '../PhonbotIcons.js';
