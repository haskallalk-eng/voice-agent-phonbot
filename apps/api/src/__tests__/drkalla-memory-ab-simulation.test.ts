import { describe, expect, it } from 'vitest';
import {
  DRKALLA_MEMORY_AB_CATEGORY_TARGETS,
  buildDrkallaMemoryAbCases,
  evaluateDrkallaMemoryAbCase,
  runDrkallaMemoryAbSimulation,
  sanitizeDrkallaMemoryAbReport,
} from '../drkalla-memory-ab-simulation.js';

describe('DrKalla memory A/B simulation matrix', () => {
  it('builds exactly 1000 deterministic cases with 100 cases per required category', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-memory-v1' });

    expect(cases).toHaveLength(1000);
    for (const [category, target] of Object.entries(DRKALLA_MEMORY_AB_CATEGORY_TARGETS)) {
      expect(cases.filter((item) => item.category === category)).toHaveLength(target);
    }
  });

  it('proves A exposes known failures and B fixes them without regressions', () => {
    const report = runDrkallaMemoryAbSimulation({ cases: 1000, seed: 'drkalla-memory-v1' });

    expect(report.totalCases).toBe(1000);
    expect(report.bPassed).toBe(1000);
    expect(report.bFailed).toBe(0);
    expect(report.promptCompressionNoRegressionPassed).toBe(true);
    expect(report.memoryP95Ms).toBeLessThanOrEqual(20);
    expect(report.extraLlmCalls).toBe(0);
    expect(report.extraKbCalls).toBe(0);
    expect(report.liveSyncAllowed).toBe(false);
    expect(report.retellManagedMemoryEffective).toBe(false);
    expect(report.customRuntimeMemoryReady).toBe(true);
    expect(report.customRuntimeMemoryEffective).toBe(true);
    expect(report.liveReadinessGatePassed).toBe(false);
    expect(report.readinessBlockers).not.toContain('CUSTOM_RUNTIME_MEMORY_NOT_LIVE_EFFECTIVE');
    expect(report.readinessBlockers).toContain('RETELL_MANAGED_PROMPT_MEMORY_LIMITED');
    expect(report.readinessBlockers).toContain('LIVE_SYNC_NOT_APPROVED');

    expect(report.aFailureByCategory.inaudible_repair).toBeGreaterThan(0);
    expect(report.aFailureByCategory.end_call_boundaries).toBeGreaterThan(0);
    expect(report.aFailureByCategory.sms_link_dedupe).toBeGreaterThan(0);
    expect(report.aFailureByCategory.prompt_compression_no_regression).toBe(0);
  });

  it('evaluates every category with a real assertion instead of falling through to pass', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-memory-v1' });
    const categories = new Set(cases.map((item) => item.category));

    for (const category of categories) {
      const testCase = cases.find((item) => item.category === category);
      expect(testCase).toBeTruthy();
      const evaluation = evaluateDrkallaMemoryAbCase(testCase!);
      expect(evaluation.checked).toBe(true);
      expect(evaluation.reason).not.toBe('fallthrough_pass');
    }
  });

  it('keeps product-comparison follow-ups in the current product flow instead of offering a random category', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-memory-v1' });
    const comparisonCase = cases.find((item) =>
      item.category === 'interruption_correction'
      && item.userText.includes('Unterschied zwischen Serum und Leave-in')
    );

    expect(comparisonCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(comparisonCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('use_latest_context_for_product_comparison_correction_and_funnel');
  });

  it('blocks repeated category/contact offers once the caller is already in a concrete product funnel', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-product-funnel-v1' });
    const funnelCase = cases.find((item) =>
      item.category === 'interruption_correction'
      && item.userText.includes('Synthesis Color Cream')
      && item.userText.includes('100 ml')
    );

    expect(funnelCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(funnelCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('use_latest_context_for_product_comparison_correction_and_funnel');
  });

  it('uses product-funnel memory state for comparison, link, brand, price, and inaudible follow-ups', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-product-funnel-state-v1' });
    const funnelCases = cases.filter((item) => item.category === 'product_funnel_state');

    expect(funnelCases).toHaveLength(DRKALLA_MEMORY_AB_CATEGORY_TARGETS.product_funnel_state);
    expect(funnelCases.some((item) => item.userText.includes('Unterschied'))).toBe(true);
    expect(funnelCases.some((item) => item.userText.includes('kaufe'))).toBe(true);
    expect(funnelCases.some((item) => item.userText.includes('Marken'))).toBe(true);
    expect(funnelCases.some((item) => item.userText.includes('kostet'))).toBe(true);
    expect(funnelCases.some((item) => item.userText.includes('inaudible'))).toBe(true);

    for (const testCase of funnelCases.slice(0, 10)) {
      const evaluation = evaluateDrkallaMemoryAbCase(testCase);
      expect(evaluation.aPasses).toBe(false);
      expect(evaluation.bPasses).toBe(true);
      expect(evaluation.reason).toBe('product_memory_selects_next_step_without_category_reset');
    }
  });

  it('remembers product facts already explained and only allows repeats on explicit repeat requests', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-product-facts-v1' });
    const repeatedFactCase = cases.find((item) =>
      item.category === 'contact_fact_dedupe'
      && item.userText.includes('die Farbe nochmal kaufen')
    );

    expect(repeatedFactCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(repeatedFactCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('do_not_repeat_already_spoken_contact_fact');
  });

  it('answers visit and address questions from contact facts instead of claiming no reliable shop address', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-visit-contact-v1' });
    const visitCase = cases.find((item) =>
      item.category === 'route_hours_contact'
      && item.userText.includes('vorbeischauen')
    );

    expect(visitCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(visitCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('answer_route_or_hours_from_kb_without_shop-search_voice');
  });

  it('handles shop-link requests without reading long direct URLs or multiple product links aloud', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-shop-link-v1' });
    const linkCase = cases.find((item) =>
      item.category === 'sms_link_dedupe'
      && item.userText.includes('Link der Seite')
    );

    expect(linkCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(linkCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('send_link_once_only_after_explicit_request');
  });

  it('keeps Profi-price questions on the Profi-login path instead of switching to developer prices', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-profi-login-v1' });
    const profiCase = cases.find((item) =>
      item.category === 'asr_aliases'
      && item.userText.includes('Profi Login')
    );

    expect(profiCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(profiCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('resolve_common_german_asr_alias');
  });

  it('keeps plural German product-type requests in the active product-type funnel', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-product-type-plural-v1' });
    const productTypeCase = cases.find((item) =>
      item.category === 'asr_aliases'
      && item.userText.includes('Haarfarben')
    );

    expect(productTypeCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(productTypeCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('resolve_common_german_asr_alias');
  });

  it.each([
    ['Blondierung'],
    ['Farbentferner'],
    ['Haarglättung'],
    ['Haarspray'],
    ['Salonwagen'],
    ['Friseurwagen'],
    ['Rollwagen'],
    ['Arbeitswagen'],
  ])('keeps "%s" catalogue requests in the active product-type funnel', (term) => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-catalogue-product-types-v1' });
    const productTypeCase = cases.find((item) =>
      item.category === 'asr_aliases'
      && item.userText.includes(term)
    );

    expect(productTypeCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(productTypeCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('resolve_common_german_asr_alias');
  });

  it.each([
    ['Shampoos'],
    ['Haarmasken'],
    ['Conditioner'],
    ['Leave-in'],
    ['Haarserum'],
  ])('keeps "%s" haircare catalogue requests in the active product-type funnel', (term) => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-specific-haircare-types-v1' });
    const productTypeCase = cases.find((item) =>
      item.category === 'asr_aliases'
      && item.userText.includes(term)
    );

    expect(productTypeCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(productTypeCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('resolve_common_german_asr_alias');
  });

  it.each([
    ['Kämme'],
    ['Bürsten'],
    ['Scheren'],
    ['Färbeschalen'],
    ['Färbepinsel'],
    ['Alufolie'],
    ['Strähnenfolie'],
    ['Glätteisen'],
    ['Föhn'],
    ['Haartrockner'],
    ['Shaver'],
    ['Rasierer'],
    ['Barttrimmer'],
    ['Haarschneidemaschinen'],
    ['Schneidemaschinen'],
  ])('keeps "%s" plural tool requests in the active product-type funnel', (term) => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-plural-tool-types-v1' });
    const productTypeCase = cases.find((item) =>
      item.category === 'asr_aliases'
      && item.userText.includes(term)
    );

    expect(productTypeCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(productTypeCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('resolve_common_german_asr_alias');
  });

  it.each([
    ['Wascheinheiten'],
    ['Waschbecken'],
    ['Waschplatz'],
    ['Rückwärtswaschbecken'],
    ['Friseurstühle'],
    ['Ablagen'],
    ['Stehmatten'],
  ])('keeps "%s" plural salon-equipment requests in the active product-type funnel', (term) => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-plural-salon-equipment-v1' });
    const productTypeCase = cases.find((item) =>
      item.category === 'asr_aliases'
      && item.userText.includes(term)
    );

    expect(productTypeCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(productTypeCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('resolve_common_german_asr_alias');
  });

  it.each([
    ['Dauerwellenlösung'],
    ['Dauerwelle'],
    ['Dauerwellenmittel'],
  ])('keeps "%s" Dauerwelle styling requests in the active product-type funnel', (term) => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-dauerwelle-styling-v1' });
    const productTypeCase = cases.find((item) =>
      item.category === 'asr_aliases'
      && item.userText.includes(term)
    );

    expect(productTypeCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(productTypeCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('resolve_common_german_asr_alias');
  });

  it.each([
    ['Farbkarten'],
    ['Farbkarte'],
    ['Koleston Farbkarte'],
  ])('keeps "%s" Farbkarte requests in the active product-type funnel', (term) => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-farbkarte-v1' });
    const productTypeCase = cases.find((item) =>
      item.category === 'asr_aliases'
      && item.userText.includes(term)
    );

    expect(productTypeCase).toBeTruthy();
    const evaluation = evaluateDrkallaMemoryAbCase(productTypeCase!);
    expect(evaluation.aPasses).toBe(false);
    expect(evaluation.bPasses).toBe(true);
    expect(evaluation.reason).toBe('resolve_common_german_asr_alias');
  });

  it('adds the Profi disclosure only for the first non-perfume price question', () => {
    const cases = buildDrkallaMemoryAbCases({ cases: 1000, seed: 'drkalla-price-profi-funnel-v1' });
    const priceCase = cases.find((item) =>
      item.category === 'price_profi_disclosure_funnel'
      && item.userText.includes('Synthesis Color Cream')
    );
    const perfumeCase = cases.find((item) =>
      item.category === 'price_profi_disclosure_funnel'
      && item.userText.includes('Lattafa')
    );

    expect(priceCase).toBeTruthy();
    expect(perfumeCase).toBeTruthy();
    const priceEvaluation = evaluateDrkallaMemoryAbCase(priceCase!);
    const perfumeEvaluation = evaluateDrkallaMemoryAbCase(perfumeCase!);
    expect(priceEvaluation.aPasses).toBe(false);
    expect(priceEvaluation.bPasses).toBe(true);
    expect(perfumeEvaluation.aPasses).toBe(true);
    expect(perfumeEvaluation.bPasses).toBe(true);
    expect(priceEvaluation.reason).toBe('first_non_perfume_price_gets_profi_disclosure_and_link_choice');
    expect(perfumeEvaluation.reason).toBe('first_non_perfume_price_gets_profi_disclosure_and_link_choice');
  });

  it('reports real memory latency values without clamping to the pass threshold', () => {
    const report = runDrkallaMemoryAbSimulation({
      cases: 1000,
      seed: 'drkalla-memory-v1',
      memoryTimingsMs: Array.from({ length: 1000 }, () => 25),
    });

    expect(report.memoryP95Ms).toBe(25);
    expect(report.bFailed).toBeGreaterThan(0);
    expect(report.latencyGatePassed).toBe(false);
  });

  it('sanitizes reports so no caller identifiers, call IDs, URLs, or secrets are exported', () => {
    const report = runDrkallaMemoryAbSimulation({ cases: 1000, seed: 'https://drkalla.com/products/x +4917612345678 secret' });
    const sanitized = sanitizeDrkallaMemoryAbReport(report);
    const text = JSON.stringify(sanitized);

    expect(text).not.toMatch(/\bcall_[a-z0-9]/i);
    expect(text).not.toMatch(/\+49|0176|0151|drkalla\.com\/products/i);
    expect(text).not.toMatch(/secret|token|authorization/i);
    expect(text).not.toContain(report.seed);
    expect(sanitized.seedHash).toMatch(/^[a-f0-9]{12}$/);
    expect(sanitized.caseSamples).toBeUndefined();
  });
});
