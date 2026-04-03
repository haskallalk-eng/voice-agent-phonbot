import React, { useState } from 'react';
import {
  IconAgent,
  IconChevronDown,
  IconStar,
  IconBrain,
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
  { id: 'de', label: '\u{1F1E9}\u{1F1EA} Deutsch' },
  { id: 'en', label: '\u{1F1EC}\u{1F1E7} English' },
  { id: 'fr', label: '\u{1F1EB}\u{1F1F7} Fran\u00e7ais' },
  { id: 'es', label: '\u{1F1EA}\u{1F1F8} Espa\u00f1ol' },
  { id: 'it', label: '\u{1F1EE}\u{1F1F9} Italiano' },
  { id: 'tr', label: '\u{1F1F9}\u{1F1F7} T\u00fcrk\u00e7e' },
  { id: 'pl', label: '\u{1F1F5}\u{1F1F1} Polski' },
  { id: 'nl', label: '\u{1F1F3}\u{1F1F1} Nederlands' },
] as const;

export const KNOWN_TOOLS = ['calendar.findSlots', 'calendar.book', 'ticket.create'] as const;

export const PROMPT_TEMPLATES: { id: string; Icon: IconComp; accent: string; name: string; prompt: string }[] = [
  {
    id: 'reception',
    Icon: IconBuilding,
    accent: 'text-orange-400',
    name: 'Empfang / Zentrale',
    prompt: `Du bist die freundliche Telefonzentrale von {businessName}. Begr\u00fc\u00dfe Anrufer herzlich, finde heraus worum es geht und leite sie an die richtige Stelle weiter. Bei Unklarheiten erstelle ein Ticket.`,
  },
  {
    id: 'appointment',
    Icon: IconCalendar,
    accent: 'text-cyan-400',
    name: 'Terminbuchung',
    prompt: `Du bist der Terminassistent von {businessName}. Hilf dem Anrufer einen passenden Termin zu finden und zu buchen. Frage nach gew\u00fcnschtem Datum, Uhrzeit und Service. Best\u00e4tige den Termin am Ende.`,
  },
  {
    id: 'support',
    Icon: IconSliders,
    accent: 'text-violet-400',
    name: 'Kundensupport',
    prompt: `Du bist der Support-Assistent von {businessName}. H\u00f6re dem Kunden aufmerksam zu, versuche das Problem zu l\u00f6sen und erstelle bei Bedarf ein Ticket mit allen Details f\u00fcr das Team.`,
  },
  {
    id: 'orders',
    Icon: IconTicket,
    accent: 'text-amber-400',
    name: 'Bestellannahme',
    prompt: `Du bist der Bestellassistent von {businessName}. Nimm Bestellungen entgegen, frage nach Details (Menge, Sonderw\u00fcnsche) und best\u00e4tige die Bestellung mit gesch\u00e4tzter Lieferzeit.`,
  },
  {
    id: 'emergency',
    Icon: IconAlertTriangle,
    accent: 'text-red-400',
    name: 'Notdienst / After-Hours',
    prompt: `Du bist der Notdienst-Assistent von {businessName}. Au\u00dferhalb der \u00d6ffnungszeiten nimmst du dringende Anfragen entgegen, sammelst Kontaktdaten und erstellst ein priorisiertes Ticket.`,
  },
  {
    id: 'info',
    Icon: IconInfo,
    accent: 'text-sky-400',
    name: 'Auskunft & FAQ',
    prompt: `Du bist der Informationsassistent von {businessName}. Beantworte h\u00e4ufige Fragen zu \u00d6ffnungszeiten, Preisen, Services und Standort. Nutze das hinterlegte Wissen f\u00fcr genaue Antworten.`,
  },
];

export type PromptSection = { id: string; label: string; Icon: SectionIconComp; accent: string; description: string; text: string };

export const PROMPT_SECTIONS: PromptSection[] = [
  {
    id: 'greeting', label: 'Begr\u00fc\u00dfung', Icon: IconAgent, accent: 'text-orange-400',
    description: 'Wie der Agent Anrufer begr\u00fc\u00dft',
    text: `Begr\u00fc\u00dfe jeden Anrufer herzlich: "Guten Tag, willkommen bei {businessName}, mein Name ist {agentName} \u2014 wie kann ich Ihnen helfen?" Passe die Tageszeit an.`,
  },
  {
    id: 'tone', label: 'Tonalit\u00e4t', Icon: IconVolume, accent: 'text-cyan-400',
    description: 'Sprachstil & Pers\u00f6nlichkeit',
    text: `Spreche ruhig, klar und professionell. Verwende eine freundliche, empathische Sprache. Vermeide Fachjargon. H\u00f6re aktiv zu und best\u00e4tige das Geh\u00f6rte mit kurzen Phrasen wie "Ich verstehe" oder "Gerne helfe ich Ihnen".`,
  },
  {
    id: 'appointment', label: 'Terminbuchung', Icon: IconCalendar, accent: 'text-violet-400',
    description: 'Termin finden und buchen',
    text: `Wenn ein Anrufer einen Termin m\u00f6chte: Frage nach gew\u00fcnschtem Datum, Uhrzeit und Art des Termins. Pr\u00fcfe die Verf\u00fcgbarkeit. Biete 2\u20133 Optionen an. Best\u00e4tige den Termin mit Datum, Uhrzeit und Ort. Frage bei Unklarheiten pr\u00e4zise nach.`,
  },
  {
    id: 'ticket', label: 'Ticket erstellen', Icon: IconTicket, accent: 'text-amber-400',
    description: 'Anliegen als Ticket erfassen',
    text: `Erstelle ein Ticket wenn das Anliegen komplex ist, eine Bearbeitung durch das Team erfordert oder du das Problem nicht sofort l\u00f6sen kannst. Erfasse: Name, Telefonnummer, Art des Anliegens und alle Details. Best\u00e4tige die Erstellung mit Ticketnummer.`,
  },
  {
    id: 'routing', label: 'Weiterleitung', Icon: IconPhoneOut, accent: 'text-sky-400',
    description: 'Anruf weiterleiten',
    text: `Leite Anrufe weiter wenn das Anliegen au\u00dferhalb deines Bereichs liegt, der Anrufer nach einer bestimmten Person fragt oder eine pers\u00f6nliche Bearbeitung n\u00f6tig ist. K\u00fcndige die Weiterleitung freundlich an und nenne die Wartezeit.`,
  },
  {
    id: 'afterhours', label: 'After-Hours', Icon: IconAlertTriangle, accent: 'text-red-400',
    description: 'Au\u00dferhalb der \u00d6ffnungszeiten',
    text: `Au\u00dferhalb der \u00d6ffnungszeiten teile mit, dass {businessName} aktuell geschlossen ist, und nenne die \u00d6ffnungszeiten. Bei dringendem Anliegen: Notfall-Kontakt nennen oder Ticket mit Priorit\u00e4t "Dringend" erstellen. Sonst R\u00fcckruf anbieten.`,
  },
  {
    id: 'faq', label: 'FAQ & Auskunft', Icon: IconBookOpen, accent: 'text-indigo-400',
    description: 'H\u00e4ufige Fragen beantworten',
    text: `Beantworte h\u00e4ufige Fragen anhand des hinterlegten Wissens: \u00d6ffnungszeiten, Preise, Services, Standort und Anfahrt. Wenn du eine Antwort nicht sicher kennst, sage das ehrlich und biete Alternativen an.`,
  },
  {
    id: 'escalation', label: 'Eskalation', Icon: IconSliders, accent: 'text-rose-400',
    description: 'An menschlichen Mitarbeiter \u00fcbergeben',
    text: `\u00dcbergib an einen Mitarbeiter wenn: der Anrufer es ausdr\u00fccklich verlangt, du eine Frage nicht beantworten kannst, der Anrufer sehr aufgebracht ist oder das Anliegen rechtlicher Natur ist. K\u00fcndige die \u00dcbergabe freundlich an.`,
  },
  {
    id: 'privacy', label: 'Datenschutz', Icon: IconPrivacy, accent: 'text-emerald-400',
    description: 'DSGVO-konform handeln',
    text: `Behandle pers\u00f6nliche Daten vertraulich. Frage nicht nach mehr Informationen als n\u00f6tig. Gib keine Kundendaten an unbekannte Dritte weiter. Best\u00e4tige keine personenbezogenen Daten gegen\u00fcber unbekannten Anrufern.`,
  },
  {
    id: 'closing', label: 'Gespr\u00e4chsabschluss', Icon: IconPhoneOff, accent: 'text-teal-400',
    description: 'Gespr\u00e4ch professionell beenden',
    text: `Beende jedes Gespr\u00e4ch freundlich. Fasse die besprochenen Punkte kurz zusammen. Frage ob du noch anderweitig helfen kannst. Verabschiedsformel: "Ich w\u00fcnsche Ihnen noch einen angenehmen Tag, auf Wiederh\u00f6ren!"`,
  },
  {
    id: 'upsell', label: 'Zusatzangebote', Icon: IconStar, accent: 'text-yellow-400',
    description: 'Passende Angebote erw\u00e4hnen',
    text: `Weise bei passender Gelegenheit auf relevante Angebote hin \u2014 ohne aufdringlich zu sein. Erw\u00e4hne nur Angebote, die zum Anliegen des Anrufers passen. Formuliere als Vorschlag, nicht als Verkaufsgespr\u00e4ch. Respektiere ein "Nein" sofort.`,
  },
  {
    id: 'multilingual', label: 'Mehrsprachig', Icon: IconGlobe, accent: 'text-lime-400',
    description: 'Mehrere Sprachen unterst\u00fctzen',
    text: `Erkenne die Sprache des Anrufers und antworte in derselben Sprache, sofern du diese beherrschst. Wechsle nahtlos die Sprache wenn der Anrufer wechselt. Bei unbekannten Sprachen bitte h\u00f6flich auf Deutsch oder Englisch weiterzusprechen.`,
  },
];

export const TABS: { id: Tab; label: string; Icon: SectionIconComp }[] = [
  { id: 'identity',     label: 'Identit\u00e4t',    Icon: IconAgent },
  { id: 'knowledge',    label: 'Wissen',       Icon: IconBrain },
  { id: 'behavior',     label: 'Verhalten',    Icon: IconMessageSquare },
  { id: 'capabilities', label: 'F\u00e4higkeiten',  Icon: IconCapabilities },
  { id: 'technical',    label: 'Technik',      Icon: IconSliders },
  { id: 'privacy',      label: 'Datenschutz',  Icon: IconPrivacy },
  { id: 'webhooks',     label: 'Webhooks',     Icon: IconWebhook },
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
