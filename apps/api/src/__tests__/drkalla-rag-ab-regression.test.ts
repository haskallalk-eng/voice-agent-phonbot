import { describe, expect, it } from 'vitest';
import {
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
    expect(DRKALLA_RAG_PROMPT).toContain('nutze das SMS-Link-Tool');
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
    expect(DRKALLA_RAG_PROMPT).toContain('Bei roten, kupfernen oder gefärbten Haaren nicht automatisch Anti-Gelb empfehlen');
    expect(DRKALLA_RAG_PROMPT).toContain('Farbschutz');
    expect(DRKALLA_RAG_PROMPT).toContain('Rot-/Kupferpflege');
  });

  it('A can hallucinate a Profi login from navigation text; B requires concrete KB evidence', () => {
    const legacyPrompt = 'Wenn nach Profi-Preisen gefragt wird, bestaetige den Profi-Zugang.';

    expect(legacyPrompt).not.toContain('bestaetige das nur, wenn die KB eine konkrete Profi-Seite');
    expect(DRKALLA_RAG_PROMPT).toContain('Wenn der Anrufer nach Profi-Login oder Profi-Preisen fragt');
    expect(DRKALLA_RAG_PROMPT).toContain('bestätige das nur, wenn die KB eine konkrete Profi-Seite');
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

  it('A repeats the same inaudible repair twice; B switches to a simpler second-miss rescue prompt', () => {
    const legacyTranscript = [
      'User: (inaudible speech)',
      'Agent: Ich habe dich gerade schlecht verstanden. Suchst du ein Produkt, eine Kategorie oder Hilfe zu einer Bestellung?',
      'User: (inaudible speech)',
      'Agent: Ich habe dich gerade schlecht verstanden. Suchst du ein Produkt, eine Kategorie oder Hilfe zu einer Bestellung?',
    ].join('\n');

    expect(legacyTranscript.match(/Suchst du ein Produkt/g)?.length).toBe(2);
    expect(DRKALLA_RAG_PROMPT).toContain('Wenn du den Anrufer zweimal hintereinander schlecht verstehst');
    expect(DRKALLA_RAG_PROMPT).toContain('Sag bitte nur ein Stichwort');
    expect(DRKALLA_RAG_PROMPT).toContain('Produkt, Kategorie, Bestellung oder Kontakt');
    expect(DRKALLA_RAG_PROMPT).toContain('Beim dritten Mal');
    expect(DRKALLA_RAG_PROMPT).toContain('Die Verbindung ist gerade schwer zu verstehen');
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
    expect(normalizeDrkallaLinkUrl('http://drkalla.com/products/test')).toBeNull();
    expect(normalizeDrkallaLinkUrl('https://evil.example/products/test')).toBeNull();
    expect(buildDrkallaLinkSmsBody({
      url: 'https://drkalla.com/products/test',
      label: 'Lattafa Fakhar',
      linkKind: 'product',
    })).toContain('Lattafa Fakhar - https://drkalla.com/products/test');
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
    expect(DRKALLA_RAG_PROMPT).toContain('Bei roten, kupfernen oder gefärbten Haaren nicht automatisch Anti-Gelb empfehlen');
    expect(DRKALLA_RAG_PROMPT).toContain('Widersprich dir nicht mit einem Einzelpreis');
    expect(DRKALLA_RAG_PROMPT).toContain('Bei Entwickler/Oxidant/Wasserstoffperoxid immer Prozentstärke und Größe klären');
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
    expect(DRKALLA_RAG_PROMPT).toContain('Vermeide Formulierungen wie "ich suche im Shop"');
    expect(DRKALLA_RAG_PROMPT).toContain('Bei Kontakt-, Adresse-, Öffnungszeiten- oder Besuchsfragen nutze die Kontakt-KB direkt');
    expect(DRKALLA_RAG_PROMPT).toContain('Wenn nur nach E-Mail gefragt wird, nenne direkt kontakt at drkalla punkt com');
    expect(DRKALLA_RAG_PROMPT).toContain('Kontaktfacts nur einmal pro Antwort nennen');
    expect(DRKALLA_RAG_PROMPT).toContain('Wenn du Adresse, Telefon oder E-Mail gerade genannt hast');
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

  it('multi-aspect: Profi prices and checkout questions require evidence, contact fallback, and no phone checkout', () => {
    const legacyPrompt = 'Bestaetige Profi-Preise, nenne den Link und nimm Bestellungen am Telefon auf.';

    expect(legacyPrompt).not.toContain('bestaetige das nur, wenn die KB eine konkrete Profi-Seite');
    expect(legacyPrompt).not.toContain('Nimm keine Bestellung oder Zahlung am Telefon auf');
    expect(DRKALLA_RAG_PROMPT).toContain('bestätige das nur, wenn die KB eine konkrete Profi-Seite');
    expect(DRKALLA_RAG_PROMPT).toContain('Wenn nicht, verweise auf Website/Kontakt');
    expect(DRKALLA_RAG_PROMPT).toContain('Nimm keine Bestellung oder Zahlung am Telefon auf');
  });
});
