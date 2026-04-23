import React, { useEffect, useRef, useState } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { TEMPLATES, type Template } from './templates.js';
import { deployAgentConfig, createWebCall, connectCalcom, getMicrosoftCalendarAuthUrl, getAccessToken, type AgentConfig } from '../../lib/api.js';
import { useWebCallCleanup } from '../../lib/use-web-call-cleanup.js';
import { FoxLogo } from '../FoxLogo.js';
import {
  IconStar, IconCalendar, IconPhone, IconCapabilities,
  IconScissors, IconWrench, IconBroom, IconSettings,
  IconTickets, IconAgent, IconDeploy, IconPhoneForward,
  IconRestaurant,
} from '../PhonbotIcons.js';
import { IconCar } from '../PhonbotIcons.js';

type IconComponent = React.ComponentType<{ size?: number; className?: string }>;
const TEMPLATE_CONFIG: Record<string, {
  Icon: IconComponent;
  accent: string;
  iconBg: string;
  hoverBorder: string;
  hoverGlow: string;
  selectedBorder: string;
  selectedGlow: string;
}> = {
  hairdresser: {
    Icon: IconScissors,
    accent: 'text-pink-300',
    iconBg: 'bg-pink-500/15',
    hoverBorder: 'hover:border-pink-500/40',
    hoverGlow: 'hover:shadow-[0_0_22px_rgba(236,72,153,0.18)]',
    selectedBorder: 'border-pink-500/60',
    selectedGlow: 'shadow-[0_0_22px_rgba(236,72,153,0.25)]',
  },
  tradesperson: {
    Icon: IconWrench,
    accent: 'text-orange-300',
    iconBg: 'bg-orange-500/15',
    hoverBorder: 'hover:border-orange-500/40',
    hoverGlow: 'hover:shadow-[0_0_22px_rgba(249,115,22,0.18)]',
    selectedBorder: 'border-orange-500/60',
    selectedGlow: 'shadow-[0_0_22px_rgba(249,115,22,0.25)]',
  },
  restaurant: {
    Icon: IconRestaurant,
    accent: 'text-amber-300',
    iconBg: 'bg-amber-500/15',
    hoverBorder: 'hover:border-amber-500/40',
    hoverGlow: 'hover:shadow-[0_0_22px_rgba(245,158,11,0.18)]',
    selectedBorder: 'border-amber-500/60',
    selectedGlow: 'shadow-[0_0_22px_rgba(245,158,11,0.25)]',
  },
  auto: {
    Icon: IconCar,
    accent: 'text-blue-300',
    iconBg: 'bg-blue-500/15',
    hoverBorder: 'hover:border-blue-500/40',
    hoverGlow: 'hover:shadow-[0_0_22px_rgba(59,130,246,0.18)]',
    selectedBorder: 'border-blue-500/60',
    selectedGlow: 'shadow-[0_0_22px_rgba(59,130,246,0.25)]',
  },
  cleaning: {
    Icon: IconBroom,
    accent: 'text-emerald-300',
    iconBg: 'bg-emerald-500/15',
    hoverBorder: 'hover:border-emerald-500/40',
    hoverGlow: 'hover:shadow-[0_0_22px_rgba(16,185,129,0.18)]',
    selectedBorder: 'border-emerald-500/60',
    selectedGlow: 'shadow-[0_0_22px_rgba(16,185,129,0.25)]',
  },
  custom: {
    Icon: IconSettings,
    accent: 'text-violet-300',
    iconBg: 'bg-violet-500/15',
    hoverBorder: 'hover:border-violet-500/40',
    hoverGlow: 'hover:shadow-[0_0_22px_rgba(139,92,246,0.18)]',
    selectedBorder: 'border-violet-500/60',
    selectedGlow: 'shadow-[0_0_22px_rgba(139,92,246,0.25)]',
  },
};

type Step = 'template' | 'details' | 'phone' | 'calendar' | 'test' | 'done';
type CallState = 'idle' | 'connecting' | 'active' | 'ended' | 'error';


type Props = {
  onComplete: () => void;
};

const AREA_CODES = [
  { code: '030', label: '030 – Berlin' },
  { code: '040', label: '040 – Hamburg' },
  { code: '089', label: '089 – München' },
  { code: '069', label: '069 – Frankfurt' },
  { code: '0211', label: '0211 – Düsseldorf' },
  { code: '0221', label: '0221 – Köln' },
  { code: '0711', label: '0711 – Stuttgart' },
  { code: '0341', label: '0341 – Leipzig' },
];

const OB_KEY = 'phonbot_onboarding';

function loadOnboardingState(): { step: Step; templateId?: string; deployedAgentId?: string; phoneDone?: boolean; calendarDone?: boolean; provisionedNumber?: string } | null {
  try {
    const raw = localStorage.getItem(OB_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveOnboardingState(data: { step: Step; templateId?: string; deployedAgentId?: string; phoneDone?: boolean; calendarDone?: boolean; provisionedNumber?: string }) {
  try { localStorage.setItem(OB_KEY, JSON.stringify(data)); } catch { /* non-fatal */ }
}

function clearOnboardingState() {
  try { localStorage.removeItem(OB_KEY); } catch { /* non-fatal */ }
}

export function OnboardingWizard({ onComplete }: Props) {
  const saved = loadOnboardingState();
  const [step, setStepRaw] = useState<Step>(saved?.step ?? 'template');
  const [template, setTemplate] = useState<Template | null>(
    saved?.templateId ? TEMPLATES.find(t => t.id === saved.templateId) ?? null : null,
  );
  const [form, setForm] = useState({
    businessName: '',
    address: '',
    openingHours: '',
    servicesText: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployedAgentId, setDeployedAgentId] = useState<string | null>(saved?.deployedAgentId ?? null);

  // Persist step changes
  function setStep(s: Step) {
    setStepRaw(s);
    saveOnboardingState({
      step: s,
      templateId: template?.id,
      deployedAgentId: deployedAgentId ?? undefined,
      phoneDone,
      calendarDone,
      provisionedNumber: provisionedNumber ?? undefined,
    });
  }

  // Phone step state
  const [areaCode, setAreaCode] = useState('030');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [provisionedNumber, setProvisionedNumber] = useState<string | null>(saved?.provisionedNumber ?? null);
  const [phoneDone, setPhoneDone] = useState(saved?.phoneDone ?? false);
  const [callMode, setCallMode] = useState<'direct' | 'backup' | 'always' | null>(null);
  const [selectedCarrier, setSelectedCarrier] = useState('telekom');
  const [copiedCode, setCopiedCode] = useState(false);

  // Calendar step state
  const [calcomApiKey, setCalcomApiKey] = useState('');
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarDone, setCalendarDone] = useState(saved?.calendarDone ?? false);
  const [calendarProvider, setCalendarProvider] = useState<string | null>(null);

  // Upgrade modal
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Test call state
  const [callState, setCallState] = useState<CallState>('idle');
  const [agentTalking, setAgentTalking] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const clientRef = useRef<RetellWebClient | null>(null);
  useWebCallCleanup(clientRef);

  // Check ?calendarConnected=true on mount (OAuth return)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendarConnected') === 'true') {
      setCalendarDone(true);
      setCalendarProvider('Google Calendar');
      setStep('calendar');
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete('calendarConnected');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  function selectTemplate(t: Template) {
    setTemplate(t);
    setForm({
      businessName: '',
      address: '',
      openingHours: t.defaults.openingHours,
      servicesText: t.defaults.servicesText,
    });
    setStep('details');
  }

  async function handleDeploy() {
    if (!template) return;
    setLoading(true);
    setError(null);
    try {
      const config: AgentConfig = {
        tenantId: '',
        name: template.defaults.name,
        language: template.defaults.language,
        voice: template.defaults.voice,
        businessName: form.businessName,
        businessDescription: template.defaults.businessDescription,
        address: form.address,
        openingHours: form.openingHours,
        servicesText: form.servicesText,
        systemPrompt: template.defaults.systemPrompt,
        tools: template.defaults.tools,
        fallback: { enabled: true, reason: 'handoff' },
      };
      const result = await deployAgentConfig(config);
      const agentId = result.retellAgentId ?? null;
      setDeployedAgentId(agentId);
      saveOnboardingState({ step: 'phone', templateId: template.id, deployedAgentId: agentId ?? undefined });
      setStepRaw('phone');
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Deployment fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  async function handleProvision() {
    setPhoneLoading(true);
    setPhoneError(null);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/phone/provision', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ areaCode }),
      });
      if (!res.ok) throw new Error(`Fehler ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const num = data.numberPretty ?? data.number;
      setProvisionedNumber(num);
      saveOnboardingState({ step: 'phone', templateId: template?.id, deployedAgentId: deployedAgentId ?? undefined, provisionedNumber: num });
      // Don't set phoneDone yet — user still needs to choose call mode in Phase 2
    } catch (e: unknown) {
      setPhoneError((e instanceof Error ? e.message : null) ?? 'Fehler beim Aktivieren');
    } finally {
      setPhoneLoading(false);
    }
  }

  async function handleCalcom() {
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      await connectCalcom(calcomApiKey);
      setCalendarProvider('Cal.com');
      setCalendarDone(true);
    } catch (e: unknown) {
      setCalendarError((e instanceof Error ? e.message : null) ?? 'Fehler beim Verbinden');
    } finally {
      setCalendarLoading(false);
    }
  }

  async function startTestCall() {
    setCallState('connecting');
    setCallError(null);
    try {
      const res = await createWebCall();
      if (!res.access_token) throw new Error(res.message ?? 'Kein access_token erhalten');

      const client = new RetellWebClient();
      clientRef.current = client;

      client.on('call_started', () => setCallState('active'));
      client.on('call_ended', () => { setCallState('ended'); setAgentTalking(false); });
      client.on('agent_start_talking', () => setAgentTalking(true));
      client.on('agent_stop_talking', () => setAgentTalking(false));
      client.on('error', (err: unknown) => {
        setCallError(String(err));
        setCallState('error');
        setAgentTalking(false);
      });

      await client.startCall({ accessToken: res.access_token });
    } catch (e: unknown) {
      setCallError((e instanceof Error ? e.message : null) ?? 'Fehler beim Starten');
      setCallState('error');
    }
  }

  function stopTestCall() {
    clientRef.current?.stopCall();
    clientRef.current = null;
    setCallState('ended');
    setAgentTalking(false);
  }

  const stepOrder: Step[] = ['template', 'details', 'phone', 'calendar', 'test', 'done'];
  const stepProgress: Record<Step, number> = {
    template: 1, details: 2, phone: 3, calendar: 4, test: 5, done: 6,
  };
  const stepLabels = ['Template', 'Details', 'Telefon', 'Kalender', 'Testen', 'Fertig'];
  const totalSteps = 6;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex flex-col items-center px-4 py-12 relative overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="glow-pulse absolute -top-40 left-1/2 -translate-x-1/2 w-[350px] sm:w-[700px] h-[350px] sm:h-[700px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.12) 0%, transparent 65%)' }}
        />
      </div>

      {/* Progress bar */}
      <div className="relative z-10 w-full max-w-2xl mb-10">
        <div className="flex justify-between text-xs text-white/30 mb-2.5">
          {stepLabels.map((label, i) => (
            <span
              key={label}
              className={
                stepProgress[step] > i + 1
                  ? 'text-orange-400 font-medium'
                  : stepProgress[step] === i + 1
                  ? 'text-white font-medium'
                  : ''
              }
            >
              {label}
            </span>
          ))}
        </div>
        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${(stepProgress[step] / totalSteps) * 100}%`,
              background: 'linear-gradient(to right, #F97316, #06B6D4)',
            }}
          />
        </div>
      </div>

      {/* ── Step: Template ── */}
      {step === 'template' && (
        <div className="relative z-10 w-full max-w-3xl">
          {/* Welcome hero */}
          <div className="text-center mb-10">
            <FoxLogo size="lg" glow animate className="mx-auto mb-5" />
            <h1 className="text-3xl font-bold mb-2 tracking-tight">Willkommen bei Phonbot</h1>
            <p className="text-white/40 text-sm max-w-md mx-auto leading-relaxed">
              Dein KI-Telefonagent ist in wenigen Minuten einsatzbereit. Wähle ein Template als Startpunkt.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TEMPLATES.map((t, i) => {
              const cfg = TEMPLATE_CONFIG[t.id];
              const Icon = cfg?.Icon ?? IconSettings;
              const isLast = i === TEMPLATES.length - 1;
              const isOddTotal = TEMPLATES.length % 3 !== 0;
              // Stretch last item to fill remaining columns if total is not divisible by 3
              const spanClass = isLast && isOddTotal
                ? TEMPLATES.length % 3 === 1 ? 'sm:col-span-2 lg:col-span-3' : 'lg:col-span-1'
                : '';
              return (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  className={`flex items-center gap-4 p-5 rounded-2xl border transition-all duration-200 text-left cursor-pointer group ${spanClass}`}
                  style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.07)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.3)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                >
                  <div className={`shrink-0 w-11 h-11 rounded-xl ${cfg?.iconBg ?? 'bg-white/10'}
                    flex items-center justify-center ${cfg?.accent ?? 'text-white/60'}
                    transition-all duration-200 group-hover:scale-110`}>
                    <Icon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white text-[13px] mb-0.5">{t.name}</h3>
                    <p className="text-[11px] text-white/35 leading-relaxed">{t.description}</p>
                  </div>
                  <svg className="shrink-0 text-white/15 group-hover:text-white/40 transition-colors"
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Step: Details ── */}
      {step === 'details' && template && (
        <div className="relative z-10 w-full max-w-lg">
          <h2 className="text-2xl font-bold text-center mb-2 flex items-center justify-center gap-2">
            {(() => { const cfg = TEMPLATE_CONFIG[template.id]; const Icon = cfg?.Icon ?? IconSettings; return <Icon size={22} className={cfg?.accent ?? 'text-white/60'} />; })()}
            Dein {template.name}
          </h2>
          <p className="text-white/50 text-center mb-8">
            Gib ein paar Basics ein. Dauert unter 2 Minuten.
          </p>

          <div className="glass rounded-2xl p-6 space-y-5">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                Name deines Unternehmens *
              </label>
              <input
                type="text"
                required
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                placeholder="z.B. Salon Müller"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30
                  focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                Adresse
              </label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="z.B. Hauptstraße 12, 10115 Berlin"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30
                  focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                Öffnungszeiten
              </label>
              <input
                type="text"
                value={form.openingHours}
                onChange={(e) => setForm({ ...form, openingHours: e.target.value })}
                placeholder="z.B. Mo-Fr 09:00–18:00, Sa 10:00–14:00"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30
                  focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5 uppercase tracking-wide">
                Angebotene Services
              </label>
              <textarea
                rows={3}
                value={form.servicesText}
                onChange={(e) => setForm({ ...form, servicesText: e.target.value })}
                placeholder="z.B. Herrenschnitt, Damenschnitt, Färben…"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30
                  focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all"
              />
            </div>

            {error && (
              <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</p>
            )}

            <div className="flex flex-col items-center gap-3 pt-2">
              <button
                onClick={handleDeploy}
                disabled={loading || !form.businessName.trim()}
                className="w-full rounded-xl px-4 py-3 font-semibold text-sm text-white disabled:opacity-50
                  transition-all duration-200 hover:scale-[1.01] cursor-pointer"
                style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 4px 24px rgba(249,115,22,0.2)' }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />
                    Agent wird erstellt…
                  </span>
                ) : (
                  'Agent erstellen & aktivieren'
                )}
              </button>
              <button
                onClick={() => setStep('template')}
                className="text-xs text-white/30 hover:text-white/60 transition-colors cursor-pointer"
              >
                ← Zurück zur Auswahl
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Phone ── */}
      {step === 'phone' && (
        <div className="relative z-10 w-full max-w-xl">
          <h2 className="text-2xl font-bold text-center mb-2 flex items-center justify-center gap-2">
            <IconPhone size={22} /> Telefon einrichten
          </h2>
          <p className="text-white/50 text-center mb-8">
            Dein Agent bekommt eine eigene Nummer — dann wählst du wie er erreichbar sein soll.
          </p>

          {/* Phase 1: Provision number */}
          {!provisionedNumber && !phoneDone && (
            <div className="rounded-2xl p-6 space-y-5" style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(6,182,212,0.1))' }}>
                  <IconPhone size={20} className="text-orange-400" />
                </div>
                <h3 className="font-semibold text-white text-sm">Eigene Telefonnummer aktivieren</h3>
                <p className="text-xs text-white/35 mt-1">Dein Agent bekommt eine deutsche Rufnummer (030 Berlin)</p>
              </div>

              {phoneError && (
                phoneError.includes('Starter') || phoneError.includes('upgrade') || phoneError.includes('Plan') ? (
                  <div className="rounded-xl p-4 text-center space-y-3" style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)' }}>
                    <p className="text-sm font-medium bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Telefonnummern sind ab dem Starter-Plan verfügbar</p>
                    <p className="text-xs text-white/35">Upgrade deinen Plan um eine eigene Nummer zu erhalten.</p>
                    <button
                      onClick={() => setShowUpgrade(true)}
                      className="text-xs font-medium bg-clip-text text-transparent hover:opacity-80 transition-opacity cursor-pointer"
                      style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                    >
                      Plan upgraden →
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                    {phoneError}
                  </p>
                )
              )}

              {!phoneError?.includes('Starter') && !phoneError?.includes('upgrade') && !phoneError?.includes('Plan') && (
                <button
                  onClick={handleProvision}
                  disabled={phoneLoading}
                  className="w-full rounded-xl px-4 py-3 font-semibold text-sm text-white disabled:opacity-50
                    transition-all duration-200 hover:scale-[1.01] cursor-pointer"
                  style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 4px 24px rgba(249,115,22,0.2)' }}
                >
                  {phoneLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />
                      Nummer wird aktiviert…
                    </span>
                  ) : (
                    'Nummer aktivieren'
                  )}
                </button>
              )}

              <button onClick={() => setStep('calendar')}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white/50 hover:text-white/80 transition-all cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Überspringen — später einrichten
              </button>
            </div>
          )}

          {/* Phase 2: Number provisioned → choose call mode */}
          {provisionedNumber && !phoneDone && (() => {
            const gsmNumber = provisionedNumber.replace(/\s/g, '');
            const gsmCode = callMode === 'always' ? `**21*${gsmNumber}#` : `**004*${gsmNumber}#`;
            const carriers = [
              { id: 'telekom', label: 'Telekom', sub: 'congstar · klarmobil · Aldi Talk' },
              { id: 'vodafone', label: 'Vodafone', sub: 'Callya · Otelo' },
              { id: 'o2', label: 'O2', sub: 'Telefónica · Blau · Fonic' },
              { id: 'other', label: '1&1 / andere', sub: '' },
            ];
            return (
              <>
                {/* Number display */}
                <div className="glass rounded-2xl p-4 mb-5 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center text-green-400 shrink-0">
                    <IconStar size={18} />
                  </div>
                  <div>
                    <p className="text-[11px] text-white/40 uppercase tracking-wide mb-0.5">Deine Phonbot-Nummer</p>
                    <p className="text-xl font-bold text-white">{provisionedNumber}</p>
                  </div>
                </div>

                {/* Step 2 header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-300 text-xs font-bold shrink-0">2</div>
                  <div>
                    <h3 className="font-semibold text-white">Wie soll dein Agent erreichbar sein?</h3>
                    <p className="text-xs text-white/40 mt-0.5">Wähle den Modus — du kannst ihn später ändern</p>
                  </div>
                </div>

                {/* Mode cards */}
                <div className="space-y-3 mb-5">
                  <button
                    onClick={() => setCallMode('direct')}
                    className={`w-full glass rounded-2xl p-5 flex items-start gap-4 text-left border-2 transition-all duration-300 cursor-pointer
                      ${callMode === 'direct'
                        ? 'border-orange-500/60 shadow-[0_0_22px_rgba(249,115,22,0.2)] bg-orange-500/5'
                        : 'border-transparent hover:border-white/20 hover:bg-white/[0.03]'}`}
                  >
                    <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300
                      ${callMode === 'direct' ? 'bg-orange-500/25 text-orange-300' : 'bg-white/8 text-white/50'}`}>
                      <IconPhone size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-white text-sm">Eigene Agent-Nummer</h4>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30">Empfohlen</span>
                      </div>
                      <p className="text-xs text-white/50 leading-relaxed">Kunden rufen die Phonbot-Nummer direkt an. Der Agent geht sofort ran. Keine Weiterleitung nötig.</p>
                    </div>
                    <div className={`shrink-0 w-5 h-5 rounded-full border-2 mt-0.5 flex-none transition-all ${callMode === 'direct' ? 'bg-orange-500 border-orange-500' : 'border-white/20'}`} />
                  </button>

                  <button
                    onClick={() => setCallMode('backup')}
                    className={`w-full glass rounded-2xl p-5 flex items-start gap-4 text-left border-2 transition-all duration-300 cursor-pointer
                      ${callMode === 'backup'
                        ? 'border-cyan-500/60 shadow-[0_0_22px_rgba(6,182,212,0.2)] bg-cyan-500/5'
                        : 'border-transparent hover:border-white/20 hover:bg-white/[0.03]'}`}
                  >
                    <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300
                      ${callMode === 'backup' ? 'bg-cyan-500/25 text-cyan-300' : 'bg-white/8 text-white/50'}`}>
                      <IconPhoneForward size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-white text-sm mb-1">Backup — wenn ich nicht rangehe</h4>
                      <p className="text-xs text-white/50 leading-relaxed">Du behältst deine Nummer. Wenn du besetzt bist, kein Empfang hast oder nicht abnimmst, springt der Agent ein.</p>
                      <p className="text-[11px] text-white/30 mt-1.5">Rufumleitung: Keine Antwort · Besetzt · Nicht erreichbar</p>
                    </div>
                    <div className={`shrink-0 w-5 h-5 rounded-full border-2 mt-0.5 flex-none transition-all ${callMode === 'backup' ? 'bg-cyan-500 border-cyan-500' : 'border-white/20'}`} />
                  </button>

                  <button
                    onClick={() => setCallMode('always')}
                    className={`w-full glass rounded-2xl p-5 flex items-start gap-4 text-left border-2 transition-all duration-300 cursor-pointer
                      ${callMode === 'always'
                        ? 'border-violet-500/60 shadow-[0_0_22px_rgba(139,92,246,0.2)] bg-violet-500/5'
                        : 'border-transparent hover:border-white/20 hover:bg-white/[0.03]'}`}
                  >
                    <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300
                      ${callMode === 'always' ? 'bg-violet-500/25 text-violet-300' : 'bg-white/8 text-white/50'}`}>
                      <IconAgent size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-white text-sm mb-1">Agent geht immer ran</h4>
                      <p className="text-xs text-white/50 leading-relaxed">Alle eingehenden Anrufe gehen sofort zum Agent — auch wenn du verfügbar wärst. Du bist komplett freihändig.</p>
                      <p className="text-[11px] text-white/30 mt-1.5">Unbedingte Rufumleitung</p>
                    </div>
                    <div className={`shrink-0 w-5 h-5 rounded-full border-2 mt-0.5 flex-none transition-all ${callMode === 'always' ? 'bg-violet-500 border-violet-500' : 'border-white/20'}`} />
                  </button>
                </div>

                {/* GSM forwarding instructions */}
                {(callMode === 'backup' || callMode === 'always') && (
                  <div className="glass rounded-2xl p-5 mb-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                      <h4 className="text-sm font-semibold text-white">Rufumleitung auf deinem Handy einrichten</h4>
                    </div>

                    <div>
                      <p className="text-xs text-white/40 mb-2 uppercase tracking-wide">Dein Anbieter</p>
                      <div className="flex gap-2 flex-wrap">
                        {carriers.map(c => (
                          <button
                            key={c.id}
                            onClick={() => setSelectedCarrier(c.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer
                              ${selectedCarrier === c.id
                                ? 'bg-white/15 text-white border border-white/25'
                                : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/8 hover:text-white/70'}`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                      {carriers.find(c => c.id === selectedCarrier)?.sub && (
                        <p className="text-[11px] text-white/30 mt-1.5">Auch für: {carriers.find(c => c.id === selectedCarrier)?.sub}</p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="w-5 h-5 rounded-full bg-white/10 text-white/50 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</div>
                        <p className="text-sm text-white/70">Öffne die <strong className="text-white">Telefon-App</strong> und tippe die Wähltastatur auf.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-5 h-5 rounded-full bg-white/10 text-white/50 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">2</div>
                        <div className="flex-1">
                          <p className="text-sm text-white/70 mb-2">Tippe diesen Code <strong className="text-white">genau so</strong> ein:</p>
                          <div className="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-4 py-3">
                            <code className="flex-1 text-base font-mono tracking-widest text-orange-300">{gsmCode}</code>
                            <button
                              onClick={() => { navigator.clipboard.writeText(gsmCode); setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000); }}
                              className={`shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer
                                ${copiedCode ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-white/10 text-white/60 border border-white/15 hover:bg-white/15'}`}
                            >
                              {copiedCode ? '✓ Kopiert' : 'Kopieren'}
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-5 h-5 rounded-full bg-white/10 text-white/50 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">3</div>
                        <p className="text-sm text-white/70">Drücke die <strong className="text-white">grüne Anruftaste</strong>. Dein Handy bestätigt kurz die Aktivierung.</p>
                      </div>
                    </div>

                    <div className="bg-white/4 rounded-xl px-4 py-3 border border-white/8 space-y-1.5">
                      <p className="text-[11px] text-white/40 leading-relaxed">
                        {callMode === 'backup'
                          ? `Aktiviert bedingte Weiterleitung → ${provisionedNumber}: Verpasste Anrufe (besetzt, kein Empfang, keine Antwort) landen beim Agent.`
                          : `Aktiviert unbedingte Weiterleitung → ${provisionedNumber}: Jeder Anruf geht sofort zum Agent.`}
                      </p>
                      <p className="text-[11px] text-white/25">
                        Deaktivieren jederzeit: <code className="text-white/40 font-mono">##002#</code> + Anruftaste
                      </p>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setPhoneDone(true)}
                  disabled={!callMode}
                  className="w-full rounded-xl px-4 py-3 font-semibold text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed
                    transition-all duration-300 hover:shadow-[0_0_28px_rgba(249,115,22,0.4)] cursor-pointer"
                  style={{ background: callMode ? 'linear-gradient(to right, #F97316, #06B6D4)' : 'rgba(255,255,255,0.08)' }}
                >
                  {!callMode
                    ? 'Wähle einen Modus ↑'
                    : callMode === 'direct'
                    ? 'Eingerichtet — weiter →'
                    : 'Weiterleitung eingerichtet — weiter →'}
                </button>
              </>
            );
          })()}

          {/* Phase 3: Done */}
          {phoneDone && (
            <div className="glass rounded-2xl p-8 text-center space-y-5">
              <div className="flex justify-center"><IconStar size={44} className="text-green-400" /></div>
              <h3 className="text-lg font-semibold text-white">Telefon eingerichtet!</h3>
              <p className="text-3xl font-bold" style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {provisionedNumber}
              </p>
              <p className="text-sm text-white/50">
                {callMode === 'direct' && 'Kunden rufen diese Nummer direkt an — der Agent geht sofort ran.'}
                {callMode === 'backup' && 'Rufumleitung eingerichtet — der Agent springt ein wenn du nicht abnimmst.'}
                {callMode === 'always' && 'Unbedingte Weiterleitung — der Agent geht bei jedem Anruf ran.'}
                {!callMode && 'Diese Nummer ist mit deinem Agent verbunden.'}
              </p>
              <button
                onClick={() => setStep('calendar')}
                className="mt-2 rounded-xl px-6 py-2.5 font-semibold text-sm text-white cursor-pointer
                  transition-all duration-300 hover:shadow-[0_0_24px_rgba(249,115,22,0.4)]"
                style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
              >
                Weiter →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Step: Calendar ── */}
      {step === 'calendar' && (
        <div className="relative z-10 w-full max-w-2xl">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(6,182,212,0.1))' }}>
              <IconCalendar size={20} className="text-orange-400" />
            </div>
            <h2 className="text-2xl font-bold text-white">Kalender verbinden</h2>
            <p className="text-sm text-white/35 mt-1.5">Optional — dein Agent kann Termine direkt buchen</p>
          </div>

          {calendarDone ? (
            <div className="rounded-2xl p-8 text-center space-y-4" style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(24px)', border: '1px solid rgba(34,197,94,0.15)' }}>
              <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.1)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h3 className="text-base font-semibold text-white">Kalender verbunden</h3>
              <p className="text-xs text-white/40">{calendarProvider} ist jetzt aktiv</p>
              <div className="flex flex-col items-center gap-3 pt-2">
                <button onClick={() => setStep('test')}
                  className="w-full max-w-xs rounded-xl px-4 py-3 font-semibold text-sm text-white transition-all duration-200 hover:scale-[1.01] cursor-pointer"
                  style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 4px 24px rgba(249,115,22,0.2)' }}>
                  Weiter
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {calendarError && (
                <p className="text-sm text-red-300 bg-red-500/8 border border-red-500/15 rounded-xl px-4 py-2.5">{calendarError}</p>
              )}

              {/* Google Calendar */}
              <div className="rounded-2xl p-5 flex items-center gap-4 transition-all hover:bg-white/[0.04] cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}
                onClick={() => { window.location.href = '/api/calendar/google/connect'; }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(66,133,244,0.08)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" className="fancy-star"><defs><linearGradient id="ggl" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#4285F4"/><stop offset="33%" stopColor="#34A853"/><stop offset="66%" stopColor="#FBBC05"/><stop offset="100%" stopColor="#EA4335"/></linearGradient></defs><path d="M12 1C12.8 7.6 16.4 11.2 23 12c-6.6.8-10.2 4.4-11 11-.8-6.6-4.4-10.2-11-11C7.6 11.2 11.2 7.6 12 1z" fill="url(#ggl)"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Google Calendar</p>
                  <p className="text-[11px] text-white/30">Ein Klick — OAuth</p>
                </div>
                <span className="shrink-0 text-xs font-semibold bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Verbinden →</span>
              </div>

              {/* Microsoft Outlook */}
              <div className="rounded-2xl p-5 flex items-center gap-4 transition-all hover:bg-white/[0.04] cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}
                onClick={async () => { try { const { url } = await getMicrosoftCalendarAuthUrl(); window.location.href = url; } catch {} }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(0,120,212,0.08)' }}>
                  <span className="text-lg">🪟</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Microsoft Outlook</p>
                  <p className="text-[11px] text-white/30">Office 365 / Outlook.com</p>
                </div>
                <span className="shrink-0 text-xs font-semibold bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Verbinden →</span>
              </div>

              {/* Cal.com */}
              <div className="rounded-2xl p-5 transition-all" style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-4 mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.08)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">Cal.com</p>
                    <p className="text-[11px] text-white/30">API Key</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input type="text" value={calcomApiKey} onChange={(e) => setCalcomApiKey(e.target.value)}
                    placeholder="cal_live_xxxx…"
                    className="flex-1 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }} />
                  <button onClick={handleCalcom} disabled={calendarLoading || !calcomApiKey.trim()}
                    className="shrink-0 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40 cursor-pointer transition-all hover:brightness-110"
                    style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.15)' }}>
                    <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                      {calendarLoading ? '…' : 'OK'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Chipy Kalender (eingebaut) */}
              <div className="rounded-2xl p-5 flex items-center gap-4" style={{ background: 'rgba(249,115,22,0.03)', backdropFilter: 'blur(24px)', border: '1px solid rgba(249,115,22,0.1)' }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(6,182,212,0.08))' }}>
                  <FoxLogo size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Chipy Kalender</p>
                  <p className="text-[11px] text-white/30">Eingebaut — immer aktiv</p>
                </div>
                <span className="flex items-center gap-1.5 text-[10px] text-green-400/70 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />Aktiv
                </span>
              </div>

              {/* Skip */}
              <button onClick={() => setStep('test')}
                className="w-full rounded-xl px-4 py-3 text-sm font-medium transition-all cursor-pointer mt-1 hover:brightness-125"
                style={{ background: 'rgba(249,115,22,0.04)', border: '1px solid rgba(249,115,22,0.15)' }}>
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                  Überspringen — später einrichten
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Step: Test ── */}
      {step === 'test' && (
        <div className="relative z-10 w-full max-w-sm">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(6,182,212,0.1))' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white">Teste deinen Agent</h2>
            <p className="text-sm text-white/30 mt-1">Sprich mit Chipy — direkt hier im Browser</p>
          </div>

          {/* Call Area */}
          <div className="rounded-2xl min-h-[260px] flex flex-col items-center justify-center mb-6"
            style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.06)' }}>

            {callState === 'idle' && (
              <div className="flex flex-col items-center gap-6 py-10">
                <div className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <FoxLogo size={40} />
                </div>
                <button onClick={startTestCall}
                  className="rounded-xl px-8 py-3 font-semibold text-sm transition-all duration-200 hover:bg-white/[0.03] cursor-pointer"
                  style={{ background: 'rgba(249,115,22,0.04)', border: '1px solid rgba(249,115,22,0.15)' }}>
                  <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Gespräch starten</span>
                </button>
                <p className="text-[10px] text-white/15">Mikrofon wird benötigt</p>
              </div>
            )}

            {callState === 'connecting' && (
              <div className="flex flex-col items-center gap-4 py-10">
                <div className="w-16 h-16 rounded-full flex items-center justify-center animate-pulse"
                  style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(6,182,212,0.08))', border: '1px solid rgba(249,115,22,0.15)' }}>
                  <FoxLogo size={40} glow />
                </div>
                <p className="text-xs text-white/30">Verbinde…</p>
              </div>
            )}

            {callState === 'active' && (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${agentTalking ? 'scale-110' : ''}`}
                  style={agentTalking
                    ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 0 32px rgba(249,115,22,0.35)' }
                    : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }
                  }>
                  <FoxLogo size={48} glow={agentTalking} />
                </div>

                <div className="flex items-end justify-center gap-[2px] h-5">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className="w-[2px] rounded-full transition-all duration-75"
                      style={{
                        height: agentTalking ? `${Math.max(3, Math.round(3 + Math.random() * 14))}px` : '3px',
                        backgroundColor: agentTalking ? '#f97316' : 'rgba(255,255,255,0.08)',
                      }} />
                  ))}
                </div>

                <p className="text-[11px] text-white/25">{agentTalking ? 'Chipy spricht…' : 'Hört zu…'}</p>

                <button onClick={stopTestCall}
                  className="rounded-lg px-4 py-2 text-[11px] font-medium text-red-400/70 hover:text-red-400 transition-all cursor-pointer"
                  style={{ border: '1px solid rgba(239,68,68,0.12)' }}>
                  Auflegen
                </button>
              </div>
            )}

            {callState === 'ended' && (
              <div className="flex flex-col items-center gap-4 py-10">
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.15)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p className="text-xs text-white/50">Gespräch beendet</p>
                <button onClick={() => { setCallState('idle'); setCallError(null); }}
                  className="text-[11px] font-medium bg-clip-text text-transparent cursor-pointer"
                  style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                  Nochmal testen
                </button>
              </div>
            )}

            {callState === 'error' && callError && (
              <div className="flex flex-col items-center gap-3 py-8 px-6">
                <p className="text-[11px] text-red-400/70 text-center">{callError}</p>
                <button onClick={() => { setCallState('idle'); setCallError(null); }}
                  className="text-[11px] text-white/25 hover:text-white/50 transition-colors cursor-pointer">
                  Erneut versuchen
                </button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col items-center gap-3">
            <button onClick={() => setStep('done')}
              className="w-full rounded-xl px-6 py-3 font-semibold text-sm text-white transition-all duration-200 hover:scale-[1.01] cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 4px 20px rgba(249,115,22,0.15)' }}>
              Weiter
            </button>
            <button onClick={() => setStep('done')}
              className="text-xs text-white/20 hover:text-white/45 transition-colors cursor-pointer">
              Überspringen
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Done ── */}
      {step === 'done' && (
        <div className="relative z-10 w-full max-w-md text-center">
          <FoxLogo size="xl" glow className="mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Dein Phonbot ist komplett eingerichtet!</h2>
          <div className="glass rounded-2xl p-6 mb-8 text-left space-y-3">
            <div className="flex items-center gap-3 text-sm text-white/70">
              <IconStar size={15} className="text-green-400 shrink-0" />
              <span>Agent deployed</span>
            </div>
            {provisionedNumber && (
              <div className="flex items-center gap-3 text-sm text-white/70">
                <IconStar size={15} className="text-green-400 shrink-0" />
                <span>
                  Nummer verbunden
                  {provisionedNumber ? ` (${provisionedNumber})` : ''}
                </span>
              </div>
            )}
            {calendarDone && (
              <div className="flex items-center gap-3 text-sm text-white/70">
                <IconStar size={15} className="text-green-400 shrink-0" />
                <span>Kalender verbunden ({calendarProvider})</span>
              </div>
            )}
            {!phoneDone && (
              <div className="flex items-center gap-3 text-sm text-white/40">
                <span className="text-white/20">–</span>
                <span>Telefonnummer — später einrichten</span>
              </div>
            )}
            {!calendarDone && (
              <div className="flex items-center gap-3 text-sm text-white/40">
                <span className="text-white/20">–</span>
                <span>Kalender — später einrichten</span>
              </div>
            )}
          </div>
          <button
            onClick={() => { clearOnboardingState(); onComplete(); }}
            className="rounded-xl px-8 py-3 font-semibold text-white
              transition-all duration-300 hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.01]"
            style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
          >
            Dashboard öffnen →
          </button>
        </div>
      )}
      {/* Upgrade Modal */}
      {showUpgrade && (
        <UpgradeModal onClose={() => setShowUpgrade(false)} />
      )}
    </div>
  );
}

function UpgradeModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState<string | null>(null);

  const plans = [
    { id: 'starter', name: 'Starter', price: '79', features: ['✦ Telefonnummer inklusive', '360 Min/Monat', '1 Agent'], accent: '#F97316' },
    { id: 'pro', name: 'Professional', price: '179', features: ['✦ Telefonnummer inklusive', '1.000 Min/Monat', '3 Agents', 'Kalender-Integration', 'Priority Support'], accent: '#06B6D4', recommended: true },
    { id: 'agency', name: 'Agency', price: '349', features: ['✦ Telefonnummer inklusive', '2.400 Min/Monat', '10 Agents', 'White-Label', 'Dedicated Support'], accent: '#8B5CF6' },
  ];

  async function handleSelect(planId: string) {
    setLoading(planId);
    try {
      const { createCheckoutSession } = await import('../../lib/api.js');
      const result = await createCheckoutSession(planId, 'month');
      if (result.url) window.location.href = result.url;
    } catch {
      setLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-2xl rounded-2xl p-6 sm:p-8" style={{ background: '#14141f', border: '1px solid rgba(255,255,255,0.08)' }}>
        {/* Header with back button */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={onClose} className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors cursor-pointer">
            <span className="text-base leading-none">‹</span> Zurück
          </button>
          <div className="text-center flex-1">
            <h3 className="text-lg font-bold text-white">Plan wählen</h3>
            <p className="text-xs text-white/30 mt-0.5">Wähle einen Plan um deine Telefonnummer zu aktivieren</p>
          </div>
          <div className="w-16" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {plans.map(p => (
            <div key={p.id} className="rounded-xl p-5 relative flex flex-col"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: p.recommended ? '1px solid rgba(6,182,212,0.2)' : '1px solid rgba(255,255,255,0.06)',
              }}>
              {p.recommended && (
                <span className="absolute left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5"
                  style={{ background: '#14141f', border: '1px solid rgba(6,182,212,0.2)', top: '-9px' }}>
                  <span className="text-[10px] font-semibold bg-clip-text text-transparent"
                    style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Empfohlen</span>
                </span>
              )}
              <p className="text-sm font-bold bg-clip-text text-transparent mb-0.5" style={{ backgroundImage: `linear-gradient(135deg, ${p.accent}, #06B6D4)` }}>{p.name}</p>
              <p className="text-2xl font-extrabold text-white mb-3">{p.price}<span className="text-sm text-white/30 font-normal">€/Mo</span></p>
              <ul className="space-y-1.5 flex-1">
                {p.features.map(f => {
                  const hl = f.startsWith('✦');
                  const label = hl ? f.slice(2) : f;
                  return (
                    <li key={f} className="text-[11px] flex items-center gap-1.5">
                      {hl ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" className="shrink-0 fancy-star"><defs><linearGradient id="fgOb" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#F97316"/><stop offset="100%" stopColor="#06B6D4"/></linearGradient></defs><path d="M12 1C12.8 7.6 16.4 11.2 23 12c-6.6.8-10.2 4.4-11 11-.8-6.6-4.4-10.2-11-11C7.6 11.2 11.2 7.6 12 1z" fill="url(#fgOb)"/></svg>
                      ) : (
                        <span className="w-1 h-1 rounded-full shrink-0" style={{ background: p.accent }} />
                      )}
                      <span className={hl ? 'font-semibold bg-clip-text text-transparent' : 'text-white/40'}
                        style={hl ? { backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' } : undefined}>
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <button
                onClick={() => handleSelect(p.id)}
                disabled={loading !== null}
                className="w-full rounded-lg py-2.5 text-xs font-semibold disabled:opacity-50 transition-all hover:brightness-110 cursor-pointer mt-5"
                style={{
                  background: 'rgba(249,115,22,0.05)',
                  border: '1px solid rgba(249,115,22,0.15)',
                  borderRadius: '0.5rem',
                }}
              >
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                  {loading === p.id ? '…' : 'Auswählen'}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
