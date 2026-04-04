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
  type AgentConfig,
  type AgentPreview,
  type Voice,
} from '../../lib/api.js';
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

  const loadVoices = useCallback(async () => {
    setVoicesLoading(true);
    try {
      const res = await getVoices();
      setVoices(res.voices ?? []);
    } catch {
      // Non-fatal -- voice list stays empty, user can still type voice ID
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
        ...DEFAULT_CONFIG_VALUES,
        ...cfg,
      } as AgentConfig;
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
        ...DEFAULT_CONFIG_VALUES,
        ...cfg,
      } as AgentConfig;
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
      await loadAllAgents(); // refresh agent list after save (name changes etc.)
      setStatus({ type: 'ok', text: 'Gespeichert \✅' });
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
      setStatus({ type: 'ok', text: `Deployed \— Agent: ${result.retellAgentId ?? '\–'}` });
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
    return <div className="p-8 text-white/50">Lade Agent-Konfiguration\…</div>;
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
      />
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
            <span className="text-base leading-none">\‹</span> Agenten
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
              {saving ? 'Speichert\…' : 'Speichern'}
            </button>
          ) : (
            <button
              onClick={handleDeploy}
              disabled={deploying || saving}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 transition-all cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              <IconDeploy size={13} />
              {deploying ? 'Deploying\…' : 'Deploy'}
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
