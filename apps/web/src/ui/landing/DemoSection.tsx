import React, { useState, useRef, useEffect } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { createDemoCall } from '../../lib/api.js';
import { useWebCallCleanup } from '../../lib/use-web-call-cleanup.js';
import { FoxLogo } from '../FoxLogo.js';
import { IconPhone } from '../PhonbotIcons.js';
import { TurnstileWidget, type TurnstileHandle } from '../TurnstileWidget.js';
import { TEMPLATES, TEMPLATE_PREVIEWS, type CallState } from './shared.js';
import { playForwardingTone, looksLikeForwarding } from '../../lib/demo-tones.js';

// ── Sub-components ─────────────────────────────────────────────────────────

function WaveformViz({ active }: { active: boolean }) {
  return (
    <div className={`waveform-container my-8 px-4 ${active ? 'waveform-active' : ''}`}>
      <svg viewBox="0 0 1200 80" preserveAspectRatio="none" className="w-full h-20">
        <path className="wave wave-1" d="M0,40 C150,10 300,70 450,40 C600,10 750,70 900,40 C1050,10 1200,70 1200,40" />
        <path className="wave wave-2" d="M0,40 C200,15 350,65 500,40 C650,15 800,65 950,40 C1100,15 1200,55 1200,40" />
        <path className="wave wave-3" d="M0,40 C100,20 250,60 400,40 C550,20 700,60 850,40 C1000,20 1150,60 1200,40" />
      </svg>
    </div>
  );
}

type TemplateCardProps = {
  template: { id: string; slug: string; Icon: React.ComponentType<{ size?: number; className?: string }>; name: string; description: string };
  onDemoStart: () => void;
};

function TemplateCard({ template, onDemoStart }: TemplateCardProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="gradient-border group relative flex h-full w-full max-w-sm flex-col items-center gap-4 p-8 rounded-2xl glass
        hover:bg-white/10 hover:shadow-[0_0_40px_rgba(249,115,22,0.3)]
        hover:scale-[1.03] transition-all duration-300 text-center"
      style={{ zIndex: hovered ? 30 : 1 }}
    >
      {/* Whole card clickable → sub-page (primary action) */}
      <a
        href={`/${template.slug}/`}
        className="absolute inset-0 z-10 rounded-2xl"
        aria-label={`Mehr über Phonbot für ${template.name}`}
      />

      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(6,182,212,0.15))',
          border: '1px solid rgba(249,115,22,0.15)',
        }}
      >
        <template.Icon size={28} className="text-white/70 group-hover:text-orange-300 transition-colors" />
      </div>
      <div>
        <p className="font-bold text-base text-white mb-1 group-hover:text-orange-300 transition-colors">{template.name}</p>
        <p className="text-xs text-white/45 leading-snug">{template.description}</p>
      </div>

      {/* Speech bubble preview */}
      <div
        style={{
          opacity: hovered ? 1 : 0,
          position: 'absolute',
          bottom: '-3.5rem',
          left: '50%',
          transform: hovered ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(6px)',
          transition: 'all 0.25s ease',
          zIndex: 50,
          minWidth: '220px',
          pointerEvents: 'none',
        }}
      >
        <div className="glass-strong rounded-xl px-3 py-2 text-xs text-white/70 italic text-center relative">
          <div
            className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45"
            style={{
              background: 'rgba(255,255,255,0.08)',
              borderTop: '1px solid rgba(255,255,255,0.15)',
              borderLeft: '1px solid rgba(255,255,255,0.15)',
            }}
          />
          {TEMPLATE_PREVIEWS[template.id]}
        </div>
      </div>

      {/* Secondary action: direct demo without page navigation */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDemoStart();
        }}
        className="relative z-20 mt-1 inline-flex items-center gap-1 text-xs font-medium text-orange-400/80 hover:text-orange-300 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/20 transition-all"
      >
        ▶ Demo jetzt starten
      </button>
    </div>
  );
}

// ── Main DemoSection ──────────────────────────────────────────────────────

type DemoSectionProps = {
  onGoToRegister: () => void;
};

export function DemoSection({ onGoToRegister }: DemoSectionProps) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [agentTalking, setAgentTalking] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoConsent, setDemoConsent] = useState(false);
  // Symmetric 6-card layout (2026-04-25): mit dem 6. Template (Mein Agent)
  // gehen 2+3 nicht mehr sauber auf — der zweite slice(2) wäre 4 Karten in
  // einem 3-Spalten-Grid → 3+1 hängt asymmetrisch. Wir konsolidieren auf
  // EIN Grid mit allen 6 Templates: 2×3 auf Tablet, 3×2 auf Desktop.
  const allTemplates = TEMPLATES;
  // Cloudflare Turnstile token (cleared on expiry/reset). Empty string = no
  // token yet → demo button stays disabled in prod. Dev without site-key
  // configured: widget renders nothing, token stays '' but backend skips.
  // Turnstile in "execute" mode: widget renders invisibly, challenge only
  // runs when user actually clicks a template (= the risky action). Casual
  // page-readers never see or interact with Cloudflare.
  const turnstileHandleRef = useRef<TurnstileHandle>(null);
  const clientRef = useRef<RetellWebClient | null>(null);
  // Last agent message — set on every transcript update from Retell, read in
  // the call_ended handler to decide whether to play a forwarding ringback.
  const lastAgentMessageRef = useRef<string>('');
  useWebCallCleanup(clientRef);

  const isInCall = callState === 'connecting' || callState === 'active' || callState === 'ended' || callState === 'error';

  async function handleTemplateClick(templateId: string) {
    if (callState === 'active' || callState === 'connecting') return;
    if (!demoConsent) {
      setActiveTemplate(null);
      setError('Bitte bestätige zuerst den Demo-Datenschutzhinweis.');
      setCallState('error');
      return;
    }
    setActiveTemplate(templateId);
    setCallState('connecting');
    setError(null);

    try {
      // iOS Safari verliert den user-gesture nach jedem await — wenn wir den
      // Mic-Prompt erst nach dem Token-Fetch aufrufen, wird er stumm verworfen
      // und Retell hängt beim Verbinden. Deshalb Mic-Permission SYNCHRON hier,
      // bevor irgendein await läuft.
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

      // Execute Turnstile challenge ON-DEMAND — only when user actually
      // clicks a template. Casual page-readers never trigger it.
      let token = '';
      try {
        token = await (turnstileHandleRef.current?.execute() ?? Promise.resolve(''));
      } catch {
        // Turnstile unavailable (ad-blocker, network, timeout) — proceed
        // without token. Backend will still enforce rate-limit + global-cap.
      }

      const res = await createDemoCall(templateId, token || undefined, true);
      if (!res.access_token) {
        throw new Error('Kein Zugriffstoken erhalten');
      }

      const client = new RetellWebClient();
      clientRef.current = client;

      client.on('call_started', () => setCallState('active'));
      client.on('call_ended', () => {
        // If the agent's last utterance was a forwarding announcement
        // ("Ich verbinde dich gleich"), play a brief ringback so the demo
        // feels like a real switch-over before the UI flips to the ended state.
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
      client.on('error', (err: unknown) => {
        setError(String(err));
        setCallState('error');
        setAgentTalking(false);
      });

      await client.startCall({ accessToken: res.access_token });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unbekannter Fehler';
      if (msg.includes('429') || msg.includes('Rate limit') || msg.includes('Too Many')) {
        setError('Du hast die Demo schon mehrfach getestet — probier es in einer Stunde nochmal oder registriere dich kostenlos für unbegrenzte Tests.');
      } else if (msg.includes('403') || msg.includes('captcha_failed')) {
        setError('Sicherheitscheck lädt noch — bitte in ein paar Sekunden nochmal versuchen.');
      } else {
        setError(msg);
      }
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
    setActiveTemplate(null);
    setError(null);
    setAgentTalking(false);
  }

  // Audit-Round-10 HIGH: stale-closure-fix. The previous useEffect captured
  // handleTemplateClick at first render; subsequent re-renders (callState
  // changed, error set) created a new handleTemplateClick whose `callState`
  // guard saw STALE state when invoked from the persistent event listener.
  // Pattern: ref always points at the latest function, listener calls
  // ref.current() — listener only registers once, but always reaches the
  // current callback closure. Also tracks pending timers so React-unmount
  // doesn't fire setState on a dead component.
  const handleTemplateClickRef = useRef(handleTemplateClick);
  useEffect(() => { handleTemplateClickRef.current = handleTemplateClick; });

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const triggerFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const demoTemplate = params.get('demo');
      if (!demoTemplate || !TEMPLATES.some((t) => t.id === demoTemplate)) return;
      timers.push(setTimeout(() => {
        document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        timers.push(setTimeout(() => handleTemplateClickRef.current(demoTemplate), 800));
      }, 300));
      // Clean up URL so reload / re-emit doesn't re-trigger
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', newUrl);
    };
    triggerFromUrl();
    window.addEventListener('phonbot:demo-param-updated', triggerFromUrl);
    return () => {
      window.removeEventListener('phonbot:demo-param-updated', triggerFromUrl);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <>
      {/* ── WAVEFORM VIZ (between hero and demo) ── */}
      <WaveformViz active={callState === 'active' && agentTalking} />

      {/* ── DEMO SECTION ── */}
      <section id="demo" className="relative z-10 px-6 py-20 max-w-5xl mx-auto ambient-glow-alt ambient-glow">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4 flex-wrap">
            <h2 className="text-3xl sm:text-4xl font-extrabold">
              Hör <span style={{ color: '#F97316' }}>Chipy</span> zu — wähle dein Business
            </h2>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-white bg-red-500/20 border border-red-500/30 rounded-full px-3 py-1">
              <span className="breathe inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />
              LIVE
            </span>
          </div>
          <p className="text-white/60 text-lg max-w-xl mx-auto">
            Kein Account nötig. Einfach klicken, sprechen, überzeugen lassen.
          </p>
          {/* Cloudflare Turnstile — invisible, execute-on-demand. Only triggers
              when user clicks a template (= the expensive action). Casual
              page-readers never see or interact with Cloudflare. */}
          <TurnstileWidget ref={turnstileHandleRef} mode="execute" theme="dark" />
        </div>

        {/* Template grid — shown when idle or error */}
        {!isInCall && (
          <div style={{ overflow: 'visible' }}>
            {/* How it works inline hint */}
            <div className="flex items-center justify-center gap-6 mb-8 flex-wrap">
              {[
                { step: '1', label: 'Business klicken' },
                { step: '2', label: 'Mikrofon erlauben' },
                { step: '3', label: 'Chipy live hören' },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-white/50">
                  <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/70">{s.step}</span>
                  {s.label}
                  {i < 2 && <span className="text-white/20 ml-2">→</span>}
                </div>
              ))}
            </div>
            <label className="mx-auto mb-8 flex max-w-2xl items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-xs text-white/45">
              <input
                type="checkbox"
                checked={demoConsent}
                onChange={(e) => setDemoConsent(e.target.checked)}
                className="mt-0.5 accent-orange-500"
              />
              <span>
                Ich bin einverstanden, dass diese Demo als Audio/Transkript verarbeitet und bis zu 90 Tage zur Demo-Qualität und Lead-Bearbeitung gespeichert wird. Der Agent weist zu Beginn zusätzlich auf KI und Aufzeichnung hin.
              </span>
            </label>
            <div className="flex flex-col items-center gap-4 sm:gap-5 lg:gap-6 pb-10" style={{ overflow: 'visible' }}>
              <div className="grid w-full max-w-5xl grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-16 justify-items-center" style={{ overflow: 'visible' }}>
                {allTemplates.map((t) => (
                  <TemplateCard key={t.id} template={t} onDemoStart={() => handleTemplateClick(t.id)} />
                ))}
              </div>
            </div>
            {/* Reassurance */}
            <p className="text-center text-xs text-white/35 mt-2">
              🔒 Keine Weitergabe an Dritte — Demo-Daten nur für Qualität und deine Anfrage
            </p>
            {/* Mic hint */}
            <p className="text-center text-xs text-white/30 mt-2 italic">
              Dein Mikrofon wird benötigt — das Gespräch dauert ca. 30 Sekunden.
            </p>
          </div>
        )}

        {/* Call state card */}
        {isInCall && (
          <div className="fade-up flex justify-center">
            <div
              className="glass-strong rounded-3xl p-10 max-w-md w-full text-center"
              style={{ boxShadow: '0 0 60px rgba(249,115,22,0.15), 0 0 120px rgba(6,182,212,0.08)' }}
            >
              {/* Connecting */}
              {callState === 'connecting' && (
                <>
                  <div className="flex items-center justify-center gap-3 mb-4 text-orange-300">
                    <span className="w-6 h-6 rounded-full border-2 border-orange-400 border-t-transparent spin inline-block" />
                    <span className="font-medium">Verbinde…</span>
                  </div>
                  <p className="text-white/50 text-sm">
                    Starte {TEMPLATES.find((t) => t.id === activeTemplate)?.name}-Agent
                  </p>
                </>
              )}

              {/* Active */}
              {callState === 'active' && (
                <>
                  <div className={`relative mx-auto mb-6 ${agentTalking ? 'mic-pulse' : ''}`}>
                    {agentTalking && (
                      <>
                        <div className="sound-ring" />
                        <div className="sound-ring" />
                        <div className="sound-ring" />
                      </>
                    )}
                    <FoxLogo size="xl" glow animate={agentTalking} />
                  </div>
                  <div className="flex items-center justify-center gap-2 mb-6">
                    {agentTalking ? (
                      <>
                        <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 breathe inline-block" />
                        <span className="text-cyan-300 text-sm font-medium">Agent spricht…</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-400 breathe inline-block" />
                        <span className="text-orange-300 text-sm font-medium">Warte auf dich…</span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={stopCall}
                    className="flex items-center justify-center gap-2 mx-auto rounded-full bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 px-8 py-3 text-red-300 text-sm font-medium transition-all duration-200 hover:scale-105"
                  >
                    <IconPhone size={16} className="opacity-70" />
                    Auflegen
                  </button>
                </>
              )}

              {/* Ended */}
              {callState === 'ended' && (
                <>
                  <FoxLogo size="xl" glow className="mx-auto mb-4" />
                  <h3 className="text-2xl font-bold mb-2">Wie war dein Agent?</h3>
                  <p className="text-white/60 text-sm mb-8">
                    Erstelle jetzt deinen eigenen, personalisierten Agenten — in unter 2 Minuten.
                  </p>
                  <button
                    onClick={onGoToRegister}
                    className="w-full rounded-xl px-6 py-3.5 font-semibold text-white transition-all duration-300 hover:shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:scale-[1.02]"
                    style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                  >
                    Jetzt eigenen Agenten erstellen →
                  </button>
                  <button
                    onClick={resetCall}
                    className="mt-4 text-sm text-white/40 hover:text-white/60 transition-colors"
                  >
                    Nochmal testen
                  </button>
                </>
              )}

              {/* Error */}
              {callState === 'error' && error && (
                <>
                  <div className="text-4xl mb-4 flex justify-center">
                    <span className="text-amber-400/80 text-4xl font-bold">
                      {error.includes('429') || error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('too many requests')
                        ? '!' : '×'}
                    </span>
                  </div>
                  {error.includes('429') || error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('too many requests') ? (
                    <>
                      <p className="text-amber-300 text-sm font-medium mb-2">
                        Du hast die Demo-Grenze erreicht (3 Anrufe/Stunde).
                      </p>
                      <p className="text-white/50 text-sm mb-6">
                        Melde dich an um unbegrenzt zu testen!
                      </p>
                      <button
                        onClick={onGoToRegister}
                        className="w-full rounded-xl px-6 py-3 font-semibold text-white text-sm mb-3 transition-all duration-200 hover:opacity-90"
                        style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
                      >
                        Jetzt anmelden →
                      </button>
                      <button
                        onClick={resetCall}
                        className="text-sm text-white/40 hover:text-white/60 underline transition-colors"
                      >
                        Zurück zu den Templates
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-red-300 text-sm mb-6">{error}</p>
                      <button
                        onClick={resetCall}
                        className="text-sm text-white/50 hover:text-white underline transition-colors"
                      >
                        Zurück zu den Templates
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
