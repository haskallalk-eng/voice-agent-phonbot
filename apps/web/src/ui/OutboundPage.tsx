import { useEffect, useState } from 'react';
import {
  triggerSalesCall,
  getOutboundCalls,
  getOutboundStats,
  getOutboundSuggestions,
  applyOutboundSuggestion,
  rejectOutboundSuggestion,
  updateOutboundOutcome,
  type OutboundCall,
  type OutboundStats,
  type OutboundSuggestion,
} from '../lib/api.js';

type Tab = 'dashboard' | 'call' | 'suggestions';

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  converted:      { label: '✅ Gewonnen',       color: 'text-green-400 bg-green-500/10 border-green-500/20' },
  interested:     { label: '🔥 Interessiert',   color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
  callback:       { label: '📞 Rückruf',         color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  not_interested: { label: '❌ Kein Interesse', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  no_answer:      { label: '📵 Nicht erreicht', color: 'text-white/40 bg-white/5 border-white/10' },
  voicemail:      { label: '📬 Mailbox',         color: 'text-white/40 bg-white/5 border-white/10' },
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-white/30 text-xs">–</span>;
  const color = score >= 7.5 ? 'text-green-400' : score >= 5 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`text-xs font-bold ${color}`}>{score.toFixed(1)}</span>;
}

export function OutboundPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [calls, setCalls] = useState<OutboundCall[]>([]);
  const [stats, setStats] = useState<OutboundStats | null>(null);
  const [suggestions, setSuggestions] = useState<OutboundSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Call form
  const [toNumber, setToNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [campaign, setCampaign] = useState('');
  const [campaignContext, setCampaignContext] = useState('');
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const [callRes, statsRes, suggRes] = await Promise.all([
        getOutboundCalls(),
        getOutboundStats(),
        getOutboundSuggestions(),
      ]);
      setCalls(callRes.items);
      setStats(statsRes);
      setSuggestions(suggRes.items.filter(s => s.status === 'pending'));
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Ladefehler');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCall() {
    if (!toNumber.trim()) return;
    setCalling(true);
    setCallResult(null);
    setError(null);
    try {
      const res = await triggerSalesCall(toNumber, contactName || undefined, campaign || undefined, campaignContext || undefined);
      setCallResult(`Anruf gestartet ✅ Call ID: ${res.callId ?? '–'}`);
      setToNumber('');
      setContactName('');
      setTimeout(load, 3000);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Anruf fehlgeschlagen');
    } finally {
      setCalling(false);
    }
  }

  async function handleOutcome(callId: string, outcome: OutboundCall['outcome']) {
    if (!callId) return;
    try {
      await updateOutboundOutcome(callId, outcome);
      await load();
    } catch { /* ignore */ }
  }

  async function handleApply(id: string) {
    try {
      await applyOutboundSuggestion(id);
      await load();
    } catch { /* ignore */ }
  }

  async function handleReject(id: string) {
    try {
      await rejectOutboundSuggestion(id);
      setSuggestions(prev => prev.filter(s => s.id !== id));
    } catch { /* ignore */ }
  }

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'dashboard', label: '📊 Dashboard' },
    { id: 'call',      label: '📞 Anruf starten' },
    { id: 'suggestions', label: `🧠 Verbesserungen`, badge: suggestions.length },
  ];

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-white mb-1">🎯 Outbound Sales</h1>
      <p className="text-sm text-white/50 mb-6">
        KI-Verkaufsagent mit automatischem Lernzyklus — verbessert seine Conversion nach jedem Gespräch.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 mb-6 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              tab === t.id ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {t.label}
            {t.badge ? (
              <span className="bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          ⚠️ {error}
        </div>
      )}

      {/* Dashboard */}
      {tab === 'dashboard' && (
        <div className="space-y-6">
          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Gesamt', value: stats.total, sub: 'Anrufe' },
                { label: 'Conversion', value: `${stats.conversionRate}%`, sub: 'Gewonnen + Interessiert', highlight: true },
                { label: 'Gewonnen', value: stats.converted, sub: 'Direkt konvertiert' },
                { label: 'Ø Score', value: stats.avgScore !== null ? stats.avgScore.toFixed(1) : '–', sub: 'Gesprächsqualität' },
              ].map((s) => (
                <div key={s.label} className={`glass rounded-2xl p-4 ${s.highlight ? 'border-orange-500/30' : ''}`}>
                  <p className="text-xs text-white/40 mb-1">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.highlight ? 'text-orange-400' : 'text-white'}`}>{s.value}</p>
                  <p className="text-xs text-white/30 mt-0.5">{s.sub}</p>
                </div>
              ))}
            </div>
          )}

          {/* Call list */}
          <div>
            <h2 className="text-sm font-semibold text-white/60 mb-3 uppercase tracking-wide">Letzte Anrufe</h2>
            {loading ? (
              <p className="text-white/30 text-sm">Lade…</p>
            ) : calls.length === 0 ? (
              <div className="text-center py-12 text-white/30">
                <div className="text-4xl mb-3">📭</div>
                <p className="text-sm">Noch keine Outbound-Anrufe.</p>
                <button
                  onClick={() => setTab('call')}
                  className="mt-4 bg-gradient-to-r from-orange-500 to-cyan-500 text-white text-sm font-medium rounded-xl px-4 py-2"
                >
                  Ersten Anruf starten →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {calls.map((c) => (
                  <div key={c.id} className="glass rounded-2xl px-5 py-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-white text-sm">{c.contact_name ?? c.to_number}</p>
                        {c.contact_name && <p className="text-xs text-white/30">{c.to_number}</p>}
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        {c.campaign && <span className="text-xs text-white/40">{c.campaign}</span>}
                        {c.duration_s && <span className="text-xs text-white/30">{Math.floor(c.duration_s / 60)}:{String(c.duration_s % 60).padStart(2, '0')} min</span>}
                        <span className="text-xs text-white/20">v{c.prompt_version}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <ScoreBadge score={c.conv_score} />

                      {c.outcome ? (
                        <span className={`text-xs px-2 py-1 rounded-lg border ${OUTCOME_LABELS[c.outcome]?.color ?? 'text-white/40'}`}>
                          {OUTCOME_LABELS[c.outcome]?.label ?? c.outcome}
                        </span>
                      ) : c.call_id ? (
                        <select
                          onChange={(e) => e.target.value && handleOutcome(c.call_id!, e.target.value as OutboundCall['outcome'])}
                          defaultValue=""
                          className="text-xs bg-white/5 border border-white/10 text-white/60 rounded-lg px-2 py-1"
                        >
                          <option value="" disabled>Ergebnis…</option>
                          {Object.entries(OUTCOME_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-white/20">{c.status}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Call form */}
      {tab === 'call' && (
        <div className="glass rounded-2xl p-6 space-y-5 max-w-lg">
          <div>
            <h2 className="font-semibold text-white mb-1">Outbound-Anruf starten</h2>
            <p className="text-sm text-white/50">
              Der KI-Agent ruft die Nummer an und führt ein strukturiertes Verkaufsgespräch.
            </p>
          </div>

          {callResult && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-sm text-green-400">
              {callResult}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Telefonnummer *</label>
              <input
                type="tel"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                placeholder="+49 30 12345678"
                className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-3 py-2 text-sm placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Kontaktname</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Max Mustermann"
                className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-3 py-2 text-sm placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Kampagne</label>
              <input
                type="text"
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder="Q2 Neukunden"
                className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-3 py-2 text-sm placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">Kampagnen-Kontext (für den Agenten)</label>
              <textarea
                value={campaignContext}
                onChange={(e) => setCampaignContext(e.target.value)}
                placeholder="z.B. Wir bieten KI-Telefonagenten für KMUs an. Ziel: Demo-Termin vereinbaren."
                rows={3}
                className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-3 py-2 text-sm placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/50 resize-none"
              />
            </div>
          </div>

          <button
            onClick={handleCall}
            disabled={calling || !toNumber.trim()}
            className="w-full bg-gradient-to-r from-orange-500 to-cyan-500 hover:opacity-90 disabled:opacity-40 text-white font-medium rounded-2xl py-3 text-sm transition-opacity"
          >
            {calling ? '📞 Verbinde…' : '📞 Jetzt anrufen →'}
          </button>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-xs text-blue-400">
            💡 Der Agent nutzt SPIN-Qualifizierung, Micro-Commitments und präzise Einwandbehandlung.
            Nach dem Gespräch wird es automatisch analysiert und der Prompt verbessert.
          </div>
        </div>
      )}

      {/* Suggestions */}
      {tab === 'suggestions' && (
        <div className="space-y-4">
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3 text-sm text-orange-300">
            🧠 Das Lernsystem analysiert jeden Anruf und schlägt Prompt-Verbesserungen vor. Wende sie an um die Conversion zu steigern.
          </div>

          {suggestions.length === 0 ? (
            <div className="text-center py-12 text-white/30">
              <div className="text-4xl mb-3">✨</div>
              <p className="text-sm">Keine offenen Verbesserungsvorschläge.</p>
              <p className="text-xs mt-1 text-white/20">Nach 5+ Anrufen beginnt das Lernsystem automatisch.</p>
            </div>
          ) : (
            suggestions.map((s) => (
              <div key={s.id} className="glass rounded-2xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50 capitalize">{s.category}</span>
                      <span className="text-xs text-white/30">{s.occurrence_count}× erkannt</span>
                      {s.conv_lift_est && (
                        <span className="text-xs text-green-400">+{s.conv_lift_est.toFixed(1)} Score erwartet</span>
                      )}
                    </div>
                    <p className="text-sm text-white/80">{s.issue_summary}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApply(s.id)}
                    className="flex-1 bg-gradient-to-r from-orange-500 to-cyan-500 hover:opacity-90 text-white text-xs font-medium rounded-xl py-2 transition-opacity"
                  >
                    ✅ Anwenden
                  </button>
                  <button
                    onClick={() => handleReject(s.id)}
                    className="px-4 border border-white/10 bg-white/5 hover:bg-white/10 text-white/50 text-xs rounded-xl py-2 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
