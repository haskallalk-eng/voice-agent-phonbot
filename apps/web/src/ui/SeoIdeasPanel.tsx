import React, { useEffect, useMemo, useState } from 'react';
import {
  createExpandedSeoIdea,
  createSeoIdea,
  expandSeoIdea,
  getSeoIdeas,
  syncSeoIdeas,
  updateSeoIdeaStatus,
  type SeoIdea,
  type SeoIdeaStatus,
} from '../lib/api.js';
import {
  IconBrain,
  IconCheckCircle,
  IconEye,
  IconEyeOff,
  IconGlobe,
  IconInsights,
} from './PhonbotIcons.js';
import { useToast } from './Toast.js';

type Filter = SeoIdeaStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'active', label: 'Aktiv' },
  { id: 'completed', label: 'Umgesetzt' },
  { id: 'hidden', label: 'Ausgeblendet' },
];

function Metric({ label, value, inverse = false }: { label: string; value: number | null; inverse?: boolean }) {
  const tone = value == null
    ? 'text-white/30'
    : inverse
      ? value <= 3 ? 'text-green-300' : value >= 7 ? 'text-red-300' : 'text-yellow-300'
      : value >= 8 ? 'text-green-300' : value <= 4 ? 'text-red-300' : 'text-yellow-300';
  return (
    <div className="min-w-0 border-l border-white/10 pl-3 first:border-l-0 first:pl-0">
      <p className={`text-sm font-semibold ${tone}`}>{value ?? '–'}/10</p>
      <p className="text-[10px] text-white/30 mt-0.5 truncate">{label}</p>
    </div>
  );
}

function IdeaCard({
  idea,
  busy,
  onStatus,
  onExpand,
}: {
  idea: SeoIdea;
  busy: boolean;
  onStatus: (id: string, status: SeoIdeaStatus) => Promise<void>;
  onExpand: (id: string) => Promise<void>;
}) {
  const isDetailed = Boolean(idea.primary_keyword && idea.implementation);
  return (
    <article className="glass rounded-2xl border border-white/10 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              idea.source === 'automation'
                ? 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'
                : 'border-orange-400/20 bg-orange-400/10 text-orange-200'
            }`}>
              {idea.source === 'automation' ? <IconInsights size={12} /> : <IconBrain size={12} />}
              {idea.source === 'automation' ? 'Automation' : 'Eigene Idee'}
            </span>
            {idea.page_type && <span className="text-xs text-white/35">{idea.page_type}</span>}
            {idea.generated_by_llm && <span className="text-xs text-white/30">KI-ausgearbeitet</span>}
          </div>
          <h3 className="text-base sm:text-lg font-semibold text-white leading-snug">{idea.title}</h3>
          {idea.summary && <p className="mt-2 text-sm leading-relaxed text-white/55">{idea.summary}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          {idea.priority_score != null && (
            <div className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-2 text-center">
              <p className="text-lg font-bold text-orange-200 leading-none">{idea.priority_score}</p>
              <p className="mt-1 text-[10px] text-orange-100/45">Priorität</p>
            </div>
          )}
        </div>
      </div>

      {isDetailed && (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2 rounded-xl border border-white/5 bg-white/[0.025] p-3">
            <Metric label="Wirkung" value={idea.impact} />
            <Metric label="Sicherheit" value={idea.confidence} />
            <Metric label="Aufwand" value={idea.effort} inverse />
            <Metric label="Risiko" value={idea.risk} inverse />
          </div>

          <details className="group mt-4 border-t border-white/5 pt-3">
            <summary className="cursor-pointer list-none text-xs font-medium text-white/45 hover:text-white/70">
              <span className="group-open:hidden">Details anzeigen</span>
              <span className="hidden group-open:inline">Details schließen</span>
            </summary>
            <div className="mt-3 space-y-3 text-sm">
              {idea.primary_keyword && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/25">Keyword</p>
                  <p className="mt-1 font-mono text-xs text-cyan-100/70">{idea.primary_keyword}</p>
                </div>
              )}
              {idea.audience && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/25">Zielgruppe</p>
                  <p className="mt-1 text-white/55">{idea.audience}</p>
                </div>
              )}
              {idea.reason && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/25">Warum das wirken kann</p>
                  <p className="mt-1 leading-relaxed text-white/55">{idea.reason}</p>
                </div>
              )}
              {idea.implementation && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/25">Umsetzung</p>
                  <p className="mt-1 leading-relaxed text-white/55">{idea.implementation}</p>
                </div>
              )}
              {idea.outline.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/25">Vorgeschlagener Aufbau</p>
                  <ol className="mt-1 space-y-1 text-white/55">
                    {idea.outline.map((line, index) => <li key={`${line}-${index}`}>{index + 1}. {line}</li>)}
                  </ol>
                </div>
              )}
              {idea.gates.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {idea.gates.map((gate) => (
                    <span key={gate} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-white/40">
                      {gate}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </details>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/5 pt-4">
        <button
          onClick={() => onExpand(idea.id)}
          disabled={busy}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-400/15 disabled:opacity-40"
        >
          <IconBrain size={14} />
          {busy ? 'KI arbeitet…' : isDetailed ? 'Mit KI neu bewerten' : 'Mit KI ausarbeiten'}
        </button>
        {idea.status === 'active' && (
          <>
            <button
              onClick={() => onStatus(idea.id, 'completed')}
              disabled={busy}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-green-400/20 bg-green-400/10 px-3 text-xs font-medium text-green-200 transition-colors hover:bg-green-400/15 disabled:opacity-40"
            >
              <IconCheckCircle size={14} /> Umgesetzt
            </button>
            <button
              onClick={() => onStatus(idea.id, 'hidden')}
              disabled={busy}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs text-white/45 transition-colors hover:bg-white/5 hover:text-white/70 disabled:opacity-40"
            >
              <IconEyeOff size={14} /> Ausblenden
            </button>
          </>
        )}
        {idea.status !== 'active' && (
          <button
            onClick={() => onStatus(idea.id, 'active')}
            disabled={busy}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs text-white/55 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
          >
            <IconEye size={14} /> Wieder aktivieren
          </button>
        )}
      </div>
    </article>
  );
}

export function SeoIdeasPanel() {
  const { toast } = useToast();
  const [ideas, setIdeas] = useState<SeoIdea[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState<'plain' | 'llm' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await getSeoIdeas();
      setIdeas(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ideen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => ideas.filter((idea) => idea.status === filter), [ideas, filter]);
  const counts = useMemo(() => ({
    active: ideas.filter((idea) => idea.status === 'active').length,
    completed: ideas.filter((idea) => idea.status === 'completed').length,
    hidden: ideas.filter((idea) => idea.status === 'hidden').length,
  }), [ideas]);

  async function handleCreate(expand: boolean) {
    const cleanTitle = title.trim();
    if (cleanTitle.length < 3) {
      setError('Bitte gib der Idee einen kurzen, eindeutigen Titel.');
      return;
    }
    setCreating(expand ? 'llm' : 'plain');
    setError(null);
    try {
      const result = expand
        ? await createExpandedSeoIdea(cleanTitle, notes.trim())
        : await createSeoIdea(cleanTitle, notes.trim());
      setIdeas((current) => [result.item, ...current]);
      setFilter('active');
      setTitle('');
      setNotes('');
      toast('success', expand ? 'Idee wurde von der KI ausgearbeitet.' : 'Idee wurde gespeichert.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Idee konnte nicht gespeichert werden.');
    } finally {
      setCreating(null);
    }
  }

  async function handleStatus(id: string, status: SeoIdeaStatus) {
    setBusyId(id);
    setError(null);
    try {
      const result = await updateSeoIdeaStatus(id, status);
      setIdeas((current) => current.map((idea) => idea.id === id ? result.item : idea));
      toast('success', status === 'hidden' ? 'Idee ausgeblendet.' : status === 'completed' ? 'Idee als umgesetzt markiert.' : 'Idee wieder aktiviert.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status konnte nicht geändert werden.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleExpand(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const result = await expandSeoIdea(id);
      setIdeas((current) => current.map((idea) => idea.id === id ? result.item : idea));
      toast('success', 'SEO-Idee wurde neu ausgearbeitet und bewertet.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'KI-Ausarbeitung ist fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const result = await syncSeoIdeas();
      await load();
      toast('success', result.created > 0 ? `${result.created} neue Systemideen ergänzt.` : 'Die Systemideen sind bereits aktuell.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Automation konnte nicht synchronisiert werden.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="border-y border-white/10 py-5 sm:py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-200/80">
              <IconGlobe size={17} />
              <h2 className="text-sm font-semibold uppercase tracking-widest">Neue Wachstumsidee</h2>
            </div>
            <p className="mt-2 max-w-xl text-sm text-white/40">Ein Stichwort reicht. Die KI erstellt daraus einen prüfbaren SEO-Vorschlag, veröffentlicht aber nichts selbst.</p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="min-h-9 shrink-0 rounded-lg border border-white/10 px-3 text-xs text-white/45 transition-colors hover:bg-white/5 hover:text-white/70 disabled:opacity-40"
          >
            {syncing ? 'Synchronisiere…' : 'Systemideen aktualisieren'}
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            placeholder="z. B. KI-Telefonassistent für Hausärzte"
            className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none placeholder:text-white/20 focus:border-cyan-400/35"
          />
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Optional: Zielgruppe, Nutzen oder Rahmenbedingungen"
            className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/20 focus:border-cyan-400/35"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => handleCreate(true)}
              disabled={creating !== null}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-400/15 px-4 text-sm font-semibold text-cyan-50 transition-colors hover:bg-cyan-400/20 disabled:opacity-40"
            >
              <IconBrain size={16} /> {creating === 'llm' ? 'KI arbeitet…' : 'Mit KI ausarbeiten'}
            </button>
            <button
              onClick={() => handleCreate(false)}
              disabled={creating !== null}
              className="min-h-10 rounded-xl border border-white/10 px-4 text-sm text-white/55 transition-colors hover:bg-white/5 hover:text-white/80 disabled:opacity-40"
            >
              {creating === 'plain' ? 'Speichere…' : 'Nur als Idee speichern'}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-grid w-full grid-cols-3 rounded-xl border border-white/10 bg-white/[0.025] p-1 sm:w-auto">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              className={`min-h-9 rounded-lg px-3 text-xs font-medium transition-colors ${
                filter === item.id ? 'bg-white/10 text-white' : 'text-white/35 hover:text-white/60'
              }`}
            >
              {item.label} <span className="text-white/30">{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-white/30">Bewertung: Wirkung + Sicherheit − Aufwand − Risiko</p>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((item) => <div key={item} className="h-44 rounded-2xl border border-white/10 bg-white/[0.03]" />)}
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} busy={busyId === idea.id} onStatus={handleStatus} onExpand={handleExpand} />
          ))}
        </div>
      ) : (
        <div className="py-12 text-center">
          <IconInsights size={28} className="mx-auto text-white/20" />
          <p className="mt-3 text-sm text-white/40">In diesem Bereich liegen noch keine Ideen.</p>
        </div>
      )}
    </div>
  );
}
