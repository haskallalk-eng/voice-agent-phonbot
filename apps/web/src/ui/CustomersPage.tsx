import React, { useEffect, useMemo, useState } from 'react';
import {
  createCustomer,
  deleteCustomer,
  deployAgentConfig,
  getAgentConfig,
  getCustomerModuleStatus,
  getCustomers,
  saveAgentConfig,
  updateCustomer,
  ApiError,
  type AgentConfig,
  type Customer,
  type CustomerModuleConfig,
  type CustomerModuleStatus,
  type CustomerQuestionConfig,
} from '../lib/api.js';
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconRefresh,
  IconScissors,
  IconUser,
} from './PhonbotIcons.js';

const DEFAULT_QUESTIONS: CustomerQuestionConfig[] = [
  { id: 'name', label: 'Name', prompt: 'Vor- und Nachname', enabled: true, required: true, builtin: true },
  { id: 'callbackPhone', label: 'Rückrufnummer', prompt: 'Nur fragen, wenn die Anrufernummer unbekannt ist', enabled: true, builtin: true },
  { id: 'service', label: 'Gewünschte Leistung', prompt: 'Welche Leistung gewünscht ist', enabled: true, builtin: true, detailsKey: 'service' },
  { id: 'preferredTime', label: 'Terminwunsch', prompt: 'Wunschtermin oder bevorzugtes Zeitfenster', enabled: true, builtin: true, detailsKey: 'preferredTime' },
  { id: 'preferredStylist', label: 'Wunschfriseur', prompt: 'Bestimmter Friseur oder jeder freie Mitarbeiter', enabled: true, builtin: true, detailsKey: 'preferredStylist' },
  { id: 'hairLength', label: 'Haarlänge grob', prompt: 'Kurz, schulterlang, lang oder Wortlaut des Kunden', enabled: true, builtin: true, detailsKey: 'hairLength' },
  { id: 'hairHistory', label: 'Vorbehandlung', prompt: 'Nur bei Farbe/Chemie: Farbe, Blondierung, Glättung, Dauerwelle usw.', enabled: true, builtin: true, detailsKey: 'hairHistory', condition: 'bei Farbe/Chemie' },
  { id: 'allergies', label: 'Allergien / Kopfhaut', prompt: 'Nur bei Farbe/Chemie: Allergien, Unverträglichkeiten oder empfindliche Kopfhaut', enabled: true, builtin: true, detailsKey: 'allergies', condition: 'bei Farbe/Chemie' },
];

const BUILTIN_IDS = new Set(DEFAULT_QUESTIONS.map((q) => q.id));

const EMPTY_FORM = {
  fullName: '',
  phone: '',
  email: '',
  notes: '',
  service: '',
  preferredTime: '',
  preferredStylist: '',
  hairLength: '',
  hairHistory: '',
  allergies: '',
  custom: {} as Record<string, string>,
};

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

function isValidOptionalEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

const CUSTOMER_FOCUS_STORAGE_KEY = 'phonbot_focus_customer';

function readStoredCustomerFocus(id: string | null | undefined): string | null {
  if (!id) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CUSTOMER_FOCUS_STORAGE_KEY) ?? 'null') as { id?: string; search?: string } | null;
    return parsed?.id === id && typeof parsed.search === 'string' ? parsed.search : null;
  } catch {
    return null;
  }
}

function isInvalidCustomerEmailError(error: unknown): boolean {
  if (error instanceof ApiError) {
    const code = error.parsedBody?.error;
    return code === 'INVALID_CUSTOMER_EMAIL' || /invalid email/i.test(error.userMessage);
  }
  return error instanceof Error && /invalid email|INVALID_CUSTOMER_EMAIL/i.test(error.message);
}

function normalizeQuestionId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 42);
  return `custom_${slug || Date.now()}`;
}

function normalizeQuestions(input: CustomerQuestionConfig[] | undefined): CustomerQuestionConfig[] {
  const incoming = Array.isArray(input) ? input : [];
  const byId = new Map(incoming.map((q) => [q.id, q]));
  const builtin = DEFAULT_QUESTIONS.map((q) => {
    const override = byId.get(q.id);
    return { ...q, enabled: q.required ? true : override?.enabled !== false };
  });
  const custom = incoming
    .filter((q) => !BUILTIN_IDS.has(q.id))
    .filter((q) => q.label?.trim())
    .map((q) => ({
      id: q.id,
      label: q.label.trim(),
      prompt: q.prompt?.trim() || q.label.trim(),
      enabled: q.enabled !== false,
      builtin: false,
      detailsKey: q.detailsKey || q.id,
    }));
  return [...builtin, ...custom];
}

function normalizeModule(module: CustomerModuleConfig | undefined): CustomerModuleConfig {
  return {
    enabled: module?.enabled !== false,
    allowBookingWithoutApproval: module?.allowBookingWithoutApproval !== false,
    questions: normalizeQuestions(module?.questions),
  };
}

function TogglePill({ active, disabled = false }: { active: boolean; disabled?: boolean }) {
  return (
    <span
      className={[
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-all',
        active ? 'border-orange-400/40 bg-orange-500/25' : 'border-white/10 bg-white/[0.04]',
        disabled ? 'opacity-50' : '',
      ].join(' ')}
    >
      <span
        className={[
          'h-5 w-5 rounded-full transition-transform',
          active ? 'translate-x-5 bg-orange-300 shadow-[0_0_18px_rgba(249,115,22,0.35)]' : 'translate-x-1 bg-white/35',
        ].join(' ')}
      />
    </span>
  );
}

function customerTypeLabel(customer: Customer): string {
  return customer.customer_type === 'existing' ? 'Bestandskunde' : customer.customer_type === 'pending' ? 'Pending' : customer.customer_type === 'new' ? 'Neukunde' : 'Unklar';
}

function customerDetailRows(customer: Customer, questions: CustomerQuestionConfig[]) {
  const rows: Array<{ label: string; value: string }> = [];
  for (const question of questions) {
    if (!question.detailsKey) continue;
    const value = detailValue(customer, question.detailsKey);
    if (value) rows.push({ label: question.label, value });
  }

  const customFields = customer.details?.customFields;
  if (customFields && typeof customFields === 'object' && !Array.isArray(customFields)) {
    for (const [label, raw] of Object.entries(customFields as Record<string, unknown>)) {
      if (typeof raw === 'string' && raw.trim()) rows.push({ label, value: raw.trim() });
    }
  }

  return rows;
}

function CustomerDetails({ customer, questions }: { customer: Customer; questions: CustomerQuestionConfig[] }) {
  const rows = customerDetailRows(customer, questions);
  return (
    <div className="mx-4 mb-4 rounded-2xl border border-orange-500/15 bg-gradient-to-br from-orange-500/[0.08] via-white/[0.035] to-cyan-500/[0.06] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Kontakt</p>
          <p className="mt-1 text-sm text-white/80">{customer.phone_normalized ?? customer.phone ?? 'Keine Nummer gespeichert'}</p>
          <p className="text-xs text-white/40">{customer.email ?? 'Keine E-Mail gespeichert'}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Status</p>
          <p className="mt-1 text-sm text-white/80">{customerTypeLabel(customer)}</p>
          <p className="text-xs text-white/40">Aktualisiert: {dateLabel(customer.updated_at)}</p>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={`${row.label}:${row.value}`} className="rounded-xl border border-white/8 bg-black/15 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.13em] text-white/28">{row.label}</p>
              <p className="mt-1 text-sm text-white/75">{row.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-white/8 bg-black/15 px-3 py-2 text-sm text-white/35">Noch keine Zusatzdetails gespeichert.</p>
      )}

      {customer.notes && (
        <div className="mt-3 rounded-xl border border-white/8 bg-black/15 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.13em] text-white/28">Interne Notiz</p>
          <p className="mt-1 text-sm text-white/70 whitespace-pre-wrap">{customer.notes}</p>
        </div>
      )}
    </div>
  );
}

export function CustomersPage({ focusCustomerId }: { focusCustomerId?: string | null } = {}) {
  const [status, setStatus] = useState<CustomerModuleStatus | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customQuestion, setCustomQuestion] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showEmailHint, setShowEmailHint] = useState(false);
  const [emailRejected, setEmailRejected] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(focusCustomerId ?? null);

  const moduleConfig = useMemo(() => normalizeModule(config?.customerModule), [config?.customerModule]);
  const enabled = status?.available ? moduleConfig.enabled !== false : false;
  const allowBookingWithoutApproval = moduleConfig.allowBookingWithoutApproval !== false;
  const questions = moduleConfig.questions ?? DEFAULT_QUESTIONS;
  const activeQuestions = questions.filter((q) => q.enabled !== false);
  const customQuestions = questions.filter((q) => q.builtin !== true);
  const existingCount = useMemo(() => customers.filter((c) => c.customer_type === 'existing').length, [customers]);
  const pendingCount = useMemo(() => customers.filter((c) => c.customer_type === 'pending').length, [customers]);
  const emailInvalid = !isValidOptionalEmail(form.email);
  const showEmailValidation = showEmailHint && (emailInvalid || emailRejected);

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
        let list = await getCustomers(search);
        const focusSearch = readStoredCustomerFocus(focusCustomerId);
        if (focusCustomerId && !search.trim() && focusSearch && !(list.items ?? []).some((customer) => customer.id === focusCustomerId)) {
          setSearch(focusSearch);
          list = await getCustomers(focusSearch);
        }
        setCustomers(list.items ?? []);
        if (focusCustomerId) setSelectedCustomerId(focusCustomerId);
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

  useEffect(() => {
    if (!focusCustomerId || loading) return;
    setSelectedCustomerId(focusCustomerId);
    const timer = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-customer-id="${CSS.escape(focusCustomerId)}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('focus-pulse');
      window.setTimeout(() => el.classList.remove('focus-pulse'), 2200);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [focusCustomerId, loading, customers]);

  async function saveModule(nextModule: CustomerModuleConfig, message: string) {
    if (!config) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const nextConfig: AgentConfig = {
        ...config,
        customerModule: nextModule,
      };
      const saved = config.retellAgentId
        ? (await deployAgentConfig(nextConfig)).config
        : await saveAgentConfig(nextConfig);
      setConfig(saved);
      setStatus((s) => s ? { ...s, enabled: nextModule.enabled !== false } : s);
      setNotice(message);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Änderung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleModule() {
    const nextEnabled = !enabled;
    await saveModule(
      { ...moduleConfig, enabled: nextEnabled, questions },
      nextEnabled
        ? 'Kundenmodul aktiv. Der Bot prüft Nummern still und legt neue Kunden als pending an.'
        : 'Kundenmodul aus. Der Bot nutzt keine Kundendatenbank und stellt keine Bestandskunden-Fragen.',
    );
  }

  async function toggleBookingMode() {
    await saveModule(
      { ...moduleConfig, enabled, allowBookingWithoutApproval: !allowBookingWithoutApproval, questions },
      !allowBookingWithoutApproval
        ? 'Der Bot darf Termine für pending Neukunden direkt buchen.'
        : 'Der Bot erstellt für pending Neukunden nur Terminwünsche/Tickets, bis der Salon freigibt.',
    );
  }

  async function toggleQuestion(question: CustomerQuestionConfig) {
    if (question.required) return;
    const nextQuestions = questions.map((q) => q.id === question.id ? { ...q, enabled: q.enabled === false } : q);
    await saveModule(
      { ...moduleConfig, enabled, allowBookingWithoutApproval, questions: nextQuestions },
      'Neukunden-Fragen gespeichert. Der Prompt wird beim Speichern/Deploy tenant-spezifisch aktualisiert.',
    );
  }

  async function addCustomQuestion(e: React.FormEvent) {
    e.preventDefault();
    const label = customQuestion.trim();
    if (!label) return;
    const id = normalizeQuestionId(label);
    await saveModule(
      {
        ...moduleConfig,
        enabled,
        allowBookingWithoutApproval,
        questions: [...questions, { id, label, prompt: label, enabled: true, builtin: false, detailsKey: id }],
      },
      'Eigene Frage hinzugefügt und im Prompt aktiviert.',
    );
    setCustomQuestion('');
  }

  async function removeCustomQuestion(id: string) {
    await saveModule(
      { ...moduleConfig, enabled, allowBookingWithoutApproval, questions: questions.filter((q) => q.id !== id) },
      'Eigene Frage entfernt.',
    );
  }

  function active(id: string) {
    return questions.find((q) => q.id === id)?.enabled !== false;
  }

  async function submitCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) return;
    if (emailInvalid) {
      setShowEmailHint(true);
      setEmailRejected(false);
      setError(null);
      setNotice(null);
      return;
    }
    const customFields = Object.fromEntries(
      customQuestions
        .filter((q) => q.enabled !== false)
        .map((q) => [q.label, form.custom[q.id]?.trim()])
        .filter(([, value]) => value),
    );
    const details: Record<string, unknown> = {};
    if (active('service') && form.service.trim()) details.service = form.service.trim();
    if (active('preferredTime') && form.preferredTime.trim()) details.preferredTime = form.preferredTime.trim();
    if (active('preferredStylist') && form.preferredStylist.trim()) details.preferredStylist = form.preferredStylist.trim();
    if (active('hairLength') && form.hairLength.trim()) details.hairLength = form.hairLength.trim();
    if (active('hairHistory') && form.hairHistory.trim()) details.hairHistory = form.hairHistory.trim();
    if (active('allergies') && form.allergies.trim()) details.allergies = form.allergies.trim();
    if (Object.keys(customFields).length) details.customFields = customFields;

    setSaving(true);
    setError(null);
    try {
      await createCustomer({
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        customerType: 'existing',
        notes: form.notes.trim() || null,
        details,
      });
      setForm(EMPTY_FORM);
      setShowEmailHint(false);
      setEmailRejected(false);
      const list = await getCustomers(search);
      setCustomers(list.items ?? []);
      setNotice('Kunde als Bestandskunde gespeichert.');
    } catch (e: unknown) {
      if (isInvalidCustomerEmailError(e)) {
        setShowEmailHint(true);
        setEmailRejected(true);
        setError(null);
        return;
      }
      setError(e instanceof Error ? e.message : 'Kunde konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }

  async function approveCustomer(customer: Customer) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateCustomer(customer.id, { customerType: 'existing' });
      setCustomers((items) => items.map((item) => item.id === customer.id ? updated : item));
      setNotice('Kunde als Bestandskunde bestätigt.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Kunde konnte nicht bestätigt werden.');
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
          <p className="text-xs uppercase tracking-[0.24em] text-orange-300/70 font-semibold">Friseur-Modul</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mt-2">Kunden</h1>
          <p className="text-sm text-white/45 mt-2 max-w-2xl">
            Bestandskunden erkennen, neue Anrufer als pending vormerken und exakt steuern, welche Fragen der Bot stellt.
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

      {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {notice && <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>}

      <section className="rounded-3xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] via-white/[0.035] to-orange-500/[0.045] p-5 sm:p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-4">
            <div className="h-12 w-12 rounded-2xl bg-orange-500/15 text-orange-300 flex items-center justify-center border border-orange-500/20">
              <IconScissors size={22} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Kundenmodul</h2>
              <p className="text-sm text-white/45 mt-1 max-w-2xl">
                Standardmäßig an: Der Bot prüft die Anrufernummer still, fragt nur bei unbekannten Nummern nach und speichert Bot-Neukunden als pending.
              </p>
              <p className="text-xs text-white/30 mt-2">Verfügbar für Friseur-Agenten und info@mindrails.de.</p>
            </div>
          </div>
          <button
            onClick={toggleModule}
            disabled={!status?.available || saving || !config}
            className={[
              'inline-flex items-center justify-between gap-4 rounded-2xl px-5 py-3 text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed',
              enabled
                ? 'bg-orange-500/18 text-orange-100 border border-orange-500/30 shadow-[0_0_26px_rgba(249,115,22,0.12)]'
                : 'bg-white/[0.04] text-white/60 border border-white/10 hover:text-white hover:border-white/20',
            ].join(' ')}
          >
            {enabled ? <IconCheckCircle size={17} /> : <IconAlertTriangle size={17} />}
            {saving ? 'Speichere...' : enabled ? 'Aktiv' : 'Aus'}
            <TogglePill active={enabled} />
          </button>
        </div>
        {!status?.available && !loading && (
          <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Dieses Modul ist für normale Accounts nur bei Friseur-Agenten aktivierbar. Wähle im Agent Builder die Branche Friseur / Salon.
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.04] p-5">
          <p className="text-xs uppercase tracking-widest text-white/30">Kunden gesamt</p>
          <p className="text-3xl font-bold text-white mt-2">{customers.length}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.04] p-5">
          <p className="text-xs uppercase tracking-widest text-white/30">Bestandskunden</p>
          <p className="text-3xl font-bold text-white mt-2">{existingCount}</p>
        </div>
        <div className="rounded-2xl border border-orange-500/15 bg-orange-500/[0.06] p-5">
          <p className="text-xs uppercase tracking-widest text-orange-200/50">Pending</p>
          <p className="text-3xl font-bold text-white mt-2">{pendingCount}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-5 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Termine ohne Kundenfreigabe</h2>
            <p className="text-xs text-white/40 mt-1 max-w-2xl">
              An bedeutet: Der Bot darf auch für pending Neukunden direkt buchen. Aus bedeutet: Er erstellt nur einen Terminwunsch/Ticket, bis der Salon den Kunden bestätigt.
            </p>
          </div>
          <button
            onClick={toggleBookingMode}
            disabled={!enabled || saving}
            className="inline-flex items-center gap-3 rounded-2xl border border-orange-500/25 bg-orange-500/10 px-4 py-3 text-sm font-semibold text-orange-100 disabled:opacity-40"
          >
            <TogglePill active={allowBookingWithoutApproval} />
            {allowBookingWithoutApproval ? 'Buchen erlaubt' : 'Erst Freigabe'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Fragen, die der Bot bei Neukunden stellt</h2>
          <p className="text-xs text-white/40 mt-1">Diese Liste wird tenant-spezifisch in den Prompt geschrieben. Name bleibt Pflicht, weil ohne Namen kein Kunde sauber angelegt werden kann.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {questions.map((question) => (
            <div key={question.id} className="rounded-2xl border border-white/10 bg-black/15 p-4">
              <button
                type="button"
                onClick={() => { void toggleQuestion(question); }}
                disabled={question.required || saving}
                className="w-full flex items-start justify-between gap-3 text-left disabled:cursor-not-allowed"
              >
                <span>
                  <span className="text-sm font-semibold text-white">{question.label}</span>
                  {question.condition && <span className="ml-2 text-[11px] text-orange-200/60">{question.condition}</span>}
                  <span className="block text-xs text-white/35 mt-1">{question.prompt || question.label}</span>
                  {question.required && <span className="block text-[11px] text-white/25 mt-2">Pflichtfeld</span>}
                </span>
                <TogglePill active={question.enabled !== false} disabled={question.required} />
              </button>
              {question.builtin !== true && (
                <button
                  onClick={() => { void removeCustomQuestion(question.id); }}
                  disabled={saving}
                  className="mt-3 text-xs text-red-300/60 hover:text-red-300 disabled:opacity-40"
                >
                  Frage löschen
                </button>
              )}
            </div>
          ))}
        </div>
        <form onSubmit={addCustomQuestion} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={customQuestion}
            onChange={(e) => setCustomQuestion(e.target.value)}
            placeholder="Eigene Frage ergänzen, z.B. Wunschprodukt oder Pflegehinweis"
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50"
          />
          <button disabled={!customQuestion.trim() || saving} className="rounded-xl bg-orange-500/20 border border-orange-500/30 px-4 py-2.5 text-sm font-semibold text-orange-100 hover:bg-orange-500/25 disabled:opacity-40">
            Frage hinzufügen
          </button>
        </form>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.9fr_1.35fr]">
        <form onSubmit={submitCustomer} noValidate className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white">Kunde manuell anlegen</h2>
          <p className="text-xs text-white/35">Das Formular nutzt dieselben aktiven Felder wie der Bot. Manuell angelegte Kunden werden direkt als Bestandskunde gespeichert.</p>
          <input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} placeholder="Vor- und Nachname" className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50" />
          <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Telefonnummer für Erkennung" className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50" />
          <div className="space-y-1.5">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.email}
              onBlur={() => setShowEmailHint(emailInvalid)}
              onChange={(e) => {
                const nextEmail = e.target.value;
                setForm((f) => ({ ...f, email: nextEmail }));
                setEmailRejected(false);
                if (isValidOptionalEmail(nextEmail)) setShowEmailHint(false);
              }}
              placeholder="E-Mail optional"
              aria-invalid={showEmailValidation}
              aria-describedby={showEmailValidation ? 'customer-email-hint' : undefined}
              className={[
                'w-full rounded-xl border bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition-colors',
                showEmailValidation
                  ? 'border-amber-400/45 focus:border-amber-300/60'
                  : 'border-white/10 focus:border-orange-400/50',
              ].join(' ')}
            />
            {showEmailValidation && (
              <p id="customer-email-hint" className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/80">
                Die E-Mail sieht noch unvollständig aus. Bitte prüfe sie, z.B. name@salon.de, oder lass das Feld leer.
              </p>
            )}
          </div>
          {active('service') && <input value={form.service} onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))} placeholder="Gewünschte Leistung" className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50" />}
          {active('preferredTime') && <input value={form.preferredTime} onChange={(e) => setForm((f) => ({ ...f, preferredTime: e.target.value }))} placeholder="Terminwunsch" className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50" />}
          {active('preferredStylist') && <input value={form.preferredStylist} onChange={(e) => setForm((f) => ({ ...f, preferredStylist: e.target.value }))} placeholder="Wunschfriseur" className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50" />}
          {active('hairLength') && <input value={form.hairLength} onChange={(e) => setForm((f) => ({ ...f, hairLength: e.target.value }))} placeholder="Haarlänge grob" className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50" />}
          {active('hairHistory') && <input value={form.hairHistory} onChange={(e) => setForm((f) => ({ ...f, hairHistory: e.target.value }))} placeholder="Vorbehandlung bei Farbe/Chemie" className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50" />}
          {active('allergies') && <input value={form.allergies} onChange={(e) => setForm((f) => ({ ...f, allergies: e.target.value }))} placeholder="Allergien / Kopfhaut bei Farbe/Chemie" className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50" />}
          {customQuestions.filter((q) => q.enabled !== false).map((question) => (
            <input
              key={question.id}
              value={form.custom[question.id] ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, custom: { ...f.custom, [question.id]: e.target.value } }))}
              placeholder={question.label}
              className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50"
            />
          ))}
          <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Interne Notiz" rows={3} className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50 resize-y" />
          <button disabled={!status?.available || saving || !form.fullName.trim()} className="w-full rounded-xl bg-orange-500/20 border border-orange-500/30 px-4 py-2.5 text-sm font-semibold text-orange-100 hover:bg-orange-500/25 disabled:opacity-40 disabled:cursor-not-allowed">
            Als Bestandskunde speichern
          </button>
        </form>

        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] overflow-hidden">
          <div className="p-5 border-b border-white/[0.06] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-white">Kundenliste</h2>
            <form onSubmit={runSearch} className="flex gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, Nummer, E-Mail" className="w-52 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50" />
              <button className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/65 hover:text-white">Suchen</button>
            </form>
          </div>

          <div className="divide-y divide-white/[0.06]">
            {loading ? (
              <div className="p-8 text-sm text-white/35">Laden...</div>
            ) : customers.length === 0 ? (
              <div className="p-8 text-sm text-white/35">Noch keine Kunden gespeichert.</div>
            ) : customers.map((customer) => {
              const isOpen = selectedCustomerId === customer.id;
              return (
              <div key={customer.id} data-customer-id={customer.id} className={isOpen ? 'bg-white/[0.025]' : ''}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedCustomerId(isOpen ? null : customer.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedCustomerId(isOpen ? null : customer.id);
                    }
                  }}
                  className="p-4 flex gap-4 items-start cursor-pointer hover:bg-white/[0.025] transition-colors"
                >
                <div className="h-10 w-10 rounded-2xl bg-white/[0.06] text-white/45 flex items-center justify-center shrink-0">
                  <IconUser size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2 items-center">
                    <p className="font-semibold text-white truncate">{customer.full_name}</p>
                    <span className={[
                      'text-[11px] rounded-full border px-2 py-0.5',
                      customer.customer_type === 'existing'
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200/80'
                        : customer.customer_type === 'pending'
                          ? 'border-orange-500/25 bg-orange-500/10 text-orange-100/80'
                          : 'border-white/10 text-white/35',
                    ].join(' ')}>
                      {customerTypeLabel(customer)}
                    </span>
                  </div>
                  <p className="text-xs text-white/35 mt-1">{customer.phone_normalized ?? customer.phone ?? 'keine Nummer'} {customer.email ? ` - ${customer.email}` : ''}</p>
                  <p className="text-xs text-white/30 mt-1">{isOpen ? 'Details geöffnet' : 'Anklicken, um Details zu sehen'} · Aktualisiert: {dateLabel(customer.updated_at)}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 items-end" onClick={(e) => e.stopPropagation()}>
                  {customer.customer_type === 'pending' && (
                    <button onClick={() => { void approveCustomer(customer); }} disabled={saving} className="text-xs rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-emerald-200/80 hover:text-emerald-100 disabled:opacity-40">
                      Bestätigen
                    </button>
                  )}
                  <button onClick={() => { void removeCustomer(customer.id); }} disabled={saving} className="text-xs text-red-300/45 hover:text-red-300 disabled:opacity-40">
                    Löschen
                  </button>
                  <span className="text-[11px] text-orange-200/45">{isOpen ? 'Schließen' : 'Details'}</span>
                </div>
                </div>
                {isOpen && <CustomerDetails customer={customer} questions={questions} />}
              </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
