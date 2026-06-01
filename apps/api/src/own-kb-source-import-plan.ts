import { createHash } from 'node:crypto';

import {
  buildOwnKbSourceImportReadiness,
  type OwnKbSourceImportBlocker,
  type OwnKbSourceImportSafetyGates,
} from './own-kb-source-import-contract.js';
import { isTrustedScope, type TrustedScope } from './trusted-scope.js';
import type { KnowledgeSource } from './knowledge.js';

export type OwnKbSourceImportPlanSafetyGates = OwnKbSourceImportSafetyGates;

export type OwnKbSourceImportPlanOperation = {
  operation: 'upsert_reviewed_source_version';
  orgId: string;
  tenantId: string;
  sourceIdHash: string;
  sourceVersionHash: string;
  contentSha256: string;
  allowedUse: string;
  risk: string;
  verifiedAt: string;
  expiresAt: string;
};

export type OwnKbSourceImportPlanInput = {
  trustedScope?: TrustedScope | unknown;
  sources: KnowledgeSource[];
  safetyGates: OwnKbSourceImportPlanSafetyGates;
  now?: Date | string;
};

export type OwnKbSourceImportPlan = {
  readyToPlan: boolean;
  operations: OwnKbSourceImportPlanOperation[];
  blockers: OwnKbSourceImportBlocker[];
  acceptedSources: number;
  rejectedSources: number;
  promotionEvidenceUsable: false;
  notes: string[];
};

function compact(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildOperation(
  source: KnowledgeSource,
  trustedScope: TrustedScope,
): OwnKbSourceImportPlanOperation {
  const contentSha256 = compact(source.sha256);
  return {
    operation: 'upsert_reviewed_source_version',
    orgId: trustedScope.orgId,
    tenantId: trustedScope.tenantId,
    sourceIdHash: sha256(compact(source.id)),
    sourceVersionHash: compact(source.contentHash) || contentSha256,
    contentSha256,
    allowedUse: compact(source.allowedUse).toLowerCase(),
    risk: compact(source.risk).toLowerCase(),
    verifiedAt: compact(source.verifiedAt),
    expiresAt: compact(source.expiresAt),
  };
}

export function buildOwnKbSourceImportPlan(input: OwnKbSourceImportPlanInput): OwnKbSourceImportPlan {
  const readiness = buildOwnKbSourceImportReadiness(input);
  const trustedScope = isTrustedScope(input.trustedScope) ? input.trustedScope : null;
  const readyToPlan = readiness.readyToImport && Boolean(trustedScope);
  return {
    readyToPlan,
    operations: readyToPlan && trustedScope
      ? input.sources.map((source) => buildOperation(source, trustedScope))
      : [],
    blockers: readiness.blockers,
    acceptedSources: readiness.acceptedSources,
    rejectedSources: readiness.rejectedSources,
    promotionEvidenceUsable: false,
    notes: ['source_import_plan_is_sanitized_and_not_a_db_write'],
  };
}
