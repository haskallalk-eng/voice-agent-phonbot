export type ShadowDualReadRisk = 'low' | 'medium' | 'high' | 'pricing' | 'legal' | 'policy';

export type ShadowDualReadProviderResult = {
  answerable: boolean;
  answerKey?: string | null;
  p0Failure: boolean;
  p1Failure: boolean;
};

export type ShadowDualReadComparison = {
  comparisonId: string;
  questionFingerprint: string;
  intentId: string;
  risk: ShadowDualReadRisk;
  retell: ShadowDualReadProviderResult;
  ownKb: ShadowDualReadProviderResult;
  expectedAbstain: boolean;
  humanReviewed: boolean;
  freshnessReviewed: boolean;
  riskReviewed: boolean;
};

export type ShadowDualReadClassification =
  | 'retell_answerable_own_coverage_gap'
  | 'own_answerable_retell_gap'
  | 'both_answerable_same'
  | 'both_answerable_different_review_required'
  | 'neither_answerable_expected_abstain'
  | 'neither_answerable_kb_expansion_needed';

export type ShadowDualReadBlocker =
  | 'SHADOW_COMPARISONS_MISSING'
  | 'SHADOW_QUESTION_FINGERPRINT_MISSING'
  | 'SHADOW_DUPLICATE_QUESTION_FINGERPRINT'
  | 'SHADOW_INTENT_COVERAGE_INSUFFICIENT'
  | 'SHADOW_OWN_KB_COVERAGE_GAP'
  | 'SHADOW_UNRESOLVED_P0_FAILURE'
  | 'SHADOW_UNRESOLVED_P1_FAILURE'
  | 'SHADOW_ANSWER_CONFLICT_UNREVIEWED'
  | 'SHADOW_HIGH_RISK_CONFLICT_UNREVIEWED'
  | 'SHADOW_NEITHER_ANSWERABLE_NEEDS_DECISION';

export type ShadowDualReadPromotionRecommendation =
  | 'block_promotion'
  | 'continue_shadow_only'
  | 'ready_for_canary_review';

export type ShadowDualReadClassifiedComparison = ShadowDualReadComparison & {
  classification: ShadowDualReadClassification;
};

export type ShadowDualReadDecisionReport = {
  ready: boolean;
  blockers: ShadowDualReadBlocker[];
  promotionRecommendation: ShadowDualReadPromotionRecommendation;
  coverage: {
    comparisonCount: number;
    uniqueIntentCount: number;
    coverageGapCount: number;
    potentialImprovementCount: number;
    answerConflictCount: number;
    expectedAbstainCount: number;
    kbExpansionNeededCount: number;
  };
  comparisons: ShadowDualReadClassifiedComparison[];
};

function add(blockers: ShadowDualReadBlocker[], condition: boolean, blocker: ShadowDualReadBlocker): void {
  if (condition && !blockers.includes(blocker)) blockers.push(blocker);
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHighRisk(risk: ShadowDualReadRisk): boolean {
  return risk === 'high' || risk === 'pricing' || risk === 'legal' || risk === 'policy';
}

function answerKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function classifyShadowDualReadComparison(
  item: ShadowDualReadComparison,
): ShadowDualReadClassification {
  if (item.retell.answerable && !item.ownKb.answerable) return 'retell_answerable_own_coverage_gap';
  if (!item.retell.answerable && item.ownKb.answerable) return 'own_answerable_retell_gap';
  if (item.retell.answerable && item.ownKb.answerable) {
    return answerKey(item.retell.answerKey) === answerKey(item.ownKb.answerKey)
      ? 'both_answerable_same'
      : 'both_answerable_different_review_required';
  }
  return item.expectedAbstain
    ? 'neither_answerable_expected_abstain'
    : 'neither_answerable_kb_expansion_needed';
}

export function buildShadowDualReadDecisionReport(
  input: ShadowDualReadComparison[],
): ShadowDualReadDecisionReport {
  const blockers: ShadowDualReadBlocker[] = [];
  const comparisons = input.map((item) => ({
    ...item,
    classification: classifyShadowDualReadComparison(item),
  }));
  const fingerprints = comparisons.map((item) => item.questionFingerprint.trim()).filter(Boolean);
  const duplicateFingerprints = new Set<string>();
  const seenFingerprints = new Set<string>();
  for (const fingerprint of fingerprints) {
    if (seenFingerprints.has(fingerprint)) duplicateFingerprints.add(fingerprint);
    seenFingerprints.add(fingerprint);
  }

  const uniqueIntentCount = new Set(comparisons.map((item) => item.intentId).filter(hasText)).size;
  const coverageGapCount = comparisons.filter((item) => item.classification === 'retell_answerable_own_coverage_gap').length;
  const potentialImprovementCount = comparisons.filter((item) => item.classification === 'own_answerable_retell_gap').length;
  const answerConflictCount = comparisons.filter((item) => item.classification === 'both_answerable_different_review_required').length;
  const expectedAbstainCount = comparisons.filter((item) => item.classification === 'neither_answerable_expected_abstain').length;
  const kbExpansionNeededCount = comparisons.filter((item) => item.classification === 'neither_answerable_kb_expansion_needed').length;

  add(blockers, comparisons.length === 0, 'SHADOW_COMPARISONS_MISSING');
  add(blockers, comparisons.some((item) => !hasText(item.questionFingerprint)), 'SHADOW_QUESTION_FINGERPRINT_MISSING');
  add(blockers, duplicateFingerprints.size > 0, 'SHADOW_DUPLICATE_QUESTION_FINGERPRINT');
  add(blockers, uniqueIntentCount < 30, 'SHADOW_INTENT_COVERAGE_INSUFFICIENT');
  add(blockers, coverageGapCount > 0, 'SHADOW_OWN_KB_COVERAGE_GAP');
  add(
    blockers,
    comparisons.some((item) => item.retell.p0Failure || item.ownKb.p0Failure),
    'SHADOW_UNRESOLVED_P0_FAILURE',
  );
  add(
    blockers,
    comparisons.some((item) => item.retell.p1Failure || item.ownKb.p1Failure),
    'SHADOW_UNRESOLVED_P1_FAILURE',
  );
  add(
    blockers,
    comparisons.some((item) => item.classification === 'both_answerable_different_review_required' && !item.humanReviewed),
    'SHADOW_ANSWER_CONFLICT_UNREVIEWED',
  );
  add(
    blockers,
    comparisons.some((item) =>
      item.classification === 'both_answerable_different_review_required' &&
      isHighRisk(item.risk) &&
      !(item.humanReviewed && item.freshnessReviewed && item.riskReviewed)),
    'SHADOW_HIGH_RISK_CONFLICT_UNREVIEWED',
  );
  add(blockers, kbExpansionNeededCount > 0, 'SHADOW_NEITHER_ANSWERABLE_NEEDS_DECISION');

  const ready = blockers.length === 0;
  return {
    ready,
    blockers,
    promotionRecommendation: ready ? 'ready_for_canary_review' : 'block_promotion',
    coverage: {
      comparisonCount: comparisons.length,
      uniqueIntentCount,
      coverageGapCount,
      potentialImprovementCount,
      answerConflictCount,
      expectedAbstainCount,
      kbExpansionNeededCount,
    },
    comparisons,
  };
}
