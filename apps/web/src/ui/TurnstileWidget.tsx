import { useEffect, useRef } from 'react';

// Cloudflare Turnstile widget wrapper.
//
// Usage:
//   <TurnstileWidget onToken={(t) => setToken(t)} />
//
// Renders the Turnstile script (loaded once per page, idempotent) and a
// container div that Turnstile fills in. Calls onToken(token) when the
// challenge passes; calls onToken('') when the token expires (Turnstile
// auto-expires after ~5min, the user has to re-do the challenge).
//
// The site key comes from VITE_TURNSTILE_SITE_KEY at build time. If it's
// unset, we render nothing (and the backend's verifyTurnstile() will allow
// requests through in dev where TURNSTILE_SECRET_KEY is also unset).

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        opts: {
          sitekey: string;
          theme?: 'light' | 'dark' | 'auto';
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  if (typeof document === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      // already loading — wait for it
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('turnstile script failed to load')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile script failed to load'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function TurnstileWidget({
  onToken,
  theme = 'auto',
}: {
  onToken: (token: string) => void;
  theme?: 'light' | 'dark' | 'auto';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          theme,
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        });
      })
      .catch(() => {/* widget unavailable — backend will allow in dev, fail in prod */});
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
        widgetIdRef.current = null;
      }
    };
  }, [onToken, theme]);

  // If site key isn't configured (dev without Cloudflare) render nothing —
  // the form still works because the backend skips verification when its own
  // TURNSTILE_SECRET_KEY is unset.
  if (!SITE_KEY) return null;
  return <div ref={containerRef} className="cf-turnstile-container my-3" />;
}
