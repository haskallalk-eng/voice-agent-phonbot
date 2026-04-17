import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { App } from './ui/App.js';

// Optional Sentry integration — set VITE_SENTRY_DSN in apps/web/.env to enable
// VITE_SENTRY_DSN=https://your-dsn@sentry.io/project
// Respect cookie consent: only init Sentry when the user accepted all cookies
// ("necessary" choice excludes non-essential tools like error tracking).
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const cookieConsent = localStorage.getItem('phonbot_cookie_consent');
if (SENTRY_DSN && cookieConsent === 'accepted') {
  // Dynamic import to avoid bundle bloat when not configured.
  // Install @sentry/react to enable: pnpm add @sentry/react
  const sentryModule = '@sentry/react';
  // Mirror backend PII filter (apps/api/src/sentry.ts). DSGVO Art. 5(c):
  // strip request bodies/cookies/auth headers, anonymize user context,
  // drop breadcrumb body payloads. Frontend errors must not leak JWT,
  // refresh-cookie, customer transcripts, etc. into Sentry storage.
  type SentryEvent = {
    request?: { headers?: Record<string, unknown>; data?: unknown; query_string?: unknown; cookies?: unknown };
    user?: { id?: string; email?: string; ip_address?: string; username?: string };
    breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
  };
  const beforeSend = (event: SentryEvent) => {
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
      delete event.request.headers['x-api-key'];
    }
    if (event.request) {
      delete event.request.data;
      delete event.request.query_string;
      delete event.request.cookies;
    }
    if (event.user) {
      const uid = event.user.id;
      event.user = uid ? { id: uid } : undefined;
    }
    event.breadcrumbs?.forEach((b) => {
      if (b.data) {
        delete b.data['body'];
        delete b.data['request_body'];
        delete b.data['response_body'];
        delete b.data['cookies'];
      }
    });
    return event;
  };
  import(/* @vite-ignore */ sentryModule).then((mod: { init?: (opts: Record<string, unknown>) => void }) => {
    mod.init?.({
      dsn: SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      beforeSend,
    });
  }).catch(() => {
    // Sentry not installed — silently ignore
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
