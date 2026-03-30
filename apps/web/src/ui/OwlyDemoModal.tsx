// Note: file named OwlyDemoModal for historical reasons, mascot is now "Chippy"
import React, { useState, useRef } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { createDemoCall } from '../lib/api.js';
import { FoxLogo } from './FoxLogo.js';
import { IconScissors, IconWrench, IconMedical, IconBroom, IconRestaurant, IconPhone, IconHeadphones, IconCar } from './PhonbotIcons.js';

type ModalTab = 'webcall' | 'callback';
type CallState = 'idle' | 'connecting' | 'active' | 'ended' | 'error';

type DemoTemplate = {
  id: string;
  Icon: React.FC<{ size?: number; className?: string }>;
  name: string;
  hint: string;
};

const DEMO_TEMPLATES: DemoTemplate[] = [
  { id: 'hairdresser', Icon: IconScissors, name: 'Friseur', hint: 'Terminbuchung & Beratung' },
  { id: 'tradesperson', Icon: IconWrench, name: 'Handwerker', hint: 'Auftragsannahme & Notdienst' },
  { id: 'medical', Icon: IconMedical, name: 'Arztpraxis', hint: 'Terminvergabe & Sprechzeiten' },
  { id: 'cleaning', Icon: IconBroom, name: 'Reinigung', hint: 'Angebote & Planung' },
  { id: 'restaurant', Icon: IconRestaurant, name: 'Restaurant', hint: 'Reservierungen & Karte' },
  { id: 'auto', Icon: IconCar, name: 'Autowerkstatt', hint: 'Termine & Kostenvoranschläge' },
];

type Props = {
  onClose: () => void;
  onGoToRegister?: () => void;
};

export function OwlyDemoModal({ onClose, onGoToRegister }: Props) {
  const [tab, setTab] = useState<ModalTab>('webcall');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  // Web call state
  const [callState, setCallState] = useState<CallState>('idle');
  const [agentTalking, setAgentTalking] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const clientRef = useRef<RetellWebClient | null>(null);

  // Callback state
  const [cbEmail, setCbEmail] = useState('');
  const [cbPhone, setCbPhone] = useState('');
  const [cbName, setCbName] = useState('');
  const [cbSent, setCbSent] = useState(false);
  const [cbLoading, setCbLoading] = useState(false);

  async function startWebCall(templateId: string) {
    if (callState === 'active' || callState === 'connecting') return;
    setSelectedTemplate(templateId);
    setCallState('connecting');
    setCallError(null);
    try {
      const res = await createDemoCall(templateId);
      if (!res.access_token) throw new Error('Kein Zugriffstoken');
      const client = new RetellWebClient();
      clientRef.current = client;
      client.on('call_started', () => setCallState('active'));
      client.on('call_ended', () => { setCallState('ended'); setAgentTalking(false); });
      client.on('agent_start_talking', () => setAgentTalking(true));
      client.on('agent_stop_talking', () => setAgentTalking(false));
      client.on('error', (err: unknown) => { setCallError(String(err)); setCallState('error'); });
      await client.startCall({ accessToken: res.access_token });
    } catch (e: unknown) {
      setCallError(e instanceof Error ? e.message : 'Fehler');
      setCallState('error');
    }
  }

  function stopCall() {
    clientRef.current?.stopCall();
    clientRef.current = null;
    setCallState('ended');
    setAgentTalking(false);
  }

  function resetCall() {
    setCallState('idle');
    setSelectedTemplate(null);
    setCallError(null);
  }

  async function submitCallback(e: React.FormEvent) {
    e.preventDefault();
    setCbLoading(true);
    try {
      await fetch('/api/demo/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: cbName, email: cbEmail, phone: cbPhone }),
      });
    } catch {
      // Fail silently — still show success for UX
    } finally {
      setCbSent(true);
      setCbLoading(false);
    }
  }

  function handleClose() {
    if (callState === 'active' || callState === 'connecting') {
      clientRef.current?.stopCall();
      clientRef.current = null;
    }
    onClose();
  }

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) handleClose();
  }

  const activeTemplateMeta = DEMO_TEMPLATES.find((t) => t.id === selectedTemplate);

  return (
    <div
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="relative w-full max-w-md glass-strong rounded-3xl overflow-hidden fade-up max-h-[90vh] overflow-y-auto"
        style={{ boxShadow: '0 0 80px rgba(249,115,22,0.15), 0 0 0 1px rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all"
        >
          ✕
        </button>

        {/* Header — Chippy intro */}
        <div className="px-6 pt-8 pb-4 text-center">
          <FoxLogo size="lg" glow animate className="mx-auto mb-3" />
          <h2 className="text-xl font-bold text-white">Hey! Ich bin Chippy</h2>
          <p className="text-sm text-white/50 mt-1">
            Dein KI-Telefonassistent. Hör rein wie ich für verschiedene Branchen arbeite — oder lass dich zurückrufen.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mx-6 mb-4 bg-white/5 rounded-xl p-1">
          <button
            onClick={() => setTab('webcall')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'webcall' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            Demos anhören
          </button>
          <button
            onClick={() => setTab('callback')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'callback' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            Rückruf erhalten
          </button>
        </div>

        {/* ── WEB CALL TAB ── */}
        {tab === 'webcall' && (
          <div className="px-6 pb-8">
            {/* Template chooser (idle state) */}
            {callState === 'idle' && (
              <div>
                <p className="text-xs text-white/40 mb-3 text-center">Wähle eine Branche und sprich direkt mit dem Agent:</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {DEMO_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => startWebCall(t.id)}
                      className="relative flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.04] border border-white/8 hover:bg-white/[0.08] hover:border-orange-500/30 transition-all text-left group"
                    >
                      <t.Icon size={20} className="shrink-0 text-white/60 group-hover:text-orange-300 transition-colors" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white/80 group-hover:text-white">{t.name}</p>
                      </div>
                      {/* Tooltip */}
                      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 hidden group-hover:block whitespace-nowrap rounded-lg bg-[#1a1a2e] border border-white/10 px-3 py-1.5 text-xs text-white/70 shadow-lg">
                        {t.hint}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-white/25 text-center">Kein Account · Mikrofon wird benötigt · ca. 30 Sek.</p>
              </div>
            )}

            {/* Connecting */}
            {callState === 'connecting' && (
              <div className="text-center py-6">
                <div className="flex items-center justify-center gap-2 text-orange-300 mb-2">
                  <span className="w-5 h-5 rounded-full border-2 border-orange-400 border-t-transparent spin inline-block" />
                  <span className="text-sm font-medium">Verbinde…</span>
                </div>
                {activeTemplateMeta && (
                  <p className="text-xs text-white/40 flex items-center justify-center gap-1.5">
                    <activeTemplateMeta.Icon size={14} className="opacity-60" />
                    {activeTemplateMeta.name}-Agent wird vorbereitet
                  </p>
                )}
              </div>
            )}

            {/* Active call */}
            {callState === 'active' && (
              <div className="text-center">
                <div className={`relative mx-auto w-fit mb-4 ${agentTalking ? 'mic-pulse' : ''}`}>
                  {agentTalking && (
                    <>
                      <div className="sound-ring" style={{ borderColor: 'rgba(249,115,22,0.5)' }} />
                      <div className="sound-ring" style={{ borderColor: 'rgba(249,115,22,0.3)', animationDelay: '0.6s' }} />
                    </>
                  )}
                  <FoxLogo size="xl" glow={agentTalking} animate={agentTalking} />
                </div>
                {activeTemplateMeta && (
                  <div className="inline-flex items-center gap-1.5 text-xs text-white/40 mb-3">
                    <activeTemplateMeta.Icon size={14} className="opacity-60" />
                    <span>{activeTemplateMeta.name}-Demo</span>
                  </div>
                )}
                <div className="flex items-center justify-center gap-2 mb-5">
                  {agentTalking ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-orange-400 breathe inline-block" />
                      <span className="text-orange-300 text-sm font-medium">Chippy spricht…</span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-cyan-400 breathe inline-block" />
                      <span className="text-cyan-300 text-sm font-medium">Ich höre zu…</span>
                    </>
                  )}
                </div>
                <button
                  onClick={stopCall}
                  className="flex items-center gap-2 mx-auto px-6 py-2.5 rounded-full bg-red-500/20 border border-red-500/30 text-red-300 text-sm font-medium hover:bg-red-500/30 transition-all"
                >
                  <IconPhone size={16} className="opacity-80" /> Beenden
                </button>
              </div>
            )}

            {/* Call ended — funnel moment */}
            {callState === 'ended' && (
              <div className="text-center">
                <FoxLogo size="lg" glow className="mx-auto mb-3" />
                <h3 className="text-lg font-bold text-white mb-1">So klingt dein Agent!</h3>
                <p className="text-sm text-white/50 mb-5">
                  In 2 Minuten hast du deinen eigenen — angepasst an dein Business.
                </p>
                <div className="space-y-2.5">
                  {onGoToRegister && (
                    <button
                      onClick={() => { onClose(); onGoToRegister(); }}
                      className="w-full py-3 rounded-2xl font-semibold text-white text-sm transition-all hover:scale-[1.02]"
                      style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                    >
                      Eigenen Agent erstellen →
                    </button>
                  )}
                  <button
                    onClick={resetCall}
                    className="w-full py-2.5 rounded-xl text-sm text-white/40 hover:text-white/60 bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 transition-all"
                  >
                    Andere Branche testen
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {callState === 'error' && (
              <div className="text-center py-4">
                <p className="text-red-300 text-sm mb-4">{callError}</p>
                <button onClick={resetCall} className="text-sm text-white/40 hover:text-white/70 underline">
                  Nochmal versuchen
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── CALLBACK TAB ── */}
        {tab === 'callback' && (
          <div className="px-6 pb-8">
            {!cbSent ? (
              <>
                <p className="text-sm text-white/50 mb-5 text-center">
                  Chippy ruft dich an — direkt auf dein Handy. Erlebe Phonbot in deinem echten Umfeld.
                </p>
                <form onSubmit={submitCallback} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-white/50 mb-1">Name</label>
                    <input type="text" required value={cbName} onChange={(e) => setCbName(e.target.value)} placeholder="Max Mustermann"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-white/50 mb-1">E-Mail</label>
                    <input type="email" required value={cbEmail} onChange={(e) => setCbEmail(e.target.value)} placeholder="max@firma.de"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-white/50 mb-1">Telefon</label>
                    <input type="tel" required value={cbPhone} onChange={(e) => setCbPhone(e.target.value)} placeholder="+49 170 1234567"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all" />
                  </div>
                  <button type="submit" disabled={cbLoading}
                    className="w-full py-3.5 rounded-2xl font-bold text-white text-sm transition-all hover:scale-[1.02] disabled:opacity-50 mt-1"
                    style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                    {cbLoading ? '…' : 'Chippy soll mich anrufen'}
                  </button>
                </form>
                <p className="text-xs text-white/25 text-center mt-3">Kein Spam. Daten nur für den Demo-Anruf.</p>
              </>
            ) : (
              <div className="text-center py-4">
                <FoxLogo size="lg" glow animate className="mx-auto mb-4" />
                <h3 className="text-lg font-bold text-white mb-2">Chippy ruft dich an!</h3>
                <p className="text-sm text-white/50 mb-2">
                  Du erhältst in Kürze einen Anruf auf <strong className="text-white">{cbPhone}</strong>.
                </p>
                {onGoToRegister && (
                  <button
                    onClick={() => { onClose(); onGoToRegister(); }}
                    className="mt-4 text-sm text-orange-400 hover:text-orange-300 font-medium underline transition-colors"
                  >
                    Oder direkt eigenen Agent erstellen →
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
