import crypto from 'node:crypto';

import type { KnowledgeSource } from './knowledge.js';
import { redactForEval } from './pii.js';
import { isTrustedScope, type TrustedScope } from './trusted-scope.js';

export type OwnKbSourceImportBlocker =
  | 'SOURCE_IMPORT_TRUSTED_SCOPE_REQUIRED'
  | 'SOURCE_IMPORT_TRUSTED_SCOPE_GATE_REQUIRED'
  | 'SOURCE_IMPORT_DB_RLS_GATE_REQUIRED'
  | 'SOURCE_IMPORT_PII_GATE_REQUIRED'
  | 'SOURCE_IMPORT_APPROVAL_MANIFEST_REQUIRED'
  | 'SOURCE_IMPORT_REQUIREMENTS_REVIEW_REQUIRED'
  | 'SOURCE_IMPORT_SCOPED_REPOSITORY_REQUIRED'
  | 'SOURCE_IMPORT_SOURCES_REQUIRED'
  | 'SOURCE_IMPORT_SCOPE_MISSING'
  | 'SOURCE_IMPORT_SCOPE_MISMATCH'
  | 'SOURCE_IMPORT_ID_REQUIRED'
  | 'SOURCE_IMPORT_NAME_REQUIRED'
  | 'SOURCE_IMPORT_TEXT_ONLY_REQUIRED'
  | 'SOURCE_IMPORT_CONTENT_REQUIRED'
  | 'SOURCE_IMPORT_STATUS_NOT_INDEXED'
  | 'SOURCE_IMPORT_SOURCE_OF_TRUTH_INVALID'
  | 'SOURCE_IMPORT_ALLOWED_USE_INVALID'
  | 'SOURCE_IMPORT_REVIEW_NOT_APPROVED'
  | 'SOURCE_IMPORT_VERIFIED_AT_INVALID'
  | 'SOURCE_IMPORT_VERIFIED_AT_IN_FUTURE'
  | 'SOURCE_IMPORT_EXPIRES_AT_INVALID'
  | 'SOURCE_IMPORT_SOURCE_EXPIRED'
  | 'SOURCE_IMPORT_RISK_NOT_ALLOWED'
  | 'SOURCE_IMPORT_PII_DETECTED'
  | 'SOURCE_IMPORT_AUTO_REFRESH_NOT_ALLOWED'
  | 'SOURCE_IMPORT_HASH_REQUIRED'
  | 'SOURCE_IMPORT_HASH_MISMATCH'
  | 'SOURCE_IMPORT_SYNTHETIC_MARKER_PRESENT'
  | 'SOURCE_IMPORT_DRAFT_MARKER_PRESENT'
  | 'SOURCE_IMPORT_PROMOTION_EVIDENCE_MARKER_PRESENT';

export type OwnKbSourceImportSafetyGates = {
  trustedScopePassed: boolean;
  dbRlsReadinessPassed: boolean;
  piiRedactionPassed: boolean;
  sourceApprovalManifestVerified: boolean;
  sourceRequirementsReviewed: boolean;
  serviceRoleScopedRepositoryOnly: boolean;
};

export type OwnKbSourceImportReadinessInput = {
  trustedScope?: TrustedScope | unknown;
  sources: KnowledgeSource[];
  safetyGates: OwnKbSourceImportSafetyGates;
  now?: Date | string;
};

export type OwnKbSourceImportReadiness = {
  readyToImport: boolean;
  acceptedSources: number;
  rejectedSources: number;
  blockers: OwnKbSourceImportBlocker[];
  promotionEvidenceUsable: false;
  notes: string[];
};

const ALLOWED_IMPORT_USES = new Set(['agent_facts', 'customer_faq', 'voice_agent', 'public_faq']);
const ALLOWED_IMPORT_REVIEWS = new Set(['approved']);
const BLOCKED_IMPORT_RISKS = new Set(['high', 'critical']);

function compact(input: unknown): string {
  return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : '';
}

function parseDateMs(input: unknown): number | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.getTime();
  if (typeof input !== 'string' || !input.trim()) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function normalizeDateMs(input: Date | string | undefined): number {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input.getTime();
  if (typeof input === 'string' && input.trim()) {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return Date.now();
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function addUnique(blockers: OwnKbSourceImportBlocker[], blocker: OwnKbSourceImportBlocker): void {
  if (!blockers.includes(blocker)) blockers.push(blocker);
}

function validateSource(
  source: KnowledgeSource,
  trustedScope: TrustedScope | null,
  nowMs: number,
): OwnKbSourceImportBlocker[] {
  const blockers: OwnKbSourceImportBlocker[] = [];
  const rawSource = source as Record<string, unknown>;
  if (rawSource.syntheticOnly === true) addUnique(blockers, 'SOURCE_IMPORT_SYNTHETIC_MARKER_PRESENT');
  if (rawSource.approvedForMilestone === 'DRAFT_ONLY') addUnique(blockers, 'SOURCE_IMPORT_DRAFT_MARKER_PRESENT');
  if (rawSource.promotionEvidenceUsable === true) {
    addUnique(blockers, 'SOURCE_IMPORT_PROMOTION_EVIDENCE_MARKER_PRESENT');
  }
  if (!compact(source.orgId) || !compact(source.tenantId)) addUnique(blockers, 'SOURCE_IMPORT_SCOPE_MISSING');
  if (
    trustedScope
    && (source.orgId !== trustedScope.orgId || source.tenantId !== trustedScope.tenantId)
  ) {
    addUnique(blockers, 'SOURCE_IMPORT_SCOPE_MISMATCH');
  }

  if (!compact(source.id)) addUnique(blockers, 'SOURCE_IMPORT_ID_REQUIRED');
  if (!compact(source.name)) addUnique(blockers, 'SOURCE_IMPORT_NAME_REQUIRED');
  if (source.type !== 'text') addUnique(blockers, 'SOURCE_IMPORT_TEXT_ONLY_REQUIRED');
  const content = compact(source.content);
  if (!content) addUnique(blockers, 'SOURCE_IMPORT_CONTENT_REQUIRED');
  if (source.status && source.status !== 'indexed') addUnique(blockers, 'SOURCE_IMPORT_STATUS_NOT_INDEXED');
  if (source.sourceOfTruth !== 'human_reviewed_fact_intake') addUnique(blockers, 'SOURCE_IMPORT_SOURCE_OF_TRUTH_INVALID');

  const allowedUse = compact(source.allowedUse).toLowerCase();
  if (!ALLOWED_IMPORT_USES.has(allowedUse)) addUnique(blockers, 'SOURCE_IMPORT_ALLOWED_USE_INVALID');
  if (!ALLOWED_IMPORT_REVIEWS.has(compact(source.reviewStatus).toLowerCase())) {
    addUnique(blockers, 'SOURCE_IMPORT_REVIEW_NOT_APPROVED');
  }

  const verifiedAt = parseDateMs(source.verifiedAt);
  if (verifiedAt === null) addUnique(blockers, 'SOURCE_IMPORT_VERIFIED_AT_INVALID');
  else if (verifiedAt > nowMs + 5 * 60 * 1000) addUnique(blockers, 'SOURCE_IMPORT_VERIFIED_AT_IN_FUTURE');

  const expiresAt = parseDateMs(source.expiresAt);
  if (expiresAt === null) addUnique(blockers, 'SOURCE_IMPORT_EXPIRES_AT_INVALID');
  else if (expiresAt <= nowMs) addUnique(blockers, 'SOURCE_IMPORT_SOURCE_EXPIRED');

  if (BLOCKED_IMPORT_RISKS.has(compact(source.risk).toLowerCase())) {
    addUnique(blockers, 'SOURCE_IMPORT_RISK_NOT_ALLOWED');
  }
  if (source.containsPii === true || (content && redactForEval(content) !== content)) {
    addUnique(blockers, 'SOURCE_IMPORT_PII_DETECTED');
  }
  if (source.autoRefresh === true) addUnique(blockers, 'SOURCE_IMPORT_AUTO_REFRESH_NOT_ALLOWED');

  const expectedHash = content ? sha256(content) : null;
  const sourceHash = compact(source.sha256);
  const contentHash = compact(source.contentHash);
  if (!sourceHash || !contentHash) {
    addUnique(blockers, 'SOURCE_IMPORT_HASH_REQUIRED');
  } else if (sourceHash !== expectedHash || contentHash !== expectedHash || sourceHash !== contentHash) {
    addUnique(blockers, 'SOURCE_IMPORT_HASH_MISMATCH');
  }
  return blockers;
}

export function buildOwnKbSourceImportReadiness(
  input: OwnKbSourceImportReadinessInput,
): OwnKbSourceImportReadiness {
  const blockers: OwnKbSourceImportBlocker[] = [];
  const trustedScope = isTrustedScope(input.trustedScope) ? input.trustedScope : null;
  if (!trustedScope) addUnique(blockers, 'SOURCE_IMPORT_TRUSTED_SCOPE_REQUIRED');
  if (!input.safetyGates.trustedScopePassed) addUnique(blockers, 'SOURCE_IMPORT_TRUSTED_SCOPE_GATE_REQUIRED');
  if (!input.safetyGates.dbRlsReadinessPassed) addUnique(blockers, 'SOURCE_IMPORT_DB_RLS_GATE_REQUIRED');
  if (!input.safetyGates.piiRedactionPassed) addUnique(blockers, 'SOURCE_IMPORT_PII_GATE_REQUIRED');
  if (!input.safetyGates.sourceApprovalManifestVerified) addUnique(blockers, 'SOURCE_IMPORT_APPROVAL_MANIFEST_REQUIRED');
  if (!input.safetyGates.sourceRequirementsReviewed) addUnique(blockers, 'SOURCE_IMPORT_REQUIREMENTS_REVIEW_REQUIRED');
  if (!input.safetyGates.serviceRoleScopedRepositoryOnly) addUnique(blockers, 'SOURCE_IMPORT_SCOPED_REPOSITORY_REQUIRED');
  if (input.sources.length === 0) addUnique(blockers, 'SOURCE_IMPORT_SOURCES_REQUIRED');

  const nowMs = normalizeDateMs(input.now);
  let acceptedSources = 0;
  let rejectedSources = 0;
  for (const source of input.sources) {
    const sourceBlockers = validateSource(source, trustedScope, nowMs);
    if (sourceBlockers.length === 0) acceptedSources += 1;
    else rejectedSources += 1;
    for (const blocker of sourceBlockers) addUnique(blockers, blocker);
  }

  return {
    readyToImport: blockers.length === 0 && acceptedSources === input.sources.length && acceptedSources > 0,
    acceptedSources,
    rejectedSources,
    blockers,
    promotionEvidenceUsable: false,
    notes: ['source_import_is_not_0_5b_promotion_evidence'],
  };
}
