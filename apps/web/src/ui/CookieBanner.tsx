import React, { useState, useEffect } from 'react';

// TTDSG-konforme Speicherung: der Banner wirkt nur über die Lebensdauer der
// Einwilligung — wir nutzen einen Cookie statt localStorage, damit das Verhalten
// auch im inkognito-Modus / über mehrere Tabs korrekt gleich ist und ein
// Server-seitiges Auslesen prinzipiell möglich bleibt (auch wenn wir es heute
// nicht tun). Cookie ist max-age 365 Tage, sameSite=lax, kein httpOnly (das
// Frontend muss ihn lesen), kein Secure-Flag in dev (sonst lokal nicht gesetzt).
const COOKIE_NAME = 'phonbot_cookie_consent';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 Jahr

function readConsent(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

function writeConsent(value: 'accepted' | 'necessary'): void {
  if (typeof document === 'undefined') return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax${secure}`;
}

export function CookieBanner({ onShowDatenschutz }: { onShowDatenschutz?: () => void } = {}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Migration: alte localStorage-Werte einmalig in den Cookie übertragen, dann löschen.
    let stored = readConsent();
    if (!stored) {
      const legacy = typeof localStorage !== 'undefined' ? localStorage.getItem(COOKIE_NAME) : null;
      if (legacy === 'accepted' || legacy === 'necessary') {
        writeConsent(legacy);
        try { localStorage.removeItem(COOKIE_NAME); } catch { /* private mode */ }
        stored = legacy;
      }
    }
    if (!stored) setVisible(true);
  }, []);

  function handleAccept() {
    writeConsent('accepted');
    setVisible(false);
  }

  function handleNecessary() {
    writeConsent('necessary');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 px-4 py-4 sm:px-6 sm:py-5"
      style={{
        background: 'rgba(15,15,24,0.85)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
      }}
    >
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* Text */}
        <div className="flex-1 text-sm text-white/70 leading-relaxed">
          Wir verwenden technisch notwendige Cookies. Zur Fehlererkennung setzen wir Sentry ein
          (Error-Tracking, ohne personenbezogene Daten). Zur Bot-Absicherung von Formularen
          nutzen wir Cloudflare Turnstile (IP + Browser-Merkmale, keine Tracking-Cookies).
          Keine Marketing- oder Tracking-Cookies.{' '}
          <button onClick={onShowDatenschutz} className="text-orange-400 hover:text-orange-300 underline cursor-pointer transition-colors">
            Datenschutz
          </button>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleNecessary}
            className="rounded-full px-4 py-2 text-sm font-medium text-white/60 hover:text-white transition-all"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            Nur notwendige
          </button>
          <button
            onClick={handleAccept}
            className="rounded-full px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 hover:scale-[1.03]"
            style={{
              background: 'linear-gradient(135deg, #f97316, #ea580c)',
              boxShadow: '0 0 18px rgba(249,115,22,0.35)',
            }}
          >
            Akzeptieren
          </button>
        </div>
      </div>
    </div>
  );
}
