import { describe, expect, it } from 'vitest';
import {
  evaluateRolloutCostCleanupControls,
  type RolloutCostCleanupInput,
} from '../rollout-cost-cleanup-controls.js';

function readyInput(overrides: Partial<RolloutCostCleanupInput> = {}): RolloutCostCleanupInput {
  return {
    stage: 'canary',
    candidateDecision: 'owkb_canary_candidate',
    milestones1AThrough1IPassed: true,
    trusted0_5bReportExists: true,
    productKpiHardGatesPassed: true,
    productKpiReport: {
      hardGateReady: true,
      blockers: [],
    },
    ultraLowLatencySloPassed: true,
    exceptionPathSloReported: true,
    shadowDualReadNoUnresolvedP0P1: true,
    transcriptCoverageGapsClosed: true,
    latencyGateConsecutiveDays: 7,
    rollbackTestedPerOrgAgent: true,
    emergencyKillSwitchVerified: true,
    retellKbStandbyReady: true,
    canaryWithoutP0Days: 0,
    unresolvedP1Gaps: 0,
    latencyGateBreaches: 0,
    kpiHardGateRegressions: 0,
    governanceWeakeningOptimization: false,
    retellKbStandbyDays: 14,
    costControls: {
      budgetBandApproved: true,
      costPerResolvedCallWithinBand: true,
      dailySpendCapConfigured: true,
      alertingConfigured: true,
    },
    ...overrides,
  };
}

describe('rollout, cost, and cleanup controls contract', () => {
  it('allows canary only when all readiness, SLO, KPI, cost, rollback, kill-switch, and standby gates pass', () => {
    const report = evaluateRolloutCostCleanupControls(readyInput());

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.rolloutBlockers).toEqual([]);
    expect(report.cleanupBlockers).toEqual([]);
    expect(report.canStartCanary).toBe(true);
    expect(report.canPromotePrimary).toBe(false);
  });

  it('blocks canary when the candidate decision is not canary or primary ready', () => {
    const report = evaluateRolloutCostCleanupControls(readyInput({
      candidateDecision: 'owkb_shadow_only',
    }));

    expect(report.ready).toBe(false);
    expect(report.canStartCanary).toBe(false);
    expect(report.blockers).toContain('CANARY_REQUIRES_OWKB_CANARY_OR_PRIMARY_CANDIDATE');
  });

  it('blocks rollout when global gates, benchmark evidence, SLOs, Product KPIs, or shadow gaps are missing', () => {
    const report = evaluateRolloutCostCleanupControls(readyInput({
      milestones1AThrough1IPassed: false,
      trusted0_5bReportExists: false,
      productKpiHardGatesPassed: false,
      productKpiReport: null,
      ultraLowLatencySloPassed: false,
      exceptionPathSloReported: false,
      shadowDualReadNoUnresolvedP0P1: false,
      transcriptCoverageGapsClosed: false,
      latencyGateConsecutiveDays: 6,
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'ROLLOUT_MILESTONE_1_GATES_MISSING',
      'ROLLOUT_TRUSTED_0_5B_REPORT_MISSING',
      'ROLLOUT_PRODUCT_KPI_GATES_MISSING',
      'ROLLOUT_PRODUCT_KPI_REPORT_MISSING',
      'ROLLOUT_ULTRA_LOW_LATENCY_SLO_MISSING',
      'ROLLOUT_EXCEPTION_PATH_SLO_MISSING',
      'ROLLOUT_SHADOW_DUAL_READ_GAPS_OPEN',
      'ROLLOUT_TRANSCRIPT_COVERAGE_GAPS_OPEN',
      'ROLLOUT_LATENCY_7_DAY_WINDOW_MISSING',
    ]));
  });

  it('blocks rollout when the supplied Product KPI report is not hard-gate ready', () => {
    const report = evaluateRolloutCostCleanupControls(readyInput({
      productKpiReport: {
        hardGateReady: false,
        blockers: ['PRODUCT_KPI_INCONCLUSIVE'],
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('ROLLOUT_PRODUCT_KPI_REPORT_NOT_READY');
  });

  it('blocks rollout when rollback, kill switch, Retell standby, or cost controls are missing', () => {
    const report = evaluateRolloutCostCleanupControls(readyInput({
      rollbackTestedPerOrgAgent: false,
      emergencyKillSwitchVerified: false,
      retellKbStandbyReady: false,
      costControls: {
        budgetBandApproved: false,
        costPerResolvedCallWithinBand: false,
        dailySpendCapConfigured: false,
        alertingConfigured: false,
      },
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'ROLLOUT_ROLLBACK_NOT_TESTED',
      'ROLLOUT_KILL_SWITCH_NOT_VERIFIED',
      'ROLLOUT_RETELL_STANDBY_NOT_READY',
      'ROLLOUT_COST_BUDGET_NOT_APPROVED',
      'ROLLOUT_COST_PER_RESOLVED_CALL_OUT_OF_BAND',
      'ROLLOUT_DAILY_SPEND_CAP_MISSING',
      'ROLLOUT_COST_ALERTING_MISSING',
    ]));
  });

  it('allows primary only with primary decision, 14 clean canary days, no P1/SLO/KPI regression, and 14-30 standby days', () => {
    const report = evaluateRolloutCostCleanupControls(readyInput({
      stage: 'primary',
      candidateDecision: 'owkb_primary_candidate',
      canaryWithoutP0Days: 14,
      retellKbStandbyDays: 30,
    }));

    expect(report.ready).toBe(true);
    expect(report.canStartCanary).toBe(false);
    expect(report.canPromotePrimary).toBe(true);
  });

  it('blocks primary when canary evidence, P1 status, latency, KPI, governance, or standby window is unsafe', () => {
    const report = evaluateRolloutCostCleanupControls(readyInput({
      stage: 'primary',
      candidateDecision: 'owkb_canary_candidate',
      canaryWithoutP0Days: 13,
      unresolvedP1Gaps: 1,
      latencyGateBreaches: 1,
      kpiHardGateRegressions: 1,
      governanceWeakeningOptimization: true,
      retellKbStandbyDays: 31,
    }));

    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'PRIMARY_REQUIRES_OWKB_PRIMARY_CANDIDATE',
      'PRIMARY_REQUIRES_14_DAY_CANARY_WITHOUT_P0',
      'PRIMARY_UNRESOLVED_P1_GAPS',
      'PRIMARY_LATENCY_GATE_BREACH',
      'PRIMARY_KPI_HARD_GATE_REGRESSION',
      'PRIMARY_GOVERNANCE_WEAKENING_OPTIMIZATION',
      'PRIMARY_RETELL_STANDBY_14_TO_30_DAYS_REQUIRED',
    ]));
  });

  it('allows Retell-KB cleanup only for unused, unreferenced, audited KBs with no rollback or dispute need', () => {
    const report = evaluateRolloutCostCleanupControls(readyInput({
      cleanupCandidate: {
        lifecycleState: 'unused',
        hasActiveReferences: false,
        rollbackNeeded: false,
        unresolvedBillingOrSupportDispute: false,
        auditRecorded: true,
      },
    }));

    expect(report.cleanupAllowed).toBe(true);
    expect(report.cleanupBlockers).toEqual([]);
  });

  it('blocks cleanup for active, canary, standby, pending, referenced, unaudited, rollback-needed, or disputed KBs', () => {
    for (const lifecycleState of ['active', 'canary', 'rollback_standby', 'pending_deploy'] as const) {
      const report = evaluateRolloutCostCleanupControls(readyInput({
        cleanupCandidate: {
          lifecycleState,
          hasActiveReferences: true,
          rollbackNeeded: true,
          unresolvedBillingOrSupportDispute: true,
          auditRecorded: false,
        },
      }));

      expect(report.cleanupAllowed).toBe(false);
      expect(report.cleanupBlockers).toEqual(expect.arrayContaining([
        'CLEANUP_ACTIVE_OR_PROTECTED_KB',
        'CLEANUP_REFERENCES_STILL_EXIST',
        'CLEANUP_ROLLBACK_STILL_NEEDED',
        'CLEANUP_BILLING_OR_SUPPORT_DISPUTE_OPEN',
        'CLEANUP_AUDIT_MISSING',
      ]));
      expect(report.blockers).toEqual(expect.arrayContaining([
        'CLEANUP_ACTIVE_OR_PROTECTED_KB',
        'CLEANUP_REFERENCES_STILL_EXIST',
        'CLEANUP_ROLLBACK_STILL_NEEDED',
        'CLEANUP_BILLING_OR_SUPPORT_DISPUTE_OPEN',
        'CLEANUP_AUDIT_MISSING',
      ]));
    }
  });
});
