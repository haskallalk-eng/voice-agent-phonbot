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
        delete event.request.headers['x-api-key'];
        delete event.request.headers['x-retell-signature'];
      }
      // Strip request bodies entirely — can contain passwords, JWTs, OAuth codes,
      // customer transcripts (PII), webhook secrets, etc. Never ship to Sentry.
      if (event.request) delete event.request.data;
      if (event.request) delete event.request.query_string;
      // Same for breadcrumb HTTP data
      event.breadcrumbs?.forEach((b) => {
        if (b.data) {
          delete (b.data as Record<string, unknown>)['body'];
          delete (b.data as Record<string, unknown>)['request_body'];
          delete (b.data as Record<string, unknown>)['response_body'];
        }
      });
      return event;
    },
  });
}

export { Sentry };
