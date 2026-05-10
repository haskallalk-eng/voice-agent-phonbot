import React, { useState, useEffect, useCallback } from 'react';
import {
  adminGetDemoCalls,
  adminPromoteDemoCall,
  adminGetDemoMeetings,
  adminUpdateDemoMeeting,
  adminGetDemoPrompts,
  adminPutDemoPrompt,
  adminFlushDemoCache,
  adminGetPromptQa,
  adminGetLearnings,
  adminDecideLearning,
  adminGetCorrections,
  type AdminDemoCall,
  type AdminDemoMeeting,
  type AdminDemoMeetingStatus,
  type AdminDemoPrompts,
  type AdminPromptQaLayer,
  type AdminPromptQaLiveCallSourceResult,
  type AdminPromptQaReport,
  type AdminPromptQaSourceResult,
  type AdminPromptQaStatus,
  type AdminLearningItem,
  type AdminLearningCorrection,
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

// ── Demo Human Meetings ─────────────────────────────────────────────────────

const MEETING_STATUS_LABELS: Record<AdminDemoMeetingStatus | 'all', string> = {
  open: 'Offen',
  contacted: 'Kontaktiert',
  scheduled: 'Termin fix',
  done: 'Erledigt',
  ignored: 'Ignoriert',
  all: 'Alle',
};

function meetingTone(status: AdminDemoMeetingStatus): 'gray' | 'orange' | 'green' | 'red' {
  if (status === 'open') return 'orange';
  if (status === 'ignored') return 'red';
  if (status === 'done' || status === 'scheduled') return 'green';
  return 'gray';
}

export function DemoMeetingsTab() {
  const [items, setItems] = useState<AdminDemoMeeting[]>([]);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AdminDemoMeetingStatus | 'all'>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminGetDemoMeetings({ status, limit: 200 })
      .then((res) => {
        setItems(res.items);
        setMeetingUrl(res.meetingUrl);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function setMeetingStatus(item: AdminDemoMeeting, next: AdminDemoMeetingStatus) {
    const note = next === 'scheduled' || next === 'done'
      ? (prompt('Interne Notiz optional:') ?? undefined)
      : undefined;
    setBusy(item.id);
    try {
      await adminUpdateDemoMeeting(item.id, { status: next, notes: note?.trim() || undefined });
      load();
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-white">Demo-Gespraeche mit Menschen</h2>
            <p className="mt-1 max-w-2xl text-sm text-white/45">
              Hier landen Demo-Anrufer, die mit einem echten Phonbot-Mitarbeiter sprechen oder einen Beratungstermin wollen. Chipy nimmt nur den Wunsch auf; der echte Termin wird hier nachgefasst.
            </p>
          </div>
          {meetingUrl && (
            <a
              href={meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 transition-colors"
            >
              Terminlink oeffnen
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-white/45 text-sm">Status:</span>
        {(['open', 'contacted', 'scheduled', 'done', 'ignored', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              status === s ? 'border-orange-500/40 bg-orange-500/15 text-orange-200' : 'border-white/10 bg-white/5 text-white/45 hover:bg-white/10'
            }`}
          >
            {MEETING_STATUS_LABELS[s]}
          </button>
        ))}
        <button
          onClick={load}
          className="ml-auto rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/50 hover:bg-white/10 transition-colors"
        >
          Aktualisieren
        </button>
      </div>

      {loading ? <Spinner /> : items.length === 0 ? (
        <p className="text-white/30 text-sm text-center py-12">Keine Demo-Gespraechswuensche in diesem Status.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const open = openId === item.id;
            return (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.035]">
                <button
                  onClick={() => setOpenId(open ? null : item.id)}
                  className="w-full px-4 py-4 text-left flex flex-col gap-3 hover:bg-white/[0.03] transition-colors rounded-2xl"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <Pill tone={meetingTone(item.human_meeting_status)}>{MEETING_STATUS_LABELS[item.human_meeting_status]}</Pill>
                    <span className="text-xs text-white/35">{fmtDate(item.created_at)}</span>
                    <Pill tone="gray">{item.template_id}</Pill>
                    <span className="text-sm font-semibold text-white truncate">
                      {item.caller_name ?? 'Unbekannter Kontakt'}
                    </span>
                    <span className="ml-auto text-xs text-white/35">{item.duration_sec ?? '?'}s</span>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-white/35">Kontakt</p>
                      <p className="text-white/80 truncate">{item.caller_phone ?? item.caller_email ?? 'fehlt'}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-white/35">Wunschzeit</p>
                      <p className="text-white/80 truncate">{item.human_meeting_time ?? 'nicht genannt'}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-white/35">Kanal</p>
                      <p className="text-white/80 truncate">{item.human_meeting_channel ?? 'unknown'}</p>
                    </div>
                  </div>
                  {item.intent_summary && <p className="text-sm text-white/60">{item.intent_summary}</p>}
                </button>

                {open && (
                  <div className="px-4 pb-4 space-y-3 border-t border-white/5">
                    <div className="grid md:grid-cols-2 gap-3 text-xs pt-3">
                      <div><span className="text-white/35">Name:</span> <span className="text-white/75">{item.caller_name ?? '-'}</span></div>
                      <div><span className="text-white/35">Telefon:</span> <span className="text-white/75">{item.caller_phone ?? '-'}</span></div>
                      <div><span className="text-white/35">E-Mail:</span> <span className="text-white/75">{item.caller_email ?? '-'}</span></div>
                      <div><span className="text-white/35">call_id:</span> <span className="text-white/50 font-mono text-[10px]">{item.call_id}</span></div>
                      <div><span className="text-white/35">Testlink Mail:</span> <span className="text-white/75">{fmtDate(item.signup_link_email_sent_at)}</span></div>
                      <div><span className="text-white/35">Testlink SMS:</span> <span className="text-white/75">{fmtDate(item.signup_link_sms_sent_at)}</span></div>
                    </div>
                    {item.human_meeting_notes && (
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/65">
                        {item.human_meeting_notes}
                      </div>
                    )}
                    {item.transcript_excerpt && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-white/50 hover:text-white/80">Transcript anzeigen</summary>
                        <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-white/5 bg-black/40 p-3 whitespace-pre-wrap text-white/65">{item.transcript_excerpt}</pre>
                      </details>
                    )}
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      {(['contacted', 'scheduled', 'done', 'ignored'] as const).map((next) => (
                        <button
                          key={next}
                          onClick={() => setMeetingStatus(item, next)}
                          disabled={busy === item.id || item.human_meeting_status === next}
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/55 hover:bg-white/10 disabled:opacity-40 transition-colors"
                        >
                          {MEETING_STATUS_LABELS[next]}
                        </button>
                      ))}
                    </div>
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
    if (scope === '__platform__') {
      setDraftEpilogue(data.overrides.platformBaseline?.epilogue ?? data.defaults.platformBaseline);
      setDraftBase('');
      setEditBase(false);
    } else if (scope === '__outbound__') {
      setDraftEpilogue(data.overrides.outboundBaseline?.epilogue ?? data.defaults.outboundBaseline);
      setDraftBase('');
      setEditBase(false);
    } else if (scope === '__sales__') {
      setDraftEpilogue(data.overrides.salesPrompt?.epilogue ?? data.defaults.salesPrompt);
      setDraftBase('');
      setEditBase(false);
    } else if (scope === '__global__') {
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

  const isPlatform = scope === '__platform__';
  const isOutbound = scope === '__outbound__';
  const isSales = scope === '__sales__';
  const isGlobal = scope === '__global__';
  const tmpl = data.defaults.templates.find((t) => t.id === scope);
  const ovPlatform = data.overrides.platformBaseline;
  const ovOutbound = data.overrides.outboundBaseline;
  const ovSales = data.overrides.salesPrompt;
  const ovGlobal = data.overrides.globalEpilogue;
  const ovTmpl = data.overrides.templates.find((t) => t.id === scope)?.override ?? null;
  const activeOverride = isPlatform ? ovPlatform
    : isOutbound ? ovOutbound
    : isSales ? ovSales
    : isGlobal ? ovGlobal
    : ovTmpl;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-white/50 text-sm">Scope:</span>
        <button
          onClick={() => setScope('__platform__')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isPlatform ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-emerald-500/5 border-emerald-500/15 text-emerald-300/70 hover:bg-emerald-500/10'
          }`}
          title="Plattform-Baseline — gilt für JEDEN Inbound-Agent (Demo + zahlende Kunden), Mindest-Qualitätsstandard"
        >
          Plattform-Baseline (Inbound)
        </button>
        <button
          onClick={() => setScope('__outbound__')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isOutbound ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-cyan-500/5 border-cyan-500/15 text-cyan-300/70 hover:bg-cyan-500/10'
          }`}
          title="Outbound-Baseline — gilt für JEDEN Outbound-Agent (Sales-Callback + Customer-Outbound). DSGVO Art.21, KI-Identifikation, kein Hard-Close"
        >
          Outbound-Baseline (Rückrufe)
        </button>
        <button
          onClick={() => setScope('__sales__')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isSales ? 'bg-orange-500/20 border-orange-500/40 text-orange-300' : 'bg-orange-500/5 border-orange-500/15 text-orange-300/70 hover:bg-orange-500/10'
          }`}
          title="Phonbot Sales-Callback-Prompt — Chipy ruft Lead nach Website-Formular zurück"
        >
          Sales-Rückruf-Prompt
        </button>
        <span className="text-white/20 text-sm">·</span>
        <button
          onClick={() => setScope('__global__')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isGlobal ? 'bg-orange-500/20 border-orange-500/40 text-orange-300' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
          }`}
          title="Demo-Epilog — gilt nur für Demo-Calls auf phonbot.de"
        >
          Demo-Epilog (nur Demo)
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

      {isPlatform && (
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 px-4 py-3 text-xs text-emerald-200/90 space-y-1">
          <p><strong>Plattform-Baseline (Inbound)</strong> — wird vor JEDEM Inbound-Agent-Prompt eingefügt (Demo + zahlende Kunden). Stellt Mindest-Qualität sicher: DIN-5009-Buchstabieralphabet, end_call-Trigger, Promise-Disziplin, Datenschutz-Untergrenze.</p>
          <p>Kunden sehen diesen Block nicht und können ihn nicht editieren. Greift auch wenn der Kunde gar keinen System-Prompt konfiguriert hat.</p>
          <p className="text-emerald-300/60">Demo-Agents picken die Änderung nach <em>Cache leeren</em> sofort. Zahlende Kunden picken sie beim nächsten Speichern ihres Agent-Configs auf — oder via "Alle Kunden neu deployen" (TODO).</p>
        </div>
      )}
      {isOutbound && (
        <div className="rounded-xl bg-cyan-500/5 border border-cyan-500/20 px-4 py-3 text-xs text-cyan-200/90 space-y-1">
          <p><strong>Outbound-Baseline</strong> — wird vor JEDEM Agent eingefügt, der AKTIV anruft (Phonbot Sales-Rückruf + zukünftige Customer-Outbound-Agenten). Bewusst getrennt von der Inbound-Baseline weil der Anrufer hier nicht uns angerufen hat.</p>
          <p>Pflicht-Inhalte: DSGVO-Widerspruch (Art. 21) sofort akzeptieren, KI-Identifikation auf Nachfrage (EU AI Act / § 13 UWG), kein Hard-Close, höflicher Auftakt mit Bezug auf den Anlass.</p>
        </div>
      )}
      {isSales && (
        <div className="rounded-xl bg-orange-500/5 border border-orange-500/20 px-4 py-3 text-xs text-orange-100/85 space-y-1">
          <p><strong>Sales-Rückruf-Prompt</strong> — der Prompt für Chipy's Outbound-Anrufe nach Website-Formular. Wird mit der Outbound-Baseline (siehe oben) kombiniert.</p>
          <p>Dynamische Variablen die Retell zur Laufzeit ersetzt: <code>{`{{signup_link}}`}</code>, <code>{`{{signup_sms_sent}}`}</code>. Behalte sie wenn du den Prompt anpasst.</p>
        </div>
      )}

      {flash && (
        <div className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">{flash}</div>
      )}

      <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            {isPlatform ? 'Plattform-Baseline (Inbound)'
              : isOutbound ? 'Outbound-Baseline (Rückrufe)'
              : isSales ? 'Sales-Rückruf-Prompt'
              : isGlobal ? 'Demo-Epilog (nur Demo)'
              : `${tmpl?.icon} ${tmpl?.name} — Branche-Prompt`}
          </h3>
          <div className="text-xs text-white/40">
            {activeOverride ? (
              <>Override aktiv · zuletzt von {activeOverride.updatedBy ?? 'unbekannt'} am {fmtDate(activeOverride.updatedAt)}</>
            ) : (
              <>Default aus dem Code — noch nie überschrieben</>
            )}
          </div>
        </div>

        {!isPlatform && !isOutbound && !isSales && !isGlobal && (
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
            {isPlatform ? 'Plattform-Baseline (Inbound) — wird vor JEDEN Inbound-Agent-Prompt gehängt'
              : isOutbound ? 'Outbound-Baseline — wird vor JEDEN Outbound-Agent-Prompt gehängt'
              : isSales ? 'Sales-Rückruf-Prompt (kombiniert sich mit der Outbound-Baseline)'
              : isGlobal ? 'Demo-Epilog — wird an die Branche-Prompts angehängt (nur Demo)'
              : 'Branche-spezifischer Epilog (überschreibt den Demo-Epilog für diese Branche)'}
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

// ── Prompt QA ────────────────────────────────────────────────────────────────

const LAYER_LABELS: Record<AdminPromptQaLayer, string> = {
  prompt: 'Prompt',
  latency: 'Latenz',
  stt: 'STT',
  tts: 'TTS',
  e2e: 'E2E',
  tooling: 'Tools',
  privacy: 'Privacy',
};

function qaStatusTone(status: AdminPromptQaStatus): 'green' | 'orange' | 'red' {
  if (status === 'green') return 'green';
  if (status === 'yellow') return 'orange';
  return 'red';
}

function qaStatusLabel(status: AdminPromptQaStatus): string {
  if (status === 'green') return 'Gruen';
  if (status === 'yellow') return 'Gelb';
  return 'Rot';
}

function PromptQaSourceCard({ source }: { source: AdminPromptQaSourceResult }) {
  const [open, setOpen] = useState(source.status !== 'green');
  const layers = Object.entries(source.layerBreakdown) as Array<[AdminPromptQaLayer, { total: number; passed: number; failed: number }]>;
  const topFailures = source.failures.slice(0, 6);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-4 text-left flex flex-col gap-3 hover:bg-white/[0.03] transition-colors rounded-2xl"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <Pill tone={qaStatusTone(source.status)}>{qaStatusLabel(source.status)}</Pill>
          <span className="text-sm font-semibold text-white">{source.label}</span>
          <span className="text-xs text-white/35">{source.kind}</span>
          <span className="ml-auto text-sm font-semibold text-white">{source.score.toFixed(1)}%</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-white/35">Faelle</p>
            <p className="text-white/80 font-medium">{source.passedCases}/{source.applicableCases}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-white/35">Fails</p>
            <p className={source.failedCases ? 'text-red-300 font-medium' : 'text-emerald-300 font-medium'}>{source.failedCases}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-white/35">Kritisch</p>
            <p className={source.criticalFailures ? 'text-red-300 font-medium' : 'text-emerald-300 font-medium'}>{source.criticalFailures}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-white/35">Tokens ca.</p>
            <p className="text-white/80 font-medium">{source.estimatedTokens.toLocaleString('de-DE')}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-white/35">Latenzrisiko</p>
            <p className={source.latencyRisk === 'high' ? 'text-red-300 font-medium' : source.latencyRisk === 'medium' ? 'text-orange-300 font-medium' : 'text-emerald-300 font-medium'}>{source.latencyRisk}</p>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {source.notes.length > 0 && (
            <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-100/75">
              {source.notes.join(' ')}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
            {layers.map(([layer, stats]) => (
              <div key={layer} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                <p className="text-white/35">{LAYER_LABELS[layer]}</p>
                <p className="text-white/80">{stats.passed}/{stats.total}</p>
                {stats.failed > 0 && <p className="text-red-300/90">{stats.failed} offen</p>}
              </div>
            ))}
          </div>

          {source.promptOptimizations.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-white/70">Prompt-Optimierer</h4>
              <div className="grid md:grid-cols-2 gap-2">
                {source.promptOptimizations.slice(0, 6).map((item) => (
                  <div key={item} className="rounded-xl border border-orange-500/15 bg-orange-500/5 px-3 py-2 text-xs text-orange-100/85">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {topFailures.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-white/70">Kritische Samples</h4>
              {topFailures.map((failure) => (
                <div key={failure.id} className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill tone={failure.severity === 'critical' || failure.severity === 'high' ? 'red' : 'orange'}>{failure.severity}</Pill>
                    <Pill tone="gray">{failure.promptManagerArea}</Pill>
                    <span className="text-white/80 font-medium">{failure.title}</span>
                  </div>
                  <p className="text-white/45">Nutzerinput: {failure.userInput}</p>
                  <p className="text-white/65">{failure.requirement}</p>
                  {failure.missing.length > 0 && <p className="text-red-200/75">Fehlt: {failure.missing.join(', ')}</p>}
                  <p className="text-orange-100/75">{failure.recommendation}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200/80">
              Keine offenen Sample-Failures in diesem Prompt.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PromptQaLiveCallCard({ result }: { result: AdminPromptQaLiveCallSourceResult }) {
  const [open, setOpen] = useState(result.status !== 'green');
  const families = Object.entries(result.familyBreakdown)
    .sort((a, b) => b[1].failed - a[1].failed || b[1].total - a[1].total)
    .slice(0, 5);

  return (
    <div className="rounded-xl border border-white/10 bg-black/20">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-3 text-left flex items-center gap-3 flex-wrap hover:bg-white/[0.03] transition-colors rounded-xl"
      >
        <Pill tone={qaStatusTone(result.status)}>{qaStatusLabel(result.status)}</Pill>
        <span className="text-sm font-semibold text-white">{result.label}</span>
        <span className="text-xs text-white/35">{result.kind}</span>
        <span className="ml-auto text-sm font-semibold text-white">{result.score.toFixed(1)}%</span>
        <span className={result.failedRuns ? 'text-xs text-red-300' : 'text-xs text-emerald-300'}>
          {result.passedRuns}/{result.applicableRuns} bestanden
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {families.map(([family, stats]) => (
              <div key={family} className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs">
                <p className="text-white/35 truncate">{family}</p>
                <p className="text-white/80">{stats.passed}/{stats.total}</p>
                {stats.failed > 0 && <p className="text-red-300/90">{stats.failed} offen</p>}
              </div>
            ))}
          </div>

          {result.highestRiskFailures.length > 0 ? (
            <div className="space-y-2">
              {result.highestRiskFailures.slice(0, 3).map((failure) => (
                <div key={failure.scenarioId} className="rounded-lg border border-red-500/15 bg-red-500/5 px-3 py-2 text-xs space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill tone={failure.severity === 'critical' || failure.severity === 'high' ? 'red' : 'orange'}>{failure.severity}</Pill>
                    <Pill tone="gray">{LAYER_LABELS[failure.layer]}</Pill>
                    <span className="text-white/80 font-medium">{failure.title}</span>
                  </div>
                  <p className="text-white/45">Call-Situation: {failure.callerInput}</p>
                  <p className="text-white/60">Soll: {failure.expectedAgentBehavior}</p>
                  <p className="text-red-200/75">Fehlende Regeln: {failure.missingRuleIds.join(', ')}</p>
                  {failure.recommendations[0] && <p className="text-orange-100/75">{failure.recommendations[0]}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200/80">
              Keine offenen Livecall-Dry-Run-Failures fuer diese Quelle.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function PromptQaTab() {
  const [report, setReport] = useState<AdminPromptQaReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | AdminPromptQaStatus>('all');

  const load = useCallback(() => {
    setLoading(true);
    adminGetPromptQa()
      .then(setReport)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !report) return <Spinner />;

  const sources = report.sources
    .filter((source) => filter === 'all' || source.status === filter)
    .sort((a, b) => b.criticalFailures - a.criticalFailures || a.score - b.score || b.failedCases - a.failedCases);
  const liveCall = report.liveCallDryRun;
  const liveCallSources = liveCall?.sourceResults
    .filter((source) => filter === 'all' || source.status === filter)
    .sort((a, b) => b.criticalFailures - a.criticalFailures || a.score - b.score || b.failedRuns - a.failedRuns) ?? [];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-white">Prompt QA: {report.caseBank.totalCases}-Fall Dry-Run</h2>
            <p className="text-sm text-white/45 mt-1">
              Mehrere simulierte Tester-Agenten pruefen Website-Demo, Dashboard-Prompt, Sales und Baselines. Es werden keine echten Calls, Termine, SMS, CRM-Aktionen oder Retell-Deploys ausgefuehrt.
            </p>
          </div>
          <button
            onClick={load}
            className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-sm font-semibold text-orange-200 hover:bg-orange-500/15 transition-colors"
          >
            Neu testen
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
            <p className="text-xs text-white/35">Gesamtstatus</p>
            <p className="mt-1"><Pill tone={qaStatusTone(report.overall.status)}>{qaStatusLabel(report.overall.status)}</Pill></p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
            <p className="text-xs text-white/35">Score</p>
            <p className="text-xl font-semibold text-white">{report.overall.score.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
            <p className="text-xs text-white/35">Case-Bank</p>
            <p className="text-xl font-semibold text-white">{report.caseBank.totalCases}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
            <p className="text-xs text-white/35">Quellen</p>
            <p className="text-xl font-semibold text-white">{report.overall.sources}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
            <p className="text-xs text-white/35">Fails</p>
            <p className={report.overall.failedCases ? 'text-xl font-semibold text-red-300' : 'text-xl font-semibold text-emerald-300'}>{report.overall.failedCases}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
            <p className="text-xs text-white/35">Modell</p>
            <p className="text-sm font-semibold text-white truncate">{report.model}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-white">Simulierte Reviewer-Agenten</h3>
          <span className="text-xs text-white/35">Run mode: {report.runMode}, Live-Modell: {report.liveModelSimulation}</span>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
          {report.simulationAgents.map((agent) => (
            <div key={agent.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs space-y-2">
              <p className="font-semibold text-white">{agent.name}</p>
              <p className="text-white/55 leading-relaxed">{agent.focus}</p>
              <div className="flex gap-1 flex-wrap">
                {agent.layers.map((layer) => <Pill key={layer} tone="gray">{LAYER_LABELS[layer]}</Pill>)}
              </div>
              <p className="text-cyan-100/60">{agent.guardrail}</p>
            </div>
          ))}
        </div>
      </div>

      {liveCall && (
        <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.045] p-4 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-white">Livecall-Dry-Run: {liveCall.totalRuns} Szenarien</h3>
              <p className="text-sm text-white/50 mt-1">
                Simuliert echte Call-Risiken wie STT, Barge-in, E-Mail, Nummern, Tools, Handoff und Datenschutz. Keine echten Retell-Anrufe.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <p className="text-white/35">Runs</p>
                <p className="text-white font-semibold">{liveCall.totalRuns}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <p className="text-white/35">Echte Calls</p>
                <p className="text-emerald-300 font-semibold">{liveCall.actualCallsPlaced}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <p className="text-white/35">Modell</p>
                <p className="text-white font-semibold">{liveCall.liveModelSimulation}</p>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-2">
            {liveCall.families.map((family) => (
              <div key={family.id} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                <p className="text-white/35">{LAYER_LABELS[family.layer]}</p>
                <p className="text-white/80 truncate">{family.title}</p>
                <p className="text-cyan-100/60">{family.runs} Varianten</p>
              </div>
            ))}
          </div>

          <p className="rounded-xl border border-cyan-500/15 bg-black/20 px-3 py-2 text-xs text-cyan-100/70">
            {liveCall.note}
          </p>

          <div className="space-y-2">
            {liveCallSources.map((source) => <PromptQaLiveCallCard key={source.sourceId} result={source} />)}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-white/45 text-sm">Filter:</span>
        {(['all', 'red', 'yellow', 'green'] as const).map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === item
                ? 'border-orange-500/40 bg-orange-500/15 text-orange-200'
                : 'border-white/10 bg-white/5 text-white/45 hover:bg-white/10'
            }`}
          >
            {item === 'all' ? 'Alle' : qaStatusLabel(item)}
          </button>
        ))}
        <span className="ml-auto text-xs text-white/30">Generiert: {fmtDate(report.generatedAt)}</span>
      </div>

      <div className="space-y-3">
        {sources.map((source) => <PromptQaSourceCard key={source.id} source={source} />)}
      </div>
    </div>
  );
}

// ── Learnings ────────────────────────────────────────────────────────────────

export function LearningsTab() {
  const [items, setItems] = useState<AdminLearningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'applied' | 'rejected' | 'all'>('pending');
  const [view, setView] = useState<'queue' | 'corrections'>('queue');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftReason, setDraftReason] = useState('');
  const [draftScope, setDraftScope] = useState<'systemic' | 'org' | 'both'>('systemic');

  const load = useCallback(() => {
    setLoading(true);
    adminGetLearnings({ status: statusFilter, limit: 200 })
      .then((res) => setItems(res.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { if (view === 'queue') load(); }, [load, view]);

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

  function startEdit(item: AdminLearningItem) {
    setEditingId(item.id);
    setDraftText(item.proposed);
    setDraftReason('');
    // Audit-Round-11 LOW (Codex): both branches resolved to 'systemic'.
    // Default is 'systemic' for both kinds — admin can flip in the dropdown.
    setDraftScope('systemic');
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftText('');
    setDraftReason('');
  }

  async function saveCorrection(item: AdminLearningItem) {
    if (!draftText.trim()) {
      alert('Korrigierter Text darf nicht leer sein.');
      return;
    }
    setBusy(item.id);
    try {
      const res = await adminDecideLearning({
        sourceKind: item.kind,
        sourceId: item.id,
        decision: 'correct',
        scope: draftScope,
        correctedText: draftText,
        correctionReason: draftReason.trim() || undefined,
      });
      const note = [
        res.systemicApplied ? 'systemisch ✓' : '',
        res.orgApplied ? 'kunden-spezifisch ✓' : '',
      ].filter(Boolean).join(' + ');
      alert(`Korrigiert + angewendet (${draftScope}). ${note}\n\nDie Korrektur landet im Meta-Lernen-Feed und verbessert künftige Vorschläge.`);
      cancelEdit();
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
      {/* View toggle: Queue (eingehende Vorschläge) vs. Corrections (Meta-Lernen-Feed) */}
      <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit">
        <button
          onClick={() => setView('queue')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            view === 'queue' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/70'
          }`}
        >
          Vorschläge
        </button>
        <button
          onClick={() => setView('corrections')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            view === 'corrections' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/70'
          }`}
        >
          Meta-Lernen
        </button>
      </div>

      {view === 'corrections' && <CorrectionsFeed />}
      {view === 'queue' && (<>

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
        Verbesserung ausgelöst haben), oder <Pill tone="orange">beides</Pill>. Mit <Pill tone="orange">Verbessern</Pill> kannst du
        die vorgeschlagene Änderung umschreiben bevor du sie anwendest — diese Korrekturen landen im Meta-Lernen-Feed und verbessern
        künftige Vorschläge. Lehnt man ab, bleibt die Verbesserung im Archiv aber wird nicht angewendet.
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
                    ) : editingId === it.id ? (
                      <div className="space-y-3 pt-2 rounded-lg bg-amber-500/[0.04] border border-amber-500/20 p-3">
                        <div className="text-xs font-medium text-amber-300">✏️ Verbessern: schreibe die Änderung um wie sie WIRKLICH lauten soll</div>
                        <div>
                          <label className="block text-[11px] text-white/50 mb-1">Korrigierter Text</label>
                          <textarea
                            value={draftText}
                            onChange={(e) => setDraftText(e.target.value)}
                            rows={Math.min(20, Math.max(6, draftText.split('\n').length + 1))}
                            className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white/90 text-xs font-mono resize-y focus:outline-none focus:border-amber-500/50"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-white/50 mb-1">Warum hast du das geändert? (geht ins Meta-Lernen)</label>
                          <textarea
                            value={draftReason}
                            onChange={(e) => setDraftReason(e.target.value)}
                            rows={2}
                            placeholder="z.B. 'Original war zu rigide — Kunde will flexibler reagieren'"
                            className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white/90 text-xs resize-y focus:outline-none focus:border-amber-500/50"
                          />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] text-white/50">Anwenden als:</span>
                          {(['systemic', 'org', 'both'] as const).map((s) => {
                            const disabled = it.kind === 'template_learning' && (s === 'org' || s === 'both');
                            return (
                              <button
                                key={s}
                                onClick={() => setDraftScope(s)}
                                disabled={disabled}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                                  draftScope === s ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                                } disabled:opacity-30 disabled:cursor-not-allowed`}
                              >
                                {s === 'systemic' ? 'systemisch' : s === 'org' ? 'nur Kunde' : 'beides'}
                              </button>
                            );
                          })}
                          <button
                            onClick={() => saveCorrection(it)}
                            disabled={busy === it.id}
                            className="ml-auto px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-medium hover:bg-amber-500/30 disabled:opacity-40 transition-colors"
                          >
                            {busy === it.id ? '…' : 'Korrektur speichern + anwenden'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={busy === it.id}
                            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 text-xs hover:bg-white/10 disabled:opacity-40 transition-colors"
                          >
                            Abbrechen
                          </button>
                        </div>
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
                          onClick={() => startEdit(it)}
                          disabled={busy === it.id}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium hover:bg-amber-500/25 disabled:opacity-40 transition-colors"
                          title="Vorschlag umschreiben — die Korrektur fließt ins Meta-Lernen ein"
                        >
                          ✏️ Verbessern
                        </button>
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
      </>)}
    </div>
  );
}

// ── Corrections-Feed (Meta-Lernen) ───────────────────────────────────────────

function CorrectionsFeed() {
  const [corrections, setCorrections] = useState<AdminLearningCorrection[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    adminGetCorrections({ limit: 200 })
      .then((res) => setCorrections(res.corrections))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3 text-xs text-white/70 space-y-1">
        <p><strong className="text-white/90">Meta-Lernen (Verbesserungen der Verbesserungen)</strong></p>
        <p>Jedes Mal wenn du einen Vorschlag mit <Pill tone="orange">Verbessern</Pill> umschreibst statt blind zu übernehmen, landet das Tupel <em>(Original → Korrektur + Grund)</em> hier. Der Suggestion-Generator zieht diesen Feed als Trainingsmaterial heran — das System lernt aus seinen eigenen Fehlern.</p>
        <p className="text-white/40">Nur im Admin sichtbar. Kunden sehen weder den ursprünglichen Vorschlag noch die Korrektur.</p>
      </div>

      {loading ? <Spinner /> : corrections.length === 0 ? (
        <p className="text-white/30 text-sm text-center py-12">Noch keine Korrekturen. Sobald du einen Vorschlag mit <em>Verbessern</em> umschreibst, taucht er hier auf.</p>
      ) : (
        <div className="space-y-2">
          {corrections.map((c) => {
            const open = openId === c.id;
            return (
              <div key={c.id} className="rounded-xl bg-white/5 border border-white/10">
                <button
                  onClick={() => setOpenId(open ? null : c.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04] transition-colors"
                >
                  <span className="text-xs text-white/40 w-32 shrink-0">{fmtDate(c.createdAt)}</span>
                  <Pill tone={c.sourceKind === 'template_learning' ? 'orange' : 'gray'}>{c.sourceKind === 'template_learning' ? 'systemisch' : 'pro-org'}</Pill>
                  {c.scopeApplied && <Pill tone="green">{c.scopeApplied}</Pill>}
                  <span className="text-sm text-white/80 truncate flex-1">{c.summary ?? c.correctionReason ?? '— ohne Beschreibung'}</span>
                  <span className="text-[11px] text-white/40 shrink-0">{c.appliedBy ?? 'unbekannt'}</span>
                </button>
                {open && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/5">
                    {c.correctionReason && (
                      <div className="text-xs">
                        <span className="text-white/40">Begründung:</span>
                        <p className="text-white/80 mt-1 italic">{c.correctionReason}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-[11px] text-white/40 mb-1">System-Vorschlag (original)</div>
                        <pre className="p-3 rounded-lg bg-red-500/[0.04] border border-red-500/15 whitespace-pre-wrap text-white/70 text-xs max-h-72 overflow-auto">{c.originalText}</pre>
                      </div>
                      <div>
                        <div className="text-[11px] text-emerald-300/70 mb-1">Admin-Korrektur (angewendet)</div>
                        <pre className="p-3 rounded-lg bg-emerald-500/[0.04] border border-emerald-500/20 whitespace-pre-wrap text-white/85 text-xs max-h-72 overflow-auto">{c.correctedText}</pre>
                      </div>
                    </div>
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
