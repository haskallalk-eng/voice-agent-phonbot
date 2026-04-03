import React, { useEffect, useRef, useState } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { TEMPLATES, type Template } from './templates.js';
import { deployAgentConfig, createWebCall, connectCalcom, type AgentConfig } from '../../lib/api.js';
import { FoxLogo } from '../FoxLogo.js';
import {
  IconStar, IconCalendar, IconPhone, IconCapabilities,
  IconScissors, IconWrench, IconMedical, IconBroom, IconSettings,
  IconTickets, IconAgent, IconDeploy, IconPhoneForward,
} from '../PhonbotIcons.js';

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
  medical: {
    Icon: IconMedical,
    accent: 'text-cyan-300',
    iconBg: 'bg-cyan-500/15',
    hoverBorder: 'hover:border-cyan-500/40',
    hoverGlow: 'hover:shadow-[0_0_22px_rgba(6,182,212,0.18)]',
    selectedBorder: 'border-cyan-500/60',
    selectedGlow: 'shadow-[0_0_22px_rgba(6,182,212,0.25)]',
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

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('template');
  const [template, setTemplate] = useState<Template | null>(null);
  const [form, setForm] = useState({
    businessName: '',
    address: '',
    openingHours: '',
    servicesText: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployedAgentId, setDeployedAgentId] = useState<string | null>(null);

  // Phone step state
  const [areaCode, setAreaCode] = useState('030');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [provisionedNumber, setProvisionedNumber] = useState<string | null>(null);
  const [phoneDone, setPhoneDone] = useState(false);
  const [callMode, setCallMode] = useState<'direct' | 'backup' | 'always' | null>(null);
  const [selectedCarrier, setSelectedCarrier] = useState('telekom');
  const [copiedCode, setCopiedCode] = useState(false);

  // Calendar step state
  const [calcomApiKey, setCalcomApiKey] = useState('');
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarDone, setCalendarDone] = useState(false);
  const [calendarProvider, setCalendarProvider] = useState<string | null>(null);

  // Test call state
  const [callState, setCallState] = useState<CallState>('idle');
  const [agentTalking, setAgentTalking] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const clientRef = useRef<RetellWebClient | null>(null);

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
      setDeployedAgentId(result.retellAgentId ?? null);
      setStep('phone');
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
      const res = await fetch('/api/phone/provision', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('vas_token') ?? ''}` },
        body: JSON.stringify({ areaCode }),
      });
      if (!res.ok) throw new Error(`Fehler ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setProvisionedNumber(data.numberPretty ?? data.number);
      setPhoneDone(true);
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
          className="glow-pulse absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full"
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
        <div className="relative z-10 w-full max-w-2xl">
          {/* Welcome hero */}
          <div className="text-center mb-10">
            <FoxLogo size="lg" glow animate className="mx-auto mb-5" />
            <h1 className="text-3xl font-bold mb-2 tracking-tight">Willkommen bei Phonbot</h1>
            <p className="text-white/50 text-base max-w-sm mx-auto leading-relaxed">
              Dein KI-Telefonagent ist in 5 Minuten einsatzbereit.
              Wähle zuerst ein Template für dein Business.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TEMPLATES.map((t) => {
              const cfg = TEMPLATE_CONFIG[t.id];
              const Icon = cfg?.Icon ?? IconSettings;
              return (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  className={`flex items-center gap-4 p-5 rounded-2xl glass border-2 border-transparent
                    ${cfg?.hoverBorder ?? ''} ${cfg?.hoverGlow ?? ''}
                    hover:bg-white/5 transition-all duration-300 text-left cursor-pointer group`}
                >
                  <div className={`shrink-0 w-12 h-12 rounded-xl ${cfg?.iconBg ?? 'bg-white/10'}
                    flex items-center justify-center ${cfg?.accent ?? 'text-white/60'}
                    transition-all duration-300 group-hover:scale-110`}>
                    <Icon size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white text-sm mb-0.5">{t.name}</h3>
                    <p className="text-xs text-white/40 leading-relaxed">{t.description}</p>
                  </div>
                  <svg className="shrink-0 text-white/20 group-hover:text-white/50 transition-colors duration-300"
                    width="16" height="16" viewBox="0 0 24 24" fill="none"
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

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setStep('template')}
                className="px-4 py-2 text-sm text-white/40 hover:text-white/70 transition-colors"
              >
                ← Zurück
              </button>
              <button
                onClick={handleDeploy}
                disabled={loading || !form.businessName.trim()}
                className="flex-1 rounded-xl px-4 py-2.5 font-semibold text-sm text-white disabled:opacity-50
                  transition-all duration-300 hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.01]"
                style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />
                    Agent wird erstellt…
                  </span>
                ) : (
                  'Agent erstellen & aktivieren →'
                )}
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
            <div className="glass rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-300 text-xs font-bold shrink-0">1</div>
                <div>
                  <h3 className="font-semibold text-white">Phonbot-Nummer aktivieren</h3>
                  <p className="text-xs text-white/40 mt-0.5">Jeder Agent braucht eine eigene Rufnummer</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">Wunschvorwahl</label>
                <select
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value)}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white
                    focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all cursor-pointer"
                >
                  {AREA_CODES.map((ac) => (
                    <option key={ac.code} value={ac.code} className="bg-[#1a1a2e]">{ac.label}</option>
                  ))}
                </select>
              </div>

              {phoneError && (
                <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 flex items-center gap-2">
                  <IconCapabilities size={14} className="shrink-0" />{phoneError}
                </p>
              )}

              <button
                onClick={handleProvision}
                disabled={phoneLoading}
                className="w-full rounded-xl px-4 py-3 font-semibold text-sm text-white disabled:opacity-50
                  transition-all duration-300 hover:shadow-[0_0_28px_rgba(249,115,22,0.4)] cursor-pointer"
                style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
              >
                {phoneLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />
                    Nummer wird aktiviert…
                  </span>
                ) : (
                  'Meine Phonbot-Nummer aktivieren →'
                )}
              </button>

              <div className="text-center pt-1">
                <button onClick={() => setStep('calendar')} className="text-xs text-white/25 hover:text-white/45 transition-colors cursor-pointer">
                  Später einrichten
                </button>
              </div>
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
          <h2 className="text-2xl font-bold text-center mb-2 flex items-center justify-center gap-2"><IconCalendar size={22} /> Kalender verbinden (optional)</h2>
          <p className="text-white/50 text-center mb-8">
            Dein Agent kann Termine direkt buchen wenn du deinen Kalender verbindest.
          </p>

          {calendarDone ? (
            <div className="glass rounded-2xl p-8 text-center space-y-4">
              <div className="flex justify-center"><IconStar size={44} className="text-green-400" /></div>
              <h3 className="text-lg font-semibold text-white">Kalender verbunden!</h3>
              <p className="text-sm text-white/50">{calendarProvider} ist jetzt mit deinem Agent verbunden.</p>
              <button
                onClick={() => setStep('test')}
                className="mt-2 rounded-xl px-6 py-2.5 font-semibold text-sm text-white
                  transition-all duration-300 hover:shadow-[0_0_24px_rgba(249,115,22,0.4)]"
                style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
              >
                Weiter →
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {/* Google Calendar */}
                <div className="glass rounded-2xl p-6 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-400 shrink-0" />
                    <h3 className="font-semibold text-white">Google Calendar</h3>
                  </div>
                  <p className="text-sm text-white/50 flex-1">
                    Verbinde deinen Google-Kalender für automatische Terminbuchungen.
                  </p>
                  <button
                    onClick={() => { window.location.href = '/api/calendar/google/connect'; }}
                    className="w-full rounded-xl px-4 py-2.5 font-semibold text-sm text-white
                      transition-all duration-300 hover:shadow-[0_0_24px_rgba(249,115,22,0.4)]"
                    style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
                  >
                    Google Calendar verbinden →
                  </button>
                </div>

                {/* Cal.com */}
                <div className="glass rounded-2xl p-6 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shrink-0" />
                    <h3 className="font-semibold text-white">Cal.com</h3>
                  </div>
                  <p className="text-sm text-white/50">
                    Nutze Cal.com für professionelles Terminmanagement.
                  </p>
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={calcomApiKey}
                      onChange={(e) => setCalcomApiKey(e.target.value)}
                      placeholder="cal_live_xxxx…"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/30
                        focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                    />
                    <details className="text-xs text-white/30">
                      <summary className="cursor-pointer hover:text-white/50 transition-colors">
                        Wo finde ich meinen API Key?
                      </summary>
                      <p className="mt-2 text-white/40 leading-relaxed">
                        Cal.com → Settings → Developer → API Keys → New API Key
                      </p>
                    </details>
                  </div>
                  <button
                    onClick={handleCalcom}
                    disabled={calendarLoading || !calcomApiKey.trim()}
                    className="w-full rounded-xl px-4 py-2.5 font-semibold text-sm text-white disabled:opacity-50
                      transition-all duration-300 hover:shadow-[0_0_24px_rgba(59,130,246,0.4)]"
                    style={{ background: 'linear-gradient(to right, #3B82F6, #F97316)' }}
                  >
                    {calendarLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />
                        Verbinde…
                      </span>
                    ) : (
                      'Verbinden →'
                    )}
                  </button>
                </div>

                {/* Ohne Kalender */}
                <div className="glass rounded-2xl p-6 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-white/50">
                      <IconTickets size={18} />
                    </div>
                    <h3 className="font-semibold text-white">Ohne Kalender</h3>
                  </div>
                  <p className="text-sm text-white/50 flex-1">
                    Dein Agent nimmt Terminwünsche entgegen und erstellt Tickets.
                  </p>
                  <button
                    onClick={() => setStep('test')}
                    className="w-full rounded-xl px-4 py-2.5 font-semibold text-sm text-white/70 border border-white/10
                      hover:bg-white/5 hover:text-white transition-all duration-300"
                  >
                    Ohne Kalender weiter →
                  </button>
                </div>
              </div>

              {calendarError && (
                <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2">
                  <IconCapabilities size={14} className="shrink-0" />{calendarError}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Step: Test ── */}
      {step === 'test' && (
        <div className="relative z-10 w-full max-w-md text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#F97316,#06B6D4)' }}>
              <IconDeploy size={30} className="text-white" />
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-2">Dein Agent ist live!</h2>
          <p className="text-white/50 mb-8">
            Teste ihn direkt — sprich mit deinem Agent über das Mikrofon.
          </p>

          {/* Call UI */}
          <div className="glass rounded-2xl p-8 mb-6">
            {callState === 'idle' && (
              <button
                onClick={startTestCall}
                className="flex items-center gap-3 mx-auto rounded-full px-8 py-4 font-semibold text-white
                  transition-all duration-300 hover:shadow-[0_0_40px_rgba(249,115,22,0.5)] hover:scale-105 cursor-pointer"
                style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
              >
                <IconAgent size={20} /> Jetzt anrufen
              </button>
            )}

            {callState === 'connecting' && (
              <div className="flex items-center justify-center gap-3 text-orange-300">
                <span className="w-5 h-5 rounded-full border-2 border-orange-400 border-t-transparent spin" />
                Verbinde…
              </div>
            )}

            {callState === 'active' && (
              <div className="flex flex-col items-center gap-5">
                <div
                  className={`w-24 h-24 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
                    agentTalking ? 'mic-pulse' : ''
                  }`}
                  style={{
                    background: 'linear-gradient(135deg, #F97316, #06B6D4)',
                    boxShadow: agentTalking
                      ? '0 0 40px rgba(249,115,22,0.6), 0 0 80px rgba(6,182,212,0.3)'
                      : '0 0 20px rgba(249,115,22,0.2)',
                  }}
                >
                  <IconAgent size={36} className="text-white" />
                </div>
                <p className="text-sm">
                  {agentTalking ? (
                    <span className="text-cyan-300">Agent spricht…</span>
                  ) : (
                    <span className="text-orange-300">Warte auf dich…</span>
                  )}
                </p>
                <button
                  onClick={stopTestCall}
                  className="flex items-center gap-2 rounded-full bg-red-500/20 border border-red-500/40 hover:bg-red-500/30
                    px-6 py-2.5 text-red-300 text-sm font-medium transition-all duration-200"
                >
                  Auflegen
                </button>
              </div>
            )}

            {callState === 'ended' && (
              <div className="flex flex-col items-center gap-4">
                <div className="flex justify-center"><IconStar size={40} className="text-green-400" /></div>
                <p className="text-white/60 text-sm">Call beendet. Gut gemacht!</p>
                <button
                  onClick={() => { setCallState('idle'); setCallError(null); }}
                  className="text-sm text-orange-400 hover:text-orange-300 underline underline-offset-2 transition-colors"
                >
                  Nochmal testen
                </button>
              </div>
            )}

            {callState === 'error' && callError && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5"><IconCapabilities size={13} />{callError}</span>
                </p>
                <button
                  onClick={() => { setCallState('idle'); setCallError(null); }}
                  className="text-sm text-white/40 hover:text-white/60 transition-colors"
                >
                  Zurück
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => setStep('done')}
              className="rounded-xl px-6 py-3 font-semibold text-white text-sm
                transition-all duration-300 hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.01]"
              style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
            >
              Weiter →
            </button>
            <button
              onClick={() => setStep('done')}
              className="text-sm text-white/30 hover:text-white/50 transition-colors"
            >
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
            onClick={onComplete}
            className="rounded-xl px-8 py-3 font-semibold text-white
              transition-all duration-300 hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.01]"
            style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
          >
            Dashboard öffnen →
          </button>
        </div>
      )}
    </div>
  );
}
