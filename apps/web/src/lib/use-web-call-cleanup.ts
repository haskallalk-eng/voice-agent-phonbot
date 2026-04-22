import { useEffect } from 'react';
import type { RetellWebClient } from 'retell-client-js-sdk';

/**
 * Auto-hang-up any active Retell web call when the page is unloaded,
 * refreshed, or closed. Without this, closing a tab mid-call leaves
 * the Retell call running until the 60s silence timeout — the caller
 * burns minutes and Chipy keeps talking into void.
 *
 * pagehide fires on iOS Safari where beforeunload is a no-op; we
 * register both. React's component-unmount cleanup already handles
 * in-app navigation, so this hook only adds coverage for actual
 * page unload.
 */
export function useWebCallCleanup(clientRef: { current: RetellWebClient | null }) {
  useEffect(() => {
    const hangup = () => {
      try {
        clientRef.current?.stopCall();
      } catch {
        // ignore — page is going away, best effort
      }
    };
    window.addEventListener('pagehide', hangup);
    window.addEventListener('beforeunload', hangup);
    return () => {
      window.removeEventListener('pagehide', hangup);
      window.removeEventListener('beforeunload', hangup);
    };
  }, [clientRef]);
}
