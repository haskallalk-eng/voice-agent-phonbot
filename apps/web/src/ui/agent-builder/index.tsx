import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  getAgentConfig,
  getAgentConfigs,
  createNewAgent,
  saveAgentConfig,
  deployAgentConfig,
  getAgentPreview,
  getBillingStatus,
  getVoices,
  getRecommendedVoices,
  getInsights,
  getAccessToken,
  type AgentConfig,
  type AgentPreview,
  type Voice,
  type BillingStatus,
} from '../../lib/api.js';
import { isPremiumVoice, voiceSurcharge } from './VoiceDropdown.js';
import { TABS, PROMPT_SECTIONS, DEFAULT_CONFIG_VALUES, IconDeploy, IconPlay, type Tab } from './shared.js';
import { AgentListView } from './AgentListView.js';
import { IdentityTab } from './IdentityTab.js';
import { KnowledgeTab } from './KnowledgeTab.js';
import { BehaviorTab } from './BehaviorTab.js';
import { CapabilitiesTab } from './CapabilitiesTab.js';
import { TechnicalTab } from './TechnicalTab.js';
import { PrivacyTab } from './PrivacyTab.js';
import { WebhooksTab } from './WebhooksTab.js';
import { PreviewTab } from './PreviewTab.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Main Component                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

type Page = 'home' | 'agent' | 'test' | 'tickets' | 'logs' | 'billing' | 'phone' | 'calendar' | 'insights';

export function AgentBuilder({ onNavigate }: { onNavigate?: (page: Page) => void } = {}) {
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
  // KI Insights — pending suggestions count (runs in background)
  const [pendingSuggestions, setPendingSuggestions] = useState(0);
  // Phone numbers — check if agent has a number
  const [hasPhone, setHasPhone] = useState(true); // assume true until loaded
  // Billing status — drives the stats row (price/min, remaining minutes).
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  // Track original config snapshot for dirty detection
  const savedConfigRef = useRef<string>('');

  const isDirty = useMemo(() => {
    if (!config || !savedConfigRef.current) return false;
    return JSON.stringify(config) !== savedConfigRef.current;
  }, [config]);

  // Stable ref — no config dependency so the init useEffect doesn't re-run on language change.
  // Language is passed as parameter when switching.
  const loadVoices = useCallback(async (language?: string) => {
    setVoicesLoading(true);
    try {
      const lang = language ?? 'de';
      const rec = await getRecommendedVoices(lang);
      if (rec.voices?.length) {
        const mapped: Voice[] = rec.voices.map(v => ({
          voice_id: v.id,
          voice_name: v.name,
          voice_type: 'built_in' as const,
          provider: v.provider,
          gender: v.gender,
        }));
        try {
          const all = await getVoices();
          const cloned = (all.voices ?? []).filter(v => v.voice_type === 'cloned');
          setVoices([...mapped, ...cloned]);
        } catch {
          setVoices(mapped);
        }
      } else {
        const res = await getVoices();
        setVoices(res.voices ?? []);
      }
    } catch {
      // Non-fatal
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllAgents(); void loadConfig(); void loadVoices();
    // Load pending insight suggestions (background)
    void getInsights().then(d => {
      setPendingSuggestions(d.suggestions.filter(s => s.status === 'pending').length);
    }).catch(() => {});
    // Check if any phone numbers exist
    {
      const token = getAccessToken();
      void fetch('/api/phone', {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
        .then(r => r.json())
        .then(d => setHasPhone((d.items ?? []).length > 0))
        .catch(() => {});
    }
  }, [loadVoices]);

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
      const [agentsRes, billingRes] = await Promise.all([getAgentConfigs(), getBillingStatus()]);
      setAllAgents(agentsRes.items);
      setBilling(billingRes);
      // agentsLimit comes from plan definition (1/1/3/10)
      const LIMITS: Record<string, number> = { free: 1, starter: 1, pro: 3, agency: 10 };
      setAgentsLimit(LIMITS[billingRes.plan] ?? 1);
    } catch {
      // Non-critical -- list stays empty
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
        ...DEFAULT_CONFIG_VALUES,
        ...newCfg,
      } as AgentConfig;
      setConfig(merged);
      savedConfigRef.current = JSON.stringify(merged);
      setView('edit');
    } catch (e: unknown) {
      // F4: avoid echoing raw error message into the UI (could leak server
      // internals, ApiError body, etc). Log to console for dev introspection.
      if (typeof console !== 'undefined') console.warn('createNewAgent failed', e);
      setStatus({ type: 'error', text: 'Agent konnte nicht erstellt werden. Bitte erneut versuchen.' });
    } finally {
      setCreatingAgent(false);
    }
  }

  async function handleSelectAgent(tenantId: string) {
    try {
      const cfg = await getAgentConfig(tenantId);
      const merged: AgentConfig = {
        ...DEFAULT_CONFIG_VALUES,
        ...cfg,
      } as AgentConfig;
      setConfig(merged);
      savedConfigRef.current = JSON.stringify(merged);
      setView('edit');
    } catch {
      // fallback
    }
  }

  async function loadConfig() {
    try {
      const cfg = await getAgentConfig();
      const merged: AgentConfig = {
        ...DEFAULT_CONFIG_VALUES,
        ...cfg,
      } as AgentConfig;
      setConfig(merged);
      savedConfigRef.current = JSON.stringify(merged);
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
      await loadAllAgents(); // refresh agent list after save (name changes etc.)
      // Update snapshot so isDirty resets
      setConfig((c) => {
        if (c) savedConfigRef.current = JSON.stringify(c);
        return c;
      });
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
      await loadAllAgents(); // refresh agent list after deploy
      // Update snapshot so isDirty resets
      setConfig((c) => {
        if (c) savedConfigRef.current = JSON.stringify(c);
        return c;
      });
      setStatus({ type: 'ok', text: `Deployed — Agent: ${result.retellAgentId ?? '–'}` });
    } catch (e: unknown) {
      // F4: Retell-API-errors / pg-errors carry implementation details that
      // shouldn't surface to the customer-facing UI. Console-log for ops,
      // generic message for the user.
      if (typeof console !== 'undefined') console.warn('agent deploy failed', e);
      setStatus({ type: 'error', text: 'Deploy fehlgeschlagen — bitte erneut versuchen oder Support kontaktieren.' });
    } finally {
      setDeploying(false);
    }
  }

  function update(patch: Partial<AgentConfig>) {
    setConfig((c) => (c ? { ...c, ...patch } : c));
    // When language changes, reload voice list and auto-select the default voice.
    if (patch.language && patch.language !== config?.language) {
      void (async () => {
        try {
          const rec = await getRecommendedVoices(patch.language!);
          const def = rec.voices?.find(v => v.isDefault);
          if (def) setConfig(c => c ? { ...c, voice: def.id } : c);
          await loadVoices(patch.language);
        } catch { /* non-fatal */ }
      })();
    }
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
    return (
      <AgentListView
        allAgents={allAgents}
        config={config}
        agentsLimit={agentsLimit}
        creatingAgent={creatingAgent}
        status={status}
        onSelectAgent={(tenantId) => void handleSelectAgent(tenantId)}
        onCreateAgent={() => void handleCreateAgent()}
        onAgentDeleted={() => void loadAllAgents()}
        onNavigate={onNavigate}
      />
    );
  }

  /* ── EDIT VIEW ── */
  /* Layout: fixed header + fixed tab sidebar + scrollable content.
     The parent <main> has overflow-y-auto — we need to break out of that
     scroll context so the header/sidebar stay pinned. Using sticky + a
     height that fills the viewport minus the mobile topbar (48px). */
  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 3rem)', position: 'sticky', top: 0 }}>
      {/* Header — fixed at top */}
      <div className="shrink-0 z-20 px-6 py-4 flex items-center justify-between flex-wrap gap-3 border-b border-white/[0.05]" style={{ background: 'rgba(10,10,15,0.95)', backdropFilter: 'blur(12px)' }}>
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
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {/* Live stats row (hidden on narrow screens — tabs below show them redundantly) */}
          <AgentStatsRow
            config={config}
            voices={voices}
            billing={billing}
          />
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
              disabled={saving || deploying || !isDirty}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 transition-all ${isDirty ? 'cursor-pointer' : 'cursor-default'}`}
              style={{ background: isDirty ? 'linear-gradient(135deg, #F97316, #06B6D4)' : 'rgba(255,255,255,0.08)' }}
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

      {/* No phone hint */}
      {config.retellAgentId && !hasPhone && (
        <div className="flex items-center justify-between px-6 py-2.5" style={{ background: 'rgba(6,182,212,0.04)', borderBottom: '1px solid rgba(6,182,212,0.08)' }}>
          <p className="text-[11px] text-cyan-400/60">Nur per Web-Call erreichbar — verbinde eine Telefonnummer für echte Anrufe</p>
          <button onClick={() => onNavigate?.('phone' as Page)}
            className="shrink-0 ml-3 text-[11px] font-medium bg-clip-text text-transparent cursor-pointer"
            style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
            Nummer einrichten →
          </button>
        </div>
      )}

      {/* Body: sidebar (col on desktop, top row on mobile) + scrollable content */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        {/* Tab list — horizontal scroll on mobile, vertical sidebar on desktop */}
        <div className="w-full md:w-40 shrink-0 border-b md:border-b-0 md:border-r border-white/[0.05] flex md:block gap-1 md:gap-0 md:space-y-0.5 px-2 md:px-3 py-2 md:py-4 overflow-x-auto md:overflow-y-auto scrollbar-thin">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 md:w-full flex items-center gap-2 md:gap-2.5 px-3 py-2 md:py-2.5 rounded-xl text-xs font-medium transition-all md:text-left cursor-pointer relative whitespace-nowrap ${
                tab === t.id
                  ? 'bg-white/8 text-white border border-white/10'
                  : 'text-white/35 hover:text-white/65 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              <t.Icon size={14} className={tab === t.id ? 'text-orange-400' : ''} />
              {t.label}
              {t.id === 'behavior' && pendingSuggestions > 0 && (
                <span className="ml-1 md:ml-0 md:absolute md:right-2 md:top-1/2 md:-translate-y-1/2 flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 text-[9px] font-bold text-white">
                  {pendingSuggestions > 9 ? '9+' : pendingSuggestions}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 min-w-0 overflow-y-auto px-4 md:px-6 py-4 md:py-5">

      {tab === 'identity' && (
        <IdentityTab
          config={config}
          voices={voices}
          voicesLoading={voicesLoading}
          voiceDropdownOpen={voiceDropdownOpen}
          voiceDropdownRef={voiceDropdownRef}
          onUpdate={update}
          onVoiceDropdownToggle={() => setVoiceDropdownOpen((v) => !v)}
          onVoiceSelect={(id) => { update({ voice: id }); setVoiceDropdownOpen(false); }}
          onVoiceCloned={(newVoice) => {
            setVoices((prev) => {
              const filtered = prev.filter((v) => v.voice_id !== newVoice.voice_id);
              return [newVoice, ...filtered];
            });
            update({ voice: newVoice.voice_id });
          }}
        />
      )}

      {tab === 'knowledge' && (
        <KnowledgeTab config={config} onUpdate={update} />
      )}

      {tab === 'behavior' && (
        <BehaviorTab
          config={config}
          activePromptSections={activePromptSections}
          onUpdate={update}
          onTogglePromptSection={togglePromptSection}
          onSetActivePromptSections={setActivePromptSections}
        />
      )}

      {tab === 'capabilities' && (
        <CapabilitiesTab config={config} onUpdate={update} />
      )}

      {tab === 'technical' && (
        <TechnicalTab config={config} onUpdate={update} />
      )}

      {tab === 'privacy' && (
        <PrivacyTab config={config} onUpdate={update} />
      )}

      {tab === 'webhooks' && (
        <WebhooksTab config={config} onUpdate={update} />
      )}

      {tab === 'preview' && (
        <PreviewTab
          config={config}
          preview={preview}
          voices={voices}
          deploying={deploying}
          onDeploy={handleDeploy}
          onPreviewUpdate={setPreview}
        />
      )}

        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * Live agent stats row — sits inline next to "Testen" / "Speichern"
 * in the builder header. Four chips:
 *   1. Preis/Min         — current €/Min (0 if inside the plan limit,
 *                          overage rate + premium surcharge if over)
 *   2. Frei-Min          — minutes left before overage kicks in
 *   3. Latenz            — estimated first-response latency from the
 *                          voice provider + LLM model + interruption
 *                          mode the user has selected
 *   4. Latenz-Hinweis    — "Optimiert" / "Standard" / "Langsam", with
 *                          a tooltip hint on what to tweak for faster
 *                          response.
 * Hidden below md so the builder header stays usable on mobile.
 * ─────────────────────────────────────────────────────────────────── */

// Overage price per minute by plan, from shared.ts PLANS (single
// source of truth mirrored here because shared.ts is in landing/).
const PLAN_OVERAGE_EUR: Record<string, number> = {
  free: 0.22, nummer: 0.22, starter: 0.22, pro: 0.20, agency: 0.15,
};

// Voice provider → TTS first-chunk latency (ms). Measured ballparks.
// Cartesia is fastest, ElevenLabs HD adds quality at the cost of ~200ms.
function ttsLatencyMs(provider?: string | null): number {
  const p = (provider ?? '').toLowerCase();
  if (p === 'elevenlabs' || p === '11labs') return 400;
  if (p === 'cartesia') return 150;
  if (p === 'openai') return 300;
  if (p === 'minimax') return 200;
  return 250;
}

function AgentStatsRow({
  config,
  voices,
  billing,
}: {
  config: AgentConfig;
  voices: Voice[];
  billing: BillingStatus | null;
}) {
  const voice = voices.find((v) => v.voice_id === config.voice);
  const premium = voice ? isPremiumVoice(voice) : false;
  const surcharge = voice ? voiceSurcharge(voice) : 0;

  // Price/Min: 0 while inside free/plan minutes, otherwise overage + surcharge.
  const planId = (billing?.plan ?? 'free').toLowerCase();
  const remaining = billing?.minutesRemaining ?? 0;
  const overage = PLAN_OVERAGE_EUR[planId] ?? 0.22;
  const insidePlan = remaining > 0;
  const effectivePrice = insidePlan ? surcharge : overage + surcharge;

  // Latency estimate:
  //   STT end-of-turn ~500ms + LLM first-token (gpt-4o-mini ~800ms) +
  //   TTS first-chunk (provider-dependent).
  // Interruption mode 'ignore' doesn't change raw latency but makes
  // the agent feel less responsive, so we surface it as a "Standard"
  // instead of "Optimiert" hint.
  const sttMs = 500;
  const llmMs = 800; // gpt-4o-mini default
  const ttsMs = ttsLatencyMs(voice?.provider);
  const totalMs = sttMs + llmMs + ttsMs;
  const interruptMode = (config as AgentConfig & { interruptionMode?: string }).interruptionMode ?? 'allow';
  const responsive = interruptMode === 'allow';

  const latencyLabel =
    totalMs < 1500 && responsive ? 'Optimiert' :
    totalMs < 1800 && responsive ? 'Standard' :
    'Langsam';
  const latencyColor =
    latencyLabel === 'Optimiert' ? 'text-green-400 bg-green-500/10 border-green-500/25' :
    latencyLabel === 'Standard' ? 'text-white/65 bg-white/5 border-white/15' :
    'text-yellow-400 bg-yellow-500/10 border-yellow-500/25';

  const tips: string[] = [];
  if (premium) tips.push('Premium-Stimme verursacht ~250 ms zusätzlich');
  if (!responsive) tips.push(`Unterbrechungs-Modus „${interruptMode}" wirkt langsamer`);
  if (ttsMs > 300 && !premium) tips.push('Cartesia wählen für schnellere Antwort');
  const latencyTip = tips.length > 0
    ? tips.join(' · ')
    : 'Schnellste mögliche Konfiguration — ElevenLabs + gpt-4o-mini + Allow-Unterbrechung.';

  return (
    <div className="hidden md:flex items-stretch rounded-xl border border-white/8 bg-white/[0.03] overflow-hidden text-xs">
      <StatChip label="Preis / Min" value={`${effectivePrice.toFixed(2)} €`} />
      <Divider />
      <StatChip
        label="Frei-Min"
        value={`${Math.max(0, Math.floor(remaining))}`}
        valueClass={remaining <= 0 ? 'text-yellow-400' : undefined}
      />
      <Divider />
      <StatChip label="Latenz" value={`${Math.round(totalMs / 10) * 10} ms`} />
      <Divider />
      <StatChip
        label="Status"
        value={latencyLabel}
        valueClass={latencyColor.split(' ')[0]}
        title={latencyTip}
        badgeClass={latencyColor}
      />
    </div>
  );
}

function StatChip({
  label,
  value,
  valueClass,
  title,
  badgeClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
  title?: string;
  badgeClass?: string;
}) {
  return (
    <div className="flex flex-col px-3 py-1.5 min-w-[78px]" title={title}>
      <span className="text-[9px] font-semibold text-white/40 uppercase tracking-wider leading-none mb-0.5">{label}</span>
      {badgeClass ? (
        <span className={`inline-flex items-center justify-center text-[11px] font-semibold rounded-md px-1.5 py-0.5 border leading-tight ${badgeClass}`}>
          {value}
        </span>
      ) : (
        <span className={`text-sm font-semibold text-white leading-tight tabular-nums ${valueClass ?? ''}`}>
          {value}
        </span>
      )}
    </div>
  );
}

function Divider() {
  return <div className="w-px bg-white/8 my-2" />;
}
