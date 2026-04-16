import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';

// Cloudflare Turnstile widget — supports two modes:
//
// 1. "managed" (default): renders visibly, auto-starts challenge, calls
//    onToken when done. Good for forms where the user is already committed.
//
// 2. "execute": renders invisibly (0×0), does NOT auto-start. Parent calls
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
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const resolveRef = useRef<((token: string) => void) | null>(null);

    const handleCallback = useCallback((token: string) => {
      onToken?.(token);
      resolveRef.current?.(token);
      resolveRef.current = null;
    }, [onToken]);

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
            'expired-callback': () => { onToken?.(''); },
            'error-callback': () => { onToken?.(''); },
          });
        })
        .catch(() => {});
      return () => {
        cancelled = true;
        if (widgetIdRef.current && window.turnstile) {
          try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
          widgetIdRef.current = null;
        }
      };
    }, [handleCallback, onToken, theme, mode]);

    useImperativeHandle(ref, () => ({
      execute: () => new Promise<string>((resolve, reject) => {
        if (!SITE_KEY) { resolve(''); return; }
        if (!widgetIdRef.current || !window.turnstile) {
          reject(new Error('turnstile not ready'));
          return;
        }
        resolveRef.current = resolve;
        window.turnstile.execute(widgetIdRef.current);
        setTimeout(() => {
          if (resolveRef.current) {
            resolveRef.current = null;
            reject(new Error('turnstile timeout'));
          }
        }, 10_000);
      }),
    }), []);

    if (!SITE_KEY) return null;
    return (
      <div
        ref={containerRef}
        className="cf-turnstile-container"
        style={mode === 'execute' ? { position: 'absolute', width: 0, height: 0, overflow: 'hidden' } : { margin: '12px 0' }}
      />
    );
  },
);
