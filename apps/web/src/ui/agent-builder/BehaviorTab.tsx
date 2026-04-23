import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getInsights,
  applyInsightSuggestion,
  rejectInsightSuggestion,
  type AgentConfig,
  type PromptSuggestion,
} from '../../lib/api.js';
import {
  SectionCard, Input, Toggle,
  PROMPT_TEMPLATES, PROMPT_SECTIONS, KNOWN_TOOLS,
  assembleRolePrompt, generalAssistantBlock, roleIntro, roleTaskList,
  IconTemplate, IconMessageSquare,
} from './shared.js';
import { AdaptiveTextarea } from '../../components/AdaptiveTextarea.js';

export interface BehaviorTabProps {
  config: AgentConfig;
  activePromptSections: Set<string>;
  onUpdate: (patch: Partial<AgentConfig>) => void;
  onTogglePromptSection: (sectionId: string) => void;
  onSetActivePromptSections: (sections: Set<string>) => void;
  /** Parent refetches the agent config so the textarea shows the new prompt
   *  after a suggestion is applied server-side (jsonb_set on agent_configs). */
  onConfigRefresh?: () => void | Promise<void>;
  /** Called when a manual-setup suggestion's "Zur Einstellung" button fires.
   *  Route examples: 'identity' | 'knowledge' | 'capabilities' | 'phone'. */
  onNavigateTab?: (route: string) => void;
}

// Two kinds of suggestion. Default = prompt_addition (one click → server
// appends to systemPrompt, banner goes away). manual_setup = something the
// user has to fill in themselves (e.g. opening hours, a calendar connection);
// banner persists until they do it OR reject — CTA is a deep-link button
// instead of Übernehmen.
//
// Detection: when the backend flags a suggestion as manual, it prefixes the
// suggested_addition with `[MANUAL:<route>]` — e.g. `[MANUAL:knowledge]`.
// Today the backend only produces prompt_addition, but the UI is ready so
// we don't have to redesign on the day that changes.
const MANUAL_PREFIX_RE = /^\[MANUAL:(\w+)\]\s*/;

// Detect placeholders in a suggestion that the customer is expected to fill
// before it makes sense to apply. Chipy sometimes drafts "Wenn nach Parkplätzen
// gefragt wird, sage: [Parkinfo hier eintragen]" — applying that verbatim
// would be worse than not having the suggestion at all. The banner disables
// Übernehmen until the placeholder is replaced with real content.
function unfilledPlaceholderHint(text: string): string | null {
  if (!text || !text.trim()) return 'Bitte Text eintragen — Chipy hat nichts, womit er arbeiten könnte.';
  // Curly-brace template var: {{INSERT_INFO}}
  if (/\{\{[^{}]+\}\}/.test(text)) return 'Ersetze die Platzhalter in doppelten geschweiften Klammern mit den echten Infos.';
  // Bracket instruction — lowercased keyword list covers the variants Chipy uses
  if (/\[[^\]]*(eintragen|ergänzen|einfügen|ausfüllen|ergaenzen|einfuegen|bitte|hier)[^\]]*\]/i.test(text)) {
    return 'Der Platzhalter in eckigen Klammern muss durch echte Infos ersetzt werden, bevor du übernehmen kannst.';
  }
  // Placeholder words alone (uppercase constants Chipy sometimes puts inline)
  if (/\b(HIER_EINSETZEN|BITTE_EINTRAGEN|TODO|FIXME)\b/.test(text)) {
    return 'Der Platzhalter muss durch echte Infos ersetzt werden, bevor du übernehmen kannst.';
  }
  return null;
}

type SuggestionKind =
  | { kind: 'prompt_addition'; addition: string }
  | { kind: 'manual_setup'; route: string; instruction: string };

function classifySuggestion(s: PromptSuggestion): SuggestionKind {
  const m = s.suggested_addition.match(MANUAL_PREFIX_RE);
  if (m) {
    return { kind: 'manual_setup', route: m[1] ?? 'identity', instruction: s.suggested_addition.replace(MANUAL_PREFIX_RE, '') };
  }
  return { kind: 'prompt_addition', addition: s.suggested_addition };
}

// Suggestion banner — surfaces pending prompt-suggestions directly in the
// Behavior tab. Apply/Reject hits /insights/suggestions/:id/* (same as the
// Insights page). onApply calls the parent's onConfigRefresh after success
// so the TextArea reflects the server-side jsonb_set immediately.
function SuggestionBanner({
  suggestions,
  onApply,
  onReject,
  onNavigate,
}: {
  suggestions: PromptSuggestion[];
  onApply: (id: string, customText?: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onNavigate?: (route: string) => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [editedText, setEditedText] = useState<string | null>(null);
  // Reset the per-suggestion edit buffer whenever a new suggestion surfaces.
  // Without this, dismissing suggestion A and then seeing suggestion B would
  // show A's edited text in B's textarea.
  useEffect(() => { setEditedText(null); }, [suggestions[0]?.id]);

  if (!suggestions.length) return null;
  const s = suggestions[0]!; // focus on the newest; deeper list lives in /insights
  const kind = classifySuggestion(s);
  const displayText = editedText ?? (kind.kind === 'manual_setup' ? kind.instruction : kind.addition);
  const originalText = kind.kind === 'manual_setup' ? kind.instruction : kind.addition;
  const dirty = editedText !== null && editedText !== originalText;
  // Only gate the prompt-addition flow — manual-setup has its own "Zur
  // Einstellung" path where the filling happens on the target tab.
  const placeholderHint = kind.kind === 'prompt_addition' ? unfilledPlaceholderHint(displayText) : null;
  const canApply = !placeholderHint;

  return (
    <div
      className="relative glass rounded-2xl p-5 mb-5 overflow-hidden"
      style={{
        border: '1px solid rgba(249,115,22,0.22)',
        background: 'linear-gradient(135deg, rgba(249,115,22,0.05) 0%, rgba(6,182,212,0.03) 100%)',
      }}
    >
      {/* Soft glow edge — hints at the orange→cyan brand without shouting */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl opacity-40"
        style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.25) 0%, transparent 70%)' }}
      />
      <div className="relative flex items-start gap-3">
        <div
          className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(6,182,212,0.15))', border: '1px solid rgba(249,115,22,0.2)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-orange-300">
            <path d="M12 2l2.39 6.95H21l-5.3 4.38L17.4 20 12 15.9 6.6 20l1.7-6.67L3 8.95h6.61z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-orange-300/85">Chipy hat was gelernt</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${
              kind.kind === 'manual_setup'
                ? 'text-cyan-300/90 bg-cyan-400/10 border-cyan-400/20'
                : 'text-orange-300/80 bg-orange-400/8 border-orange-400/15'
            }`}>
              {kind.kind === 'manual_setup' ? 'Manuelle Anpassung' : 'Auto-Anwendung'}
            </span>
            {suggestions.length > 1 && (
              <span className="text-[10px] text-white/40">· {suggestions.length - 1} weitere</span>
            )}
          </div>
          <p className="text-sm text-white/85 font-medium leading-snug">{s.issue_summary}</p>
          {expanded && (
            <div className="mt-3 rounded-xl bg-black/30 border border-white/[0.06] p-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] uppercase tracking-wider text-white/30">
                  {kind.kind === 'manual_setup' ? 'Anleitung' : 'Prompt-Ergänzung — du kannst sie vor dem Übernehmen anpassen'}
                </p>
                {dirty && (
                  <button
                    type="button"
                    onClick={() => setEditedText(null)}
                    className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                  >
                    Zurücksetzen
                  </button>
                )}
              </div>
              {kind.kind === 'manual_setup' ? (
                <p className="text-xs text-white/70 font-mono leading-relaxed whitespace-pre-wrap">
                  {kind.instruction}
                </p>
              ) : (
                <textarea
                  value={displayText}
                  onChange={(e) => setEditedText(e.target.value)}
                  rows={Math.max(3, Math.min(10, displayText.split('\n').length + 1))}
                  className="w-full resize-y rounded-lg bg-black/40 border border-white/[0.08] focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/30 outline-none text-xs text-white/80 font-mono leading-relaxed p-2.5"
                  spellCheck={false}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-4 flex flex-wrap items-center gap-2">
        {kind.kind === 'prompt_addition' ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading !== null || !canApply}
              title={placeholderHint ?? undefined}
              onClick={async () => {
                if (!canApply) return;
                setLoading('apply');
                try { await onApply(s.id, dirty ? displayText : undefined); } finally { setLoading(null); }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_24px_rgba(249,115,22,0.35)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              {loading === 'apply' ? 'Übernimmt…' : dirty ? 'Mit deiner Version übernehmen' : 'Übernehmen'}
            </button>
            {placeholderHint && (
              <span className="text-[11px] text-amber-300/85">
                {placeholderHint}
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => onNavigate?.(kind.route)}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_24px_rgba(6,182,212,0.35)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #06B6D4, #F97316)' }}
          >
            Zur Einstellung →
          </button>
        )}
        <button
          type="button"
          disabled={loading !== null}
          onClick={async () => {
            setLoading('reject');
            try { await onReject(s.id); } finally { setLoading(null); }
          }}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium text-white/55 border border-white/10 bg-white/[0.03] hover:text-white/80 hover:bg-white/[0.06] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Ablehnen
        </button>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="ml-auto text-[11px] text-white/40 hover:text-white/70 transition-colors"
        >
          {expanded ? 'Weniger' : 'Details'}
        </button>
      </div>
    </div>
  );
}

export function BehaviorTab({
  config,
  activePromptSections,
  onUpdate,
  onTogglePromptSection,
  onSetActivePromptSections,
  onConfigRefresh,
  onNavigateTab,
}: BehaviorTabProps) {
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);

  const reloadSuggestions = useCallback(() => {
    getInsights()
      .then((d) => setSuggestions(d.suggestions.filter((s) => s.status === 'pending')))
      .catch(() => { /* ignore — tab still works without the banner */ });
  }, []);

  useEffect(() => { reloadSuggestions(); }, [reloadSuggestions]);

  const handleApply = useCallback(async (id: string, customText?: string) => {
    await applyInsightSuggestion(id, customText);
    // Optimistically drop the applied row so the banner disappears even if
    // the insight-refetch is slow. Then refetch config from server so the
    // TextArea re-renders with the appended text.
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    await onConfigRefresh?.();
    reloadSuggestions();
  }, [onConfigRefresh, reloadSuggestions]);

  const handleReject = useCallback(async (id: string) => {
    await rejectInsightSuggestion(id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    reloadSuggestions();
  }, [reloadSuggestions]);

  return (
    <>
      <SuggestionBanner
        suggestions={suggestions}
        onApply={handleApply}
        onReject={handleReject}
        onNavigate={onNavigateTab}
      />
      <RoleCard config={config} onUpdate={onUpdate} />

      <PromptView config={config} onUpdate={onUpdate} />

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
                onClick={() => onTogglePromptSection(sec.id)}
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

        <div className="mt-4">
          <span className="text-xs font-medium text-white/40 uppercase tracking-wider block mb-2">Aktive Tools</span>
          <div className="flex flex-wrap gap-2">
            {KNOWN_TOOLS.map((tool) => (
              <label key={tool} className="flex items-center gap-2 text-xs cursor-pointer select-none text-white/55">
                <input type="checkbox" checked={config.tools.includes(tool)}
                  onChange={(e) => {
                    const next = new Set(config.tools);
                    e.target.checked ? next.add(tool) : next.delete(tool);
                    onUpdate({ tools: Array.from(next) });
                  }}
                  className="rounded border-white/20 bg-white/5 text-orange-500 focus:ring-orange-500/50" />
                <code className="text-[11px] bg-white/[0.07] text-white/50 px-2 py-0.5 rounded">{tool}</code>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <Toggle checked={config.fallback.enabled}
            onChange={(v) => onUpdate({ fallback: { ...config.fallback, enabled: v } })}
            label="Fallback / Handoff aktiv" />
          {config.fallback.enabled && (
            <Input value={config.fallback.reason}
              onChange={(e) => onUpdate({ fallback: { ...config.fallback, reason: e.target.value } })}
              placeholder="Grund" className="!w-48" />
          )}
        </div>
      </SectionCard>
    </>
  );
}

// ── Role multi-select card ──────────────────────────────────────────────────

/**
 * Legacy prompt migration: old configs only had `systemPrompt`. When a user
 * first opens this tab, we detect that state (no selectedRoles + no custom
 * addition) and keep the old prompt as customPromptAddition so the user
 * doesn't lose their hand-written rules. New role selection then prepends
 * the assembled block above it.
 */
function readCustomAddition(cfg: AgentConfig): string {
  if (typeof cfg.customPromptAddition === 'string') return cfg.customPromptAddition;
  // First time on new UI — show existing systemPrompt as the custom addition.
  return cfg.systemPrompt ?? '';
}

function readSelectedRoles(cfg: AgentConfig): string[] {
  return Array.isArray(cfg.selectedRoles) ? cfg.selectedRoles : [];
}

/** Rebuild the stored `systemPrompt` from the current role selection + the
 *  customer's freeform addition. Always fires the update atomically so the
 *  three fields stay in sync. */
function writeAssembledPrompt(
  cfg: AgentConfig,
  nextRoles: string[],
  nextCustom: string,
  onUpdate: (patch: Partial<AgentConfig>) => void,
) {
  const assembled = assembleRolePrompt(nextRoles, cfg.businessName);
  const full = nextCustom.trim().length > 0 ? `${assembled}\n\n${nextCustom.trim()}` : assembled;
  onUpdate({
    selectedRoles: nextRoles,
    customPromptAddition: nextCustom,
    systemPrompt: full,
  });
}

function updateCustomAddition(
  cfg: AgentConfig,
  text: string,
  onUpdate: (patch: Partial<AgentConfig>) => void,
) {
  writeAssembledPrompt(cfg, readSelectedRoles(cfg), text, onUpdate);
}

function readOverrides(cfg: AgentConfig): Record<string, string> {
  return (cfg.roleBlockOverrides && typeof cfg.roleBlockOverrides === 'object')
    ? cfg.roleBlockOverrides
    : {};
}

// Atomic save of a single role's block override + systemPrompt reassembly.
function writeOverride(
  cfg: AgentConfig,
  roleId: string,
  nextText: string,
  onUpdate: (patch: Partial<AgentConfig>) => void,
) {
  const curOverrides = readOverrides(cfg);
  const roles = readSelectedRoles(cfg);
  const defaultBlock = PROMPT_TEMPLATES.find((t) => t.id === roleId)?.block ?? '';
  const trimmed = nextText;
  // Treat exact-match with default as "no override" — keeps the row clean
  // and lets a future default change propagate if we ever edit a block.
  const nextOverrides: Record<string, string> = { ...curOverrides };
  if (trimmed === defaultBlock) delete nextOverrides[roleId];
  else nextOverrides[roleId] = trimmed;

  const assembled = assembleRolePrompt(roles, cfg.businessName, nextOverrides);
  const custom = readCustomAddition(cfg);
  const full = custom.trim().length > 0 ? `${assembled}\n\n${custom.trim()}` : assembled;
  onUpdate({ roleBlockOverrides: nextOverrides, systemPrompt: full });
}

// ── System-Prompt split view ────────────────────────────────────────────────

function PromptView({
  config,
  onUpdate,
}: {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}) {
  const roleIds = readSelectedRoles(config);
  const overrides = readOverrides(config);
  const customAddition = readCustomAddition(config);
  const selectedRoles = useMemo(
    () => PROMPT_TEMPLATES.filter((t) => roleIds.includes(t.id)),
    [roleIds],
  );
  const intro = useMemo(
    () => (selectedRoles.length === 0 ? '' : roleIntro(config.businessName, selectedRoles.length)),
    [selectedRoles.length, config.businessName],
  );
  const tasks = useMemo(() => roleTaskList(selectedRoles), [selectedRoles]);

  return (
    <SectionCard title="System-Prompt" icon={IconTemplate}>
      <p className="text-xs text-white/40 mb-3">
        So liest der Agent das Gespräch. Jeder farbige Abschnitt ist direkt editierbar — das Textfeld wächst automatisch mit.
      </p>

      <div className="space-y-3">
        {/* Intro + Aufgaben-Liste — auto-generated from selected roles */}
        {selectedRoles.length > 0 && (
          <div
            className="rounded-xl border px-4 py-3"
            style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
          >
            <p className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">
              Automatischer Start · aus deiner Rollen-Auswahl
            </p>
            <pre className="text-xs text-white/75 font-mono leading-relaxed whitespace-pre-wrap break-words">
{intro}{'\n\n'}{tasks}
            </pre>
          </div>
        )}
        {selectedRoles.length === 0 && (
          <div
            className="rounded-xl border px-4 py-3"
            style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
          >
            <p className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">
              Keine Rolle gewählt · allgemeiner Assistent als Fallback
            </p>
            <pre className="text-xs text-white/75 font-mono leading-relaxed whitespace-pre-wrap break-words">
{generalAssistantBlock(config.businessName)}
            </pre>
          </div>
        )}

        {/* One editable card per selected role, colored by its brand hex */}
        {selectedRoles.map((tpl) => {
          const ov = overrides[tpl.id];
          const value = typeof ov === 'string' ? ov : tpl.block;
          const edited = typeof ov === 'string' && ov.trim() !== tpl.block.trim();
          return (
            <div
              key={tpl.id}
              className="rounded-xl border overflow-hidden"
              style={{
                borderColor: `${tpl.hex}40`,
                background: `linear-gradient(135deg, ${tpl.hex}0a 0%, rgba(255,255,255,0.02) 100%)`,
              }}
            >
              <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ borderBottom: `1px solid ${tpl.hex}1f` }}>
                <span
                  className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: `${tpl.hex}1a`, border: `1px solid ${tpl.hex}33` }}
                >
                  <tpl.Icon size={14} className={tpl.accent} />
                </span>
                <span className="text-xs font-semibold text-white/85 flex-1">{tpl.name}</span>
                {edited && (
                  <button
                    type="button"
                    onClick={() => writeOverride(config, tpl.id, tpl.block, onUpdate)}
                    className="text-[10px] text-white/45 hover:text-white/80 transition-colors cursor-pointer"
                    title="Original-Block wiederherstellen"
                  >
                    Zurücksetzen
                  </button>
                )}
              </div>
              <AdaptiveTextarea
                value={value}
                onChange={(e) => writeOverride(config, tpl.id, e.target.value, onUpdate)}
                spellCheck={false}
                className="w-full bg-transparent text-xs text-white/80 font-mono leading-relaxed px-4 py-3 outline-none focus:ring-0 border-0"
              />
            </div>
          );
        })}

        {/* Custom freeform addition — orange accent, always visible */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{
            borderColor: '#F9731640',
            background: 'linear-gradient(135deg, rgba(249,115,22,0.05) 0%, rgba(6,182,212,0.03) 100%)',
          }}
        >
          <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ borderBottom: '1px solid rgba(249,115,22,0.2)' }}>
            <span
              className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.25)' }}
            >
              <IconMessageSquare size={14} className="text-orange-300" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white/85">Deine Ergänzungen</p>
              <p className="text-[10px] text-white/40 leading-tight">Hausregeln, Sonderfälle, Tonalität</p>
            </div>
          </div>
          <AdaptiveTextarea
            value={customAddition}
            onChange={(e) => updateCustomAddition(config, e.target.value, onUpdate)}
            spellCheck={false}
            placeholder="Z.B. Preise, besondere Öffnungs-Regeln, interne Übergabeprozesse…"
            minRows={3}
            className="w-full bg-transparent text-xs text-white/80 font-mono leading-relaxed px-4 py-3 outline-none focus:ring-0 border-0 placeholder:text-white/25"
          />
        </div>
      </div>
    </SectionCard>
  );
}

function RoleCard({
  config,
  onUpdate,
}: {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}) {
  const selected = useMemo(() => new Set(readSelectedRoles(config)), [config.selectedRoles]);
  const [showPreview, setShowPreview] = useState(false);
  const preview = useMemo(
    () => assembleRolePrompt(Array.from(selected), config.businessName),
    [selected, config.businessName],
  );

  function toggleRole(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    writeAssembledPrompt(config, Array.from(next), readCustomAddition(config), onUpdate);
  }

  const empty = selected.size === 0;

  return (
    <SectionCard title="Rolle" icon={IconTemplate}>
      <p className="text-xs text-white/45 mb-3">
        Wähle eine oder mehrere Rollen — Chipy kann gleichzeitig Empfang, Support, Notdienst und Auskunft sein. Die passenden Prompt-Bausteine werden zusammengesetzt.
      </p>

      {empty && (
        <div className="mb-3 rounded-xl border border-orange-500/25 bg-orange-500/[0.06] px-3 py-2 text-[11px] text-orange-200/90">
          Bitte mindestens eine Rolle auswählen. Sonst läuft der Agent als allgemeiner Telefon-Assistent — das ist selten das gewünschte Verhalten.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {PROMPT_TEMPLATES.map((tpl) => {
          const active = selected.has(tpl.id);
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => toggleRole(tpl.id)}
              aria-pressed={active}
              className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-center cursor-pointer ${
                active
                  ? 'border-orange-500/55 bg-orange-500/[0.09] shadow-[0_0_20px_rgba(249,115,22,0.1)]'
                  : 'border-white/[0.07] bg-white/[0.03] hover:border-orange-500/25 hover:bg-white/[0.06]'
              }`}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
              <tpl.Icon size={18} className={active ? tpl.accent : `${tpl.accent} opacity-55 group-hover:opacity-85`} />
              <span className={`text-xs font-medium leading-tight transition-colors ${active ? 'text-white' : 'text-white/65 group-hover:text-white/90'}`}>
                {tpl.name}
              </span>
              <span className="text-[10px] text-white/40 leading-tight">{tpl.capability}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-white/40">
          {selected.size === 0 ? 'Keine Rolle gewählt' : `${selected.size} Rolle${selected.size === 1 ? '' : 'n'} aktiv`}
        </span>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-[11px] text-cyan-300/75 hover:text-cyan-200 transition-colors cursor-pointer"
        >
          {showPreview ? 'Vorschau ausblenden' : 'Zusammengesetzten Rollen-Prompt anzeigen'}
        </button>
      </div>

      {showPreview && (
        <pre className="mt-2 rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2.5 text-[11px] text-white/70 whitespace-pre-wrap break-words leading-relaxed max-h-64 overflow-auto">
{preview}
        </pre>
      )}
    </SectionCard>
  );
}
