import * as Sentry from '@sentry/node';
import './env.js';

const SENTRY_DSN = process.env.SENTRY_DSN ?? '';

export function initSentry() {
  if (!SENTRY_DSN) {
    // SENTRY_DSN not set — error tracking disabled (expected in dev)
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
    beforeSend(event: Sentry.ErrorEvent) {
      // Strip sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
      }
      return event;
    },
  });
}

export { Sentry };
