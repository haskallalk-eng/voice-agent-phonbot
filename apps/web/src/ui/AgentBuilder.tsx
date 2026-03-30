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
import { WebCallWidget } from './WebCallWidget.js';
import { FoxLogo } from './FoxLogo.js';
import {
  IconAgent,
  IconKnowledge,
  IconTest,
  IconCapabilities,
  IconSettings,
  IconPrivacy,
  IconWebhook,
  IconPlay,
  IconDeploy,
  IconMicUpload,
  IconChevronDown,
  IconRefresh,
  IconStar,
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
const PROMPT_TEMPLATES = [
  {
    id: 'reception',
    icon: '🏢',
    name: 'Empfang / Zentrale',
    prompt: `Du bist die freundliche Telefonzentrale von {businessName}. Begrüße Anrufer herzlich, finde heraus worum es geht und leite sie an die richtige Stelle weiter. Bei Unklarheiten erstelle ein Ticket.`,
  },
  {
    id: 'appointment',
    icon: '📅',
    name: 'Terminbuchung',
    prompt: `Du bist der Terminassistent von {businessName}. Hilf dem Anrufer einen passenden Termin zu finden und zu buchen. Frage nach gewünschtem Datum, Uhrzeit und Service. Bestätige den Termin am Ende.`,
  },
  {
    id: 'support',
    icon: '🛠️',
    name: 'Kundensupport',
    prompt: `Du bist der Support-Assistent von {businessName}. Höre dem Kunden aufmerksam zu, versuche das Problem zu lösen und erstelle bei Bedarf ein Ticket mit allen Details für das Team.`,
  },
  {
    id: 'orders',
    icon: '🍕',
    name: 'Bestellannahme',
    prompt: `Du bist der Bestellassistent von {businessName}. Nimm Bestellungen entgegen, frage nach Details (Menge, Sonderwünsche) und bestätige die Bestellung mit geschätzter Lieferzeit.`,
  },
  {
    id: 'emergency',
    icon: '🚨',
    name: 'Notdienst / After-Hours',
    prompt: `Du bist der Notdienst-Assistent von {businessName}. Außerhalb der Öffnungszeiten nimmst du dringende Anfragen entgegen, sammelst Kontaktdaten und erstellst ein priorisiertes Ticket.`,
  },
  {
    id: 'info',
    icon: 'ℹ️',
    name: 'Auskunft & FAQ',
    prompt: `Du bist der Informationsassistent von {businessName}. Beantworte häufige Fragen zu Öffnungszeiten, Preisen, Services und Standort. Nutze das hinterlegte Wissen für genaue Antworten.`,
  },
];

/* ── Small UI Components ── */

function SectionCard({ title, icon, children, collapsible = false, className = '' }: {
  title: string; icon: string; children: React.ReactNode; collapsible?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`glass rounded-2xl p-6 mb-6 ${className}`}>
      <button
        type="button"
        onClick={() => collapsible && setOpen(!open)}
        className={`flex items-center gap-2 w-full text-left ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="text-xl">{icon}</span>
        <h3 className="text-lg font-semibold text-white flex-1">{title}</h3>
        {collapsible && (
          <span className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        )}
      </button>
      {open && <div className="mt-4">{children}</div>}
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

const TABS: { id: Tab; label: string }[] = [
  { id: 'identity', label: 'Identität' },
  { id: 'knowledge', label: 'Wissen' },
  { id: 'behavior', label: 'Verhalten' },
  { id: 'capabilities', label: 'Fähigkeiten' },
  { id: 'technical', label: 'Technik' },
  { id: 'privacy', label: 'Datenschutz' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'preview', label: 'Vorschau' },
];

type IconComp = React.FC<{ size?: number; className?: string }>;
const TAB_ICONS: Record<Tab, IconComp> = {
  identity: IconAgent,
  knowledge: IconKnowledge,
  behavior: IconTest,
  capabilities: IconCapabilities,
  technical: IconSettings,
  privacy: IconPrivacy,
  webhooks: IconWebhook,
  preview: IconPlay,
};

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
      await saveAgentConfig(config);
      const prev = await getAgentPreview();
      setPreview(prev);
      setStatus({ type: 'ok', text: 'Gespeichert ✅' });
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
      setStatus({ type: 'ok', text: `Deployed ✅ Agent: ${result.retellAgentId ?? '–'}` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setStatus({ type: 'error', text: `Deploy fehlgeschlagen: ${msg}` });
    } finally {
      setDeploying(false);
    }
  }

  function update(patch: Partial<AgentConfig>) {
    setConfig((c) => (c ? { ...c, ...patch } : c));
  }

  if (!config) {
    return <div className="p-8 text-white/50">Lade Agent-Konfiguration…</div>;
  }

  /* ── LIST VIEW ── */
  if (view === 'list') {
    const displayAgents = allAgents.length > 0 ? allAgents : (config ? [config] : []);
    const canAddAgent = displayAgents.length < agentsLimit;

    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white">Deine Agenten</h2>
            <p className="text-sm text-white/50 mt-1">
              {displayAgents.length} von {agentsLimit} Agent{agentsLimit !== 1 ? 'en' : ''} aktiv
            </p>
          </div>
          {status && (
            <span className={`text-sm ${status.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
              {status.text}
            </span>
          )}
        </div>

        {/* Agent Cards */}
        <div className="space-y-3 mb-5">
          {displayAgents.map((agent) => (
            <div key={agent.tenantId} className="glass rounded-2xl p-5 flex items-center gap-4 border border-white/10">
              <FoxLogo size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white truncate">{agent.name || 'Unbenannter Agent'}</p>
                <p className="text-xs text-white/50 truncate">{agent.businessName}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {agent.retellAgentId ? (
                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full font-medium">✓ Live</span>
                ) : (
                  <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full font-medium">Entwurf</span>
                )}
                <button
                  onClick={() => void handleSelectAgent(agent.tenantId)}
                  className="rounded-lg bg-white/5 border border-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                >
                  Bearbeiten
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add Agent Button */}
        {canAddAgent ? (
          <button
            onClick={() => void handleCreateAgent()}
            disabled={creatingAgent}
            className="rounded-xl border-2 border-dashed border-white/20 hover:border-orange-500/40 px-5 py-2.5 text-sm text-white/50 hover:text-white/80 disabled:opacity-50 transition-all"
          >
            {creatingAgent ? '…' : '+ Neuen Agenten erstellen'}
          </button>
        ) : (
          <div className="relative inline-block">
            <button
              disabled
              className="rounded-xl border-2 border-dashed border-white/10 px-5 py-2.5 text-sm text-white/30 cursor-not-allowed"
            >
              + Neuen Agenten erstellen
            </button>
            <span className="absolute -top-2 -right-2 text-[10px] bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded-full font-medium">
              {agentsLimit < 3 ? 'ab Pro' : 'Limit erreicht'}
            </span>
          </div>
        )}
      </div>
    );
  }

  /* ── EDIT VIEW ── */
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView('list')}
            className="text-sm text-white/50 hover:text-white transition-colors flex items-center gap-1"
          >
            ← Zurück
          </button>
          <div>
            <h2 className="text-2xl font-bold text-white">Agent Builder</h2>
            <p className="text-sm text-white/50 mt-0.5">Konfiguriere deinen Phonbot – Persönlichkeit, Wissen und Verhalten.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {status && (
            <span className={`text-sm ${status.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
              {status.text}
            </span>
          )}
          {config.retellAgentId ? (
            /* Already deployed — just save changes */
            <button onClick={handleSave} disabled={saving || deploying}
              className="rounded-lg bg-gradient-to-r from-orange-500 to-cyan-500 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
              {saving ? 'Speichert…' : 'Speichern'}
            </button>
          ) : (
            /* Not yet deployed — show deploy CTA */
            <button onClick={handleDeploy} disabled={deploying || saving}
              className="rounded-lg bg-gradient-to-r from-orange-500 to-cyan-500 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2">
              <IconDeploy size={14} />
              {deploying ? 'Deploying…' : 'Deploy'}
            </button>
          )}
        </div>
      </div>

      {/* Vertical Tab Navigation + Content */}
      <div className="flex gap-6">
        {/* Left: Tab list */}
        <div className="w-36 shrink-0">
          {TABS.map((t) => {
            const TabIcon = TAB_ICONS[t.id];
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm mb-1 transition-all text-left ${
                  tab === t.id
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}
              >
                <TabIcon size={16} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Right: Content */}
        <div className="flex-1 min-w-0">

      {/* ────────────────────── IDENTITY ────────────────────── */}
      {tab === 'identity' && (
        <>
          <SectionCard title="Identität" icon="🎭" className={voiceDropdownOpen ? 'relative z-10 overflow-visible' : ''}>
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
                <Badge color="green">✓ Deployed</Badge>
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

          <SectionCard title="Business-Informationen" icon="🏪">
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
        <SectionCard title="Wissensquellen" icon="🧠">
          <p className="text-sm text-white/50 mb-4">
            Gib deinem Agent Zugang zu Informationen — er kann Inhalte von Webseiten lesen, PDFs verarbeiten oder eigene Texte nutzen.
          </p>

          {/* Existing sources */}
          {(config.knowledgeSources ?? []).length > 0 && (
            <div className="space-y-2 mb-4">
              {(config.knowledgeSources ?? []).map((src, i) => (
                <div key={src.id} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                  <span className="text-lg">
                    {src.type === 'url' ? '🌐' : src.type === 'pdf' ? '📄' : '📝'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{src.name}</p>
                    <p className="text-xs text-white/40 truncate">{src.content}</p>
                  </div>
                  <Badge color={src.status === 'indexed' ? 'green' : src.status === 'error' ? 'red' : 'orange'}>
                    {src.status === 'indexed' ? '✓ Indexiert' : src.status === 'error' ? '✗ Fehler' : '⏳ Warte'}
                  </Badge>
                  <button onClick={() => {
                    const next = [...(config.knowledgeSources ?? [])];
                    next.splice(i, 1);
                    update({ knowledgeSources: next });
                  }} className="text-white/30 hover:text-red-400 transition-colors text-sm">✕</button>
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
          {/* Prompt Templates */}
          <SectionCard title="Prompt-Vorlagen" icon="📋">
            <p className="text-sm text-white/50 mb-4">Wähle eine Vorlage als Startpunkt — du kannst sie danach anpassen.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              {PROMPT_TEMPLATES.map((tpl) => (
                <button key={tpl.id} onClick={() => {
                  const prompt = tpl.prompt.replace('{businessName}', config.businessName || 'deinem Unternehmen');
                  update({ systemPrompt: prompt });
                }}
                  className="group flex flex-col items-center gap-2 p-4 rounded-xl bg-white/5 border border-white/10 hover:border-orange-500/40 hover:bg-white/10 transition-all text-center">
                  <span className="text-2xl">{tpl.icon}</span>
                  <span className="text-sm font-medium text-white group-hover:text-orange-300 transition-colors">{tpl.name}</span>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="System Prompt" icon="💬">
            <Field label="Anweisungen für den Agent">
              <TextArea rows={8} value={config.systemPrompt} onChange={(e) => update({ systemPrompt: e.target.value })}
                placeholder="Wie soll sich der Agent verhalten?" />
            </Field>

            <div className="mt-5">
              <span className="text-sm font-medium text-white/70">Tools</span>
              <div className="flex flex-wrap gap-3 mt-2">
                {KNOWN_TOOLS.map((tool) => (
                  <label key={tool} className="flex items-center gap-2 text-sm cursor-pointer select-none text-white/70">
                    <input type="checkbox" checked={config.tools.includes(tool)}
                      onChange={(e) => {
                        const next = new Set(config.tools);
                        e.target.checked ? next.add(tool) : next.delete(tool);
                        update({ tools: Array.from(next) });
                      }}
                      className="rounded border-white/20 bg-white/5 text-orange-500 focus:ring-orange-500/50" />
                    <code className="text-xs bg-white/10 text-white/60 px-2 py-0.5 rounded">{tool}</code>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5 flex items-center gap-4">
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
          <SectionCard title="Rufweiterleitung & Gesprächslogik" icon="📞">
            <p className="text-sm text-white/50 mb-4">
              Definiere Regeln in natürlicher Sprache — der Agent erkennt die Situation und handelt automatisch.
            </p>
            <CallRoutingEditor
              items={config.callRoutingRules ?? []}
              onChange={(items) => update({ callRoutingRules: items })}
            />
          </SectionCard>

          {/* Calendar Integrations */}
          <SectionCard title="Kalender-Anbindung" icon="📅">
            <p className="text-sm text-white/50 mb-4">
              Verbinde einen Kalender, damit dein Agent Termine prüfen und buchen kann.
            </p>
            <CalendarConnector
              integrations={config.calendarIntegrations ?? []}
              onChange={(items) => update({ calendarIntegrations: items })}
            />
          </SectionCard>

          {/* API Integrations */}
          <SectionCard title="API-Integrationen" icon="🔌">
            <p className="text-sm text-white/50 mb-4">
              Verbinde externe Systeme (CRM, ERP, Buchungssysteme) — dein Agent kann während des Gesprächs darauf zugreifen.
            </p>
            <ApiIntegrationEditor
              items={config.apiIntegrations ?? []}
              onChange={(items) => update({ apiIntegrations: items })}
            />
          </SectionCard>

          {/* Live Web Access */}
          <SectionCard title="Live Website-Zugriff" icon="🌐">
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
          <SectionCard title="Stimme & Geschwindigkeit" icon="🎤">
            <div className="space-y-5">
              <Slider value={config.speakingSpeed ?? 1.0} onChange={(v) => update({ speakingSpeed: v })}
                min={0.5} max={2.0} step={0.1}
                label="Sprechgeschwindigkeit" displayValue={`${(config.speakingSpeed ?? 1.0).toFixed(1)}x`} />

              <Slider value={config.temperature ?? 0.7} onChange={(v) => update({ temperature: v })}
                min={0} max={1} step={0.05}
                label="Kreativität (Temperature)" displayValue={(config.temperature ?? 0.7).toFixed(2)} />

              <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
                💡 <strong>Niedrig</strong> = konsistenter & faktisch · <strong>Hoch</strong> = kreativer & spontaner
              </div>

              <Slider value={config.maxCallDuration ?? 300} onChange={(v) => update({ maxCallDuration: v })}
                min={30} max={1800} step={30}
                label="Max. Anrufdauer" displayValue={`${Math.floor((config.maxCallDuration ?? 300) / 60)}:${String((config.maxCallDuration ?? 300) % 60).padStart(2, '0')} Min`} />
            </div>
          </SectionCard>

          <SectionCard title="Hintergrundgeräusche" icon="🔊">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {([
                { id: 'off', icon: '🔇', label: 'Keine' },
                { id: 'office', icon: '🏢', label: 'Büro' },
                { id: 'cafe', icon: '☕', label: 'Café' },
                { id: 'nature', icon: '🌿', label: 'Natur' },
              ] as const).map((bg) => (
                <button key={bg.id} onClick={() => update({ backgroundSound: bg.id })}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                    config.backgroundSound === bg.id
                      ? 'border-orange-500/50 bg-orange-500/10 text-white'
                      : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20'
                  }`}>
                  <span className="text-2xl">{bg.icon}</span>
                  <span className="text-sm font-medium">{bg.label}</span>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Gesprächssteuerung" icon="🎛️">
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

          <SectionCard title="Fachbegriffe" icon="📖">
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
        <SectionCard title="Aufzeichnung & Datenschutz" icon="🔒">
          <div className="space-y-6">
            <Toggle checked={config.recordCalls ?? false}
              onChange={(v) => update({ recordCalls: v })}
              label="Anrufe aufzeichnen" />
            {config.recordCalls && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-sm text-yellow-300 ml-14">
                ⚠️ Stelle sicher, dass Anrufer zu Beginn über die Aufzeichnung informiert werden (DSGVO).
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
              🔒 Alle Daten werden verschlüsselt gespeichert und nach Ablauf automatisch gelöscht. DSGVO-konform.
            </div>
          </div>
        </SectionCard>
      )}

      {/* ────────────────────── WEBHOOKS & VARIABLES ────────────────────── */}
      {tab === 'webhooks' && (
        <>
          <SectionCard title="Variablen extrahieren" icon="📤">
            <p className="text-sm text-white/50 mb-4">
              Definiere welche Informationen der Agent automatisch aus Gesprächen extrahieren soll.
            </p>
            <VariableEditor
              items={config.extractedVariables ?? []}
              onChange={(items) => update({ extractedVariables: items })}
            />
          </SectionCard>

          <SectionCard title="Inbound Webhooks" icon="🔗">
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
        <div className="space-y-6">
          {!config.retellAgentId ? (
            <div className="glass rounded-2xl p-8 text-center space-y-4">
              <IconDeploy size={44} className="mx-auto text-orange-400/40" />
              <h3 className="text-lg font-semibold text-white">Agent noch nicht deployed</h3>
              <p className="text-sm text-white/50">Speichere und deploye deinen Agent zuerst.</p>
              <button
                onClick={handleDeploy}
                disabled={deploying}
                className="rounded-lg bg-gradient-to-r from-orange-500 to-cyan-500 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2 mx-auto"
              >
                {deploying ? 'Deploying…' : (
                  <>
                    <IconDeploy size={14} />
                    Jetzt deployen
                  </>
                )}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left: Live Call */}
                <div className="glass rounded-2xl p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <IconPlay size={18} className="text-orange-400" />
                    <h3 className="text-lg font-semibold text-white">Live Web-Call</h3>
                    <span className="ml-auto text-xs text-orange-400 bg-orange-500/10 px-2 py-1 rounded-full">● Agent live</span>
                  </div>
                  <p className="text-sm text-white/50 mb-4">Sprich direkt mit deinem Agenten — Mikrofon erforderlich.</p>
                  <WebCallWidget />
                </div>

                {/* Right: Active Voice Info */}
                <div className="glass rounded-2xl p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <IconMicUpload size={18} className="text-cyan-400" />
                    <h3 className="text-lg font-semibold text-white">Aktive Stimme</h3>
                  </div>
                  <p className="text-sm text-white/50 mb-4">
                    Aktuelle Stimme des Agents. Eigene Stimmen klonen im Tab <strong className="text-white">Identität</strong>.
                  </p>
                  <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
                    <p className="text-sm font-medium text-white">{config.voice}</p>
                    {voices.find((v) => v.voice_id === config.voice) && (
                      <p className="text-xs text-white/40 mt-0.5">
                        {voices.find((v) => v.voice_id === config.voice)?.voice_name}
                        {' · '}
                        {voices.find((v) => v.voice_id === config.voice)?.voice_type === 'cloned' ? (
                          <span className="text-cyan-400">Eigene Stimme</span>
                        ) : (
                          <span className="text-white/40">{voices.find((v) => v.voice_id === config.voice)?.provider ?? 'Built-in'}</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <details className="glass rounded-2xl p-4 cursor-pointer">
                <summary className="text-sm font-medium text-white/60 select-none">Technische Vorschau</summary>
                <div className="mt-4">
                  <button
                    onClick={() => getAgentPreview().then(setPreview)}
                    className="flex items-center gap-1.5 text-sm text-orange-400 mb-3 hover:text-orange-300 transition-colors"
                  >
                    <IconRefresh size={14} /> Aktualisieren
                  </button>
                  {preview && (
                    <div className="space-y-4">
                      <div>
                        <span className="text-xs font-medium text-white/40 uppercase">Aktive Tools</span>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {preview.tools.map((t) => (
                            <span key={t} className="text-xs bg-orange-500/20 text-orange-300 px-2 py-1 rounded font-mono">{t}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-white/40 uppercase">Instructions</span>
                        <pre className="mt-1 bg-black/40 text-white/80 text-xs p-4 rounded-lg overflow-auto max-h-60 whitespace-pre-wrap border border-white/5">
                          {preview.instructions}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </details>
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
      <div className="flex gap-3">
        <button onClick={() => setMode('url')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 hover:border-orange-500/40 hover:text-white transition-all">
          🌐 Website-URL
        </button>
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 hover:border-orange-500/40 hover:text-white transition-all">
          📄 PDF hochladen
        </button>
        <button onClick={() => setMode('text')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 hover:border-orange-500/40 hover:text-white transition-all">
          📝 Eigener Text
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
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-white/30 hover:text-red-400">✕</button>
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
          <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors">✕</button>
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
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors">✕</button>
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

  const ACTION_OPTIONS: { id: CallRoutingRule['action']; label: string; icon: string }[] = [
    { id: 'transfer', label: 'Weiterleiten', icon: '📞' },
    { id: 'hangup', label: 'Auflegen', icon: '📵' },
    { id: 'voicemail', label: 'Mailbox', icon: '📧' },
    { id: 'ticket', label: 'Ticket erstellen', icon: '📋' },
  ];

  return (
    <div className="space-y-3">
      {/* Examples hint */}
      {items.length === 0 && (
        <div className="bg-white/5 rounded-xl p-4 space-y-2">
          <span className="text-xs font-medium text-white/50">💡 Beispiele:</span>
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
                      {act.icon} {act.label}
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
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors mt-1">✕</button>
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

const CALENDAR_PROVIDERS = [
  { id: 'google' as const, icon: '📅', name: 'Google Calendar', desc: 'Verbinde dein Google-Konto' },
  { id: 'outlook' as const, icon: '📧', name: 'Microsoft Outlook', desc: 'Outlook / Microsoft 365' },
  { id: 'calcom' as const, icon: '🗓️', name: 'Cal.com', desc: 'Open-Source Terminbuchung' },
  { id: 'caldav' as const, icon: '🔗', name: 'CalDAV', desc: 'Nextcloud, iCloud, etc.' },
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
              <span className="text-lg">{CALENDAR_PROVIDERS.find((p) => p.id === cal.provider)?.icon}</span>
              <div className="flex-1">
                <p className="text-sm text-white font-medium">{cal.label ?? cal.provider}</p>
                {cal.email && <p className="text-xs text-white/40">{cal.email}</p>}
              </div>
              <span className="text-xs text-green-400 font-medium">✓ Verbunden</span>
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
              <span className="text-2xl">{prov.icon}</span>
              <div>
                <p className="text-sm font-medium text-white">{prov.name}</p>
                <p className="text-xs text-white/40">{isConnected ? 'Bereits verbunden' : prov.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
        💡 Nach der Verbindung kann dein Agent freie Termine prüfen, Buchungen erstellen und Kalender-Konflikte erkennen.
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
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors">✕</button>
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
        💡 Dein Agent kann während des Gesprächs Daten abrufen und senden — z.B. Kundenstatus prüfen, Bestellungen anlegen oder CRM-Einträge erstellen.
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
                  🌐 {domain}
                  <button onClick={() => onChange({
                    ...config,
                    allowedDomains: config.allowedDomains.filter((_, j) => j !== i),
                  })} className="text-white/30 hover:text-red-400">✕</button>
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
            🌐 Der Agent kann aktuelle Preise, Produktinfos oder Verfügbarkeiten direkt von deiner Website lesen — in Echtzeit während des Gesprächs.
          </div>
        </>
      )}
    </div>
  );
}
