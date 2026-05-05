import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export const LEGAL_DOCUMENTS = {
  terms: {
    key: 'agb',
    title: 'Allgemeine Geschaeftsbedingungen',
    version: '2026-05-05',
    path: '/agb/',
    sha256: '63c3a3f02ce74cffead135c824bba1241b0b1bf226ce12e8c4655b2d6b30c3de',
  },
  privacy: {
    key: 'datenschutz',
    title: 'Datenschutzerklaerung',
    version: '2026-05-05',
    path: '/datenschutz/',
    sha256: 'bb1af8cfeb998adc896ba30b9fd3de1391b0a2692c44f267cbcdeb57c57b7bda',
  },
  dpa: {
    key: 'avv',
    title: 'Auftragsverarbeitungsvertrag',
    version: '1.1-2026-05-05',
    path: '/avv/',
    sha256: '2f43ccf65686ccdc48ddab8e73ae80c6b2496abe50aac04a9ecaed1e6bbd3192',
  },
} as const;

export type LegalSnapshot = {
  [K in keyof typeof LEGAL_DOCUMENTS]: (typeof LEGAL_DOCUMENTS)[K] & { url: string };
};

export type LegalAcceptanceFlags = {
  isBusiness: true;
  termsAccepted: true;
  privacyAccepted: true;
  avvAccepted: true;
};

type LegalAcceptanceSource = 'register' | 'checkout_signup' | 'billing_checkout';

type LegalAcceptanceInput = LegalAcceptanceFlags & {
  source: LegalAcceptanceSource;
  email: string;
  orgId?: string | null;
  userId?: string | null;
  pendingRegistrationId?: string | null;
  planId?: string | null;
  billingInterval?: string | null;
  stripeSessionId?: string | null;
  stripeCustomerId?: string | null;
  metadata?: Record<string, unknown>;
  req?: FastifyRequest;
};

export function legalSnapshot(appUrl = process.env.APP_URL ?? 'https://phonbot.de'): LegalSnapshot {
  const base = appUrl.endsWith('/') ? appUrl : `${appUrl}/`;
  return {
    terms: {
      ...LEGAL_DOCUMENTS.terms,
      url: new URL(LEGAL_DOCUMENTS.terms.path.replace(/^\//, ''), base).toString(),
    },
    privacy: {
      ...LEGAL_DOCUMENTS.privacy,
      url: new URL(LEGAL_DOCUMENTS.privacy.path.replace(/^\//, ''), base).toString(),
    },
    dpa: {
      ...LEGAL_DOCUMENTS.dpa,
      url: new URL(LEGAL_DOCUMENTS.dpa.path.replace(/^\//, ''), base).toString(),
    },
  };
}

export function legalSnapshotHash(snapshot = legalSnapshot()): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(snapshot))
    .digest('hex');
}

export async function insertLegalAcceptance(queryable: Queryable, input: LegalAcceptanceInput): Promise<void> {
  const docs = legalSnapshot();
  const documentHash = legalSnapshotHash(docs);
  const ipAddress = input.req?.ip ?? null;
  const userAgent = typeof input.req?.headers['user-agent'] === 'string'
    ? input.req.headers['user-agent']
    : null;

  await queryable.query(
    `INSERT INTO legal_acceptances (
       source, org_id, user_id, pending_registration_id, email, plan_id, billing_interval,
       stripe_session_id, stripe_customer_id, ip_address, user_agent,
       is_business, terms_accepted, privacy_accepted, avv_accepted,
       document_hash, documents, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, true, true, true, $12, $13, $14)`,
    [
      input.source,
      input.orgId ?? null,
      input.userId ?? null,
      input.pendingRegistrationId ?? null,
      input.email,
      input.planId ?? null,
      input.billingInterval ?? null,
      input.stripeSessionId ?? null,
      input.stripeCustomerId ?? null,
      ipAddress,
      userAgent,
      documentHash,
      docs,
      input.metadata ?? {},
    ],
  );
}
