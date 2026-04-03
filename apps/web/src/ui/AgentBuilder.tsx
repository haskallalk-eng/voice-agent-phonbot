import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  getAgentConfig,
  getAgentConfigs,
  createNewAgent,
  saveAgentConfig,
  deployAgentConfig,
  getAgentPreview,
  getBillingStatus,
  getVoices,
  cloneVoice,
  type AgentConfig,
  type AgentPreview,
  type KnowledgeSource,
  type ExtractedVariable,
  type InboundWebhook,
  type CallRoutingRule,
  type ApiIntegration,
  type LiveWebAccess,
  type Voice,
} from '../lib/api.js';
import { useUnsavedChanges } from '../components/ui.js';
import { WebCallWidget } from './WebCallWidget.js';
import {
  IconAgent,
  IconCapabilities,
  IconPrivacy,
  IconWebhook,
  IconPlay,
  IconDeploy,
  IconMicUpload,
  IconChevronDown,
  IconRefresh,
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
} from './PhonbotIcons.js';

const LANGUAGES = [
  { id: 'de', label: '🇩🇪 Deutsch' },
  { id: 'en', label: '🇬🇧 English' },
  { id: 'fr', label: '🇫🇷 Français' },
  { id: 'es', label: '🇪🇸 Español' },
  { id: 'it', label: '🇮🇹 Italiano' },
  { id: 'tr', label: '🇹🇷 Türkçe' },
  { id: 'pl', label: '🇵🇱 Polski' },
  { id: 'nl', label: '🇳🇱 Nederlands' },
] as const;

const KNOWN_TOOLS = ['calendar.findSlots', 'calendar.book', 'ticket.create'] as const;

/* ── Prompt Templates ── */
type IconComp = React.FC<{ size?: number; className?: string }>;
const PROMPT_TEMPLATES: { id: string; Icon: IconComp; accent: string; name: string; prompt: string }[] = [
  {
    id: 'reception',
    Icon: IconBuilding,
    accent: 'text-orange-400',
    name: 'Empfang / Zentrale',
    prompt: `Du bist die freundliche Telefonzentrale von {businessName}. Begrüße Anrufer herzlich, finde heraus worum es geht und leite sie an die richtige Stelle weiter. Bei Unklarheiten erstelle ein Ticket.`,
  },
  {
    id: 'appointment',
    Icon: IconCalendar,
    accent: 'text-cyan-400',
    name: 'Terminbuchung',
    prompt: `Du bist der Terminassistent von {businessName}. Hilf dem Anrufer einen passenden Termin zu finden und zu buchen. Frage nach gewünschtem Datum, Uhrzeit und Service. Bestätige den Termin am Ende.`,
  },
  {
    id: 'support',
    Icon: IconSliders,
    accent: 'text-violet-400',
    name: 'Kundensupport',
    prompt: `Du bist der Support-Assistent von {businessName}. Höre dem Kunden aufmerksam zu, versuche das Problem zu lösen und erstelle bei Bedarf ein Ticket mit allen Details für das Team.`,
  },
  {
    id: 'orders',
    Icon: IconTicket,
    accent: 'text-amber-400',
    name: 'Bestellannahme',
    prompt: `Du bist der Bestellassistent von {businessName}. Nimm Bestellungen entgegen, frage nach Details (Menge, Sonderwünsche) und bestätige die Bestellung mit geschätzter Lieferzeit.`,
  },
  {
    id: 'emergency',
    Icon: IconAlertTriangle,
    accent: 'text-red-400',
    name: 'Notdienst / After-Hours',
    prompt: `Du bist der Notdienst-Assistent von {businessName}. Außerhalb der Öffnungszeiten nimmst du dringende Anfragen entgegen, sammelst Kontaktdaten und erstellst ein priorisiertes Ticket.`,
  },
  {
    id: 'info',
    Icon: IconInfo,
    accent: 'text-sky-400',
    name: 'Auskunft & FAQ',
    prompt: `Du bist der Informationsassistent von {businessName}. Beantworte häufige Fragen zu Öffnungszeiten, Preisen, Services und Standort. Nutze das hinterlegte Wissen für genaue Antworten.`,
  },
];

/* ── Small UI Components ── */

type SectionIconComp = React.FC<{ size?: number; className?: string }>;

/* ── Prompt Section Blocks (additive, toggleable) ── */
type PromptSection = { id: string; label: string; Icon: SectionIconComp; accent: string; description: string; text: string };
const PROMPT_SECTIONS: PromptSection[] = [
  {
    id: 'greeting', label: 'Begrüßung', Icon: IconAgent, accent: 'text-orange-400',
    description: 'Wie der Agent Anrufer begrüßt',
    text: `Begrüße jeden Anrufer herzlich: "Guten Tag, willkommen bei {businessName}, mein Name ist {agentName} — wie kann ich Ihnen helfen?" Passe die Tageszeit an.`,
  },
  {
    id: 'tone', label: 'Tonalität', Icon: IconVolume, accent: 'text-cyan-400',
    description: 'Sprachstil & Persönlichkeit',
    text: `Spreche ruhig, klar und professionell. Verwende eine freundliche, empathische Sprache. Vermeide Fachjargon. Höre aktiv zu und bestätige das Gehörte mit kurzen Phrasen wie "Ich verstehe" oder "Gerne helfe ich Ihnen".`,
  },
  {
    id: 'appointment', label: 'Terminbuchung', Icon: IconCalendar, accent: 'text-violet-400',
    description: 'Termin finden und buchen',
    text: `Wenn ein Anrufer einen Termin möchte: Frage nach gewünschtem Datum, Uhrzeit und Art des Termins. Prüfe die Verfügbarkeit. Biete 2–3 Optionen an. Bestätige den Termin mit Datum, Uhrzeit und Ort. Frage bei Unklarheiten präzise nach.`,
  },
  {
    id: 'ticket', label: 'Ticket erstellen', Icon: IconTicket, accent: 'text-amber-400',
    description: 'Anliegen als Ticket erfassen',
    text: `Erstelle ein Ticket wenn das Anliegen komplex ist, eine Bearbeitung durch das Team erfordert oder du das Problem nicht sofort lösen kannst. Erfasse: Name, Telefonnummer, Art des Anliegens und alle Details. Bestätige die Erstellung mit Ticketnummer.`,
  },
  {
    id: 'routing', label: 'Weiterleitung', Icon: IconPhoneOut, accent: 'text-sky-400',
    description: 'Anruf weiterleiten',
    text: `Leite Anrufe weiter wenn das Anliegen außerhalb deines Bereichs liegt, der Anrufer nach einer bestimmten Person fragt oder eine persönliche Bearbeitung nötig ist. Kündige die Weiterleitung freundlich an und nenne die Wartezeit.`,
  },
  {
    id: 'afterhours', label: 'After-Hours', Icon: IconAlertTriangle, accent: 'text-red-400',
    description: 'Außerhalb der Öffnungszeiten',
    text: `Außerhalb der Öffnungszeiten teile mit, dass {businessName} aktuell geschlossen ist, und nenne die Öffnungszeiten. Bei dringendem Anliegen: Notfall-Kontakt nennen oder Ticket mit Priorität "Dringend" erstellen. Sonst Rückruf anbieten.`,
  },
  {
    id: 'faq', label: 'FAQ & Auskunft', Icon: IconBookOpen, accent: 'text-indigo-400',
    description: 'Häufige Fragen beantworten',
    text: `Beantworte häufige Fragen anhand des hinterlegten Wissens: Öffnungszeiten, Preise, Services, Standort und Anfahrt. Wenn du eine Antwort nicht sicher kennst, sage das ehrlich und biete Alternativen an.`,
  },
  {
    id: 'escalation', label: 'Eskalation', Icon: IconSliders, accent: 'text-rose-400',
    description: 'An menschlichen Mitarbeiter übergeben',
    text: `Übergib an einen Mitarbeiter wenn: der Anrufer es ausdrücklich verlangt, du eine Frage nicht beantworten kannst, der Anrufer sehr aufgebracht ist oder das Anliegen rechtlicher Natur ist. Kündige die Übergabe freundlich an.`,
  },
  {
    id: 'privacy', label: 'Datenschutz', Icon: IconPrivacy, accent: 'text-emerald-400',
    description: 'DSGVO-konform handeln',
    text: `Behandle persönliche Daten vertraulich. Frage nicht nach mehr Informationen als nötig. Gib keine Kundendaten an unbekannte Dritte weiter. Bestätige keine personenbezogenen Daten gegenüber unbekannten Anrufern.`,
  },
  {
    id: 'closing', label: 'Gesprächsabschluss', Icon: IconPhoneOff, accent: 'text-teal-400',
    description: 'Gespräch professionell beenden',
    text: `Beende jedes Gespräch freundlich. Fasse die besprochenen Punkte kurz zusammen. Frage ob du noch anderweitig helfen kannst. Verabschiedsformel: "Ich wünsche Ihnen noch einen angenehmen Tag, auf Wiederhören!"`,
  },
  {
    id: 'upsell', label: 'Zusatzangebote', Icon: IconStar, accent: 'text-yellow-400',
    description: 'Passende Angebote erwähnen',
    text: `Weise bei passender Gelegenheit auf relevante Angebote hin — ohne aufdringlich zu sein. Erwähne nur Angebote, die zum Anliegen des Anrufers passen. Formuliere als Vorschlag, nicht als Verkaufsgespräch. Respektiere ein "Nein" sofort.`,
  },
  {
    id: 'multilingual', label: 'Mehrsprachig', Icon: IconGlobe, accent: 'text-lime-400',
    description: 'Mehrere Sprachen unterstützen',
    text: `Erkenne die Sprache des Anrufers und antworte in derselben Sprache, sofern du diese beherrschst. Wechsle nahtlos die Sprache wenn der Anrufer wechselt. Bei unbekannten Sprachen bitte höflich auf Deutsch oder Englisch weiterzusprechen.`,
  },
];

function SectionCard({ title, icon: Icon, children, collapsible = false, className = '', accent = 'text-orange-400' }: {
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-white/70">{label}</span>
      {hint && <span className="text-xs text-white/40 ml-2">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white
        placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none
        disabled:opacity-50 disabled:cursor-not-allowed ${props.className ?? ''}`}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white
        placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none resize-y ${props.className ?? ''}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-white/10 bg-[#0F0F18] px-3 py-2 text-sm text-white
        focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none ${props.className ?? ''}`}
    />
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
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

function Slider({ value, onChange, min, max, step, label, displayValue }: {
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

function Badge({ children, color = 'orange' }: { children: React.ReactNode; color?: 'orange' | 'cyan' | 'green' | 'red' }) {
  const colors = {
    orange: 'bg-orange-500/20 text-orange-300',
    cyan: 'bg-cyan-500/20 text-cyan-300',
    green: 'bg-green-500/20 text-green-400',
    red: 'bg-red-500/20 text-red-400',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[color]}`}>{children}</span>;
}

/* ── Tabs ── */
type Tab = 'identity' | 'knowledge' | 'behavior' | 'capabilities' | 'technical' | 'privacy' | 'webhooks' | 'preview';

const TABS: { id: Tab; label: string; Icon: SectionIconComp }[] = [
  { id: 'identity',     label: 'Identität',    Icon: IconAgent },
  { id: 'knowledge',    label: 'Wissen',       Icon: IconBrain },
  { id: 'behavior',     label: 'Verhalten',    Icon: IconMessageSquare },
  { id: 'capabilities', label: 'Fähigkeiten',  Icon: IconCapabilities },
  { id: 'technical',    label: 'Technik',      Icon: IconSliders },
  { id: 'privacy',      label: 'Datenschutz',  Icon: IconPrivacy },
  { id: 'webhooks',     label: 'Webhooks',     Icon: IconWebhook },
  { id: 'preview',      label: 'Vorschau',     Icon: IconPlay },
];

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Main Component                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

export function AgentBuilder() {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [allAgents, setAllAgents] = useState<AgentConfig[]>([]);
  const [agentsLimit, setAgentsLimit] = useState(1);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [preview, setPreview] = useState<AgentPreview | null>(null);
  const [status, setStatus] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [tab, setTab] = useState<Tab>('identity');
  const [view, setView] = useState<'list' | 'edit'>('list');
  // Voice list (dynamic from Retell API)
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  // Voice dropdown
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false);
  const voiceDropdownRef = useRef<HTMLDivElement>(null);
  // Prompt section chips
  const [activePromptSections, setActivePromptSections] = useState<Set<string>>(new Set());
  // Unsaved changes warning
  const [isDirty, setIsDirty] = useState(false);
  useUnsavedChanges(isDirty);

  const loadVoices = useCallback(async () => {
    setVoicesLoading(true);
    try {
      const res = await getVoices();
      setVoices(res.voices ?? []);
    } catch {
      // Non-fatal — voice list stays empty, user can still type voice ID
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  useEffect(() => { void loadAllAgents(); void loadConfig(); void loadVoices(); }, [loadVoices]);

  // Close voice dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (voiceDropdownRef.current && !voiceDropdownRef.current.contains(e.target as Node)) {
        setVoiceDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function loadAllAgents() {
    try {
      const [agentsRes, billing] = await Promise.all([getAgentConfigs(), getBillingStatus()]);
      setAllAgents(agentsRes.items);
      // agentsLimit comes from plan definition (1/1/3/10)
      const LIMITS: Record<string, number> = { free: 1, starter: 1, pro: 3, agency: 10 };
      setAgentsLimit(LIMITS[billing.plan] ?? 1);
    } catch {
      // Non-critical — list stays empty
    }
  }

  async function handleCreateAgent() {
    setCreatingAgent(true);
    setStatus(null);
    try {
      const newCfg = await createNewAgent({ name: 'Neuer Agent', businessName: 'Mein Business' });
      await loadAllAgents();
      // Load the new agent into the editor
      const merged: AgentConfig = {
        speakingSpeed: 1.0, temperature: 0.7, maxCallDuration: 300,
        backgroundSound: 'off', customVocabulary: [], enableDtmf: false,
        interruptionMode: 'allow', recordCalls: false, dataRetentionDays: 30,
        knowledgeSources: [], extractedVariables: [], inboundWebhooks: [],
        callRoutingRules: [], calendarIntegrations: [], apiIntegrations: [],
        liveWebAccess: { enabled: false, allowedDomains: [] },
        ...newCfg,
      };
      setConfig(merged);
      setView('edit');
    } catch (e: unknown) {
      setStatus({ type: 'error', text: e instanceof Error ? e.message : 'Fehler beim Erstellen' });
    } finally {
      setCreatingAgent(false);
    }
  }

  async function handleSelectAgent(tenantId: string) {
    try {
      const cfg = await getAgentConfig(tenantId);
      const merged: AgentConfig = {
        speakingSpeed: 1.0, temperature: 0.7, maxCallDuration: 300,
        backgroundSound: 'off', customVocabulary: [], enableDtmf: false,
        interruptionMode: 'allow', recordCalls: false, dataRetentionDays: 30,
        knowledgeSources: [], extractedVariables: [], inboundWebhooks: [],
        callRoutingRules: [], calendarIntegrations: [], apiIntegrations: [],
        liveWebAccess: { enabled: false, allowedDomains: [] },
        ...cfg,
      };
      setConfig(merged);
      setView('edit');
    } catch {
      // fallback
    }
  }

  async function loadConfig() {
    try {
      const cfg = await getAgentConfig();
      const merged: AgentConfig = {
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
        ...cfg,
      };
      setConfig(merged);
      // Default to list view if already deployed
      if (merged.retellAgentId) setView('list');
      else setView('edit');
      const prev = await getAgentPreview();
      setPreview(prev);
    } catch {
      setStatus({ type: 'error', text: 'Config konnte nicht geladen werden' });
    }
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setStatus(null);
    try {
      // If already deployed, sync to Retell so voice/config changes take effect immediately
      if (config.retellAgentId) {
        const result = await deployAgentConfig(config);
        setConfig((c) => c ? { ...c, ...result.config } : c);
      } else {
        await saveAgentConfig(config);
      }
      const prev = await getAgentPreview();
      setPreview(prev);
      setStatus({ type: 'ok', text: 'Gespeichert ✅' });
      setIsDirty(false);
    } catch {
      setStatus({ type: 'error', text: 'Speichern fehlgeschlagen' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeploy() {
    if (!config) return;
    setDeploying(true);
    setStatus(null);
    try {
      const result = await deployAgentConfig(config);
      setConfig((c) => c ? { ...c, ...result.config } : c);
      const prev = await getAgentPreview();
      setPreview(prev);
      setStatus({ type: 'ok', text: `Deployed — Agent: ${result.retellAgentId ?? '–'}` });
      setIsDirty(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setStatus({ type: 'error', text: `Deploy fehlgeschlagen: ${msg}` });
    } finally {
      setDeploying(false);
    }
  }

  function update(patch: Partial<AgentConfig>) {
    setConfig((c) => (c ? { ...c, ...patch } : c));
    setIsDirty(true);
  }

  function togglePromptSection(sectionId: string) {
    if (!config) return;
    const section = PROMPT_SECTIONS.find(s => s.id === sectionId);
    if (!section) return;
    const isActive = activePromptSections.has(sectionId);
    const newActive = new Set(activePromptSections);
    if (isActive) {
      newActive.delete(sectionId);
      setActivePromptSections(newActive);
      const current = config.systemPrompt ?? '';
      const lines = current.split('\n');
      const startIdx = lines.findIndex(l => l.trim() === `### ${section.label}`);
      if (startIdx >= 0) {
        const endIdx = lines.findIndex((l, i) => i > startIdx + 1 && l.startsWith('### '));
        const removeFrom = startIdx > 0 && lines[startIdx - 1]?.trim() === '' ? startIdx - 1 : startIdx;
        const removeEnd = endIdx < 0 ? lines.length : endIdx;
        update({ systemPrompt: [...lines.slice(0, removeFrom), ...lines.slice(removeEnd)].join('\n').trim() });
      }
    } else {
      newActive.add(sectionId);
      setActivePromptSections(newActive);
      const businessName = config.businessName || 'deinem Unternehmen';
      const agentName = config.name || 'dem Assistenten';
      const sectionText = section.text
        .replace(/\{businessName\}/g, businessName)
        .replace(/\{agentName\}/g, agentName);
      const current = (config.systemPrompt ?? '').trim();
      update({ systemPrompt: current ? `${current}\n\n### ${section.label}\n${sectionText}` : `### ${section.label}\n${sectionText}` });
    }
  }

  if (!config) {
    return <div className="p-8 text-white/50">Lade Agent-Konfiguration…</div>;
  }

  /* ── LIST VIEW ── */
  if (view === 'list') {
    const displayAgents = allAgents.length > 0 ? allAgents : (config ? [config] : []);
    const canAddAgent = displayAgents.length < agentsLimit;

    return (
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Deine Agenten</h2>
            <p className="text-xs text-white/35 mt-0.5">
              {displayAgents.length} / {agentsLimit} Agent{agentsLimit !== 1 ? 'en' : ''} aktiv
            </p>
          </div>
          {status && (
            <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
              status.type === 'ok'
                ? 'text-green-400 bg-green-500/10 border border-green-500/20'
                : 'text-red-400 bg-red-500/10 border border-red-500/20'
            }`}>
              {status.text}
            </span>
          )}
        </div>

        {/* Agent Cards */}
        <div className="space-y-2 mb-5">
          {displayAgents.map((agent) => (
            <div
              key={agent.tenantId}
              className="group flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-5 py-4 hover:border-white/[0.12] hover:bg-white/[0.05] transition-all duration-200 cursor-pointer"
              onClick={() => void handleSelectAgent(agent.tenantId)}
            >
              <div className="shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center">
                <IconAgent size={16} className="text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{agent.name || 'Unbenannter Agent'}</p>
                <p className="text-xs text-white/40 truncate mt-0.5">{agent.businessName || '—'}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {agent.retellAgentId ? (
                  <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                    Live
                  </span>
                ) : (
                  <span className="text-xs text-amber-400/70 bg-amber-500/10 border border-amber-500/15 px-2.5 py-1 rounded-full font-medium">Entwurf</span>
                )}
                <span className="text-xs text-white/30 group-hover:text-white/60 transition-colors">Bearbeiten →</span>
              </div>
            </div>
          ))}
        </div>

        {/* Add Agent Button */}
        {canAddAgent ? (
          <button
            onClick={() => void handleCreateAgent()}
            disabled={creatingAgent}
            className="w-full rounded-2xl border border-dashed border-white/10 hover:border-orange-500/30 py-4 text-sm text-white/30 hover:text-orange-400/70 disabled:opacity-50 transition-all duration-200 cursor-pointer"
          >
            {creatingAgent ? 'Wird erstellt…' : '+ Neuen Agenten erstellen'}
          </button>
        ) : (
          <div className="relative">
            <button
              disabled
              className="w-full rounded-2xl border border-dashed border-white/5 py-4 text-sm text-white/20 cursor-not-allowed"
            >
              + Neuen Agenten erstellen
            </button>
            <span className="absolute top-1/2 -translate-y-1/2 right-4 text-[10px] bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full font-medium">
              {agentsLimit < 3 ? 'ab Pro' : 'Limit'}
            </span>
          </div>
        )}
      </div>
    );
  }

  /* ── EDIT VIEW ── */
  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setView('list')}
            className="shrink-0 flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer"
          >
            <span className="text-base leading-none">‹</span> Agenten
          </button>
          <div className="w-px h-4 bg-white/10" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white truncate">{config.name || 'Agent Builder'}</h2>
            <p className="text-xs text-white/30 mt-0.5 truncate">{config.businessName || 'Konfiguration'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status && (
            <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
              status.type === 'ok'
                ? 'text-green-400 bg-green-500/10 border border-green-500/20'
                : 'text-red-400 bg-red-500/10 border border-red-500/20'
            }`}>
              {status.text}
            </span>
          )}
          {config.retellAgentId && (
            <button
              onClick={() => setTab('preview')}
              className="flex items-center gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/8 px-3.5 py-2 text-xs font-medium text-cyan-400 hover:bg-cyan-500/15 hover:border-cyan-500/40 transition-all cursor-pointer"
            >
              <IconPlay size={13} />
              Testen
            </button>
          )}
          {config.retellAgentId ? (
            <button
              onClick={handleSave}
              disabled={saving || deploying}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 transition-all cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              {saving ? (
                <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : null}
              {saving ? 'Speichert…' : 'Speichern'}
            </button>
          ) : (
            <button
              onClick={handleDeploy}
              disabled={deploying || saving}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 transition-all cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              <IconDeploy size={13} />
              {deploying ? 'Deploying…' : 'Deploy'}
            </button>
          )}
        </div>
      </div>

      {/* Vertical Tab Navigation + Content */}
      <div className="flex gap-5">
        {/* Left: Tab list */}
        <div className="w-40 shrink-0 space-y-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-all text-left cursor-pointer ${
                tab === t.id
                  ? 'bg-white/8 text-white border border-white/10'
                  : 'text-white/35 hover:text-white/65 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              <t.Icon size={14} className={tab === t.id ? 'text-orange-400' : ''} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Right: Content */}
        <div className="flex-1 min-w-0">

      {/* ────────────────────── IDENTITY ────────────────────── */}
      {tab === 'identity' && (
        <>
          <SectionCard title="Identität" icon={IconAgent} className={voiceDropdownOpen ? 'relative z-10 overflow-visible' : ''}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Agent-Name">
                <Input value={config.name} onChange={(e) => update({ name: e.target.value })} placeholder="z.B. Lisa" />
              </Field>
              <Field label="Sprache">
                <Select value={config.language} onChange={(e) => update({ language: e.target.value as AgentConfig['language'] })}>
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
                  onOpenToggle={() => setVoiceDropdownOpen((v) => !v)}
                  onSelect={(id) => { update({ voice: id }); setVoiceDropdownOpen(false); }}
                />
              </Field>
            </div>
            {config.retellAgentId && (
              <div className="mt-3 flex items-center gap-3 text-xs text-white/50">
                <Badge color="green">Deployed</Badge>
                <span>Agent: <code className="font-mono">{config.retellAgentId}</code></span>
              </div>
            )}
          </SectionCard>

          {/* Voice cloning panel */}
          <VoiceClonePanel
            onVoiceCloned={(newVoice) => {
              setVoices((prev) => {
                const filtered = prev.filter((v) => v.voice_id !== newVoice.voice_id);
                return [newVoice, ...filtered];
              });
              update({ voice: newVoice.voice_id });
            }}
          />

          <SectionCard title="Business-Informationen" icon={IconBuilding}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Firmenname">
                <Input value={config.businessName} onChange={(e) => update({ businessName: e.target.value })} placeholder="Friseur Müller" />
              </Field>
              <Field label="Adresse">
                <Input value={config.address} onChange={(e) => update({ address: e.target.value })} placeholder="Hauptstr. 12, 10115 Berlin" />
              </Field>
            </div>
            <div className="mt-4 space-y-4">
              <Field label="Beschreibung">
                <TextArea rows={2} value={config.businessDescription} onChange={(e) => update({ businessDescription: e.target.value })} placeholder="Was macht euer Unternehmen?" />
              </Field>
              <Field label="Öffnungszeiten">
                <TextArea rows={2} value={config.openingHours} onChange={(e) => update({ openingHours: e.target.value })} placeholder="Mo–Fr 9–18 Uhr, Sa 10–14 Uhr" />
              </Field>
              <Field label="Services / Angebote">
                <TextArea rows={2} value={config.servicesText} onChange={(e) => update({ servicesText: e.target.value })} placeholder="Haarschnitt, Färben, Beratung…" />
              </Field>
            </div>
          </SectionCard>
        </>
      )}

      {/* ────────────────────── KNOWLEDGE ────────────────────── */}
      {tab === 'knowledge' && (
        <SectionCard title="Wissensquellen" icon={IconBrain}>
          <p className="text-sm text-white/50 mb-4">
            Gib deinem Agent Zugang zu Informationen — er kann Inhalte von Webseiten lesen, PDFs verarbeiten oder eigene Texte nutzen.
          </p>

          {/* Existing sources */}
          {(config.knowledgeSources ?? []).length > 0 && (
            <div className="space-y-2 mb-4">
              {(config.knowledgeSources ?? []).map((src, i) => (
                <div key={src.id} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                  <span className="text-white/40 shrink-0">
                    {src.type === 'url' ? <IconGlobe size={16} /> : src.type === 'pdf' ? <IconFileText size={16} /> : <IconMessageSquare size={16} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{src.name}</p>
                    <p className="text-xs text-white/40 truncate">{src.content}</p>
                  </div>
                  <Badge color={src.status === 'indexed' ? 'green' : src.status === 'error' ? 'red' : 'orange'}>
                    {src.status === 'indexed' ? 'Indexiert' : src.status === 'error' ? 'Fehler' : 'Warte…'}
                  </Badge>
                  <button onClick={() => {
                    const next = [...(config.knowledgeSources ?? [])];
                    next.splice(i, 1);
                    update({ knowledgeSources: next });
                  }} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer" aria-label="Entfernen">
                    <IconFileText size={13} className="rotate-45" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new source */}
          <KnowledgeAdder onAdd={(src) => {
            update({ knowledgeSources: [...(config.knowledgeSources ?? []), src] });
          }} />
        </SectionCard>
      )}

      {/* ────────────────────── BEHAVIOR ────────────────────── */}
      {tab === 'behavior' && (
        <>
          {/* Base Role */}
          <SectionCard title="Grundrolle" icon={IconTemplate} collapsible>
            <p className="text-xs text-white/40 mb-3">Legt fest wofür der Agent hauptsächlich eingesetzt wird — setzt den Prompt zurück.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {PROMPT_TEMPLATES.map((tpl) => (
                <button key={tpl.id} onClick={() => {
                  const prompt = tpl.prompt.replace('{businessName}', config.businessName || 'deinem Unternehmen');
                  update({ systemPrompt: prompt });
                  setActivePromptSections(new Set());
                }}
                  className="group flex flex-col items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-orange-500/30 hover:bg-white/[0.06] transition-all text-center cursor-pointer">
                  <tpl.Icon size={18} className={tpl.accent} />
                  <span className="text-xs font-medium text-white/65 group-hover:text-white/90 transition-colors leading-tight">{tpl.name}</span>
                </button>
              ))}
            </div>
          </SectionCard>

          {/* Section Blocks */}
          <SectionCard title="Verhaltens-Abschnitte" icon={IconMessageSquare}>
            <p className="text-xs text-white/40 mb-3">Aktiviere Abschnitte — jeder fügt einen Textblock zum Prompt hinzu. Nochmal klicken entfernt ihn.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-5">
              {PROMPT_SECTIONS.map((sec) => {
                const isActive = activePromptSections.has(sec.id);
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => togglePromptSection(sec.id)}
                    className={`group flex items-start gap-2.5 p-3 rounded-xl border transition-all text-left cursor-pointer ${
                      isActive
                        ? 'border-orange-500/35 bg-orange-500/[0.07]'
                        : 'border-white/[0.07] bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.06]'
                    }`}
                  >
                    <sec.Icon
                      size={13}
                      className={`shrink-0 mt-0.5 transition-colors ${isActive ? sec.accent : 'text-white/25 group-hover:text-white/45'}`}
                    />
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold leading-tight transition-colors ${isActive ? 'text-white' : 'text-white/55 group-hover:text-white/80'}`}>
                        {sec.label}
                      </p>
                      <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{sec.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Assembled Prompt */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Prompt</span>
                {activePromptSections.size > 0 && (
                  <span className="text-[10px] text-orange-400/70 bg-orange-500/10 border border-orange-500/15 px-2 py-0.5 rounded-full">
                    {activePromptSections.size} Abschnitt{activePromptSections.size !== 1 ? 'e' : ''} aktiv
                  </span>
                )}
              </div>
              <TextArea
                rows={10}
                value={config.systemPrompt}
                onChange={(e) => update({ systemPrompt: e.target.value })}
                placeholder="Aktiviere Abschnitte oben oder schreibe deinen Prompt direkt hier…"
              />
            </div>

            <div className="mt-4">
              <span className="text-xs font-medium text-white/40 uppercase tracking-wider block mb-2">Aktive Tools</span>
              <div className="flex flex-wrap gap-2">
                {KNOWN_TOOLS.map((tool) => (
                  <label key={tool} className="flex items-center gap-2 text-xs cursor-pointer select-none text-white/55">
                    <input type="checkbox" checked={config.tools.includes(tool)}
                      onChange={(e) => {
                        const next = new Set(config.tools);
                        e.target.checked ? next.add(tool) : next.delete(tool);
                        update({ tools: Array.from(next) });
                      }}
                      className="rounded border-white/20 bg-white/5 text-orange-500 focus:ring-orange-500/50" />
                    <code className="text-[11px] bg-white/[0.07] text-white/50 px-2 py-0.5 rounded">{tool}</code>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <Toggle checked={config.fallback.enabled}
                onChange={(v) => update({ fallback: { ...config.fallback, enabled: v } })}
                label="Fallback / Handoff aktiv" />
              {config.fallback.enabled && (
                <Input value={config.fallback.reason}
                  onChange={(e) => update({ fallback: { ...config.fallback, reason: e.target.value } })}
                  placeholder="Grund" className="!w-48" />
              )}
            </div>
          </SectionCard>
        </>
      )}

      {/* ────────────────────── CAPABILITIES ────────────────────── */}
      {tab === 'capabilities' && (
        <>
          {/* Call Routing Rules */}
          <SectionCard title="Rufweiterleitung & Gesprächslogik" icon={IconPhoneOut}>
            <p className="text-sm text-white/50 mb-4">
              Definiere Regeln in natürlicher Sprache — der Agent erkennt die Situation und handelt automatisch.
            </p>
            <CallRoutingEditor
              items={config.callRoutingRules ?? []}
              onChange={(items) => update({ callRoutingRules: items })}
            />
          </SectionCard>

          {/* Calendar Integrations */}
          <SectionCard title="Kalender-Anbindung" icon={IconCalendar}>
            <p className="text-sm text-white/50 mb-4">
              Verbinde einen Kalender, damit dein Agent Termine prüfen und buchen kann.
            </p>
            <CalendarConnector
              integrations={config.calendarIntegrations ?? []}
              onChange={(items) => update({ calendarIntegrations: items })}
            />
          </SectionCard>

          {/* API Integrations */}
          <SectionCard title="API-Integrationen" icon={IconPlug}>
            <p className="text-sm text-white/50 mb-4">
              Verbinde externe Systeme (CRM, ERP, Buchungssysteme) — dein Agent kann während des Gesprächs darauf zugreifen.
            </p>
            <ApiIntegrationEditor
              items={config.apiIntegrations ?? []}
              onChange={(items) => update({ apiIntegrations: items })}
            />
          </SectionCard>

          {/* Live Web Access */}
          <SectionCard title="Live Website-Zugriff" icon={IconGlobe}>
            <p className="text-sm text-white/50 mb-4">
              Erlaube deinem Agent, während des Gesprächs aktuelle Infos von Webseiten abzurufen (z.B. Preise, Verfügbarkeit).
            </p>
            <LiveWebAccessEditor
              config={config.liveWebAccess ?? { enabled: false, allowedDomains: [] }}
              onChange={(v) => update({ liveWebAccess: v })}
            />
          </SectionCard>
        </>
      )}

      {/* ────────────────────── TECHNICAL ────────────────────── */}
      {tab === 'technical' && (
        <>
          <SectionCard title="Stimme & Geschwindigkeit" icon={IconMic}>
            <div className="space-y-5">
              <Slider value={config.speakingSpeed ?? 1.0} onChange={(v) => update({ speakingSpeed: v })}
                min={0.5} max={2.0} step={0.1}
                label="Sprechgeschwindigkeit" displayValue={`${(config.speakingSpeed ?? 1.0).toFixed(1)}x`} />

              <Slider value={config.temperature ?? 0.7} onChange={(v) => update({ temperature: v })}
                min={0} max={1} step={0.05}
                label="Kreativität (Temperature)" displayValue={(config.temperature ?? 0.7).toFixed(2)} />

              <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
                <strong>Niedrig</strong> = konsistenter & faktisch · <strong>Hoch</strong> = kreativer & spontaner
              </div>

              <Slider value={config.maxCallDuration ?? 300} onChange={(v) => update({ maxCallDuration: v })}
                min={30} max={1800} step={30}
                label="Max. Anrufdauer" displayValue={`${Math.floor((config.maxCallDuration ?? 300) / 60)}:${String((config.maxCallDuration ?? 300) % 60).padStart(2, '0')} Min`} />
            </div>
          </SectionCard>

          <SectionCard title="Hintergrundgeräusche" icon={IconVolume}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {([
                { id: 'off',    Icon: IconPhoneOff,  label: 'Keine' },
                { id: 'office', Icon: IconBuilding,  label: 'Büro' },
                { id: 'cafe',   Icon: IconAgent,     label: 'Café' },
                { id: 'nature', Icon: IconGlobe,     label: 'Natur' },
              ] as const).map((bg) => (
                <button key={bg.id} onClick={() => update({ backgroundSound: bg.id })}
                  className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border transition-all cursor-pointer ${
                    config.backgroundSound === bg.id
                      ? 'border-orange-500/40 bg-orange-500/8 text-white'
                      : 'border-white/[0.07] bg-white/[0.03] text-white/40 hover:border-white/15 hover:text-white/70'
                  }`}>
                  <bg.Icon size={18} className={config.backgroundSound === bg.id ? 'text-orange-400' : ''} />
                  <span className="text-xs font-medium">{bg.label}</span>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Gesprächssteuerung" icon={IconSliders}>
            <div className="space-y-4">
              <Field label="Unterbrechungen">
                <Select value={config.interruptionMode ?? 'allow'}
                  onChange={(e) => update({ interruptionMode: e.target.value as AgentConfig['interruptionMode'] })}>
                  <option value="allow">Erlauben — Natürliches Gespräch</option>
                  <option value="hold">Kurz halten — Agent beendet Satz</option>
                  <option value="block">Blockieren — Agent spricht ohne Pause</option>
                </Select>
              </Field>

              <Toggle checked={config.enableDtmf ?? false}
                onChange={(v) => update({ enableDtmf: v })}
                label="DTMF-Eingabe (Tastentöne)" />
              {config.enableDtmf && (
                <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50 ml-14">
                  Anrufer können über die Telefontasten navigieren (z.B. „Drücken Sie 1 für Termine").
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Fachbegriffe" icon={IconBookOpen}>
            <p className="text-sm text-white/50 mb-3">
              Begriffe die die KI korrekt aussprechen und verstehen soll (Produktnamen, Fachausdrücke, Fremdwörter).
            </p>
            <VocabularyEditor
              items={config.customVocabulary ?? []}
              onChange={(items) => update({ customVocabulary: items })}
            />
          </SectionCard>
        </>
      )}

      {/* ────────────────────── PRIVACY ────────────────────── */}
      {tab === 'privacy' && (
        <SectionCard title="Aufzeichnung & Datenschutz" icon={IconPrivacy}>
          <div className="space-y-6">
            <Toggle checked={config.recordCalls ?? false}
              onChange={(v) => update({ recordCalls: v })}
              label="Anrufe aufzeichnen" />
            {config.recordCalls && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-sm text-yellow-300 ml-14">
                Stelle sicher, dass Anrufer zu Beginn über die Aufzeichnung informiert werden (DSGVO).
              </div>
            )}

            <Field label="Gesprächsdaten aufbewahren">
              <Select value={String(config.dataRetentionDays ?? 30)}
                onChange={(e) => update({ dataRetentionDays: parseInt(e.target.value) })}>
                <option value="0">Nicht speichern (sofort löschen)</option>
                <option value="7">7 Tage</option>
                <option value="30">30 Tage</option>
                <option value="90">90 Tage</option>
                <option value="365">1 Jahr</option>
              </Select>
            </Field>

            <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
              Alle Daten werden verschlüsselt gespeichert und nach Ablauf automatisch gelöscht. DSGVO-konform.
            </div>
          </div>
        </SectionCard>
      )}

      {/* ────────────────────── WEBHOOKS & VARIABLES ────────────────────── */}
      {tab === 'webhooks' && (
        <>
          <SectionCard title="Variablen extrahieren" icon={IconFileText}>
            <p className="text-sm text-white/50 mb-4">
              Definiere welche Informationen der Agent automatisch aus Gesprächen extrahieren soll.
            </p>
            <VariableEditor
              items={config.extractedVariables ?? []}
              onChange={(items) => update({ extractedVariables: items })}
            />
          </SectionCard>

          <SectionCard title="Inbound Webhooks" icon={IconWebhook}>
            <p className="text-sm text-white/50 mb-4">
              Sende extrahierte Daten und Events automatisch an deine Systeme.
            </p>
            <WebhookEditor
              items={config.inboundWebhooks ?? []}
              onChange={(items) => update({ inboundWebhooks: items })}
            />
          </SectionCard>
        </>
      )}

      {/* ────────────────────── PREVIEW ────────────────────── */}
      {tab === 'preview' && (
        <div className="space-y-4">
          {!config.retellAgentId ? (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-10 text-center space-y-4">
              <IconDeploy size={36} className="mx-auto text-orange-400/30" />
              <div>
                <h3 className="text-sm font-semibold text-white/80">Agent noch nicht deployed</h3>
                <p className="text-xs text-white/35 mt-1">Speichere und deploye deinen Agent, um ihn zu testen.</p>
              </div>
              <button
                onClick={handleDeploy}
                disabled={deploying}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50 transition-all cursor-pointer hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
              >
                {deploying ? 'Deploying…' : <><IconDeploy size={13} />Jetzt deployen</>}
              </button>
            </div>
          ) : (
            <>
              {/* Agent identity strip */}
              <div className="flex items-center gap-3 px-1 min-w-0">
                <div className="w-8 h-8 shrink-0 rounded-xl bg-gradient-to-br from-orange-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center">
                  <IconAgent size={15} className="text-orange-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{config.name || 'Agent'}</p>
                  <p className="text-[11px] text-white/35 truncate">{config.businessName || ''}</p>
                </div>
                <span className="shrink-0 flex items-center gap-1.5 text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left: Live Call */}
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <IconMic size={14} className="text-orange-400 shrink-0" />
                    <span className="text-xs font-semibold text-white/70">Web-Call</span>
                  </div>
                  <p className="text-[11px] text-white/30 mb-4">Mikrofon erforderlich — sprich direkt mit dem Agenten.</p>
                  <WebCallWidget />
                </div>

                {/* Right: Voice + Details */}
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <IconMicUpload size={14} className="text-cyan-400 shrink-0" />
                      <span className="text-xs font-semibold text-white/70">Aktive Stimme</span>
                    </div>
                    <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] px-3 py-2.5 mt-2 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{config.voice || '—'}</p>
                      {(() => {
                        const v = voices.find(x => x.voice_id === config.voice);
                        return v ? (
                          <p className="text-[10px] text-white/35 mt-0.5 truncate">
                            {v.voice_name}{' · '}
                            {v.voice_type === 'cloned'
                              ? <span className="text-cyan-400">Eigene Stimme</span>
                              : <span>{v.provider ?? 'Built-in'}</span>}
                          </p>
                        ) : null;
                      })()}
                    </div>
                    <p className="text-[10px] text-white/25 mt-1.5">
                      Stimme ändern im Tab <span className="text-white/45">Identität</span>.
                    </p>
                  </div>

                  <div className="border-t border-white/[0.05] pt-4">
                    <button
                      onClick={() => getAgentPreview().then(setPreview)}
                      className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-orange-400 transition-colors cursor-pointer mb-3"
                    >
                      <IconRefresh size={12} /> Technische Vorschau laden
                    </button>
                    {preview && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-1.5">
                          {preview.tools.map((t) => (
                            <span key={t} className="text-[10px] bg-orange-500/15 text-orange-300/80 px-2 py-0.5 rounded font-mono">{t}</span>
                          ))}
                        </div>
                        <pre className="bg-black/30 text-white/50 text-[10px] p-3 rounded-lg overflow-auto max-h-40 whitespace-pre-wrap border border-white/[0.05] leading-relaxed">
                          {preview.instructions}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Sub-components                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

function KnowledgeAdder({ onAdd }: { onAdd: (src: KnowledgeSource) => void }) {
  const [mode, setMode] = useState<'url' | 'pdf' | 'text' | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [textName, setTextName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function addUrl() {
    if (!url.trim()) return;
    onAdd({
      id: crypto.randomUUID(),
      type: 'url',
      name: new URL(url).hostname,
      content: url.trim(),
      status: 'pending',
    });
    setUrl('');
    setMode(null);
  }

  function addPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onAdd({
      id: crypto.randomUUID(),
      type: 'pdf',
      name: file.name,
      content: file.name,
      status: 'pending',
    });
    setMode(null);
  }

  function addText() {
    if (!text.trim()) return;
    onAdd({
      id: crypto.randomUUID(),
      type: 'text',
      name: textName || 'Eigener Text',
      content: text.trim(),
      status: 'pending',
    });
    setText('');
    setTextName('');
    setMode(null);
  }

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setMode('url')}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/60 hover:border-orange-500/30 hover:text-white transition-all cursor-pointer">
          <IconGlobe size={13} className="text-white/40" /> Website-URL
        </button>
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/60 hover:border-orange-500/30 hover:text-white transition-all cursor-pointer">
          <IconFileText size={13} className="text-white/40" /> PDF hochladen
        </button>
        <button onClick={() => setMode('text')}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/60 hover:border-orange-500/30 hover:text-white transition-all cursor-pointer">
          <IconMessageSquare size={13} className="text-white/40" /> Eigener Text
        </button>
        <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={addPdf} />
      </div>
    );
  }

  if (mode === 'url') {
    return (
      <div className="flex gap-3">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meineseite.de/preise"
          className="flex-1" onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
        <button onClick={addUrl}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
          Hinzufügen
        </button>
        <button onClick={() => setMode(null)} className="text-white/40 hover:text-white/70 text-sm">Abbrechen</button>
      </div>
    );
  }

  if (mode === 'text') {
    return (
      <div className="space-y-3">
        <Input value={textName} onChange={(e) => setTextName(e.target.value)} placeholder="Name (z.B. Preisliste)" />
        <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dein Text hier…" />
        <div className="flex gap-3">
          <button onClick={addText}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
            Hinzufügen
          </button>
          <button onClick={() => setMode(null)} className="text-white/40 hover:text-white/70 text-sm">Abbrechen</button>
        </div>
      </div>
    );
  }

  return null;
}

function VocabularyEditor({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');

  function add() {
    const term = input.trim();
    if (!term || items.includes(term)) return;
    onChange([...items, term]);
    setInput('');
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.map((term, i) => (
          <span key={i} className="flex items-center gap-1.5 bg-white/10 text-white/80 text-sm px-3 py-1.5 rounded-full">
            {term}
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-white/30 hover:text-red-400 cursor-pointer transition-colors"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </span>
        ))}
        {items.length === 0 && <span className="text-sm text-white/30">Noch keine Begriffe hinzugefügt</span>}
      </div>
      <div className="flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="z.B. Balayage, Keratin, HVAC…"
          className="flex-1" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <button onClick={add}
          className="rounded-lg bg-white/10 border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/15 transition-colors">
          + Hinzufügen
        </button>
      </div>
    </div>
  );
}

function VariableEditor({ items, onChange }: { items: ExtractedVariable[]; onChange: (v: ExtractedVariable[]) => void }) {
  function add() {
    onChange([...items, { name: '', description: '', type: 'string', required: false }]);
  }

  function patch(i: number, p: Partial<ExtractedVariable>) {
    const next = [...items];
    next[i] = { ...next[i], ...p } as ExtractedVariable;
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  return (
    <div className="space-y-3">
      {items.map((v, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-center bg-white/5 rounded-xl px-4 py-3">
          <Input value={v.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Name (z.B. kundenname)" />
          <Input value={v.description} onChange={(e) => patch(i, { description: e.target.value })} placeholder="Beschreibung" />
          <select value={v.type} onChange={(e) => patch(i, { type: e.target.value as ExtractedVariable['type'] })}
            className="rounded-lg border border-white/10 bg-[#0F0F18] px-2 py-2 text-sm text-white text-center">
            <option value="string">Text</option>
            <option value="number">Zahl</option>
            <option value="boolean">Ja/Nein</option>
            <option value="date">Datum</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-white/50 cursor-pointer">
            <input type="checkbox" checked={v.required} onChange={(e) => patch(i, { required: e.target.checked })}
              className="rounded border-white/20 bg-white/5" />
            Pflicht
          </label>
          <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      ))}
      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + Variable hinzufügen
      </button>
    </div>
  );
}

function WebhookEditor({ items, onChange }: { items: InboundWebhook[]; onChange: (v: InboundWebhook[]) => void }) {
  function add() {
    onChange([...items, {
      id: crypto.randomUUID(),
      name: '',
      url: '',
      events: ['call.ended'],
      enabled: true,
    }]);
  }

  function patch(i: number, p: Partial<InboundWebhook>) {
    const next = [...items];
    next[i] = { ...next[i], ...p } as InboundWebhook;
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  const EVENT_OPTIONS = ['call.started', 'call.ended', 'ticket.created', 'variable.extracted'];

  return (
    <div className="space-y-3">
      {items.map((wh, i) => (
        <div key={wh.id} className="bg-white/5 rounded-xl px-4 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <Toggle checked={wh.enabled} onChange={(v) => patch(i, { enabled: v })} label="" />
            <Input value={wh.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Name (z.B. CRM Webhook)" className="flex-1" />
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
          <Input value={wh.url} onChange={(e) => patch(i, { url: e.target.value })} placeholder="https://mein-crm.de/api/webhook" />
          <div>
            <span className="text-xs text-white/50">Events:</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {EVENT_OPTIONS.map((evt) => (
                <label key={evt} className="flex items-center gap-1.5 text-xs cursor-pointer text-white/60">
                  <input type="checkbox" checked={wh.events.includes(evt)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...wh.events, evt] : wh.events.filter((x) => x !== evt);
                      patch(i, { events: next });
                    }}
                    className="rounded border-white/20 bg-white/5 text-orange-500" />
                  <code className="bg-white/10 px-1.5 py-0.5 rounded">{evt}</code>
                </label>
              ))}
            </div>
          </div>
        </div>
      ))}
      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + Webhook hinzufügen
      </button>
    </div>
  );
}

/* ── Call Routing Rules ── */

const ROUTING_EXAMPLES = [
  'Wenn der Kunde nach einer Reklamation fragt → Weiterleiten an Reklamationsabteilung',
  'Wenn der Anrufer "Notfall" sagt → Sofort weiterleiten an +49 170 1234567',
  'Wenn der Kunde 3x nach einem Mitarbeiter fragt → Weiterleiten an Zentrale',
  'Wenn der Anrufer nichts sagt nach 10 Sekunden → Höflich auflegen',
  'Wenn die Anfrage medizinisch dringend ist → Ticket erstellen mit Priorität Hoch',
];

function CallRoutingEditor({ items, onChange }: { items: CallRoutingRule[]; onChange: (v: CallRoutingRule[]) => void }) {
  function add() {
    onChange([...items, {
      id: crypto.randomUUID(),
      description: '',
      action: 'transfer',
      target: '',
      enabled: true,
    }]);
  }

  function patch(i: number, p: Partial<CallRoutingRule>) {
    const next = [...items];
    next[i] = { ...next[i], ...p } as CallRoutingRule;
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  const ACTION_OPTIONS: { id: CallRoutingRule['action']; label: string; Icon: SectionIconComp }[] = [
    { id: 'transfer',  label: 'Weiterleiten',    Icon: IconPhoneOut },
    { id: 'hangup',    label: 'Auflegen',         Icon: IconPhoneOff },
    { id: 'voicemail', label: 'Mailbox',          Icon: IconMicUpload },
    { id: 'ticket',    label: 'Ticket',           Icon: IconTicket },
  ];

  return (
    <div className="space-y-3">
      {/* Examples hint */}
      {items.length === 0 && (
        <div className="bg-white/5 rounded-xl p-4 space-y-2">
          <span className="text-xs font-medium text-white/40">Beispiele:</span>
          <div className="space-y-1">
            {ROUTING_EXAMPLES.slice(0, 3).map((ex, i) => (
              <button key={i} onClick={() => {
                const parts = ex.split(' → ');
                onChange([...items, {
                  id: crypto.randomUUID(),
                  description: parts[0] ?? '',
                  action: ex.includes('auflegen') ? 'hangup' as const : ex.includes('Ticket') ? 'ticket' as const : 'transfer' as const,
                  target: parts[1] ?? '',
                  enabled: true,
                }]);
              }}
                className="block w-full text-left text-xs text-white/40 hover:text-orange-300 transition-colors py-1 px-2 rounded hover:bg-white/5">
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {items.map((rule, i) => (
        <div key={rule.id} className="bg-white/5 rounded-xl px-4 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <Toggle checked={rule.enabled} onChange={(v) => patch(i, { enabled: v })} label="" />
            <div className="flex-1 space-y-3">
              <textarea
                value={rule.description}
                onChange={(e) => patch(i, { description: e.target.value })}
                placeholder="Beschreibe die Situation in natürlicher Sprache… z.B. 'Wenn der Kunde nach dem Geschäftsführer fragt'"
                rows={2}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none resize-y"
              />
              <div className="flex gap-3 items-center">
                <span className="text-xs text-white/50 shrink-0">Dann →</span>
                <div className="flex gap-2">
                  {ACTION_OPTIONS.map((act) => (
                    <button key={act.id} onClick={() => patch(i, { action: act.id })}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        rule.action === act.id
                          ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                          : 'bg-white/5 text-white/50 border border-white/10 hover:border-white/20'
                      }`}>
                      <act.Icon size={12} /> {act.label}
                    </button>
                  ))}
                </div>
              </div>
              {(rule.action === 'transfer') && (
                <input
                  value={rule.target ?? ''}
                  onChange={(e) => patch(i, { target: e.target.value })}
                  placeholder="Ziel: Telefonnummer oder Abteilung (z.B. +49 170 1234567 oder 'Vertrieb')"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none"
                />
              )}
            </div>
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer mt-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>
      ))}

      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + Neue Regel hinzufügen
      </button>
    </div>
  );
}

/* ── Calendar Connector ── */

const CALENDAR_PROVIDERS: { id: 'google' | 'outlook' | 'calcom' | 'caldav'; Icon: SectionIconComp; name: string; desc: string }[] = [
  { id: 'google',  Icon: IconCalendar,  name: 'Google Calendar',     desc: 'Verbinde dein Google-Konto' },
  { id: 'outlook', Icon: IconBookOpen,  name: 'Microsoft Outlook',   desc: 'Outlook / Microsoft 365' },
  { id: 'calcom',  Icon: IconCheckCircle, name: 'Cal.com',           desc: 'Open-Source Terminbuchung' },
  { id: 'caldav',  Icon: IconWebhook,   name: 'CalDAV',              desc: 'Nextcloud, iCloud, etc.' },
];

function CalendarConnector({ integrations, onChange }: {
  integrations: AgentConfig['calendarIntegrations'] & {};
  onChange: (v: NonNullable<AgentConfig['calendarIntegrations']>) => void;
}) {
  const connected = integrations?.filter((c) => c.connected) ?? [];

  function connect(provider: typeof CALENDAR_PROVIDERS[number]['id']) {
    // In production this would open OAuth flow — here we add a placeholder
    const existing = integrations ?? [];
    if (existing.find((c) => c.provider === provider)) return;
    onChange([...existing, {
      provider,
      connected: false,
      label: CALENDAR_PROVIDERS.find((p) => p.id === provider)?.name ?? provider,
    }]);
  }

  function disconnect(provider: string) {
    onChange((integrations ?? []).filter((c) => c.provider !== provider));
  }

  return (
    <div className="space-y-4">
      {/* Connected calendars */}
      {connected.length > 0 && (
        <div className="space-y-2 mb-2">
          {connected.map((cal) => (
            <div key={cal.provider} className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
              {(() => { const P = CALENDAR_PROVIDERS.find((p) => p.id === cal.provider); return P ? <P.Icon size={16} className="text-green-400 shrink-0" /> : null; })()}
              <div className="flex-1">
                <p className="text-sm text-white font-medium">{cal.label ?? cal.provider}</p>
                {cal.email && <p className="text-xs text-white/40">{cal.email}</p>}
              </div>
              <span className="flex items-center gap-1 text-xs text-green-400 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />Verbunden</span>
              <button onClick={() => disconnect(cal.provider)} className="text-white/30 hover:text-red-400 text-sm">Trennen</button>
            </div>
          ))}
        </div>
      )}

      {/* Provider grid */}
      <div className="grid grid-cols-2 gap-3">
        {CALENDAR_PROVIDERS.map((prov) => {
          const isConnected = (integrations ?? []).find((c) => c.provider === prov.id);
          return (
            <button key={prov.id} onClick={() => !isConnected && connect(prov.id)}
              disabled={!!isConnected}
              className={`flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                isConnected
                  ? 'border-green-500/20 bg-green-500/5 opacity-60 cursor-default'
                  : 'border-white/10 bg-white/5 hover:border-orange-500/40 hover:bg-white/10 cursor-pointer'
              }`}>
              <prov.Icon size={18} className="text-white/50 shrink-0" />
              <div>
                <p className="text-sm font-medium text-white">{prov.name}</p>
                <p className="text-xs text-white/40">{isConnected ? 'Bereits verbunden' : prov.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
        Nach der Verbindung kann dein Agent freie Termine prüfen, Buchungen erstellen und Kalender-Konflikte erkennen.
      </div>
    </div>
  );
}

/* ── API Integration Editor ── */

function ApiIntegrationEditor({ items, onChange }: { items: ApiIntegration[]; onChange: (v: ApiIntegration[]) => void }) {
  function add() {
    onChange([...items, {
      id: crypto.randomUUID(),
      name: '',
      type: 'rest',
      baseUrl: '',
      authType: 'none',
      description: '',
      enabled: true,
    }]);
  }

  function patch(i: number, p: Partial<ApiIntegration>) {
    const next = [...items];
    next[i] = { ...next[i], ...p } as ApiIntegration;
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  return (
    <div className="space-y-3">
      {items.map((api, i) => (
        <div key={api.id} className="bg-white/5 rounded-xl px-4 py-4 space-y-3">
          <div className="flex items-center gap-3">
            <Toggle checked={api.enabled} onChange={(v) => patch(i, { enabled: v })} label="" />
            <input value={api.name} onChange={(e) => patch(i, { name: e.target.value })}
              placeholder="Name (z.B. CRM, Buchungssystem)"
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none" />
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>

          <input value={api.baseUrl} onChange={(e) => patch(i, { baseUrl: e.target.value })}
            placeholder="https://api.mein-system.de/v1"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none" />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-white/50">Typ</span>
              <select value={api.type} onChange={(e) => patch(i, { type: e.target.value as ApiIntegration['type'] })}
                className="w-full mt-1 rounded-lg border border-white/10 bg-[#0F0F18] px-3 py-2 text-sm text-white outline-none">
                <option value="rest">REST API</option>
                <option value="webhook">Webhook</option>
                <option value="zapier">Zapier / Make</option>
              </select>
            </div>
            <div>
              <span className="text-xs text-white/50">Authentifizierung</span>
              <select value={api.authType} onChange={(e) => patch(i, { authType: e.target.value as ApiIntegration['authType'] })}
                className="w-full mt-1 rounded-lg border border-white/10 bg-[#0F0F18] px-3 py-2 text-sm text-white outline-none">
                <option value="none">Keine</option>
                <option value="apikey">API Key</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
              </select>
            </div>
          </div>

          {api.authType !== 'none' && (
            <input value={api.authValue ?? ''} onChange={(e) => patch(i, { authValue: e.target.value })}
              type="password"
              placeholder={api.authType === 'apikey' ? 'API Key' : api.authType === 'bearer' ? 'Bearer Token' : 'user:password'}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none" />
          )}

          <textarea value={api.description} onChange={(e) => patch(i, { description: e.target.value })}
            placeholder="Wofür soll der Agent diese API nutzen? z.B. 'Kundendaten abrufen und Bestellstatus prüfen'"
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none resize-y" />
        </div>
      ))}

      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + API-Integration hinzufügen
      </button>

      <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
        Dein Agent kann während des Gesprächs Daten abrufen und senden — z.B. Kundenstatus prüfen, Bestellungen anlegen oder CRM-Einträge erstellen.
      </div>
    </div>
  );
}

/* ── Voice Dropdown ── */

function getProviderLabel(voice: Voice): string {
  if (voice.voice_type === 'cloned') return 'Eigene Stimme';
  const provider = voice.provider ?? voice.voice_id.split('-')[0] ?? 'Retell';
  const map: Record<string, string> = {
    retell: 'Retell',
    openai: 'OpenAI',
    '11labs': 'ElevenLabs',
    elevenlabs: 'ElevenLabs',
    cartesia: 'Cartesia',
    minimax: 'Minimax',
    deepgram: 'Deepgram',
  };
  return map[provider.toLowerCase()] ?? provider;
}

function VoiceDropdown({
  voices,
  loading,
  currentVoiceId,
  dropdownOpen,
  dropdownRef,
  onOpenToggle,
  onSelect,
}: {
  voices: Voice[];
  loading: boolean;
  currentVoiceId: string;
  dropdownOpen: boolean;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  onOpenToggle: () => void;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Auto-focus search when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [dropdownOpen]);

  const currentVoice = voices.find((v) => v.voice_id === currentVoiceId);
  const displayLabel = currentVoice
    ? `${currentVoice.voice_name} (${getProviderLabel(currentVoice)})`
    : currentVoiceId;

  const searchLower = search.toLowerCase();

  // Group voices: cloned first, then by provider
  const cloned = voices.filter((v) => v.voice_type === 'cloned' && (!search || v.voice_name.toLowerCase().includes(searchLower)));
  const builtIn = voices.filter((v) => v.voice_type !== 'cloned' && (!search || v.voice_name.toLowerCase().includes(searchLower) || (v.accent ?? '').toLowerCase().includes(searchLower) || (v.provider ?? '').toLowerCase().includes(searchLower)));

  // Group built-in by provider
  const providerGroups: Record<string, Voice[]> = {};
  for (const v of builtIn) {
    const prov = getProviderLabel(v);
    if (!providerGroups[prov]) providerGroups[prov] = [];
    providerGroups[prov].push(v);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={onOpenToggle}
        className="w-full flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-orange-500/50 outline-none"
      >
        <span className="truncate">{loading ? 'Stimmen werden geladen…' : displayLabel}</span>
        <IconChevronDown size={16} className="ml-2 text-white/40 shrink-0" />
      </button>
      {dropdownOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-white/10 bg-[#0F0F18] shadow-xl max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}>
          {/* Search */}
          <div className="sticky top-0 bg-[#0F0F18] border-b border-white/5 p-2 z-10">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Stimme suchen…"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {/* Custom (cloned) voices */}
          {cloned.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-4 py-2 bg-cyan-500/5 border-b border-white/5">
                <IconStar size={12} className="text-cyan-400" />
                <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wide">Eigene Stimmen</span>
              </div>
              {cloned.map((v) => (
                <button
                  key={v.voice_id}
                  type="button"
                  onClick={() => onSelect(v.voice_id)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-left ${
                    currentVoiceId === v.voice_id ? 'text-cyan-300 bg-cyan-500/10' : 'text-white/80'
                  }`}
                >
                  <span>{v.voice_name}</span>
                  <span className="text-xs text-cyan-400/60 bg-cyan-500/10 px-1.5 py-0.5 rounded shrink-0">Eigene</span>
                </button>
              ))}
            </>
          )}

          {/* Built-in voices grouped by provider */}
          {Object.entries(providerGroups).map(([provider, provVoices]) => (
            <React.Fragment key={provider}>
              <div className="px-4 py-1.5 bg-white/3 border-b border-t border-white/5">
                <span className="text-xs font-semibold text-white/40 uppercase tracking-wide">{provider}</span>
              </div>
              {provVoices.map((v) => (
                <button
                  key={v.voice_id}
                  type="button"
                  onClick={() => onSelect(v.voice_id)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-left ${
                    currentVoiceId === v.voice_id ? 'text-orange-300 bg-orange-500/10' : 'text-white/80'
                  }`}
                >
                  <span>{v.voice_name}</span>
                  <span className="text-xs text-white/30">{v.accent ?? v.gender ?? ''}</span>
                </button>
              ))}
            </React.Fragment>
          ))}

          {/* No search results */}
          {search && cloned.length === 0 && Object.keys(providerGroups).length === 0 && (
            <div className="px-4 py-6 text-sm text-white/40 text-center">
              Keine Stimmen für „{search}" gefunden.
            </div>
          )}

          {/* Fallback: no voices loaded yet */}
          {voices.length === 0 && !loading && !search && (
            <div className="px-4 py-4 text-sm text-white/40 text-center">
              Keine Stimmen geladen. Prüfe deine Retell API-Verbindung.
            </div>
          )}
          {loading && (
            <div className="px-4 py-4 text-sm text-white/40 text-center">Stimmen werden geladen…</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Voice Clone Panel ── */

const VOICE_PROVIDERS = [
  { value: 'elevenlabs', label: 'ElevenLabs (empfohlen)' },
  { value: 'cartesia', label: 'Cartesia' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'fish_audio', label: 'Fish Audio' },
] as const;

function VoiceClonePanel({ onVoiceCloned }: { onVoiceCloned: (voice: Voice) => void }) {
  const [mode, setMode] = useState<'idle' | 'upload' | 'record'>('idle');
  const [provider, setProvider] = useState('elevenlabs');

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Record state
  const [recordName, setRecordName] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Convert any audio blob (webm, ogg, etc.) → WAV (PCM 16-bit mono)
  async function blobToWavFile(blob: Blob, filename = 'recording.wav'): Promise<File> {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    await audioCtx.close();

    const numChannels = 1; // mono
    const sampleRate = audioBuffer.sampleRate;
    const samples = audioBuffer.getChannelData(0);
    const dataLen = samples.length * 2;
    const buf = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buf);

    function writeStr(offset: number, str: string) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataLen, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byteRate
    view.setUint16(32, 2, true); // blockAlign
    view.setUint16(34, 16, true); // bitsPerSample
    writeStr(36, 'data');
    view.setUint32(40, dataLen, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }

    return new File([buf], filename, { type: 'audio/wav' });
  }

  function stopLevelMonitor() {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    analyserRef.current = null;
  }

  function startLevelMonitor(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      function tick() {
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        setLevel(Math.min(1, avg / 60));
        animFrameRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch {
      // AudioContext not available — ignore
    }
  }

  async function startRecording() {
    setRecordError(null);
    setRecordedBlob(null);
    setRecordSeconds(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startLevelMonitor(stream);
      // Pick the best supported mimeType (prefer webm, fall back to ogg/mp4)
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4']
        .find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setRecordedBlob(blob);
        stopLevelMonitor();
        setLevel(0);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      mr.start();
      setRecording(true);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      setRecordError('Mikrofon konnte nicht geöffnet werden. Bitte Berechtigungen prüfen.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function handleUploadClone() {
    if (!uploadFile || !uploadName.trim()) return;
    setUploading(true);
    setUploadError(null);
    try {
      const voice = await cloneVoice(uploadName.trim(), uploadFile, provider);
      onVoiceCloned(voice);
      setUploadFile(null);
      setUploadName('');
      setMode('idle');
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

  async function handleRecordClone() {
    if (!recordedBlob || !recordName.trim()) return;
    setUploading(true);
    setRecordError(null);
    try {
      const file = await blobToWavFile(recordedBlob, 'recording.wav');
      const voice = await cloneVoice(recordName.trim(), file, provider);
      onVoiceCloned(voice);
      setRecordedBlob(null);
      setRecordName('');
      setRecordSeconds(0);
      setMode('idle');
    } catch (e) {
      setRecordError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

  function fmtTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return (
    <section className="glass rounded-2xl p-6 mb-6">
      <div className="flex items-center gap-3 mb-1">
        <IconMicUpload size={20} className="text-cyan-400" />
        <h3 className="text-lg font-semibold text-white">Eigene Stimme klonen</h3>
      </div>
      <p className="text-sm text-white/50 mb-4">
        Lade eine Aufnahme hoch oder nimm direkt auf — Phonbot klont deine Stimme via Retell Voice Cloning.
        Mindestlänge: 30 Sekunden.
      </p>

      {/* Provider selector — always visible when not idle */}
      {mode !== 'idle' && (
        <div className="mb-3">
          <label className="block text-xs text-white/40 mb-1.5">Voice Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            {VOICE_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className="text-xs text-white/30 mt-1">ElevenLabs unterstützt bis zu 25 Audiodateien · Cartesia & MiniMax nur 1 Datei</p>
        </div>
      )}

      {mode === 'idle' && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setMode('upload')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 hover:border-cyan-500/40 hover:text-white transition-all"
          >
            <IconMicUpload size={16} className="text-cyan-400" />
            Datei hochladen
          </button>
          <button
            type="button"
            onClick={() => setMode('record')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 hover:border-orange-500/40 hover:text-white transition-all"
          >
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
            Stimme aufnehmen
          </button>
        </div>
      )}

      {mode === 'upload' && (
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            className="hidden"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 hover:border-cyan-500/40 hover:text-white transition-all"
            >
              <IconMicUpload size={16} className="text-cyan-400" />
              {uploadFile ? uploadFile.name : 'Datei auswählen (MP3/WAV)'}
            </button>
            {uploadFile && (
              <span className="self-center text-xs text-white/40">
                {(uploadFile.size / 1024 / 1024).toFixed(1)} MB
              </span>
            )}
          </div>
          <div>
            <label className="text-sm text-white/60 block mb-1">Name der Stimme</label>
            <input
              type="text"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="z.B. Meine Stimme"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
            />
          </div>
          {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleUploadClone}
              disabled={!uploadFile || !uploadName.trim() || uploading}
              className="rounded-lg bg-gradient-to-r from-cyan-500 to-orange-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {uploading ? 'Wird hochgeladen…' : 'Stimme klonen'}
            </button>
            <button type="button" onClick={() => { setMode('idle'); setUploadFile(null); setUploadError(null); }}
              className="text-sm text-white/40 hover:text-white/70">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {mode === 'record' && (
        <div className="space-y-3">
          {/* Waveform / level indicator */}
          <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
            <div className="flex items-end gap-0.5 h-8">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-sm transition-all duration-75"
                  style={{
                    height: recording
                      ? `${Math.max(4, Math.round(level * 32 * (0.5 + Math.random() * 0.5)))}px`
                      : '4px',
                    backgroundColor: recording ? '#22d3ee' : '#ffffff20',
                  }}
                />
              ))}
            </div>
            <span className="text-sm font-mono text-white/60">{fmtTime(recordSeconds)}</span>
            {recordedBlob && !recording && (
              <span className="text-xs text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full">
                Aufnahme bereit
              </span>
            )}
          </div>

          <div className="flex gap-3">
            {!recording && !recordedBlob && (
              <button
                type="button"
                onClick={startRecording}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300 hover:bg-red-500/30 transition-all"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                Aufnahme starten
              </button>
            )}
            {recording && (
              <button
                type="button"
                onClick={stopRecording}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/30 border border-red-500/50 text-sm text-red-200 hover:bg-red-500/40 transition-all animate-pulse"
              >
                <span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />
                Aufnahme stoppen
              </button>
            )}
            {recordedBlob && !recording && (
              <button
                type="button"
                onClick={() => { setRecordedBlob(null); setRecordSeconds(0); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white/50 hover:text-white transition-all"
              >
                <IconRefresh size={14} />
                Neu aufnehmen
              </button>
            )}
          </div>

          {recordedBlob && !recording && (
            <>
              <div>
                <label className="text-sm text-white/60 block mb-1">Name der Stimme</label>
                <input
                  type="text"
                  value={recordName}
                  onChange={(e) => setRecordName(e.target.value)}
                  placeholder="z.B. Meine Stimme"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
                />
              </div>
              {recordError && <p className="text-xs text-red-400">{recordError}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleRecordClone}
                  disabled={!recordName.trim() || uploading}
                  className="rounded-lg bg-gradient-to-r from-cyan-500 to-orange-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {uploading ? 'Wird hochgeladen…' : 'Stimme klonen'}
                </button>
                <button type="button" onClick={() => { setMode('idle'); setRecordedBlob(null); setRecordError(null); setRecordSeconds(0); }}
                  className="text-sm text-white/40 hover:text-white/70">
                  Abbrechen
                </button>
              </div>
            </>
          )}

          {!recordedBlob && !recording && (
            <button type="button" onClick={() => setMode('idle')}
              className="text-sm text-white/40 hover:text-white/70">
              Abbrechen
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Live Web Access ── */

function LiveWebAccessEditor({ config, onChange }: { config: LiveWebAccess; onChange: (v: LiveWebAccess) => void }) {
  const [domainInput, setDomainInput] = useState('');

  function addDomain() {
    const domain = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || config.allowedDomains.includes(domain)) return;
    onChange({ ...config, allowedDomains: [...config.allowedDomains, domain] });
    setDomainInput('');
  }

  return (
    <div className="space-y-4">
      <Toggle checked={config.enabled} onChange={(v) => onChange({ ...config, enabled: v })}
        label="Live-Zugriff auf Webseiten aktivieren" />

      {config.enabled && (
        <>
          <div>
            <span className="text-sm font-medium text-white/70 block mb-2">Erlaubte Domains</span>
            <div className="flex flex-wrap gap-2 mb-3">
              {config.allowedDomains.map((domain, i) => (
                <span key={i} className="flex items-center gap-1.5 bg-white/10 text-white/80 text-sm px-3 py-1.5 rounded-full">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-white/40 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
                  {domain}
                  <button onClick={() => onChange({
                    ...config,
                    allowedDomains: config.allowedDomains.filter((_, j) => j !== i),
                  })} className="text-white/30 hover:text-red-400 cursor-pointer transition-colors"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </span>
              ))}
              {config.allowedDomains.length === 0 && (
                <span className="text-sm text-white/30">Keine Domains — Agent hat keinen Webzugriff</span>
              )}
            </div>
            <div className="flex gap-2">
              <input value={domainInput} onChange={(e) => setDomainInput(e.target.value)}
                placeholder="z.B. meine-firma.de"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain())} />
              <button onClick={addDomain}
                className="rounded-lg bg-white/10 border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/15 transition-colors">
                + Hinzufügen
              </button>
            </div>
          </div>

          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3 text-xs text-orange-300">
            Der Agent kann aktuelle Preise, Produktinfos oder Verfügbarkeiten direkt von deiner Website lesen — in Echtzeit während des Gesprächs.
          </div>
        </>
      )}
    </div>
  );
}
