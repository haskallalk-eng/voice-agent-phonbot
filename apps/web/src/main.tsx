import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { App } from './ui/App.js';

// Optional Sentry integration — set VITE_SENTRY_DSN in apps/web/.env to enable
// VITE_SENTRY_DSN=https://your-dsn@sentry.io/project
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  // Dynamic import to avoid bundle bloat when not configured.
  // Install @sentry/react to enable: pnpm add @sentry/react
  const sentryModule = '@sentry/react';
  import(/* @vite-ignore */ sentryModule).then((mod: { init?: (opts: Record<string, unknown>) => void }) => {
    mod.init?.({
      dsn: SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: import.meta.env.MODE,
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
