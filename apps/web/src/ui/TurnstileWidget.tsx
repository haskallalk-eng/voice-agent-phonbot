import { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';

// Cloudflare Turnstile widget — supports two modes:
//
// 1. "managed" (default): renders visibly, auto-starts challenge, calls
//    onToken when done. Good for forms where the user is already committed.
//
// 2. "execute": runs on demand and remains visible for interactive checks. Parent calls
//    executeTurnstile() to trigger the challenge on-demand (e.g. when user
//    clicks "Demo starten"). Returns a Promise<string> with the token.
//    This is the mode the user requested: "erst wenn die risikoreiche
//    Aktion passiert, nicht wenn jemand nur die Website liest."

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
      execute: (widgetId: string) => void;
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
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('turnstile script failed')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile script failed'));
    document.head.appendChild(s);
  });
  scriptPromise = scriptPromise.catch(error => {
    document.querySelector(`script[src="${SCRIPT_SRC}"]`)?.remove();
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  execute: () => Promise<string>;
}

type Props = {
  onToken?: (token: string) => void;
  theme?: 'light' | 'dark' | 'auto';
  mode?: 'managed' | 'execute';
};

export const TurnstileWidget = forwardRef<TurnstileHandle, Props>(
  function TurnstileWidget({ onToken, theme = 'auto', mode = 'managed' }, ref) {
    const [initializationAttempt, setInitializationAttempt] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const pendingRef = useRef<{
      resolve: (token: string) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    } | null>(null);

    const finish = useCallback((token?: string) => {
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      clearTimeout(pending.timer);
      if (token) pending.resolve(token);
      else pending.reject(new Error('Die Sicherheitsprüfung konnte nicht abgeschlossen werden. Bitte erneut versuchen.'));
    }, []);

    const handleCallback = useCallback((token: string) => {
      onToken?.(token);
      finish(token);
    }, [onToken, finish]);

    useEffect(() => {
      if (!SITE_KEY || !containerRef.current) return;
      let cancelled = false;
      loadScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: SITE_KEY,
            theme,
            execution: mode === 'execute' ? 'execute' : 'render',
            callback: (token: string) => handleCallback(token),
            appearance: mode === 'execute' ? 'interaction-only' : 'always',
            'expired-callback': () => { onToken?.(''); finish(); },
            'error-callback': () => { onToken?.(''); finish(); },
            'timeout-callback': () => { onToken?.(''); finish(); },
          });
        })
        .catch(() => {});
      return () => {
        cancelled = true;
        finish();
        if (widgetIdRef.current && window.turnstile) {
          try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
          widgetIdRef.current = null;
        }
      };
    }, [handleCallback, onToken, theme, mode, finish, initializationAttempt]);

    useImperativeHandle(ref, () => ({
      execute: () => new Promise<string>((resolve, reject) => {
        if (!SITE_KEY) {
          if (import.meta.env.PROD) reject(new Error('Die Sicherheitsprüfung ist derzeit nicht verfügbar.'));
          else resolve('');
          return;
        }
        if (!widgetIdRef.current || !window.turnstile) {
          setInitializationAttempt(attempt => attempt + 1);
          reject(new Error('Die Sicherheitsprüfung lädt noch. Bitte in Kürze erneut versuchen.'));
          return;
        }
        if (pendingRef.current) {
          reject(new Error('Die Sicherheitsprüfung läuft bereits.'));
          return;
        }
        try {
          // Every submission needs a fresh, single-use token, including retries.
          window.turnstile.reset(widgetIdRef.current);
          pendingRef.current = {
            resolve, reject, timer: setTimeout(() => finish(), 60_000),
          };
          window.turnstile.execute(widgetIdRef.current);
        } catch {
          if (pendingRef.current) finish();
          else reject(new Error('Die Sicherheitsprüfung ist derzeit nicht verfügbar.'));
        }
      }),
    }), [finish]);

    if (!SITE_KEY) return null;
    return (
      <div
        ref={containerRef}
        className="cf-turnstile-container"
        style={{ margin: '12px 0' }}
      />
    );
  },
);
