import { describe, expect, it } from 'vitest';
import {
  buildDrkallaCustomLlmResponse,
  type DrkallaCustomLlmClient,
} from '../drkalla-custom-llm-responder.js';
import {
  createDrkallaShortTermMemory,
  reduceDrkallaShortTermMemory,
} from '../drkalla-short-term-memory.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { AgentTurnRequestedEvent } from '../voice-runtime-contract.js';

const trustedScope = createTrustedScope({
  orgId: 'org-1',
  tenantId: 'tenant-1',
  agentId: 'agent-drkalla',
  callId: 'call-1',
  source: 'server',
  resolvedFrom: 'call_registry',
});

function turn(currentUserText: string): AgentTurnRequestedEvent {
  return {
    type: 'AgentTurnRequested',
    eventId: 'event-1',
    traceId: 'trace-1',
    trustedScope,
    provider: 'retell',
    channel: 'voice',
    providerEventId: 'retell-event-1',
    providerCallId: 'call-1',
    turnId: 'turn-1',
    responseId: 'response-1',
    occurredAt: '2026-06-12T10:00:00.000Z',
    receivedAt: '2026-06-12T10:00:00.100Z',
    currentUserText,
  };
}

function productMemory() {
  return reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
    type: 'agent_spoke',
    turnIndex: 1,
    text: 'Synthesis Color Cream ist eine Haarfarbe mit 100 ml und Preis.',
    lastProduct: {
      spokenName: 'Synthesis Color Cream',
      productId: 'synthesis-color-cream',
      productKind: 'Haarfarbe/Farbcreme',
    },
    factsMentioned: [
      { key: 'product.synthesis-color-cream.description', label: 'Beschreibung' },
      { key: 'product.synthesis-color-cream.size', label: 'Menge' },
      { key: 'product.synthesis-color-cream.price', label: 'Preis' },
    ],
  });
}

function twoProductMemory() {
  const first = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
    type: 'agent_spoke',
    turnIndex: 1,
    text: 'Das Serum pflegt die Spitzen.',
    lastProduct: {
      spokenName: 'Luxe-Oel Serum',
      productId: 'luxe-oel-serum',
      productKind: 'Serum',
    },
    factsMentioned: [
      { key: 'product.luxe-oel-serum.description', label: 'Beschreibung' },
    ],
  });
  return reduceDrkallaShortTermMemory(first, {
    type: 'agent_spoke',
    turnIndex: 2,
    text: 'Das Leave-in bleibt im Haar.',
    lastProduct: {
      spokenName: 'Luxe-Oel Leave-in',
      productId: 'luxe-oel-leave-in',
      productKind: 'Leave-in',
    },
    factsMentioned: [
      { key: 'product.luxe-oel-leave-in.description', label: 'Beschreibung' },
    ],
  });
}

describe('DrKalla custom LLM responder', () => {
  it('does not call the model while the custom runtime canary is disabled', async () => {
    let calls = 0;
    const client: DrkallaCustomLlmClient = {
      complete: async () => {
        calls += 1;
        return 'should not be used';
      },
    };

    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: false,
        allowModelDirectives: false,
        allowLiveRollout: false,
        maxDirectiveChars: 0,
      },
      event: turn('Wie kaufe ich das?'),
      memory: productMemory(),
      client,
    });

    expect(calls).toBe(0);
    expect(response.blocked).toBe(true);
    expect(response.text).toContain('Canary disabled');
    expect(response.metrics.extraLlmCalls).toBe(0);
  });

  it('passes dialogue response-plan directives to the model when explicitly enabled', async () => {
    const prompts: string[] = [];
    const client: DrkallaCustomLlmClient = {
      complete: async (input) => {
        prompts.push(input.system);
        prompts.push(input.user);
        return 'Ich kann dir den Produktlink per SMS schicken. Soll ich das machen?';
      },
    };

    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('Wie kaufe ich das?'),
      memory: productMemory(),
      client,
    });

    const promptText = prompts.join('\n');
    expect(response.blocked).toBe(false);
    expect(response.text).toBe('Ich kann dir den Produktlink per SMS schicken. Soll ich das machen?');
    expect(promptText).toContain('Plan: offer_product_link');
    expect(promptText).toContain('offer_specific_product_link_or_availability');
    expect(promptText).toContain('Memory is conversation state, not evidence');
    expect(promptText).not.toContain('org-1');
    expect(promptText).not.toContain('tenant-1');
    expect(promptText).not.toContain('response_required');
    expect(response.metrics.extraLlmCalls).toBe(1);
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it('repairs inaudible speech after memory update without calling the model', async () => {
    let calls = 0;
    const client: DrkallaCustomLlmClient = {
      complete: async () => {
        calls += 1;
        return 'should not be used';
      },
    };

    const first = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('(inaudible speech)'),
      memory: createDrkallaShortTermMemory(),
      client,
    });
    const second = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('(inaudible speech)'),
      memory: first.memory,
      client,
    });

    expect(calls).toBe(0);
    expect(first.blocked).toBe(false);
    expect(first.text).toContain('Wie bitte?');
    expect(first.memory.inaudibleStreak).toBe(1);
    expect(first.metrics.extraLlmCalls).toBe(0);
    expect(second.text).toContain('Ich habe es akustisch nicht verstanden.');
    expect(second.memory.inaudibleStreak).toBe(2);
    expect(second.metrics.extraLlmCalls).toBe(0);
  });

  it('falls back safely if the model returns an empty answer', async () => {
    const client: DrkallaCustomLlmClient = {
      complete: async () => '   ',
    };

    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('Was ist der Unterschied?'),
      memory: productMemory(),
      client,
    });

    expect(response.blocked).toBe(false);
    expect(response.text).toContain('Ich prüfe das kurz');
    expect(response.text.length).toBeLessThanOrEqual(180);
  });

  it('uses product-funnel fallback instead of a category reset when model output is empty', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('Wie kaufe ich das?'),
      memory: productMemory(),
      client: { complete: async () => '   ' },
    });

    expect(response.text).toContain('Produktlink');
    expect(response.text).toContain('SMS');
    expect(response.text).not.toContain('Produktart');
    expect(response.text).not.toContain('Produktkategorie');
  });

  it('uses recent products for comparison fallback when model output is empty', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('Was ist der Unterschied?'),
      memory: twoProductMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain('Luxe-Oel Serum');
    expect(response.text).toContain('Luxe-Oel Leave-in');
    expect(response.text).not.toContain('Produktkategorie');
  });

  it('uses first-price Profi funnel fallback instead of a category reset when model output is empty', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('Was kostet das?'),
      memory: productMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain('normale');
    expect(response.text).toContain('Profi-Zugang');
    expect(response.text).toContain('Produktlink');
    expect(response.text).toContain('SMS');
    expect(response.text).not.toContain('Produktart');
    expect(response.text).not.toContain('Produktkategorie');
  });

  it('uses user-stated product type fallback instead of repeating the generic product question', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('Ich will eine Haarfarbe.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain('Haarfarbe');
    expect(response.text).toContain('Marke');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it('uses plural German product-type requests for the next funnel step', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('Ich suche Haarfarben.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain('Haarfarbe');
    expect(response.text).toContain('Marke');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraLlmCalls).toBe(1);
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it('offers an active product-type selection instead of asking for one specific brand', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('Ich suche Haarfarben.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain('Auswahl');
    expect(response.text).toContain('Marken');
    expect(response.text).not.toContain('bestimmte Marke');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it.each([
    ['Ich brauche eine Blondierung.', 'Blondierung'],
    ['Habt ihr Farbentferner?', 'Farbentferner'],
    ['Ich suche Haarglättung.', 'Haarglättung'],
    ['Ich brauche Haarspray.', 'Styling'],
    ['Habt ihr Salonwagen?', 'Salonmöbel/-ausstattung'],
    ['Habt ihr Friseurwagen?', 'Salonmöbel/-ausstattung'],
    ['Ich suche einen Rollwagen.', 'Salonmöbel/-ausstattung'],
    ['Ich brauche einen Arbeitswagen.', 'Salonmöbel/-ausstattung'],
  ])('uses catalogue product-type fallback for "%s"', async (text, expectedProductType) => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn(text),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain(expectedProductType);
    expect(response.text).toContain('Auswahl');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it.each([
    ['Ich suche Shampoos.', 'Shampoo'],
    ['Habt ihr Haarmasken?', 'Haarmaske'],
    ['Ich brauche Conditioner.', 'Conditioner/Spülung'],
    ['Ich suche Leave-in Pflege.', 'Leave-in'],
    ['Habt ihr Haarserum?', 'Serum'],
  ])('uses specific haircare product-type fallback for "%s"', async (text, expectedProductType) => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn(text),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain(expectedProductType);
    expect(response.text).toContain('Auswahl');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it.each([
    ['Ich suche Kämme.', 'Friseur-Tool'],
    ['Habt ihr Bürsten?', 'Friseur-Tool'],
    ['Ich brauche Scheren.', 'Friseur-Tool'],
    ['Habt ihr Färbeschalen?', 'Friseur-Tool'],
    ['Ich brauche Färbepinsel.', 'Friseur-Tool'],
    ['Habt ihr Alufolie?', 'Friseur-Tool'],
    ['Ich suche Strähnenfolie.', 'Friseur-Tool'],
    ['Habt ihr Glätteisen?', 'Friseur-Tool'],
    ['Ich brauche einen Föhn.', 'Friseur-Tool'],
    ['Habt ihr Haartrockner?', 'Friseur-Tool'],
    ['Ich suche einen Shaver.', 'Friseur-Tool'],
    ['Habt ihr Rasierer?', 'Friseur-Tool'],
    ['Ich brauche einen Barttrimmer.', 'Friseur-Tool'],
    ['Habt ihr Haarschneidemaschinen?', 'Friseur-Tool'],
    ['Ich suche Schneidemaschinen.', 'Friseur-Tool'],
    ['Habt ihr Rasierpinsel?', 'Friseur-Tool'],
    ['Ich brauche Rasierklingen.', 'Friseur-Tool'],
    ['Habt ihr Haarstaubwedel?', 'Friseur-Tool'],
    ['Ich suche einen Nackenwedel.', 'Friseur-Tool'],
  ])('uses plural tool product-type fallback for "%s"', async (text, expectedProductType) => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn(text),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain(expectedProductType);
    expect(response.text).toContain('Auswahl');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it.each([
    ['Habt ihr Dauerwellenlösung?', 'Styling'],
    ['Ich suche Dauerwelle.', 'Styling'],
    ['Ich brauche Dauerwellenmittel.', 'Styling'],
  ])('uses Dauerwelle styling product-type fallback for "%s"', async (text, expectedProductType) => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn(text),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain(expectedProductType);
    expect(response.text).toContain('Auswahl');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it.each([
    ['Habt ihr Farbkarten?', 'Farbkarte'],
    ['Ich suche eine Farbkarte.', 'Farbkarte'],
    ['Habt ihr eine Koleston Farbkarte?', 'Farbkarte'],
  ])('uses Farbkarte product-type fallback for "%s"', async (text, expectedProductType) => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn(text),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain(expectedProductType);
    expect(response.text).toContain('Auswahl');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it.each([
    ['Habt ihr Wascheinheiten?', 'Salonmöbel/-ausstattung'],
    ['Habt ihr Waschbecken?', 'Salonmöbel/-ausstattung'],
    ['Ich suche einen Waschplatz.', 'Salonmöbel/-ausstattung'],
    ['Habt ihr Rückwärtswaschbecken?', 'Salonmöbel/-ausstattung'],
    ['Ich suche Friseurstühle.', 'Salonmöbel/-ausstattung'],
    ['Habt ihr Barberstühle?', 'Salonmöbel/-ausstattung'],
    ['Ich suche einen Friseursessel.', 'Salonmöbel/-ausstattung'],
    ['Habt ihr Salonstühle?', 'Salonmöbel/-ausstattung'],
    ['Habt ihr Ablagen?', 'Salonmöbel/-ausstattung'],
    ['Ich suche einen Ablagetisch.', 'Salonmöbel/-ausstattung'],
    ['Habt ihr Ablagetische?', 'Salonmöbel/-ausstattung'],
    ['Ich brauche Stehmatten.', 'Salonmöbel/-ausstattung'],
  ])('uses plural salon-equipment product-type fallback for "%s"', async (text, expectedProductType) => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn(text),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain(expectedProductType);
    expect(response.text).toContain('Auswahl');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it.each([
    ['Habt ihr Spitzenpapier?', 'Salon-Verbrauchsmaterial'],
    ['Ich brauche Nackenpapier.', 'Salon-Verbrauchsmaterial'],
    ['Habt ihr Friseurumhänge?', 'Salon-Verbrauchsmaterial'],
    ['Ich suche Handschuhe.', 'Salon-Verbrauchsmaterial'],
  ])('uses salon-consumable product-type fallback for "%s"', async (text, expectedProductType) => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn(text),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain(expectedProductType);
    expect(response.text).toContain('Auswahl');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it.each([
    ['Habt ihr Sprühflaschen?', 'Salon-Verbrauchsmaterial'],
    ['Ich brauche Watteschnur.', 'Salon-Verbrauchsmaterial'],
    ['Habt ihr Spiegel?', 'Salon-Zubehör'],
    ['Ich suche einen Aufsteller.', 'Salon-Zubehör'],
    ['Ich suche einen Servicewagen.', 'Salon-Zubehör'],
    ['Habt ihr Kosmetikwagen?', 'Salon-Zubehör'],
    ['Ich brauche einen Haarsauger.', 'Friseur-Tool'],
    ['Habt ihr Clean All?', 'Friseur-Tool'],
    ['Ich suche Alligatorclips.', 'Styling'],
    ['Habt ihr Hair-Clips?', 'Styling'],
    ['Ich brauche Handtücher.', 'Salon-Verbrauchsmaterial'],
    ['Habt ihr Strähnenhauben?', 'Friseur-Tool'],
    ['Habt ihr Kosmetikbedarf?', 'Kosmetikbedarf'],
    ['Habt ihr Depilationszubehör?', 'Kosmetikbedarf'],
    ['Habt ihr Depilationswachs?', 'Kosmetikbedarf'],
    ['Ich brauche Hitzeschutz.', 'Haarpflege'],
    ['Ich brauche Haarpflege.', 'Haarpflege'],
    ['Habt ihr Ampullen?', 'Haarpflege'],
    ['Ich suche eine Haarkur.', 'Haarmaske'],
    ['Habt ihr eine klärende Spülung?', 'Conditioner/Spülung'],
    ['Ich suche Pflegespülung.', 'Conditioner/Spülung'],
    ['Ich suche Neutralshampoo.', 'Shampoo'],
    ['Habt ihr Haarfärbemittel?', 'Haarfarbe/Farbcreme'],
    ['Ich suche Nackenstreifen.', 'Salon-Verbrauchsmaterial'],
    ['Ich brauche Einweghandschuhe.', 'Salon-Verbrauchsmaterial'],
    ['Ich brauche ein professionelles Salonhandtuch.', 'Salon-Verbrauchsmaterial'],
    ['Habt ihr Salon-Verbrauchsmaterial?', 'Salon-Verbrauchsmaterial'],
    ['Habt ihr Haarschaum?', 'Styling'],
    ['Ich brauche Haarstyling.', 'Styling'],
    ['Ich brauche Bright-Wax.', 'Styling'],
    ['Habt ihr Stylingwax?', 'Styling'],
    ['Ich suche Gel-Spray.', 'Styling'],
    ['Habt ihr Volumen-Puder?', 'Styling'],
    ['Habt ihr Glanz-Spray?', 'Styling'],
    ['Habt ihr Laminier-Spray?', 'Styling'],
    ['Ich suche Vorbereitungsshampoo.', 'Shampoo'],
    ['Habt ihr Strähnchenfolie?', 'Friseur-Tool'],
    ['Ich brauche Blond-Booster.', 'Blondierung'],
    ['Habt ihr Desinfektionswagen?', 'Salonmöbel/-ausstattung'],
    ['Ich brauche eine UVC Lampe.', 'Friseur-Tool'],
    ['Habt ihr Accessories?', 'Salon-Zubehör'],
    ['Ich suche Zubehör.', 'Salon-Zubehör'],
    ['Habt ihr Salonbedarf?', 'Salon-Zubehör'],
    ['Ich brauche Barber-Bedarf.', 'Friseur-Tool'],
    ['Habt ihr einen Delrin Hair Comb?', 'Friseur-Tool'],
    ['Habt ihr einen Hair Dryer?', 'Friseur-Tool'],
    ['Ich suche einen konischen Heizstab.', 'Friseur-Tool'],
  ])('uses catalog-backed accessory fallback for "%s"', async (text, expectedProductType) => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn(text),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });

    expect(response.text).toContain(expectedProductType);
    expect(response.text).toContain('Auswahl');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
    expect(response.metrics.extraKbCalls).toBe(0);
  });
});

describe('DrKalla register/style + deterministic price (live call 2026-06-13 fixes)', () => {
  const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 };

  function priceEvidenceLookup() {
    return {
      size: 1,
      byId: () => null,
      byKeyHash: () => ({
        productId: 'synthesis-color-cream',
        spokenName: 'Synthesis Color Cream',
        productKind: 'Haarfarbe/Farbcreme',
        brandName: 'Dr.Kalla Cosmetics',
        priceText: '13,00 €',
        variantCount: 1,
        availableVariantCount: 1,
        hasUrl: true,
        url: 'https://drkalla.com/products/synthesis-color-cream',
      }),
    };
  }

  it('A-red/B: the system prompt forbids du and Stichpunkt style (live: model used du + fragments)', async () => {
    const prompts: string[] = [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was empfehlen Sie mir denn?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { prompts.push(system); return 'Gern, ich helfe Ihnen.'; } },
    });
    expect(prompts[0]).toContain('NIEMALS du');
    expect(prompts[0]).toMatch(/Niemals Stichpunkte|vollstaendigen, natuerlichen Saetzen/);
    expect(prompts[0]).toContain('drkalla.com');
  });

  it('B: a plain price question is answered deterministically in Sie, without the model', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Wie viel kostet die denn?'),
      memory: productMemory(),
      client: { complete: async () => { modelCalls += 1; return 'Soll ich dir das per SMS schicken?'; } },
      evidenceLookup: priceEvidenceLookup() as never,
    });
    expect(modelCalls).toBe(0);
    expect(response.metrics.extraLlmCalls).toBe(0);
    expect(response.text).toContain('13,00 €');
    expect(response.text).toContain('Profi-Zugang'); // disclosure given once
    expect(response.text).not.toMatch(/\b(?:du|dich|dir|dein)\b/i);
    expect(response.quality?.duFormDetected).toBe(false);
  });

  it('B: a follow-up price question does not repeat the Profi disclosure once it was given', async () => {
    const first = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was kostet die Synthesis Color Cream?'),
      memory: productMemory(),
      client: { complete: async () => 'unused' },
      evidenceLookup: priceEvidenceLookup() as never,
    });
    expect(first.text).toContain('Profi-Friseurpreise'); // full disclosure first time
    const second = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Und wie teuer ist die nochmal?'),
      memory: first.memory,
      client: { complete: async () => 'unused' },
      evidenceLookup: priceEvidenceLookup() as never,
    });
    // Second time: price + link offer, but no repeated Profi explanation.
    expect(second.text).toContain('13,00 €');
    expect(second.text).not.toContain('telefonisch nicht');
    expect(second.text).toContain('per SMS');
    expect(second.metrics.extraLlmCalls).toBe(0);
  });

  it('B: an open category need injects real catalog products into the prompt so the model can name them (live-call fix)', async () => {
    const prompts: string[] = [];
    const catalogSearch = (text: string) =>
      /dauerwelle/i.test(text)
        ? [{ productId: 'perm', spokenName: 'Ammoniakfreie duftende Dauerwellenlösung', productType: 'Styling', priceText: '16,00 Euro' }]
        : [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was habt ihr für Dauerwelle?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { prompts.push(system); return 'Wir haben die Ammoniakfreie duftende Dauerwellenlösung.'; } },
      catalogSearch,
    });
    expect(prompts[0]).toContain('Katalog-Treffer');
    expect(prompts[0]).toContain('Ammoniakfreie duftende Dauerwellenlösung');
    expect(prompts[0]).toMatch(/NENNE konkrete Produkte|frage nicht erneut nach der Produktart/);
  });

  it('B: a comparison price question still goes to the model (not the deterministic path)', async () => {
    let modelCalls = 0;
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was ist der Preis-Unterschied zwischen den beiden?'),
      memory: productMemory(),
      client: { complete: async () => { modelCalls += 1; return 'Ich vergleiche das gern.'; } },
      evidenceLookup: priceEvidenceLookup() as never,
    });
    expect(modelCalls).toBe(1);
  });
});
