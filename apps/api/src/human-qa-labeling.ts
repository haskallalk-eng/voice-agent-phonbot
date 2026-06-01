export type QaSeverity = 'P0' | 'P1' | 'P2';

export type HumanQaLabelingWorkflow = {
  answerCorrectLabel: boolean;
  shouldAbstainLabel: boolean;
  escalationLabel: boolean;
  evidenceSupportLabel: boolean;
  voiceStyleLabel: boolean;
  interruptionCorrectionLabel: boolean;
  severityTaxonomy: QaSeverity[];
  disagreementResolution: {
    recordsInitialLabels: boolean;
    recordsFinalLabel: boolean;
    recordsResolver: boolean;
    recordsReason: boolean;
    requiresSecondReviewerForP0P1: boolean;
  };
  evalCaseVersioning: {
    caseVersionRequired: boolean;
    reportVersionRequired: boolean;
    sourceVersionRequired: boolean;
    labelSchemaVersionRequired: boolean;
  };
  distributionTracking: {
    tenantTracked: boolean;
    industryTracked: boolean;
    topIntentTracked: boolean;
    riskClassTracked: boolean;
    languageAccentTracked: boolean;
  };
  piiControls: {
    rawPiiStoredByDefault: boolean;
    redactedContextRequired: boolean;
    explicitPurposeRequiredForRawPii: boolean;
    retentionRuleRequiredForRawPii: boolean;
  };
  labelCoverage: {
    minCases: number;
    minTopIntentCount: number;
    minHighRiskCases: number;
    maxUnresolvedDisagreementRate: number;
  };
};

export type HumanQaLabelingBlocker =
  | 'QA_REQUIRED_LABEL_MISSING'
  | 'QA_SEVERITY_TAXONOMY_INCOMPLETE'
  | 'QA_DISAGREEMENT_WORKFLOW_INCOMPLETE'
  | 'QA_VERSIONING_INCOMPLETE'
  | 'QA_DISTRIBUTION_TRACKING_INCOMPLETE'
  | 'QA_RAW_PII_STORAGE_UNSAFE'
  | 'QA_LABEL_COVERAGE_INSUFFICIENT';

export type HumanQaLabelingReport = {
  ready: boolean;
  blockers: HumanQaLabelingBlocker[];
};

function add(blockers: HumanQaLabelingBlocker[], condition: boolean, blocker: HumanQaLabelingBlocker): void {
  if (condition && !blockers.includes(blocker)) blockers.push(blocker);
}

function hasRequiredLabels(input: HumanQaLabelingWorkflow): boolean {
  return input.answerCorrectLabel &&
    input.shouldAbstainLabel &&
    input.escalationLabel &&
    input.evidenceSupportLabel &&
    input.voiceStyleLabel &&
    input.interruptionCorrectionLabel;
}

function hasSeverityTaxonomy(input: HumanQaLabelingWorkflow): boolean {
  return input.severityTaxonomy.includes('P0') &&
    input.severityTaxonomy.includes('P1') &&
    input.severityTaxonomy.includes('P2');
}

function hasDisagreementResolution(input: HumanQaLabelingWorkflow): boolean {
  const item = input.disagreementResolution;
  return item.recordsInitialLabels &&
    item.recordsFinalLabel &&
    item.recordsResolver &&
    item.recordsReason &&
    item.requiresSecondReviewerForP0P1;
}

function hasVersioning(input: HumanQaLabelingWorkflow): boolean {
  const item = input.evalCaseVersioning;
  return item.caseVersionRequired &&
    item.reportVersionRequired &&
    item.sourceVersionRequired &&
    item.labelSchemaVersionRequired;
}

function hasDistributionTracking(input: HumanQaLabelingWorkflow): boolean {
  const item = input.distributionTracking;
  return item.tenantTracked &&
    item.industryTracked &&
    item.topIntentTracked &&
    item.riskClassTracked &&
    item.languageAccentTracked;
}

function hasSafePiiControls(input: HumanQaLabelingWorkflow): boolean {
  const item = input.piiControls;
  return item.rawPiiStoredByDefault === false &&
    item.redactedContextRequired &&
    item.explicitPurposeRequiredForRawPii &&
    item.retentionRuleRequiredForRawPii;
}

function hasSufficientCoverage(input: HumanQaLabelingWorkflow): boolean {
  const item = input.labelCoverage;
  return Number.isFinite(item.minCases) &&
    item.minCases >= 50 &&
    Number.isFinite(item.minTopIntentCount) &&
    item.minTopIntentCount >= 30 &&
    Number.isFinite(item.minHighRiskCases) &&
    item.minHighRiskCases >= 5 &&
    Number.isFinite(item.maxUnresolvedDisagreementRate) &&
    item.maxUnresolvedDisagreementRate <= 0.05;
}

export function validateHumanQaLabelingWorkflow(
  input: HumanQaLabelingWorkflow,
): HumanQaLabelingReport {
  const blockers: HumanQaLabelingBlocker[] = [];

  add(blockers, !hasRequiredLabels(input), 'QA_REQUIRED_LABEL_MISSING');
  add(blockers, !hasSeverityTaxonomy(input), 'QA_SEVERITY_TAXONOMY_INCOMPLETE');
  add(blockers, !hasDisagreementResolution(input), 'QA_DISAGREEMENT_WORKFLOW_INCOMPLETE');
  add(blockers, !hasVersioning(input), 'QA_VERSIONING_INCOMPLETE');
  add(blockers, !hasDistributionTracking(input), 'QA_DISTRIBUTION_TRACKING_INCOMPLETE');
  add(blockers, !hasSafePiiControls(input), 'QA_RAW_PII_STORAGE_UNSAFE');
  add(blockers, !hasSufficientCoverage(input), 'QA_LABEL_COVERAGE_INSUFFICIENT');

  return {
    ready: blockers.length === 0,
    blockers,
  };
}
