import { describe, expect, it } from 'vitest';
import {
  validateHumanQaLabelingWorkflow,
  type HumanQaLabelingWorkflow,
} from '../human-qa-labeling.js';

function completeWorkflow(overrides: Partial<HumanQaLabelingWorkflow> = {}): HumanQaLabelingWorkflow {
  return {
    answerCorrectLabel: true,
    shouldAbstainLabel: true,
    escalationLabel: true,
    evidenceSupportLabel: true,
    voiceStyleLabel: true,
    interruptionCorrectionLabel: true,
    severityTaxonomy: ['P0', 'P1', 'P2'],
    disagreementResolution: {
      recordsInitialLabels: true,
      recordsFinalLabel: true,
      recordsResolver: true,
      recordsReason: true,
      requiresSecondReviewerForP0P1: true,
    },
    evalCaseVersioning: {
      caseVersionRequired: true,
      reportVersionRequired: true,
      sourceVersionRequired: true,
      labelSchemaVersionRequired: true,
    },
    distributionTracking: {
      tenantTracked: true,
      industryTracked: true,
      topIntentTracked: true,
      riskClassTracked: true,
      languageAccentTracked: true,
    },
    piiControls: {
      rawPiiStoredByDefault: false,
      redactedContextRequired: true,
      explicitPurposeRequiredForRawPii: true,
      retentionRuleRequiredForRawPii: true,
    },
    labelCoverage: {
      minCases: 50,
      minTopIntentCount: 30,
      minHighRiskCases: 5,
      maxUnresolvedDisagreementRate: 0.02,
    },
    ...overrides,
  };
}

describe('human QA labeling workflow contract', () => {
  it('accepts a complete workflow with labels, versioning, distribution tracking, and PII controls', () => {
    const report = validateHumanQaLabelingWorkflow(completeWorkflow());

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it('requires answer, abstain, escalation, evidence, voice, and correction labels', () => {
    const report = validateHumanQaLabelingWorkflow(completeWorkflow({
      answerCorrectLabel: false,
      shouldAbstainLabel: false,
      escalationLabel: false,
      evidenceSupportLabel: false,
      voiceStyleLabel: false,
      interruptionCorrectionLabel: false,
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('QA_REQUIRED_LABEL_MISSING');
  });

  it('requires P0/P1/P2 taxonomy and strong disagreement resolution', () => {
    const report = validateHumanQaLabelingWorkflow(completeWorkflow({
      severityTaxonomy: ['P1', 'P2'],
      disagreementResolution: {
        recordsInitialLabels: false,
        recordsFinalLabel: true,
        recordsResolver: false,
        recordsReason: false,
        requiresSecondReviewerForP0P1: false,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('QA_SEVERITY_TAXONOMY_INCOMPLETE');
    expect(report.blockers).toContain('QA_DISAGREEMENT_WORKFLOW_INCOMPLETE');
  });

  it('requires eval case, report, source, and label schema versioning', () => {
    const report = validateHumanQaLabelingWorkflow(completeWorkflow({
      evalCaseVersioning: {
        caseVersionRequired: false,
        reportVersionRequired: false,
        sourceVersionRequired: false,
        labelSchemaVersionRequired: false,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('QA_VERSIONING_INCOMPLETE');
  });

  it('requires tenant, industry, intent, risk, and language/accent distribution tracking', () => {
    const report = validateHumanQaLabelingWorkflow(completeWorkflow({
      distributionTracking: {
        tenantTracked: false,
        industryTracked: false,
        topIntentTracked: false,
        riskClassTracked: false,
        languageAccentTracked: false,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('QA_DISTRIBUTION_TRACKING_INCOMPLETE');
  });

  it('blocks raw PII by default and requires purpose plus retention controls', () => {
    const report = validateHumanQaLabelingWorkflow(completeWorkflow({
      piiControls: {
        rawPiiStoredByDefault: true,
        redactedContextRequired: false,
        explicitPurposeRequiredForRawPii: false,
        retentionRuleRequiredForRawPii: false,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('QA_RAW_PII_STORAGE_UNSAFE');
  });

  it('requires enough label coverage before canary expansion', () => {
    const report = validateHumanQaLabelingWorkflow(completeWorkflow({
      labelCoverage: {
        minCases: 12,
        minTopIntentCount: 8,
        minHighRiskCases: 0,
        maxUnresolvedDisagreementRate: 0.2,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('QA_LABEL_COVERAGE_INSUFFICIENT');
  });
});
