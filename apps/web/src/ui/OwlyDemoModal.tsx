// Note: file named OwlyDemoModal for historical reasons, mascot is now "Chipy"
import React, { useState, useRef, useEffect } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { createDemoCall } from '../lib/api.js';
import { useWebCallCleanup } from '../lib/use-web-call-cleanup.js';
import { playForwardingTone, looksLikeForwarding } from '../lib/demo-tones.js';
import { FoxLogo } from './FoxLogo.js';
import { IconScissors, IconWrench, IconBroom, IconRestaurant, IconPhone, IconHeadphones, IconCar } from './PhonbotIcons.js';

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
  { id: 'cleaning', Icon: IconBroom, name: 'Reinigung', hint: 'Angebote & Planung' },
  { id: 'restaurant', Icon: IconRestaurant, name: 'Restaurant', hint: 'Reservierungen & Karte' },
  { id: 'auto', Icon: IconCar, name: 'Autowerkstatt', hint: 'Termine & Kostenvoranschläge' },
  { id: 'solo', Icon: IconHeadphones, name: 'Selbstständige', hint: 'Erstgespräch & Discovery-Call' },
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
  const [webConsent, setWebConsent] = useState(false);
  const clientRef = useRef<RetellWebClient | null>(null);
  const lastAgentMessageRef = useRef<string>('');
  useWebCallCleanup(clientRef);

  // Callback state
  const [cbEmail, setCbEmail] = useState('');
  const [cbPhone, setCbPhone] = useState('');
  const [cbName, setCbName] = useState('');
  const [cbSent, setCbSent] = useState(false);
  const [cbLoading, setCbLoading] = useState(false);
  const [cbError, setCbError] = useState<string | null>(null);
  const [cbConsent, setCbConsent] = useState(false);

  function stopActiveCall() {
    if (clientRef.current) {
      try { clientRef.current.stopCall(); } catch { /* idempotent */ }
      clientRef.current = null;
    }
  }

  function switchTab(next: ModalTab) {
    if (next === tab) return;
    // Audit-Round-11 MED (Codex): tab-switch from an active webcall left the
    // Retell client + microphone running in the background.
    if (callState === 'active' || callState === 'connecting') {
      stopActiveCall();
      setCallState('ended');
      setAgentTalking(false);
    }
    setTab(next);
  }

  async function startWebCall(templateId: string) {
    if (callState === 'active' || callState === 'connecting') return;
    if (!webConsent) {
      setCallError('Bitte bestätige zuerst den Demo-Datenschutzhinweis.');
      setCallState('error');
      return;
    }
    setSelectedTemplate(templateId);
    setCallState('connecting');
    setCallError(null);
    try {
      // iOS Safari verliert den user-gesture nach jedem await — wenn wir den
      // Mic-Prompt erst nach dem Token-Fetch aufrufen, wird er stumm verworfen
      // und Retell hängt beim Verbinden. Deshalb Mic-Permission SYNCHRON hier,
      // bevor irgendein await läuft. Spiegelt DemoSection.tsx.
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch (micErr: unknown) {
          const name = (micErr as { name?: string })?.name ?? '';
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            throw new Error('Mikrofon-Zugriff wurde abgelehnt. Bitte erlaube den Zugriff in den Browser-Einstellungen und versuche es nochmal.');
          }
          if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            throw new Error('Kein Mikrofon gefunden. Bitte verbinde ein Mikrofon und versuche es nochmal.');
          }
          throw new Error('Mikrofon-Zugriff nicht möglich. Bitte prüfe deine Browser-Einstellungen.');
        }
      }
      const res = await createDemoCall(templateId, undefined, true);
      if (!res.access_token) throw new Error('Kein Zugriffstoken');
      const client = new RetellWebClient();
      clientRef.current = client;
      client.on('call_started', () => setCallState('active'));
      client.on('call_ended', () => {
        if (looksLikeForwarding(lastAgentMessageRef.current)) {
          void playForwardingTone();
        }
        setCallState('ended');
        setAgentTalking(false);
      });
      client.on('agent_start_talking', () => setAgentTalking(true));
      client.on('agent_stop_talking', () => setAgentTalking(false));
      client.on('update', (update: unknown) => {
        const transcript = (update as { transcript?: Array<{ role: string; content: string }> })?.transcript;
        if (!Array.isArray(transcript)) return;
        for (let i = transcript.length - 1; i >= 0; i--) {
          const turn = transcript[i];
          if (turn?.role === 'agent' && typeof turn.content === 'string') {
            lastAgentMessageRef.current = turn.content;
            break;
          }
        }
      });
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
    if (!cbConsent) {
      setCbError('Bitte bestätige zuerst den Demo-Datenschutzhinweis.');
      return;
    }
    setCbLoading(true);
    setCbError(null);
    try {
      // Audit-Round-10 LOW: 10 s timeout so a hung backend can't freeze the
      // button. Audit-Round-11 BLOCKER (Codex): check response.ok — the prior
      // version always set cbSent=true in finally, so 4xx/5xx (rate-limit,
      // bad phone-prefix, captcha-fail) silently showed "we'll call you" to
      // the user. Now show an error message on non-2xx so the user can
      // actually retry.
      const res = await fetch('/api/demo/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: cbName, email: cbEmail, phone: cbPhone, privacyConsent: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        let serverMsg = '';
        try {
          const body = await res.json() as { error?: string };
          serverMsg = body?.error ?? '';
        } catch { /* non-JSON body */ }
        if (res.status === 429) {
          setCbError('Zu viele Anfragen. Bitte versuche es in ein paar Minuten erneut.');
        } else if (res.status >= 400 && res.status < 500) {
          setCbError(serverMsg || 'Eingaben prüfen — wir konnten den Rückruf nicht anlegen.');
        } else {
          setCbError('Server-Fehler. Bitte versuche es kurz später erneut.');
        }
        return;
      }
      setCbSent(true);
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'AbortError' || name === 'TimeoutError') {
        setCbError('Verbindung zu langsam. Bitte versuche es nochmal.');
      } else {
        setCbError('Netzwerkfehler. Bitte versuche es nochmal.');
      }
    } finally {
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

  // Audit-Round-11 MED (Codex P2): a11y — Esc-to-close, focus-trap, restore
  // focus on unmount. role/aria-modal go on the inner panel below.
  // Audit-Round-12 BLOCKER (review-pass): the Esc handler must call
  // stopActiveCall() *directly* through the ref instead of going through
  // handleClose(), because handleClose closes over `callState` and a `[]`
  // dep array would freeze that closure at the initial 'idle' state — Esc
  // during an active call would then skip stopCall() and leave the mic on.
  // Refs (clientRef) and props (onClose) are reference-stable, so the
  // handler can safely use them without re-running the effect.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previouslyFocused = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Always idempotent — stopCall on a null ref is a no-op.
        if (clientRef.current) {
          try { clientRef.current.stopCall(); } catch { /* ignore */ }
          clientRef.current = null;
        }
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!first || !last) return;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    // Focus first interactive element shortly after mount.
    queueMicrotask(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled])',
      );
      first?.focus();
    });
    return () => {
      document.removeEventListener('keydown', handleKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chipy-demo-modal-title"
        className="relative w-full max-w-md glass-strong rounded-3xl overflow-hidden fade-up max-h-[90vh] overflow-y-auto"
        style={{ boxShadow: '0 0 80px rgba(249,115,22,0.15), 0 0 0 1px rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={handleClose}
          aria-label="Schließen"
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all"
        >
          ✕
        </button>

        {/* Header — Chipy intro */}
        <div className="px-6 pt-8 pb-4 text-center">
          <FoxLogo size="lg" glow animate className="mx-auto mb-3" />
          <h2 id="chipy-demo-modal-title" className="text-xl font-bold text-white">Hey! Ich bin Chipy</h2>
          <p className="text-sm text-white/50 mt-1">
            Dein KI-Telefonassistent. Hör rein wie ich für verschiedene Branchen arbeite — oder lass dich zurückrufen.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mx-6 mb-4 bg-white/5 rounded-xl p-1">
          <button
            onClick={() => switchTab('webcall')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'webcall' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            Demos anhören
          </button>
          <button
            onClick={() => switchTab('callback')}
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
                <label className="mb-3 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/45">
                  <input
                    type="checkbox"
                    checked={webConsent}
                    onChange={(e) => setWebConsent(e.target.checked)}
                    className="mt-0.5 accent-orange-500"
                  />
                  <span>
                    Ich bin einverstanden, dass diese Demo als Audio/Transkript verarbeitet und bis zu 90 Tage zur Demo-Qualität und Lead-Bearbeitung gespeichert wird. Der Agent weist zu Beginn zusätzlich auf KI und Aufzeichnung hin.
                  </span>
                </label>
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
                      <span className="text-orange-300 text-sm font-medium">Chipy spricht…</span>
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
                  Chipy ruft dich an — direkt auf dein Handy. Erlebe Phonbot in deinem echten Umfeld.
                </p>
                <form onSubmit={submitCallback} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-white/50 mb-1">Name</label>
                    <input type="text" required value={cbName}
                      onChange={(e) => { setCbName(e.target.value); if (cbError) setCbError(null); }}
                      placeholder="Max Mustermann"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-white/50 mb-1">E-Mail</label>
                    <input type="email" required value={cbEmail}
                      onChange={(e) => { setCbEmail(e.target.value); if (cbError) setCbError(null); }}
                      placeholder="max@firma.de"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-white/50 mb-1">Telefon</label>
                    <input type="tel" required value={cbPhone}
                      onChange={(e) => { setCbPhone(e.target.value); if (cbError) setCbError(null); }}
                      placeholder="+49 170 1234567"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all" />
                  </div>
                  <label className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/45">
                    <input
                      type="checkbox"
                      checked={cbConsent}
                      onChange={(e) => { setCbConsent(e.target.checked); if (cbError) setCbError(null); }}
                      required
                      className="mt-0.5 accent-orange-500"
                    />
                    <span>
                      Ich bin einverstanden, dass Chipy mich für die Demo anruft und der Demo-Anruf als Audio/Transkript bis zu 90 Tage zur Demo-Qualität und Lead-Bearbeitung gespeichert wird.
                    </span>
                  </label>
                  <button type="submit" disabled={cbLoading}
                    className="w-full py-3.5 rounded-2xl font-bold text-white text-sm transition-all hover:scale-[1.02] disabled:opacity-50 mt-1"
                    style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>
                    {cbLoading ? '…' : 'Chipy soll mich anrufen'}
                  </button>
                  {cbError && (
                    <p className="text-sm text-red-400 text-center mt-2" role="alert">{cbError}</p>
                  )}
                </form>
                <p className="text-xs text-white/25 text-center mt-3">Kein Spam. Daten nur für den Demo-Anruf.</p>
              </>
            ) : (
              <div className="text-center py-4">
                <FoxLogo size="lg" glow animate className="mx-auto mb-4" />
                <h3 className="text-lg font-bold text-white mb-2">Chipy ruft dich an!</h3>
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
