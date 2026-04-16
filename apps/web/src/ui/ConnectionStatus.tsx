import { useState, useEffect } from 'react';

/**
 * Non-blocking banner that shows when the user is offline or the API
 * is unreachable. Overlays the top of the page without hiding content.
 *
 * - navigator.onLine → "Keine Internetverbindung"
 * - Periodic /health ping fails → "Server nicht erreichbar"
 * - Auto-hides when connection is restored.
 */

type Status = 'online' | 'offline' | 'api-down';

const HEALTH_URL = '/api/health';
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;

export function ConnectionStatus() {
  const [status, setStatus] = useState<Status>('online');

  useEffect(() => {
    function goOffline() { setStatus('offline'); }
    function goOnline() { setStatus((prev) => prev === 'offline' ? 'online' : prev); }

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    if (!navigator.onLine) setStatus('offline');

    // Periodic health ping — only when tab is visible (save battery/bandwidth)
    let timer: ReturnType<typeof setInterval> | null = null;

    async function ping() {
      if (!navigator.onLine) return;
      try {
        const res = await fetch(HEALTH_URL, {
          method: 'GET',
          signal: AbortSignal.timeout(PING_TIMEOUT_MS),
          cache: 'no-store',
        });
        if (res.ok) {
          setStatus('online');
        } else {
          setStatus('api-down');
        }
      } catch {
        setStatus('api-down');
      }
    }

    function startPolling() {
      if (timer) return;
      ping();
      timer = setInterval(ping, PING_INTERVAL_MS);
    }
    function stopPolling() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    // Only poll when tab is visible
    function handleVisibility() {
      if (document.hidden) { stopPolling(); } else { startPolling(); }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    if (!document.hidden) startPolling();

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      stopPolling();
    };
  }, []);

  if (status === 'online') return null;

  const config = status === 'offline'
    ? { bg: 'bg-red-500/90', text: 'Keine Internetverbindung — Funktionen eingeschränkt.' }
    : { bg: 'bg-yellow-500/90', text: 'Server nicht erreichbar — wird automatisch erneut versucht.' };

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[9999] ${config.bg} text-white text-center text-sm font-medium py-2 px-4 shadow-lg`}
      role="alert"
    >
      {config.text}
    </div>
  );
}
