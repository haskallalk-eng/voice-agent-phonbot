import { describe, expect, it } from 'vitest';
import {
  DRKALLA_PROFI_ACCESS_URL,
  DRKALLA_RAG_PROMPT,
  buildDrkallaKnowledgeTexts,
  buildDrkallaProductVoiceName,
  formatDrkallaProductFact,
  type DrkallaKnowledgeSnapshot,
  type DrkallaProduct,
} from '../drkalla-rag-agent.js';
import {
  DRKALLA_RAG_DENOISING_MODE,
  DRKALLA_RAG_END_CALL_DESCRIPTION,
  DRKALLA_RAG_INTERRUPTION_SENSITIVITY,
  DRKALLA_RAG_REMINDER_MAX_COUNT,
  DRKALLA_RAG_REMINDER_TRIGGER_MS,
  DRKALLA_RAG_RESPONSIVENESS,
  DRKALLA_RAG_VOICE_SPEED,
  chooseReusableDrkallaKnowledgeBase,
  drkallaRagTools,
} from '../scripts/sync-drkalla-rag-agent.js';
import { DRKALLA_LINK_TOOL_NAME, buildDrkallaLinkSmsBody, normalizeDrkallaLinkUrl } from '../drkalla-link-tool.js';
import type { RetellKnowledgeBase } from '../retell.js';

function productFixture(overrides: Partial<DrkallaProduct> = {}): DrkallaProduct {
  return {
    id: 1,
    title: 'Test Produkt',
    handle: 'test-produkt',
    url: 'https://drkalla.com/products/test-produkt',
    vendor: 'Dr.Kalla Cosmetics',
    productType: 'Haarpflege',
    tags: ['test'],
    description: 'Ein oeffentliches Shop-Produkt fuer Friseurbedarf.',
    variants: [
      {
        id: 'variant-1',
        title: 'Standard',
        price: '9.99',
        compareAtPrice: null,
        available: true,
        sku: 'SKU-1',
      },
    ],
    ...overrides,
  };
}

function snapshotFixture(product: DrkallaProduct): DrkallaKnowledgeSnapshot {
  return {
    scrapedAt: '2026-05-31T12:00:00.000Z',
    source: 'https://drkalla.com',
    productCount: 1,
    categories: ['Haarpflege', 'Salonbedarf'],
    vendors: ['Dr.Kalla Cosmetics'],
    pages: [
      {
        title: 'Kontakt',
        url: 'https://drkalla.com/pages/contact',
        text: 'Kontaktseite mit vielen Navigationstexten und Adresse im Fliesstext.',
      },
    ],
    products: [product],
  };
}

function legacyProductFact(product: DrkallaProduct): string {
  return [
    `Produkt: ${product.title}`,
    `URL: ${product.url}`,
    product.productType ? `Kategorie: ${product.productType}` : '',
    `Varianten: ${product.variants.map((variant) => variant.title).join(' | ')}`,
  ].filter(Boolean).join('\n');
}

function legacyGenderAliases(title: string): string[] {
  const aliases = ['Parfum', 'Duft'];
  if (/herr|men|for men/i.test(title)) aliases.push('Herrenduft');
  if (/damen|women|for women/i.test(title)) aliases.push('Damenduft');
  return aliases;
}

function legacyKnowledgeTitles(snapshot: DrkallaKnowledgeSnapshot): string[] {
  return [
    'DrKalla Overview legacy',
    ...snapshot.pages.map((page) => `DrKalla Page - ${page.title}`),
    'DrKalla Products legacy',
  ];
}

function retellKbFixture(overrides: Partial<RetellKnowledgeBase>): RetellKnowledgeBase {
  return {
    knowledge_base_id: 'knowledge_base_fixture',
    knowledge_base_name: 'DrKalla KB test-hash',
    status: 'complete',
    user_modified_timestamp: 1,
    ...overrides,
  };
}

describe('DrKalla transcript-driven A/B regressions', () => {
  it('A repeats a very long product title; B exposes a short spoken name', () => {
    const product = productFixture({
      title: 'Delrin-Kamm 4054: 3-in-1-Seitenscheidekamm, Profi-Kamm für Herren, Stylingkamm, Ölkamm, Kamm mit breiten Zinken, Friseurkamm',
      handle: 'delrin-kamm-4054-3-in-1-seitenscheidekamm',
      productType: 'Friseur-Tool',
    });

    const legacy = legacyProductFact(product);
    const fixed = formatDrkallaProductFact(product);

    expect(legacy).toContain('3-in-1-Seitenscheidekamm, Profi-Kamm für Herren');
    expect(legacy).not.toContain('Sprachname:');
    expect(fixed).toContain('Sprachname: Delrin 4054 Seitenscheidekamm');
    expect(buildDrkallaProductVoiceName(product).spokenName.length).toBeLessThanOrEqual(54);
  });

  it('A cannot match caller wording for 9 percent developer; B adds peroxide aliases', () => {
    const product = productFixture({
      title: 'Emulgiertes Wasserstoffperoxid',
      handle: 'emulgiertes-wasserstoffperoxid',
      productType: 'Entwickler & Vorbereitung',
      variants: [
        {
          id: '30vol',
          title: '30 Volume - 9%',
          price: '12.00',
          compareAtPrice: null,
          available: true,
          sku: null,
        },
      ],
    });

    const legacy = legacyProductFact(product);
    const fixed = formatDrkallaProductFact(product);

    expect(legacy).not.toContain('9 Prozent Entwickler');
    expect(fixed).toContain('9 Prozent Entwickler');
    expect(fixed).toContain('30 Vol Entwickler');
  });

  it('A misclassifies Damen as men because of substring matching; B does not', () => {
    const product = productFixture({
      title: 'Exclusif Rose – Eau de Parfum für Damen (100 ml / 3.4 oz)',
      handle: 'exclusif-rose-for-women-3-4-oz-edp-spray-beauty-personal-care',
      productType: 'Eau de Parfum',
    });

    const legacy = legacyGenderAliases(product.title);
    const fixed = buildDrkallaProductVoiceName(product);

    expect(legacy).toContain('Herrenduft');
    expect(legacy).toContain('Damenduft');
    expect(fixed.searchAliases).toContain('Damenduft');
    expect(fixed.searchAliases).not.toContain('Herrenduft');
  });

  it('A buries contact details in generic page chunks; B has a dedicated contact chunk', () => {
    const snapshot = snapshotFixture(productFixture());

    const legacyTitles = legacyKnowledgeTitles(snapshot);
    const fixedTexts = buildDrkallaKnowledgeTexts(snapshot);

    expect(legacyTitles.some((title) => title.includes('DrKalla Kontakt'))).toBe(false);
    expect(fixedTexts.some((entry) => entry.title.includes('DrKalla Kontakt'))).toBe(true);
    expect(fixedTexts.some((entry) => entry.text.includes('Silbersteinstraße 83, 12051 Berlin'))).toBe(true);
  });

  it('A reads or fakes long URLs; B sends links only through the real SMS tool', () => {
    const legacyPrompt = 'Nenne passende Produktlinks und Produktvarianten aus der Knowledge Base.';

    expect(legacyPrompt).not.toContain('Lies im Voice-Call keine langen URLs vor');
    expect(legacyPrompt).not.toContain('Wenn mehrere Produkte oder Varianten zum selben Sprachname passen');
    expect(DRKALLA_RAG_PROMPT).toContain('Lies im Voice-Call keine langen URLs vor');
    expect(DRKALLA_RAG_PROMPT).toContain('SMS-Link-Tool');
    expect(DRKALLA_RAG_PROMPT).toContain('behaupte Versand erst nach Tool-Erfolg');
    expect(DRKALLA_RAG_PROMPT).toContain('nenne maximal drkalla.com');
    expect(DRKALLA_RAG_PROMPT).toContain('Wenn mehrere Produkte/Varianten zum selben Sprachname passen');
  });

  it('A keeps shop artifacts in product names; B removes copied, pipe, and dangling-word artifacts', () => {
    const cases = [
      productFixture({ title: 'Kopie von Restrukturierendes Shampoo für trockenes und strapaziertes Haar – Keratin-Protein' }),
      productFixture({ title: 'Turquoise | Hydra Complex - Feuchtigkeitsspendendes Shampoo für feines Haar' }),
      productFixture({ title: 'NEXT BASIC Friseur-Salonwagen mit 4 Schubladen und Gummirollen', productType: 'Salonmöbel' }),
    ];

    const legacyNames = cases.map((product) => product.title);
    const fixedNames = cases.map((product) => buildDrkallaProductVoiceName(product).spokenName);

    expect(legacyNames.some((name) => /Kopie von|\|/.test(name))).toBe(true);
    expect(fixedNames).toEqual([
      'Restrukturierendes Shampoo',
      'Turquoise Hydra Complex Shampoo',
      'Next Basic Salonwagen',
    ]);
    expect(fixedNames.some((name) => /Kopie von|\||\b(?:und|mit|für|fuer)$/.test(name))).toBe(false);
  });

  it('A misses common Lattafa ASR variants; B adds caller-style perfume aliases', () => {
    const product = productFixture({
      title: 'Lattafa Fakhar - Eau de Parfum fuer Herren (100 ml)',
      handle: 'lattafa-fakhar-eau-de-parfum-fuer-herren-100ml',
      vendor: 'Lattafa',
      productType: 'Eau de Parfum',
      tags: ['Parfuem'],
    });

    const legacy = legacyProductFact(product);
    const fixed = buildDrkallaProductVoiceName(product);

    expect(legacy).not.toContain('Latasse');
    expect(fixed.searchAliases).toContain('Latasse');
    expect(fixed.searchAliases).toContain('Latafa');
    expect(fixed.searchAliases).toContain('Herrenduft');
  });

  it('A only exposes numeric 9 percent developer text; B adds spoken German number aliases', () => {
    const product = productFixture({
      title: 'Emulgiertes Wasserstoffperoxid',
      handle: 'emulgiertes-wasserstoffperoxid',
      productType: 'Entwickler & Vorbereitung',
      variants: [
        {
          id: '30vol',
          title: '30 Volume - 9%',
          price: '12.00',
          compareAtPrice: null,
          available: true,
          sku: null,
        },
      ],
    });

    const legacy = legacyProductFact(product);
    const fixed = formatDrkallaProductFact(product);

    expect(legacy).not.toContain('neun Prozent Entwickler');
    expect(fixed).toContain('neun Prozent Entwickler');
    expect(fixed).toContain('dreißig Vol Entwickler');
  });

  it('A can invent a single peroxide price; B exposes a range and requires variant clarification', () => {
    const product = productFixture({
      title: 'Emulgiertes Wasserstoffperoxid',
      handle: 'emulgiertes-wasserstoffperoxid',
      productType: 'Entwickler & Vorbereitung',
      variants: [
        {
          id: 'small',
          title: '30vol',
          price: '3.00',
          compareAtPrice: null,
          available: true,
          sku: null,
        },
        {
          id: 'large',
          title: '30vol 9%',
          price: '12.00',
          compareAtPrice: null,
          available: true,
          sku: null,
        },
      ],
    });

    const legacyPrompt = 'Wenn ein Produkt passt, nenne den Preis.';
    const fixed = formatDrkallaProductFact(product);

    expect(legacyPrompt).not.toContain('Widersprich dir nicht mit einem Einzelpreis');
    expect(fixed).toContain('Preisbereich: von 3,00 EUR bis 12,00 EUR');
    expect(DRKALLA_RAG_PROMPT).toContain('Widersprich dir nicht mit einem Einzelpreis');
  });

  it('A can push Anti-Gelb for red hair; B requires farbschutz or clarification for red and copper hair', () => {
    const legacyPrompt = 'Bei Haarfarbe nenne passende Pflegeprodukte wie Anti-Gelb.';

    expect(legacyPrompt).not.toContain('Bei roten, kupfernen oder gefaerbten Haaren nicht automatisch Anti-Gelb empfehlen');
    expect(DRKALLA_RAG_PROMPT).toContain('roten/kupfernen/gefärbten Haaren nicht automatisch Anti-Gelb empfehlen');
    expect(DRKALLA_RAG_PROMPT).toContain('Farbschutz');
    expect(DRKALLA_RAG_PROMPT).toContain('Rot-/Kupferpflege');
  });

  it('A can hallucinate Profi conditions; B knows the request path without inventing terms', () => {
    const legacyPrompt = 'Wenn nach Profi-Preisen gefragt wird, bestaetige den Profi-Zugang.';

    expect(legacyPrompt).not.toContain('Keine Konditionen erfinden');
    expect(DRKALLA_RAG_PROMPT).toContain('Profi-Login/Profi-Preise');
    expect(DRKALLA_RAG_PROMPT).toContain('Friseure können Profi-Preise anfragen');
    expect(DRKALLA_RAG_PROMPT).toContain('Gewerbe-/Steuernachweis');
    expect(DRKALLA_RAG_PROMPT).toContain('Keine Konditionen/Rabatte/Freischaltung erfinden');
  });

  it('A answers inaudible turns as if understood; B requires the exact repair prompt', () => {
    const legacyPrompt = 'Wenn der Anrufer undeutlich ist, antworte hilfreich und natuerlich.';

    expect(legacyPrompt).not.toContain('Ich habe dich gerade schlecht verstanden');
    expect(DRKALLA_RAG_PROMPT).toContain('"(inaudible speech)"');
    expect(DRKALLA_RAG_PROMPT).toContain('nur Geräusch');
    expect(DRKALLA_RAG_PROMPT).toContain('Wie bitte?');
    expect(DRKALLA_RAG_PROMPT).toContain('Ich habe dich gerade schlecht verstanden');
    expect(DRKALLA_RAG_PROMPT).toContain('Antworte nicht mit "natürlich"');
  });

  it('A repeats the same inaudible repair twice; B keeps second-miss repair inside the active topic', () => {
    const legacyTranscript = [
      'User: (inaudible speech)',
      'Agent: Ich habe dich gerade schlecht verstanden. Suchst du ein Produkt, eine Kategorie oder Hilfe zu einer Bestellung?',
      'User: (inaudible speech)',
      'Agent: Ich habe dich gerade schlecht verstanden. Suchst du ein Produkt, eine Kategorie oder Hilfe zu einer Bestellung?',
    ].join('\n');

    expect(legacyTranscript.match(/Suchst du ein Produkt/g)?.length).toBe(2);
    expect(DRKALLA_RAG_PROMPT).toContain('2x schlecht');
    expect(DRKALLA_RAG_PROMPT).toContain('bleibe im letzten klaren Thema');
    expect(DRKALLA_RAG_PROMPT).toContain('aktive Produktart, Marke oder Produkt');
    expect(DRKALLA_RAG_PROMPT).toContain('Nur ohne klaren Kontext');
    expect(DRKALLA_RAG_PROMPT).not.toContain('Produkt, Kategorie, Bestellung oder Kontakt');
    expect(DRKALLA_RAG_PROMPT).toContain('Beim dritten Mal');
    expect(DRKALLA_RAG_PROMPT).toContain('Die Verbindung ist gerade schwer zu verstehen');
  });

  it('A resets a product conversation after inaudible audio; B repairs generically without leaving the product funnel', () => {
    const latestFailingTranscript = [
      'User: Ich möchte Haarfarbe.',
      'Agent: Welche Nuance brauchst du?',
      'User: (inaudible speech)',
      'Agent: Sag bitte nur ein Stichwort: Produkt, Kategorie, Bestellung oder Kontakt.',
    ].join('\n');

    expect(latestFailingTranscript).toContain('Produkt, Kategorie, Bestellung oder Kontakt');
    expect(DRKALLA_RAG_PROMPT).toContain('aktives Produkt');
    expect(DRKALLA_RAG_PROMPT).toContain('keine Kategorie/Kontakt-Schleife');
    expect(DRKALLA_RAG_PROMPT).toContain('akustisch');
    expect(DRKALLA_RAG_PROMPT).toContain('Bleiben wir bei');
    expect(DRKALLA_RAG_PROMPT).not.toContain('Sag bitte nur ein Stichwort: Produkt, Kategorie, Bestellung oder Kontakt');
  });

  it('A disables no-input reminders; B allows two cautious reminders for noise or silence', () => {
    const legacyReminderMaxCount = 0;

    expect(legacyReminderMaxCount).toBe(0);
    expect(DRKALLA_RAG_REMINDER_TRIGGER_MS).toBe(6500);
    expect(DRKALLA_RAG_REMINDER_MAX_COUNT).toBe(2);
  });

  it('B applies the agreed Retell turntaking and low-volume denoising settings', () => {
    expect(DRKALLA_RAG_RESPONSIVENESS).toBe(0.87);
    expect(DRKALLA_RAG_INTERRUPTION_SENSITIVITY).toBe(0.77);
    expect(DRKALLA_RAG_DENOISING_MODE).toBe('no-denoise');
    expect(DRKALLA_RAG_VOICE_SPEED).toBe(1.03);
  });

  it('B reuses the newest complete DrKalla KB for the same snapshot instead of creating duplicates', () => {
    const reusable = chooseReusableDrkallaKnowledgeBase([
      retellKbFixture({
        knowledge_base_id: 'knowledge_base_old',
        knowledge_base_name: 'DrKalla KB test-hash',
        status: 'complete',
        user_modified_timestamp: 10,
      }),
      retellKbFixture({
        knowledge_base_id: 'knowledge_base_processing',
        knowledge_base_name: 'DrKalla KB test-hash',
        status: 'in_progress',
        user_modified_timestamp: 30,
      }),
      retellKbFixture({
        knowledge_base_id: 'knowledge_base_other_hash',
        knowledge_base_name: 'DrKalla KB other-hash',
        status: 'complete',
        user_modified_timestamp: 40,
      }),
      retellKbFixture({
        knowledge_base_id: 'knowledge_base_new',
        knowledge_base_name: 'DrKalla KB test-hash',
        status: 'complete',
        user_modified_timestamp: 20,
      }),
    ], 'DrKalla KB test-hash');

    expect(reusable?.knowledge_base_id).toBe('knowledge_base_new');
  });

  it('B keeps the DrKalla voice prompt lean while preserving behavior anchors', () => {
    expect(DRKALLA_RAG_PROMPT.length).toBeLessThanOrEqual(3850);
    expect(DRKALLA_RAG_PROMPT).toContain('Dr.Kalla ist kein Friseursalon');
    expect(DRKALLA_RAG_PROMPT).toContain('Sprachname');
    expect(DRKALLA_RAG_PROMPT).toContain('Akustische Reparatur');
    expect(DRKALLA_RAG_PROMPT).toContain('Profi-Login');
    expect(DRKALLA_RAG_PROMPT).toContain('Nimm keine Bestellung oder Zahlung am Telefon auf');
  });

  it('A does not really end on clear goodbye; B registers a narrow end_call tool', () => {
    const legacyTools: unknown[] = [];

    expect(legacyTools.some((tool) => (tool as { name?: string }).name === 'end_call')).toBe(false);
    expect(DRKALLA_RAG_END_CALL_DESCRIPTION).toContain('clear final caller intent');
    expect(DRKALLA_RAG_END_CALL_DESCRIPTION).toContain('tschüss');
    expect(DRKALLA_RAG_END_CALL_DESCRIPTION).not.toContain('confirms no further help');
    expect(DRKALLA_RAG_END_CALL_DESCRIPTION).toContain('Never call for alles klar');
    expect(DRKALLA_RAG_END_CALL_DESCRIPTION).toContain('sehr schoen');
    expect(DRKALLA_RAG_END_CALL_DESCRIPTION).toContain('hast du schon gesagt');
    expect(DRKALLA_RAG_END_CALL_DESCRIPTION).toContain('Never call after inaudible speech');
    expect(DRKALLA_RAG_END_CALL_DESCRIPTION).toContain('Never call while collecting product');
    expect(DRKALLA_RAG_END_CALL_DESCRIPTION.length).toBeLessThanOrEqual(540);
    expect(drkallaRagTools().some((tool) => tool.name === 'end_call')).toBe(true);
  });

  it('A only has hangup; B registers a real DrKalla SMS link tool with strict parameters', () => {
    const legacyTools: unknown[] = [{ type: 'end_call', name: 'end_call' }];
    const fixedTools = drkallaRagTools('https://example.test');
    const linkTool = fixedTools.find((tool) => tool.name === DRKALLA_LINK_TOOL_NAME);

    expect(legacyTools.some((tool) => (tool as { name?: string }).name === DRKALLA_LINK_TOOL_NAME)).toBe(false);
    expect(linkTool).toBeTruthy();
    expect(linkTool?.type).toBe('custom');
    expect(linkTool?.url).toContain('/retell/tools/drkalla.send_link?drkalla_sig=');
    expect(linkTool?.description).toContain('Never claim the link was sent unless the tool result says smsSent=true');
    expect(linkTool?.description).toContain('Only call after the caller explicitly asks for a link or SMS');
    expect(linkTool?.description).toContain('Never call for "nenn mir"');
    expect(linkTool?.parameters).toMatchObject({
      type: 'object',
      required: ['url', 'label'],
      additionalProperties: false,
    });
  });

  it('B accepts only official HTTPS DrKalla links and formats a short SMS body', () => {
    expect(normalizeDrkallaLinkUrl('https://drkalla.com/products/test-produkt?variant=1#details')).toBe(
      'https://drkalla.com/products/test-produkt?variant=1',
    );
    expect(normalizeDrkallaLinkUrl('https://www.drkalla.com/pages/contact')).toBe('https://www.drkalla.com/pages/contact');
    expect(normalizeDrkallaLinkUrl(DRKALLA_PROFI_ACCESS_URL)).toBe(DRKALLA_PROFI_ACCESS_URL);
    expect(normalizeDrkallaLinkUrl('http://drkalla.com/products/test')).toBeNull();
    expect(normalizeDrkallaLinkUrl('https://evil.example/products/test')).toBeNull();
    expect(buildDrkallaLinkSmsBody({
      url: 'https://drkalla.com/products/test',
      label: 'Lattafa Fakhar',
      linkKind: 'product',
    })).toContain('Lattafa Fakhar - https://drkalla.com/products/test');
    expect(buildDrkallaLinkSmsBody({
      url: DRKALLA_PROFI_ACCESS_URL,
      label: 'Profi-Zugang',
      linkKind: 'profi',
    })).toContain('Profi-Zugang von Dr.Kalla');
  });

  it('multi-aspect: Latasse Herrenduft order flow keeps ASR alias, gender, and voice-link rules together', () => {
    const product = productFixture({
      title: 'Lattafa Fakhar - Eau de Parfum fuer Herren (100 ml)',
      handle: 'lattafa-fakhar-eau-de-parfum-fuer-herren-100ml',
      vendor: 'Lattafa',
      productType: 'Eau de Parfum',
      tags: ['Parfuem'],
    });
    const legacyPrompt = 'Lies Produktlinks vor und leite den Kunden zum passenden Produkt.';
    const fixed = buildDrkallaProductVoiceName(product);

    expect(legacyProductFact(product)).not.toContain('Latasse');
    expect(legacyPrompt).not.toContain('Nimm keine Bestellung oder Zahlung am Telefon auf');
    expect(fixed.searchAliases).toEqual(expect.arrayContaining(['Latasse', 'Latafa', 'Herrenduft']));
    expect(fixed.searchAliases).not.toContain('Damenduft');
    expect(DRKALLA_RAG_PROMPT).toContain('Lies im Voice-Call keine langen URLs vor');
    expect(DRKALLA_RAG_PROMPT).toContain('Nimm keine Bestellung oder Zahlung am Telefon auf');
  });

  it('multi-aspect: red colored hair plus 9 percent developer avoids Anti-Gelb and single-price traps', () => {
    const product = productFixture({
      title: 'Emulgiertes Wasserstoffperoxid',
      handle: 'emulgiertes-wasserstoffperoxid',
      productType: 'Entwickler & Vorbereitung',
      variants: [
        {
          id: 'small',
          title: '30vol',
          price: '3.00',
          compareAtPrice: null,
          available: true,
          sku: null,
        },
        {
          id: 'large',
          title: '30vol 9%',
          price: '12.00',
          compareAtPrice: null,
          available: true,
          sku: null,
        },
      ],
    });
    const fixed = formatDrkallaProductFact(product);

    expect(fixed).toContain('neun Prozent Entwickler');
    expect(fixed).toContain('Preisbereich: von 3,00 EUR bis 12,00 EUR');
    expect(DRKALLA_RAG_PROMPT).toContain('roten/kupfernen/gefärbten Haaren nicht automatisch Anti-Gelb empfehlen');
    expect(DRKALLA_RAG_PROMPT).toContain('Widersprich dir nicht mit einem Einzelpreis');
    expect(DRKALLA_RAG_PROMPT).toContain('Entwickler/Oxidant/Wasserstoffperoxid: Prozentstärke und Größe klären');
  });

  it('multi-aspect: visit and address questions retrieve contact facts while preserving shop-not-salon boundaries', () => {
    const snapshot = snapshotFixture(productFixture());
    const fixedTexts = buildDrkallaKnowledgeTexts(snapshot);
    const joined = fixedTexts.map((entry) => `${entry.title}\n${entry.text}`).join('\n---\n');

    expect(joined).toContain('DrKalla Kontakt');
    expect(joined).toContain('Adresse: Silbersteinstraße 83, 12051 Berlin.');
    expect(joined).toContain('Öffnungszeiten: Montag bis Freitag von 10 bis 18 Uhr.');
    expect(joined).toContain('E-Mail gesprochen: kontakt at drkalla punkt com.');
    expect(joined).toContain('S+U Hermannstraße');
    expect(joined).toContain('von Hermannplatz');
    expect(joined).toContain('Dr.Kalla Cosmetics ist ein Friseurbedarf-Shop, kein Friseursalon.');
    expect(DRKALLA_RAG_PROMPT).toContain('keine Salontermine');
    expect(DRKALLA_RAG_PROMPT).toContain('Sprich als Dr.Kalla-Team');
    expect(DRKALLA_RAG_PROMPT).toContain('unser Shop');
    expect(DRKALLA_RAG_PROMPT).toContain('vermeide "ich suche im Shop"');
    expect(DRKALLA_RAG_PROMPT).toContain('Kontakt/Adresse/Öffnungszeiten/Besuch');
    expect(DRKALLA_RAG_PROMPT).toContain('Kontakt-KB direkt');
    expect(DRKALLA_RAG_PROMPT).toContain('E-Mail: kontakt at drkalla punkt com');
    expect(DRKALLA_RAG_PROMPT).toContain('Kontaktfacts nur einmal pro Antwort nennen');
    expect(DRKALLA_RAG_PROMPT).toContain('Adresse/Telefon/E-Mail nur bei Nachfrage');
  });

  it('B keeps German umlauts in spoken recommendation and contact facts', () => {
    const recommendation = formatDrkallaProductFact(productFixture({
      title: 'Feuchtigkeitsspendende Maske',
      productType: 'Haarpflege',
    }));
    const joined = buildDrkallaKnowledgeTexts(snapshotFixture(productFixture()))
      .map((entry) => `${entry.title}\n${entry.text}`)
      .join('\n---\n');

    expect(DRKALLA_RAG_PROMPT).toContain('gesprochen mit ä, ö, ü, ß');
    expect(recommendation).toContain('Feuchtigkeitsmaske für trockenes Haar');
    expect(recommendation).not.toContain('fuer trockenes Haar');
    expect(joined).toContain('Öffnungszeiten: Montag bis Freitag von 10 bis 18 Uhr.');
    expect(joined).toContain('Adresse: Silbersteinstraße 83, 12051 Berlin.');
    expect(joined).toContain('Berlin-Neukölln');
  });

  it('multi-aspect: Profi prices and checkout questions use request fallback and no phone checkout', () => {
    const legacyPrompt = 'Bestaetige Profi-Preise, nenne den Link und nimm Bestellungen am Telefon auf.';

    expect(legacyPrompt).not.toContain('Keine Konditionen erfinden');
    expect(legacyPrompt).not.toContain('Nimm keine Bestellung oder Zahlung am Telefon auf');
    expect(DRKALLA_RAG_PROMPT).toContain('Friseure können Profi-Preise anfragen');
    expect(DRKALLA_RAG_PROMPT).toContain('Gewerbe-/Steuernachweis');
    expect(DRKALLA_RAG_PROMPT).toContain('Profi-Frage => Profi-Link per SMS anbieten');
    expect(DRKALLA_RAG_PROMPT).toContain('Nimm keine Bestellung oder Zahlung am Telefon auf');
  });

  it('A offers category/contact after a concrete product; B advances to product-specific next steps only', () => {
    const legacyPrompt = 'Am Ende kurz fragen: Soll ich dir dazu noch eine Produktkategorie oder Kontaktmoeglichkeit nennen?';

    expect(legacyPrompt).toContain('Produktkategorie');
    expect(DRKALLA_RAG_PROMPT).toContain('aktives Produkt => keine Kategorie/Kontakt-Schleife');
    expect(DRKALLA_RAG_PROMPT).toContain('nächster Schritt Produktlink/Verfügbarkeit/Vergleich');
    expect(DRKALLA_RAG_PROMPT).toContain('Kein Shoplink, wenn Produkt-URL bekannt');
    expect(DRKALLA_RAG_PROMPT).toContain('Kategorie nur ohne Produkt/Ziel');
  });

  it('A answers product-type brand questions with another brand question; B lists the active product-type selection', () => {
    const latestFailingTranscript = [
      'User: Ich möchte Haarfarbe.',
      'User: Was habt ihr denn für Marken?',
      'Agent: Welche Marke suchst du konkret?',
    ].join('\n');

    expect(latestFailingTranscript).toContain('Welche Marke suchst du konkret');
    expect(DRKALLA_RAG_PROMPT).toContain('aktive Produktart => Marken/Auswahl');
    expect(DRKALLA_RAG_PROMPT).toContain('nicht nach einzelner Marke fragen');
    expect(DRKALLA_RAG_PROMPT).not.toContain('Welche Marke suchst du konkret');
  });

  it('A jumps from an active product type to sibling categories; B stays inside the active product type', () => {
    const latestFailingTranscript = [
      'User: Ich möchte Haarfarbe.',
      'Agent: Meinst du Shampoo, Conditioner oder Maske?',
    ].join('\n');

    expect(latestFailingTranscript).toContain('Shampoo, Conditioner oder Maske');
    expect(DRKALLA_RAG_PROMPT).toContain('aktive Produktart => Marken/Auswahl');
    expect(DRKALLA_RAG_PROMPT).toContain('keine Pflege-/Sibling-Kategorien');
  });

  it('A drills into one nuance during broad supplier selection; B treats supplier/range questions as assortment questions', () => {
    const latestFailingTranscript = [
      'User: Ich suche einen Lieferanten für Haarfarbe mit vielen Nuancen.',
      'Agent: Welche Nuance brauchst du?',
    ].join('\n');

    expect(latestFailingTranscript).toContain('Welche Nuance brauchst du');
    expect(DRKALLA_RAG_PROMPT).toContain('Sortiment/Lieferant/viele Varianten');
    expect(DRKALLA_RAG_PROMPT).toContain('nicht auf einzelne Variante bohren');
  });

  it('A loses the comparison target after serum/leave-in; B compares the last mentioned products', () => {
    const legacyAnswer = 'Soll ich dir eine Produktkategorie nennen?';

    expect(legacyAnswer).not.toContain('Serum');
    expect(legacyAnswer).not.toContain('Leave-in');
    expect(DRKALLA_RAG_PROMPT).toContain('Bei "Unterschied?" zuletzt genannte Produkte vergleichen');
    expect(DRKALLA_RAG_PROMPT).toContain('nicht auf Kategorie-Ebene springen');
    expect(DRKALLA_RAG_PROMPT).toContain('Serum vs. Leave-in');
  });

  it('B treats Profi access and visit facts as known shop facts without inventing exact discount terms', () => {
    const joined = buildDrkallaKnowledgeTexts(snapshotFixture(productFixture()))
      .map((entry) => `${entry.title}\n${entry.text}`)
      .join('\n---\n');

    expect(joined).toContain('Profi-Zugang');
    expect(joined).toContain(DRKALLA_PROFI_ACCESS_URL);
    expect(joined).toContain('Profi-Preise');
    expect(joined).toContain('Gewerbe- oder Steuernachweis');
    expect(DRKALLA_RAG_PROMPT).toContain('Profi-Zugang existiert');
    expect(DRKALLA_RAG_PROMPT).toContain('Keine Konditionen/Rabatte/Freischaltung erfinden');
  });

  it('A sends contact link for Profi access; B offers the direct Profi access link and does not mix it with contact', () => {
    const legacyPrompt = 'Bei Profi-Zugang schicke die Kontaktseite.';
    const tools = drkallaRagTools('https://example.test');
    const linkTool = tools.find((tool) => tool.name === DRKALLA_LINK_TOOL_NAME);

    expect(legacyPrompt).toContain('Kontaktseite');
    expect(DRKALLA_RAG_PROMPT).toContain('Profi-Frage => Profi-Link per SMS anbieten');
    expect(DRKALLA_RAG_PROMPT).not.toContain(DRKALLA_PROFI_ACCESS_URL);
    expect(DRKALLA_RAG_PROMPT).toContain('Kontaktlink nur bei Kontaktfragen');
    expect(String(linkTool?.description)).toContain('Profi linkKind=profi');
    expect(String(linkTool?.description)).toContain(DRKALLA_PROFI_ACCESS_URL);
    expect(linkTool?.parameters).toMatchObject({
      properties: {
        linkKind: {
          enum: ['shop', 'product', 'category', 'contact', 'profi'],
        },
      },
    });
  });

  it('A reads the Profi registration URL aloud; B keeps the URL out of the voice prompt and sends it only by tool', () => {
    const latestFailingTranscript = [
      'Agent: Du kannst dich unter drkalla.com/pages/als-friseur-registrieren als Friseur registrieren.',
      'User: Lies mir nicht den Link vor, schick ihn lieber per SMS.',
    ].join('\n');
    const tools = drkallaRagTools('https://example.test');
    const linkTool = tools.find((tool) => tool.name === DRKALLA_LINK_TOOL_NAME);

    expect(latestFailingTranscript).toContain('drkalla.com/pages/als-friseur-registrieren');
    expect(DRKALLA_RAG_PROMPT).toContain('Lies im Voice-Call keine langen URLs vor');
    expect(DRKALLA_RAG_PROMPT).toContain('Profi-Link per SMS anbieten');
    expect(DRKALLA_RAG_PROMPT).toContain('nie URL vorlesen');
    expect(DRKALLA_RAG_PROMPT).toContain('wenn gesendet, sagen');
    expect(DRKALLA_RAG_PROMPT).not.toContain('drkalla.com/pages/als-friseur-registrieren');
    expect(String(linkTool?.description)).toContain(DRKALLA_PROFI_ACCESS_URL);
    expect(String(linkTool?.description)).toContain('Never read URLs aloud');
  });

  it('A contradicts active L Oreal price evidence; B keeps price evidence stable across turns', () => {
    const latestFailingTranscript = [
      'Agent: Ich sehe mehrere L Oreal Haarfarben, aber keine konkrete L Oreal Haarfarbe mit Preis.',
      'User: Doch, was kostet die Inoa 6.8?',
      'Agent: Doch: Die L Oreal Inoa 6.8 kostet 13,00 Euro.',
    ].join('\n');

    expect(latestFailingTranscript).toContain('keine konkrete L Oreal Haarfarbe mit Preis');
    expect(latestFailingTranscript).toContain('Doch:');
    expect(DRKALLA_RAG_PROMPT).toContain('Preis-Evidence halten');
    expect(DRKALLA_RAG_PROMPT).toContain('nicht erst "fehlt", dann "doch"');
  });

  it('A gives a non-perfume product price without Profi disclosure; B uses the first-price Profi funnel', () => {
    const legacyAnswer = 'Die Synthesis Color Cream kostet 9,99 Euro. Soll ich dir eine Produktkategorie nennen?';

    expect(legacyAnswer).not.toContain('normale Kaeufer');
    expect(legacyAnswer).not.toContain('Profi-Friseurpreise');
    expect(DRKALLA_RAG_PROMPT).toContain('Preisfrage ausser Parfum');
    expect(DRKALLA_RAG_PROMPT).toContain('normale Kaeufer');
    expect(DRKALLA_RAG_PROMPT).toContain('Profi-Friseurpreise telefonisch nicht');
    expect(DRKALLA_RAG_PROMPT).toContain('Profi-Zugang registrieren');
    expect(DRKALLA_RAG_PROMPT).toContain('Produktlink oder Profi-Zugang per SMS');
    expect(DRKALLA_RAG_PROMPT).toContain('Danach Profi-Hinweis nicht wiederholen');
  });

  it('A answers opening-hours questions by saying where they are; B answers the hours directly', () => {
    const legacyAnswer = 'Unsere Öffnungszeiten stehen auf der Kontaktseite.';

    expect(legacyAnswer).toContain('stehen auf der Kontaktseite');
    expect(DRKALLA_RAG_PROMPT).toContain('Öffnungszeiten direkt nennen');
    expect(DRKALLA_RAG_PROMPT).toContain('Montag bis Freitag 10 bis 18 Uhr');
    expect(DRKALLA_RAG_PROMPT).not.toContain('stehen auf der Kontaktseite');
  });

  it('A routes package-shop callers into product categories; B separates Paketshop from Cosmetics flow', () => {
    const legacyAnswer = 'Dr.Kalla ist kein Paketshop. Welche Kategorie oder welches Produkt zuerst?';

    expect(legacyAnswer).toContain('kein Paketshop');
    expect(legacyAnswer).toContain('Kategorie');
    expect(DRKALLA_RAG_PROMPT).toContain('Paketshop oder Dr.Kalla Cosmetics');
    expect(DRKALLA_RAG_PROMPT).toContain('Paketshop: Öffnungszeiten nennen');
    expect(DRKALLA_RAG_PROMPT).toContain('keine Produktkategorie');
  });

  it('B speaks the brand and website naturally instead of saying malformed DrKalla variants', () => {
    expect(DRKALLA_RAG_PROMPT).toContain('Doktor Color Punkt com');
    expect(DRKALLA_RAG_PROMPT).toContain('d r k a l l a Punkt com');
    expect(DRKALLA_RAG_PROMPT).toContain('nie Drückalla');
  });

  it('A invents hair-color brands or treats shop labels as brands; B uses the structured product catalog', () => {
    const legacyAnswer = 'Wir haben L Oreal, Wella und Schwarzkopf. Welche Marke suchst du konkret?';
    const loreal = productFixture({
      id: 2,
      title: "L'Oréal Inoa Haarfärbemittel 6.8 Ammoniakfrei 60g",
      handle: 'dye-no-ammonia-loreal-professionnel-paris-inoa-n-68-60-g',
      vendor: "L'Oreal Professionnel Paris",
      productType: 'Haarfärbemittel',
    });
    const ownColor = productFixture({
      id: 3,
      title: 'Sintesis Color Cream 7.43 Kupferblond 100 ml',
      handle: 'sintesis-color-cream-743-kupferblond',
      vendor: 'Dr.Kalla Cosmetics',
      productType: 'Color Cream',
    });
    const fixedTexts = buildDrkallaKnowledgeTexts({
      ...snapshotFixture(loreal),
      productCount: 2,
      vendors: ["L'Oreal Professionnel Paris", 'Dr.Kalla Cosmetics'],
      products: [loreal, ownColor],
    });
    const catalogIndex = fixedTexts.find((entry) => entry.title.includes('Strukturierter Produktkatalog'))?.text ?? '';

    expect(legacyAnswer).toContain('Wella');
    expect(legacyAnswer).toContain('Schwarzkopf');
    expect(catalogIndex).toContain('Produktart: Haarfarbe/Farbcreme');
    expect(catalogIndex).toContain('Shop: Dr.Kalla Cosmetics / drkalla.com');
    expect(catalogIndex).toContain("Marken: Dr.Kalla Cosmetics, L'Oreal Professionnel Paris");
    expect(catalogIndex).toContain("Externe Marken: L'Oreal Professionnel Paris");
    expect(catalogIndex).toContain('Dr.Kalla Cosmetics ist Shop und Hausmarke');
    expect(catalogIndex).toContain('Bei "Welche Marken habt ihr?" im Kontext einer Produktart die Marken dieser Produktart nennen');
    expect(catalogIndex).not.toContain('Wella');
    expect(catalogIndex).not.toContain('Schwarzkopf');
  });

  it('A misses Lorian/Loyal as L Oreal; B indexes those ASR variants for the real product', () => {
    const legacyAliases = ['Haarfarbe', 'Farbcreme'];
    const fixed = buildDrkallaProductVoiceName(productFixture({
      title: "L'Oréal Inoa Haarfärbemittel 6.8 Ammoniakfrei 60g",
      handle: 'dye-no-ammonia-loreal-professionnel-paris-inoa-n-68-60-g',
      vendor: "L'Oreal Professionnel Paris",
      productType: 'Haarfärbemittel',
    }));

    expect(legacyAliases).not.toContain('Lorian');
    expect(legacyAliases).not.toContain('Loyal');
    expect(fixed.searchAliases).toContain('Lorian');
    expect(fixed.searchAliases).toContain('Loyal');
    expect(fixed.searchAliases).toContain("L'Oréal Haarfarbe");
  });
});
