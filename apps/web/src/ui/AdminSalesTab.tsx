import { useEffect, useMemo, useState } from 'react';
import {
  adminCreateSalesRep,
  adminGetSalesHotLeads,
  adminGetSalesReps,
  adminResetSalesRepPassword,
  adminUpdateSalesRep,
  type SalesHotLead,
  type SalesRep,
} from '../lib/api.js';

const DEFAULT_PASSWORD = 'phonbotvertrieb123';

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl ${className}`}>{children}</section>;
}

function modeLabel(mode: SalesRep['mode']) {
  if (mode === 'auto') return 'Auto Mode';
  if (mode === 'self') return 'Self Mode';
  return 'Halb-Auto';
}

export function AdminSalesTab() {
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [hotLeads, setHotLeads] = useState<SalesHotLead[]>([]);
  const [selected, setSelected] = useState<SalesRep | null>(null);
  const [name, setName] = useState('Hassieb Kalla');
  const [email, setEmail] = useState('info@mindrails.de');
  const [temporaryPassword, setTemporaryPassword] = useState(DEFAULT_PASSWORD);
  const [mode, setMode] = useState<SalesRep['mode']>('semi');
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const [r, h] = await Promise.all([adminGetSalesReps(), adminGetSalesHotLeads()]);
    setReps(r.items);
    setHotLeads(h.items);
    setSelected(prev => prev ? r.items.find(item => item.id === prev.id) ?? null : null);
  }

  useEffect(() => { void load(); }, []);

  const grouped = useMemo(() => ({
    phone: hotLeads.filter(h => h.appointment_type === 'phone'),
    video: hotLeads.filter(h => h.appointment_type === 'video'),
    field: hotLeads.filter(h => h.appointment_type === 'field'),
  }), [hotLeads]);

  async function createRep(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      await adminCreateSalesRep({ name, email, temporaryPassword, mode });
      setNotice('Vertriebler angelegt. Passwort ist nur temporär und wird beim ersten Login ersetzt.');
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen');
    }
  }

  async function updateSelected(patch: { active?: boolean; mode?: SalesRep['mode']; name?: string }) {
    if (!selected) return;
    await adminUpdateSalesRep(selected.id, patch);
    await load();
  }

  async function resetPassword() {
    if (!selected) return;
    await adminResetSalesRepPassword(selected.id, DEFAULT_PASSWORD);
    setNotice(`Temporäres Passwort für ${selected.name} gesetzt. Neues Passwort wird im Admin nicht angezeigt.`);
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-200/55">Vertriebsmodul</p>
        <h2 className="mt-1 text-2xl font-black text-white">Vertrieb verwalten</h2>
        <p className="mt-2 max-w-3xl text-sm text-white/45">
          Vertriebler, globaler Hotlead-Kalender und Moduslogik. Passwörter werden nie ausgelesen, nur temporär neu gesetzt.
        </p>
      </div>

      {notice && <p className="rounded-2xl border border-orange-400/20 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">{notice}</p>}

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Panel>
          <h3 className="mb-4 text-sm font-bold text-white">Vertriebler anlegen</h3>
          <form onSubmit={createRep} className="space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-2xl border border-white/10 bg-[#101018] px-4 py-3 text-sm text-white" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail" className="w-full rounded-2xl border border-white/10 bg-[#101018] px-4 py-3 text-sm text-white" />
            <input value={temporaryPassword} onChange={(e) => setTemporaryPassword(e.target.value)} placeholder="Temporäres Passwort" className="w-full rounded-2xl border border-white/10 bg-[#101018] px-4 py-3 text-sm text-white" />
            <select value={mode} onChange={(e) => setMode(e.target.value as SalesRep['mode'])} className="w-full rounded-2xl border border-white/10 bg-[#101018] px-4 py-3 text-sm text-white">
              <option value="auto">Auto: andere dürfen übernehmen</option>
              <option value="semi">Halb-Auto: Übergabe möglich</option>
              <option value="self">Self: selbst abschließen</option>
            </select>
            <button className="w-full rounded-2xl px-4 py-3 text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#ff5b0a,#20d9ff)' }}>
              Vertriebler speichern
            </button>
          </form>
        </Panel>

        <Panel>
          <h3 className="mb-4 text-sm font-bold text-white">Aktive Vertriebler</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {reps.map(rep => (
              <button key={rep.id} onClick={() => setSelected(rep)} className={`rounded-2xl border p-4 text-left transition-all ${selected?.id === rep.id ? 'border-orange-400/35 bg-orange-500/10' : 'border-white/10 bg-black/20 hover:border-white/20'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-white">{rep.name}</p>
                    <p className="mt-1 text-xs text-white/40">{rep.email}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${rep.active === false ? 'bg-red-500/10 text-red-200' : 'bg-green-500/10 text-green-200'}`}>
                    {rep.active === false ? 'Inaktiv' : 'Aktiv'}
                  </span>
                </div>
                <p className="mt-3 text-xs text-white/45">{modeLabel(rep.mode)} · {rep.hot_leads ?? 0} Hotleads · {rep.closed_leads ?? 0} Abschlüsse</p>
                {rep.must_change_password && <p className="mt-2 text-xs text-orange-200">Muss Passwort ändern</p>}
              </button>
            ))}
          </div>
        </Panel>
      </div>

      {selected && (
        <Panel>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-black text-white">{selected.name}</h3>
              <p className="text-sm text-white/45">{selected.email}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={selected.mode} onChange={(e) => void updateSelected({ mode: e.target.value as SalesRep['mode'] })} className="rounded-xl border border-white/10 bg-[#101018] px-3 py-2 text-sm text-white">
                <option value="auto">Auto Mode</option>
                <option value="semi">Halb-Auto</option>
                <option value="self">Self Mode</option>
              </select>
              <button onClick={() => void updateSelected({ active: selected.active === false })} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60">
                {selected.active === false ? 'Aktivieren' : 'Deaktivieren'}
              </button>
              <button onClick={() => void resetPassword()} className="rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-2 text-sm font-semibold text-orange-100">
                Passwort zurücksetzen
              </button>
            </div>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {([
          ['phone', 'Call-Kalender', grouped.phone],
          ['video', 'Video-Kalender', grouped.video],
          ['field', 'Außendienst', grouped.field],
        ] as const).map(([, title, items]) => (
          <Panel key={title}>
            <h3 className="mb-3 text-sm font-bold text-white">{title}</h3>
            <div className="space-y-2">
              {items.slice(0, 8).map(item => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-sm font-bold text-white">{item.customer_company}</p>
                  <p className="mt-1 text-xs text-white/40">{new Date(item.slot_time).toLocaleString('de-DE')} · {item.status}</p>
                </div>
              ))}
              {items.length === 0 && <p className="py-8 text-center text-sm text-white/25">Keine Termine</p>}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
