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
        delete event.request.headers['stripe-signature'];
        delete event.request.headers['x-forwarded-for']; // PII (caller IP)
      }
      // Strip request bodies entirely — can contain passwords, JWTs, OAuth codes,
      // customer transcripts (PII), webhook secrets, etc. Never ship to Sentry.
      if (event.request) {
        delete event.request.data;
        delete event.request.query_string;
        delete event.request.cookies;
      }
      // Drop user-context that Sentry auto-attaches (email, ip_address, username)
      // — DSGVO Art. 5(c) data minimisation. Keep only an opaque internal id.
      if (event.user) {
        const uid = event.user.id;
        event.user = uid ? { id: uid } : undefined;
      }
      // Anonymise server-side IP echoes that some integrations attach.
      if (event.contexts?.runtime) delete event.contexts.runtime;
      // Same for breadcrumb HTTP data
      event.breadcrumbs?.forEach((b) => {
        if (b.data) {
          delete (b.data as Record<string, unknown>)['body'];
          delete (b.data as Record<string, unknown>)['request_body'];
          delete (b.data as Record<string, unknown>)['response_body'];
          delete (b.data as Record<string, unknown>)['cookies'];
        }
      });
      return event;
    },
    // Don't auto-collect PII fields. Setting `sendDefaultPii: false` (Sentry
    // default) is implicit, but we make it explicit so the intent is reviewable.
    sendDefaultPii: false,
  });
}

export { Sentry };
