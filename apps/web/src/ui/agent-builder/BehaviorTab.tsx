import React, { useCallback, useEffect, useState } from 'react';
import {
  getInsights,
  applyInsightSuggestion,
  rejectInsightSuggestion,
  type AgentConfig,
  type PromptSuggestion,
} from '../../lib/api.js';
import {
  SectionCard, TextArea, Input, Toggle,
  PROMPT_TEMPLATES, PROMPT_SECTIONS, KNOWN_TOOLS,
  IconTemplate, IconMessageSquare,
} from './shared.js';

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
      {/* Base Role */}
      <SectionCard title="Grundrolle" icon={IconTemplate} collapsible>
        <p className="text-xs text-white/40 mb-3">Legt fest wofür der Agent hauptsächlich eingesetzt wird — setzt den Prompt zurück.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {PROMPT_TEMPLATES.map((tpl) => (
            <button key={tpl.id} onClick={() => {
              const prompt = tpl.prompt.replace('{businessName}', config.businessName || 'deinem Unternehmen');
              onUpdate({ systemPrompt: prompt });
              onSetActivePromptSections(new Set());
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
            onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
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
