import { describe, expect, it } from 'vitest';
import {
  buildDrkallaMemoryContext,
  createDrkallaShortTermMemory,
  getDrkallaProductConversationState,
  isDrkallaMemoryLiveEffective,
  isDrkallaMemorySafeForModel,
  isFactMentionAllowed,
  isLinkAlreadySent,
  isProductFactMentionAllowed,
  nextDrkallaProductFunnelAction,
  nextInaudibleRepair,
  reduceDrkallaShortTermMemory,
  shouldIncludeDrkallaProfiPriceDisclosure,
} from '../drkalla-short-term-memory.js';

describe('DrKalla short-term voice memory', () => {
  it('remembers already spoken contact facts without treating them as evidence', () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Unsere Adresse ist Silbersteinstrasse 83. Wir sind Montag bis Freitag da.',
      factsMentioned: [
        { key: 'contact.address', label: 'Adresse' },
        { key: 'contact.hours', label: 'Oeffnungszeiten' },
      ],
    });

    expect(isFactMentionAllowed(memory, 'contact.address', 'Wo seid ihr?')).toBe(false);
    expect(isFactMentionAllowed(memory, 'contact.address', 'Kannst du die Adresse nochmal wiederholen?')).toBe(true);

    const context = buildDrkallaMemoryContext(memory);
    expect(context).toContain('already_spoken=contact.address,contact.hours');
    expect(context).toContain('not_evidence=true');
    expect(context.length).toBeLessThanOrEqual(550);
  });

  it('uses human hearing-repair logic for inaudible speech and never makes it an end-call reason', () => {
    const once = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio',
      turnIndex: 1,
      text: '(inaudible speech)',
      audioState: 'inaudible',
    });
    const twice = reduceDrkallaShortTermMemory(once, {
      type: 'user_audio',
      turnIndex: 2,
      text: '(inaudible speech)',
      audioState: 'inaudible',
    });
    const third = reduceDrkallaShortTermMemory(twice, {
      type: 'user_audio',
      turnIndex: 3,
      text: '',
      audioState: 'inaudible',
    });

    expect(nextInaudibleRepair(once)).toContain('Wie bitte');
    expect(nextInaudibleRepair(twice)).toContain('Stichwort');
    expect(nextInaudibleRepair(third)).toContain('lauter');
    expect(once.endCallEligible).toBe(false);
    expect(twice.endCallEligible).toBe(false);
    expect(third.endCallEligible).toBe(false);
  });

  it('allows end-call only for clear farewell or real long silence', () => {
    const unclear = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio',
      turnIndex: 1,
      text: 'alles klar',
      audioState: 'heard',
    });
    const farewell = reduceDrkallaShortTermMemory(unclear, {
      type: 'user_audio',
      turnIndex: 2,
      text: 'danke, tschüss',
      audioState: 'heard',
    });
    const silence = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio',
      turnIndex: 1,
      text: '',
      audioState: 'silence',
      silenceMs: 40_000,
    });

    expect(unclear.endCallEligible).toBe(false);
    expect(farewell.endCallEligible).toBe(true);
    expect(farewell.endCallReason).toBe('caller_farewell');
    expect(silence.endCallEligible).toBe(true);
    expect(silence.endCallReason).toBe('long_silence');
  });

  it('recognizes common German goodbye variants and clears pending clarification after a heard answer', () => {
    const pending = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'pending_clarification',
      turnIndex: 1,
      kind: 'product_variant',
      prompt: 'Welche Groesse meinst du?',
      options: ['klein', 'gross'],
    });
    const answered = reduceDrkallaShortTermMemory(pending, {
      type: 'user_audio',
      turnIndex: 2,
      text: 'die grosse Variante bitte',
      audioState: 'heard',
    });
    const goodbyePhrases = ['ciao', 'bis dann', 'schönen Tag noch', 'das war es', 'nein danke, das war alles'];

    expect(answered.pendingClarification).toBeNull();
    for (const phrase of goodbyePhrases) {
      const afterGoodbye = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
        type: 'user_audio',
        turnIndex: 1,
        text: phrase,
        audioState: 'heard',
      });
      expect(afterGoodbye.endCallEligible).toBe(true);
      expect(afterGoodbye.endCallReason).toBe('caller_farewell');
    }
  });

  it('does not clear a pending product clarification on ack-only filler words', () => {
    const pending = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'pending_clarification',
      turnIndex: 1,
      kind: 'product_variant',
      prompt: 'Welche Prozentstärke meinst du?',
      options: ['drei Prozent', 'sechs Prozent', 'neun Prozent'],
    });
    const stillPending = reduceDrkallaShortTermMemory(pending, {
      type: 'user_audio',
      turnIndex: 2,
      text: 'ok',
      audioState: 'heard',
    });

    expect(stillPending.pendingClarification?.kind).toBe('product_variant');
    expect(stillPending.endCallEligible).toBe(false);
  });

  it('deduplicates SMS links and keeps raw PII/URLs out of model-facing memory', () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Ich schicke dir den Link per SMS an +4917612345678.',
      linksSent: [
        {
          url: 'https://drkalla.com/products/lattafa-fakhar',
          label: 'Lattafa Fakhar',
        },
      ],
    });

    expect(isLinkAlreadySent(memory, 'https://drkalla.com/products/lattafa-fakhar')).toBe(true);
    expect(isLinkAlreadySent(memory, 'https://drkalla.com/products/anderes-produkt')).toBe(false);
    expect(isDrkallaMemorySafeForModel(memory)).toBe(true);
    expect(JSON.stringify(memory)).not.toContain('https://drkalla.com/products/lattafa-fakhar');
    expect(buildDrkallaMemoryContext(memory)).not.toContain('+4917612345678');
  });

  it('does not leak dynamic fact keys into model-facing context', () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Das Produkt kostet laut Shop-Datenstand 10 Euro.',
      factsMentioned: [
        {
          key: 'product.https://drkalla.com/products/private?phone=+4917612345678.price',
          label: 'privater Produktpreis',
        },
      ],
    });
    const context = buildDrkallaMemoryContext(memory);
    const rawMemory = JSON.stringify(memory);

    expect(context).toContain('dynamic_product.');
    expect(context).not.toContain('https://');
    expect(context).not.toContain('+4917612345678');
    expect(rawMemory).toContain('dynamic_product.');
    expect(rawMemory).not.toContain('https://');
    expect(rawMemory).not.toContain('+4917612345678');
    expect(isDrkallaMemorySafeForModel(memory)).toBe(true);
  });

  it('remembers the first non-perfume price disclosure and excludes perfume prices', () => {
    const fresh = createDrkallaShortTermMemory();

    expect(shouldIncludeDrkallaProfiPriceDisclosure(fresh, 'Was kostet die Synthesis Color Cream Haarfarbe?')).toBe(true);
    expect(shouldIncludeDrkallaProfiPriceDisclosure(fresh, 'Was kostet Lattafa Fakhar Eau de Parfum?')).toBe(false);

    const afterDisclosure = reduceDrkallaShortTermMemory(fresh, {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Das ist der normale Kaeuferpreis. Profi-Friseurpreise kann ich telefonisch nicht nennen.',
      profiPriceDisclosureGiven: true,
    });

    expect(afterDisclosure.profiPriceDisclosureGiven).toBe(true);
    expect(shouldIncludeDrkallaProfiPriceDisclosure(afterDisclosure, 'Was kostet neun Prozent Entwickler?')).toBe(false);
    expect(buildDrkallaMemoryContext(afterDisclosure)).toContain('profi_price_disclosure_given=true');
    expect(isDrkallaMemorySafeForModel(afterDisclosure)).toBe(true);
  });

  it('tracks product facts as a per-product table and blocks accidental repeats', () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Synthesis Color Cream ist eine Haarfarbe mit 100 ml und kostet 9,99 Euro.',
      lastProduct: {
        spokenName: 'Synthesis Color Cream',
        productId: 'synthesis-color-cream',
        productKind: 'Haarfarbe/Farbcreme',
      },
      factsMentioned: [
        { key: 'product.synthesis-color-cream.description', label: 'Produktbeschreibung' },
        { key: 'product.synthesis-color-cream.size', label: 'Menge' },
        { key: 'product.synthesis-color-cream.price', label: 'Preis' },
        { key: 'product.synthesis-color-cream.location', label: 'Fundstelle' },
      ],
    });

    const productState = getDrkallaProductConversationState(memory, 'synthesis-color-cream');
    expect(productState).toMatchObject({
      spokenName: 'Synthesis Color Cream',
      productKind: 'Haarfarbe/Farbcreme',
      facts: {
        description: true,
        size: true,
        price: true,
        location: true,
      },
    });
    expect(isProductFactMentionAllowed(memory, 'synthesis-color-cream', 'price', 'Wie kaufe ich die Farbe?')).toBe(false);
    expect(isProductFactMentionAllowed(memory, 'synthesis-color-cream', 'price', 'Kannst du den Preis nochmal sagen?')).toBe(true);
    expect(isProductFactMentionAllowed(memory, 'synthesis-color-cream', 'description', 'Und was war da drin?')).toBe(false);
    expect(buildDrkallaMemoryContext(memory)).toContain('active_product=Synthesis Color Cream');
    expect(buildDrkallaMemoryContext(memory)).toContain('product_facts=description,size,price,location');
  });

  it('keeps product memory and model-facing context free of raw URL, phone, and email values', () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Produkt mit privaten Daten wurde erwähnt.',
      lastProduct: {
        spokenName: 'Private Farbe https://drkalla.com/products/private +4917612345678 test@example.com',
        productId: 'https://drkalla.com/products/private?phone=+4917612345678',
        productKind: 'Haarfarbe/Farbcreme',
      },
      factsMentioned: [
        {
          key: 'product.https://drkalla.com/products/private?phone=+4917612345678.price',
          label: 'Preis mit test@example.com und +4917612345678',
        },
      ],
    });

    const context = buildDrkallaMemoryContext(memory);
    const rawMemory = JSON.stringify(memory);
    expect(context).not.toMatch(/https?:\/\/|@|\+4917612345678/);
    expect(rawMemory).not.toMatch(/https?:\/\/|test@example\.com|\+4917612345678/);
    expect(isDrkallaMemorySafeForModel(memory)).toBe(true);
    expect(isDrkallaMemorySafeForModel(memory)).toBe(true);
  });

  it('keeps model-facing memory free of names, addresses, call IDs, and order IDs', () => {
    const pending = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'pending_clarification',
      turnIndex: 1,
      kind: 'name',
      prompt: 'Herr Max Mustermann, wie darf ich helfen? call_abcd123456',
      options: ['Bestellung ORD-123456 fuer Musterstrasse 12 Berlin'],
    });
    const memory = reduceDrkallaShortTermMemory(pending, {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Ich habe die Bestellung gesehen.',
      lastProduct: {
        spokenName: 'Bestellung ORD-123456 fuer Max Mustermann Musterstrasse 12',
        productId: 'order_abcdef123456',
        productKind: 'Haarfarbe/Farbcreme',
      },
      lastAgentQuestion: 'Max Mustermann, geht es um call_abcd123456?',
    });

    const rawMemory = JSON.stringify(memory);
    const context = buildDrkallaMemoryContext(memory);
    expect(rawMemory).not.toMatch(/Max Mustermann|Musterstrasse 12|ORD-123456|call_abcd123456|order_abcdef123456/i);
    expect(context).not.toMatch(/Max Mustermann|Musterstrasse 12|ORD-123456|call_abcd123456|order_abcdef123456/i);
    expect(isDrkallaMemorySafeForModel(memory)).toBe(true);
  });

  it('caps conversation memory so long calls stay bounded and fast', () => {
    let memory = createDrkallaShortTermMemory();
    for (let index = 0; index < 20; index += 1) {
      memory = reduceDrkallaShortTermMemory(memory, {
        type: 'agent_spoke',
        turnIndex: index + 1,
        text: `Produkt ${index} wurde genannt.`,
        lastProduct: {
          spokenName: `Produkt ${index}`,
          productId: `product-${index}`,
          productKind: index % 2 === 0 ? 'Haarfarbe/Farbcreme' : 'Pflege',
        },
        factsMentioned: [
          { key: `product.product-${index}.description`, label: 'Beschreibung' },
          { key: `product.product-${index}.price`, label: 'Preis' },
        ],
        linksSent: [{ url: `https://drkalla.com/products/product-${index}`, label: `Produkt ${index}` }],
      });
    }

    expect(Object.keys(memory.productConversations)).toHaveLength(6);
    expect(Object.keys(memory.heardFacts).length).toBeLessThanOrEqual(40);
    expect(Object.keys(memory.sentLinkHashes)).toHaveLength(12);
    expect(memory.recentProducts).toHaveLength(3);
    expect(buildDrkallaMemoryContext(memory).length).toBeLessThanOrEqual(550);
    expect(isDrkallaMemorySafeForModel(memory)).toBe(true);
  });

  it('keeps inaudible repair inside the active product funnel instead of resetting to generic categories', () => {
    const withProduct = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Wir sprechen gerade über Synthesis Color Cream.',
      lastProduct: {
        spokenName: 'Synthesis Color Cream',
        productId: 'synthesis-color-cream',
        productKind: 'Haarfarbe/Farbcreme',
      },
    });
    const once = reduceDrkallaShortTermMemory(withProduct, {
      type: 'user_audio',
      turnIndex: 2,
      text: '(inaudible speech)',
      audioState: 'inaudible',
    });
    const twice = reduceDrkallaShortTermMemory(once, {
      type: 'user_audio',
      turnIndex: 3,
      text: '(inaudible speech)',
      audioState: 'inaudible',
    });

    expect(nextInaudibleRepair(twice)).toContain('Synthesis Color Cream');
    expect(nextInaudibleRepair(twice)).not.toContain('Produkt, Kategorie, Bestellung oder Kontakt');
    expect(twice.endCallEligible).toBe(false);
  });

  it('chooses product-funnel next steps from active product and recent comparison context', () => {
    const first = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Das Haarserum pflegt die Spitzen.',
      lastProduct: { spokenName: 'Luxe-Öl Serum', productId: 'luxe-oel-serum', productKind: 'Serum' },
      factsMentioned: [{ key: 'product.luxe-oel-serum.description', label: 'Produktbeschreibung' }],
    });
    const second = reduceDrkallaShortTermMemory(first, {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Das Luxe-Öl Leave-in bleibt im Haar.',
      lastProduct: { spokenName: 'Luxe-Öl Leave-in', productId: 'luxe-oel-leave-in', productKind: 'Leave-in' },
      factsMentioned: [{ key: 'product.luxe-oel-leave-in.description', label: 'Produktbeschreibung' }],
    });

    expect(nextDrkallaProductFunnelAction(second, 'Was ist der Unterschied?')).toBe('compare_recent_products');
    expect(nextDrkallaProductFunnelAction(second, 'Wie kaufe ich das?')).toBe('offer_product_link');
    expect(nextDrkallaProductFunnelAction(second, 'Was habt ihr für Marken?')).toBe('list_active_product_type_selection');
    expect(nextDrkallaProductFunnelAction(second, 'Was kostet das?')).toBe('offer_product_or_profi_link');
  });

  it('does not trigger the Profi-price funnel for perfume when the spoken product name is generic', () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Der Duft kostet 22 Euro.',
      lastProduct: {
        spokenName: 'Fakhar',
        productId: 'lattafa-fakhar',
        productKind: 'Parfum',
      },
    });

    expect(nextDrkallaProductFunnelAction(memory, 'Was kostet das?')).toBe('offer_product_link');
  });

  it('marks memory as live-effective only for custom runtime, not Retell-managed prompts', () => {
    expect(isDrkallaMemoryLiveEffective({ mode: 'custom_runtime', memoryContextInjected: true })).toBe(true);
    expect(isDrkallaMemoryLiveEffective({ mode: 'custom_runtime', memoryContextInjected: false })).toBe(false);
    expect(isDrkallaMemoryLiveEffective({ mode: 'retell_managed', memoryContextInjected: true })).toBe(false);
  });
});
