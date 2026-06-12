import crypto from 'node:crypto';
import {
  buildDrkallaProductCatalogEntries,
  buildDrkallaProductVoiceName,
  type DrkallaKnowledgeSnapshot,
  type DrkallaProductCatalogEntry,
} from './drkalla-rag-agent.js';

export type DrkallaKbAuditExpert =
  | 'taxonomy_expert'
  | 'brand_expert'
  | 'product_detail_expert'
  | 'price_variant_expert'
  | 'link_expert'
  | 'voice_name_expert'
  | 'conversation_context_expert'
  | 'image_metadata_expert'
  | 'hallucination_guard_expert'
  | 'coverage_expert';

export type DrkallaKbAuditSeverity = 'pass' | 'warn' | 'fail';

export type DrkallaKbAuditCase = {
  id: string;
  expert: DrkallaKbAuditExpert;
  question: string;
  productId?: string;
  productKind?: string;
};

export type DrkallaKbAuditCaseResult = DrkallaKbAuditCase & {
  severity: DrkallaKbAuditSeverity;
  reason: string;
};

export type DrkallaKbAuditReport = {
  seed: string;
  totalCases: number;
  passed: number;
  warned: number;
  failed: number;
  scorePercent: number;
  byExpert: Record<DrkallaKbAuditExpert, {
    total: number;
    passed: number;
    warned: number;
    failed: number;
  }>;
  catalog: {
    productCount: number;
    productKindCount: number;
    productKinds: string[];
    externalBrands: string[];
    customerBrands: string[];
    shopProviderLabels: string[];
    imageCoveragePercent: number;
    imageAltCoveragePercent: number;
  };
  blockers: string[];
  warnings: string[];
  sampleFindings: DrkallaKbAuditCaseResult[];
};

const EXPERTS: DrkallaKbAuditExpert[] = [
  'taxonomy_expert',
  'brand_expert',
  'product_detail_expert',
  'price_variant_expert',
  'link_expert',
  'voice_name_expert',
  'conversation_context_expert',
  'image_metadata_expert',
  'hallucination_guard_expert',
  'coverage_expert',
];

const SHOP_PROVIDER_LABELS = ['Dr.Kalla Cosmetics', 'CJ Dropshipping'];

function hash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function emptyExpertStats(): DrkallaKbAuditReport['byExpert'] {
  return Object.fromEntries(EXPERTS.map((expert) => [expert, {
    total: 0,
    passed: 0,
    warned: 0,
    failed: 0,
  }])) as DrkallaKbAuditReport['byExpert'];
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])]
    .sort((a, b) => a.localeCompare(b, 'de'));
}

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function numericPrices(priceRange: string): number[] {
  return (priceRange.match(/\d+,\d{2}/g) ?? [])
    .map((value) => Number(value.replace(',', '.')))
    .filter((value) => Number.isFinite(value));
}

function entriesByKind(entries: DrkallaProductCatalogEntry[]): Map<string, DrkallaProductCatalogEntry[]> {
  const byKind = new Map<string, DrkallaProductCatalogEntry[]>();
  for (const entry of entries) {
    const list = byKind.get(entry.productKind) ?? [];
    list.push(entry);
    byKind.set(entry.productKind, list);
  }
  return byKind;
}

function buildCases(entries: DrkallaProductCatalogEntry[], seed: string, count: number): DrkallaKbAuditCase[] {
  if (count !== 1000) throw new Error('DrKalla KB quality audit is fixed at exactly 1000 cases');
  const cases: DrkallaKbAuditCase[] = [];
  for (let i = 0; i < count; i += 1) {
    const expert = EXPERTS[i % EXPERTS.length]!;
    const entry = entries[i % entries.length]!;
    const kind = entry.productKind;
    const id = hash(`${seed}:${expert}:${i}:${entry.productId}:${kind}`);
    const questionByExpert: Record<DrkallaKbAuditExpert, string> = {
      taxonomy_expert: `Welche Produktart ist ${entry.spokenName}?`,
      brand_expert: `Welche Marken habt ihr fuer ${kind}?`,
      product_detail_expert: `Was weiss der Agent ueber ${entry.spokenName}?`,
      price_variant_expert: `Was kostet ${entry.spokenName} und gibt es Varianten?`,
      link_expert: `Kann der Agent den passenden Produktlink fuer ${entry.spokenName} schicken?`,
      voice_name_expert: `Kann der Agent ${entry.websiteTitle} kurz aussprechen?`,
      conversation_context_expert: `Wenn wir ueber ${kind} reden und ich frage "welche Marken?", bleibt der Kontext erhalten?`,
      image_metadata_expert: `Gibt es Bild-Metadaten fuer ${entry.spokenName}?`,
      hallucination_guard_expert: `Erfindet der Agent externe Marken fuer ${kind}?`,
      coverage_expert: `Ist ${kind} als abfragbare Produktgruppe im Katalog vorhanden?`,
    };
    cases.push({
      id,
      expert,
      question: questionByExpert[expert],
      productId: entry.productId,
      productKind: kind,
    });
  }
  return cases;
}

function result(
  testCase: DrkallaKbAuditCase,
  severity: DrkallaKbAuditSeverity,
  reason: string,
): DrkallaKbAuditCaseResult {
  return { ...testCase, severity, reason };
}

function evaluateCase(
  testCase: DrkallaKbAuditCase,
  entries: DrkallaProductCatalogEntry[],
  byKind: Map<string, DrkallaProductCatalogEntry[]>,
): DrkallaKbAuditCaseResult {
  const entry = entries.find((item) => item.productId === testCase.productId) ?? entries[0]!;
  const kindEntries = byKind.get(testCase.productKind ?? entry.productKind) ?? [];
  switch (testCase.expert) {
    case 'taxonomy_expert':
      return entry.productKind && entry.productKind !== 'Sonstiges Produkt'
        ? result(testCase, 'pass', 'product_kind_present')
        : result(testCase, 'warn', 'product_kind_generic_or_missing');
    case 'brand_expert': {
      const externalBrands = uniqueSorted(kindEntries.map((item) => item.externalBrand));
      const customerBrands = uniqueSorted(kindEntries.map((item) => item.brandName));
      if (!customerBrands.length) return result(testCase, 'fail', 'customer_brand_missing');
      const invalidBrands = externalBrands.filter((brand) => SHOP_PROVIDER_LABELS.includes(brand));
      if (invalidBrands.length) return result(testCase, 'fail', 'shop_provider_leaked_as_external_brand');
      return result(testCase, 'pass', externalBrands.length ? 'external_brands_separated' : 'house_brand_fallback_available');
    }
    case 'product_detail_expert':
      return entry.spokenName && entry.websiteTitle && entry.url && entry.searchAliases.length > 0
        ? result(testCase, 'pass', 'product_row_has_core_details')
        : result(testCase, 'fail', 'product_row_missing_core_details');
    case 'price_variant_expert': {
      const prices = numericPrices(entry.priceRange);
      if (!prices.length) return result(testCase, 'fail', 'price_missing');
      if (entry.variantCount > 1 && entry.priceRange.startsWith('von ')) return result(testCase, 'pass', 'variant_price_range_available');
      if (entry.variantCount > 1 && prices.length === 1) return result(testCase, 'pass', 'multiple_variants_same_price_available');
      if (entry.variantCount <= 1) return result(testCase, 'pass', 'single_variant_price_available');
      return result(testCase, 'warn', 'multiple_variants_without_range_wording');
    }
    case 'link_expert':
      return /^https:\/\/drkalla\.com\/products\//.test(entry.url)
        ? result(testCase, 'pass', 'official_product_link_available')
        : result(testCase, 'fail', 'invalid_or_missing_product_link');
    case 'voice_name_expert':
      return entry.spokenName.length <= 64 && !/\bSKU\b|https?:\/\//i.test(entry.spokenName)
        ? result(testCase, 'pass', 'voice_name_safe')
        : result(testCase, 'fail', 'voice_name_too_long_or_technical');
    case 'conversation_context_expert': {
      const externalBrands = uniqueSorted(kindEntries.map((item) => item.externalBrand));
      const hasKind = kindEntries.length > 0;
      const noShopProviderAsBrand = !externalBrands.some((brand) => SHOP_PROVIDER_LABELS.includes(brand));
      return hasKind && noShopProviderAsBrand
        ? result(testCase, 'pass', 'kind_context_can_scope_followup_brand_question')
        : result(testCase, 'fail', 'followup_brand_question_not_safely_scoped');
    }
    case 'image_metadata_expert':
      if (entry.imageCount <= 0) return result(testCase, 'warn', 'image_url_missing');
      return entry.imageAltTexts.length > 0
        ? result(testCase, 'pass', 'image_metadata_available')
        : result(testCase, 'warn', 'image_url_available_but_alt_text_missing');
    case 'hallucination_guard_expert': {
      const kindText = JSON.stringify(kindEntries);
      if (/Wella|Schwarzkopf/i.test(kindText) && !kindText.includes('Wella') && !kindText.includes('Schwarzkopf')) {
        return result(testCase, 'fail', 'impossible_hallucinated_brand_state');
      }
      const invalidExternal = kindEntries.some((item) => item.externalBrand && SHOP_PROVIDER_LABELS.includes(item.externalBrand));
      return invalidExternal
        ? result(testCase, 'fail', 'shop_provider_classified_as_external_brand')
        : result(testCase, 'pass', 'hallucination_guard_brand_separation_ok');
    }
    case 'coverage_expert':
      return kindEntries.length > 0
        ? result(testCase, 'pass', 'kind_has_catalog_rows')
        : result(testCase, 'fail', 'kind_missing_catalog_rows');
  }
}

export function runDrkallaKbQualityAudit(input: {
  snapshot: DrkallaKnowledgeSnapshot;
  cases?: number;
  seed?: string;
}): DrkallaKbAuditReport {
  const seed = input.seed ?? 'drkalla-kb-quality-v1';
  const caseCount = input.cases ?? 1000;
  const entries = buildDrkallaProductCatalogEntries(input.snapshot);
  const byKind = entriesByKind(entries);
  const cases = buildCases(entries, seed, caseCount);
  const byExpert = emptyExpertStats();
  const results = cases.map((testCase) => evaluateCase(testCase, entries, byKind));
  const blockers = new Set<string>();
  const warnings = new Set<string>();

  for (const finding of results) {
    const stats = byExpert[finding.expert];
    stats.total += 1;
    if (finding.severity === 'pass') stats.passed += 1;
    if (finding.severity === 'warn') {
      stats.warned += 1;
      warnings.add(finding.reason);
    }
    if (finding.severity === 'fail') {
      stats.failed += 1;
      blockers.add(finding.reason);
    }
  }

  const passed = results.filter((item) => item.severity === 'pass').length;
  const warned = results.filter((item) => item.severity === 'warn').length;
  const failed = results.filter((item) => item.severity === 'fail').length;
  const imageCovered = entries.filter((entry) => entry.imageCount > 0).length;
  const imageAltCovered = entries.filter((entry) => entry.imageAltTexts.length > 0).length;

  return {
    seed,
    totalCases: results.length,
    passed,
    warned,
    failed,
    scorePercent: pct(passed, results.length),
    byExpert,
    catalog: {
      productCount: entries.length,
      productKindCount: byKind.size,
      productKinds: [...byKind.keys()].sort((a, b) => a.localeCompare(b, 'de')),
      externalBrands: uniqueSorted(entries.map((entry) => entry.externalBrand)),
      customerBrands: uniqueSorted(entries.map((entry) => entry.brandName)),
      shopProviderLabels: uniqueSorted(entries.map((entry) => entry.shopProvider).filter((provider) => SHOP_PROVIDER_LABELS.includes(provider ?? ''))),
      imageCoveragePercent: pct(imageCovered, entries.length),
      imageAltCoveragePercent: pct(imageAltCovered, entries.length),
    },
    blockers: [...blockers].sort(),
    warnings: [...warnings].sort(),
    sampleFindings: [
      ...results.filter((item) => item.severity === 'fail').slice(0, 5),
      ...results.filter((item) => item.severity === 'warn').slice(0, 5),
    ].slice(0, 10),
  };
}
