import { describe, expect, it } from 'vitest';
import {
  evaluateProductKpiReport,
  HARD_GATE_KPIS,
  MONITORED_KPIS,
  type ProductKpiMetric,
  type ProductKpiName,
} from '../product-kpi-contract.js';

function directionFor(name: ProductKpiName): ProductKpiMetric['direction'] {
  if (name === 'interruption_recovery_rate' ||
    name === 'top_intent_answerability' ||
    name === 'opening_hours_spoken_correctly_rate' ||
    name === 'call_containment_rate' ||
    name === 'task_completion_rate' ||
    name === 'confirmation_correction_success_rate' ||
    name === 'post_call_qa_score' ||
    name === 'tenant_kb_coverage' ||
    name === 'fast_path_coverage_rate') {
    return 'higher_or_equal';
  }
  if (name === 'cost_per_resolved_call') return 'within_band';
  return 'lower_or_equal';
}

function metric(name: ProductKpiName, overrides: Partial<ProductKpiMetric> = {}): ProductKpiMetric {
  const direction = overrides.direction ?? directionFor(name);
  return {
    name,
    hardGate: HARD_GATE_KPIS.includes(name),
    value: direction === 'higher_or_equal' ? 0.95 : direction === 'within_band' ? 2.2 : 0.02,
    baselineValue: direction === 'higher_or_equal' ? 0.9 : direction === 'within_band' ? 2.1 : 0.03,
    targetValue: direction === 'higher_or_equal' ? 0.9 : direction === 'within_band' ? null : 0.03,
    lowerBound: direction === 'within_band' ? 1.5 : null,
    upperBound: direction === 'within_band' ? 2.5 : null,
    allowedTolerance: 0.01,
    direction,
    sampleSize: 100,
    minimumSampleSize: 50,
    baselineWindowDays: 14,
    ownerApproval: 'ops_owner',
    budgetBandSource: name === 'cost_per_resolved_call' ? 'budget-2026-voice' : null,
    sourceVersion: 'kpi-schema-2026-05-30',
    ...overrides,
  };
}

function completeReportMetrics(): ProductKpiMetric[] {
  return [
    ...HARD_GATE_KPIS.map((name) => metric(name)),
    ...MONITORED_KPIS.map((name) => metric(name)),
  ];
}

describe('product KPI contract', () => {
  it('accepts complete hard-gate and monitored KPI reports with explicit baselines, tolerances, owner, and budget source', () => {
    const report = evaluateProductKpiReport(completeReportMetrics());

    expect(report.ready).toBe(true);
    expect(report.hardGateReady).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.summary).toMatchObject({
      hardGateCount: HARD_GATE_KPIS.length,
      monitoredCount: MONITORED_KPIS.length,
      failedHardGateCount: 0,
      inconclusiveHardGateCount: 0,
    });
  });

  it('blocks canary readiness when a required hard-gate KPI is missing', () => {
    const report = evaluateProductKpiReport(completeReportMetrics()
      .filter((item) => item.name !== 'missed_escalation_after_human_request_rate'));

    expect(report.ready).toBe(false);
    expect(report.hardGateReady).toBe(false);
    expect(report.blockers).toContain('PRODUCT_KPI_REQUIRED_HARD_GATE_MISSING');
  });

  it('treats missing baseline, sample size, tolerance, owner, or budget source as inconclusive and rollout-blocking', () => {
    const broken = completeReportMetrics();
    broken[0] = metric('wrong_escalation_rate', {
      baselineValue: null,
      allowedTolerance: null,
      sampleSize: 12,
      ownerApproval: null,
    });
    broken[HARD_GATE_KPIS.indexOf('cost_per_resolved_call')] = metric('cost_per_resolved_call', {
      budgetBandSource: null,
    });

    const report = evaluateProductKpiReport(broken);

    expect(report.ready).toBe(false);
    expect(report.hardGateReady).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'PRODUCT_KPI_BASELINE_MISSING',
      'PRODUCT_KPI_TOLERANCE_MISSING',
      'PRODUCT_KPI_SAMPLE_SIZE_INSUFFICIENT',
      'PRODUCT_KPI_OWNER_APPROVAL_MISSING',
      'PRODUCT_KPI_BUDGET_BAND_SOURCE_MISSING',
      'PRODUCT_KPI_INCONCLUSIVE',
    ]));
  });

  it('requires a 14-day baseline window or approved representative equivalent before hard gates can pass', () => {
    const broken = completeReportMetrics();
    broken[0] = metric('hang_up_after_silence_rate', {
      baselineWindowDays: 7,
    });

    const report = evaluateProductKpiReport(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PRODUCT_KPI_BASELINE_WINDOW_INSUFFICIENT');
    expect(report.blockers).toContain('PRODUCT_KPI_INCONCLUSIVE');
  });

  it('fails hard gates when lower-is-better or higher-is-better targets regress beyond tolerance', () => {
    const broken = completeReportMetrics();
    broken[0] = metric('wrong_escalation_rate', {
      value: 0.08,
      targetValue: 0.03,
      allowedTolerance: 0.005,
    });
    broken[HARD_GATE_KPIS.indexOf('top_intent_answerability')] = metric('top_intent_answerability', {
      value: 0.7,
      targetValue: 0.9,
      allowedTolerance: 0.01,
    });

    const report = evaluateProductKpiReport(broken);

    expect(report.ready).toBe(false);
    expect(report.summary.failedHardGateCount).toBe(2);
    expect(report.blockers).toContain('PRODUCT_KPI_HARD_GATE_FAILED');
  });

  it('fails cost_per_resolved_call when it falls outside the approved budget band', () => {
    const broken = completeReportMetrics();
    broken[HARD_GATE_KPIS.indexOf('cost_per_resolved_call')] = metric('cost_per_resolved_call', {
      value: 4.2,
      lowerBound: 1.5,
      upperBound: 2.5,
      allowedTolerance: 0.1,
    });

    const report = evaluateProductKpiReport(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PRODUCT_KPI_HARD_GATE_FAILED');
  });

  it('rejects hard-gate metrics marked as monitored and monitored metrics marked as hard gates', () => {
    const broken = completeReportMetrics();
    broken[0] = metric('wrong_escalation_rate', { hardGate: false });
    broken[HARD_GATE_KPIS.length] = metric('call_containment_rate', { hardGate: true });

    const report = evaluateProductKpiReport(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PRODUCT_KPI_HARD_GATE_MARKED_MONITORED');
    expect(report.blockers).toContain('PRODUCT_KPI_MONITORED_MARKED_HARD_GATE');
  });

  it('rejects unsafe or missing owner approval identifiers', () => {
    const broken = completeReportMetrics();
    broken[0] = metric('wrong_escalation_rate', { ownerApproval: 'Owner Name' });
    broken[1] = metric('missed_escalation_rate', { ownerApproval: 'ops@example.com' });

    const report = evaluateProductKpiReport(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PRODUCT_KPI_OWNER_APPROVAL_MISSING');
  });
});
