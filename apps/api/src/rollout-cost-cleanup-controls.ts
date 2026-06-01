import type { ProductKpiReport } from './product-kpi-contract.js';

export type RolloutStage = 'canary' | 'primary';

export type RolloutCandidateDecision =
  | 'keep_retell_primary'
  | 'owkb_shadow_only'
  | 'owkb_canary_candidate'
  | 'owkb_primary_candidate';

export type RetellKbLifecycleState =
  | 'active'
  | 'canary'
  | 'rollback_standby'
  | 'pending_deploy'
  | 'unused';

export type RolloutCostCleanupInput = {
  stage: RolloutStage;
  candidateDecision: RolloutCandidateDecision;
  milestones1AThrough1IPassed: boolean;
  trusted0_5bReportExists: boolean;
  productKpiHardGatesPassed: boolean;
  productKpiReport?: Pick<ProductKpiReport, 'hardGateReady' | 'blockers'> | null;
  ultraLowLatencySloPassed: boolean;
  exceptionPathSloReported: boolean;
  shadowDualReadNoUnresolvedP0P1: boolean;
  transcriptCoverageGapsClosed: boolean;
  latencyGateConsecutiveDays: number;
  rollbackTestedPerOrgAgent: boolean;
  emergencyKillSwitchVerified: boolean;
  retellKbStandbyReady: boolean;
  canaryWithoutP0Days: number;
  unresolvedP1Gaps: number;
  latencyGateBreaches: number;
  kpiHardGateRegressions: number;
  governanceWeakeningOptimization: boolean;
  retellKbStandbyDays: number;
  costControls: {
    budgetBandApproved: boolean;
    costPerResolvedCallWithinBand: boolean;
    dailySpendCapConfigured: boolean;
    alertingConfigured: boolean;
  };
  cleanupCandidate?: {
    lifecycleState: RetellKbLifecycleState;
    hasActiveReferences: boolean;
    rollbackNeeded: boolean;
    unresolvedBillingOrSupportDispute: boolean;
    auditRecorded: boolean;
  };
};

export type RolloutCostCleanupBlocker =
  | 'ROLLOUT_MILESTONE_1_GATES_MISSING'
  | 'ROLLOUT_TRUSTED_0_5B_REPORT_MISSING'
  | 'ROLLOUT_PRODUCT_KPI_GATES_MISSING'
  | 'ROLLOUT_PRODUCT_KPI_REPORT_MISSING'
  | 'ROLLOUT_PRODUCT_KPI_REPORT_NOT_READY'
  | 'ROLLOUT_ULTRA_LOW_LATENCY_SLO_MISSING'
  | 'ROLLOUT_EXCEPTION_PATH_SLO_MISSING'
  | 'ROLLOUT_SHADOW_DUAL_READ_GAPS_OPEN'
  | 'ROLLOUT_TRANSCRIPT_COVERAGE_GAPS_OPEN'
  | 'ROLLOUT_LATENCY_7_DAY_WINDOW_MISSING'
  | 'ROLLOUT_ROLLBACK_NOT_TESTED'
  | 'ROLLOUT_KILL_SWITCH_NOT_VERIFIED'
  | 'ROLLOUT_RETELL_STANDBY_NOT_READY'
  | 'ROLLOUT_COST_BUDGET_NOT_APPROVED'
  | 'ROLLOUT_COST_PER_RESOLVED_CALL_OUT_OF_BAND'
  | 'ROLLOUT_DAILY_SPEND_CAP_MISSING'
  | 'ROLLOUT_COST_ALERTING_MISSING'
  | 'CANARY_REQUIRES_OWKB_CANARY_OR_PRIMARY_CANDIDATE'
  | 'PRIMARY_REQUIRES_OWKB_PRIMARY_CANDIDATE'
  | 'PRIMARY_REQUIRES_14_DAY_CANARY_WITHOUT_P0'
  | 'PRIMARY_UNRESOLVED_P1_GAPS'
  | 'PRIMARY_LATENCY_GATE_BREACH'
  | 'PRIMARY_KPI_HARD_GATE_REGRESSION'
  | 'PRIMARY_GOVERNANCE_WEAKENING_OPTIMIZATION'
  | 'PRIMARY_RETELL_STANDBY_14_TO_30_DAYS_REQUIRED'
  | 'CLEANUP_ACTIVE_OR_PROTECTED_KB'
  | 'CLEANUP_REFERENCES_STILL_EXIST'
  | 'CLEANUP_ROLLBACK_STILL_NEEDED'
  | 'CLEANUP_BILLING_OR_SUPPORT_DISPUTE_OPEN'
  | 'CLEANUP_AUDIT_MISSING';

export type RolloutCostCleanupReport = {
  ready: boolean;
  blockers: RolloutCostCleanupBlocker[];
  rolloutBlockers: RolloutCostCleanupBlocker[];
  cleanupBlockers: RolloutCostCleanupBlocker[];
  canStartCanary: boolean;
  canPromotePrimary: boolean;
  cleanupAllowed: boolean;
};

function add(blockers: RolloutCostCleanupBlocker[], condition: boolean, blocker: RolloutCostCleanupBlocker): void {
  if (condition && !blockers.includes(blocker)) blockers.push(blocker);
}

function canaryDecisionAllowed(decision: RolloutCandidateDecision): boolean {
  return decision === 'owkb_canary_candidate' || decision === 'owkb_primary_candidate';
}

function primaryDecisionAllowed(decision: RolloutCandidateDecision): boolean {
  return decision === 'owkb_primary_candidate';
}

function isProtectedLifecycleState(state: RetellKbLifecycleState): boolean {
  return state === 'active' ||
    state === 'canary' ||
    state === 'rollback_standby' ||
    state === 'pending_deploy';
}

export function evaluateRolloutCostCleanupControls(
  input: RolloutCostCleanupInput,
): RolloutCostCleanupReport {
  const rolloutBlockers: RolloutCostCleanupBlocker[] = [];
  const cleanupBlockers: RolloutCostCleanupBlocker[] = [];

  add(rolloutBlockers, !input.milestones1AThrough1IPassed, 'ROLLOUT_MILESTONE_1_GATES_MISSING');
  add(rolloutBlockers, !input.trusted0_5bReportExists, 'ROLLOUT_TRUSTED_0_5B_REPORT_MISSING');
  add(rolloutBlockers, !input.productKpiHardGatesPassed, 'ROLLOUT_PRODUCT_KPI_GATES_MISSING');
  add(rolloutBlockers, input.productKpiReport == null, 'ROLLOUT_PRODUCT_KPI_REPORT_MISSING');
  add(
    rolloutBlockers,
    input.productKpiReport != null && input.productKpiReport.hardGateReady !== true,
    'ROLLOUT_PRODUCT_KPI_REPORT_NOT_READY',
  );
  add(rolloutBlockers, !input.ultraLowLatencySloPassed, 'ROLLOUT_ULTRA_LOW_LATENCY_SLO_MISSING');
  add(rolloutBlockers, !input.exceptionPathSloReported, 'ROLLOUT_EXCEPTION_PATH_SLO_MISSING');
  add(rolloutBlockers, !input.shadowDualReadNoUnresolvedP0P1, 'ROLLOUT_SHADOW_DUAL_READ_GAPS_OPEN');
  add(rolloutBlockers, !input.transcriptCoverageGapsClosed, 'ROLLOUT_TRANSCRIPT_COVERAGE_GAPS_OPEN');
  add(rolloutBlockers, input.latencyGateConsecutiveDays < 7, 'ROLLOUT_LATENCY_7_DAY_WINDOW_MISSING');
  add(rolloutBlockers, !input.rollbackTestedPerOrgAgent, 'ROLLOUT_ROLLBACK_NOT_TESTED');
  add(rolloutBlockers, !input.emergencyKillSwitchVerified, 'ROLLOUT_KILL_SWITCH_NOT_VERIFIED');
  add(rolloutBlockers, !input.retellKbStandbyReady, 'ROLLOUT_RETELL_STANDBY_NOT_READY');
  add(rolloutBlockers, !input.costControls.budgetBandApproved, 'ROLLOUT_COST_BUDGET_NOT_APPROVED');
  add(rolloutBlockers, !input.costControls.costPerResolvedCallWithinBand, 'ROLLOUT_COST_PER_RESOLVED_CALL_OUT_OF_BAND');
  add(rolloutBlockers, !input.costControls.dailySpendCapConfigured, 'ROLLOUT_DAILY_SPEND_CAP_MISSING');
  add(rolloutBlockers, !input.costControls.alertingConfigured, 'ROLLOUT_COST_ALERTING_MISSING');

  if (input.stage === 'canary') {
    add(rolloutBlockers, !canaryDecisionAllowed(input.candidateDecision), 'CANARY_REQUIRES_OWKB_CANARY_OR_PRIMARY_CANDIDATE');
  } else {
    add(rolloutBlockers, !primaryDecisionAllowed(input.candidateDecision), 'PRIMARY_REQUIRES_OWKB_PRIMARY_CANDIDATE');
    add(rolloutBlockers, input.canaryWithoutP0Days < 14, 'PRIMARY_REQUIRES_14_DAY_CANARY_WITHOUT_P0');
    add(rolloutBlockers, input.unresolvedP1Gaps > 0, 'PRIMARY_UNRESOLVED_P1_GAPS');
    add(rolloutBlockers, input.latencyGateBreaches > 0, 'PRIMARY_LATENCY_GATE_BREACH');
    add(rolloutBlockers, input.kpiHardGateRegressions > 0, 'PRIMARY_KPI_HARD_GATE_REGRESSION');
    add(rolloutBlockers, input.governanceWeakeningOptimization, 'PRIMARY_GOVERNANCE_WEAKENING_OPTIMIZATION');
    add(
      rolloutBlockers,
      input.retellKbStandbyDays < 14 || input.retellKbStandbyDays > 30,
      'PRIMARY_RETELL_STANDBY_14_TO_30_DAYS_REQUIRED',
    );
  }

  const cleanup = input.cleanupCandidate;
  if (cleanup) {
    add(cleanupBlockers, isProtectedLifecycleState(cleanup.lifecycleState), 'CLEANUP_ACTIVE_OR_PROTECTED_KB');
    add(cleanupBlockers, cleanup.hasActiveReferences, 'CLEANUP_REFERENCES_STILL_EXIST');
    add(cleanupBlockers, cleanup.rollbackNeeded, 'CLEANUP_ROLLBACK_STILL_NEEDED');
    add(cleanupBlockers, cleanup.unresolvedBillingOrSupportDispute, 'CLEANUP_BILLING_OR_SUPPORT_DISPUTE_OPEN');
    add(cleanupBlockers, !cleanup.auditRecorded, 'CLEANUP_AUDIT_MISSING');
  }

  const blockers = [...rolloutBlockers, ...cleanupBlockers];
  const cleanupAllowed = cleanup != null &&
    cleanupBlockers.length === 0 &&
    cleanup.lifecycleState === 'unused' &&
    cleanup.hasActiveReferences === false &&
    cleanup.rollbackNeeded === false &&
    cleanup.unresolvedBillingOrSupportDispute === false &&
    cleanup.auditRecorded === true;
  const canStartCanary = input.stage === 'canary' && rolloutBlockers.length === 0;
  const canPromotePrimary = input.stage === 'primary' && rolloutBlockers.length === 0;

  return {
    ready: blockers.length === 0,
    blockers,
    rolloutBlockers,
    cleanupBlockers,
    canStartCanary,
    canPromotePrimary,
    cleanupAllowed,
  };
}
