import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhonbotBrand } from './FoxLogo.js';
import { IconCalendar, IconCalls, IconInsights, IconPhone, IconStar, IconTickets } from './PhonbotIcons.js';
import {
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
  type SalesHotLead,
  type SalesLead,
  type SalesRep,
  type SalesTester,
} from '../lib/api.js';

type Tab = 'cold' | 'hot' | 'tester' | 'messages';
type DashboardStats = { coldOpen: number; hotOpen: number; closed: number; commissionPct: number };

const DEFAULT_PASSWORD = 'phonbotvertrieb123';

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

function ScorePill({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-orange-400/25 bg-orange-500/10 px-2.5 py-1 text-xs font-bold text-orange-100">
      <IconStar size={13} />
      Bedarf {score}/5
    </span>
  );
}

function LoginOverlay({ onLogin }: { onLogin: (rep: SalesRep) => void }) {
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
        {error && <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        <button disabled={loading} className="mt-5 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#F97316,#06B6D4)' }}>
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
        {error && <p className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        <button disabled={loading || newPassword.length < 8} className="w-full rounded-2xl px-4 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#F97316,#06B6D4)' }}>
          Passwort speichern
        </button>
      </form>
    </div>
  );
}

function LeadDetail({ lead, onClose, onChanged }: { lead: SalesLead; onClose: () => void; onChanged: () => void }) {
  const [basis, setBasis] = useState<'explicit_request' | 'existing_business_relation' | 'manual_one_to_one_context'>('explicit_request');
  const [appointmentType, setAppointmentType] = useState<SalesHotLead['appointment_type']>('phone');
  const [slotTime, setSlotTime] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl" onClick={onClose}>
      <div className={glassClass('max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/60">Cold Lead</p>
            <h2 className="mt-1 text-2xl font-black text-white">{lead.company_name}</h2>
            <p className="mt-1 text-sm text-white/45">{lead.address ?? lead.city ?? 'Adresse fehlt'}</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/50 hover:text-white">Schließen</button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-white/35">Telefon</p>
            <p className="mt-1 text-sm font-semibold text-white">{lead.phone ?? 'fehlt'}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-white/35">E-Mail</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{lead.email ?? 'fehlt'}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-white/35">Ansprechpartner</p>
            <p className="mt-1 text-sm font-semibold text-white">{lead.contact_name ?? 'nicht gefunden'}</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-orange-500/20 bg-orange-500/[0.07] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-white">Bedarfsanalyse</p>
            <ScorePill score={lead.need_score} />
          </div>
          <ul className="space-y-2 text-sm text-white/65">
            {(lead.need_reasons ?? []).map((r, i) => <li key={`${r}-${i}`}>• {r}</li>)}
          </ul>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm font-bold text-white">Testlink schicken</p>
            <p className="mt-1 text-xs leading-relaxed text-white/45">Nur nutzen, wenn der Kontaktgrund geprüft ist. Kein freier Massenversand.</p>
            <select value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)} className="mt-3 w-full rounded-xl border border-white/10 bg-[#101018] px-3 py-2 text-sm text-white">
              <option value="explicit_request">Kunde hat Link angefragt</option>
              <option value="existing_business_relation">Bestehender Geschäftskontakt</option>
              <option value="manual_one_to_one_context">Manuell geprüfter 1:1 Kontext</option>
            </select>
            <button disabled={!lead.email || busy === 'mail'} onClick={() => run('mail', () => salesSendTestLink(lead.id, basis))} className="mt-3 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#F97316,#06B6D4)' }}>
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
            <button disabled={!slotTime || busy === 'book'} onClick={() => run('book', () => salesBookLead(lead.id, { appointmentType, slotTime, durationMinutes: 45, notes }))} className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#F97316,#06B6D4)' }}>
              In Hot Leads schieben
            </button>
          </section>
        </div>

        {error && <p className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        <div className="mt-5 flex justify-end">
          <button onClick={() => {
            if (window.confirm('Lead wirklich dauerhaft sperren und löschen?')) void run('delete', () => salesDeleteLead(lead.id).then(onClose));
          }} className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200">
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
    if (token) setSalesToken(token);
    return raw ? JSON.parse(raw) as SalesRep : null;
  });
  const [tab, setTab] = useState<Tab>('cold');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [hotLeads, setHotLeads] = useState<SalesHotLead[]>([]);
  const [testers, setTesters] = useState<SalesTester[]>([]);
  const [messages, setMessages] = useState<Array<{ id: string; text: string; created_at: string }>>([]);
  const [industry, setIndustry] = useState('friseur');
  const [city, setCity] = useState('Berlin');
  const [minScore, setMinScore] = useState(3);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<SalesLead | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const mustChangePassword = Boolean(rep?.mustChangePassword ?? rep?.must_change_password);

  const refreshDashboard = useCallback(() => {
    if (!rep) return;
    salesDashboard().then((r) => setStats(r.stats)).catch(() => {});
  }, [rep]);

  const loadLeads = useCallback(async (reset = false) => {
    if (!rep || loading) return;
    setLoading(true);
    try {
      const nextOffset = reset ? 0 : offset;
      const res = await salesGetLeads({ industry, city, minScore, limit: 30, offset: nextOffset });
      setLeads(prev => reset ? res.items : [...prev, ...res.items]);
      setOffset(nextOffset + res.items.length);
      setHasMore(res.items.length === 30);
    } catch (err) {
      setToast(parseError(err));
    } finally {
      setLoading(false);
    }
  }, [city, industry, loading, minScore, offset, rep]);

  const refreshHot = useCallback(() => {
    salesGetHotLeads({}).then((r) => setHotLeads(r.items)).catch((err) => setToast(parseError(err)));
  }, []);

  useEffect(() => {
    if (!rep || mustChangePassword) return;
    refreshDashboard();
    void loadLeads(true);
    refreshHot();
    salesGetTesters().then((r) => setTesters(r.items)).catch(() => {});
    salesGetMessages().then((r) => setMessages(r.items)).catch(() => {});
  }, [rep, mustChangePassword]);

  useEffect(() => {
    if (!rep || mustChangePassword || tab !== 'cold') return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMore && !loading) void loadLeads(false);
    }, { rootMargin: '500px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadLeads, loading, mustChangePassword, rep, tab]);

  const hotByType = useMemo(() => ({
    phone: hotLeads.filter(h => h.appointment_type === 'phone'),
    video: hotLeads.filter(h => h.appointment_type === 'video'),
    field: hotLeads.filter(h => h.appointment_type === 'field'),
  }), [hotLeads]);

  if (!rep) return <LoginOverlay onLogin={setRep} />;

  return (
    <div className="min-h-screen bg-[#0A0A0F] px-4 py-5 text-white sm:px-6">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 right-0 h-[520px] w-[520px] rounded-full" style={{ background: 'radial-gradient(circle,rgba(249,115,22,.11),transparent 62%)', filter: 'blur(8px)' }} />
        <div className="absolute bottom-0 left-10 h-[420px] w-[420px] rounded-full" style={{ background: 'radial-gradient(circle,rgba(6,182,212,.08),transparent 62%)', filter: 'blur(8px)' }} />
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
                <button key={id} onClick={() => setTab(id as Tab)} className={`rounded-2xl px-4 py-2 text-sm font-semibold transition-all ${tab === id ? 'text-white' : 'text-white/40 hover:text-white/70'}`} style={tab === id ? { background: 'linear-gradient(135deg,#F97316,#06B6D4)' } : undefined}>
                  {label}
                </button>
              ))}
            </nav>

            {toast && <p className="mb-4 rounded-2xl border border-orange-500/20 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">{toast}</p>}

            {tab === 'cold' && (
              <section>
                <div className={glassClass('mb-4 p-4')}>
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px_auto]">
                    <select value={industry} onChange={(e) => { setIndustry(e.target.value); setOffset(0); }} className="rounded-2xl border border-white/10 bg-[#101018] px-4 py-3 text-sm">
                      <option value="friseur">Friseure</option>
                      <option value="kosmetik">Kosmetik</option>
                      <option value="restaurant">Restaurants</option>
                    </select>
                    <input value={city} onChange={(e) => { setCity(e.target.value); setOffset(0); }} placeholder="Stadt" className="rounded-2xl border border-white/10 bg-[#101018] px-4 py-3 text-sm" />
                    <select value={minScore} onChange={(e) => { setMinScore(Number(e.target.value)); setOffset(0); }} className="rounded-2xl border border-white/10 bg-[#101018] px-4 py-3 text-sm">
                      {[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>ab Bedarf {v}</option>)}
                    </select>
                    <button onClick={async () => {
                      setLoading(true);
                      try {
                        const r = await salesGenerateLeads({ industry, city, limit: 40 });
                        setToast(`${r.inserted} neue Leads aus ${r.source} gespeichert.`);
                        setOffset(0);
                        await loadLeads(true);
                      } catch (err) {
                        setToast(parseError(err));
                      } finally {
                        setLoading(false);
                      }
                    }} className="rounded-2xl px-4 py-3 text-sm font-bold" style={{ background: 'linear-gradient(135deg,#F97316,#06B6D4)' }}>
                      Liste generieren
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-white/40">Quelle: OpenStreetMap/Overpass. E-Mail-Versand ist bewusst mit Kontaktgrund-Gate geschützt, damit keine Massenmail-Falle entsteht.</p>
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
                          <p className="mt-1 text-sm text-white/45">{lead.address ?? lead.city ?? 'Adresse fehlt'} · {lead.phone ?? 'Telefon fehlt'} · {lead.email ?? 'E-Mail fehlt'}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={(e) => { e.stopPropagation(); void salesMarkCalled(lead.id).then(() => { setLeads(prev => prev.filter(l => l.id !== lead.id)); refreshDashboard(); }); }} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/60 hover:text-white">Angerufen</button>
                          <button disabled={!lead.email} onClick={(e) => { e.stopPropagation(); setSelectedLead(lead); }} className="rounded-xl border border-orange-400/25 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-100 disabled:opacity-35">Testlink</button>
                        </div>
                      </div>
                    </button>
                  ))}
                  <div ref={sentinelRef} className="h-10" />
                  {loading && <p className="text-center text-sm text-white/35">Lade nach...</p>}
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
                            <button onClick={() => salesFailHotLead(h.id).then(refreshHot).catch((err) => setToast(parseError(err)))} className="rounded-xl bg-red-500/10 px-3 py-1.5 text-xs text-red-200">Failed</button>
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
            setOffset(0);
            void loadLeads(true);
            refreshDashboard();
            refreshHot();
          }}
        />
      )}
    </div>
  );
}
