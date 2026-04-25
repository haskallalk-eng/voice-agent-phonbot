import React, { useState, useEffect, useCallback } from 'react';
import {
  adminGetDemoCalls,
  adminPromoteDemoCall,
  adminGetDemoPrompts,
  adminPutDemoPrompt,
  adminFlushDemoCache,
  adminGetLearnings,
  adminDecideLearning,
  type AdminDemoCall,
  type AdminDemoPrompts,
  type AdminLearningItem,
} from '../lib/api.js';

// ── Shared bits ──────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 rounded-full border-2 border-orange-500/40 border-t-orange-500 animate-spin" />
    </div>
  );
}

function Pill({ tone, children }: { tone: 'gray' | 'orange' | 'green' | 'red'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    gray: 'bg-white/5 border-white/10 text-white/50',
    orange: 'bg-orange-500/15 border-orange-500/30 text-orange-300',
    green: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    red: 'bg-red-500/15 border-red-500/30 text-red-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

// ── Demo Calls ───────────────────────────────────────────────────────────────

export function DemoCallsTab() {
  const [calls, setCalls] = useState<AdminDemoCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState<string>('');
  const [onlyUnpromoted, setOnlyUnpromoted] = useState(false);
  const [hasContact, setHasContact] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [emailOverride, setEmailOverride] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    adminGetDemoCalls({
      template: template || undefined,
      onlyUnpromoted: onlyUnpromoted || undefined,
      hasContact: hasContact || undefined,
      limit: 200,
    })
      .then((res) => setCalls(res.calls))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [template, onlyUnpromoted, hasContact]);

  useEffect(() => { load(); }, [load]);

  async function promote(c: AdminDemoCall) {
    const email = c.caller_email ?? emailOverride.trim();
    if (!email) {
      alert('Diese Demo hat keine E-Mail. Trage eine ein, bevor du promotest.');
      return;
    }
    setPromotingId(c.id);
    try {
      const res = await adminPromoteDemoCall(c.id, c.caller_email ? undefined : { email });
      alert(`Promoted to lead ${res.leadId}`);
      setEmailOverride('');
      load();
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setPromotingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-white/50 text-sm">Branche:</span>
        {['', 'hairdresser', 'tradesperson', 'cleaning', 'restaurant', 'auto', 'solo'].map((t) => (
          <button
            key={t}
            onClick={() => setTemplate(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              template === t ? 'bg-orange-500/20 border-orange-500/40 text-orange-300' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
            }`}
          >
            {t || 'Alle'}
          </button>
        ))}
        <label className="flex items-center gap-2 text-xs text-white/60">
          <input type="checkbox" checked={onlyUnpromoted} onChange={(e) => setOnlyUnpromoted(e.target.checked)} className="accent-orange-500" />
          nur unpromoted
        </label>
        <label className="flex items-center gap-2 text-xs text-white/60">
          <input type="checkbox" checked={hasContact} onChange={(e) => setHasContact(e.target.checked)} className="accent-orange-500" />
          mit Kontaktdaten
        </label>
        <span className="text-white/30 text-xs ml-auto">{calls.length} Demo-Calls</span>
      </div>

      {loading ? <Spinner /> : calls.length === 0 ? (
        <p className="text-white/30 text-sm text-center py-12">Keine Demo-Calls.</p>
      ) : (
        <div className="space-y-2">
          {calls.map((c) => {
            const open = openId === c.id;
            return (
              <div key={c.id} className="rounded-xl bg-white/5 border border-white/10">
                <button
                  onClick={() => setOpenId(open ? null : c.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04] transition-colors"
                >
                  <span className="text-xs text-white/40 w-32 shrink-0">{fmtDate(c.created_at)}</span>
                  <Pill tone="gray">{c.template_id}</Pill>
                  <span className="text-sm text-white/80 truncate flex-1">
                    {c.caller_name ?? '—'} {c.caller_email ? `· ${c.caller_email}` : ''} {c.caller_phone ? `· ${c.caller_phone}` : ''}
                  </span>
                  <span className="text-xs text-white/40 shrink-0">{c.duration_sec ?? '?'}s</span>
                  {c.promoted_at ? <Pill tone="green">in CRM</Pill> : c.caller_email || c.caller_phone ? <Pill tone="orange">Kontakt</Pill> : <Pill tone="gray">leer</Pill>}
                </button>
                {open && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/5">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div><span className="text-white/40">Intent:</span> <span className="text-white/80">{c.intent_summary ?? '—'}</span></div>
                      <div><span className="text-white/40">Disconnect:</span> <span className="text-white/80">{c.disconnection_reason ?? '—'}</span></div>
                      <div><span className="text-white/40">call_id:</span> <span className="text-white/60 font-mono text-[10px]">{c.call_id}</span></div>
                      <div><span className="text-white/40">Promoted:</span> <span className="text-white/80">{c.promoted_at ? fmtDate(c.promoted_at) : '—'}</span></div>
                    </div>
                    {c.transcript_excerpt && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-white/50 hover:text-white/80">Transcript anzeigen</summary>
                        <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-white/5 whitespace-pre-wrap text-white/70 max-h-96 overflow-auto">{c.transcript_excerpt}</pre>
                      </details>
                    )}
                    {!c.promoted_at && (
                      <div className="flex items-center gap-2 pt-2">
                        {!c.caller_email && (
                          <input
                            type="email"
                            value={emailOverride}
                            onChange={(e) => setEmailOverride(e.target.value)}
                            placeholder="E-Mail manuell setzen…"
                            className="flex-1 max-w-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs placeholder-white/30 focus:outline-none focus:border-orange-500/50"
                          />
                        )}
                        <button
                          onClick={() => promote(c)}
                          disabled={promotingId === c.id || (!c.caller_email && !emailOverride.trim())}
                          className="px-4 py-2 rounded-lg bg-orange-500/20 border border-orange-500/40 text-orange-300 text-xs font-medium hover:bg-orange-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {promotingId === c.id ? '…' : 'In CRM übernehmen'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Demo Prompts ─────────────────────────────────────────────────────────────

export function DemoPromptsTab() {
  const [data, setData] = useState<AdminDemoPrompts | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<string>('__global__');
  const [draftEpilogue, setDraftEpilogue] = useState<string>('');
  const [draftBase, setDraftBase] = useState<string>('');
  const [editBase, setEditBase] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminGetDemoPrompts()
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sync drafts when scope or data changes
  useEffect(() => {
    if (!data) return;
    if (scope === '__global__') {
      setDraftEpilogue(data.overrides.globalEpilogue?.epilogue ?? data.defaults.globalEpilogue);
      setDraftBase('');
      setEditBase(false);
    } else {
      const tmpl = data.defaults.templates.find((t) => t.id === scope);
      const ov = data.overrides.templates.find((t) => t.id === scope)?.override;
      setDraftEpilogue(ov?.epilogue ?? '');
      setDraftBase(ov?.basePrompt ?? tmpl?.basePrompt ?? '');
      setEditBase(!!ov?.basePrompt);
    }
  }, [scope, data]);

  async function save() {
    setSaving(true);
    try {
      const body: { epilogue: string | null; basePrompt?: string | null } = {
        epilogue: scope === '__global__' || draftEpilogue.trim() ? draftEpilogue : null,
      };
      if (scope !== '__global__') {
        body.basePrompt = editBase ? draftBase : null;
      }
      const res = await adminPutDemoPrompt(scope, body);
      setFlash(`Gespeichert. ${res.flushed} Cache-Einträge geleert — neue Calls picken den Prompt sofort auf.`);
      load();
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setFlash(null), 4500);
    }
  }

  async function revertToDefault() {
    if (!confirm('Wirklich auf den fest einkompilierten Default zurücksetzen?')) return;
    setSaving(true);
    try {
      await adminPutDemoPrompt(scope, { epilogue: null, basePrompt: null });
      setFlash('Override entfernt — fällt zurück auf den Default aus dem Code.');
      load();
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setFlash(null), 4500);
    }
  }

  async function flushOnly() {
    setSaving(true);
    try {
      const res = await adminFlushDemoCache();
      setFlash(`${res.flushed} Cache-Einträge geleert.`);
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setFlash(null), 4500);
    }
  }

  if (loading || !data) return <Spinner />;

  const isGlobal = scope === '__global__';
  const tmpl = data.defaults.templates.find((t) => t.id === scope);
  const ovGlobal = data.overrides.globalEpilogue;
  const ovTmpl = data.overrides.templates.find((t) => t.id === scope)?.override ?? null;
  const activeOverride = isGlobal ? ovGlobal : ovTmpl;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-white/50 text-sm">Scope:</span>
        <button
          onClick={() => setScope('__global__')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isGlobal ? 'bg-orange-500/20 border-orange-500/40 text-orange-300' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
          }`}
        >
          Global (alle Branchen)
        </button>
        {data.defaults.templates.map((t) => (
          <button
            key={t.id}
            onClick={() => setScope(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              scope === t.id ? 'bg-orange-500/20 border-orange-500/40 text-orange-300' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
            }`}
          >
            {t.icon} {t.name}
          </button>
        ))}
        <button
          onClick={flushOnly}
          disabled={saving}
          className="ml-auto px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 text-xs hover:bg-white/10 transition-colors disabled:opacity-40"
          title="Verwirft alle Demo-Agent-Caches in Redis. Nutzt man wenn man Voice/Tools/Webhooks im Code geändert hat ohne Prompt zu touchen."
        >
          Cache leeren
        </button>
      </div>

      {flash && (
        <div className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">{flash}</div>
      )}

      <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {isGlobal ? 'Globaler Demo-Epilog' : `${tmpl?.icon} ${tmpl?.name} — Branche-Prompt`}
          </h3>
          <div className="text-xs text-white/40">
            {activeOverride ? (
              <>Override aktiv · zuletzt von {activeOverride.updatedBy ?? 'unbekannt'} am {fmtDate(activeOverride.updatedAt)}</>
            ) : (
              <>Default aus dem Code — noch nie überschrieben</>
            )}
          </div>
        </div>

        {!isGlobal && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-white/60">Branche-Prompt (vor dem Epilog)</label>
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" checked={editBase} onChange={(e) => setEditBase(e.target.checked)} className="accent-orange-500" />
                überschreiben
              </label>
            </div>
            <textarea
              value={draftBase}
              onChange={(e) => setDraftBase(e.target.value)}
              disabled={!editBase}
              rows={10}
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white/90 text-xs font-mono resize-y focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60">
            {isGlobal ? 'Epilog — wird an JEDE Branche-Prompt angehängt' : 'Branche-spezifischer Epilog (überschreibt den globalen wenn gesetzt)'}
          </label>
          <textarea
            value={draftEpilogue}
            onChange={(e) => setDraftEpilogue(e.target.value)}
            rows={20}
            className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white/90 text-xs font-mono resize-y focus:outline-none focus:border-orange-500/50"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-orange-500/20 border border-orange-500/40 text-orange-300 text-xs font-medium hover:bg-orange-500/30 disabled:opacity-40 transition-colors"
          >
            {saving ? '…' : 'Speichern + Cache leeren'}
          </button>
          {activeOverride && (
            <button
              onClick={revertToDefault}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/50 text-xs hover:bg-white/10 disabled:opacity-40 transition-colors"
            >
              Auf Code-Default zurücksetzen
            </button>
          )}
          <span className="text-[11px] text-white/30 ml-auto">
            Kunden sehen diese Texte nie. Sie wirken nur auf Demo-Agents.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Learnings ────────────────────────────────────────────────────────────────

export function LearningsTab() {
  const [items, setItems] = useState<AdminLearningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'applied' | 'rejected' | 'all'>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminGetLearnings({ status: statusFilter, limit: 200 })
      .then((res) => setItems(res.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function decide(item: AdminLearningItem, scope: 'systemic' | 'org' | 'both') {
    setBusy(item.id);
    try {
      const res = await adminDecideLearning({
        sourceKind: item.kind,
        sourceId: item.id,
        decision: 'apply',
        scope,
      });
      const note = [
        res.systemicApplied ? 'systemisch ✓' : '',
        res.orgApplied ? 'kunden-spezifisch ✓' : '',
      ].filter(Boolean).join(' + ');
      alert(`Angewendet (${scope}). ${note || ''}`);
      load();
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function reject(item: AdminLearningItem) {
    const reason = prompt('Grund für Ablehnung (optional):') ?? undefined;
    setBusy(item.id);
    try {
      await adminDecideLearning({
        sourceKind: item.kind,
        sourceId: item.id,
        decision: 'reject',
        rejectReason: reason,
      });
      load();
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-white/50 text-sm">Status:</span>
        {(['pending', 'applied', 'rejected', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              statusFilter === s ? 'bg-orange-500/20 border-orange-500/40 text-orange-300' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
            }`}
          >
            {s}
          </button>
        ))}
        <span className="text-white/30 text-xs ml-auto">{items.length} Verbesserungen</span>
      </div>

      <div className="text-xs text-white/40 italic">
        <strong className="text-white/60">Scope-Erklärung:</strong> Eine Verbesserung kann <Pill tone="orange">systemisch</Pill> sein
        (greift bei allen Demo-Agents weltweit), <Pill tone="orange">kunden-spezifisch</Pill> (nur bei dem Kunden, dessen Calls die
        Verbesserung ausgelöst haben), oder <Pill tone="orange">beides</Pill>. Lehnt man ab, bleibt die Verbesserung im Archiv aber
        wird nicht angewendet.
      </div>

      {loading ? <Spinner /> : items.length === 0 ? (
        <p className="text-white/30 text-sm text-center py-12">Keine Verbesserungen in diesem Status.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const open = openId === it.id;
            const decided = it.decision?.status === 'applied' || it.decision?.status === 'rejected';
            return (
              <div key={`${it.kind}:${it.id}`} className="rounded-xl bg-white/5 border border-white/10">
                <button
                  onClick={() => setOpenId(open ? null : it.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04] transition-colors"
                >
                  <span className="text-xs text-white/40 w-32 shrink-0">{fmtDate(it.created_at)}</span>
                  <Pill tone={it.kind === 'template_learning' ? 'orange' : 'gray'}>
                    {it.kind === 'template_learning' ? 'systemisch-Kandidat' : it.orgName ?? 'Kunde'}
                  </Pill>
                  <span className="text-sm text-white/80 truncate flex-1">{it.summary}</span>
                  {it.decision?.status === 'applied' && <Pill tone="green">{it.decision.scope} ✓</Pill>}
                  {it.decision?.status === 'rejected' && <Pill tone="red">abgelehnt</Pill>}
                  {!decided && <Pill tone="gray">offen</Pill>}
                </button>
                {open && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/5">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div><span className="text-white/40">Quelle:</span> <span className="text-white/80">{it.kind === 'template_learning' ? `Template ${it.templateId}` : `Org ${it.orgName ?? '—'}`}</span></div>
                      {it.sourceMeta && Object.keys(it.sourceMeta).length > 0 && (
                        <div><span className="text-white/40">Meta:</span> <span className="text-white/80 font-mono text-[10px]">{JSON.stringify(it.sourceMeta)}</span></div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-white/40 mb-1">Vorgeschlagene Änderung:</div>
                      <pre className="p-3 rounded-lg bg-black/40 border border-white/5 whitespace-pre-wrap text-white/80 text-xs max-h-96 overflow-auto">{it.proposed}</pre>
                    </div>
                    {it.decision && decided ? (
                      <div className="text-xs text-white/50 italic">
                        Entschieden am {fmtDate(it.decision.decidedAt)} von {it.decision.decidedBy ?? 'unbekannt'}
                        {it.decision.rejectReason && ` — Grund: ${it.decision.rejectReason}`}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 pt-2 flex-wrap">
                        <button
                          onClick={() => decide(it, 'systemic')}
                          disabled={busy === it.id}
                          className="px-3 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/40 text-orange-300 text-xs font-medium hover:bg-orange-500/30 disabled:opacity-40 transition-colors"
                          title="In den globalen Demo-Epilog aufnehmen — wirkt für alle Demo-Agents"
                        >
                          Systemisch übernehmen
                        </button>
                        {it.kind === 'prompt_suggestion' && (
                          <button
                            onClick={() => decide(it, 'org')}
                            disabled={busy === it.id}
                            className="px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-xs font-medium hover:bg-cyan-500/25 disabled:opacity-40 transition-colors"
                            title="Nur beim Kunden anwenden, der die Verbesserung ausgelöst hat"
                          >
                            Nur für diesen Kunden
                          </button>
                        )}
                        {it.kind === 'prompt_suggestion' && (
                          <button
                            onClick={() => decide(it, 'both')}
                            disabled={busy === it.id}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-medium hover:bg-emerald-500/25 disabled:opacity-40 transition-colors"
                            title="Beim Kunden anwenden UND ins Standard-System übernehmen"
                          >
                            Beides
                          </button>
                        )}
                        <button
                          onClick={() => reject(it)}
                          disabled={busy === it.id}
                          className="ml-auto px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 text-xs hover:bg-red-500/15 hover:border-red-500/30 hover:text-red-300 disabled:opacity-40 transition-colors"
                        >
                          Ablehnen
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
