import React, { useEffect, useMemo, useState } from 'react';
import {
  createCustomer,
  deleteCustomer,
  deployAgentConfig,
  getAgentConfig,
  getCustomerModuleStatus,
  getCustomers,
  saveAgentConfig,
  type AgentConfig,
  type Customer,
  type CustomerModuleStatus,
} from '../lib/api.js';
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconRefresh,
  IconScissors,
  IconUser,
} from './PhonbotIcons.js';

function dateLabel(value: string | null | undefined): string {
  if (!value) return 'noch nie';
  try {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function detailValue(customer: Customer, key: string): string | null {
  const value = customer.details?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function CustomersPage() {
  const [status, setStatus] = useState<CustomerModuleStatus | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    notes: '',
  });

  const enabled = config?.customerModule?.enabled ?? status?.enabled ?? false;
  const existingCount = useMemo(() => customers.filter((c) => c.customer_type === 'existing').length, [customers]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextConfig] = await Promise.all([
        getCustomerModuleStatus(),
        getAgentConfig(),
      ]);
      setStatus(nextStatus);
      setConfig(nextConfig);
      if (nextStatus.available) {
        const list = await getCustomers(search);
        setCustomers(list.items ?? []);
      } else {
        setCustomers([]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Kundenmodul konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleModule() {
    if (!config) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const nextEnabled = !enabled;
      const nextConfig: AgentConfig = {
        ...config,
        customerModule: { enabled: nextEnabled },
      };
      const saved = config.retellAgentId
        ? (await deployAgentConfig(nextConfig)).config
        : await saveAgentConfig(nextConfig);
      setConfig(saved);
      setStatus((s) => s ? { ...s, enabled: nextEnabled } : s);
      setNotice(nextEnabled
        ? 'Kundenmodul aktiv. Der Bot prueft Nummern still und fragt nur bei unbekannten Anrufern nach Bestandskunde/Neukunde.'
        : 'Kundenmodul aus. Der Bot nutzt keine Kundendatenbank und stellt keine Bestandskunden-Fragen.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Aenderung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }

  async function submitCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createCustomer({
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        customerType: 'existing',
        notes: form.notes.trim() || null,
      });
      setForm({ fullName: '', phone: '', email: '', notes: '' });
      const list = await getCustomers(search);
      setCustomers(list.items ?? []);
      setNotice('Kunde gespeichert.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Kunde konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }

  async function removeCustomer(id: string) {
    setSaving(true);
    setError(null);
    try {
      await deleteCustomer(id);
      setCustomers((items) => items.filter((c) => c.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Kunde konnte nicht entfernt werden.');
    } finally {
      setSaving(false);
    }
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const list = await getCustomers(search);
      setCustomers(list.items ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Suche fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-pink-300/60 font-semibold">Friseur-Modul</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mt-2">Kunden</h1>
          <p className="text-sm text-white/45 mt-2 max-w-2xl">
            Bestandskunden per Rufnummer erkennen, Neukunden sauber aufnehmen und den Prompt mit einem Klick ein- oder ausschalten.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/70 hover:text-white hover:border-white/20 disabled:opacity-50"
        >
          <IconRefresh size={15} className={loading ? 'animate-spin' : ''} />
          Aktualisieren
        </button>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <section className="rounded-3xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] to-white/[0.025] p-5 sm:p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-4">
            <div className="h-12 w-12 rounded-2xl bg-pink-500/15 text-pink-300 flex items-center justify-center border border-pink-500/20">
              <IconScissors size={22} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Bestandskunden-Erkennung</h2>
              <p className="text-sm text-white/45 mt-1 max-w-2xl">
                Aktiviert: Bot prueft die Anrufernummer still, fragt bei unbekannten Nummern nach Bestandskunde/Neukunde und legt nicht gefundene Kunden leise neu an.
              </p>
              <p className="text-xs text-white/30 mt-2">
                Verfuegbar fuer Friseur-Agenten und fuer info@mindrails.de.
              </p>
            </div>
          </div>
          <button
            onClick={toggleModule}
            disabled={!status?.available || saving || !config}
            className={[
              'relative inline-flex items-center gap-3 rounded-2xl px-5 py-3 text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed',
              enabled
                ? 'bg-emerald-500/18 text-emerald-200 border border-emerald-500/30 shadow-[0_0_26px_rgba(16,185,129,0.12)]'
                : 'bg-white/[0.04] text-white/60 border border-white/10 hover:text-white hover:border-white/20',
            ].join(' ')}
          >
            {enabled ? <IconCheckCircle size={17} /> : <IconAlertTriangle size={17} />}
            {saving ? 'Speichere...' : enabled ? 'Kundenmodul aktiv' : 'Kundenmodul aus'}
          </button>
        </div>
        {!status?.available && !loading && (
          <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Dieses Modul ist fuer normale Accounts nur bei Friseur-Agenten aktivierbar. Waehle im Agent Builder die Branche Friseur / Salon.
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.04] p-5">
          <p className="text-xs uppercase tracking-widest text-white/30">Kunden gesamt</p>
          <p className="text-3xl font-bold text-white mt-2">{customers.length}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.04] p-5">
          <p className="text-xs uppercase tracking-widest text-white/30">Bestandskunden</p>
          <p className="text-3xl font-bold text-white mt-2">{existingCount}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.04] p-5">
          <p className="text-xs uppercase tracking-widest text-white/30">Bot-Fragen</p>
          <p className="text-sm font-semibold text-white mt-3">{enabled ? 'aktiv im Prompt' : 'vollstaendig aus'}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Friseur-Daten, die der Bot bei Neukunden minimal erfragt</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {['Name', 'Rueckrufnummer', 'Gewuenschte Leistung', 'Terminwunsch', 'Wunschfriseur', 'Haarlaenge grob', 'Bei Farbe/Chemie: Vorbehandlung', 'Bei Farbe/Chemie: Allergien/Kopfhaut'].map((item) => (
            <div key={item} className="rounded-xl border border-white/8 bg-black/15 px-3 py-2 text-sm text-white/55">
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.85fr_1.4fr]">
        <form onSubmit={submitCustomer} className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white">Kunde manuell anlegen</h2>
          <input
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            placeholder="Vor- und Nachname"
            className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-pink-400/50"
          />
          <input
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="Telefonnummer"
            className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-pink-400/50"
          />
          <input
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="E-Mail optional"
            className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-pink-400/50"
          />
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Notiz, z.B. bevorzugte Stylistin"
            rows={3}
            className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-pink-400/50 resize-y"
          />
          <button
            disabled={!status?.available || saving || !form.fullName.trim()}
            className="w-full rounded-xl bg-pink-500/20 border border-pink-500/30 px-4 py-2.5 text-sm font-semibold text-pink-100 hover:bg-pink-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Speichern
          </button>
        </form>

        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] overflow-hidden">
          <div className="p-5 border-b border-white/[0.06] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-white">Kundenliste</h2>
            <form onSubmit={runSearch} className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, Nummer, E-Mail"
                className="w-52 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-pink-400/50"
              />
              <button className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/65 hover:text-white">
                Suchen
              </button>
            </form>
          </div>

          <div className="divide-y divide-white/[0.06]">
            {loading ? (
              <div className="p-8 text-sm text-white/35">Laden...</div>
            ) : customers.length === 0 ? (
              <div className="p-8 text-sm text-white/35">Noch keine Kunden gespeichert.</div>
            ) : customers.map((customer) => (
              <div key={customer.id} className="p-4 flex gap-4 items-start">
                <div className="h-10 w-10 rounded-2xl bg-white/[0.06] text-white/45 flex items-center justify-center shrink-0">
                  <IconUser size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2 items-center">
                    <p className="font-semibold text-white truncate">{customer.full_name}</p>
                    <span className="text-[11px] rounded-full border border-white/10 px-2 py-0.5 text-white/35">
                      {customer.customer_type === 'existing' ? 'Bestandskunde' : customer.customer_type === 'new' ? 'Neukunde' : 'Unklar'}
                    </span>
                  </div>
                  <p className="text-xs text-white/35 mt-1">
                    {customer.phone_normalized ?? customer.phone ?? 'keine Nummer'} {customer.email ? ` - ${customer.email}` : ''}
                  </p>
                  <p className="text-xs text-white/30 mt-1">
                    Zuletzt aktualisiert: {dateLabel(customer.updated_at)}
                  </p>
                  {(detailValue(customer, 'service') || detailValue(customer, 'hairLength') || customer.notes) && (
                    <p className="text-xs text-white/45 mt-2 line-clamp-2">
                      {[detailValue(customer, 'service'), detailValue(customer, 'hairLength'), customer.notes].filter(Boolean).join(' - ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => removeCustomer(customer.id)}
                  disabled={saving}
                  className="text-xs text-red-300/45 hover:text-red-300 disabled:opacity-40"
                >
                  Entfernen
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
