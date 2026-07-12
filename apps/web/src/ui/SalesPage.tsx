import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhonbotBrand } from './FoxLogo.js';
import { IconCalendar, IconCalls, IconInsights, IconPhone, IconStar, IconTickets } from './PhonbotIcons.js';
import {
  ApiError,
  SALES_AUTH_EXPIRED_EVENT,
  clearSalesSession,
  setSalesToken,
  salesBookLead,
  salesChangePassword,
  salesClaimHotLead,
  salesCloseHotLead,
  salesDashboard,
  salesDeleteLead,
  salesFailHotLead,
  salesGenerateLeads,
  salesGetHotLeads,
  salesGetLeads,
  salesGetMessages,
  salesGetTesters,
  salesLogin,
  salesMarkCalled,
  salesSendTestLink,
  salesUpdateLead,
  type SalesHotLead,
  type SalesLead,
  type SalesRep,
  type SalesTester,
} from '../lib/api.js';

type Tab = 'cold' | 'hot' | 'tester' | 'messages';
type DashboardStats = { coldOpen: number; hotOpen: number; closed: number; commissionPct: number };

const DEFAULT_PASSWORD = 'phonbotvertrieb123';
const LEAD_PAGE_SIZE = 30;
const RESEARCH_BATCH_SIZE = 80;

function glassClass(extra = '') {
  return `rounded-3xl border border-white/10 bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl ${extra}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function parseError(err: unknown): string {
  if (err instanceof Error) return err.message.replace(/^API \d+:\s*/, '');
  return 'Aktion fehlgeschlagen';
}

function isUnauthorizedError(err: unknown): boolean {
  return err instanceof ApiError ? err.isUnauthorized : Boolean(err && typeof err === 'object' && (err as { status?: unknown }).status === 401);
}

function ScorePill({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-orange-400/25 bg-orange-500/10 px-2.5 py-1 text-xs font-bold text-orange-100">
      <IconStar size={13} />
      Bedarf {score}/5
    </span>
  );
}

function LoginOverlay({ onLogin, notice }: { onLogin: (rep: SalesRep) => void; notice?: string | null }) {
  const [email, setEmail] = useState('info@mindrails.de');
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await salesLogin(email, password);
      setSalesToken(result.token);
      sessionStorage.setItem('phonbot_sales_token', result.token);
      sessionStorage.setItem('phonbot_sales_rep', JSON.stringify(result.rep));
      onLogin(result.rep);
    } catch (err) {
      setError(parseError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl">
      <form onSubmit={submit} className={glassClass('w-full max-w-md p-7')}>
        <div className="mb-6 text-center">
          <PhonbotBrand size="md" />
          <p className="mt-3 text-sm text-white/45">Vertriebler-Login</p>
        </div>
        {notice && <p className="mb-4 rounded-2xl border border-orange-500/20 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">{notice}</p>}
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-white/35">E-Mail</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white outline-none focus:border-orange-500/50" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-white/35">Passwort</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white outline-none focus:border-orange-500/50" />
          </label>
        </div>
        {error && <p className="mt-4 rounded-2xl border border-orange-400/20 bg-orange-500/10 px-4 py-3 text-sm text-orange-100/80">{error}</p>}
        <button disabled={loading} className="mt-5 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#ff5b0a,#20d9ff)' }}>
          {loading ? 'Einloggen...' : 'Einloggen'}
        </button>
      </form>
    </div>
  );
}

function PasswordSetup({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState(DEFAULT_PASSWORD);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await salesChangePassword(currentPassword, newPassword);
      setSalesToken(result.token);
      sessionStorage.setItem('phonbot_sales_token', result.token);
      const raw = sessionStorage.getItem('phonbot_sales_rep');
      if (raw) {
        const rep = JSON.parse(raw) as SalesRep;
        sessionStorage.setItem('phonbot_sales_rep', JSON.stringify({ ...rep, mustChangePassword: false, must_change_password: false }));
      }
      onDone();
    } catch (err) {
      setError(parseError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={glassClass('mx-auto mt-10 max-w-xl p-7')}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-200/60">Erster Login</p>
      <h2 className="mt-2 text-2xl font-black text-white">Eigenes Passwort anlegen</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/50">Das Admin-Team sieht dein neues Passwort nicht. Es kann nur ein neues temporäres Passwort setzen.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Temporäres Passwort" className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white outline-none focus:border-orange-500/50" />
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Neues Passwort, mindestens 8 Zeichen" className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white outline-none focus:border-orange-500/50" />
        {error && <p className="rounded-2xl border border-orange-400/20 bg-orange-500/10 px-4 py-3 text-sm text-orange-100/80">{error}</p>}
        <button disabled={loading || newPassword.length < 8} className="w-full rounded-2xl px-4 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#ff5b0a,#20d9ff)' }}>
          Passwort speichern
        </button>
      </form>
    </div>
  );
}

function LeadDetail({ lead, onClose, onChanged }: { lead: SalesLead; onClose: () => void; onChanged: () => void }) {
  const [localLead, setLocalLead] = useState(lead);
  const [basis, setBasis] = useState<'explicit_request' | 'existing_business_relation' | 'manual_one_to_one_context'>('explicit_request');
  const [emailDraft, setEmailDraft] = useState(lead.email ?? '');
  const [appointmentType, setAppointmentType] = useState<SalesHotLead['appointment_type']>('phone');
  const [slotTime, setSlotTime] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalLead(lead);
    setEmailDraft(lead.email ?? '');
  }, [lead]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveEmail() {
    setBusy('email');
    setError(null);
    try {
      const saved = await salesUpdateLead(localLead.id, { email: emailDraft });
      setLocalLead(saved.lead);
      setEmailDraft(saved.lead.email ?? '');
    } catch (err) {
      setError(parseError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl" onClick={onClose}>
      <div className={glassClass('max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/60">Cold Lead</p>
            <h2 className="mt-1 text-2xl font-black text-white">{localLead.company_name}</h2>
            <p className="mt-1 text-sm text-white/45">{localLead.address ?? localLead.city ?? 'Adresse fehlt'}</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/50 hover:text-white">Schließen</button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-white/35">Telefon</p>
            <p className="mt-1 text-sm font-semibold text-white">{localLead.phone}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-white/35">E-Mail</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{localLead.email ?? 'noch offen'}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-white/35">Ansprechpartner</p>
            <p className="mt-1 text-sm font-semibold text-white">{localLead.contact_name ?? 'nicht gefunden'}</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-orange-500/20 bg-orange-500/[0.07] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-white">Bedarfsanalyse</p>
            <ScorePill score={localLead.need_score} />
          </div>
          <ul className="space-y-2 text-sm text-white/65">
            {(localLead.need_reasons ?? []).map((r, i) => <li key={`${r}-${i}`}>- {r}</li>)}
          </ul>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm font-bold text-white">Testlink schicken</p>
            <p className="mt-1 text-xs leading-relaxed text-white/45">Nur nutzen, wenn der Kontaktgrund geprüft ist. Kein freier Massenversand.</p>
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-white/35">E-Mail fuer Testlink</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input type="email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder="name@salon.de" className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50" />
                <button disabled={busy === 'email' || !emailDraft.trim()} onClick={() => void saveEmail()} className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:border-orange-500/30 hover:text-white disabled:opacity-40">
                  Speichern
                </button>
              </div>
              {!localLead.email && <p className="mt-2 rounded-xl border border-cyan-400/15 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100/75">E-Mail fehlt noch. Trag sie einmal ein, dann ist der Testlink-Button aktiv.</p>}
            </div>
            <select value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)} className="mt-3 w-full rounded-xl border border-white/10 bg-[#101018] px-3 py-2 text-sm text-white">
              <option value="explicit_request">Kunde hat Link angefragt</option>
              <option value="existing_business_relation">Bestehender Geschäftskontakt</option>
              <option value="manual_one_to_one_context">Manuell geprüfter 1:1 Kontext</option>
            </select>
            <button disabled={!localLead.email || busy === 'mail'} onClick={() => run('mail', () => salesSendTestLink(localLead.id, basis))} className="mt-3 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#ff5b0a,#20d9ff)' }}>
              Testlink schicken
            </button>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm font-bold text-white">Termin buchen</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select value={appointmentType} onChange={(e) => setAppointmentType(e.target.value as SalesHotLead['appointment_type'])} className="rounded-xl border border-white/10 bg-[#101018] px-3 py-2 text-sm text-white">
                <option value="phone">Telefontermin</option>
                <option value="video">Google Meet / Zoom</option>
                <option value="field">Außendienst</option>
              </select>
              <input type="datetime-local" value={slotTime} onChange={(e) => setSlotTime(e.target.value)} className="rounded-xl border border-white/10 bg-[#101018] px-3 py-2 text-sm text-white" />
            </div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Wichtige Gesprächsnotizen" className="mt-2 min-h-20 w-full rounded-xl border border-white/10 bg-[#101018] px-3 py-2 text-sm text-white placeholder:text-white/25" />
            <button disabled={!slotTime || busy === 'book'} onClick={() => run('book', () => salesBookLead(localLead.id, { appointmentType, slotTime, durationMinutes: 45, notes }))} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#ff5b0a,#20d9ff)' }}>
              In Hot Leads schieben
            </button>
          </section>
        </div>

        {error && <p className="mt-4 rounded-2xl border border-orange-400/20 bg-orange-500/10 px-4 py-3 text-sm text-orange-100/80">{error}</p>}
        <div className="mt-5 flex justify-end">
          <button onClick={() => {
            if (window.confirm('Lead wirklich dauerhaft sperren und löschen?')) void run('delete', () => salesDeleteLead(localLead.id).then(onClose));
          }} className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-4 py-2 text-sm font-semibold text-orange-100">
            Dauerhaft löschen
          </button>
        </div>
      </div>
    </div>
  );
}

export function SalesPage() {
  const [rep, setRep] = useState<SalesRep | null>(() => {
    const token = sessionStorage.getItem('phonbot_sales_token');
    const raw = sessionStorage.getItem('phonbot_sales_rep');
    if (!token || !raw) {
      clearSalesSession();
      return null;
    }
    try {
      setSalesToken(token);
      return JSON.parse(raw) as SalesRep;
    } catch {
      clearSalesSession();
      return null;
    }
  });
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('cold');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [hotLeads, setHotLeads] = useState<SalesHotLead[]>([]);
  const [testers, setTesters] = useState<SalesTester[]>([]);
  const [messages, setMessages] = useState<Array<{ id: string; text: string; created_at: string }>>([]);
  const [industry, setIndustry] = useState('friseur');
  const [city, setCity] = useState('Berlin');
  const [minScore, setMinScore] = useState(3);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [researching, setResearching] = useState(false);
  const [autoResearch, setAutoResearch] = useState(true);
  const [researchStatus, setResearchStatus] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<SalesLead | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingLeadsRef = useRef(false);
  const generatingLeadsRef = useRef(false);
  const offsetRef = useRef(0);
  const researchOffsetRef = useRef(0);
  const emptyResearchRunsRef = useRef(0);
  const researchExhaustedRef = useRef(false);

  const mustChangePassword = Boolean(rep?.mustChangePassword ?? rep?.must_change_password);

  function resetLeadCursor() {
    offsetRef.current = 0;
    researchOffsetRef.current = 0;
    emptyResearchRunsRef.current = 0;
    researchExhaustedRef.current = false;
    setHasMore(true);
    setResearchStatus(null);
  }

  const expireSalesSession = useCallback(() => {
    clearSalesSession();
    setRep(null);
    setStats(null);
    setLeads([]);
    setHotLeads([]);
    setTesters([]);
    setMessages([]);
    setSelectedLead(null);
    offsetRef.current = 0;
    researchOffsetRef.current = 0;
    emptyResearchRunsRef.current = 0;
    researchExhaustedRef.current = false;
    setHasMore(true);
    setLoading(false);
    setResearching(false);
    loadingLeadsRef.current = false;
    generatingLeadsRef.current = false;
    setResearchStatus(null);
    setToast(null);
    setSessionNotice('Sitzung abgelaufen. Bitte melde dich neu an.');
  }, []);

  useEffect(() => {
    const onExpired = () => expireSalesSession();
    window.addEventListener(SALES_AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SALES_AUTH_EXPIRED_EVENT, onExpired);
  }, [expireSalesSession]);

  const refreshDashboard = useCallback(() => {
    if (!rep) return;
    salesDashboard().then((r) => setStats(r.stats)).catch((err) => {
      if (isUnauthorizedError(err)) expireSalesSession();
    });
  }, [expireSalesSession, rep]);

  const loadLeads = useCallback(async (reset = false) => {
    if (!rep || loadingLeadsRef.current) return null;
    loadingLeadsRef.current = true;
    setLoading(true);
    try {
      const nextOffset = reset ? 0 : offsetRef.current;
      const res = await salesGetLeads({ industry, city, minScore, limit: LEAD_PAGE_SIZE, offset: nextOffset });
      setLeads(prev => reset ? res.items : [...prev, ...res.items]);
      const updatedOffset = nextOffset + res.items.length;
      offsetRef.current = updatedOffset;
      setHasMore(res.items.length === LEAD_PAGE_SIZE);
      return res.items.length;
    } catch (err) {
      if (isUnauthorizedError(err)) {
        expireSalesSession();
        return null;
      }
      setToast(parseError(err));
      return null;
    } finally {
      loadingLeadsRef.current = false;
      setLoading(false);
    }
  }, [city, expireSalesSession, industry, minScore, rep]);

  const refreshHot = useCallback(() => {
    salesGetHotLeads({}).then((r) => setHotLeads(r.items)).catch((err) => {
      if (isUnauthorizedError(err)) {
        expireSalesSession();
        return;
      }
      setToast(parseError(err));
    });
  }, [expireSalesSession]);

  const researchMoreLeads = useCallback(async (manual = false) => {
    if (!rep || generatingLeadsRef.current) return null;
    if (!manual && (!autoResearch || researchExhaustedRef.current)) return null;
    generatingLeadsRef.current = true;
    setResearching(true);
    setResearchStatus(manual ? 'Suche weitere Betriebe...' : 'Scrolle erkannt: neue Betriebe werden automatisch recherchiert...');
    try {
      const currentOffset = researchOffsetRef.current;
      const r = await salesGenerateLeads({ industry, city, limit: RESEARCH_BATCH_SIZE, offset: currentOffset });
      researchOffsetRef.current = currentOffset + RESEARCH_BATCH_SIZE;

      if (r.found === 0) {
        researchExhaustedRef.current = true;
        setHasMore(false);
        setResearchStatus('Fuer diese Suche liefert OpenStreetMap gerade keine weiteren Betriebe mit Telefonnummer.');
        return 0;
      }

      if (r.inserted === 0) {
        emptyResearchRunsRef.current += 1;
        if (emptyResearchRunsRef.current >= 2) {
          researchExhaustedRef.current = true;
          setResearchStatus('Keine neuen eindeutigen Betriebe mehr gefunden. Andere Stadt oder Branche bringt mehr.');
        } else {
          setResearchStatus('Diese Runde war schon bekannt. Beim Weiter-Scrollen pruefe ich die naechsten Treffer.');
        }
      } else {
        emptyResearchRunsRef.current = 0;
        setResearchStatus(`${r.inserted} neue Betriebe aus ${r.source} gespeichert.`);
      }

      offsetRef.current = 0;
      return await loadLeads(true);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        expireSalesSession();
        return null;
      }
      setToast(parseError(err));
      setResearchStatus('Recherche konnte gerade nicht nachlegen. Der manuelle Button versucht es erneut.');
      return null;
    } finally {
      generatingLeadsRef.current = false;
      setResearching(false);
    }
  }, [autoResearch, city, expireSalesSession, industry, loadLeads, rep]);

  useEffect(() => {
    if (!rep || mustChangePassword) return;
    refreshDashboard();
    void (async () => {
      const loaded = await loadLeads(true);
      if (loaded === 0 && autoResearch) await researchMoreLeads(false);
    })();
    refreshHot();
    salesGetTesters().then((r) => setTesters(r.items)).catch((err) => {
      if (isUnauthorizedError(err)) expireSalesSession();
    });
    salesGetMessages().then((r) => setMessages(r.items)).catch((err) => {
      if (isUnauthorizedError(err)) expireSalesSession();
    });
  }, [autoResearch, expireSalesSession, loadLeads, mustChangePassword, refreshDashboard, refreshHot, rep, researchMoreLeads]);

  useEffect(() => {
    if (!rep || mustChangePassword || tab !== 'cold') return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || loading || researching) return;
      if (hasMore) void loadLeads(false);
      else void researchMoreLeads(false);
    }, { rootMargin: '500px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadLeads, loading, mustChangePassword, rep, researchMoreLeads, researching, tab]);

  const hotByType = useMemo(() => ({
    phone: hotLeads.filter(h => h.appointment_type === 'phone'),
    video: hotLeads.filter(h => h.appointment_type === 'video'),
    field: hotLeads.filter(h => h.appointment_type === 'field'),
  }), [hotLeads]);

  if (!rep) return <LoginOverlay notice={sessionNotice} onLogin={(nextRep) => { setSessionNotice(null); setRep(nextRep); }} />;

  return (
    <div className="min-h-screen bg-[#0A0A0F] px-4 py-5 text-white sm:px-6">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="crystal-page-glow absolute -top-40 right-0 h-[520px] w-[520px]" style={{ background: 'radial-gradient(ellipse,rgba(255,91,10,.11),transparent 62%)' }} />
        <div className="crystal-page-glow crystal-page-glow-cyan absolute bottom-0 left-10 h-[420px] w-[420px]" style={{ background: 'radial-gradient(ellipse,rgba(32,217,255,.08),transparent 62%)' }} />
      </div>
      <div className="relative z-10 mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <PhonbotBrand size="sm" />
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Vertrieb Cockpit</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">Cold Leads finden, Hot Leads terminieren, Tester nachfassen und Provisionen sauber zuordnen.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/65">
            {rep.name} · <span className="text-orange-200">{rep.mode === 'self' ? 'Self Mode' : rep.mode === 'auto' ? 'Auto Mode' : 'Halb-Auto'}</span>
          </div>
        </header>

        {mustChangePassword ? (
          <PasswordSetup onDone={() => setRep(prev => prev ? { ...prev, mustChangePassword: false, must_change_password: false } : prev)} />
        ) : (
          <>
            <div className="mb-5 grid gap-3 sm:grid-cols-4">
              {[
                { label: 'Cold Leads', value: stats?.coldOpen ?? '–', Icon: IconCalls },
                { label: 'Hot Leads', value: stats?.hotOpen ?? '–', Icon: IconCalendar },
                { label: 'Abschlüsse', value: stats?.closed ?? '–', Icon: IconTickets },
                { label: 'Provision', value: '5% + 7%', Icon: IconStar },
              ].map(({ label, value, Icon }) => (
                <div key={label} className={glassClass('p-4')}>
                  <div className="flex items-center gap-2 text-xs text-white/40"><Icon size={15} />{label}</div>
                  <p className="mt-2 text-2xl font-black">{value}</p>
                </div>
              ))}
            </div>

            <nav className="mb-5 flex flex-wrap gap-2 rounded-3xl border border-white/10 bg-white/[0.03] p-1.5">
              {[
                ['cold', 'Cold Leads'],
                ['hot', 'Hot Leads'],
                ['tester', 'Tester'],
                ['messages', 'Nachrichten'],
              ].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id as Tab)} className={`rounded-2xl px-4 py-2 text-sm font-semibold transition-all ${tab === id ? 'text-white' : 'text-white/40 hover:text-white/70'}`} style={tab === id ? { background: 'linear-gradient(135deg,#ff5b0a,#20d9ff)' } : undefined}>
                  {label}
                </button>
              ))}
            </nav>

            {toast && <p className="mb-4 rounded-2xl border border-orange-500/20 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">{toast}</p>}

            {tab === 'cold' && (
              <section>
                <div className={glassClass('mb-4 p-4')}>
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px_auto]">
                    <select value={industry} onChange={(e) => { setIndustry(e.target.value); resetLeadCursor(); }} className="rounded-2xl border border-white/10 bg-[#101018] px-4 py-3 text-sm">
                      <option value="friseur">Friseure</option>
                      <option value="kosmetik">Kosmetik</option>
                      <option value="restaurant">Restaurants</option>
                    </select>
                    <input value={city} onChange={(e) => { setCity(e.target.value); resetLeadCursor(); }} placeholder="Stadt" className="rounded-2xl border border-white/10 bg-[#101018] px-4 py-3 text-sm" />
                    <select value={minScore} onChange={(e) => { setMinScore(Number(e.target.value)); resetLeadCursor(); }} className="rounded-2xl border border-white/10 bg-[#101018] px-4 py-3 text-sm">
                      {[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>ab Bedarf {v}</option>)}
                    </select>
                    <button disabled={loading || researching} onClick={() => void researchMoreLeads(true)} className="rounded-2xl px-4 py-3 text-sm font-bold disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#ff5b0a,#20d9ff)' }}>
                      {researching ? 'Recherchiere...' : 'Nachlegen'}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-col gap-3 text-xs leading-relaxed text-white/40 sm:flex-row sm:items-center sm:justify-between">
                    <p>Quelle: OpenStreetMap/Overpass. Beim Scrollen werden automatisch weitere Betriebe nachgelegt; der Button ist nur ein schneller manueller Push.</p>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-white/55">
                      <input
                        type="checkbox"
                        checked={autoResearch}
                        onChange={(e) => {
                          setAutoResearch(e.target.checked);
                          if (e.target.checked) {
                            researchExhaustedRef.current = false;
                            setResearchStatus(null);
                          }
                        }}
                        className="h-4 w-4 accent-orange-500"
                      />
                      Auto-Recherche beim Scrollen
                    </label>
                  </div>
                  {researchStatus && <p className="mt-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/10 px-4 py-3 text-xs text-cyan-100/75">{researchStatus}</p>}
                </div>

                <div className="grid gap-3">
                  {leads.map((lead) => (
                    <button key={lead.id} onClick={() => setSelectedLead(lead)} className={glassClass('p-4 text-left transition-all hover:border-orange-500/25 hover:bg-white/[0.065]')}>
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-bold">{lead.company_name}</h3>
                            <ScorePill score={lead.need_score} />
                          </div>
                          <p className="mt-1 text-sm text-white/45">{lead.address ?? lead.city ?? 'Adresse fehlt'} · {lead.phone} · {lead.email ?? 'E-Mail nachtragen'}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={(e) => { e.stopPropagation(); void salesMarkCalled(lead.id).then(() => { setLeads(prev => prev.filter(l => l.id !== lead.id)); refreshDashboard(); }); }} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/60 hover:text-white">Angerufen</button>
                          <button onClick={(e) => { e.stopPropagation(); setSelectedLead(lead); }} className="rounded-xl border border-orange-400/25 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-100">{lead.email ? 'Testlink' : 'E-Mail nachtragen'}</button>
                        </div>
                      </div>
                    </button>
                  ))}
                  <div ref={sentinelRef} className="h-10" />
                  {(loading || researching) && <p className="text-center text-sm text-white/35">{researching ? 'Recherchiere neue Betriebe...' : 'Lade nach...'}</p>}
                  {!loading && !researching && leads.length === 0 && <p className="py-8 text-center text-sm text-white/25">Noch keine passenden Leads. Auto-Recherche startet, sobald diese Ansicht aktiv ist.</p>}
                </div>
              </section>
            )}

            {tab === 'hot' && (
              <div className="space-y-4">
                <div className="rounded-3xl border border-orange-400/15 bg-orange-500/[0.06] p-4 text-sm text-orange-50/75">
                  Abschluesse werden hier vorbereitet. Provisionen werden erst aktiv, wenn der Kunde wirklich ueber Registrierung/Stripe mit derselben E-Mail abgeschlossen hat.
                </div>
              <section className="grid gap-4 lg:grid-cols-3">
                {([
                  ['phone', 'Call-Kalender', IconPhone, hotByType.phone],
                  ['video', 'Video-Kalender', IconCalendar, hotByType.video],
                  ['field', 'Außendienst', IconInsights, hotByType.field],
                ] as const).map(([, title, Icon, items]) => (
                  <div key={title} className={glassClass('p-4')}>
                    <div className="mb-3 flex items-center gap-2">
                      <Icon size={18} className="text-orange-300" />
                      <h2 className="font-bold">{title}</h2>
                    </div>
                    <div className="space-y-3">
                      {items.map((h) => (
                        <div key={h.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="font-semibold">{h.customer_company}</p>
                          <p className="mt-1 text-xs text-white/45">{formatDateTime(h.slot_time)} · {h.status} · {h.booked_by_name ?? 'unbekannt'}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button onClick={() => salesClaimHotLead(h.id).then(refreshHot).catch((err) => setToast(parseError(err)))} className="rounded-xl bg-white/5 px-3 py-1.5 text-xs text-white/60">In Bearbeitung</button>
                            <button onClick={() => salesFailHotLead(h.id).then(refreshHot).catch((err) => setToast(parseError(err)))} className="rounded-xl bg-orange-500/10 px-3 py-1.5 text-xs text-orange-100">Failed</button>
                            <button onClick={() => {
                              if (window.confirm('Nur bestätigen, wenn der Kunde Legal/AGB/AVV/B2B bestätigt hat.')) {
                                salesCloseHotLead(h.id, { planId: 'starter', billingInterval: 'month', legalConfirmedByCustomer: true }).then(refreshHot).catch((err) => setToast(parseError(err)));
                              }
                            }} className="rounded-xl bg-orange-500/10 px-3 py-1.5 text-xs text-orange-100">Abschluss vorbereiten</button>
                          </div>
                        </div>
                      ))}
                      {items.length === 0 && <p className="py-8 text-center text-sm text-white/25">Keine Termine</p>}
                    </div>
                  </div>
                ))}
              </section>
              </div>
            )}

            {tab === 'tester' && (
              <section className={glassClass('p-4')}>
                <h2 className="mb-3 text-lg font-bold">Tester nach Priorität</h2>
                <div className="grid gap-3">
                  {testers.map((t) => (
                    <div key={t.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-bold">{t.name}</p>
                          <p className="text-sm text-white/40">{t.email ?? 'E-Mail fehlt'} · seit {new Date(t.created_at).toLocaleDateString('de-DE')}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${t.due ? 'bg-orange-500/15 text-orange-100' : 'bg-white/5 text-white/45'}`}>
                          {Number(t.remaining_minutes).toFixed(1)} Min übrig
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {tab === 'messages' && (
              <section className={glassClass('p-4')}>
                <h2 className="mb-3 text-lg font-bold">Gruppenchat & Signale</h2>
                <div className="space-y-3">
                  {messages.map((m) => (
                    <div key={m.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/65">
                      <span className="mr-2 text-xs text-white/30">{formatDateTime(m.created_at)}</span>
                      {m.text}
                    </div>
                  ))}
                  {messages.length === 0 && <p className="py-8 text-center text-sm text-white/25">Keine neuen Signale.</p>}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {selectedLead && (
        <LeadDetail
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onChanged={() => {
            setSelectedLead(null);
            offsetRef.current = 0;
            void loadLeads(true);
            refreshDashboard();
            refreshHot();
          }}
        />
      )}
    </div>
  );
}
