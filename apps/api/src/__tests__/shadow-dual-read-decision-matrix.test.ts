import { describe, expect, it } from 'vitest';
import {
  buildShadowDualReadDecisionReport,
  classifyShadowDualReadComparison,
  type ShadowDualReadComparison,
} from '../shadow-dual-read-decision-matrix.js';

function comparison(index: number, overrides: Partial<ShadowDualReadComparison> = {}): ShadowDualReadComparison {
  return {
    comparisonId: `comparison_${index}`,
    questionFingerprint: `fingerprint_${index}`,
    intentId: `intent_${index}`,
    risk: 'low',
    retell: {
      answerable: true,
      answerKey: 'same-answer',
      p0Failure: false,
      p1Failure: false,
    },
    ownKb: {
      answerable: true,
      answerKey: 'same-answer',
      p0Failure: false,
      p1Failure: false,
    },
    expectedAbstain: false,
    humanReviewed: true,
    freshnessReviewed: true,
    riskReviewed: true,
    ...overrides,
  };
}

function completeComparisons(): ShadowDualReadComparison[] {
  return Array.from({ length: 30 }, (_, index) => comparison(index + 1));
}

describe('shadow/dual-read decision matrix', () => {
  it('classifies the planned Retell-vs-Own-KB comparison outcomes', () => {
    expect(classifyShadowDualReadComparison(comparison(1, {
      retell: { answerable: true, answerKey: 'retell', p0Failure: false, p1Failure: false },
      ownKb: { answerable: false, p0Failure: false, p1Failure: false },
    }))).toBe('retell_answerable_own_coverage_gap');
    expect(classifyShadowDualReadComparison(comparison(2, {
      retell: { answerable: false, p0Failure: false, p1Failure: false },
      ownKb: { answerable: true, answerKey: 'own', p0Failure: false, p1Failure: false },
    }))).toBe('own_answerable_retell_gap');
    expect(classifyShadowDualReadComparison(comparison(3))).toBe('both_answerable_same');
    expect(classifyShadowDualReadComparison(comparison(4, {
      ownKb: { answerable: true, answerKey: 'different', p0Failure: false, p1Failure: false },
    }))).toBe('both_answerable_different_review_required');
    expect(classifyShadowDualReadComparison(comparison(5, {
      retell: { answerable: false, p0Failure: false, p1Failure: false },
      ownKb: { answerable: false, p0Failure: false, p1Failure: false },
      expectedAbstain: true,
    }))).toBe('neither_answerable_expected_abstain');
    expect(classifyShadowDualReadComparison(comparison(6, {
      retell: { answerable: false, p0Failure: false, p1Failure: false },
      ownKb: { answerable: false, p0Failure: false, p1Failure: false },
      expectedAbstain: false,
    }))).toBe('neither_answerable_kb_expansion_needed');
  });

  it('accepts reviewed same-answer comparisons with 30 top-intent coverage', () => {
    const report = buildShadowDualReadDecisionReport(completeComparisons());

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.promotionRecommendation).toBe('ready_for_canary_review');
    expect(report.coverage).toMatchObject({
      comparisonCount: 30,
      uniqueIntentCount: 30,
      coverageGapCount: 0,
      answerConflictCount: 0,
    });
  });

  it('blocks promotion when Retell is answerable but Own-KB is not answerable', () => {
    const items = completeComparisons();
    items[0] = comparison(1, {
      retell: { answerable: true, answerKey: 'retell-answer', p0Failure: false, p1Failure: false },
      ownKb: { answerable: false, p0Failure: false, p1Failure: false },
    });

    const report = buildShadowDualReadDecisionReport(items);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('SHADOW_OWN_KB_COVERAGE_GAP');
    expect(report.coverage.coverageGapCount).toBe(1);
  });

  it('records Own-KB-only answerability as a potential improvement without blocking by itself', () => {
    const items = completeComparisons();
    items[0] = comparison(1, {
      retell: { answerable: false, p0Failure: false, p1Failure: false },
      ownKb: { answerable: true, answerKey: 'own-answer', p0Failure: false, p1Failure: false },
    });

    const report = buildShadowDualReadDecisionReport(items);

    expect(report.ready).toBe(true);
    expect(report.coverage.potentialImprovementCount).toBe(1);
  });

  it('requires human, freshness, and risk review for high-risk conflicting answers', () => {
    const items = completeComparisons();
    items[0] = comparison(1, {
      risk: 'pricing',
      retell: { answerable: true, answerKey: 'old-price', p0Failure: false, p1Failure: false },
      ownKb: { answerable: true, answerKey: 'new-price', p0Failure: false, p1Failure: false },
      humanReviewed: true,
      freshnessReviewed: false,
      riskReviewed: false,
    });
    items[1] = comparison(2, {
      risk: 'low',
      retell: { answerable: true, answerKey: 'a', p0Failure: false, p1Failure: false },
      ownKb: { answerable: true, answerKey: 'b', p0Failure: false, p1Failure: false },
      humanReviewed: false,
    });

    const report = buildShadowDualReadDecisionReport(items);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('SHADOW_ANSWER_CONFLICT_UNREVIEWED');
    expect(report.blockers).toContain('SHADOW_HIGH_RISK_CONFLICT_UNREVIEWED');
    expect(report.coverage.answerConflictCount).toBe(2);
  });

  it('blocks unresolved P0/P1 gaps and neither-answerable cases that need a KB decision', () => {
    const items = completeComparisons();
    items[0] = comparison(1, {
      retell: { answerable: true, answerKey: 'same-answer', p0Failure: true, p1Failure: false },
    });
    items[1] = comparison(2, {
      ownKb: { answerable: true, answerKey: 'same-answer', p0Failure: false, p1Failure: true },
    });
    items[2] = comparison(3, {
      retell: { answerable: false, p0Failure: false, p1Failure: false },
      ownKb: { answerable: false, p0Failure: false, p1Failure: false },
      expectedAbstain: false,
    });

    const report = buildShadowDualReadDecisionReport(items);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('SHADOW_UNRESOLVED_P0_FAILURE');
    expect(report.blockers).toContain('SHADOW_UNRESOLVED_P1_FAILURE');
    expect(report.blockers).toContain('SHADOW_NEITHER_ANSWERABLE_NEEDS_DECISION');
  });

  it('requires comparison fingerprints and 30-intent coverage without duplicates', () => {
    const items = completeComparisons().slice(0, 8);
    items[0] = comparison(1, { questionFingerprint: '' });
    items[1] = comparison(2, { questionFingerprint: 'fingerprint_3' });
    items[2] = comparison(3, { questionFingerprint: 'fingerprint_3' });

    const report = buildShadowDualReadDecisionReport(items);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('SHADOW_QUESTION_FINGERPRINT_MISSING');
    expect(report.blockers).toContain('SHADOW_DUPLICATE_QUESTION_FINGERPRINT');
    expect(report.blockers).toContain('SHADOW_INTENT_COVERAGE_INSUFFICIENT');
  });
});
