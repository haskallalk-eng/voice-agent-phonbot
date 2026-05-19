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
  getPhoneNumbers,
  getAgentStats,
  type AgentConfig,
  type AgentPreview,
  type Voice,
  type BillingStatus,
  type AgentStats,
} from '../../lib/api.js';
import { isPremiumVoice, voiceSurcharge } from './VoiceDropdown.js';
import { TABS, PROMPT_SECTIONS, DEFAULT_CONFIG_VALUES, IconDeploy, IconPlay, normalizeFallbackReasonValue, type Tab } from './shared.js';
import { IconBolt, IconRefresh } from '../PhonbotIcons.js';
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

type Page = 'home' | 'agent' | 'test' | 'tickets' | 'customers' | 'logs' | 'billing' | 'phone' | 'calendar' | 'insights';

function mergeAgentConfigDefaults(cfg: AgentConfig): AgentConfig {
  const defaultFallback = DEFAULT_CONFIG_VALUES.fallback as AgentConfig['fallback'];
  return {
    ...DEFAULT_CONFIG_VALUES,
    ...cfg,
    fallback: {
      ...defaultFallback,
      ...cfg.fallback,
      reason: normalizeFallbackReasonValue(cfg.fallback?.reason ?? defaultFallback.reason),
      reasons: cfg.fallback?.reasons?.length ? cfg.fallback.reasons : defaultFallback.reasons,
    },
  } as AgentConfig;
}

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
  // Live agent stats (latency, calls count) — fetched from Retell on demand.
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [statsFetchedAt, setStatsFetchedAt] = useState<number | null>(null);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
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
    void getPhoneNumbers()
      .then(d => setHasPhone((d.items ?? []).length > 0))
      .catch(() => {});
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
      const merged = mergeAgentConfigDefaults(newCfg);
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
      const merged = mergeAgentConfigDefaults(cfg);
      setConfig(merged);
      savedConfigRef.current = JSON.stringify(merged);
      setView('edit');
      setPreview(null);
      const prev = await getAgentPreview(merged.tenantId);
      setPreview(prev);
      void refreshAgentStats(merged.tenantId);
    } catch {
      // fallback
    }
  }

  async function loadConfig({ resetView = true }: { resetView?: boolean } = {}) {
    try {
      const cfg = await getAgentConfig();
      const merged = mergeAgentConfigDefaults(cfg);
      setConfig(merged);
      savedConfigRef.current = JSON.stringify(merged);
      // Initial mount: jump to list if the agent is already deployed,
      // otherwise drop the user straight into edit. Skip on refresh-only
      // reloads (e.g. after applying a suggestion) — otherwise the user
      // gets thrown out of the editor mid-flow.
      if (resetView) {
        if (merged.retellAgentId) setView('list');
        else setView('edit');
      }
      const prev = await getAgentPreview(merged.tenantId);
      setPreview(prev);
      // Pull live latency from Retell for this agent. Non-blocking —
      // empty result just hides the chip until real calls arrive.
      void refreshAgentStats(merged.tenantId);
    } catch {
      setStatus({ type: 'error', text: 'Config konnte nicht geladen werden' });
    }
  }

  async function refreshAgentStats(tenantId?: string) {
    setStatsRefreshing(true);
    try {
      const stats = await getAgentStats(tenantId);
      setAgentStats(stats);
      setStatsFetchedAt(Date.now());
    } catch {
      setAgentStats(null);
    } finally {
      setStatsRefreshing(false);
    }
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setStatus(null);
    try {
      // If already deployed, sync to Retell so voice/config changes take effect immediately
      let nextConfig = config;
      if (config.retellAgentId) {
        const result = await deployAgentConfig(config);
        nextConfig = { ...config, ...result.config };
        setConfig(nextConfig);
      } else {
        const saved = await saveAgentConfig(config);
        nextConfig = { ...config, ...saved };
        setConfig(nextConfig);
      }
      const prev = await getAgentPreview(nextConfig.tenantId);
      setPreview(prev);
      await loadAllAgents(); // refresh agent list after save (name changes etc.)
      // Update snapshot so isDirty resets
      setConfig((c) => {
        if (c) savedConfigRef.current = JSON.stringify(c);
        return c;
      });
      setStatus({ type: 'ok', text: 'Gespeichert' });
      // Voice/Prompt changes can shift latency — pull fresh stats so the
      // chip reflects the new config within a second, not 15.
      void refreshAgentStats(nextConfig.tenantId);
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
      const nextConfig = { ...config, ...result.config };
      setConfig(nextConfig);
      const prev = await getAgentPreview(nextConfig.tenantId);
      setPreview(prev);
      await loadAllAgents(); // refresh agent list after deploy
      // Update snapshot so isDirty resets
      setConfig((c) => {
        if (c) savedConfigRef.current = JSON.stringify(c);
        return c;
      });
      setStatus({ type: 'ok', text: 'Agent aktiviert.' });
      // Fresh deploy = new agent config live at Retell → pull stats so
      // the chip starts showing the new agent's measurements.
      void refreshAgentStats(nextConfig.tenantId);
    } catch (e: unknown) {
      // F4: Retell-API-errors / pg-errors carry implementation details that
      // shouldn't surface to the customer-facing UI. Console-log for ops,
      // generic message for the user.
      if (typeof console !== 'undefined') console.warn('agent deploy failed', e);
      setStatus({ type: 'error', text: 'Aktivieren fehlgeschlagen — bitte erneut versuchen oder Support kontaktieren.' });
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
      // Prefer the customer's edited override if one exists — toggling a
      // section off and back on must restore their version, not wipe it.
      const overrides = (config as { sectionTextOverrides?: Record<string, string> }).sectionTextOverrides ?? {};
      const source = typeof overrides[sectionId] === 'string' ? overrides[sectionId]! : section.text;
      const sectionText = source
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
  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  const ActiveIcon = activeTab.Icon;

  return (
    <div
      className="relative flex h-[calc(100dvh-3rem)] w-full min-w-0 flex-col overflow-hidden bg-[#07070D] md:h-screen"
      style={{ position: 'sticky', top: 0 }}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-36 -right-20 h-96 w-96 rounded-full bg-orange-500/14 blur-3xl" />
        <div className="absolute top-28 left-10 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'linear-gradient(to bottom, black, transparent 78%)',
          }}
        />
      </div>

      {/* Header — fixed at top */}
      <div className="relative z-20 shrink-0 border-b border-white/[0.08] bg-[#0A0A0F]/86 shadow-[0_18px_58px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
        <div className="flex min-h-[3.6rem] items-center gap-2 px-3 py-2 md:px-5 md:py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <button
            onClick={() => setView('list')}
            aria-label="Zur Agentenliste"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 text-xs text-white/48 transition-colors hover:bg-white/[0.07] hover:text-white cursor-pointer"
          >
            <span className="text-base leading-none">‹</span>
            <span className="hidden sm:inline">Agenten</span>
          </button>
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-orange-400/25 bg-gradient-to-br from-orange-500/22 via-white/[0.04] to-cyan-400/18 shadow-[0_0_26px_rgba(249,115,22,0.16)]">
            <ActiveIcon size={16} className="text-orange-200" />
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.9)]" />
          </div>
          <div className="min-w-0">
            <div className="hidden items-center gap-2 md:flex">
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-100/70">
                Chipy Studio
              </span>
              {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-orange-300 shadow-[0_0_12px_rgba(251,146,60,0.85)]" />}
            </div>
            <h2 className="text-sm font-semibold text-white truncate md:mt-0.5 md:text-base">{config.name || 'Agent Builder'}</h2>
            <p className="text-[11px] text-white/38 truncate">{activeTab.label} · {config.businessName || 'Konfiguration'}</p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
          {/* Live stats row (hidden on narrow screens — tabs below show them redundantly) */}
          <AgentStatsRow
            config={config}
            voices={voices}
            billing={billing}
            stats={agentStats}
            fetchedAt={statsFetchedAt}
            refreshing={statsRefreshing}
            onRefresh={() => refreshAgentStats(config.tenantId)}
          />
          {status && (
            <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
              status.type === 'ok'
                ? 'text-green-400 bg-green-500/10 border border-green-500/20'
                : 'text-red-400 bg-red-500/10 border border-red-500/20'
            } hidden max-w-[14rem] truncate lg:inline-flex`}>
              {status.text}
            </span>
          )}
          {config.retellAgentId && (
            <button
              onClick={() => setTab('preview')}
              className="flex h-9 items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 shadow-[0_0_24px_rgba(6,182,212,0.08)] transition-all hover:bg-cyan-300/16 hover:border-cyan-300/40 cursor-pointer"
            >
              <IconPlay size={13} />
              <span className="hidden sm:inline">Testen</span>
            </button>
          )}
          {config.retellAgentId ? (
            <button
              onClick={handleSave}
              disabled={saving || deploying || !isDirty}
              className={`flex h-9 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold text-white shadow-[0_0_28px_rgba(249,115,22,0.16)] transition-all disabled:opacity-50 ${isDirty ? 'cursor-pointer hover:scale-[1.02]' : 'cursor-default'}`}
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
              className="flex h-9 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold text-white shadow-[0_0_30px_rgba(249,115,22,0.18)] transition-all disabled:opacity-50 cursor-pointer hover:scale-[1.02]"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              <IconDeploy size={13} />
              {deploying ? 'Aktiviere…' : 'Aktivieren'}
            </button>
          )}
        </div>
      </div>
      </div>

      {/* No phone hint */}
      {config.retellAgentId && !hasPhone && (
        <div className="flex items-center justify-between px-4 py-2" style={{ background: 'rgba(6,182,212,0.04)', borderBottom: '1px solid rgba(6,182,212,0.08)' }}>
          <p className="truncate text-[11px] text-cyan-400/60">Nur per Web-Call erreichbar — verbinde eine Telefonnummer für echte Anrufe</p>
          <button onClick={() => onNavigate?.('phone' as Page)}
            className="shrink-0 ml-3 text-[11px] font-medium bg-clip-text text-transparent cursor-pointer"
            style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
            Nummer einrichten →
          </button>
        </div>
      )}

      {/* Body: sidebar (col on desktop, top row on mobile) + scrollable content */}
      <div className="relative z-10 flex flex-col md:flex-row flex-1 min-h-0">
        {/* Tab list — horizontal scroll on mobile, vertical sidebar on desktop */}
        <div
          role="tablist"
          aria-orientation="vertical"
          className="grid w-full shrink-0 grid-cols-4 gap-1.5 overflow-hidden border-b border-white/[0.07] bg-black/18 px-2 py-2 backdrop-blur-xl md:w-52 md:grid-cols-1 md:auto-rows-fr md:border-b-0 md:border-r md:px-3 md:py-3"
        >
          {TABS.map((t, index) => (
            <button
              role="tab"
              aria-selected={tab === t.id}
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`group relative flex h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 text-[10px] font-semibold transition-all cursor-pointer md:h-full md:min-h-0 md:w-full md:flex-row md:justify-start md:gap-3 md:rounded-2xl md:px-3 md:py-0 md:text-left md:text-xs ${
                tab === t.id
                  ? 'bg-gradient-to-br from-orange-500/16 via-white/[0.07] to-cyan-400/12 text-white border-orange-300/22 shadow-[0_0_28px_rgba(249,115,22,0.12)]'
                  : 'text-white/38 hover:text-white/75 hover:bg-white/[0.05] border-white/[0.04]'
              }`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-all md:h-7 md:w-7 md:rounded-xl ${
                tab === t.id ? 'border-cyan-300/25 bg-cyan-300/12 text-cyan-100' : 'border-white/[0.06] bg-white/[0.03] text-white/35 group-hover:text-white/65'
              }`}>
                <t.Icon size={13} />
              </span>
              <span className="min-w-0 max-w-full md:flex-1">
                <span className="block truncate">{t.label}</span>
                <span className={`hidden md:block text-[10px] font-normal ${tab === t.id ? 'text-cyan-100/45' : 'text-white/20'}`}>
                  Schritt {index + 1}
                </span>
              </span>
              {t.id === 'identity' && pendingSuggestions > 0 && (
                <span
                  aria-label={`${pendingSuggestions} Vorschlag${pendingSuggestions === 1 ? '' : 'e'} wartet`}
                  title={`${pendingSuggestions} neue${pendingSuggestions === 1 ? 'r' : ''} Vorschlag${pendingSuggestions === 1 ? '' : 'e'}`}
                  className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 breathe md:right-2 md:top-1/2 md:-translate-y-1/2"
                >
                  {/* Chipy-design: gradient sparkle instead of a loud counter pill.
                     The banner inside the tab shows the detail, so the badge only
                     needs to hint that something is there — breathe-pulse + dot. */}
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{
                      background: 'linear-gradient(135deg, #F97316, #06B6D4)',
                      boxShadow: '0 0 8px rgba(249,115,22,0.55)',
                    }}
                  />
                  {pendingSuggestions > 1 && (
                    <span className="text-[9px] font-semibold text-orange-300/90 leading-none">+{pendingSuggestions - 1}</span>
                  )}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 min-w-0 overflow-y-auto px-3 py-3 md:px-6 md:py-5">
          <div className="mb-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5 md:px-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/42">Bereich</p>
                <h1 className="truncate text-base font-semibold text-white">{activeTab.label}</h1>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[10px] md:text-[11px]">
                <span className="rounded-full border border-white/[0.09] bg-black/20 px-2.5 py-1 text-white/50">
                  {config.retellAgentId ? 'Aktiv' : 'Entwurf'}
                </span>
                <span className={`rounded-full border px-2.5 py-1 ${isDirty ? 'border-orange-300/25 bg-orange-400/10 text-orange-100' : 'border-green-300/18 bg-green-400/8 text-green-100/70'}`}>
                  {isDirty ? 'Ungespeichert' : 'Gespeichert'}
                </span>
              </div>
            </div>
          </div>

      {tab === 'identity' && (
        <>
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
          <BehaviorTab
            config={config}
            activePromptSections={activePromptSections}
            onUpdate={update}
            onTogglePromptSection={togglePromptSection}
            onSetActivePromptSections={setActivePromptSections}
            onNavigateTab={(route) => {
              if (route === 'behavior') {
                setTab('identity');
                return;
              }
              const KNOWN = new Set(['identity', 'knowledge', 'capabilities', 'privacy', 'technical', 'webhooks', 'preview']);
              if (KNOWN.has(route)) setTab(route as typeof tab);
            }}
            onConfigRefresh={async () => {
              await loadConfig({ resetView: false });
              void getInsights()
                .then((d) => setPendingSuggestions(d.suggestions.filter((s) => s.status === 'pending').length))
                .catch(() => {});
            }}
          />
        </>
      )}

      {tab === 'knowledge' && (
        <KnowledgeTab config={config} onUpdate={update} />
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

function AgentStatsRow({
  config,
  voices,
  billing,
  stats,
  fetchedAt,
  refreshing,
  onRefresh,
}: {
  config: AgentConfig;
  voices: Voice[];
  billing: BillingStatus | null;
  stats: AgentStats | null;
  fetchedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const voice = voices.find((v) => v.voice_id === config.voice);
  const surcharge = voice ? voiceSurcharge(voice) : 0;

  // Price/Min: 0 while inside plan-included minutes, otherwise overage
  // + premium surcharge. Overage rate comes from /billing/status which
  // reads the canonical PLANS table on the API — handles free, nummer
  // (8,99 €, 70 Min inkl.), starter, pro, agency without a frontend map.
  const remaining = billing?.minutesRemaining ?? 0;
  const overage = billing?.overchargePerMinute ?? 0;
  const insidePlan = remaining > 0;
  const effectivePrice = insidePlan ? surcharge : overage + surcharge;
  const priceTip = insidePlan
    ? `Innerhalb der ${billing?.minutesLimit ?? 0} Inklusiv-Minuten deines Plans${surcharge > 0 ? ` · Premium-Aufschlag +${Math.round(surcharge * 100)} Ct/Min` : ''}`
    : `Inklusiv-Minuten aufgebraucht — ${overage.toFixed(2)} € Überschreitung${surcharge > 0 ? ` + ${Math.round(surcharge * 100)} Ct Premium` : ''} pro Minute`;

  // Real measured latency from Retell. Primary = E2E p50 when measured,
  // because that is what callers actually feel. Breakdown (LLM, TTS,
  // ASR, E2E) goes into the tooltip so users can see where the time goes.
  const measuredMs = stats?.latencyMs ?? null;
  const hasData = typeof measuredMs === 'number' && measuredMs > 0 && (stats?.sampleSize ?? 0) > 0;
  const bk = stats?.breakdownMs;
  const breakdownStr = bk
    ? [
        bk.llm != null ? `LLM ${bk.llm}` : null,
        bk.knowledge_base != null ? `KB ${bk.knowledge_base}` : null,
        bk.tts != null ? `TTS ${bk.tts}` : null,
        bk.asr != null ? `ASR ${bk.asr}` : null,
        bk.e2e != null ? `E2E ${bk.e2e}` : null,
      ].filter(Boolean).join(' · ')
    : '';

  // Live updating: poll every 15 s, re-fetch instantly when the user
  // comes back to the tab (visibilitychange) or re-focuses the window.
  // Retell's listCalls is cheap and measured against our 20-call cap,
  // so 15 s is safe and makes the number feel real-time to the user.
  useEffect(() => {
    const t = setInterval(onRefresh, 15_000);
    const onVis = () => { if (!document.hidden) onRefresh(); };
    const onFocus = () => onRefresh();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [onRefresh]);

  // Human-friendly "x s ago" stamp — kept on an interval so the tooltip
  // updates without needing a full re-render.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const ageSec = fetchedAt ? Math.max(0, Math.round((nowTick - fetchedAt) / 1000)) : null;
  const ageStr =
    ageSec == null ? 'noch nicht geladen' :
    ageSec < 5 ? 'gerade eben' :
    ageSec < 60 ? `vor ${ageSec} s` :
    `vor ${Math.round(ageSec / 60)} min`;

  let latencyLabel = '-';
  let latencyColor = 'text-white/50 bg-white/5 border-white/10';
  // "vor X" relative to the actual call timestamp, shown in tooltip only.
  let callAgo = '';
  if (stats?.lastCallAt) {
    const diffSec = Math.max(0, Math.round((Date.now() - stats.lastCallAt) / 1000));
    callAgo = diffSec < 60 ? `vor ${diffSec} s`
      : diffSec < 3600 ? `vor ${Math.round(diffSec / 60)} min`
      : `vor ${Math.round(diffSec / 3600)} h`;
  }
  // Tooltip explains whether the headline is measured E2E or a model
  // baseline fallback, then shows recent p50/p95 for diagnosis.
  const modelLine = stats?.modelName ? `Modell: ${stats.modelName}` : '';
  const measured = stats?.measuredLlmMs;
  const recent = stats?.recentLatencyMs;
  const knowledgeLine = recent?.knowledge_base?.p50 != null
    ? `Knowledge Base: p50 ${recent.knowledge_base.p50} ms - p95 ${recent.knowledge_base.p95 ?? '-'} ms - ${recent.knowledge_base.samples} Samples`
    : 'Knowledge Base: -';
  const recentLine = recent?.e2e?.p50 != null
    ? `Recent E2E: p50 ${recent.e2e.p50} ms - p95 ${recent.e2e.p95 ?? '-'} ms - ${recent.e2e.samples} Samples`
    : 'Recent E2E: -';
  const measuredLine = measured != null
    ? `Gemessen letzter Call: ${measured} ms (LLM p50)`
    : 'Gemessen letzter Call: - (noch kein Call)';
  const latencyTip = hasData
    ? `${stats?.latencySource === 'values' ? 'Gemessene E2E-Latenz' : 'Modell-Baseline fuer dieses Modell'}
${modelLine}
${recentLine}
${knowledgeLine}
${measuredLine}
${breakdownStr ? `Breakdown: ${breakdownStr}` : ''}
Call ${callAgo} - live ${ageStr}`
    : '';

  if (hasData) {
    const ms = measuredMs as number;
    // E2E voice preview: below ~1.8s feels snappy, 1.8-3s is usable,
    // above that callers perceive the bot as slow.
    if (ms < 1800) { latencyLabel = 'Schnell'; latencyColor = 'text-green-400 bg-green-500/10 border-green-500/25'; }
    else if (ms < 3000) { latencyLabel = 'Normal'; latencyColor = 'text-white/65 bg-white/5 border-white/15'; }
    else { latencyLabel = 'Langsam'; latencyColor = 'text-yellow-400 bg-yellow-500/10 border-yellow-500/25'; }
  }

  // Outer tooltip: short. Everything else lives on each chip.
  const outerTip = hasData
    ? `Live-System - ${ageStr} - klick zum Aktualisieren`
    : stats?.error === 'not_deployed'
      ? 'Agent noch nicht aktiviert - Zahl erscheint sobald der erste echte Call lief.'
      : stats?.error === 'retell_unreachable'
        ? 'Live-System gerade nicht erreichbar - wird automatisch weiter versucht, klick fuer sofortigen Retry.'
        : 'Noch keine Latenz-Daten - erscheint sobald der erste Call ausgewertet ist.';

  return (
    <div
      className="hidden xl:flex items-stretch rounded-xl border border-white/8 bg-white/[0.03] overflow-hidden text-xs relative cursor-pointer"
      title={outerTip}
      onClick={onRefresh}
    >
      {/* Live pulse indicator — subtle green dot on the top-left corner
          that briefly flashes orange while a refresh is in flight. */}
      <span
        className={`absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full ${refreshing ? 'bg-orange-400' : 'bg-green-400'}`}
        style={{
          animation: refreshing ? 'spin 0.8s linear' : 'breathe 2.2s ease-in-out infinite',
          boxShadow: refreshing ? '0 0 8px rgba(251,146,60,0.6)' : '0 0 6px rgba(74,222,128,0.5)',
        }}
        aria-hidden="true"
      />
      <StatChip label="Preis / Min" value={`${effectivePrice.toFixed(2)} €`} title={priceTip} />
      <Divider />
      <StatChip
        label="Frei-Min"
        value={`${Math.max(0, Math.floor(remaining))}`}
        valueClass={remaining <= 0 ? 'text-yellow-400' : undefined}
        title={`${Math.max(0, Math.floor(remaining))} von ${billing?.minutesLimit ?? 0} Inklusiv-Minuten übrig`}
      />
      <Divider />
      <StatChip
        label="Latenz"
        value={hasData ? `${measuredMs} ms` : '—'}
        title={hasData ? latencyTip : outerTip}
        icon={<IconBolt size={12} className="text-orange-300/70" />}
      />
      <Divider />
      <StatChip
        label="Status"
        value={latencyLabel}
        title={hasData ? latencyTip : outerTip}
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
  icon,
}: {
  label: string;
  value: string;
  valueClass?: string;
  title?: string;
  badgeClass?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col px-3 py-1.5 min-w-[78px]" title={title}>
      <span className="text-[9px] font-semibold text-white/40 uppercase tracking-wider leading-none mb-0.5 flex items-center gap-1">
        {icon}
        {label}
      </span>
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
