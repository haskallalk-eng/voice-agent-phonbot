import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { AgentConfig, CalendarStatus, CallRoutingRule, FallbackReasonConfig, LiveWebAccess } from '../../lib/api.js';
import { ForwardingHint } from '../ForwardingHint.js';
import { PasswordInput } from '../PasswordInput.js';
import { AdaptiveTextarea } from '../../components/AdaptiveTextarea.js';
import {
  getCalendarStatus,
  getGoogleCalendarAuthUrl,
  getMicrosoftCalendarAuthUrl,
  connectCalcom,
  disconnectCalendar,
  getPhoneNumbers,
} from '../../lib/api.js';
import {
  SectionCard, Input, Toggle,
  IconPhoneOut, IconPhoneOff, IconMicUpload, IconTicket, IconCalendar,
  IconBookOpen, IconCheckCircle, IconWebhook, IconGlobe,
  KNOWN_TOOLS,
  DEFAULT_FALLBACK_REASONS,
  DEFAULT_FALLBACK_REASON,
  normalizeFallbackReasonValue,
  type SectionIconComp,
} from './shared.js';

export interface CapabilitiesTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function CapabilitiesTab({ config, onUpdate }: CapabilitiesTabProps) {
  // Load org's Phonbot phone numbers + forwarding info for loop-detection warning.
  // We rely on:
  //   • number          — every Phonbot inbound is a guaranteed loop target
  //   • customer_number — set only when /phone/verify-forwarding succeeded
  //   • forwarding_type — 'always' | 'no_answer', set during the same successful loop test
  //   • verified        — true when the loop test confirmed forwarding to this Phonbot inbound
  const [phoneInfo, setPhoneInfo] = useState<Array<{
    number: string;
    customerNumber?: string;
    forwardingType?: 'always' | 'no_answer';
    verified?: boolean;
  }>>([]);
  useEffect(() => {
    getPhoneNumbers()
      .then(res => setPhoneInfo((res.items ?? []).map(p => {
        const raw = p as Record<string, unknown>;
        const ftRaw = raw.forwarding_type as string | undefined;
        const ft: 'always' | 'no_answer' | undefined =
          ftRaw === 'always' || ftRaw === 'no_answer' ? ftRaw : undefined;
        return {
          number: (p.number ?? '').replace(/\s/g, ''),
          customerNumber: (raw.customer_number as string | undefined)?.replace(/\s/g, '') ?? undefined,
          forwardingType: ft,
          verified: (raw.verified as boolean | undefined) ?? false,
        };
      })))
      .catch(() => {});
  }, []);

  return (
    <>
      <ActiveToolsPanel config={config} onUpdate={onUpdate} />

      <div id="handoff-routing">
        <SectionCard title="Übergabe & Eskalation" icon={IconPhoneOut}>
          <div className="mb-4 flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[16rem]">
              <p className="text-sm text-white/60">
                Alles, was Chipy nicht selbst lösen soll: zuerst einen Menschen erreichen, danach Ticket als Sicherheitsnetz.
              </p>
              <p className="mt-1 text-xs text-white/35">
                Rufweiterleitung und Ticket-Fallback sind ein gemeinsamer Ablauf im Agent-Prompt.
              </p>
            </div>
            <ForwardingHint />
          </div>
          <HandoffDecisionEditor config={config} phoneInfo={phoneInfo} onUpdate={onUpdate} />
        </SectionCard>
      </div>

      {/* Calendar Integrations */}
      <SectionCard title="Kalender-Anbindung" icon={IconCalendar}>
        <p className="text-sm text-white/50 mb-4">
          Verbinde einen Kalender, damit dein Agent Termine prüfen und buchen kann.
        </p>
        <CalendarConnector
          integrations={config.calendarIntegrations ?? []}
          onChange={(items) => onUpdate({ calendarIntegrations: items })}
        />
      </SectionCard>

      {/* API Integrations moved to the "Webhooks & APIs" tab (WebhooksTab). */}

      {/* Live Web Access */}
      <SectionCard title="Live Website-Zugriff" icon={IconGlobe}>
        <p className="text-sm text-white/50 mb-4">
          Erlaube deinem Agent, während des Gesprächs aktuelle Infos von Webseiten abzurufen (z.B. Preise, Verfügbarkeit).
        </p>
        <LiveWebAccessEditor
          config={config.liveWebAccess ?? { enabled: false, allowedDomains: [] }}
          onChange={(v) => onUpdate({ liveWebAccess: v })}
        />
      </SectionCard>
    </>
  );
}

// ── Runtime tools ────────────────────────────────────────────────────────────

type ToolMeta = {
  label: string;
  description: string;
  Icon: SectionIconComp;
  rawName: string;
};

const TOOL_META: Record<typeof KNOWN_TOOLS[number], ToolMeta> = {
  'calendar.findSlots': {
    label: 'Freie Termine suchen',
    description: 'Prüft echte freie Slots im verbundenen Kalender statt Zeiten zu erfinden.',
    Icon: IconCalendar,
    rawName: 'calendar.findSlots',
  },
  'calendar.book': {
    label: 'Termin buchen',
    description: 'Bucht einen bestätigten Slot direkt. Wenn der Slot weg ist, greift der Ticket-Fallback.',
    Icon: IconCalendar,
    rawName: 'calendar.book',
  },
  'calendar.findBookings': {
    label: 'Bestehende Termine finden',
    description: 'Findet Kundentermine sicher über Nummer, Name oder Zeitraum, bevor etwas geändert wird.',
    Icon: IconCalendar,
    rawName: 'calendar.findBookings',
  },
  'calendar.cancel': {
    label: 'Termin absagen',
    description: 'Sagt gefundene Termine erst nach ausdrücklicher Bestätigung ab.',
    Icon: IconCalendar,
    rawName: 'calendar.cancel',
  },
  'calendar.reschedule': {
    label: 'Termin verschieben',
    description: 'Verschiebt einen bestehenden Termin auf einen bestätigten neuen Slot.',
    Icon: IconCalendar,
    rawName: 'calendar.reschedule',
  },
  'ticket.create': {
    label: 'Rückruf-Ticket erfassen',
    description: 'Speichert Anliegen mit Name, Nummer und Anlass in der Inbox. Wichtig als Sicherheitsnetz.',
    Icon: IconTicket,
    rawName: 'ticket.create',
  },
};

const ROLE_TOOL_HINTS: Record<string, ReadonlyArray<typeof KNOWN_TOOLS[number]>> = {
  reception: ['ticket.create'],
  appointment: ['calendar.findSlots', 'calendar.book', 'calendar.findBookings', 'calendar.cancel', 'calendar.reschedule', 'ticket.create'],
  support: ['ticket.create'],
  orders: ['ticket.create'],
  emergency: ['ticket.create'],
  info: ['ticket.create'],
};

function selectedRoles(config: AgentConfig): string[] {
  return Array.isArray(config.selectedRoles) ? config.selectedRoles : [];
}

function recommendedToolsFor(roleIds: string[]): Set<string> {
  const out = new Set<string>();
  for (const id of roleIds) {
    const hints = ROLE_TOOL_HINTS[id];
    if (hints) for (const tool of hints) out.add(tool);
  }
  return out;
}

function ActiveToolsPanel({ config, onUpdate }: { config: AgentConfig; onUpdate: (p: Partial<AgentConfig>) => void }) {
  const roleIds = selectedRoles(config);
  const recommended = useMemo(() => recommendedToolsFor(roleIds), [roleIds.join(',')]);
  const active = useMemo(() => new Set(config.tools), [config.tools.join(',')]);
  const missing = useMemo(() => {
    const items: string[] = [];
    recommended.forEach((tool) => { if (!active.has(tool)) items.push(tool); });
    return items;
  }, [recommended, active]);
  const extra = useMemo(() => {
    const items: string[] = [];
    active.forEach((tool) => {
      if (!recommended.has(tool) && (KNOWN_TOOLS as readonly string[]).includes(tool)) items.push(tool);
    });
    return items;
  }, [recommended, active]);

  function toggle(tool: string) {
    const next = new Set(config.tools);
    if (next.has(tool)) next.delete(tool);
    else next.add(tool);
    onUpdate({ tools: Array.from(next) });
  }

  function applyRecommended() {
    const preserved = config.tools.filter((tool) => !(KNOWN_TOOLS as readonly string[]).includes(tool));
    onUpdate({ tools: [...preserved, ...recommended] });
  }

  return (
    <SectionCard title="Aktive Tools" icon={IconCheckCircle}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm text-white/60">
            Funktionen, die Chipy während des Anrufs wirklich ausführen kann. Ohne Häkchen kann er die Aktion nicht auslösen, egal was im Prompt steht.
          </p>
          <p className="mt-1 text-xs text-white/35">
            Die Live-Weiterleitung wird direkt im nächsten Abschnitt über Übergabe-Regeln aktiviert, weil sie immer eine echte Zielnummer braucht.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
          <span className="rounded-full border border-orange-300/25 bg-orange-400/10 px-2.5 py-1 text-orange-100/80">
            {KNOWN_TOOLS.filter((tool) => active.has(tool)).length} aktiv
          </span>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-cyan-100/75">
            Prompt-sicher
          </span>
        </div>
      </div>

      {roleIds.length > 0 && (missing.length > 0 || extra.length > 0) && (
        <div className="mb-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.055] px-3 py-2.5 flex items-center gap-3 flex-wrap">
          <p className="flex-1 min-w-[14rem] text-xs leading-relaxed text-cyan-100/78">
            {missing.length > 0 && (
              <>Empfohlen für deine Rollen: {missing.map((tool) => TOOL_META[tool as typeof KNOWN_TOOLS[number]]?.label ?? tool).join(', ')}.</>
            )}
            {missing.length > 0 && extra.length > 0 && ' '}
            {extra.length > 0 && (
              <>Aktiv ohne passende Rolle: {extra.map((tool) => TOOL_META[tool as typeof KNOWN_TOOLS[number]]?.label ?? tool).join(', ')}.</>
            )}
          </p>
          <button
            type="button"
            onClick={applyRecommended}
            className="rounded-xl border border-cyan-300/30 bg-cyan-400/12 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/20"
          >
            Empfehlung übernehmen
          </button>
        </div>
      )}

      <div className="space-y-2">
        {KNOWN_TOOLS.map((tool) => (
          <ToolRow
            key={tool}
            meta={TOOL_META[tool]}
            active={active.has(tool)}
            recommended={recommended.has(tool)}
            onToggle={() => toggle(tool)}
          />
        ))}
        <TransferToolRow config={config} />
      </div>
    </SectionCard>
  );
}

function ToolRow({ meta, active, recommended, onToggle }: { meta: ToolMeta; active: boolean; recommended: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all ${
        active
          ? 'border-orange-300/28 bg-orange-400/[0.075]'
          : recommended
            ? 'border-cyan-300/22 bg-cyan-400/[0.045] hover:border-cyan-300/38'
            : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.16] hover:bg-white/[0.045]'
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
        active
          ? 'border-orange-300/25 bg-orange-400/12 text-orange-100'
          : 'border-white/[0.08] bg-black/20 text-white/38 group-hover:text-white/60'
      }`}>
        <meta.Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-semibold ${active ? 'text-white' : 'text-white/70 group-hover:text-white/88'}`}>{meta.label}</span>
          {recommended && !active && (
            <span className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-100/75">
              empfohlen
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-white/38">{meta.description}</span>
        <code className="mt-1 block text-[10px] text-white/24">{meta.rawName}</code>
      </span>
      <span className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-semibold ${
        active
          ? 'border-orange-300/35 bg-orange-400/14 text-orange-100'
          : 'border-white/[0.10] bg-white/[0.03] text-white/38'
      }`}>
        {active ? 'Aktiv' : 'Aus'}
      </span>
    </button>
  );
}

function TransferToolRow({ config }: { config: AgentConfig }) {
  const rules = (config.callRoutingRules ?? []).filter((rule) => (
    rule.enabled !== false && rule.action === 'transfer' && Boolean(rule.target?.trim())
  ));
  const hasTransfer = rules.length > 0;

  function scrollToRouting() {
    document.getElementById('handoff-routing')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <button
      type="button"
      onClick={scrollToRouting}
      className={`group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all ${
        hasTransfer
          ? 'border-cyan-300/28 bg-cyan-400/[0.06]'
          : 'border-dashed border-white/[0.10] bg-black/15 hover:border-orange-300/26 hover:bg-orange-400/[0.035]'
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
        hasTransfer
          ? 'border-cyan-300/25 bg-cyan-400/12 text-cyan-100'
          : 'border-white/[0.08] bg-black/20 text-white/35 group-hover:text-orange-100/70'
      }`}>
        <IconPhoneOut size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`text-sm font-semibold ${hasTransfer ? 'text-white' : 'text-white/70 group-hover:text-white/88'}`}>
          Live-Weiterleitung
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-white/38">
          {hasTransfer
            ? `Weiterleitung an ${rules.length === 1 ? 'eine Zielnummer' : `${rules.length} Zielnummern`} aktiv. Wenn niemand übernimmt, greift der Ticket-Fallback.`
            : 'Noch kein Live-Ziel aktiv. Füge unten eine Übergabe-Regel mit Zielnummer hinzu.'}
        </span>
        <code className="mt-1 block text-[10px] text-white/24">transfer_call</code>
      </span>
      <span className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-semibold ${
        hasTransfer
          ? 'border-cyan-300/30 bg-cyan-400/12 text-cyan-100'
          : 'border-white/[0.10] bg-white/[0.03] text-white/38'
      }`}>
        {hasTransfer ? `${rules.length} Ziel${rules.length === 1 ? '' : 'e'}` : 'Unten einrichten'}
      </span>
    </button>
  );
}

/* ── Call Routing Rules ── */

type RoutingExample = {
  description: string;
  action: Exclude<CallRoutingRule['action'], 'voicemail'>;
  target?: string;
  label: string;
};

const GENERIC_ROUTING_EXAMPLES: RoutingExample[] = [
  { label: 'Mensch verlangt', description: 'Wenn der Anrufer ausdrücklich mit einem Menschen sprechen will', action: 'transfer' },
  { label: 'Dringend', description: 'Wenn der Anrufer ein dringendes Anliegen meldet, das sofort jemand prüfen muss', action: 'transfer' },
  { label: 'Nicht lösbar', description: 'Wenn Chipy das Anliegen nicht sicher klären kann und ein Rückruf nötig ist', action: 'ticket' },
];

const ROUTING_EXAMPLES = GENERIC_ROUTING_EXAMPLES.map((example) => (
  `${example.description} → ${example.action === 'transfer' ? 'Weiterleiten + Ticket-Fallback' : example.action === 'ticket' ? 'Ticket erstellen' : 'Höflich auflegen'}`
));

const INDUSTRY_ROUTING_EXAMPLES: Record<string, RoutingExample[]> = {
  hairdresser: [
    { label: 'Wunschfriseur / Mensch', description: 'Wenn der Kunde ausdrücklich mit einem Friseur oder dem Salon sprechen will', action: 'transfer' },
    { label: 'Farbe, Allergie, Kopfhaut', description: 'Wenn der Kunde nach Farbe, Chemie, Allergie oder starken Kopfhaut-Beschwerden dringend Hilfe braucht', action: 'transfer' },
    { label: 'Kurzfristige Terminänderung', description: 'Wenn ein Termin heute sehr kurzfristig geändert oder abgesagt werden muss und das Team entscheiden soll', action: 'ticket' },
  ],
  tradesperson: [
    { label: 'Notdienst', description: 'Wenn der Anrufer Wasserschaden, Gasgeruch, Stromausfall oder einen akuten Schaden meldet', action: 'transfer' },
    { label: 'Mensch verlangt', description: 'Wenn der Kunde sofort mit Monteur, Meister oder Büro sprechen will', action: 'transfer' },
    { label: 'Unklarer Auftrag', description: 'Wenn Chipy den Schaden nicht sicher einordnen kann und ein Rückruf nötig ist', action: 'ticket' },
  ],
  cleaning: [
    { label: 'Schlüssel / Zugang', description: 'Wenn es um Schlüsselübergabe, Zugang zum Objekt oder akute Probleme vor Ort geht', action: 'transfer' },
    { label: 'Großer Auftrag', description: 'Wenn der Kunde eine Sonderreinigung, Bauendreinigung oder gewerbliches Angebot besprechen will', action: 'ticket' },
    { label: 'Beschwerde', description: 'Wenn der Kunde mit einer Reinigung unzufrieden ist und Rücksprache möchte', action: 'transfer' },
  ],
  restaurant: [
    { label: 'Große Gruppe', description: 'Wenn der Gast für eine größere Gruppe, Feier oder Veranstaltung anfragt', action: 'ticket' },
    { label: 'Allergie / Sonderfall', description: 'Wenn es um starke Allergien, Unverträglichkeiten oder eine kritische Rückfrage zur Küche geht', action: 'transfer' },
    { label: 'Reservierung heute', description: 'Wenn eine Reservierung sehr kurzfristig geändert werden muss', action: 'transfer' },
  ],
  auto: [
    { label: 'Panne / Sicherheit', description: 'Wenn der Kunde eine Panne, Warnleuchte, Bremsproblem oder ein Sicherheitsproblem meldet', action: 'transfer' },
    { label: 'Meister sprechen', description: 'Wenn der Kunde ausdrücklich Werkstattmeister oder Serviceberater sprechen will', action: 'transfer' },
    { label: 'Kostenvoranschlag', description: 'Wenn eine fachliche Einschätzung oder ein Kostenvoranschlag gebraucht wird', action: 'ticket' },
  ],
  solo: [
    { label: 'Akut / sensibel', description: 'Wenn der Anrufer ein sensibles oder sehr dringendes Anliegen direkt besprechen muss', action: 'transfer' },
    { label: 'Fachliche Grenze', description: 'Wenn es um medizinische, rechtliche, steuerliche oder therapeutische Beratung geht', action: 'ticket' },
    { label: 'Persönlicher Rückruf', description: 'Wenn der Anrufer ausdrücklich einen persönlichen Rückruf möchte', action: 'ticket' },
  ],
};

function routingExamplesForConfig(config: AgentConfig): RoutingExample[] {
  const industry = (config.industry ?? '').toLowerCase();
  if (config.customerModule?.enabled) return INDUSTRY_ROUTING_EXAMPLES.hairdresser ?? GENERIC_ROUTING_EXAMPLES;
  const configured = INDUSTRY_ROUTING_EXAMPLES[industry];
  if (configured) return configured;

  const haystack = `${config.businessDescription ?? ''} ${config.servicesText ?? ''}`.toLowerCase();
  if (/friseur|salon|haar|farbe|kopfhaut/.test(haystack)) return INDUSTRY_ROUTING_EXAMPLES.hairdresser ?? GENERIC_ROUTING_EXAMPLES;
  if (/handwerk|sanitär|sanitaer|heizung|elektro|notdienst|wasserschaden/.test(haystack)) return INDUSTRY_ROUTING_EXAMPLES.tradesperson ?? GENERIC_ROUTING_EXAMPLES;
  if (/reinigung|gebäude|gebaeude|umzug|fensterreinigung/.test(haystack)) return INDUSTRY_ROUTING_EXAMPLES.cleaning ?? GENERIC_ROUTING_EXAMPLES;
  if (/restaurant|reservierung|küche|kueche|tisch|speisekarte/.test(haystack)) return INDUSTRY_ROUTING_EXAMPLES.restaurant ?? GENERIC_ROUTING_EXAMPLES;
  if (/werkstatt|auto|kfz|reifen|inspektion|tüv|tuev/.test(haystack)) return INDUSTRY_ROUTING_EXAMPLES.auto ?? GENERIC_ROUTING_EXAMPLES;
  return GENERIC_ROUTING_EXAMPLES;
}

function routingExamplesLabel(config: AgentConfig): string {
  const industry = (config.industry ?? '').toLowerCase();
  const haystack = `${config.businessDescription ?? ''} ${config.servicesText ?? ''}`.toLowerCase();
  if (industry === 'hairdresser' || config.customerModule?.enabled || /friseur|salon|haar|farbe|kopfhaut/.test(haystack)) return 'Friseur-Vorlagen';
  if (industry === 'tradesperson' || /handwerk|sanitär|sanitaer|heizung|elektro|notdienst|wasserschaden/.test(haystack)) return 'Handwerker-Vorlagen';
  if (industry === 'cleaning' || /reinigung|gebäude|gebaeude|umzug|fensterreinigung/.test(haystack)) return 'Reinigungs-Vorlagen';
  if (industry === 'restaurant' || /restaurant|reservierung|küche|kueche|tisch|speisekarte/.test(haystack)) return 'Restaurant-Vorlagen';
  if (industry === 'auto' || /werkstatt|auto|kfz|reifen|inspektion|tüv|tuev/.test(haystack)) return 'Werkstatt-Vorlagen';
  if (industry === 'solo') return 'Business-Vorlagen';
  return 'Vorlagen';
}

type PhoneInfoItem = { number: string; customerNumber?: string; forwardingType?: 'always' | 'no_answer'; verified?: boolean };

function HandoffDecisionEditor({ config, onUpdate, phoneInfo = [] }: { config: AgentConfig; onUpdate: (p: Partial<AgentConfig>) => void; phoneInfo?: PhoneInfoItem[] }) {
  const routingRules = config.callRoutingRules ?? [];
  const fallback: FallbackPatch = {
    ...(config.fallback ?? { enabled: true, reason: DEFAULT_FALLBACK_REASON, reasons: DEFAULT_FALLBACK_REASONS }),
    reason: normalizeFallbackReasonValue(config.fallback?.reason),
  };
  const reasons = mergeFallbackReasons(fallback.reasons);
  const ticketToolActive = config.tools.includes('ticket.create');
  const activeTransferCount = routingRules.filter((rule) => (
    rule.enabled !== false && rule.action === 'transfer' && Boolean(rule.target?.trim())
  )).length;
  const activeTicketCount = fallback.enabled ? reasons.filter((reason) => reason.enabled !== false).length : 0;
  const routingExamples = routingExamplesForConfig(config);
  const routingTemplateLabel = routingExamplesLabel(config);

  const ACTION_OPTIONS: { id: Exclude<CallRoutingRule['action'], 'voicemail'>; label: string; Icon: SectionIconComp; hint: string }[] = [
    { id: 'transfer',  label: 'Weiterleiten + Ticket-Fallback', Icon: IconPhoneOut, hint: 'Ruft zuerst eine echte Nummer oder Abteilung an; wenn niemand übernimmt, nutzt Chipy die passende Fallback-Regel.' },
    { id: 'ticket',    label: 'Ticket anlegen',    Icon: IconTicket, hint: 'Sammelt Daten und markiert den Grund.' },
    { id: 'hangup',    label: 'Beenden',           Icon: IconPhoneOff, hint: 'Verabschiedet sich und legt auf.' },
  ];

  const normalize = (n: string) => n.replace(/[\s\-()]/g, '');

  function getLoopWarning(target: string): { type: 'loop' | 'maybe_loop' | null; forwardingType?: 'always' | 'no_answer' } {
    const t = normalize(target);
    if (t.length < 5) return { type: null };

    if (phoneInfo.some(p => normalize(p.number) === t)) {
      return { type: 'loop' };
    }

    const matchedPhone = phoneInfo.find(p => p.customerNumber && normalize(p.customerNumber) === t);
    if (matchedPhone) {
      if (matchedPhone.verified && matchedPhone.forwardingType === 'always') {
        return { type: 'loop', forwardingType: 'always' };
      }
      if (matchedPhone.verified && matchedPhone.forwardingType === 'no_answer') {
        return { type: null, forwardingType: 'no_answer' };
      }
      return { type: 'maybe_loop' };
    }

    return { type: null };
  }

  function setRoutingRules(items: CallRoutingRule[]) {
    onUpdate({ callRoutingRules: items });
  }

  function patchRouting(index: number, patch: Partial<CallRoutingRule>) {
    const next = [...routingRules];
    next[index] = { ...next[index], ...patch } as CallRoutingRule;
    setRoutingRules(next);
  }

  function addRoutingRule(seed?: Partial<CallRoutingRule>) {
    setRoutingRules([
      ...routingRules,
      {
        id: crypto.randomUUID(),
        description: seed?.description ?? '',
        action: seed?.action ?? 'transfer',
        target: seed?.target ?? '',
        enabled: seed?.enabled ?? true,
      },
    ]);
  }

  function removeRoutingRule(index: number) {
    setRoutingRules(routingRules.filter((_, currentIndex) => currentIndex !== index));
  }

  function updateFallback(patch: Partial<FallbackPatch>) {
    onUpdate({ fallback: { ...fallback, ...patch } });
  }

  function updateReason(id: string, patch: Partial<FallbackReasonConfig>) {
    updateFallback({
      reasons: reasons.map((reason) => reason.id === id ? { ...reason, ...patch } : reason),
    });
  }

  function updateReasonName(id: string, value: string) {
    updateReason(id, { label: value, reason: value });
  }

  function addCustomReason() {
    updateFallback({
      reasons: [
        ...reasons,
        {
          id: `custom_${crypto.randomUUID()}`,
          label: 'Eigener Übergabefall',
          reason: fallback.reason || DEFAULT_FALLBACK_REASON,
          enabled: true,
          priority: 'normal',
          instruction: '',
        },
      ],
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[1.4rem] border border-white/[0.09] bg-gradient-to-br from-white/[0.07] via-white/[0.03] to-cyan-400/[0.045] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Übergabe an Menschen</p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/45">
              {activeTransferCount > 0
                ? 'Reihenfolge: zuerst live anrufen. Wenn niemand erreichbar ist, die Weiterleitung scheitert oder keine Regel passt, legt Chipy ein passendes Ticket an.'
                : 'Aktuell ist keine Live-Übergabe mit Zielnummer aktiv. Chipy legt Tickets an, bis du eine Übergabe-Regel mit Zielnummer hinzufügst.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
            <span className="rounded-full border border-orange-300/25 bg-orange-400/10 px-2.5 py-1 text-orange-100/80">
              {activeTransferCount > 0 ? `${activeTransferCount} Live-Ziele aktiv` : 'Keine Live-Übergabe'}
            </span>
            <span className={`rounded-full border px-2.5 py-1 ${
              fallback.enabled
                ? 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100/80'
                : 'border-white/[0.10] bg-white/[0.03] text-white/40'
            }`}>
              {fallback.enabled ? `${activeTicketCount} Fallback-Regeln aktiv` : 'Ticket-Fallback aus'}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.55fr)]">
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">Ticketname für Restfälle</span>
            <Input
              value={fallback.reason}
              onChange={(event) => updateFallback({ reason: event.target.value })}
              placeholder="z.B. Allgemeine Übergabe"
              className="mt-1"
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-white/35">
              Wird im Posteingang angezeigt, wenn keine genauere Fallback-Regel unten passt.
            </span>
          </label>
          <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3">
            <Toggle
              checked={fallback.enabled}
              onChange={(enabled) => updateFallback({ enabled })}
              label={fallback.enabled ? 'Ticket anlegen, wenn niemand übernimmt' : 'Keine Fallback-Tickets'}
            />
            <p className="mt-2 text-[11px] leading-relaxed text-white/38">
              So endet ein Anruf nicht in einer Sackgasse, wenn der Mensch nicht rangeht oder die Übergabe nicht möglich ist.
            </p>
          </div>
        </div>

        {!ticketToolActive && fallback.enabled && (
          <div className="mt-3 rounded-xl border border-orange-300/20 bg-orange-400/10 px-3 py-2 text-xs text-orange-100/80">
            Fallback-Regeln sind vorbereitet, aber das Ticket-Tool ist noch aus. Aktiviere es bei den Fähigkeiten, wenn Chipy wirklich Tickets anlegen soll.
          </div>
        )}
      </div>

      {routingRules.length === 0 && reasons.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.03] p-4 text-sm text-white/45">
          Noch keine Übergabe-Situationen. Lege unten eine Übergabe-Regel oder Fallback-Regel an.
        </div>
      )}

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">{routingTemplateLabel}</p>
            <p className="text-[11px] text-white/32">Weiterleiten + Ticket-Fallback</p>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {routingExamples.slice(0, 3).map((example) => {
              return (
                <button
                  key={`${example.label}-${example.description}`}
                  type="button"
                  onClick={() => addRoutingRule({
                    description: example.description,
                    action: example.action,
                    target: example.target ?? '',
                  })}
                  className="rounded-xl border border-white/[0.08] bg-black/15 px-3 py-2 text-left text-xs leading-relaxed text-white/45 transition-colors hover:border-orange-300/25 hover:text-orange-100/80"
                >
                  <span className="block font-semibold text-white/65">{example.label}</span>
                  <span className="mt-1 block">{example.description} → {example.action === 'transfer' ? 'Weiterleiten + Ticket-Fallback' : example.action === 'ticket' ? 'Ticket anlegen' : 'Beenden'}</span>
                </button>
              );
            })}
          </div>
        </div>

      <div className="space-y-3">
        {routingRules.map((rule, index) => {
          const action = rule.action === 'voicemail'
            ? {
                id: 'voicemail' as const,
                label: 'Mailbox nicht aktiv',
                Icon: IconMicUpload,
                hint: 'Diese alte Regel ist nicht mit einem Tool verbunden. Wähle Ticket oder Beenden.',
              }
            : ACTION_OPTIONS.find((item) => item.id === rule.action) ?? {
                id: 'transfer' as const,
                label: 'Weiterleiten + Ticket-Fallback',
                Icon: IconPhoneOut,
                hint: 'Ruft zuerst eine echte Nummer oder Abteilung an; wenn niemand übernimmt, nutzt Chipy die passende Fallback-Regel.',
              };
          const warn = rule.action === 'transfer' && rule.target ? getLoopWarning(rule.target) : { type: null };
          return (
            <div
              key={rule.id}
              className={`rounded-[1.35rem] border p-4 transition-all ${
                rule.enabled
                  ? 'border-orange-300/18 bg-orange-400/[0.045]'
                  : 'border-white/[0.07] bg-black/15 opacity-65'
              }`}
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-orange-300/20 bg-orange-400/10 text-orange-100">
                    <action.Icon size={14} />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-white/80">Übergabe-Regel</p>
                    <p className="text-[11px] text-white/35">{action.hint}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle checked={rule.enabled} onChange={(enabled) => patchRouting(index, { enabled })} label={rule.enabled ? 'Aktiv' : 'Aus'} />
                  <button
                    type="button"
                    onClick={() => removeRoutingRule(index)}
                    className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold text-white/35 transition-colors hover:border-red-300/25 hover:text-red-200"
                  >
                    Entfernen
                  </button>
                </div>
              </div>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">Wenn der Anrufer...</span>
                <AdaptiveTextarea
                  value={rule.description}
                  onChange={(event) => patchRouting(index, { description: event.target.value })}
                  placeholder="z.B. nach einem Menschen fragt, wütend ist oder einen echten Notfall meldet"
                  minRows={2}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm leading-relaxed text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none"
                />
              </label>

              <div className="mt-3">
                <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">Dann macht Chipy...</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ACTION_OPTIONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => patchRouting(index, { action: item.id })}
                      className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                        rule.action === item.id
                          ? 'border-orange-300/35 bg-orange-400/15 text-orange-100'
                          : 'border-white/[0.08] bg-white/[0.03] text-white/45 hover:border-white/[0.16] hover:text-white/70'
                      }`}
                    >
                      <item.Icon size={13} />
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {rule.action === 'transfer' && (
                <div className="mt-3 space-y-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">Wen soll Chipy zuerst anrufen?</span>
                    <Input
                      value={rule.target ?? ''}
                      onChange={(event) => patchRouting(index, { target: event.target.value })}
                      placeholder="+49 170 1234567 oder Abteilung"
                      className={`mt-1 ${warn.type ? '!border-amber-500/50' : ''}`}
                    />
                  </label>
                  <div className="rounded-xl border border-cyan-300/16 bg-cyan-400/[0.07] px-3 py-2 text-xs leading-relaxed text-cyan-100/78">
                    Wenn niemand rangeht oder die Weiterleitung nicht klappt, nutzt Chipy danach die passendste Fallback-Regel unten.
                  </div>
                  {warn.type === 'loop' && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-200/90">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>Endlosschleife erkannt.</strong>
                        <ForwardingHint />
                      </div>
                      <p className="mt-1">
                        {warn.forwardingType === 'always'
                          ? 'Diese Nummer leitet immer zu Phonbot weiter. Ein Transfer hierhin ruft den Agenten wieder selbst an.'
                          : 'Diese Nummer ist eine Phonbot-Eingangsnummer. Ein Transfer hierhin ruft den Agenten wieder selbst an.'}
                      </p>
                    </div>
                  )}
                  {warn.type === 'maybe_loop' && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100/85">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>Mögliche Schleife.</strong>
                        <ForwardingHint />
                      </div>
                      <p className="mt-1">
                        Diese Nummer wurde noch nicht als sichere Weiterleitung geprüft. Teste sie im Telefon-Tab, bevor du sie als Transferziel nutzt.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {rule.action === 'ticket' && (
                <div className="mt-3 rounded-xl border border-cyan-300/16 bg-cyan-400/[0.07] px-3 py-2 text-xs leading-relaxed text-cyan-100/78">
                  Für reine Rückruf-Fälle nutzt Chipy die Fallback-Regeln unten direkt, ohne vorher einen Menschen anzurufen.
                </div>
              )}

              {rule.action === 'voicemail' && (
                <div className="mt-3 rounded-xl border border-amber-300/18 bg-amber-400/[0.08] px-3 py-2 text-xs leading-relaxed text-amber-100/85">
                  Mailbox war eine alte Auswahl, ist aber nicht als zuverlässige Agent-Funktion verdrahtet. Bitte stelle diese Regel auf Ticket anlegen oder Beenden um.
                </div>
              )}
            </div>
          );
        })}

        {reasons.map((reason) => {
          const active = reason.enabled !== false;
          const priority = reason.priority ?? 'normal';
          const isCustom = reason.id.startsWith('custom_');
          return (
            <div
              key={reason.id}
              className={`rounded-[1.35rem] border p-4 transition-all ${
                fallback.enabled && active
                  ? 'border-cyan-300/18 bg-cyan-400/[0.045]'
                  : 'border-white/[0.07] bg-black/15 opacity-65'
              }`}
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
                    <IconTicket size={14} />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-white/80">Fallback-Regel</p>
                    <p className="text-[11px] text-white/35">Greift als Ticket, wenn kein Mensch übernimmt oder keine Weiterleitung passt.</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                    priority === 'urgent'
                      ? 'border-red-300/30 bg-red-400/10 text-red-100/80'
                      : priority === 'high'
                        ? 'border-orange-300/30 bg-orange-400/10 text-orange-100/80'
                        : 'border-white/[0.10] bg-white/[0.04] text-white/45'
                  }`}>
                    {PRIORITY_LABELS[priority]}
                  </span>
                  <Toggle checked={active} onChange={(enabled) => updateReason(reason.id, { enabled })} label={active ? 'Aktiv' : 'Aus'} />
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => updateFallback({ reasons: reasons.filter((item) => item.id !== reason.id) })}
                      className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold text-white/35 transition-colors hover:border-red-300/25 hover:text-red-200"
                    >
                      Entfernen
                    </button>
                  )}
                </div>
              </div>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">Ticketname</span>
                <Input
                  value={reason.reason || reason.label}
                  onChange={(event) => updateReasonName(reason.id, event.target.value)}
                  className="mt-1"
                />
                <span className="mt-1 block text-[11px] leading-relaxed text-white/35">
                  Dieser Name erscheint genau so im Posteingang.
                </span>
              </label>

              <label className="mt-3 block">
                <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">Wann soll Chipy diese Regel nutzen?</span>
                <AdaptiveTextarea
                  value={reason.instruction ?? ''}
                  onChange={(event) => updateReason(reason.id, { instruction: event.target.value })}
                  minRows={2}
                  placeholder="Beschreibe klare Signale, Beispiele oder Grenzen für diese Fallback-Regel."
                  className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm leading-relaxed text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 outline-none"
                />
              </label>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => addRoutingRule()}
          className="rounded-[1.1rem] border border-dashed border-orange-300/22 bg-orange-400/[0.045] px-4 py-3 text-sm font-semibold text-orange-100/80 transition-colors hover:border-orange-300/42 hover:bg-orange-400/[0.08]"
        >
          + Übergabe-Regel hinzufügen
        </button>
        <button
          type="button"
          onClick={addCustomReason}
          className="rounded-[1.1rem] border border-dashed border-cyan-300/22 bg-cyan-400/[0.045] px-4 py-3 text-sm font-semibold text-cyan-100/80 transition-colors hover:border-cyan-300/42 hover:bg-cyan-400/[0.08]"
        >
          + Fallback-Regel hinzufügen
        </button>
      </div>
    </div>
  );
}

function CallRoutingEditor({ items, onChange, phoneInfo = [] }: { items: CallRoutingRule[]; onChange: (v: CallRoutingRule[]) => void; phoneInfo?: PhoneInfoItem[] }) {
  const normalize = (n: string) => n.replace(/[\s\-()]/g, '');

  /**
   * Check if the transfer target would cause a loop.
   *
   * Inputs:
   *   - phoneInfo entries with verified=true → forwarding to Phonbot was
   *     CONFIRMED via /phone/verify-forwarding loop test
   *   - forwardingType ∈ {'always','no_answer'} is also set on confirmed entries
   *
   * Decisions:
   *   - target equals a Phonbot inbound  → definite loop
   *   - target equals a verified customer_number with type 'always'
   *                                      → definite loop
   *   - target equals a verified customer_number with type 'no_answer'
   *                                      → safe (Phonbot hangs up before
   *                                        the carrier triggers forwarding)
   *   - target equals an UNverified customer_number
   *                                      → maybe-loop warning, prompt user to
   *                                        run the test
   */
  function getLoopWarning(target: string): { type: 'loop' | 'maybe_loop' | null; forwardingType?: 'always' | 'no_answer' } {
    const t = normalize(target);
    if (t.length < 5) return { type: null };

    // Direct match: target IS one of the Phonbot numbers
    if (phoneInfo.some(p => normalize(p.number) === t)) {
      return { type: 'loop' };
    }

    const matchedPhone = phoneInfo.find(p => p.customerNumber && normalize(p.customerNumber) === t);
    if (matchedPhone) {
      if (matchedPhone.verified && matchedPhone.forwardingType === 'always') {
        return { type: 'loop', forwardingType: 'always' };
      }
      if (matchedPhone.verified && matchedPhone.forwardingType === 'no_answer') {
        return { type: null, forwardingType: 'no_answer' }; // safe
      }
      // Unverified customer_number record (legacy or old verify-forwarding fail)
      return { type: 'maybe_loop' };
    }

    return { type: null };
  }
  function add() {
    onChange([...items, {
      id: crypto.randomUUID(),
      description: '',
      action: 'transfer',
      target: '',
      enabled: true,
    }]);
  }

  function patch(i: number, p: Partial<CallRoutingRule>) {
    const next = [...items];
    next[i] = { ...next[i], ...p } as CallRoutingRule;
    onChange(next);
  }

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
  }

  const ACTION_OPTIONS: { id: CallRoutingRule['action']; label: string; Icon: SectionIconComp }[] = [
    { id: 'transfer',  label: 'Weiterleiten',    Icon: IconPhoneOut },
    { id: 'hangup',    label: 'Auflegen',         Icon: IconPhoneOff },
    { id: 'voicemail', label: 'Mailbox',          Icon: IconMicUpload },
    { id: 'ticket',    label: 'Ticket',           Icon: IconTicket },
  ];

  return (
    <div className="space-y-3">
      {/* Examples hint */}
      {items.length === 0 && (
        <div className="bg-white/5 rounded-xl p-4 space-y-2">
          <span className="text-xs font-medium text-white/40">Beispiele:</span>
          <div className="space-y-1">
            {ROUTING_EXAMPLES.slice(0, 3).map((ex, i) => (
              <button key={i} onClick={() => {
                const parts = ex.split(' → ');
                onChange([...items, {
                  id: crypto.randomUUID(),
                  description: parts[0] ?? '',
                  action: ex.includes('auflegen') ? 'hangup' as const : ex.includes('Ticket') ? 'ticket' as const : 'transfer' as const,
                  target: parts[1] ?? '',
                  enabled: true,
                }]);
              }}
                className="block w-full text-left text-xs text-white/40 hover:text-orange-300 transition-colors py-1 px-2 rounded hover:bg-white/5">
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {items.map((rule, i) => (
        <div key={rule.id} className="bg-white/5 rounded-xl px-4 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <Toggle checked={rule.enabled} onChange={(v) => patch(i, { enabled: v })} label="" />
            <div className="flex-1 space-y-3">
              <AdaptiveTextarea
                value={rule.description}
                onChange={(e) => patch(i, { description: e.target.value })}
                placeholder="Beschreibe die Situation in natürlicher Sprache… z.B. 'Wenn der Kunde nach dem Geschäftsführer fragt'"
                minRows={2}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none"
              />
              <div className="flex gap-3 items-center">
                <span className="text-xs text-white/50 shrink-0">Dann →</span>
                <div className="flex gap-2">
                  {ACTION_OPTIONS.map((act) => (
                    <button key={act.id} onClick={() => patch(i, { action: act.id })}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        rule.action === act.id
                          ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                          : 'bg-white/5 text-white/50 border border-white/10 hover:border-white/20'
                      }`}>
                      <act.Icon size={12} /> {act.label}
                    </button>
                  ))}
                </div>
              </div>
              {(rule.action === 'transfer') && (
                <div className="space-y-2">
                  {(() => {
                    const warn = rule.target ? getLoopWarning(rule.target) : { type: null };
                    return (<>
                      <input
                        value={rule.target ?? ''}
                        onChange={(e) => patch(i, { target: e.target.value })}
                        placeholder="Ziel: Telefonnummer oder Abteilung (z.B. +49 170 1234567 oder 'Vertrieb')"
                        className={`w-full rounded-lg border bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none ${
                          warn.type ? 'border-amber-500/50' : 'border-white/10'
                        }`}
                      />
                      {warn.type === 'loop' && (
                        <div className="flex gap-2 items-start rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
                          <span className="text-red-400 text-sm shrink-0 mt-0.5">&#9888;</span>
                          <div className="text-xs text-red-300/90 leading-relaxed flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <strong>Endlosschleife!</strong>
                              <ForwardingHint />
                            </div>
                            <div className="mt-1">
                              {warn.forwardingType === 'always'
                                ? 'Diese Nummer hat eine „Immer weiterleiten"-Rufumleitung zu Phonbot. Ein Transfer hierhin erzeugt eine Endlosschleife.'
                                : 'Diese Nummer ist deine Phonbot-Nummer. Ein Transfer hierhin erzeugt eine Endlosschleife.'}
                            </div>
                            <span className="block mt-1.5 text-white/50">
                              <strong>Lösung:</strong> Trage deine <strong>Mobilnummer</strong> oder eine Nummer <strong>ohne Rufumleitung</strong> ein. Oder stelle auf &quot;Bei Nichtannahme&quot; um.
                            </span>
                          </div>
                        </div>
                      )}
                      {warn.type === 'maybe_loop' && (
                        <div className="flex gap-2 items-start rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5">
                          <span className="text-amber-400 text-sm shrink-0 mt-0.5">&#9888;</span>
                          <div className="text-xs text-amber-300/90 leading-relaxed flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <strong>Mögliche Schleife:</strong>
                              <ForwardingHint />
                            </div>
                            <div className="mt-1">
                              Diese Nummer wurde noch nicht als Weiterleitung zu Phonbot bestätigt. Im Telefon-Tab den „Weiterleitung testen"-Button drücken — wenn die Weiterleitung auf „Immer" steht, entsteht eine Endlosschleife.
                            </div>
                          </div>
                        </div>
                      )}
                    </>);
                  })()}
                </div>
              )}
            </div>
            <button onClick={() => remove(i)} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer mt-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          </div>
        </div>
      ))}

      <button onClick={add}
        className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/30 rounded-xl py-3 text-sm text-white/40 hover:text-orange-400 transition-all">
        + Neue Regel hinzufügen
      </button>
    </div>
  );
}

type FallbackPatch = AgentConfig['fallback'];

const PRIORITY_LABELS: Record<NonNullable<FallbackReasonConfig['priority']>, string> = {
  normal: 'Normal',
  high: 'Hoch',
  urgent: 'Dringend',
};

const LEGACY_FALLBACK_INSTRUCTIONS: Record<string, string> = {
  human_requested: 'Wenn der Anrufer klar mit einem Menschen sprechen will, nicht diskutieren: Rueckruf-Ticket oder konfigurierte Weiterleitung.',
  urgent_or_emergency: 'Bei Gefahr, Schmerzen, Ausfall oder akutem Problem sofort als dringend markieren und keine langen Nachfragen stellen.',
};

function normalizeFallbackReason(reason: FallbackReasonConfig): FallbackReasonConfig {
  return {
    ...reason,
    enabled: reason.enabled !== false,
    priority: reason.priority ?? 'normal',
    instruction: reason.instruction ?? '',
  };
}

function mergeFallbackReasons(reasons: FallbackReasonConfig[] | undefined): FallbackReasonConfig[] {
  const merged = new Map(DEFAULT_FALLBACK_REASONS.map((reason) => [reason.id, normalizeFallbackReason(reason)]));
  for (const reason of reasons ?? []) {
    if (!reason?.id) continue;
    const base = merged.get(reason.id);
    const next = base ? { ...base, ...reason } : reason;
    if (base && reason.instruction === LEGACY_FALLBACK_INSTRUCTIONS[reason.id]) {
      next.instruction = base.instruction;
    }
    merged.set(reason.id, normalizeFallbackReason(next));
  }
  return [...merged.values()];
}

function FallbackMatrixBlock({ config, onUpdate }: { config: AgentConfig; onUpdate: (p: Partial<AgentConfig>) => void }) {
  const fallback: FallbackPatch = {
    ...(config.fallback ?? { enabled: true, reason: DEFAULT_FALLBACK_REASON, reasons: DEFAULT_FALLBACK_REASONS }),
    reason: normalizeFallbackReasonValue(config.fallback?.reason),
  };
  const reasons = mergeFallbackReasons(fallback.reasons);
  const activeCount = reasons.filter((reason) => reason.enabled !== false).length;
  const ticketToolActive = config.tools.includes('ticket.create');

  function updateFallback(patch: Partial<FallbackPatch>) {
    onUpdate({ fallback: { ...fallback, ...patch } });
  }

  function updateReason(id: string, patch: Partial<FallbackReasonConfig>) {
    updateFallback({
      reasons: reasons.map((reason) => reason.id === id ? { ...reason, ...patch } : reason),
    });
  }

  function addCustomReason() {
    updateFallback({
      reasons: [
        ...reasons,
        {
          id: `custom_${Date.now()}`,
          label: 'Eigener Fall',
          reason: fallback.reason || DEFAULT_FALLBACK_REASON,
          enabled: true,
          priority: 'normal',
          instruction: '',
        },
      ],
    });
  }

  return (
    <div className={`rounded-2xl border p-4 transition-all ${
      fallback.enabled
        ? 'border-cyan-400/25 bg-cyan-400/[0.035]'
        : 'border-white/[0.08] bg-black/20'
    }`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-white/75">Notausgang / Ticket-Eskalation</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">
            Wenn kein Mensch übernimmt oder keine Übergabe passt, wählt Chipy den konkretesten Ticket-Grund.
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${
          ticketToolActive ? 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100/75' : 'border-orange-300/25 bg-orange-400/10 text-orange-100/80'
        }`}>
          {ticketToolActive ? `${activeCount} aktiv` : 'Ticket-Tool aus'}
        </span>
      </div>

      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <Toggle
          checked={fallback.enabled}
          onChange={(enabled) => updateFallback({ enabled })}
          label={fallback.enabled ? 'Automatischer Notausgang aktiv' : 'Automatischer Notausgang aus'}
        />
      </div>

      {fallback.enabled && (
        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">Allgemeiner Grund, wenn kein Fall passt</span>
            <Input
              value={fallback.reason}
              onChange={(event) => updateFallback({ reason: event.target.value })}
              placeholder="z.B. technische Beratung erforderlich"
              className="mt-1"
            />
          </label>

          <div className="grid gap-2">
            {reasons.map((reason) => {
              const active = reason.enabled !== false;
              const isCustom = reason.id.startsWith('custom_');
              const priority = reason.priority ?? 'normal';
              return (
                <div
                  key={reason.id}
                  className={`rounded-xl border p-3 transition-all ${
                    active
                      ? 'border-white/[0.10] bg-white/[0.045]'
                      : 'border-white/[0.06] bg-black/15 opacity-60'
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => updateReason(reason.id, { enabled: !active })}
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                        active
                          ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100'
                          : 'border-white/[0.10] bg-white/[0.03] text-white/35'
                      }`}
                    >
                      {active ? 'Aktiv' : 'Aus'}
                    </button>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
                      priority === 'urgent'
                        ? 'border-red-300/30 bg-red-400/10 text-red-100/80'
                        : priority === 'high'
                          ? 'border-orange-300/30 bg-orange-400/10 text-orange-100/80'
                          : 'border-white/[0.10] bg-white/[0.04] text-white/45'
                    }`}>
                      {PRIORITY_LABELS[priority]}
                    </span>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-white/30">Fall</span>
                      <Input
                        value={reason.label}
                        onChange={(event) => updateReason(reason.id, { label: event.target.value })}
                        className="mt-1 !text-xs"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-white/30">Ticket-Grund</span>
                      <Input
                        value={reason.reason}
                        onChange={(event) => updateReason(reason.id, { reason: event.target.value })}
                        className="mt-1 !text-xs"
                      />
                    </label>
                  </div>

                  <label className="mt-2 block">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-white/30">Agent-Regel</span>
                    <AdaptiveTextarea
                      value={reason.instruction ?? ''}
                      onChange={(event) => updateReason(reason.id, { instruction: event.target.value })}
                      minRows={2}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs leading-relaxed text-white placeholder:text-white/30 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 outline-none"
                    />
                  </label>

                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => updateFallback({ reasons: reasons.filter((item) => item.id !== reason.id) })}
                      className="mt-2 text-[10px] font-semibold text-red-300/70 hover:text-red-200"
                    >
                      Entfernen
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addCustomReason}
            className="w-full rounded-xl border border-dashed border-white/[0.12] bg-white/[0.025] px-3 py-2 text-xs font-semibold text-white/55 transition-colors hover:border-cyan-300/30 hover:text-cyan-100"
          >
            + Eigener Eskalationsfall
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Calendar Connector ── */

const CALENDAR_PROVIDERS: { id: 'google' | 'outlook' | 'calcom' | 'caldav'; Icon: SectionIconComp; name: string; desc: string }[] = [
  { id: 'google',  Icon: IconCalendar,    name: 'Google Calendar',     desc: 'Verbinde dein Google-Konto' },
  { id: 'outlook', Icon: IconBookOpen,    name: 'Microsoft Outlook',   desc: 'Outlook / Microsoft 365' },
  { id: 'calcom',  Icon: IconCheckCircle, name: 'Cal.com',             desc: 'Open-Source Terminbuchung' },
  { id: 'caldav',  Icon: IconWebhook,     name: 'CalDAV',              desc: 'Nextcloud, iCloud, etc.' },
];

function toUiCalendarProvider(provider: string): 'google' | 'outlook' | 'calcom' | null {
  if (provider === 'google') return 'google';
  if (provider === 'microsoft') return 'outlook';
  if (provider === 'calcom') return 'calcom';
  return null;
}

function toApiCalendarProvider(provider: string): 'google' | 'microsoft' | 'calcom' | undefined {
  if (provider === 'google') return 'google';
  if (provider === 'outlook' || provider === 'microsoft') return 'microsoft';
  if (provider === 'calcom') return 'calcom';
  return undefined;
}

function CalendarConnector({ integrations, onChange }: {
  integrations: AgentConfig['calendarIntegrations'] & {};
  onChange: (v: NonNullable<AgentConfig['calendarIntegrations']>) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [calcomKey, setCalcomKey] = useState('');
  const [showCalcomInput, setShowCalcomInput] = useState(false);
  const [, setServerConnection] = useState<CalendarStatus | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  // Load real calendar connection status from server
  const loadStatus = useCallback(async () => {
    try {
      const status = await getCalendarStatus();
      setServerConnection(status);
      // Sync server state into config integrations
      const connectedProviders = status.connections?.filter((conn) => conn.connected)
        ?? (status.connected && status.provider ? [{ provider: status.provider, email: status.email }] : []);
      if (connectedProviders.length) {
        const existing = integrations ?? [];
        let next = existing;
        for (const conn of connectedProviders) {
          const uiProvider = toUiCalendarProvider(conn.provider);
          if (!uiProvider) continue;
          const providerName = CALENDAR_PROVIDERS.find(p => p.id === uiProvider)?.name ?? conn.provider;
          const alreadyExists = next.find(c => c.provider === uiProvider || (uiProvider === 'outlook' && String(c.provider) === 'microsoft'));
          if (!alreadyExists) {
            next = [...next, {
              provider: uiProvider,
              connected: true,
              email: conn.email ?? undefined,
              label: providerName,
            }];
          } else if (!alreadyExists.connected || alreadyExists.email !== (conn.email ?? undefined)) {
            next = next.map(c => (
              c.provider === alreadyExists.provider
                ? { ...c, provider: uiProvider, connected: true, email: conn.email ?? undefined, label: providerName }
                : c
            ));
          }
        }
        if (next !== existing) {
          onChange(next);
        }
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function connectProvider(provider: typeof CALENDAR_PROVIDERS[number]['id']) {
    setLoading(true);
    try {
      if (provider === 'google') {
        const { url } = await getGoogleCalendarAuthUrl();
        window.open(url, '_blank', 'width=600,height=700');
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const s = await getCalendarStatus();
          if (s.connections?.some((conn) => conn.provider === 'google' && conn.connected) || (s.connected && s.provider === 'google')) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            void loadStatus();
          }
        }, 2000);
        if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = setTimeout(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, 120000);
      } else if (provider === 'outlook') {
        const { url } = await getMicrosoftCalendarAuthUrl();
        window.open(url, '_blank', 'width=600,height=700');
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const s = await getCalendarStatus();
          if (s.connections?.some((conn) => conn.provider === 'microsoft' && conn.connected) || (s.connected && s.provider === 'microsoft')) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            void loadStatus();
          }
        }, 2000);
        if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = setTimeout(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, 120000);
      } else if (provider === 'calcom') {
        setShowCalcomInput(true);
        setLoading(false);
        return;
      } else {
        // CalDAV — not yet supported
        setLoading(false);
        return;
      }
    } catch { /* error handled by UI */ }
    setLoading(false);
  }

  async function handleCalcomConnect() {
    if (!calcomKey.trim()) return;
    setLoading(true);
    try {
      const result = await connectCalcom(calcomKey.trim());
      if (result.ok) {
        setShowCalcomInput(false);
        setCalcomKey('');
        void loadStatus();
      }
    } catch { /* non-fatal */ }
    setLoading(false);
  }

  async function handleDisconnect(provider: string) {
    const apiProvider = toApiCalendarProvider(provider);
    if (!apiProvider) return;
    setLoading(true);
    try {
      await disconnectCalendar(apiProvider);
      setServerConnection(null);
      onChange((integrations ?? []).filter(c => c.provider !== provider && c.provider !== apiProvider));
    } catch { /* non-fatal */ }
    setLoading(false);
  }

  const connected = (integrations ?? []).filter(c => c.connected);
  // Inline disconnect confirmation — expands underneath the row instead of
  // popping a modal, matches the chipy-design "quiet motion" rule.
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* Cal.com API Key input (modal-ish banner when user picks cal.com) */}
      {showCalcomInput && (
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-4 space-y-3">
          <p className="text-sm text-white/70">Cal.com API Key eingeben:</p>
          <PasswordInput
            value={calcomKey}
            onChange={(e) => setCalcomKey(e.target.value)}
            placeholder="cal_live_..."
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
          />
          <div className="flex gap-2">
            <button onClick={handleCalcomConnect} disabled={loading || !calcomKey.trim()}
              className="px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50 cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
              {loading ? 'Verbinde…' : 'Verbinden'}
            </button>
            <button onClick={() => { setShowCalcomInput(false); setCalcomKey(''); }}
              className="px-4 py-2 rounded-lg text-xs text-white/50 hover:text-white/70 bg-white/5 cursor-pointer">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Unified provider grid — each provider appears exactly once. When
          connected the row shows the email + green status + inline Trennen
          action with a confirmation expand underneath. No separate
          "Connected calendars" section above anymore (was a duplicate). */}
      <div className="grid grid-cols-2 gap-3">
        {CALENDAR_PROVIDERS.map((prov) => {
          const isConnected = connected.find(
            c => c.provider === prov.id || (prov.id === 'outlook' && c.provider === ('microsoft' as string)),
          );
          const isCalDAV = prov.id === 'caldav';
          const isConfirming = confirmDisconnect === (isConnected?.provider ?? '');

          return (
            <div key={prov.id} className={`rounded-xl border transition-all ${
              isConnected
                ? 'border-green-500/25 bg-green-500/[0.06]'
                : isCalDAV
                  ? 'border-white/10 bg-white/5 opacity-40'
                  : 'border-white/10 bg-white/5 hover:border-orange-500/40 hover:bg-white/10'
            }`}>
              {/* Row body */}
              <div className="flex items-center gap-3 p-4">
                <prov.Icon size={18} className={isConnected ? 'text-green-400 shrink-0' : 'text-white/50 shrink-0'} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{prov.name}</p>
                  <p className="text-xs text-white/40 truncate">
                    {isConnected ? (isConnected.email ?? 'Verbunden') : isCalDAV ? 'Bald verfügbar' : prov.desc}
                  </p>
                </div>
                {isConnected ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="flex items-center gap-1 text-[11px] text-green-400/80 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />Verbunden
                    </span>
                    <button
                      onClick={() => setConfirmDisconnect(isConnected.provider)}
                      disabled={loading || isConfirming}
                      className="text-xs text-white/35 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer"
                    >
                      Trennen
                    </button>
                  </div>
                ) : !isCalDAV ? (
                  <button
                    onClick={() => connectProvider(prov.id)}
                    disabled={loading}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer transition-all hover:brightness-110"
                    style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                  >
                    Verbinden
                  </button>
                ) : null}
              </div>

              {/* Inline disconnect confirm — expands under the row.
                  Chipy-design: red-tinted glass strip, destructive action on
                  the right, abbrechen as ghost on the left. */}
              {isConfirming && isConnected && (
                <div className="px-4 pb-4 -mt-1 border-t border-red-500/15 pt-3">
                  <p className="text-xs text-white/70 mb-2.5 leading-relaxed">
                    <span className="text-red-300">Sicher trennen?</span> Dein Agent kann nach dem Trennen keine Termine mehr in <span className="text-white">{prov.name}</span> eintragen oder prüfen — bis du's wieder verbindest.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setConfirmDisconnect(null)}
                      className="rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={async () => {
                        await handleDisconnect(isConnected.provider);
                        setConfirmDisconnect(null);
                      }}
                      disabled={loading}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-200 bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {loading ? 'Trenne…' : 'Ja, trennen'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
        Nach der Verbindung kann dein Agent freie Termine prüfen, Buchungen erstellen und Kalender-Konflikte erkennen.
      </div>
    </div>
  );
}

/* API-Integration editor lives in WebhooksTab.tsx — moved 2026-04-23 so
 * the Fähigkeiten-Tab stays focused on the in-call capabilities (routing,
 * calendar, live-web), and Webhooks + APIs sit together as the outbound
 * system-to-system surface. */

/* ── Live Web Access Editor ── */

function LiveWebAccessEditor({ config, onChange }: { config: LiveWebAccess; onChange: (v: LiveWebAccess) => void }) {
  const [domainInput, setDomainInput] = useState('');

  function addDomain() {
    const domain = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || config.allowedDomains.includes(domain)) return;
    onChange({ ...config, allowedDomains: [...config.allowedDomains, domain] });
    setDomainInput('');
  }

  return (
    <div className="space-y-4">
      <Toggle checked={config.enabled} onChange={(v) => onChange({ ...config, enabled: v })}
        label="Live-Zugriff auf Webseiten aktivieren" />

      {config.enabled && (
        <>
          <div>
            <span className="text-sm font-medium text-white/70 block mb-2">Erlaubte Domains</span>
            <div className="flex flex-wrap gap-2 mb-3">
              {config.allowedDomains.map((domain, i) => (
                <span key={i} className="flex items-center gap-1.5 bg-white/10 text-white/80 text-sm px-3 py-1.5 rounded-full">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-white/40 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
                  {domain}
                  <button onClick={() => onChange({
                    ...config,
                    allowedDomains: config.allowedDomains.filter((_, j) => j !== i),
                  })} className="text-white/30 hover:text-red-400 cursor-pointer transition-colors"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </span>
              ))}
              {config.allowedDomains.length === 0 && (
                <span className="text-sm text-white/30">Keine Domains — Agent hat keinen Webzugriff</span>
              )}
            </div>
            <div className="flex gap-2">
              <input value={domainInput} onChange={(e) => setDomainInput(e.target.value)}
                placeholder="z.B. meine-firma.de"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain())} />
              <button onClick={addDomain}
                className="rounded-lg bg-white/10 border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/15 transition-colors">
                + Hinzufügen
              </button>
            </div>
          </div>

          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3 text-xs text-orange-300">
            Der Agent kann aktuelle Preise, Produktinfos oder Verfügbarkeiten direkt von deiner Website lesen — in Echtzeit während des Gesprächs.
          </div>
        </>
      )}
    </div>
  );
}

/* ForwardingHint is imported from ../ForwardingHint.js — shared with
 * PhoneManager so the same orange pill + speech-bubble shows up on both
 * the Agent-Builder routing rules AND the Phone-Tab forwarding setup.
 */
