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

  useEffect(() => {
    document.documentElement.classList.toggle('has-cookie-banner', visible);
    return () => document.documentElement.classList.remove('has-cookie-banner');
  }, [visible]);

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
      className="fixed bottom-0 left-0 right-0 z-50 px-4 py-2 pb-safe sm:px-6 sm:py-5"
      style={{
        background: 'linear-gradient(180deg, rgba(5,5,8,0.02), rgba(5,5,8,0.94) 18%, rgba(5,5,8,0.98))',
        borderTop: '0',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 -22px 54px rgba(5,5,8,0.72)',
      }}
    >
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
        {/* Text */}
        <div className="flex-1 text-[11px] leading-snug text-white/72 sm:text-sm sm:leading-relaxed">
          <span className="sm:hidden">
            Notwendige Cookies und Sicherheitsdienste. Keine Marketing-Cookies.{' '}
          </span>
          <span className="hidden sm:inline">
            Wir verwenden technisch notwendige Cookies. Zur Fehlererkennung setzen wir Sentry ein
            (Error-Tracking, ohne personenbezogene Daten). Zur Bot-Absicherung von Formularen
            nutzen wir Cloudflare Turnstile (IP + Browser-Merkmale, keine Tracking-Cookies).
            Keine Marketing- oder Tracking-Cookies.{' '}
          </span>
          <button onClick={onShowDatenschutz} className="text-orange-400 hover:text-orange-300 underline cursor-pointer transition-colors">
            Datenschutz
          </button>
        </div>

        {/* Buttons */}
        <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto">
          <button
            onClick={handleNecessary}
            className="crystal-button crystal-button-secondary rounded-full px-3 py-1.5 text-xs font-medium text-white/70 transition-all hover:text-white sm:px-4 sm:py-2 sm:text-sm"
          >
            Nur notwendige
          </button>
          <button
            onClick={handleAccept}
            className="crystal-button rounded-full px-3 py-1.5 text-xs font-semibold text-white transition-all hover:scale-[1.03] sm:px-5 sm:py-2 sm:text-sm"
          >
            Akzeptieren
          </button>
        </div>
      </div>
    </div>
  );
}
