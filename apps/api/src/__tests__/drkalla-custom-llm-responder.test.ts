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

  it('B: an open category need NAMES the top short product deterministically and grounds it (live-call fix)', async () => {
    let modelCalls = 0;
    const catalogSearch = (text: string) =>
      /dauerwelle/i.test(text)
        ? [
            { productId: 'perm', spokenName: 'Sanfte Dauerwelle für Wellen', shortName: 'Sanfte Dauerwelle', productType: 'Dauerwelle', priceText: '8,40 Euro', score: 4, categoryHit: true, typeHit: true, priceValue: null },
            { productId: 'perm2', spokenName: 'Kalte Dauerwelle', shortName: 'Kalte Dauerwelle', productType: 'Dauerwelle', priceText: '9,00 Euro', score: 4, categoryHit: true, typeHit: true, priceValue: null },
          ]
        : [];
    const evidenceLookup = {
      byId: (id: string) => (id === 'perm' ? { productId: 'perm', priceText: '8,40 Euro', hasUrl: true, url: 'https://drkalla.com/products/sanfte-dauerwelle' } : null),
      byKeyHash: () => null,
    };
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was habt ihr für Dauerwelle?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      catalogSearch,
      evidenceLookup: evidenceLookup as never,
    });
    expect(modelCalls).toBe(0);
    expect(response.metrics.extraLlmCalls).toBe(0);
    expect(response.text).toContain('Sanfte Dauerwelle');     // top short name
    expect(response.text).not.toContain('für Wellen');         // not the long title
    expect(response.text).toMatch(/per SMS schicken\?$/);      // offers the grounded link
    // The recommended product is grounded so a follow-up "ja" can confirm SMS.
    expect(response.memory.lastMentionedProduct?.spokenName).toBe('Sanfte Dauerwelle');
  });

  it('B: a need with only a title-only (no category) match falls back to model injection with short names', async () => {
    const prompts: string[] = [];
    const catalogSearch = (text: string) =>
      /spezielles/i.test(text)
        ? [{ productId: 'x', spokenName: 'Irgendein langer Produkttitel 500 Ml', shortName: 'Irgendein Produkt', productType: 'Styling', priceText: '5,00 Euro', score: 1, categoryHit: false, typeHit: false, priceValue: null }]
        : [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Habt ihr etwas spezielles?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { prompts.push(system); return 'Wir haben Irgendein Produkt.'; } },
      catalogSearch,
    });
    expect(prompts[0]).toContain('Katalog-Treffer');
    expect(prompts[0]).toContain('Irgendein Produkt');           // short name injected
    expect(prompts[0]).not.toContain('langer Produkttitel');     // not the full title
    expect(prompts[0]).toContain('Begruesse NICHT erneut');      // model must not re-greet
  });

  it('B: a cross-category item is NOT fed to the model when the category is known', async () => {
    // Real call 2026-06-15: a "Shampoo … lockiges Haar" need surfaced a
    // "Delrin-Kamm" (Friseur-Tool) because it carried a "lockiges Haar" tag. With
    // a known activeProductType the model feed must filter to productType matches,
    // so the comb (typeHit=false) can never reach the model.
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio',
      turnIndex: 1,
      text: 'Ich suche ein Shampoo.',
      audioState: 'heard',
    });
    expect(memory.activeProductType?.label).toBeTruthy();
    const prompts: string[] = [];
    // The comb tag-matches the query but is NOT a Shampoo (typeHit=false).
    const catalogSearch = () => [
      { productId: 'kamm', spokenName: 'Delrin-Kamm 4053', shortName: 'Delrin-Kamm', productType: 'Friseur-Tool', priceText: '4 Euro', priceValue: 4, score: 2, categoryHit: true, typeHit: false },
    ];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Für lockiges Haar bitte.'),
      memory,
      client: { complete: async ({ system }) => { prompts.push(system); return 'Wie kann ich helfen?'; } },
      catalogSearch: catalogSearch as never,
    });
    expect(prompts[0]).not.toContain('Delrin-Kamm');
    expect(prompts[0]).not.toContain('Kamm');
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

  it('B: a generic hair descriptor is NOT treated as an ambiguous product (no variant clarification)', async () => {
    // Real battery 2026-06-14: "trockenes Haar" hit the ambiguous-product path and
    // asked "welche Ausführung?" — it is a NEED, not a product line.
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was empfehlen Sie mir für trockenes Haar?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'Für trockenes Haar empfehle ich eine reichhaltige Pflegemaske.' },
      detectAmbiguousProduct: () => ({ label: 'Trockenes Haar', productCount: 2 }),
      catalogSearch: () => [],
    });
    expect(response.text).not.toContain('mehrere Ausführungen');
    expect(response.text).not.toContain('Welche Größe oder Ausführung');
    expect(response.text).toContain('trockenes Haar');
  });

  it('B: "günstigste" names the cheapest product in the category', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was ist die günstigste Haarfarbe?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'should not be used' },
      catalogSearch: (t: string) => (/haarfarbe/i.test(t) ? [
        { productId: 'a', spokenName: 'Teure Farbe', shortName: 'Teure Farbe', productType: 'Haarfarbe', priceText: '20 Euro', priceValue: 20, score: 4, categoryHit: true, typeHit: true },
        { productId: 'b', spokenName: 'Günstige Farbe', shortName: 'Günstige Farbe', productType: 'Haarfarbe', priceText: '3 Euro', priceValue: 3, score: 4, categoryHit: true, typeHit: true },
      ] : []),
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(response.text).toContain('Da kann ich Ihnen Günstige Farbe empfehlen');
  });

  it('B: a product-link confirm resolves the URL via the catalog when the grounded product lost its URL', async () => {
    // The grounded product has no evidence URL (a turn re-grounded the spoken
    // name to a URL-less duplicate); the spoken name resolves in the catalog to
    // the real URL-having product, so the SMS still goes out (battery edge).
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Soll ich Ihnen den Link zu Sintesis per SMS schicken?',
      lastAgentQuestion: 'Soll ich Ihnen den Link zu Sintesis per SMS schicken?',
      lastProduct: { spokenName: 'Sintesis', productId: 'sintesis-nourl' },
    });
    let sentUrl: string | null = null;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('ja'),
      memory,
      client: { complete: async () => 'should not be used' },
      evidenceLookup: {
        byId: (id: string) => (id === 'sintesis-real' ? { productId: 'sintesis-real', priceText: '9 Euro', hasUrl: true, url: 'https://drkalla.com/p/sintesis' } : null),
        byKeyHash: () => null,
      } as never,
      catalogSearch: (t: string) => (/sintesis/i.test(t) ? [
        { productId: 'sintesis-real', spokenName: 'Sintesis', shortName: 'Sintesis', productType: 'Haarfarbe', priceText: '9 Euro', priceValue: 9, score: 4, categoryHit: true, typeHit: true },
      ] : []),
      executeSendLink: async (l: { url: string }) => { sentUrl = l.url; return { smsSent: true as const }; },
    });
    expect(sentUrl).toBe('https://drkalla.com/p/sintesis');
    expect(response.text).toContain('per SMS geschickt');
  });

  it('B: a curated FAQ answers deterministically; an uncovered question still reaches the model (additive)', async () => {
    const faqMatch = (t: string) => (/versand/i.test(t)
      ? { id: 'shipping', answer: 'Die Versandkosten sehen Sie im Bestellvorgang auf drkalla.com.', tags: [] }
      : null);
    const covered = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was kostet der Versand?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { throw new Error('model must not run for a covered FAQ'); } },
      faqMatch,
    });
    expect(covered.metrics.extraLlmCalls).toBe(0);
    expect(covered.text).toContain('Versandkosten');

    // No FAQ match -> the model answers exactly as before, and the question is
    // captured as a candidate for later curation.
    const captured: Array<{ q: string; a: string }> = [];
    const uncovered = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Habt ihr ein cooles Gadget?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'Wir haben verschiedenes im Sortiment.' },
      faqMatch,
      onFaqCandidate: (q, a) => { captured.push({ q, a }); },
    });
    expect(uncovered.metrics.extraLlmCalls).toBe(1);
    expect(uncovered.text).toBe('Wir haben verschiedenes im Sortiment.');
    expect(captured[0]?.q).toBe('Habt ihr ein cooles Gadget?');
  });
});

describe('DrKalla deterministic brand/product list ("Soll ich mit Marken anfangen?" -> "Ja")', () => {
  const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 };

  // Memory with an active product type but no resolved single product, mirroring
  // the state right after the agent offered "Soll ich mit Marken anfangen?".
  function activeTypeMemory() {
    return reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio',
      turnIndex: 1,
      text: 'Ich suche eine Haarfarbe.',
      audioState: 'heard',
    });
  }

  // Stub catalog search returning 3 real-shaped products for the active type.
  // Text-aware like the real search: a bare "ja" has no content tokens and
  // returns nothing (so it cannot drive a deterministic product list).
  // Real search treats "marken"/"auswahl" as stopwords, so only a real category
  // word returns hits (the typeList path passes the activeType label here).
  const threeProductSearch = (text: string) =>
    /haarfarbe|farbcreme|\bfarbe\b/i.test(text)
      ? [
          { productId: 'koleston', spokenName: 'Koleston Perfect', shortName: 'Koleston Perfect', productType: 'Haarfarbe/Farbcreme', priceText: '9,90 Euro', score: 4, categoryHit: true, typeHit: true, priceValue: null },
          { productId: 'majirel', spokenName: 'Majirel', shortName: 'Majirel', productType: 'Haarfarbe/Farbcreme', priceText: '11,50 Euro', score: 4, categoryHit: true, typeHit: true, priceValue: null },
          { productId: 'igora', spokenName: 'Igora Royal', shortName: 'Igora Royal', productType: 'Haarfarbe/Farbcreme', priceText: '10,20 Euro', score: 4, categoryHit: true, typeHit: true, priceValue: null },
          { productId: 'inoa', spokenName: 'Inoa', shortName: 'Inoa', productType: 'Haarfarbe/Farbcreme', priceText: '14,00 Euro', score: 4, categoryHit: true, typeHit: true, priceValue: null },
        ]
      : [];

  it('A-red: a bare "Ja" with an active product type names 3 real products, no model call', async () => {
    const memory = activeTypeMemory();
    expect(memory.activeProductType?.label).toBe('Haarfarbe/Farbcreme');

    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      catalogSearch: threeProductSearch,
    });

    expect(modelCalls).toBe(0);
    expect(response.metrics.extraLlmCalls).toBe(0);
    expect(response.text).toContain('Haarfarbe/Farbcreme');
    expect(response.text).toContain('Koleston Perfect');
    expect(response.text).toContain('Majirel');
    expect(response.text).toContain('Igora Royal');
    expect(response.text).toContain('9,90 Euro'); // priceText only on the first item
    expect(response.text).not.toContain('11,50 Euro');
    expect(response.text).toContain('Welches davon interessiert Sie?');
    expect(response.text).not.toMatch(/\b(?:du|dich|dir|dein)\b/i);
  });

  it('A: a brand-only/garbled turn with an active product type still reaches products (reachability)', async () => {
    // Real call 2026-06-15: after "Haarfarben?" the caller said "von Wella" /
    // "ich will ein Produkt" and the agent looped instead of naming products.
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, genau, ein Produkt würde ich nehmen, von Wella.'),
      memory: activeTypeMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      catalogSearch: threeProductSearch,
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Da kann ich Ihnen'); // named a product, did not loop
    expect(response.text).toContain('Koleston Perfect');
  });

  it('A: a specific ambiguous product line still gets a variant clarification even with an active type', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Koleston Perfect bitte.'),
      memory: activeTypeMemory(),
      client: { complete: async () => 'should not be used' },
      catalogSearch: threeProductSearch,
      detectAmbiguousProduct: () => ({ label: 'Koleston Perfect', productCount: 2 }),
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(response.text).toContain('mehrere Ausführungen');
  });

  it('A-red: an explicit "welche Marken habt ihr?" lists the same 3 products, no model call', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Welche Marken habt ihr?'),
      memory: activeTypeMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      catalogSearch: threeProductSearch,
    });

    expect(modelCalls).toBe(0);
    expect(response.metrics.extraLlmCalls).toBe(0);
    expect(response.text).toContain('Koleston Perfect');
    expect(response.text).toContain('Majirel');
    expect(response.text).toContain('Igora Royal');
    expect(response.text).toContain('Welches davon interessiert Sie?');
  });

  it('B: with NO active product type, a bare "Ja" falls through to the model path', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'Worum darf ich mich kümmern?'; } },
      catalogSearch: threeProductSearch,
    });

    expect(modelCalls).toBe(1);
    expect(response.metrics.extraLlmCalls).toBe(1);
    expect(response.text).toBe('Worum darf ich mich kümmern?');
  });

  it('A: a type + brand in ONE turn reaches a product, NOT a variant clarification', async () => {
    // Real call 2026-06-15: "Haarfarbe von L'Oréal" asked "welche Nuance?" seven
    // times. When the caller names the TYPE this turn, an ambiguous brand/line is
    // a filter, not a variant choice — reach a product immediately.
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ich möchte eine Haarfarbe von L’Oréal.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      catalogSearch: threeProductSearch,
      detectAmbiguousProduct: () => ({ label: 'L’Oréal', productCount: 4 }),
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Da kann ich Ihnen');
    expect(response.text).not.toContain('mehrere Ausführungen');
  });

  it('A: after a variant question was already asked, the next turn reaches a product (anti-loop)', async () => {
    // Even a real ambiguous LINE must not loop the variant question: if we asked
    // it last turn and the caller answered, reach a concrete product instead.
    const asked = reduceDrkallaShortTermMemory(activeTypeMemory(), {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Von Koleston Perfect gibt es bei uns mehrere Ausführungen. Welche Größe oder Ausführung meinen Sie?',
      lastAgentQuestion: 'Welche Größe oder Ausführung meinen Sie?',
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Koleston Perfect bitte.'),
      memory: asked,
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      catalogSearch: threeProductSearch,
      detectAmbiguousProduct: () => ({ label: 'Koleston Perfect', productCount: 2 }),
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Da kann ich Ihnen');
    expect(response.text).not.toContain('mehrere Ausführungen');
  });

  it('A: a price objection ("zu teuer") names the cheapest in the category (negotiation)', async () => {
    // Caller complaint "er kann nicht verhandeln": a price objection must offer a
    // cheaper alternative, not repeat the same product or dodge.
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Das ist mir ehrlich gesagt zu teuer.'),
      memory: activeTypeMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      catalogSearch: (t: string) => (/haarfarbe|farbcreme|\bfarbe\b|teuer/i.test(t) ? [
        { productId: 'a', spokenName: 'Teure Farbe', shortName: 'Teure Farbe', productType: 'Haarfarbe/Farbcreme', priceText: '20 Euro', priceValue: 20, score: 4, categoryHit: true, typeHit: true },
        { productId: 'b', spokenName: 'Sparfarbe', shortName: 'Sparfarbe', productType: 'Haarfarbe/Farbcreme', priceText: '3 Euro', priceValue: 3, score: 4, categoryHit: true, typeHit: true },
      ] : []),
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Da kann ich Ihnen Sparfarbe empfehlen');
  });

  it('B: a comparison/advice question goes to the model, NOT the canned recommender', async () => {
    // Real call 2026-06-15: "Was ist besser, X oder Y?" hit the deterministic
    // recommender and repeated the same template. It must reach the model.
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was ist besser, Koleston Perfect oder Majirel, für blondes Haar?'),
      memory: activeTypeMemory(),
      client: { complete: async () => { modelCalls += 1; return 'Für blondes Haar passt Majirel etwas besser.'; } },
      catalogSearch: threeProductSearch,
    });
    expect(modelCalls).toBe(1);
    expect(response.text).not.toContain('Da kann ich Ihnen');
  });

  it('B: the recommender never re-pitches the product it just recommended (anti-broken-record)', async () => {
    // Real call 2026-06-15: the agent looped "Da kann ich Ihnen Glanz-Shampoo
    // empfehlen … Soll ich den Link schicken?" verbatim every turn. A follow-up
    // about the same product must vary via the model.
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Da kann ich Ihnen Glanz-Shampoo empfehlen.',
      lastProduct: { spokenName: 'Glanz-Shampoo', productId: 'gs', productKind: 'Shampoo' },
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Und haben Sie da noch etwas anderes?'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'Ja, wir haben noch weitere Shampoos.'; } },
      catalogSearch: (t: string) => (/shampoo|anderes/i.test(t) ? [
        { productId: 'gs', spokenName: 'Glanz-Shampoo', shortName: 'Glanz-Shampoo', productType: 'Shampoo', priceText: '12 Euro', priceValue: 12, score: 4, categoryHit: true, typeHit: true },
      ] : []),
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(modelCalls).toBe(1);
    expect(response.text).not.toContain('Da kann ich Ihnen Glanz-Shampoo empfehlen');
  });

  it('B: no re-pitch even after a same-category re-mention clears lastMentionedProduct', async () => {
    // Real call 2026-06-15: "Haben Sie auch Haarfarben von L'Oréal?" repeated the
    // exact prior recommendation. The same-category re-mention clears
    // lastMentionedProduct (switched-type reset), so the guard must rely on
    // lastAgentQuestion (the SMS offer still naming the product).
    const memory = reduceDrkallaShortTermMemory(activeTypeMemory(), {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Da kann ich Ihnen Haarfarbe Ammoniakfrei empfehlen. Soll ich Ihnen den Link zu Haarfarbe Ammoniakfrei per SMS schicken?',
      lastAgentQuestion: 'Soll ich Ihnen den Link zu Haarfarbe Ammoniakfrei per SMS schicken?',
    });
    expect(memory.lastMentionedProduct).toBeNull(); // no lastProduct on the event
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Haben Sie auch Haarfarben von L Oreal?'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'Von L Oreal führen wir nur INOA; sonst haben wir eigene Haarfarben.'; } },
      catalogSearch: (t: string) => (/haarfarbe|oreal/i.test(t) ? [
        { productId: 'ha', spokenName: 'Haarfarbe Ammoniakfrei', shortName: 'Haarfarbe Ammoniakfrei', productType: 'Haarfarbe/Farbcreme', priceText: '4 Euro 50', priceValue: 4.5, score: 4, categoryHit: true, typeHit: true },
      ] : []),
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(modelCalls).toBe(1);
    expect(response.text).not.toContain('Da kann ich Ihnen Haarfarbe Ammoniakfrei empfehlen');
  });

  it('B: "was kostet das?" gives the active product price, not a fresh recommendation', async () => {
    // Real call 2026-06-15: a plain price question pitched a DIFFERENT product
    // because the recommender ran before the price path.
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Da kann ich Ihnen Glanz-Shampoo empfehlen.',
      lastProduct: { spokenName: 'Glanz-Shampoo', productId: 'gs', productKind: 'Shampoo' },
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was kostet das?'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      evidenceLookup: { byId: () => null, byKeyHash: () => ({ priceText: '12 Euro' }) } as never,
      catalogSearch: () => [
        { productId: 'other', spokenName: 'Anderes Produkt', shortName: 'Anderes Produkt', productType: 'Shampoo', priceText: '99 Euro', priceValue: 99, score: 4, categoryHit: true, typeHit: true },
      ],
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Glanz-Shampoo');
    expect(response.text).toMatch(/kostet/);
    expect(response.text).not.toContain('Anderes Produkt');
  });

  it('B: a model-phrased link offer + "ja, schick" sends via the SMS path, not the model', async () => {
    // Real call 2026-06-15: after a model "Möchten Sie den Link?", "schick mir
    // den Link" missed the confirm and the model hallucinated "Ich sende Ihnen
    // den Link" while no SMS went out. The offer + the affirmation must both be
    // recognized so the real send path runs.
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Möchten Sie den Link zu Glanz-Shampoo?',
      lastAgentQuestion: 'Möchten Sie den Link zu Glanz-Shampoo?',
      lastProduct: { spokenName: 'Glanz-Shampoo', productId: 'gs', productKind: 'Shampoo' },
    });
    let sent = false; let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, schick mir den Link.'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      evidenceLookup: { byId: () => ({ url: 'https://drkalla.com/p/gs' }), byKeyHash: () => ({ url: 'https://drkalla.com/p/gs' }) } as never,
      catalogSearch: () => [
        { productId: 'gs', spokenName: 'Glanz-Shampoo', shortName: 'Glanz-Shampoo', productType: 'Shampoo', priceText: '12 Euro', priceValue: 12, score: 4, categoryHit: true, typeHit: true },
      ],
      executeSendLink: async () => { sent = true; return { smsSent: true as const }; },
    });
    expect(modelCalls).toBe(0);
    expect(sent).toBe(true);
    expect(response.text).toContain('per SMS geschickt');
  });
});

describe('DrKalla deterministic smalltalk fast-paths (latency: low-content turns skip the model)', () => {
  const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 };

  // Memory whose last agent question is an SMS/link offer, so a "nein" here must
  // be owned by the existing confirm logic, NOT the smalltalk fast-path.
  function smsOfferMemory() {
    return reduceDrkallaShortTermMemory(productMemory(), {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Soll ich Ihnen den Produktlink per SMS schicken?',
      lastAgentQuestion: 'Soll ich Ihnen den Produktlink per SMS schicken?',
    });
  }

  it('A-red: a pure "danke" is acknowledged deterministically, the model is NOT called', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Danke!'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
    });

    expect(modelCalls).toBe(0);
    expect(response.metrics.extraLlmCalls).toBe(0);
    expect(response.text).toBe('Sehr gern! Kann ich sonst noch etwas für Sie tun?');
    expect(response.text).not.toMatch(/\b(?:du|dich|dir|dein)\b/i);
  });

  it('A-red: a bare "okay" is acknowledged deterministically, no model call', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Okay'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
    });

    expect(modelCalls).toBe(0);
    expect(response.metrics.extraLlmCalls).toBe(0);
    expect(response.text).toBe('Gern. Womit kann ich Ihnen weiterhelfen?');
  });

  it('A-red: a bare non-farewell "nein" is acknowledged deterministically, no model call', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Nein.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
    });

    expect(modelCalls).toBe(0);
    expect(response.metrics.extraLlmCalls).toBe(0);
    expect(response.text).toBe('Alles klar. Kann ich Ihnen sonst noch weiterhelfen?');
  });

  it('A-red: "Nee, alles gut" after a sent SMS winds down deterministically (no model, no link re-offer)', async () => {
    // Mirrors the live call: after the SMS was sent the last question is "Kann ich
    // sonst noch etwas klären?" (NOT an SMS offer), so "Nee, alles gut" must wind
    // down instead of reaching the model, which re-offered the same link.
    const memory = reduceDrkallaShortTermMemory(productMemory(), {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Erledigt, ich habe Ihnen den Produktlink per SMS geschickt. Kann ich sonst noch etwas klären?',
      lastAgentQuestion: 'Kann ich sonst noch etwas klären?',
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Nee, alles gut.'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toBe('Alles klar. Kann ich Ihnen sonst noch weiterhelfen?');
    expect(response.text).not.toMatch(/link|sms/i);
  });

  it('B: a real product/price question is NOT swallowed and still reaches the model', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Danke, und was kostet die Pflege denn so?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'Ich schaue das gern nach.'; } },
    });

    expect(modelCalls).toBe(1);
    expect(response.metrics.extraLlmCalls).toBe(1);
    expect(response.text).toBe('Ich schaue das gern nach.');
  });

  it('B: a "nein" right after an SMS offer is NOT swallowed by smalltalk', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Nein.'),
      memory: smsOfferMemory(),
      client: { complete: async () => { modelCalls += 1; return 'Alles klar, dann nicht.'; } },
    });

    // The smalltalk ack must not own this turn; the existing confirm/model path does.
    expect(response.text).not.toBe('Alles klar. Kann ich Ihnen sonst noch weiterhelfen?');
    expect(modelCalls).toBe(1);
    expect(response.metrics.extraLlmCalls).toBe(1);
  });
});
