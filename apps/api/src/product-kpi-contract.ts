export type ProductKpiName =
  | 'wrong_escalation_rate'
  | 'missed_escalation_rate'
  | 'missed_escalation_after_human_request_rate'
  | 'false_containment_rate'
  | 'wrongly_contained_calls'
  | 'hang_up_after_silence_rate'
  | 'interruption_recovery_rate'
  | 'top_intent_answerability'
  | 'cost_per_resolved_call'
  | 'pronunciation_error_rate'
  | 'opening_hours_spoken_correctly_rate'
  | 'call_containment_rate'
  | 'task_completion_rate'
  | 'confirmation_correction_success_rate'
  | 'post_call_qa_score'
  | 'tenant_kb_coverage'
  | 'fast_path_coverage_rate'
  | 'repeat_request_rate';

export const HARD_GATE_KPIS: ProductKpiName[] = [
  'wrong_escalation_rate',
  'missed_escalation_rate',
  'missed_escalation_after_human_request_rate',
  'false_containment_rate',
  'wrongly_contained_calls',
  'hang_up_after_silence_rate',
  'interruption_recovery_rate',
  'top_intent_answerability',
  'cost_per_resolved_call',
  'pronunciation_error_rate',
  'opening_hours_spoken_correctly_rate',
];

export const MONITORED_KPIS: ProductKpiName[] = [
  'call_containment_rate',
  'task_completion_rate',
  'confirmation_correction_success_rate',
  'post_call_qa_score',
  'tenant_kb_coverage',
  'fast_path_coverage_rate',
  'repeat_request_rate',
];

export type ProductKpiDirection = 'lower_or_equal' | 'higher_or_equal' | 'within_band';
export type ProductKpiStatus = 'pass' | 'fail' | 'inconclusive';

export type ProductKpiMetric = {
  name: ProductKpiName;
  hardGate: boolean;
  value: number | null;
  baselineValue: number | null;
  targetValue: number | null;
  lowerBound?: number | null;
  upperBound?: number | null;
  allowedTolerance: number | null;
  direction: ProductKpiDirection;
  sampleSize: number;
  minimumSampleSize: number;
  baselineWindowDays: number;
  ownerApproval: string | null;
  budgetBandSource?: string | null;
  sourceVersion?: string | null;
};

export type ProductKpiBlocker =
  | 'PRODUCT_KPI_REQUIRED_HARD_GATE_MISSING'
  | 'PRODUCT_KPI_HARD_GATE_MARKED_MONITORED'
  | 'PRODUCT_KPI_MONITORED_MARKED_HARD_GATE'
  | 'PRODUCT_KPI_VALUE_MISSING'
  | 'PRODUCT_KPI_BASELINE_MISSING'
  | 'PRODUCT_KPI_TARGET_MISSING'
  | 'PRODUCT_KPI_TOLERANCE_MISSING'
  | 'PRODUCT_KPI_SAMPLE_SIZE_INSUFFICIENT'
  | 'PRODUCT_KPI_BASELINE_WINDOW_INSUFFICIENT'
  | 'PRODUCT_KPI_OWNER_APPROVAL_MISSING'
  | 'PRODUCT_KPI_BUDGET_BAND_SOURCE_MISSING'
  | 'PRODUCT_KPI_HARD_GATE_FAILED'
  | 'PRODUCT_KPI_INCONCLUSIVE';

export type ProductKpiEvaluatedMetric = ProductKpiMetric & {
  status: ProductKpiStatus;
  blockers: ProductKpiBlocker[];
};

export type ProductKpiReport = {
  ready: boolean;
  blockers: ProductKpiBlocker[];
  hardGateReady: boolean;
  metrics: ProductKpiEvaluatedMetric[];
  summary: {
    hardGateCount: number;
    monitoredCount: number;
    failedHardGateCount: number;
    inconclusiveHardGateCount: number;
  };
};

function add(blockers: ProductKpiBlocker[], condition: boolean, blocker: ProductKpiBlocker): void {
  if (condition && !blockers.includes(blocker)) blockers.push(blocker);
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function allowedOwnerHandle(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized);
}

function evaluateMetric(metric: ProductKpiMetric): ProductKpiEvaluatedMetric {
  const blockers: ProductKpiBlocker[] = [];
  const requiredHardGate = HARD_GATE_KPIS.includes(metric.name);
  const monitored = MONITORED_KPIS.includes(metric.name);

  add(blockers, requiredHardGate && !metric.hardGate, 'PRODUCT_KPI_HARD_GATE_MARKED_MONITORED');
  add(blockers, monitored && metric.hardGate, 'PRODUCT_KPI_MONITORED_MARKED_HARD_GATE');
  add(blockers, !finite(metric.value), 'PRODUCT_KPI_VALUE_MISSING');
  add(blockers, !finite(metric.baselineValue), 'PRODUCT_KPI_BASELINE_MISSING');
  add(blockers, metric.direction !== 'within_band' && !finite(metric.targetValue), 'PRODUCT_KPI_TARGET_MISSING');
  add(blockers, metric.direction === 'within_band' && (!finite(metric.lowerBound) || !finite(metric.upperBound)), 'PRODUCT_KPI_TARGET_MISSING');
  add(blockers, !finite(metric.allowedTolerance) || metric.allowedTolerance < 0, 'PRODUCT_KPI_TOLERANCE_MISSING');
  add(blockers, metric.sampleSize < metric.minimumSampleSize || metric.minimumSampleSize <= 0, 'PRODUCT_KPI_SAMPLE_SIZE_INSUFFICIENT');
  add(blockers, metric.baselineWindowDays < 14, 'PRODUCT_KPI_BASELINE_WINDOW_INSUFFICIENT');
  add(blockers, !allowedOwnerHandle(metric.ownerApproval), 'PRODUCT_KPI_OWNER_APPROVAL_MISSING');
  add(blockers, metric.name === 'cost_per_resolved_call' && !hasText(metric.budgetBandSource), 'PRODUCT_KPI_BUDGET_BAND_SOURCE_MISSING');

  let gatePassed = false;
  if (blockers.length === 0 && finite(metric.value)) {
    if (metric.direction === 'lower_or_equal' && finite(metric.targetValue) && finite(metric.allowedTolerance)) {
      gatePassed = metric.value <= metric.targetValue + metric.allowedTolerance;
    } else if (metric.direction === 'higher_or_equal' && finite(metric.targetValue) && finite(metric.allowedTolerance)) {
      gatePassed = metric.value >= metric.targetValue - metric.allowedTolerance;
    } else if (
      metric.direction === 'within_band' &&
      finite(metric.lowerBound) &&
      finite(metric.upperBound) &&
      finite(metric.allowedTolerance)
    ) {
      gatePassed = metric.value >= metric.lowerBound - metric.allowedTolerance &&
        metric.value <= metric.upperBound + metric.allowedTolerance;
    }
  }

  if (metric.hardGate && blockers.length === 0 && !gatePassed) {
    blockers.push('PRODUCT_KPI_HARD_GATE_FAILED');
  }

  const status: ProductKpiStatus = blockers.length > 0
    ? blockers.some((blocker) => blocker === 'PRODUCT_KPI_HARD_GATE_FAILED') ? 'fail' : 'inconclusive'
    : 'pass';

  return {
    ...metric,
    status,
    blockers,
  };
}

export function evaluateProductKpiReport(metrics: ProductKpiMetric[]): ProductKpiReport {
  const evaluated = metrics.map(evaluateMetric);
  const blockers: ProductKpiBlocker[] = [];
  const metricNames = new Set(metrics.map((metric) => metric.name));
  for (const required of HARD_GATE_KPIS) {
    add(blockers, !metricNames.has(required), 'PRODUCT_KPI_REQUIRED_HARD_GATE_MISSING');
  }
  for (const metric of evaluated) {
    for (const blocker of metric.blockers) {
      add(blockers, true, blocker);
    }
  }
  add(
    blockers,
    evaluated.some((metric) => metric.hardGate && metric.status === 'inconclusive'),
    'PRODUCT_KPI_INCONCLUSIVE',
  );

  const failedHardGateCount = evaluated.filter((metric) => metric.hardGate && metric.status === 'fail').length;
  const inconclusiveHardGateCount = evaluated.filter((metric) => metric.hardGate && metric.status === 'inconclusive').length;

  return {
    ready: blockers.length === 0,
    blockers,
    hardGateReady: blockers.length === 0 && failedHardGateCount === 0 && inconclusiveHardGateCount === 0,
    metrics: evaluated,
    summary: {
      hardGateCount: evaluated.filter((metric) => metric.hardGate).length,
      monitoredCount: evaluated.filter((metric) => !metric.hardGate).length,
      failedHardGateCount,
      inconclusiveHardGateCount,
    },
  };
}
