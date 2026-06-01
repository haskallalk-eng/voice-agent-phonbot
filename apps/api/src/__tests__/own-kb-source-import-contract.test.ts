import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildOwnKbSourceImportReadiness,
  type OwnKbSourceImportSafetyGates,
} from '../own-kb-source-import-contract.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { KnowledgeSource } from '../knowledge.js';

const trustedScope = createTrustedScope({
  orgId: 'org_import_test',
  tenantId: 'tenant_import_test',
  agentId: 'internal_source_import',
  source: 'server',
  resolvedFrom: 'internal_job',
});

const readyGates: OwnKbSourceImportSafetyGates = {
  trustedScopePassed: true,
  dbRlsReadinessPassed: true,
  piiRedactionPassed: true,
  sourceApprovalManifestVerified: true,
  sourceRequirementsReviewed: true,
  serviceRoleScopedRepositoryOnly: true,
};

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  const content = overrides.content ?? 'Approved current source content for safe voice-agent FAQ answers.';
  const hash = sha256(content);
  return {
    id: 'fact_intake_import_source',
    orgId: trustedScope.orgId,
    tenantId: trustedScope.tenantId,
    type: 'text',
    name: 'Approved FAQ source',
    content,
    sha256: hash,
    contentHash: hash,
    status: 'indexed',
    category: 'customer_faq',
    allowedUse: 'voice_agent',
    sourceOfTruth: 'human_reviewed_fact_intake',
    owner: 'qa_reviewer',
    verifiedAt: '2026-05-30T10:00:00.000Z',
    expiresAt: '2026-06-30T10:00:00.000Z',
    containsPii: false,
    reviewStatus: 'approved',
    risk: 'low',
    autoRefresh: false,
    ...overrides,
  };
}

describe('Own-KB source import readiness contract', () => {
  it('accepts only scoped, reviewed, current, hash-matching Own-KB source JSON', () => {
    const result = buildOwnKbSourceImportReadiness({
      trustedScope,
      sources: [source()],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToImport).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.acceptedSources).toEqual(1);
    expect(result.promotionEvidenceUsable).toBe(false);
  });

  it('accepts generated Fact-Intake source JSON before payload status normalization', () => {
    const generatedStyleSource = source();
    delete generatedStyleSource.status;

    const result = buildOwnKbSourceImportReadiness({
      trustedScope,
      sources: [generatedStyleSource],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToImport).toBe(true);
    expect(result.blockers).not.toContain('SOURCE_IMPORT_STATUS_NOT_INDEXED');
  });

  it('fails closed without branded server TrustedScope', () => {
    const result = buildOwnKbSourceImportReadiness({
      trustedScope: { orgId: trustedScope.orgId, tenantId: trustedScope.tenantId },
      sources: [source()],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToImport).toBe(false);
    expect(result.blockers).toContain('SOURCE_IMPORT_TRUSTED_SCOPE_REQUIRED');
  });

  it('rejects source JSON whose org or tenant does not match TrustedScope', () => {
    const orgMismatch = buildOwnKbSourceImportReadiness({
      trustedScope,
      sources: [source({ orgId: 'org_other' })],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });
    const tenantMismatch = buildOwnKbSourceImportReadiness({
      trustedScope,
      sources: [source({ tenantId: 'tenant_other' })],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(orgMismatch.readyToImport).toBe(false);
    expect(orgMismatch.blockers).toContain('SOURCE_IMPORT_SCOPE_MISMATCH');
    expect(tenantMismatch.readyToImport).toBe(false);
    expect(tenantMismatch.blockers).toContain('SOURCE_IMPORT_SCOPE_MISMATCH');
  });

  it('requires DB/RLS, PII, manifest, source-requirement, and scoped service-role gates', () => {
    const result = buildOwnKbSourceImportReadiness({
      trustedScope,
      sources: [source()],
      safetyGates: {
        trustedScopePassed: false,
        dbRlsReadinessPassed: false,
        piiRedactionPassed: false,
        sourceApprovalManifestVerified: false,
        sourceRequirementsReviewed: false,
        serviceRoleScopedRepositoryOnly: false,
      },
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToImport).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'SOURCE_IMPORT_TRUSTED_SCOPE_GATE_REQUIRED',
      'SOURCE_IMPORT_DB_RLS_GATE_REQUIRED',
      'SOURCE_IMPORT_PII_GATE_REQUIRED',
      'SOURCE_IMPORT_APPROVAL_MANIFEST_REQUIRED',
      'SOURCE_IMPORT_REQUIREMENTS_REVIEW_REQUIRED',
      'SOURCE_IMPORT_SCOPED_REPOSITORY_REQUIRED',
    ]));
  });

  it('rejects source JSON with stale, unapproved, high-risk, PII, auto-refresh, or hash-drift content', () => {
    const result = buildOwnKbSourceImportReadiness({
      trustedScope,
      sources: [
        source({ reviewStatus: 'draft' }),
        source({ expiresAt: '2026-05-29T10:00:00.000Z' }),
        source({ risk: 'high' }),
        source({ content: 'Call Maria at 0176 12345678.', sha256: sha256('Call Maria at 0176 12345678.'), contentHash: sha256('Call Maria at 0176 12345678.') }),
        source({ autoRefresh: true }),
        source({ contentHash: 'not_the_content_hash' }),
        source({ status: 'error', error: 'upstream parser failed' }),
      ],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToImport).toBe(false);
    expect(result.rejectedSources).toBe(7);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'SOURCE_IMPORT_REVIEW_NOT_APPROVED',
      'SOURCE_IMPORT_SOURCE_EXPIRED',
      'SOURCE_IMPORT_RISK_NOT_ALLOWED',
      'SOURCE_IMPORT_PII_DETECTED',
      'SOURCE_IMPORT_AUTO_REFRESH_NOT_ALLOWED',
      'SOURCE_IMPORT_HASH_MISMATCH',
      'SOURCE_IMPORT_STATUS_NOT_INDEXED',
    ]));
  });

  it('rejects source JSON that still carries synthetic, draft, or promotion markers', () => {
    const result = buildOwnKbSourceImportReadiness({
      trustedScope,
      sources: [
        source({ syntheticOnly: true } as Partial<KnowledgeSource>),
        source({ approvedForMilestone: 'DRAFT_ONLY' } as Partial<KnowledgeSource>),
        source({ promotionEvidenceUsable: true } as Partial<KnowledgeSource>),
      ],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToImport).toBe(false);
    expect(result.rejectedSources).toBe(3);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'SOURCE_IMPORT_SYNTHETIC_MARKER_PRESENT',
      'SOURCE_IMPORT_DRAFT_MARKER_PRESENT',
      'SOURCE_IMPORT_PROMOTION_EVIDENCE_MARKER_PRESENT',
    ]));
  });

  it('does not treat importable source JSON as benchmark promotion evidence', () => {
    const result = buildOwnKbSourceImportReadiness({
      trustedScope,
      sources: [source()],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToImport).toBe(true);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.notes).toContain('source_import_is_not_0_5b_promotion_evidence');
  });
});
