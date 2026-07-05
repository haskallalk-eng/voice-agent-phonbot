/**
 * Availability FUNNEL (owner review 2026-07-05): a yes/no question about a
 * product CATEGORY ("Habt ihr Parfüm?") must be answered like a human clerk —
 * "Ja" + a short range + ONE counter-question — never an immediate single-
 * product pitch with price and SMS offer. Runs against the REAL baked catalog
 * so the battery covers many genuinely different categories; W-questions,
 * brand, contact and FAQ turns must keep their own paths.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDrkallaCustomLlmResponse } from '../drkalla-custom-llm-responder.js';
import {
  buildDrkallaProductCatalogSearch,
  buildDrkallaExternalBrandStock,
  type DrkallaCatalogSearchRawProduct,
} from '../drkalla-product-catalog-search.js';
import { buildDrkallaFaqMatcher, type DrkallaFaqRawEntry } from '../drkalla-faq-match.js';
import { createDrkallaShortTermMemory } from '../drkalla-short-term-memory.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { AgentTurnRequestedEvent } from '../voice-runtime-contract.js';

const dataDir = path.resolve(process.cwd(), 'data', 'drkalla-rag');
const products = (JSON.parse(readFileSync(path.join(dataDir, 'drkalla-products.json'), 'utf8')) as {
  products: DrkallaCatalogSearchRawProduct[];
}).products;
const catalogSearch = buildDrkallaProductCatalogSearch(products);
const brandStock = buildDrkallaExternalBrandStock(products);
const faqMatch = buildDrkallaFaqMatcher(
  (JSON.parse(readFileSync(path.join(dataDir, 'drkalla-faq.json'), 'utf8')) as { entries: DrkallaFaqRawEntry[] }).entries,
);

const trustedScope = createTrustedScope({
  orgId: 'org-1',
  tenantId: 'tenant-1',
  agentId: 'agent-drkalla',
  callId: 'call-funnel',
  source: 'server',
  resolvedFrom: 'call_registry',
});
const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 1100 };

function turn(currentUserText: string, sequence = 2): AgentTurnRequestedEvent {
  return {
    type: 'AgentTurnRequested',
    eventId: 'event-1',
    traceId: 'trace-1',
    trustedScope,
    provider: 'retell',
    channel: 'voice',
    providerEventId: 'retell-event-1',
    providerCallId: 'call-funnel',
    turnId: 'turn-1',
    responseId: 'response-1',
    occurredAt: '2026-07-05T10:00:00.000Z',
    receivedAt: '2026-07-05T10:00:00.100Z',
    currentUserText,
    sequence,
  };
}

async function respond(text: string) {
  return buildDrkallaCustomLlmResponse({
    canary: CANARY,
    event: turn(text),
    memory: createDrkallaShortTermMemory(),
    client: { complete: async () => 'MODELLPFAD' },
    catalogSearch,
    brandStock,
    faqMatch,
  });
}

describe('availability funnel across many real categories', () => {
  const CATEGORY_QUESTIONS = [
    'Habt ihr auch Parfüm im Sortiment?',
    'Haben Sie Scheren?',
    'Führt ihr Glätteisen?',
    'Verkauft ihr auch Kämme?',
    'Gibt es bei euch Lockenstäbe?',
    'Habt ihr Haarmasken?',
    'Haben Sie Haarspray?',
    'Habt ihr Blondierung?',
  ];

  for (const q of CATEGORY_QUESTIONS) {
    it(`"${q}" -> Ja + Beispiele + Rückfrage, kein Preis-Pitch, kein SMS-Angebot`, async () => {
      const res = await respond(q);
      expect(res.text, q).toMatch(/^Ja, das haben wir/);
      expect(res.text, q).toMatch(/\?$/); // ends on the counter-question
      expect(res.text, q).not.toContain('per SMS');
      // Multi-example funnels stay price-free; a single-hit category may name its price.
      if (res.text.includes('Zum Beispiel')) expect(res.text, q).not.toContain('kostet');
    });
  }

  it('the funnel names REAL catalog products (grounded, never invented)', async () => {
    const res = await respond('Habt ihr auch Parfüm im Sortiment?');
    const listPart = res.text.replace(/^Ja, das haben wir! Zum Beispiel /, '').replace(/\. Suchen Sie.*$/, '');
    const names = listPart.split(/, | und /).filter(Boolean);
    expect(names.length).toBeGreaterThanOrEqual(2);
    const catalogNames = new Set(catalogSearch('Parfüm', 8).map((h) => h.shortName));
    for (const n of names) expect(catalogNames.has(n), `${n} not in catalog`).toBe(true);
  });

  it('a repeated availability question falls through instead of repeating the identical funnel', async () => {
    const first = await respond('Habt ihr Haarmasken?');
    const second = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Habt ihr Haarmasken?', 4),
      memory: first.memory,
      client: { complete: async () => 'MODELLPFAD' },
      catalogSearch,
      brandStock,
      faqMatch,
    });
    expect(second.text).not.toBe(first.text);
  });
});

describe('funnel does NOT hijack other paths', () => {
  it('W-question ("Was habt ihr an Shampoos?") keeps the list/consult path', async () => {
    const res = await respond('Was habt ihr an Shampoos?');
    expect(res.text).not.toMatch(/^Ja, das haben wir/);
  });

  it('brand availability ("Habt ihr Wella?") keeps the honest brand path', async () => {
    const res = await respond('Habt ihr auch Wella?');
    expect(res.text).toMatch(/Wella/);
    expect(res.text).not.toMatch(/^Ja, das haben wir!/);
  });

  it('contact ("Habt ihr geöffnet?") keeps the hours answer', async () => {
    const res = await respond('Habt ihr heute geöffnet?');
    expect(res.text).not.toMatch(/^Ja, das haben wir/);
    expect(res.text).toMatch(/Montag|geöffnet|Uhr/);
  });

  it('policy ("Habt ihr einen Mindestbestellwert?") keeps the FAQ answer', async () => {
    const res = await respond('Habt ihr einen Mindestbestellwert?');
    expect(res.text).toContain('Mindestbestellwert');
    expect(res.text).not.toMatch(/^Ja, das haben wir/);
  });

  it('an unstocked category gets no fake Ja', async () => {
    const res = await respond('Habt ihr auch Rasenmäher?');
    expect(res.text).not.toMatch(/^Ja, das haben wir/);
  });
});
