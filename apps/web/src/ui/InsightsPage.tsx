import React, { useEffect, useState, useMemo } from 'react';
import { IconPhone, IconInsights, IconStar } from './PhonbotIcons.js';
import {
  getInsights,
  applyInsightSuggestion,
  rejectInsightSuggestion,
  restorePromptVersion,
  triggerConsolidation,
  type InsightsData,
  type PromptSuggestion,
  type CallAnalysis,
  type PromptVersion,
  type AbTest,
} from '../lib/api.js';

const CATEGORY_LABELS: Record<string, string> = {
  misunderstanding: 'Missverständnis',
  wrong_info: 'Falsche Info',
  escalation: 'Eskalation',
  unanswered: 'Unbeantwortet',
  frustration: 'Kundenfrustration',
  other: 'Sonstiges',
};

const CATEGORY_COLORS: Record<string, string> = {
  misunderstanding: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  wrong_info: 'text-red-400 bg-red-400/10 border-red-400/20',
  escalation: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
  unanswered: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  frustration: 'text-pink-400 bg-pink-400/10 border-pink-400/20',
  other: 'text-white/40 bg-white/5 border-white/10',
};

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8 ? 'text-green-400 border-green-400/30 bg-green-400/10'
    : score >= 6 ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10'
    : 'text-red-400 border-red-400/30 bg-red-400/10';
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold border ${color}`}>
      {score}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 8 ? '#4ade80' : score >= 6 ? '#facc15' : '#f87171';
  return (
    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

function SuggestionCard({
  s,
  threshold,
  onApply,
  onReject,
}: {
  s: PromptSuggestion;
  threshold: number;
  onApply: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [loading, setLoading] = useState<'apply' | 'reject' | null>(null);
  const catColor = CATEGORY_COLORS[s.category] ?? CATEGORY_COLORS.other;
  const progress = Math.min(s.occurrence_count / threshold, 1);
  const isAutoApplied = s.status === 'auto_applied';
  const isApplied = s.status === 'applied' || isAutoApplied;
  const isRejected = s.status === 'rejected';

  return (
    <div className={`glass rounded-2xl p-5 border transition-all duration-200 ${
      isApplied ? 'border-green-500/20 opacity-70' :
      isRejected ? 'border-white/5 opacity-40' :
      'border-white/10 hover:border-white/20'
    }`}>
      <div className="flex items-start gap-3 mb-3">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border shrink-0 ${catColor}`}>
          {CATEGORY_LABELS[s.category] ?? s.category}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/70">{s.issue_summary}</p>
        </div>
        {isApplied && (
          <span className="text-xs text-green-400 shrink-0">
            {isAutoApplied ? '✓ Auto-angewendet' : '✓ Angewendet'}
          </span>
        )}
        {isRejected && (
          <span className="text-xs text-white/30 shrink-0">✕ Abgelehnt</span>
        )}
      </div>

      {/* Suggested addition */}
      <div className="bg-white/[0.03] border border-white/5 rounded-xl p-3 mb-3">
        <p className="text-xs text-white/30 uppercase tracking-wide mb-1.5">Vorgeschlagene Prompt-Ergänzung</p>
        <p className="text-sm text-white/80 font-mono leading-relaxed">{s.suggested_addition}</p>
      </div>

      {/* Occurrence progress */}
      {!isApplied && !isRejected && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-white/30 mb-1.5">
            <span>{s.occurrence_count}× aufgetreten</span>
            <span>Auto-Anwendung bei {threshold}×</span>
          </div>
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress * 100}%`,
                background: progress >= 1 ? '#4ade80' : 'linear-gradient(to right, #F97316, #06B6D4)',
              }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      {!isApplied && !isRejected && (
        <div className="flex gap-2">
          <button
            onClick={async () => { setLoading('apply'); await onApply(s.id); setLoading(null); }}
            disabled={loading !== null}
            className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50
              transition-all duration-200 hover:shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:scale-[1.01]"
            style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
          >
            {loading === 'apply' ? '…' : 'Jetzt anwenden'}
          </button>
          <button
            onClick={async () => { setLoading('reject'); await onReject(s.id); setLoading(null); }}
            disabled={loading !== null}
            className="px-4 py-2 rounded-xl text-sm text-white/40 border border-white/10
              hover:border-white/20 hover:text-white/60 transition-all disabled:opacity-50"
          >
            {loading === 'reject' ? '…' : 'Ablehnen'}
          </button>
        </div>
      )}
    </div>
  );
}

function AbTestCard({ t }: { t: AbTest }) {
  const isRunning = t.status === 'running';
  const isPromoted = t.status === 'promoted';
  const progress = Math.min(t.variant_calls / t.calls_target, 1);
  const date = new Date(t.created_at).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const lift = t.variant_avg_score != null && t.control_avg_score != null
    ? Math.round((t.variant_avg_score - t.control_avg_score) * 10) / 10
    : null;

  return (
    <div className={`glass rounded-2xl p-5 border ${
      isRunning ? 'border-blue-400/30 bg-blue-400/[0.03]' :
      isPromoted ? 'border-green-500/20' : 'border-red-500/20 opacity-60'
    }`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-blue-400 animate-pulse' : isPromoted ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-sm font-semibold text-white/80">
            {isRunning ? 'A/B-Test läuft' : isPromoted ? 'A/B-Test: Übernommen' : 'A/B-Test: Rollback'}
          </span>
        </div>
        <span className="text-xs text-white/30">{date}</span>
      </div>

      {/* Score comparison */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1 bg-white/[0.03] rounded-xl p-3 border border-white/5 text-center">
          <p className="text-xs text-white/30 mb-1">Kontrolle (vorher)</p>
          <p className="text-xl font-bold text-white/60">
            {t.control_avg_score != null ? t.control_avg_score.toFixed(1) : '—'}
          </p>
        </div>
        <div className={`text-lg font-bold ${lift == null ? 'text-white/20' : lift > 0 ? 'text-green-400' : lift < 0 ? 'text-red-400' : 'text-white/40'}`}>
          {lift != null ? (lift > 0 ? `+${lift}` : `${lift}`) : '→'}
        </div>
        <div className="flex-1 bg-white/[0.03] rounded-xl p-3 border border-white/5 text-center">
          <p className="text-xs text-white/30 mb-1">Variante (nachher)</p>
          <p className={`text-xl font-bold ${t.variant_avg_score == null ? 'text-white/30' : lift != null && lift > 0 ? 'text-green-400' : lift != null && lift < 0 ? 'text-red-400' : 'text-white/60'}`}>
            {t.variant_avg_score != null ? t.variant_avg_score.toFixed(1) : '…'}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {isRunning && (
        <div>
          <div className="flex justify-between text-xs text-white/30 mb-1.5">
            <span>{t.variant_calls} / {t.calls_target} Anrufe</span>
            <span>Auswertung nach {t.calls_target} Anrufen</span>
          </div>
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress * 100}%`, background: 'linear-gradient(to right, #3b82f6, #06B6D4)' }}
            />
          </div>
        </div>
      )}

      {!isRunning && t.decision_reason && (
        <p className="text-xs text-white/30 font-mono">{t.decision_reason}</p>
      )}
    </div>
  );
}

function CallCard({ a }: { a: CallAnalysis }) {
  const [open, setOpen] = useState(false);
  const date = new Date(a.created_at).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="glass rounded-xl border border-white/10 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
      >
        <ScoreBadge score={a.score} />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-white/30 mb-0.5">{date}</p>
          <ScoreBar score={a.score} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {a.bad_moments.length > 0 && (
            <span className="text-xs text-red-400/70 bg-red-400/10 border border-red-400/20 px-2 py-0.5 rounded-md">
              {a.bad_moments.length} Problem{a.bad_moments.length !== 1 ? 'e' : ''}
            </span>
          )}
          <span className="text-white/20 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
          {a.overall_feedback && (
            <p className="text-sm text-white/50 italic">{a.overall_feedback}</p>
          )}
          {a.bad_moments.map((m, i) => {
            const catColor = CATEGORY_COLORS[m.category] ?? CATEGORY_COLORS.other;
            return (
              <div key={i} className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded border ${catColor}`}>
                    {CATEGORY_LABELS[m.category] ?? m.category}
                  </span>
                </div>
                {m.quote && (
                  <blockquote className="text-xs text-white/40 font-mono border-l-2 border-white/10 pl-2 mb-2">
                    "{m.quote}"
                  </blockquote>
                )}
                <p className="text-xs text-white/60">{m.issue}</p>
              </div>
            );
          })}
          {a.bad_moments.length === 0 && (
            <p className="text-sm text-green-400/70">Keine Probleme erkannt — gutes Gespräch!</p>
          )}
        </div>
      )}
    </div>
  );
}

const REASON_LABELS: Record<string, string> = {
  fix_addition: 'Fix angewendet',
  consolidation: 'Prompt konsolidiert',
  auto_rollback: '⚠️ Auto-Rollback',
  manual_restore: 'Manuell wiederhergestellt',
  holistic_review: 'Holistische Analyse',
};

function VersionCard({ v, onRestore }: { v: PromptVersion; onRestore: (id: string) => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const isRollback = v.reason.includes('rollback') || v.reason.includes('restore');
  const date = new Date(v.created_at).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className={`glass rounded-xl p-4 border flex items-start gap-3 ${isRollback ? 'border-orange-500/20' : 'border-white/10'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-white/50">{date}</span>
          <span className="text-xs text-white/30 bg-white/5 px-2 py-0.5 rounded">
            {REASON_LABELS[v.reason] ?? v.reason}
          </span>
          {v.avg_score != null && (
            <span className={`text-xs font-semibold ${v.avg_score >= 7 ? 'text-green-400' : v.avg_score >= 5 ? 'text-yellow-400' : 'text-red-400'}`}>
              Ø {v.avg_score}
            </span>
          )}
        </div>
        <p className="text-xs text-white/30 font-mono truncate">{v.prompt_preview}…</p>
      </div>
      <button
        onClick={async () => { setLoading(true); await onRestore(v.id); setLoading(false); }}
        disabled={loading}
        className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/40
          hover:border-white/30 hover:text-white/70 transition-all disabled:opacity-30"
      >
        {loading ? '…' : 'Wiederherstellen'}
      </button>
    </div>
  );
}

export function InsightsPage() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consolidating, setConsolidating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getInsights());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleApply(id: string) {
    await applyInsightSuggestion(id);
    await load();
  }

  async function handleReject(id: string) {
    await rejectInsightSuggestion(id);
    await load();
  }

  async function handleRestore(id: string) {
    await restorePromptVersion(id);
    await load();
  }

  async function handleConsolidate() {
    setConsolidating(true);
    try { await triggerConsolidation(); await load(); } finally { setConsolidating(false); }
  }

  const pending = useMemo(() => data?.suggestions.filter(s => s.status === 'pending') ?? [], [data?.suggestions]);
  const applied = useMemo(() => data?.suggestions.filter(s => s.status === 'applied' || s.status === 'auto_applied') ?? [], [data?.suggestions]);
  const trend = data?.trend;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white px-6 py-10">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute -top-60 right-1/4 w-[350px] sm:w-[600px] h-[350px] sm:h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.07) 0%, transparent 65%)' }}
        />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold mb-1">🧠 KI-Insights</h1>
            <p className="text-white/50 text-sm">
              Jeder Anruf wird analysiert. Wiederkehrende Probleme werden automatisch behoben.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {trend && (
              <div className={`glass rounded-2xl px-4 py-3 border text-center ${
                trend.direction === 'up' ? 'border-green-500/20' :
                trend.direction === 'down' ? 'border-red-500/20' : 'border-white/10'
              }`}>
                <p className={`text-xl font-bold ${
                  trend.direction === 'up' ? 'text-green-400' :
                  trend.direction === 'down' ? 'text-red-400' : 'text-white/50'
                }`}>
                  {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}
                  {' '}{Math.abs(trend.delta)}
                </p>
                <p className="text-xs text-white/30 mt-0.5">Trend</p>
              </div>
            )}
            {data?.avg_score !== null && data?.avg_score !== undefined && (
              <div className="glass rounded-2xl px-5 py-3 border border-white/10 text-center">
                <p className="text-3xl font-bold text-white">{data.avg_score}</p>
                <p className="text-xs text-white/40 mt-0.5">Ø Score</p>
              </div>
            )}
          </div>
        </div>

        {/* How it works */}
        <div className="glass rounded-2xl p-5 border border-white/10 mb-8">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-3">So funktioniert es</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-center">
            {[
              { icon: <IconPhone size={22} />, title: 'Anruf endet', desc: 'Transkript wird analysiert' },
              { icon: <IconInsights size={22} />, title: 'Muster erkannt', desc: `Gleiches Problem ${data?.auto_apply_threshold ?? 3}× → Vorschlag` },
              { icon: <IconStar size={22} />, title: 'Prompt verbessert', desc: 'Auto oder manuell angewendet' },
            ].map((s, i) => (
              <div key={i}>
                <div className="flex justify-center mb-1 text-white/50">{s.icon}</div>
                <p className="text-xs font-semibold text-white/70">{s.title}</p>
                <p className="text-xs text-white/30 mt-0.5">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {loading && (
          <div className="space-y-6 animate-pulse">
            {/* Skeleton: suggestions */}
            <div>
              <div className="h-4 w-40 bg-white/10 rounded mb-3" />
              {[1, 2].map(i => (
                <div key={i} className="glass rounded-2xl p-5 border border-white/10 mb-3">
                  <div className="h-4 w-3/4 bg-white/8 rounded mb-2" />
                  <div className="h-3 w-full bg-white/5 rounded mb-1" />
                  <div className="h-3 w-2/3 bg-white/5 rounded mb-3" />
                  <div className="flex gap-2">
                    <div className="h-8 w-28 bg-white/8 rounded-lg" />
                    <div className="h-8 w-20 bg-white/5 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
            {/* Skeleton: version history */}
            <div>
              <div className="h-4 w-36 bg-white/10 rounded mb-3" />
              {[1, 2, 3].map(i => (
                <div key={i} className="glass rounded-xl p-4 border border-white/10 mb-2 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/8" />
                  <div className="flex-1">
                    <div className="h-3 w-48 bg-white/8 rounded mb-1" />
                    <div className="h-2 w-24 bg-white/5 rounded" />
                  </div>
                  <div className="h-6 w-14 bg-white/5 rounded" />
                </div>
              ))}
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="glass rounded-2xl p-5 border border-red-500/20 bg-red-500/5 mb-6">
            <p className="text-sm text-red-300">⚠️ {error}</p>
            <button onClick={load} className="mt-2 text-xs text-white/40 hover:text-white/60 transition-colors">
              Erneut versuchen
            </button>
          </div>
        )}

        {!loading && data && (
          <>
            {/* Pending suggestions */}
            {pending.length > 0 && (
              <div className="mb-8">
                <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-3">
                  Offene Vorschläge ({pending.length})
                </h2>
                <div className="space-y-3">
                  {pending.map(s => (
                    <SuggestionCard
                      key={s.id}
                      s={s}
                      threshold={data.auto_apply_threshold}
                      onApply={handleApply}
                      onReject={handleReject}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* A/B Tests */}
            {data.ab_tests.length > 0 && (
              <div className="mb-8">
                <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-3">
                  A/B-Tests ({data.ab_tests.filter(t => t.status === 'running').length} aktiv)
                </h2>
                <div className="space-y-3">
                  {data.ab_tests.map(t => <AbTestCard key={t.id} t={t} />)}
                </div>
              </div>
            )}

            {/* Recent calls */}
            {data.analyses.length > 0 && (
              <div className="mb-8">
                <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-3">
                  Letzte Anrufe
                </h2>
                <div className="space-y-2">
                  {data.analyses.map(a => (
                    <CallCard key={a.call_id} a={a} />
                  ))}
                </div>
              </div>
            )}

            {/* Applied suggestions history */}
            {applied.length > 0 && (
              <div className="mb-8">
                <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-3">
                  Angewendete Verbesserungen ({applied.length})
                </h2>
                <div className="space-y-3">
                  {applied.map(s => (
                    <SuggestionCard
                      key={s.id}
                      s={s}
                      threshold={data.auto_apply_threshold}
                      onApply={handleApply}
                      onReject={handleReject}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Prompt version history */}
            {data.prompt_versions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest">
                    Prompt-Verlauf
                  </h2>
                  <button
                    onClick={handleConsolidate}
                    disabled={consolidating}
                    className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/40
                      hover:border-white/30 hover:text-white/70 transition-all disabled:opacity-30"
                  >
                    {consolidating ? '⟳ Läuft…' : '✦ Jetzt konsolidieren'}
                  </button>
                </div>
                <div className="space-y-2">
                  {data.prompt_versions.map(v => (
                    <VersionCard key={v.id} v={v} onRestore={handleRestore} />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {data.analyses.length === 0 && pending.length === 0 && (
              <div className="glass rounded-2xl p-10 border border-white/10 text-center">
                <p className="text-4xl mb-3">🧠</p>
                <h3 className="text-lg font-semibold text-white mb-2">Noch keine Daten</h3>
                <p className="text-sm text-white/40">
                  Nach dem ersten Anruf erscheinen hier die KI-Analysen und Verbesserungsvorschläge.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
