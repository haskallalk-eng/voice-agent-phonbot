// Note: file named OwlyDemoModal for historical reasons, mascot is now "Chipy".
import React, { useEffect, useRef, useState } from 'react';
import { IconPhone } from './PhonbotIcons.js';
import {
  DEMO_PHONE_HREF,
  DEMO_PHONE_LABEL,
  TEMPLATES,
} from './landing/shared.js';

type ModalTab = 'call' | 'callback';

type Props = {
  onClose: () => void;
  onGoToRegister?: () => void;
};

function CrystalModalMark({ className = '' }: { className?: string }) {
  return (
    <div className={`crystal-demo-mark ${className}`} aria-hidden="true">
      <img src="/brand/phonbot-crystal-icon-cropped.png" alt="" className="h-12 w-12 object-contain" />
    </div>
  );
}

function PhoneTemplateGrid() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {TEMPLATES.map((template) => (
        <a
          key={template.id}
          href={DEMO_PHONE_HREF}
          className="group relative flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.04] p-3 text-left transition-all hover:border-orange-500/30 hover:bg-white/[0.08]"
        >
          <template.Icon size={20} className="shrink-0 text-white/60 transition-colors group-hover:text-orange-300" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white/80 group-hover:text-white">{template.name}</p>
            <p className="truncate text-[11px] text-white/30">{template.description}</p>
          </div>
        </a>
      ))}
    </div>
  );
}

export function OwlyDemoModal({ onClose, onGoToRegister }: Props) {
  const [tab, setTab] = useState<ModalTab>('call');

  const [cbEmail, setCbEmail] = useState('');
  const [cbPhone, setCbPhone] = useState('');
  const [cbName, setCbName] = useState('');
  const [cbSent, setCbSent] = useState(false);
  const [cbLoading, setCbLoading] = useState(false);
  const [cbError, setCbError] = useState<string | null>(null);
  const [cbConsent, setCbConsent] = useState(false);
  const [cbConsentNudge, setCbConsentNudge] = useState(false);
  const cbConsentRef = useRef<HTMLLabelElement | null>(null);
  const cbConsentInputRef = useRef<HTMLInputElement | null>(null);
  const consentNudgeTimerRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  function pulseConsent() {
    if (consentNudgeTimerRef.current) clearTimeout(consentNudgeTimerRef.current);
    setCbConsentNudge(false);
    window.setTimeout(() => setCbConsentNudge(true), 0);
    consentNudgeTimerRef.current = window.setTimeout(() => setCbConsentNudge(false), 560);
    queueMicrotask(() => {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      cbConsentRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });
      cbConsentInputRef.current?.focus({ preventScroll: true });
    });
  }

  async function submitCallback(e: React.FormEvent) {
    e.preventDefault();
    if (!cbConsent) {
      setCbError('Bitte bestätige zuerst den Demo-Datenschutzhinweis.');
      pulseConsent();
      return;
    }
    setCbLoading(true);
    setCbError(null);
    try {
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
        } catch {
          // Non-JSON error body.
        }
        if (res.status === 429) {
          setCbError('Zu viele Anfragen. Bitte versuche es in ein paar Minuten erneut.');
        } else if (res.status >= 400 && res.status < 500) {
          setCbError(serverMsg || 'Eingaben prüfen. Wir konnten den Rückruf nicht anlegen.');
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

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  useEffect(() => {
    const previouslyFocused = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
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
    queueMicrotask(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])');
      first?.focus();
    });
    return () => {
      if (consentNudgeTimerRef.current) clearTimeout(consentNudgeTimerRef.current);
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
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto overflow-x-hidden rounded-3xl glass-strong fade-up"
        style={{ boxShadow: '0 0 80px rgba(249,115,22,0.15), 0 0 0 1px rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Schliessen"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/60 transition-all hover:bg-white/20 hover:text-white"
        >
          x
        </button>

        <div className="px-6 pb-4 pt-8 text-center">
          <CrystalModalMark className="mx-auto mb-3" />
          <h2 id="chipy-demo-modal-title" className="text-xl font-bold text-white">Chipy live testen</h2>
          <p className="mt-1 text-sm text-white/50">
            Ruf direkt an oder lass dich zurückrufen. Die Demo läuft als echter Telefonanruf mit deiner Rufnummer.
          </p>
        </div>

        <div className="mx-6 mb-4 flex gap-1 rounded-xl bg-white/5 p-1">
          <button
            onClick={() => setTab('call')}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              tab === 'call' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            Direkt anrufen
          </button>
          <button
            onClick={() => setTab('callback')}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
              tab === 'callback' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            Rückruf
          </button>
        </div>

        {tab === 'call' && (
          <div className="px-6 pb-8">
            <a
              href={DEMO_PHONE_HREF}
              className="crystal-button mb-4 flex w-full items-center justify-center gap-3 rounded-2xl py-3.5 text-base font-bold text-white transition-all hover:scale-[1.02]"
            >
              <IconPhone size={20} className="opacity-85" />
              {DEMO_PHONE_LABEL}
            </a>
            <p className="mb-4 text-center text-xs leading-relaxed text-white/35">
              Am Smartphone einfach antippen. Beim Direktanruf klärt Chipy die Demo-Situation und Datenschutz-Hinweise im Telefonflow.
            </p>
            <PhoneTemplateGrid />
            {onGoToRegister && (
              <button
                onClick={() => { onClose(); onGoToRegister(); }}
                className="crystal-button crystal-button-secondary mt-5 w-full rounded-xl py-2.5 text-sm font-semibold text-white/70 transition-all hover:text-white"
              >
                Eigenen Agent erstellen
              </button>
            )}
          </div>
        )}

        {tab === 'callback' && (
          <div className="px-6 pb-8">
            {!cbSent ? (
              <>
                <p className="mb-5 text-center text-sm text-white/50">
                  Chipy ruft dich auf deiner echten Nummer an. Das ist der realistischste Demo-Test.
                </p>
                <form onSubmit={submitCallback} className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/50">Name</label>
                    <input
                      type="text"
                      required
                      value={cbName}
                      onChange={(e) => { setCbName(e.target.value); if (cbError) setCbError(null); }}
                      placeholder="Max Mustermann"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/25 transition-all focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/50">E-Mail</label>
                    <input
                      type="email"
                      required
                      value={cbEmail}
                      onChange={(e) => { setCbEmail(e.target.value); if (cbError) setCbError(null); }}
                      placeholder="max@firma.de"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/25 transition-all focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/50">Telefon</label>
                    <input
                      type="tel"
                      required
                      value={cbPhone}
                      onChange={(e) => { setCbPhone(e.target.value); if (cbError) setCbError(null); }}
                      placeholder="+49 170 1234567"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/25 transition-all focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                    />
                  </div>
                  <label
                    ref={cbConsentRef}
                    onAnimationEnd={() => setCbConsentNudge(false)}
                    className={`flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/45 ${cbConsentNudge ? 'consent-nudge' : ''}`}
                  >
                    <input
                      ref={cbConsentInputRef}
                      type="checkbox"
                      checked={cbConsent}
                      aria-describedby={cbError?.startsWith('Bitte bestätige') ? 'callback-demo-consent-error' : undefined}
                      onChange={(e) => { setCbConsent(e.target.checked); if (cbError) setCbError(null); }}
                      className="mt-0.5 accent-orange-500"
                    />
                    <span>
                      Ich bin einverstanden, dass Chipy mich für die Demo anruft und Phonbot die Anfrage zur Demo-Qualität und Lead-Bearbeitung verarbeitet.
                    </span>
                  </label>
                  <button
                    type="submit"
                    disabled={cbLoading}
                    className="crystal-button mt-1 w-full rounded-2xl py-3.5 text-sm font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
                  >
                    {cbLoading ? '...' : 'Chipy soll mich anrufen'}
                  </button>
                  {cbError && (
                    <p id="callback-demo-consent-error" className="mt-2 text-center text-sm text-red-400" role="alert">{cbError}</p>
                  )}
                </form>
                <p className="mt-3 text-center text-xs text-white/25">
                  Kein Spam. Daten nur für Demo, Lead-Bearbeitung und den angefragten Testlink.
                </p>
              </>
            ) : (
              <div className="py-4 text-center">
                <CrystalModalMark className="mx-auto mb-4" />
                <h3 className="mb-2 text-lg font-bold text-white">Chipy ruft dich an!</h3>
                <p className="mb-2 text-sm text-white/50">
                  Du erhältst in Kürze einen Anruf auf <strong className="text-white">{cbPhone}</strong>.
                </p>
                {onGoToRegister && (
                  <button
                    onClick={() => { onClose(); onGoToRegister(); }}
                    className="mt-4 text-sm font-medium text-orange-400 underline transition-colors hover:text-orange-300"
                  >
                    Oder direkt eigenen Agent erstellen
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
