import React, { useEffect, useRef, useState } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { TEMPLATES, type Template } from './templates.js';
import { deployAgentConfig, createWebCall, connectCalcom, type AgentConfig } from '../../lib/api.js';
import { FoxLogo } from '../FoxLogo.js';

type Step = 'template' | 'details' | 'phone' | 'calendar' | 'test' | 'done';
type CallState = 'idle' | 'connecting' | 'active' | 'ended' | 'error';

type PhoneMode = 'none' | 'provision' | 'forward';
type CalendarMode = 'none' | 'google' | 'calcom';

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
  const [phoneMode, setPhoneMode] = useState<PhoneMode>('none');
  const [areaCode, setAreaCode] = useState('030');
  const [forwardNumber, setForwardNumber] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [provisionedNumber, setProvisionedNumber] = useState<string | null>(null);
  const [forwardInstructions, setForwardInstructions] = useState<Record<string, string> | null>(null);
  const [phoneDone, setPhoneDone] = useState(false);

  // Calendar step state
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('none');
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

  async function handleForward() {
    setPhoneLoading(true);
    setPhoneError(null);
    try {
      const res = await fetch('/api/phone/forward', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('vas_token') ?? ''}` },
        body: JSON.stringify({ number: forwardNumber }),
      });
      if (!res.ok) throw new Error(`Fehler ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setForwardInstructions(data.instructions ?? null);
      setPhoneDone(true);
    } catch (e: unknown) {
      setPhoneError((e instanceof Error ? e.message : null) ?? 'Fehler beim Einrichten');
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
          <h2 className="text-2xl font-bold text-center mb-2">Was für ein Business hast du?</h2>
          <p className="text-white/50 text-center mb-8">
            Wähle ein Template — du kannst alles später anpassen.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => selectTemplate(t)}
                className="flex items-start gap-4 p-5 rounded-2xl glass
                  hover:bg-white/10 hover:border-orange-500/40 hover:shadow-[0_0_20px_rgba(249,115,22,0.2)]
                  transition-all duration-300 text-left"
              >
                <span className="text-3xl">{t.icon}</span>
                <div>
                  <h3 className="font-semibold text-white">{t.name}</h3>
                  <p className="text-sm text-white/40 mt-0.5">{t.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step: Details ── */}
      {step === 'details' && template && (
        <div className="relative z-10 w-full max-w-lg">
          <h2 className="text-2xl font-bold text-center mb-2">
            {template.icon} Dein {template.name}
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
        <div className="relative z-10 w-full max-w-2xl">
          <h2 className="text-2xl font-bold text-center mb-2">📞 Telefonnummer einrichten</h2>
          <p className="text-white/50 text-center mb-8">
            Dein Agent braucht eine Nummer um Anrufe entgegenzunehmen.
          </p>

          {!phoneDone ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {/* Option A: Neue Nummer */}
                <div
                  className={`glass rounded-2xl p-6 flex flex-col gap-4 cursor-pointer border-2 transition-all duration-300
                    ${phoneMode === 'provision'
                      ? 'border-orange-500/60 shadow-[0_0_24px_rgba(249,115,22,0.25)]'
                      : 'border-transparent hover:border-white/20'}`}
                  onClick={() => { setPhoneMode('provision'); setPhoneError(null); }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🆕</span>
                    <h3 className="font-semibold text-white">Neue Nummer erhalten</h3>
                  </div>
                  <p className="text-sm text-white/50">
                    Wir aktivieren eine lokale Nummer die dein Agent sofort beantwortet.
                  </p>

                  {phoneMode === 'provision' && (
                    <div className="flex flex-col gap-3 mt-2" onClick={(e) => e.stopPropagation()}>
                      <div>
                        <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-wide">Vorwahl</label>
                        <select
                          value={areaCode}
                          onChange={(e) => setAreaCode(e.target.value)}
                          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white
                            focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all"
                        >
                          {AREA_CODES.map((ac) => (
                            <option key={ac.code} value={ac.code} className="bg-[#1a1a2e]">
                              {ac.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={handleProvision}
                        disabled={phoneLoading}
                        className="w-full rounded-xl px-4 py-2.5 font-semibold text-sm text-white disabled:opacity-50
                          transition-all duration-300 hover:shadow-[0_0_24px_rgba(249,115,22,0.4)]"
                        style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
                      >
                        {phoneLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />
                            Aktiviere…
                          </span>
                        ) : (
                          'Nummer aktivieren →'
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Option B: Weiterleitung */}
                <div
                  className={`glass rounded-2xl p-6 flex flex-col gap-4 cursor-pointer border-2 transition-all duration-300
                    ${phoneMode === 'forward'
                      ? 'border-cyan-500/60 shadow-[0_0_24px_rgba(6,182,212,0.25)]'
                      : 'border-transparent hover:border-white/20'}`}
                  onClick={() => { setPhoneMode('forward'); setPhoneError(null); }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">↪️</span>
                    <h3 className="font-semibold text-white">Bestehende Nummer weiterleiten</h3>
                  </div>
                  <p className="text-sm text-white/50">
                    Behalte deine Nummer und leite bei Besetzt an deinen Agent weiter.
                  </p>

                  {phoneMode === 'forward' && (
                    <div className="flex flex-col gap-3 mt-2" onClick={(e) => e.stopPropagation()}>
                      <div>
                        <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-wide">Deine Nummer</label>
                        <input
                          type="tel"
                          value={forwardNumber}
                          onChange={(e) => setForwardNumber(e.target.value)}
                          placeholder="+49 30 123456"
                          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30
                            focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all"
                        />
                      </div>
                      <button
                        onClick={handleForward}
                        disabled={phoneLoading || !forwardNumber.trim()}
                        className="w-full rounded-xl px-4 py-2.5 font-semibold text-sm text-white disabled:opacity-50
                          transition-all duration-300 hover:shadow-[0_0_24px_rgba(6,182,212,0.4)]"
                        style={{ background: 'linear-gradient(to right, #06B6D4, #F97316)' }}
                      >
                        {phoneLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white spin" />
                            Einrichten…
                          </span>
                        ) : (
                          'Weiterleitung einrichten →'
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {phoneError && (
                <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 mb-4">
                  ⚠️ {phoneError}
                </p>
              )}

              <div className="text-center">
                <button
                  onClick={() => setStep('calendar')}
                  className="text-sm text-white/30 hover:text-white/50 transition-colors"
                >
                  Später einrichten →
                </button>
              </div>
            </>
          ) : (
            /* Success state */
            <div className="glass rounded-2xl p-8 text-center space-y-5">
              <div className="text-4xl">✅</div>
              {provisionedNumber ? (
                <>
                  <h3 className="text-lg font-semibold text-white">Nummer aktiviert!</h3>
                  <p className="text-3xl font-bold" style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    {provisionedNumber}
                  </p>
                  <p className="text-sm text-white/50">Diese Nummer ist ab sofort mit deinem Agent verbunden.</p>
                </>
              ) : forwardInstructions ? (
                <>
                  <h3 className="text-lg font-semibold text-white">Weiterleitung eingerichtet!</h3>
                  <p className="text-sm text-white/50 mb-4">Richte jetzt die Weiterleitung auf deinem Gerät ein:</p>
                  <div className="text-left space-y-3">
                    {Object.entries(forwardInstructions).map(([device, instruction]) => (
                      <div key={device} className="bg-white/5 rounded-xl p-4">
                        <p className="text-xs font-medium text-white/60 uppercase tracking-wide mb-1">{device}</p>
                        <p className="text-sm text-white/80">{instruction}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
              <button
                onClick={() => setStep('calendar')}
                className="mt-2 rounded-xl px-6 py-2.5 font-semibold text-sm text-white
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
          <h2 className="text-2xl font-bold text-center mb-2">📅 Kalender verbinden (optional)</h2>
          <p className="text-white/50 text-center mb-8">
            Dein Agent kann Termine direkt buchen wenn du deinen Kalender verbindest.
          </p>

          {calendarDone ? (
            <div className="glass rounded-2xl p-8 text-center space-y-4">
              <div className="text-4xl">✅</div>
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
                    <span className="text-2xl">🟢</span>
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
                    <span className="text-2xl">🔵</span>
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
                    <span className="text-2xl">📋</span>
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
                <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 mb-4">
                  ⚠️ {calendarError}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Step: Test ── */}
      {step === 'test' && (
        <div className="relative z-10 w-full max-w-md text-center">
          <div className="text-5xl mb-4">🎉</div>
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
                  transition-all duration-300 hover:shadow-[0_0_40px_rgba(249,115,22,0.5)] hover:scale-105"
                style={{ background: 'linear-gradient(to right, #F97316, #06B6D4)' }}
              >
                <span className="text-2xl">🎙️</span> Jetzt anrufen
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
                  className={`w-24 h-24 rounded-full flex items-center justify-center text-5xl shadow-2xl transition-all duration-300 ${
                    agentTalking ? 'mic-pulse' : ''
                  }`}
                  style={{
                    background: 'linear-gradient(135deg, #F97316, #06B6D4)',
                    boxShadow: agentTalking
                      ? '0 0 40px rgba(249,115,22,0.6), 0 0 80px rgba(6,182,212,0.3)'
                      : '0 0 20px rgba(249,115,22,0.2)',
                  }}
                >
                  🎙️
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
                  📵 Auflegen
                </button>
              </div>
            )}

            {callState === 'ended' && (
              <div className="flex flex-col items-center gap-4">
                <div className="text-3xl">✅</div>
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
                  ⚠️ {callError}
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
              <span className="text-green-400">✅</span>
              <span>Agent deployed</span>
            </div>
            {(provisionedNumber || forwardInstructions) && (
              <div className="flex items-center gap-3 text-sm text-white/70">
                <span className="text-green-400">✅</span>
                <span>
                  Nummer verbunden
                  {provisionedNumber ? ` (${provisionedNumber})` : ''}
                </span>
              </div>
            )}
            {calendarDone && (
              <div className="flex items-center gap-3 text-sm text-white/70">
                <span className="text-green-400">✅</span>
                <span>Kalender verbunden ({calendarProvider})</span>
              </div>
            )}
            {!phoneDone && (
              <div className="flex items-center gap-3 text-sm text-white/40">
                <span>⏭️</span>
                <span>Telefonnummer — später einrichten</span>
              </div>
            )}
            {!calendarDone && (
              <div className="flex items-center gap-3 text-sm text-white/40">
                <span>⏭️</span>
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
