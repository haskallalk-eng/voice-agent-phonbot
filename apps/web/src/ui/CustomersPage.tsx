import React, { useEffect, useMemo, useState } from 'react';
import {
  createCalendarStaff,
  createCustomer,
  deleteCustomer,
  deleteCalendarStaff,
  deployAgentConfig,
  getAgentConfig,
  getCalendarStaff,
  getCustomerModuleStatus,
  getCustomers,
  getStaffChipyCalendar,
  saveAgentConfig,
  saveStaffChipySchedule,
  updateCalendarStaff,
  updateCustomer,
  ApiError,
  type AgentConfig,
  type CalendarStaff,
  type ChipySchedule,
  type Customer,
  type CustomerModuleConfig,
  type CustomerModuleStatus,
  type CustomerQuestionConfig,
  type ServiceItem,
} from '../lib/api.js';
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconRefresh,
  IconScissors,
  IconUser,
  IconBuilding,
} from './PhonbotIcons.js';
import { AdaptiveTextarea } from '../components/AdaptiveTextarea.js';
import { OpeningHoursEditor, parseOpeningHours } from './agent-builder/OpeningHoursEditor.js';
import { ServicesEditor } from './agent-builder/ServicesEditor.js';
import { HAIRDRESSER_SERVICE_PRESET } from '../lib/service-presets.js';

const DEFAULT_QUESTIONS: CustomerQuestionConfig[] = [
  { id: 'name', label: 'Name', prompt: 'Vor- und Nachname', enabled: true, required: true, builtin: true },
  { id: 'callbackPhone', label: 'Rückrufnummer', prompt: 'Nur fragen, wenn die Anrufernummer unbekannt ist', enabled: true, builtin: true },
  { id: 'service', label: 'Gewünschte Leistung', prompt: 'Welche Leistung gewünscht ist', enabled: true, builtin: true, detailsKey: 'service' },
  { id: 'preferredTime', label: 'Terminwunsch', prompt: 'Wunschtermin oder bevorzugtes Zeitfenster', enabled: true, builtin: true, detailsKey: 'preferredTime' },
  { id: 'preferredStylist', label: 'Wunschfriseur', prompt: 'Bestimmter Friseur oder jeder freie Mitarbeiter', enabled: true, builtin: true, detailsKey: 'preferredStylist' },
  { id: 'hairLength', label: 'Haarlänge grob', prompt: 'Kurz, schulterlang, lang oder Wortlaut des Kunden', enabled: true, builtin: true, detailsKey: 'hairLength' },
  { id: 'hairHistory', label: 'Vorbehandlung', prompt: 'Frühere Farbe, Blondierung, Glättung, Dauerwelle oder andere chemische Behandlung', enabled: true, builtin: true, detailsKey: 'hairHistory', condition: 'nur bei Farbe/Chemie' },
  { id: 'allergies', label: 'Allergien / Kopfhaut', prompt: 'Allergien, Unverträglichkeiten oder empfindliche Kopfhaut', enabled: true, builtin: true, detailsKey: 'allergies', condition: 'nur bei Farbe/Chemie' },
];

const BUILTIN_IDS = new Set(DEFAULT_QUESTIONS.map((q) => q.id));
const LEGACY_BUILTIN_PROMPTS: Record<string, string[]> = {
  hairHistory: [
    'Nur bei Farbe/Chemie: Farbe, Blondierung, Glättung, Dauerwelle usw.',
    'Bei Farbe oder Chemie: frühere Farbe, Blondierung, Glättung, Dauerwelle oder andere chemische Behandlung',
    'Bei Farbe oder Chemie: fruehere Farbe, Blondierung, Glaettung, Dauerwelle oder andere chemische Behandlung',
  ],
  allergies: [
    'Nur bei Farbe/Chemie: Allergien, Unverträglichkeiten oder empfindliche Kopfhaut',
    'Bei Farbe oder Chemie: Allergien, Unverträglichkeiten oder empfindliche Kopfhaut',
    'Bei Farbe oder Chemie: Allergien, Unvertraeglichkeiten oder empfindliche Kopfhaut',
  ],
};
const LEGACY_BUILTIN_CONDITIONS: Record<string, string[]> = {
  hairHistory: ['bei Farbe/Chemie', 'wenn nur bei Farbe/Chemie'],
  allergies: ['bei Farbe/Chemie', 'wenn nur bei Farbe/Chemie'],
};

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

function comparableQuestionText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeBuiltinPrompt(question: CustomerQuestionConfig, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return question.prompt ?? question.label;
  const legacy = LEGACY_BUILTIN_PROMPTS[question.id]?.map(comparableQuestionText) ?? [];
  return legacy.includes(comparableQuestionText(trimmed)) ? question.prompt ?? question.label : trimmed;
}

function normalizeBuiltinCondition(question: CustomerQuestionConfig, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return question.condition;
  const legacy = LEGACY_BUILTIN_CONDITIONS[question.id]?.map(comparableQuestionText) ?? [];
  return legacy.includes(comparableQuestionText(trimmed)) ? question.condition : trimmed;
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
    return {
      ...q,
      prompt: normalizeBuiltinPrompt(q, override?.prompt),
      condition: normalizeBuiltinCondition(q, override?.condition),
      enabled: q.required ? true : override?.enabled !== false,
    };
  });
  const custom = incoming
    .filter((q) => !BUILTIN_IDS.has(q.id))
    .filter((q) => q.label?.trim())
    .map((q) => ({
      id: q.id,
      label: q.label.trim(),
      prompt: q.prompt?.trim() || q.label.trim(),
      condition: q.condition?.trim() || undefined,
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
          active ? 'translate-x-5 bg-orange-300 shadow-[0_0_18px_rgba(255,91,10,0.35)]' : 'translate-x-1 bg-white/35',
        ].join(' ')}
      />
    </span>
  );
}

type BusinessTab = 'betrieb' | 'mitarbeiter' | 'kunden';
type BusinessInfoPatch = Pick<AgentConfig, 'businessName' | 'address' | 'businessDescription' | 'openingHours' | 'services' | 'servicesText'>;

const BUSINESS_TABS: Array<{ id: BusinessTab; label: string; description: string }> = [
  { id: 'betrieb', label: 'Betrieb', description: 'Stammdaten, Öffnungszeiten und Leistungen' },
  { id: 'mitarbeiter', label: 'Mitarbeiter', description: 'Profile, Leistungen und Arbeitszeiten' },
  { id: 'kunden', label: 'Kunden', description: 'Kundenmodul und Kundenliste' },
];

const CARD_CLASS = 'rounded-3xl border border-white/[0.08] bg-gradient-to-br from-white/[0.07] via-white/[0.035] to-orange-500/[0.035] p-5 sm:p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)]';
const INPUT_CLASS = 'w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition-colors focus:border-orange-400/50';

function BusinessField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-white/70">{label}</span>
      {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-white/35">{hint}</span>}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function isHairdresserConfig(config: AgentConfig | null): boolean {
  if (!config) return false;
  const structuredServices = serviceItemsToStaffStrings(config.services ?? []).join(' ');
  const haystack = `${config.industry ?? ''} ${config.businessDescription ?? ''} ${config.servicesText ?? ''} ${structuredServices}`.toLowerCase();
  return /friseur|salon|haar|farbe|kopfhaut|stylist/.test(haystack);
}

function deriveBusinessServiceLabels(config: AgentConfig | null): string[] {
  if (!config) return [];
  const structured = serviceItemsToStaffStrings(config.services ?? []);
  if (structured.length) return structured;
  return (config.servicesText ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

type OpeningDay = 'Mo' | 'Di' | 'Mi' | 'Do' | 'Fr' | 'Sa' | 'So';
type OpeningWeek = Record<OpeningDay, { open: boolean; from: string; to: string }>;

const OPENING_TO_CHIPY: Record<OpeningDay, keyof ChipySchedule> = {
  Mo: '1', Di: '2', Mi: '3', Do: '4', Fr: '5', Sa: '6', So: '0',
};
const CHIPY_TO_OPENING: Array<{ key: keyof ChipySchedule; day: OpeningDay }> = [
  { key: '1', day: 'Mo' },
  { key: '2', day: 'Di' },
  { key: '3', day: 'Mi' },
  { key: '4', day: 'Do' },
  { key: '5', day: 'Fr' },
  { key: '6', day: 'Sa' },
  { key: '0', day: 'So' },
];

const DEFAULT_CHIPY_SCHEDULE: ChipySchedule = {
  '0': { enabled: false, start: '09:00', end: '17:00' },
  '1': { enabled: true, start: '09:00', end: '17:00' },
  '2': { enabled: true, start: '09:00', end: '17:00' },
  '3': { enabled: true, start: '09:00', end: '17:00' },
  '4': { enabled: true, start: '09:00', end: '17:00' },
  '5': { enabled: true, start: '09:00', end: '17:00' },
  '6': { enabled: false, start: '09:00', end: '17:00' },
};

function openingHoursToChipySchedule(raw: string | null | undefined): ChipySchedule {
  const parsed = parseOpeningHours(raw ?? '') as OpeningWeek | null;
  if (!parsed) return DEFAULT_CHIPY_SCHEDULE;
  const out: ChipySchedule = { ...DEFAULT_CHIPY_SCHEDULE };
  for (const [openingDay, chipyDay] of Object.entries(OPENING_TO_CHIPY) as Array<[OpeningDay, keyof ChipySchedule]>) {
    const day = parsed[openingDay];
    out[chipyDay] = { enabled: day.open, start: day.from, end: day.to };
  }
  return out;
}

function canConvertOpeningHours(raw: string | null | undefined): boolean {
  const value = raw?.trim() ?? '';
  return !value || parseOpeningHours(value) !== null;
}

function chipyScheduleToOpeningHours(schedule: ChipySchedule | null | undefined): string {
  const full = { ...DEFAULT_CHIPY_SCHEDULE, ...(schedule ?? {}) };
  const chunks: Array<{ days: OpeningDay[]; label: string }> = [];
  let i = 0;
  while (i < CHIPY_TO_OPENING.length) {
    const cur = CHIPY_TO_OPENING[i]!;
    const curValue = full[cur.key] ?? DEFAULT_CHIPY_SCHEDULE[cur.key]!;
    let j = i;
    while (j + 1 < CHIPY_TO_OPENING.length) {
      const next = CHIPY_TO_OPENING[j + 1]!;
      const nextValue = full[next.key] ?? DEFAULT_CHIPY_SCHEDULE[next.key]!;
      if (
        nextValue.enabled !== curValue.enabled ||
        nextValue.start !== curValue.start ||
        nextValue.end !== curValue.end
      ) break;
      j++;
    }
    const days = CHIPY_TO_OPENING.slice(i, j + 1).map((item) => item.day);
    const label = curValue.enabled ? `${curValue.start}-${curValue.end}` : 'geschlossen';
    chunks.push({ days, label });
    i = j + 1;
  }
  return chunks
    .map(({ days, label }) => `${days.length === 1 ? days[0] : `${days[0]}-${days[days.length - 1]}`} ${label}`)
    .join(', ');
}

function staffLabelToServiceItem(label: string, index: number): ServiceItem {
  let text = label.trim();
  let tag: ServiceItem['tag'] = null;
  const tagMatch = text.match(/\s*[·•]\s*(BELIEBT|NEU|AKTION)\s*$/i);
  if (tagMatch) {
    tag = tagMatch[1]!.toUpperCase() as ServiceItem['tag'];
    text = text.slice(0, tagMatch.index).trim();
  }

  let duration: string | undefined;
  const durationMatch = text.match(/\(([^()]*)\)\s*$/);
  if (durationMatch) {
    duration = durationMatch[1]!.trim();
    text = text.slice(0, durationMatch.index).trim();
  }

  let name = text;
  let price: string | undefined;
  let priceFrom: boolean | undefined;
  let priceUpTo: string | undefined;
  const priceMatch = text.match(/^(.*?):\s*(ab\s*)?(\d+(?:[,.]\d{1,2})?)(?:\s*(?:-|–)\s*(\d+(?:[,.]\d{1,2})?))?\s*€?$/i);
  if (priceMatch) {
    name = priceMatch[1]!.trim();
    priceFrom = Boolean(priceMatch[2]);
    price = priceMatch[3]!.replace(',', '.');
    priceUpTo = priceMatch[4]?.replace(',', '.');
  }

  return {
    id: `staff_svc_${index}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`,
    name: name || label.trim(),
    price,
    priceFrom,
    priceUpTo,
    duration,
    tag,
  };
}

function staffLabelsToServiceItems(services: string[]): ServiceItem[] {
  return services
    .map((label, index) => staffLabelToServiceItem(label, index))
    .filter((service) => service.name.trim())
    .slice(0, 20);
}

function staffServiceItemLabel(service: ServiceItem): string {
  const name = service.name.trim();
  if (!name) return '';
  let label = name;
  if (service.price?.trim()) {
    const price = service.price.trim();
    const priceText = service.priceFrom
      ? `ab ${price} €`
      : service.priceUpTo?.trim()
        ? `${price}–${service.priceUpTo.trim()} €`
        : `${price} €`;
    label = `${label}: ${priceText}`;
  }
  if (service.duration?.trim()) label = `${label} (${service.duration.trim()})`;
  if (service.tag) label = `${label} · ${service.tag}`;
  return label;
}

function serviceItemsToStaffStrings(items: ServiceItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const label = staffServiceItemLabel(item);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= 20) break;
  }
  return out;
}

function normalizeServiceItemsForSave(items: ServiceItem[]): ServiceItem[] {
  const seen = new Set<string>();
  const out: ServiceItem[] = [];
  for (const item of items) {
    const name = item.name?.trim() ?? '';
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);

    const next: ServiceItem = {
      id: item.id?.trim() || `svc_${Date.now().toString(36)}_${out.length}`,
      name,
    };
    const price = item.price?.trim();
    const priceUpTo = item.priceUpTo?.trim();
    const duration = item.duration?.trim();
    const description = item.description?.trim();
    if (price) next.price = price;
    if (item.priceFrom) next.priceFrom = true;
    if (priceUpTo && !item.priceFrom) next.priceUpTo = priceUpTo;
    if (duration) next.duration = duration;
    if (typeof item.bufferMinutes === 'number' && Number.isFinite(item.bufferMinutes)) {
      next.bufferMinutes = Math.min(180, Math.max(0, Math.round(item.bufferMinutes)));
    }
    if (description) next.description = description;
    if (item.tag) next.tag = item.tag;

    out.push(next);
    if (out.length >= 30) break;
  }
  return out;
}

function normalizeBusinessPatch(patch: BusinessInfoPatch): BusinessInfoPatch {
  return {
    ...patch,
    businessName: patch.businessName.trim(),
    address: patch.address.trim(),
    businessDescription: patch.businessDescription.trim(),
    openingHours: patch.openingHours.trim(),
    services: normalizeServiceItemsForSave(patch.services ?? []),
    servicesText: patch.servicesText.trim(),
  };
}

function serviceLabelListChanged(before: string[], after: string[]): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

async function syncBusinessServicesToAllStaff(services: string[]): Promise<{ total: number; saved: number; failed: number }> {
  const res = await getCalendarStaff();
  const members = res.staff ?? [];
  if (!members.length) return { total: 0, saved: 0, failed: 0 };

  const updates = await Promise.allSettled(
    members.map((member) => updateCalendarStaff(member.id, { services })),
  );
  const saved = updates.filter((result) => result.status === 'fulfilled').length;
  return { total: members.length, saved, failed: members.length - saved };
}

function BusinessTabButton({
  id,
  label,
  description,
  active,
  onClick,
}: {
  id: BusinessTab;
  label: string;
  description: string;
  active: boolean;
  onClick: (id: BusinessTab) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={[
        'min-w-0 flex-1 rounded-2xl border px-4 py-3 text-left transition-all sm:min-w-[10rem]',
        active
          ? 'border-orange-400/40 bg-orange-500/14 text-white shadow-[0_0_28px_rgba(255,91,10,0.10)]'
          : 'border-white/10 bg-white/[0.035] text-white/55 hover:border-white/18 hover:text-white/80',
      ].join(' ')}
      aria-pressed={active}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span className="mt-1 block text-[11px] leading-relaxed text-white/35">{description}</span>
    </button>
  );
}

function BusinessInfoPanel({
  config,
  saving,
  onSave,
}: {
  config: AgentConfig | null;
  saving: boolean;
  onSave: (patch: BusinessInfoPatch) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    businessName: '',
    address: '',
    businessDescription: '',
    openingHours: '',
    services: [] as NonNullable<AgentConfig['services']>,
    servicesText: '',
  });

  useEffect(() => {
    if (!config) return;
    setDraft({
      businessName: config.businessName ?? '',
      address: config.address ?? '',
      businessDescription: config.businessDescription ?? '',
      openingHours: config.openingHours ?? '',
      services: config.services ?? [],
      servicesText: config.servicesText ?? '',
    });
  }, [config]);

  const dirty = Boolean(config) && (
    draft.businessName !== (config?.businessName ?? '') ||
    draft.address !== (config?.address ?? '') ||
    draft.businessDescription !== (config?.businessDescription ?? '') ||
    draft.openingHours !== (config?.openingHours ?? '') ||
    draft.servicesText !== (config?.servicesText ?? '') ||
    JSON.stringify(draft.services) !== JSON.stringify(config?.services ?? [])
  );
  const serviceDirty = Boolean(config) && (
    draft.servicesText !== (config?.servicesText ?? '') ||
    JSON.stringify(draft.services) !== JSON.stringify(config?.services ?? [])
  );
  const saveDraft = () => { void onSave(normalizeBusinessPatch(draft)); };

  return (
    <section className={CARD_CLASS}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/15 text-orange-300">
            <IconBuilding size={22} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Betrieb</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/45">
              Diese Infos sind die zentrale Wahrheit für Chipy. Neue Mitarbeiter übernehmen Leistungen und Zeiten daraus als Startwert.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={saveDraft}
          disabled={!config || !dirty || saving || !draft.businessName.trim()}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}
        >
          {saving ? 'Speichere...' : dirty ? 'Betrieb speichern' : 'Gespeichert'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BusinessField label="Firmenname">
          <input className={INPUT_CLASS} value={draft.businessName} onChange={(e) => setDraft((d) => ({ ...d, businessName: e.target.value }))} placeholder="Friseur Müller" />
        </BusinessField>
        <BusinessField label="Adresse">
          <input className={INPUT_CLASS} value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} placeholder="Hauptstr. 12, 10115 Berlin" />
        </BusinessField>
      </div>

      <div className="mt-5 space-y-5">
        <BusinessField label="Beschreibung" hint="Kurz erklären, was dein Betrieb macht. Der Agent nutzt das für Einordnung und natürliche Antworten.">
          <AdaptiveTextarea
            value={draft.businessDescription}
            onChange={(e) => setDraft((d) => ({ ...d, businessDescription: e.target.value }))}
            placeholder="Was macht euer Unternehmen?"
            minRows={2}
            className={`${INPUT_CLASS} resize-y`}
          />
        </BusinessField>

        <div>
          <span className="text-sm font-medium text-white/70">Öffnungszeiten</span>
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">Diese Zeiten werden in den Agent-Prompt geschrieben und als Default für neue Mitarbeiter genutzt.</p>
          <div className="mt-2">
            <OpeningHoursEditor value={draft.openingHours} onChange={(openingHours) => setDraft((d) => ({ ...d, openingHours }))} />
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <span className="text-sm font-medium text-white/70">Services / Angebote</span>
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">
                Name, Preis und Dauer zentral erfassen. Beim Speichern werden diese Leistungen automatisch bei allen Mitarbeitern gespeichert.
              </p>
            </div>
            <button
              type="button"
              onClick={saveDraft}
              disabled={!config || !serviceDirty || saving || !draft.businessName.trim()}
              className="shrink-0 rounded-xl border border-orange-500/25 bg-orange-500/12 px-3 py-2 text-xs font-semibold text-orange-100 transition-colors hover:border-orange-400/45 hover:bg-orange-500/18 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Speichere...' : serviceDirty ? 'Services speichern' : 'Services gespeichert'}
            </button>
          </div>
          <ServicesEditor
            value={draft.services}
            legacyText={draft.servicesText}
            presetItems={isHairdresserConfig(config) ? HAIRDRESSER_SERVICE_PRESET : undefined}
            presetLabel="Friseur-Standardservices"
            presetDescription="Typische Salonleistungen mit grober Dauer. Preise kannst du optional ergänzen."
            onChange={(services) => setDraft((d) => ({ ...d, services }))}
            onConsumeLegacy={() => setDraft((d) => ({ ...d, servicesText: '' }))}
          />
        </div>
      </div>
    </section>
  );
}

function StaffPanel({ config, onConfigSaved }: { config: AgentConfig | null; onConfigSaved: (config: AgentConfig) => void }) {
  const [staff, setStaff] = useState<CalendarStaff[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [staffServices, setStaffServices] = useState<ServiceItem[]>([]);
  const [hoursText, setHoursText] = useState(chipyScheduleToOpeningHours(DEFAULT_CHIPY_SCHEDULE));

  const businessServices = useMemo(() => deriveBusinessServiceLabels(config), [config]);
  const selected = staff.find((member) => member.id === selectedId) ?? null;
  const defaultHoursText = useMemo(
    () => config?.openingHours?.trim() || chipyScheduleToOpeningHours(DEFAULT_CHIPY_SCHEDULE),
    [config?.openingHours],
  );

  async function loadStaff() {
    setLoading(true);
    setError(null);
    try {
      const res = await getCalendarStaff();
      const nextStaff = res.staff ?? [];
      setStaff(nextStaff);
      setSelectedId((current) => {
        if (current && nextStaff.some((member) => member.id === current)) return current;
        return nextStaff[0]?.id ?? null;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Mitarbeiter konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStaff();
  }, []);

  useEffect(() => {
    setEditName(selected?.name ?? '');
    setEditRole(selected?.role ?? '');
    setStaffServices(staffLabelsToServiceItems(selected?.services?.length ? selected.services : businessServices));
  }, [selected?.id, selected?.name, selected?.role, selected?.services, businessServices]);

  useEffect(() => {
    let cancelled = false;
    async function loadHours() {
      if (!selected) {
        setHoursText(defaultHoursText);
        return;
      }
      try {
        const chipy = await getStaffChipyCalendar(selected.id);
        if (!cancelled) setHoursText(chipyScheduleToOpeningHours(chipy.schedule));
      } catch {
        if (!cancelled) setHoursText(defaultHoursText);
      }
    }
    void loadHours();
    return () => { cancelled = true; };
  }, [selected?.id, defaultHoursText]);

  async function refreshActiveKnowledge(successMessage: string) {
    if (!config?.retellAgentId) {
      setNotice(`${successMessage} Beim nächsten Deploy nutzt Chipy diese Daten.`);
      return;
    }

    try {
      const saved = (await deployAgentConfig(config)).config;
      onConfigSaved(saved);
      setNotice(`${successMessage} Aktive Knowledge Base und Agent-Prompt wurden aktualisiert.`);
    } catch (e: unknown) {
      setNotice(`${successMessage} Die Daten sind gespeichert.`);
      setError(e instanceof Error
        ? `Aktive Knowledge Base konnte nicht automatisch aktualisiert werden: ${e.message}`
        : 'Aktive Knowledge Base konnte nicht automatisch aktualisiert werden.');
    }
  }

  async function handleCreateStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSavingId('new');
    setError(null);
    setNotice(null);
    try {
      const res = await createCalendarStaff({
        name: newName.trim(),
        role: newRole.trim() || undefined,
        services: businessServices,
      });
      const canSaveDefaultHours = canConvertOpeningHours(defaultHoursText);
      let defaultHoursSaved = false;
      if (canSaveDefaultHours) {
        try {
          await saveStaffChipySchedule(res.staff.id, openingHoursToChipySchedule(defaultHoursText));
          defaultHoursSaved = true;
        } catch {
          // The staff profile exists even if saving default hours fails. The
          // user can retry from the explicit Arbeitszeiten save button.
        }
      }
      setStaff((prev) => [...prev, res.staff]);
      setSelectedId(res.staff.id);
      setNewName('');
      setNewRole('');
      await refreshActiveKnowledge(defaultHoursSaved
        ? 'Mitarbeiter angelegt. Leistungen und Arbeitszeiten wurden aus dem Betrieb übernommen.'
        : canSaveDefaultHours
          ? 'Mitarbeiter angelegt. Leistungen wurden übernommen; Arbeitszeiten konnten nicht automatisch gespeichert werden. Bitte einmal manuell speichern.'
          : 'Mitarbeiter angelegt. Leistungen wurden übernommen; Arbeitszeiten bitte einmal strukturiert speichern.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Mitarbeiter konnte nicht angelegt werden.');
    } finally {
      setSavingId(null);
    }
  }

  async function saveSelectedProfile() {
    if (!selected || !editName.trim()) return;
    setSavingId(selected.id);
    setError(null);
    setNotice(null);
    try {
      const res = await updateCalendarStaff(selected.id, {
        name: editName.trim(),
        role: editRole.trim() || undefined,
        services: serviceItemsToStaffStrings(staffServices),
      });
      setStaff((prev) => prev.map((member) => member.id === selected.id ? { ...member, ...res.staff } : member));
      await refreshActiveKnowledge('Mitarbeiterprofil gespeichert.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Mitarbeiterprofil konnte nicht gespeichert werden.');
    } finally {
      setSavingId(null);
    }
  }

  async function saveSelectedHours() {
    if (!selected) return;
    if (!canConvertOpeningHours(hoursText)) {
      setError('Arbeitszeiten für Mitarbeiter müssen strukturiert sein. Bitte nutze die Tages-Schalter oder eine Form wie "Mo-Fr 09:00-17:00".');
      return;
    }
    setSavingId(`${selected.id}:hours`);
    setError(null);
    setNotice(null);
    try {
      await saveStaffChipySchedule(selected.id, openingHoursToChipySchedule(hoursText));
      await refreshActiveKnowledge('Arbeitszeiten gespeichert. Termine und Tagesansicht bleiben im Kalender-Modul.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Arbeitszeiten konnten nicht gespeichert werden.');
    } finally {
      setSavingId(null);
    }
  }

  async function deleteSelectedStaff() {
    if (!selected) return;
    const confirmed = window.confirm(`${selected.name} wirklich löschen? Termine selbst bleiben im Kalender erhalten.`);
    if (!confirmed) return;
    setSavingId(selected.id);
    setError(null);
    setNotice(null);
    try {
      await deleteCalendarStaff(selected.id);
      setStaff((prev) => {
        const next = prev.filter((member) => member.id !== selected.id);
        setSelectedId(next[0]?.id ?? null);
        return next;
      });
      await refreshActiveKnowledge('Mitarbeiter gelöscht.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Mitarbeiter konnte nicht gelöscht werden.');
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <section className={CARD_CLASS}><p className="text-sm text-white/40">Lade Mitarbeiter...</p></section>;
  }

  return (
    <section className={CARD_CLASS}>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/12 text-cyan-200">
            <IconUser size={22} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Mitarbeiter</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/45">
              Hier pflegst du Profile, Leistungen und Arbeitszeiten. Terminübersicht, Buchungen, Sperren und Kalender-Verbindungen bleiben im Modul Kalender.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { void loadStaff(); }}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white/70 hover:border-white/20 hover:text-white"
        >
          <IconRefresh size={15} />
          Aktualisieren
        </button>
      </div>

      {error && <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {notice && <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>}

      <form onSubmit={handleCreateStaff} className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_auto]">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name, z.B. Lena" className={INPUT_CLASS} />
        <input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="Rolle, z.B. Stylistin" className={INPUT_CLASS} />
        <button
          type="submit"
          disabled={!newName.trim() || savingId === 'new'}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}
        >
          Anlegen
        </button>
      </form>

      <p className="mb-5 rounded-2xl border border-white/8 bg-black/15 px-4 py-3 text-xs leading-relaxed text-white/40">
        Betriebsleistungen werden beim Speichern im Betrieb automatisch bei allen Mitarbeitern gespeichert. Danach kannst du einzelne Mitarbeiter hier gezielt anpassen.
      </p>

      {staff.length ? (
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {staff.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => setSelectedId(member.id)}
              className={[
                'shrink-0 rounded-xl border px-4 py-2 text-sm transition-all',
                selectedId === member.id
                  ? 'border-orange-500/40 bg-orange-500/10 text-white'
                  : 'border-white/8 bg-white/[0.02] text-white/45 hover:text-white/75',
              ].join(' ')}
            >
              {member.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/35">
          Noch keine Mitarbeiter angelegt. Dann nutzt Chipy den Betrieb als Ganzes.
        </div>
      )}

      {selected && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-5 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-100/50">Profil</p>
                <h3 className="mt-1 text-base font-bold text-white">{selected.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => { void deleteSelectedStaff(); }}
                disabled={savingId === selected.id}
                className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200 disabled:opacity-40"
              >
                Löschen
              </button>
            </div>
            <BusinessField label="Name">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className={INPUT_CLASS} />
            </BusinessField>
            <BusinessField label="Rolle">
              <input value={editRole} onChange={(e) => setEditRole(e.target.value)} placeholder="z.B. Senior Stylistin" className={INPUT_CLASS} />
            </BusinessField>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/15 p-5 space-y-5">
            <div>
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/50">Arbeitszeiten</p>
                <h3 className="mt-1 text-base font-bold text-white">{selected.name}</h3>
                <p className="mt-1 text-xs leading-relaxed text-white/35">
                  Nur die Verfügbarkeit der Person. Termine, Sperren und externe Kalender bearbeitest du weiter im Kalender-Modul.
                </p>
              </div>
              <OpeningHoursEditor value={hoursText} onChange={setHoursText} />
              <button
                type="button"
                onClick={() => { void saveSelectedHours(); }}
                disabled={savingId === `${selected.id}:hours`}
                className="mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #ff5b0a, #20d9ff)' }}
              >
                {savingId === `${selected.id}:hours` ? 'Speichere...' : 'Arbeitszeiten speichern'}
              </button>
            </div>

            <div className="border-t border-white/8 pt-5">
              <span className="text-sm font-medium text-white/70">Leistungen</span>
              <p className="mt-0.5 mb-2 text-[11px] leading-relaxed text-white/35">
                Gleiche Pflege wie beim Betrieb: Name, Preis und Dauer strukturiert erfassen. Ohne eigene Anpassung startet die Person mit den Betriebsleistungen.
              </p>
              <ServicesEditor
                value={staffServices}
                legacyText=""
                onChange={setStaffServices}
                onConsumeLegacy={() => undefined}
              />
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => { void saveSelectedProfile(); }}
                  disabled={!editName.trim() || savingId === selected.id}
                  className="rounded-xl border border-orange-500/30 bg-orange-500/14 px-4 py-2.5 text-sm font-semibold text-orange-100 disabled:opacity-40 sm:ml-auto"
                >
                  Profil & Leistungen speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
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

function customerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function CustomerDetails({ customer, questions }: { customer: Customer; questions: CustomerQuestionConfig[] }) {
  const rows = customerDetailRows(customer, questions);
  return (
    <div className="mx-4 mb-4 overflow-hidden rounded-3xl border border-orange-500/15 bg-[#101018]/95 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
      <div className="relative border-b border-white/[0.06] bg-gradient-to-br from-orange-500/[0.13] via-white/[0.04] to-cyan-500/[0.09] p-5">
        <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-orange-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-10 h-32 w-32 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-orange-400/25 bg-black/25 text-sm font-bold text-orange-100 shadow-[0_0_28px_rgba(255,91,10,0.12)]">
              {customerInitials(customer.full_name)}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-100/55">Kundendetails</p>
              <p className="mt-1 truncate text-lg font-bold text-white">{customer.full_name}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100/80">{customerTypeLabel(customer)}</span>
                <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/45">{rows.length} Detail{rows.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/45">
            <p className="text-white/30">Aktualisiert</p>
            <p className="mt-0.5 text-white/70">{dateLabel(customer.updated_at)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/28">Telefon</p>
          <p className="mt-1 break-all text-sm font-medium text-white/80">{customer.phone_normalized ?? customer.phone ?? 'Keine Nummer gespeichert'}</p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/28">E-Mail</p>
          <p className="mt-1 break-all text-sm font-medium text-white/80">{customer.email ?? 'Keine E-Mail gespeichert'}</p>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={`${row.label}:${row.value}`} className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.13em] text-white/28">{row.label}</p>
              <p className="mt-1 text-sm text-white/75">{row.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mx-4 mb-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-white/35">Noch keine Zusatzdetails gespeichert.</p>
      )}

      {customer.notes && (
        <div className="mx-4 mb-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.13em] text-white/28">Interne Notiz</p>
          <p className="mt-1 text-sm text-white/70 whitespace-pre-wrap">{customer.notes}</p>
        </div>
      )}
    </div>
  );
}

function QuestionConfigCard({
  question,
  saving,
  onToggle,
  onSave,
  onRemove,
}: {
  question: CustomerQuestionConfig;
  saving: boolean;
  onToggle: (question: CustomerQuestionConfig) => void;
  onSave: (question: CustomerQuestionConfig, patch: Pick<CustomerQuestionConfig, 'prompt' | 'condition'>) => void;
  onRemove: (id: string) => void;
}) {
  const [prompt, setPrompt] = useState(question.prompt ?? question.label);
  const [condition, setCondition] = useState(question.condition ?? '');

  useEffect(() => {
    setPrompt(question.prompt ?? question.label);
    setCondition(question.condition ?? '');
  }, [question.id, question.label, question.prompt, question.condition]);

  const changed = prompt.trim() !== (question.prompt ?? question.label).trim()
    || condition.trim() !== (question.condition ?? '').trim();

  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
      <button
        type="button"
        onClick={() => onToggle(question)}
        disabled={question.required || saving}
        className="w-full flex items-start justify-between gap-3 text-left disabled:cursor-not-allowed"
      >
        <span>
          <span className="text-sm font-semibold text-white">{question.label}</span>
          {condition.trim() && <span className="ml-2 text-[11px] text-orange-200/60">Regel: {condition.trim()}</span>}
          {question.required && <span className="block text-[11px] text-white/25 mt-2">Pflichtfeld</span>}
        </span>
        <TogglePill active={question.enabled !== false} disabled={question.required} />
      </button>

      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.13em] text-white/28">Frage / Hinweis</span>
          <AdaptiveTextarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            minRows={2}
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs text-white placeholder:text-white/25 outline-none focus:border-orange-400/50"
            placeholder="Wie soll Chipy diese Info erfragen?"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.13em] text-white/28">Regel</span>
          <span className="mt-0.5 block text-[11px] text-white/32">Wann soll Chipy diese Frage stellen? Leer lassen = immer fragen.</span>
          <input
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            placeholder="z.B. nur bei Farbe/Chemie"
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs text-white placeholder:text-white/25 outline-none focus:border-orange-400/50"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSave(question, { prompt: prompt.trim(), condition: condition.trim() })}
            disabled={!changed || saving || !prompt.trim()}
            className="rounded-xl border border-orange-500/25 bg-orange-500/12 px-3 py-2 text-xs font-semibold text-orange-100 disabled:opacity-40"
          >
            Änderung speichern
          </button>
          {question.builtin !== true && (
            <button
              type="button"
              onClick={() => onRemove(question.id)}
              disabled={saving}
              className="text-xs text-red-300/60 hover:text-red-300 disabled:opacity-40"
            >
              Frage löschen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CustomersPage({ focusCustomerId }: { focusCustomerId?: string | null } = {}) {
  const [activeTab, setActiveTab] = useState<BusinessTab>('betrieb');
  const [status, setStatus] = useState<CustomerModuleStatus | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customQuestion, setCustomQuestion] = useState('');
  const [customQuestionPrompt, setCustomQuestionPrompt] = useState('');
  const [customQuestionCondition, setCustomQuestionCondition] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [showEmailHint, setShowEmailHint] = useState(false);
  const [emailRejected, setEmailRejected] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(focusCustomerId ?? null);
  const [pendingDeleteCustomerId, setPendingDeleteCustomerId] = useState<string | null>(null);

  const moduleConfig = useMemo(() => normalizeModule(config?.customerModule), [config?.customerModule]);
  const enabled = status?.available ? moduleConfig.enabled !== false : false;
  const allowBookingWithoutApproval = moduleConfig.allowBookingWithoutApproval !== false;
  const questions = moduleConfig.questions ?? DEFAULT_QUESTIONS;
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
  }, []);

  useEffect(() => {
    if (focusCustomerId) setActiveTab('kunden');
  }, [focusCustomerId]);

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

  async function saveBusinessInfo(patch: BusinessInfoPatch) {
    if (!config) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const normalizedPatch = normalizeBusinessPatch(patch);
      const previousServices = deriveBusinessServiceLabels(config);
      const nextConfig: AgentConfig = { ...config, ...normalizedPatch };
      const nextServices = deriveBusinessServiceLabels(nextConfig);
      const shouldSyncStaffServices = serviceLabelListChanged(previousServices, nextServices);
      let staffSync: { total: number; saved: number; failed: number } | null = null;
      let staffSyncErrored = false;
      if (shouldSyncStaffServices) {
        try {
          staffSync = await syncBusinessServicesToAllStaff(nextServices);
        } catch {
          staffSyncErrored = true;
        }
      }
      const saved = config.retellAgentId
        ? (await deployAgentConfig(nextConfig)).config
        : await saveAgentConfig(nextConfig);
      setConfig(saved);
      const baseMessage = config.retellAgentId
        ? 'Betriebsinfos gespeichert und im aktiven Agent aktualisiert.'
        : 'Betriebsinfos gespeichert. Beim Deploy nutzt Chipy diese Daten.';

      if (staffSyncErrored) {
        setNotice(baseMessage);
        setError('Betriebsservices gespeichert, aber die Mitarbeiterprofile konnten nicht automatisch aktualisiert werden.');
      } else if (staffSync) {
        if (staffSync.failed > 0) {
          setNotice(baseMessage);
          setError(`Betriebsservices gespeichert, aber ${staffSync.failed} von ${staffSync.total} Mitarbeiterprofilen konnten nicht aktualisiert werden.`);
        } else if (staffSync.total > 0) {
          setNotice(`${baseMessage} ${staffSync.saved} Mitarbeiterprofil${staffSync.saved === 1 ? '' : 'e'} mit Betriebsservices aktualisiert.`);
        } else {
          setNotice(baseMessage);
        }
      } else {
        setNotice(baseMessage);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Betriebsinfos konnten nicht gespeichert werden.');
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
      'Neukunden-Fragen gespeichert. Der Prompt wird beim Speichern/Deploy aktualisiert.',
    );
  }

  async function saveQuestionConfig(question: CustomerQuestionConfig, patch: Pick<CustomerQuestionConfig, 'prompt' | 'condition'>) {
    const nextQuestions = questions.map((q) => q.id === question.id ? {
      ...q,
      prompt: patch.prompt?.trim() || q.label,
      condition: patch.condition?.trim() ?? '',
    } : q);
    await saveModule(
      { ...moduleConfig, enabled, allowBookingWithoutApproval, questions: nextQuestions },
      'Fragen-Regel gespeichert. Chipy nutzt den Hinweis beim nächsten Speichern/Deploy.',
    );
  }

  async function addCustomQuestion(e: React.FormEvent) {
    e.preventDefault();
    const label = customQuestion.trim();
    if (!label) return;
    const id = normalizeQuestionId(label);
    const prompt = customQuestionPrompt.trim() || label;
    const condition = customQuestionCondition.trim() || undefined;
    await saveModule(
      {
        ...moduleConfig,
        enabled,
        allowBookingWithoutApproval,
        questions: [...questions, { id, label, prompt, condition, enabled: true, builtin: false, detailsKey: id }],
      },
      'Eigene Frage hinzugefügt und im Prompt aktiviert.',
    );
    setCustomQuestion('');
    setCustomQuestionPrompt('');
    setCustomQuestionCondition('');
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
      setPendingDeleteCustomerId(null);
      setNotice('Kunde gelöscht.');
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
          <p className="text-xs uppercase tracking-[0.24em] text-orange-300/70 font-semibold">Zentrale Betriebsdaten</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mt-2">Mein Business</h1>
          <p className="text-sm text-white/45 mt-2 max-w-2xl">
            Betrieb, Mitarbeiter und Kunden an einem Ort. Der Kalender bleibt für Termine, Sperren und externe Verbindungen zuständig.
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

      <nav className="flex flex-col gap-2 sm:flex-row" aria-label="Mein Business Bereiche">
        {BUSINESS_TABS.map((tab) => (
          <BusinessTabButton
            key={tab.id}
            id={tab.id}
            label={tab.label}
            description={tab.description}
            active={activeTab === tab.id}
            onClick={setActiveTab}
          />
        ))}
      </nav>

      {activeTab === 'betrieb' && (
        <BusinessInfoPanel config={config} saving={saving} onSave={saveBusinessInfo} />
      )}

      {activeTab === 'mitarbeiter' && (
        <StaffPanel config={config} onConfigSaved={setConfig} />
      )}

      {activeTab === 'kunden' && (
        <>
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
                ? 'bg-orange-500/18 text-orange-100 border border-orange-500/30 shadow-[0_0_26px_rgba(255,91,10,0.12)]'
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
          <p className="text-xs text-white/40 mt-1">Diese Liste steuert, welche Fragen Chipy bei Neukunden stellt. Name bleibt Pflicht, weil ohne Namen kein Kunde sauber angelegt werden kann.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {questions.map((question) => (
            <QuestionConfigCard
              key={question.id}
              question={question}
              saving={saving}
              onToggle={(q) => { void toggleQuestion(q); }}
              onSave={(q, patch) => { void saveQuestionConfig(q, patch); }}
              onRemove={(id) => { void removeCustomQuestion(id); }}
            />
          ))}
        </div>
        <form onSubmit={addCustomQuestion} className="rounded-2xl border border-white/10 bg-black/15 p-4 space-y-2">
          <div className="grid gap-2 md:grid-cols-[0.8fr_1.2fr]">
            <input
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder="Eigene Frage ergänzen, z.B. Wunschprodukt"
              className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50"
            />
            <input
              value={customQuestionPrompt}
              onChange={(e) => setCustomQuestionPrompt(e.target.value)}
              placeholder="Hinweis/Fragetext, z.B. gezielt nach Pflegewunsch fragen"
              className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={customQuestionCondition}
              onChange={(e) => setCustomQuestionCondition(e.target.value)}
              placeholder="Regel optional, z.B. nur bei Farbe/Chemie oder wenn Neukunde unsicher ist"
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50"
            />
            <button disabled={!customQuestion.trim() || saving} className="rounded-xl bg-orange-500/20 border border-orange-500/30 px-4 py-2.5 text-sm font-semibold text-orange-100 hover:bg-orange-500/25 disabled:opacity-40">
              Frage hinzufügen
            </button>
          </div>
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
            <form onSubmit={runSearch} className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, Nummer, E-Mail" className="w-full min-w-0 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-white/25 outline-none focus:border-orange-400/50 sm:w-52" />
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
                    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
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
                  <p className="mt-1 break-all text-xs text-white/35">{customer.phone_normalized ?? customer.phone ?? 'keine Nummer'} {customer.email ? ` - ${customer.email}` : ''}</p>
                  <p className="text-xs text-white/30 mt-1">{isOpen ? 'Details geöffnet' : 'Anklicken, um Details zu sehen'} · Aktualisiert: {dateLabel(customer.updated_at)}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 items-end" onClick={(e) => e.stopPropagation()}>
                  {customer.customer_type === 'pending' && (
                    <button onClick={() => { void approveCustomer(customer); }} disabled={saving} className="text-xs rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-emerald-200/80 hover:text-emerald-100 disabled:opacity-40">
                      Bestätigen
                    </button>
                  )}
                  {pendingDeleteCustomerId === customer.id ? (
                    <div className="flex w-full min-w-[190px] flex-col items-stretch gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-2.5 text-right sm:w-auto">
                      <span className="text-[11px] font-semibold leading-snug text-red-100/80">
                        {customer.full_name || 'Diesen Kunden'} wirklich löschen?
                      </span>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button onClick={(e) => { e.stopPropagation(); void removeCustomer(customer.id); }} disabled={saving} className="min-h-11 rounded-lg bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/30 disabled:opacity-40" aria-label={`${customer.full_name || 'Kunden'} löschen`}>
                          Kunde löschen
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setPendingDeleteCustomerId(null); }} disabled={saving} className="min-h-11 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/55 hover:text-white disabled:opacity-40">
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setPendingDeleteCustomerId(customer.id); }} disabled={saving} className="text-xs text-red-300/45 hover:text-red-300 disabled:opacity-40">
                      Löschen
                    </button>
                  )}
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
        </>
      )}
    </div>
  );
}
