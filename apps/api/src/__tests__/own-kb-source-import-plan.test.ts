import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildOwnKbSourceImportPlan,
  type OwnKbSourceImportPlanSafetyGates,
} from '../own-kb-source-import-plan.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { KnowledgeSource } from '../knowledge.js';

const trustedScope = createTrustedScope({
  orgId: 'org_source_plan',
  tenantId: 'tenant_source_plan',
  agentId: 'source_import_planner',
  source: 'server',
  resolvedFrom: 'internal_job',
});

const readyGates: OwnKbSourceImportPlanSafetyGates = {
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
  const content = overrides.content ?? 'Approved current source content for safe FAQ responses.';
  const hash = sha256(content);
  return {
    id: 'source_plan_1',
    orgId: trustedScope.orgId,
    tenantId: trustedScope.tenantId,
    type: 'text',
    name: 'Human reviewed FAQ source',
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

describe('Own-KB source import planning contract', () => {
  it('builds a sanitized scoped write plan only for readiness-approved sources', () => {
    const result = buildOwnKbSourceImportPlan({
      trustedScope,
      sources: [source()],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToPlan).toBe(true);
    expect(result.promotionEvidenceUsable).toBe(false);
    expect(result.operations).toEqual([expect.objectContaining({
      operation: 'upsert_reviewed_source_version',
      orgId: trustedScope.orgId,
      tenantId: trustedScope.tenantId,
      sourceIdHash: sha256('source_plan_1'),
      sourceVersionHash: sha256('Approved current source content for safe FAQ responses.'),
      allowedUse: 'voice_agent',
      risk: 'low',
      expiresAt: '2026-06-30T10:00:00.000Z',
    })]);
    expect(JSON.stringify(result)).not.toContain('Approved current source content');
    expect(JSON.stringify(result)).not.toContain('Human reviewed FAQ source');
  });

  it('does not emit raw source ids because source ids can contain PII', () => {
    const result = buildOwnKbSourceImportPlan({
      trustedScope,
      sources: [source({ id: 'maria.mustermann@example.com' })],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToPlan).toBe(true);
    expect(result.operations[0]).toMatchObject({
      sourceIdHash: sha256('maria.mustermann@example.com'),
    });
    expect(JSON.stringify(result)).not.toContain('maria.mustermann@example.com');
  });

  it('fails closed without branded TrustedScope or readiness gates', () => {
    const result = buildOwnKbSourceImportPlan({
      trustedScope: { orgId: trustedScope.orgId, tenantId: trustedScope.tenantId },
      sources: [source()],
      safetyGates: { ...readyGates, dbRlsReadinessPassed: false },
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToPlan).toBe(false);
    expect(result.operations).toEqual([]);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'SOURCE_IMPORT_TRUSTED_SCOPE_REQUIRED',
      'SOURCE_IMPORT_DB_RLS_GATE_REQUIRED',
    ]));
  });

  it('does not plan mismatched, stale, PII, or promotion-marked sources', () => {
    const result = buildOwnKbSourceImportPlan({
      trustedScope,
      sources: [
        source({ tenantId: 'tenant_other' }),
        source({ expiresAt: '2026-05-29T10:00:00.000Z' }),
        source({
          content: 'Call Maria at 0176 12345678.',
          sha256: sha256('Call Maria at 0176 12345678.'),
          contentHash: sha256('Call Maria at 0176 12345678.'),
        }),
        source({ promotionEvidenceUsable: true } as Partial<KnowledgeSource>),
      ],
      safetyGates: readyGates,
      now: '2026-05-30T12:00:00.000Z',
    });

    expect(result.readyToPlan).toBe(false);
    expect(result.operations).toEqual([]);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'SOURCE_IMPORT_SCOPE_MISMATCH',
      'SOURCE_IMPORT_SOURCE_EXPIRED',
      'SOURCE_IMPORT_PII_DETECTED',
      'SOURCE_IMPORT_PROMOTION_EVIDENCE_MARKER_PRESENT',
    ]));
  });
});
