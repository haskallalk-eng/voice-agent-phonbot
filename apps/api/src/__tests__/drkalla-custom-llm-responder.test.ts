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

function volumeMaskMemory() {
  return reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
    type: 'agent_spoke',
    turnIndex: 1,
    text: 'Volumen Haarmaske kostet 22,90 Euro. Soll ich Ihnen den Produktlink per SMS schicken?',
    lastProduct: {
      spokenName: 'Volumen Haarmaske',
      productId: 'volumen-haarmaske',
      productKind: 'Haarmaske',
    },
    factsMentioned: [
      { key: 'product.volumen-haarmaske.price', label: 'Preis' },
      { key: 'product.volumen-haarmaske.link', label: 'Link' },
    ],
    lastAgentQuestion: 'Soll ich Ihnen den Produktlink per SMS schicken?',
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

  it('keeps an application question on the active product and does not recommend a random other product', async () => {
    let calls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      event: turn('Wie ist die Anwendung dieser Maske?'),
      memory: volumeMaskMemory(),
      client: {
        complete: async () => {
          calls += 1;
          return 'Da kann ich Ihnen Anti-Orange Maske empfehlen. Soll ich Ihnen den Link dazu senden?';
        },
      },
    });

    expect(calls).toBe(0);
    expect(response.text).toContain('Volumen Haarmaske');
    expect(response.text).toMatch(/Anwendung|anwenden/i);
    expect(response.text).toMatch(/Produktseite|kontakt/i);
    expect(response.text).not.toContain('Anti-Orange');
    expect(response.text).not.toContain('empfehlen');
    expect(response.metrics.extraLlmCalls).toBe(0);
    expect(response.metrics.extraKbCalls).toBe(0);
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
    // The website is referenced in spoken form (no literal "drkalla.com", which
    // the TTS would read as letters).
    expect(prompts[0]).toContain('Doktor Kalla punkt com');
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

  it('B: a store-visit / browse question is NOT hijacked by the recommender (routes to the model)', async () => {
    // Live 2026-06-30: with activeProductType=Haarfarbe remembered, the caller
    // asked "kann man bei euch vorbeischauen und Sachen gucken?" and the agent
    // fused the remembered category onto the question and dumped a Färbepinsel.
    // A store-visit question must reach the model (we are a reiner Versandhandel).
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio',
      turnIndex: 1,
      text: 'Ich möchte eine Haarfarbe kaufen.',
      audioState: 'heard',
    });
    expect(memory.activeProductType?.label).toMatch(/haarfarbe/i);
    let modelCalls = 0;
    // Would surface a product if the remembered "Haarfarbe" were fused onto the turn.
    const catalogSearch = (text: string) =>
      /haarfarbe|pinsel/i.test(text)
        ? [{ productId: 'pinsel', spokenName: 'Färbepinsel klassisch', shortName: 'Färbepinsel', productType: 'Haarfarbe-Zubehör', priceText: '1 Euro siebzig', priceValue: 1.7, score: 3, categoryHit: true, typeHit: true }]
        : [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Kann man bei euch vorbeischauen und sich die Sachen angucken?'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'Wir sind ein reiner Versandhandel, ein Besuch vor Ort ist leider nicht möglich.'; } },
      catalogSearch: catalogSearch as never,
    });
    expect(modelCalls).toBe(1);
    expect(response.text).not.toContain('Färbepinsel');
    expect(response.text).not.toMatch(/Da kann ich Ihnen .* empfehlen/);
  });

  it('B: a plain product-browse verb ("ein Shampoo ansehen") is NOT vetoed — it still reaches the grounded recommender', async () => {
    // Review 2026-06-30: the store-visit veto must not swallow ordinary product
    // verbs (ansehen/anschauen/angucken). "ein Shampoo ansehen" is a real buy
    // intent and must get the grounded deterministic pitch, not fall to the model.
    let modelCalls = 0;
    const catalogSearch = (text: string) =>
      /shampoo/i.test(text)
        ? [{ productId: 'gs', spokenName: 'Glanz-Shampoo Argent', shortName: 'Glanz-Shampoo', productType: 'Shampoo', priceText: '12 Euro', priceValue: 12, score: 5, categoryHit: true, typeHit: true }]
        : [];
    const evidenceLookup = {
      byId: (id: string) => (id === 'gs' ? { productId: 'gs', priceText: '12 Euro', hasUrl: true, url: 'https://drkalla.com/products/glanz-shampoo' } : null),
      byKeyHash: () => null,
    };
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ich möchte mir mal ein Shampoo ansehen.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      catalogSearch: catalogSearch as never,
      evidenceLookup: evidenceLookup as never,
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Glanz-Shampoo');
  });

  it('B: an ASSORTMENT/attribute question ("was habt ihr für Farben?") goes to the model, not the robotic template', async () => {
    // Live 2026-07-01: with activeProductType=Haarfarbe, "Was habt ihr denn für
    // Farben?" got "Da kann ich Ihnen Haarfarbe Ammoniakfrei empfehlen. Das kostet
    // 4 Euro fünfzig …" twice — the caller wanted the RANGE of colors, not a pitch.
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio',
      turnIndex: 1,
      text: 'Ich möchte eine Haarfarbe kaufen.',
      audioState: 'heard',
    });
    let modelCalls = 0;
    const catalogSearch = () => [
      { productId: 'af', spokenName: 'Haarfarbe Ammoniakfrei', shortName: 'Haarfarbe Ammoniakfrei', productType: 'Haarfarbe', priceText: '4 Euro fünfzig', priceValue: 4.5, score: 4, categoryHit: true, typeHit: true },
    ];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was habt ihr denn für Farben?'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'Wir haben verschiedene Nuancen von Naturtönen bis Intensivfarben. Welche Farbe suchen Sie denn?'; } },
      catalogSearch: catalogSearch as never,
    });
    expect(modelCalls).toBe(1);
    expect(response.text).not.toMatch(/Da kann ich Ihnen .* empfehlen/);
  });

  it('B: long off-topic chatter does NOT hijack a remembered category (ambient filler removed from continuation)', async () => {
    // Review 2026-06-30: "noch"/"von"/"gern" used to satisfy the buy-continuation
    // gate, so an off-topic non-question with a remembered category got a product
    // dumped on it. Such turns must now reach the model.
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio',
      turnIndex: 1,
      text: 'Ich möchte eine Haarfarbe kaufen.',
      audioState: 'heard',
    });
    let modelCalls = 0;
    const catalogSearch = (text: string) =>
      /haarfarbe|pinsel/i.test(text)
        ? [{ productId: 'pinsel', spokenName: 'Färbepinsel klassisch', shortName: 'Färbepinsel', productType: 'Haarfarbe-Zubehör', priceText: '1 Euro siebzig', priceValue: 1.7, score: 3, categoryHit: true, typeHit: true }]
        : [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('ich bin gerade noch ein bisschen am überlegen und rede mit meinem mann'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'Kein Problem, lassen Sie sich Zeit.'; } },
      catalogSearch: catalogSearch as never,
    });
    expect(modelCalls).toBe(1);
    expect(response.text).not.toContain('Färbepinsel');
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

  it('B: a category/"Sortiment" confirm sends a category SEARCH link, not a wrong single product', async () => {
    // Caller asked about a category (no single product grounded). Instead of the
    // misleading "noch nicht freigeschaltet", send a valid drkalla.com category
    // search link for the active product type (live call 2026-06-28: links not
    // flexible enough — a "Scheren-Sortiment" request sent a random comb).
    const memory = {
      ...createDrkallaShortTermMemory(),
      activeProductType: { label: 'Schere', turnIndex: 1 },
      lastAgentQuestion: 'Soll ich Ihnen den Link zu unserem Scheren-Sortiment per SMS schicken?',
    };
    let captured: { url: string; linkKind: string } | null = null;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('ja, gerne'),
      memory,
      client: { complete: async () => 'should not be used' },
      executeSendLink: async (l: { url: string; linkKind: string }) => { captured = l; return { smsSent: true as const }; },
    });
    expect(captured).not.toBeNull();
    expect(captured!.linkKind).toBe('category');
    expect(captured!.url).toBe('https://drkalla.com/search?q=Schere');
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

  // Vendor-strict brand stock: the shop carries exactly one L'Oréal product (the
  // Inoa, in stock at 13 Euro). Wella et al. are NOT carried -> [] -> honest deny.
  const lorealStock = (brandName: string) =>
    /l['’]?\s*or[ée]al|lor[ée]al|loreal|oreal/i.test(brandName)
      ? [{ productId: 'inoa', spokenName: "L'Oréal Inoa Haarfärbemittel Ammoniakfrei", shortName: "L'Oréal Inoa Haarfärbemittel Ammoniakfrei", productType: 'Haarfärbemittel', priceText: '13,00 Euro', priceValue: 13, available: 1 }]
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

  it('A: an unstocked brand ("von Wella") is answered honestly + a house alternative, no loop', async () => {
    // Real calls 2026-06-15/16: "von Wella" / "L'Oréal" looped a wrong-brand
    // product. We do NOT carry Wella (verified: only L'Oréal/Lattafa/CJ are
    // external vendors) — say so and offer a house alternative, deterministically.
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
    expect(response.text).toContain('führen wir leider nicht'); // honest about Wella
    expect(response.text).toContain('Koleston Perfect'); // grounded house alternative
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

  it('A: a STOCKED brand ("Haarfarbe von L\'Oréal") names the real product, never a false denial', async () => {
    // Real data 2026-06-16: we DO carry one L'Oréal product (the Inoa, ammoniakfrei,
    // 13 Euro, in stock). The old flat "führen wir nicht" was a false denial; name
    // the real product instead — honest, grounded, and it ends the loop.
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ich möchte eine Haarfarbe von L’Oréal.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      catalogSearch: threeProductSearch,
      brandStock: lorealStock,
      detectAmbiguousProduct: () => ({ label: 'L’Oréal', productCount: 4 }),
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Von L\'Oréal haben wir');
    expect(response.text).toContain('Inoa');
    expect(response.text).toContain('13,00 Euro');
    expect(response.text).not.toContain('führen wir leider nicht'); // not a false denial
    expect(response.text).not.toContain('mehrere Ausführungen');
    expect(response.text).not.toContain("haben wir nur L'Oréal Inoa"); // brand echo stripped
  });

  it('A: every L\'Oréal ASR spelling (Loreal / Loyal / L\'Oréal) names the same stocked product', async () => {
    for (const spelling of ['Haben Sie Haarfarbe von Loreal?', 'Habt ihr was von Loyal?', 'Ich möchte eine Haarfarbe von L’Oréal.']) {
      let modelCalls = 0;
      const response = await buildDrkallaCustomLlmResponse({
        canary: CANARY,
        event: turn(spelling),
        memory: activeTypeMemory(),
        client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
        catalogSearch: threeProductSearch,
        brandStock: lorealStock,
        evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
      });
      expect(modelCalls, spelling).toBe(0);
      expect(response.text, spelling).toContain("Von L'Oréal haben wir");
      expect(response.text, spelling).toContain('Inoa');
    }
  });

  it('A: a STOCKED brand answer reads grammatically for a range price (no "für von")', async () => {
    // If the stocked brand product had a price range, the clause must not read
    // "für von 12 Euro bis 17 Euro" — a range is appended with a comma.
    const rangeBrandStock = (brandName: string) =>
      /or[ée]al/i.test(brandName)
        ? [{ productId: 'inoa', spokenName: 'Inoa', shortName: 'Inoa', productType: 'Haarfärbemittel', priceText: 'von 12,00 Euro bis 17,00 Euro', priceValue: 12, available: 1 }]
        : [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Haben Sie L’Oréal?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'should not be used' },
      catalogSearch: threeProductSearch,
      brandStock: rangeBrandStock,
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(response.text).toContain('Inoa, von 12,00 Euro bis 17,00 Euro');
    expect(response.text).not.toContain('für von');
  });

  it('A: a second consecutive same-brand turn does not repeat the brand line (anti-repeat survives type-switch)', async () => {
    // Turn 1 named the L'Oréal Inoa; a follow-up "und L'Oréal Shampoo?" switches
    // activeProductType (clearing lastMentionedProduct), so the guard must also key
    // off lastAgentQuestion (which still names the product) -> hand to the model.
    const asked = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Von L\'Oréal haben wir nur Inoa Haarfärbemittel Ammoniakfrei für 13,00 Euro. Sonst führen wir überwiegend unsere Hausmarke. Möchten Sie mehr zu Inoa Haarfärbemittel Ammoniakfrei wissen?',
      lastAgentQuestion: 'Möchten Sie mehr zu Inoa Haarfärbemittel Ammoniakfrei wissen?',
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Und L’Oréal Shampoo, habt ihr das?'),
      memory: asked,
      client: { complete: async () => { modelCalls += 1; return 'Ein L’Oréal Shampoo führen wir nicht, aber unsere Hausmarke hätte da etwas.'; } },
      catalogSearch: () => [], // no house hit -> falls through to the model
      brandStock: lorealStock,
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(modelCalls).toBe(1); // handed to the model, not repeated deterministically
    expect(response.text).not.toContain('Von L\'Oréal haben wir'); // not the same line again
  });

  it('A: a genuinely UNSTOCKED brand ("von Wella") still gets the honest deny + house alternative', async () => {
    // Vendor-strict stock returns [] for Wella -> the honest "führen wir nicht".
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Haben Sie eine Haarfarbe von Wella?'),
      memory: activeTypeMemory(),
      client: { complete: async () => 'should not be used' },
      catalogSearch: threeProductSearch,
      brandStock: lorealStock, // returns [] for Wella
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(response.text).toContain('Produkte von Wella führen wir leider nicht');
    expect(response.text).toContain('Koleston Perfect'); // grounded house alternative
  });

  it('A: an unstocked brand with a range-priced house alternative reads grammatically (no "für von")', async () => {
    // Range priceText reads "von X bis Y"; the brand alternative must not produce
    // "für von 12 Euro bis 17 Euro" (real smoke 2026-06-16) — append with a comma.
    const rangeSearch = (text: string) =>
      /shampoo/i.test(text)
        ? [{ productId: 'glanz', spokenName: 'Glanz-Shampoo', shortName: 'Glanz-Shampoo', productType: 'Shampoo', priceText: 'von 12,00 Euro bis 17,00 Euro', score: 4, categoryHit: true, typeHit: true, priceValue: null }]
        : [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Habt ihr Shampoo von Wella?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'should not be used' },
      catalogSearch: rangeSearch,
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(response.text).toContain('führen wir leider nicht');
    expect(response.text).toContain('Glanz-Shampoo, von 12,00 Euro bis 17,00 Euro');
    expect(response.text).not.toContain('für von');
  });

  it('B: the recommender states the price gender-neutrally ("Das kostet", never "Es kostet")', async () => {
    // "die Haarmaske" is feminine — "Es kostet" was a genus slip (real smoke 2026-06-16).
    const maskSearch = (text: string) =>
      /haarmaske|maske/i.test(text)
        ? [{ productId: 'volmask', spokenName: 'Volumen Haarmaske', shortName: 'Volumen Haarmaske', productType: 'Haarmaske', priceText: '22,90 Euro', score: 5, categoryHit: true, typeHit: true, priceValue: null }]
        : [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Habt ihr Haarmasken?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'should not be used' },
      catalogSearch: maskSearch,
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(response.text).toContain('Da kann ich Ihnen Volumen Haarmaske empfehlen');
    expect(response.text).toContain('Das kostet 22,90 Euro');
    expect(response.text).not.toContain('Es kostet');
  });

  it('B: declining a pending SMS offer ("nein danke, alles gut") winds down, never re-offers', async () => {
    // Real battery 2026-06-16: a wave-off after the link offer reached the model,
    // which RE-OFFERED the link. SMS-confirm only handled YES, and SMALLTALK_NEGATION
    // is vetoed while an offer is pending — so a decline must wind down here.
    const offered = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Da kann ich Ihnen Glanz-Shampoo empfehlen. Soll ich Ihnen den Link zu Glanz-Shampoo per SMS schicken?',
      lastAgentQuestion: 'Soll ich Ihnen den Link zu Glanz-Shampoo per SMS schicken?',
      lastProduct: { spokenName: 'Glanz-Shampoo', productId: 'gs', productKind: 'Shampoo' },
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Nein danke, alles gut'),
      memory: offered,
      client: { complete: async () => { modelCalls += 1; return 'Möchten Sie den Link?'; } },
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
      catalogSearch: () => [],
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Alles klar');
    expect(response.text).not.toMatch(/link|sms/i); // never re-offers the link
  });

  it('B: "passt, brauche ich nicht" also declines a pending SMS offer (no re-offer)', async () => {
    const offered = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Soll ich Ihnen den Link zu Glanz-Shampoo per SMS schicken?',
      lastAgentQuestion: 'Soll ich Ihnen den Link zu Glanz-Shampoo per SMS schicken?',
      lastProduct: { spokenName: 'Glanz-Shampoo', productId: 'gs', productKind: 'Shampoo' },
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Passt, brauche ich nicht'),
      memory: offered,
      client: { complete: async () => { modelCalls += 1; return 'Möchten Sie den Link?'; } },
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
      catalogSearch: () => [],
    });
    expect(modelCalls).toBe(0);
    expect(response.text).not.toMatch(/link|sms/i);
  });

  it('B: a YES to a pending SMS offer still sends (decline branch does not swallow it)', async () => {
    const offered = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Soll ich Ihnen den Link zu Glanz-Shampoo per SMS schicken?',
      lastAgentQuestion: 'Soll ich Ihnen den Link zu Glanz-Shampoo per SMS schicken?',
      lastProduct: { spokenName: 'Glanz-Shampoo', productId: 'gs', productKind: 'Shampoo' },
    });
    let sent = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, gerne'),
      memory: offered,
      client: { complete: async () => 'should not be used' },
      evidenceLookup: { byId: () => null, byKeyHash: () => ({ url: 'https://drkalla.com/p/gs' }) } as never,
      catalogSearch: () => [],
      executeSendLink: async () => { sent += 1; return { smsSent: true }; },
    });
    expect(sent).toBe(1);
    expect(response.text).not.toContain('Alles klar, dann schicke ich nichts');
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
      event: turn('Haben Sie da noch andere Haarfarben?'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'Wir haben noch weitere Haarfarben im Sortiment.'; } },
      catalogSearch: (t: string) => (/haarfarbe/i.test(t) ? [
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

  it('B: a care need ("Pflege") never recommends a Blondierung/bleach chemical', async () => {
    // Real call 2026-06-15: "lieber eine Pflege" -> Blondierungspulver Blau,
    // because the catalog "Haarpflege" productType mixes bleach into care.
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio', turnIndex: 1, text: 'Ich suche eine Pflege.', audioState: 'heard',
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ich suche eine Pflege.'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'unused'; } },
      catalogSearch: (t: string) => (/pflege/i.test(t) ? [
        { productId: 'bleach', spokenName: 'Blondierungspulver Blau & Aufhellung', shortName: 'Blondierungspulver Blau', productType: 'Haarpflege', priceText: '0,99 Euro', priceValue: 0.99, score: 4, categoryHit: true, typeHit: true },
        { productId: 'mask', spokenName: 'Pflegemaske Trockenes', shortName: 'Pflegemaske', productType: 'Haarpflege', priceText: '8,40 Euro', priceValue: 8.4, score: 4, categoryHit: true, typeHit: true },
      ] : []),
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(modelCalls).toBe(0);
    expect(response.text).not.toMatch(/Blondierung/i);
    expect(response.text).toContain('Pflegemaske');
  });

  it('B: a genuine Blondierung request still returns the bleach (colorIntent bypasses the care filter)', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ich brauche eine Blondierung.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'unused' },
      catalogSearch: (t: string) => (/blondier/i.test(t) ? [
        { productId: 'bleach', spokenName: 'Blondierungspulver Blau', shortName: 'Blondierungspulver Blau', productType: 'Blondierung', priceText: '1 Euro', priceValue: 1, score: 4, categoryHit: true, typeHit: true },
      ] : []),
      evidenceLookup: { byId: () => null, byKeyHash: () => null } as never,
    });
    expect(response.text).toContain('Blondierungspulver');
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

  it('B: a "nein" right after an SMS offer winds down deterministically (no model, no re-offer)', async () => {
    // Updated 2026-06-16: previously this fell to the model, which RE-OFFERED the
    // link (real battery). The SMS-confirm decline branch now owns the turn — the
    // smalltalk ack is still vetoed by the pending offer, but the decline path
    // handles it deterministically without ever re-offering.
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Nein.'),
      memory: smsOfferMemory(),
      client: { complete: async () => { modelCalls += 1; return 'Möchten Sie den Link doch?'; } },
    });

    expect(modelCalls).toBe(0);
    expect(response.metrics.extraLlmCalls).toBe(0);
    expect(response.text).not.toMatch(/link|sms/i);
    expect(response.text).toContain('Alles klar');
  });
});

describe('DrKalla knowledge-chunk grounding injection (additive, model-path only)', () => {
  const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 };
  const noEvidence = { byId: () => null, byKeyHash: () => null } as never;
  const kbHit = (text: string, title = 'Widerruf und Rueckgabe') => () => ({
    hits: [{ chunkId: 'page:1', sourceId: 'page:1', sourceTitle: title, category: 'policies', text, score: 3 }],
    confidence: 0.8,
  });

  it('injects source-labeled grounding on a knowledge question (no product, no catalog, no FAQ)', async () => {
    let captured = '';
    let hookCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was passiert bei einer Reklamation?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { captured = system; return 'Sie haben ein Widerrufsrecht von vierzehn Tagen.'; } },
      catalogSearch: () => [],
      faqMatch: () => null,
      knowledgeRetriever: kbHit('Sie haben ein gesetzliches Widerrufsrecht von vierzehn Tagen.'),
      onKnowledgeChunk: () => { hookCalls += 1; },
      evidenceLookup: noEvidence,
    });
    expect(captured).toContain('Wissens-Beleg');
    expect(captured).toContain('Widerruf und Rueckgabe');
    expect(captured).toContain('erfinde nichts'); // anti-hallucination instruction present
    expect(hookCalls).toBe(1);
    expect(response.text).toBeTruthy();
  });

  it('does NOT inject knowledge grounding when the catalog already grounded the turn (catalog wins)', async () => {
    let captured = '';
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was ist besser für trockenes Haar?'), // NEED_VETO -> model, with catalog hits
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { captured = system; return 'Eine reichhaltige Pflegemaske ist ideal.'; } },
      catalogSearch: (t: string) => (/haar|pflege|trocken/i.test(t)
        ? [{ productId: 'm', spokenName: 'Pflegemaske', shortName: 'Pflegemaske', productType: 'Haarmaske', priceText: '9,00 Euro', priceValue: 9, score: 4, categoryHit: true, typeHit: true }]
        : []),
      faqMatch: () => null,
      knowledgeRetriever: () => { throw new Error('knowledgeRetriever must not run when catalog grounded'); },
      evidenceLookup: noEvidence,
    });
    expect(captured).toContain('Katalog-Treffer zum Bedarf'); // the injected line (not the base directive mention)
    expect(captured).not.toContain('Wissens-Beleg');
  });

  it('adds no grounding when retrieval is below confidence (returns null)', async () => {
    let captured = '';
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Erzählen Sie mir bitte einen Witz'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { captured = system; return 'Gerne!'; } },
      catalogSearch: () => [],
      faqMatch: () => null,
      knowledgeRetriever: () => null,
      evidenceLookup: noEvidence,
    });
    expect(captured).not.toContain('Wissens-Beleg');
  });

  it('a curated FAQ answer still wins before the knowledge layer (no model, no injection)', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Wie sind eure Versandkosten?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'should not be used'; } },
      catalogSearch: () => [],
      faqMatch: () => ({ id: 'versand', answer: 'Der Versand ist ab dreißig Euro kostenlos.', tags: ['versand'] }),
      knowledgeRetriever: () => { throw new Error('FAQ must short-circuit before the knowledge layer'); },
      evidenceLookup: noEvidence,
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Versand');
  });

  it('a how-to/usage question grounds from the knowledge layer instead of pitching a product', async () => {
    // "Wie trage ich eine Haarmaske auf?" used to pitch a product (NEED_VETO's
    // trag\b missed the inflected "trage"). Now it suppresses the catalog pitch and
    // grounds from the knowledge layer so the model can explain the application.
    let captured = '';
    let kbHook = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Wie trage ich eine Haarmaske richtig auf?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { captured = system; return 'Tragen Sie die Maske ins handtuchtrockene Haar und lassen Sie sie einwirken.'; } },
      catalogSearch: (t: string) => (/haarmaske|maske/i.test(t)
        ? [{ productId: 'm', spokenName: 'Volumen Haarmaske', shortName: 'Volumen Haarmaske', productType: 'Haarmaske', priceText: '22,90 Euro', priceValue: 22.9, score: 5, categoryHit: true, typeHit: true }]
        : []),
      faqMatch: () => null,
      knowledgeRetriever: kbHit('Die Haarmaske nach der Waesche ins handtuchtrockene Haar geben, einige Minuten einwirken lassen, dann ausspuelen.', 'Pflegende Haarmaske'),
      onKnowledgeChunk: () => { kbHook += 1; },
      evidenceLookup: noEvidence,
    });
    expect(response.text).not.toContain('Da kann ich Ihnen');     // NOT a product pitch
    expect(captured).toContain('Wissens-Beleg');                  // grounded from the KB
    expect(captured).not.toContain('Katalog-Treffer zum Bedarf'); // catalog injection suppressed for how-to
    expect(kbHook).toBe(1);
  });

  it('owner-published knowledge (knowledgePriority) grounds even when the catalog has weak hits', async () => {
    // A service/knowledge question can coincidentally tag-match a product; published
    // knowledge must still ground it instead of being shadowed by the catalog.
    let captured = '';
    let kbHook = 0;
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Bietet ihr einen Reparatur-Service an?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { captured = system; return 'Ja, wir reparieren.'; } },
      // Weak catalog hit (categoryHit only, no typeHit) — would normally shadow KB.
      catalogSearch: () => [{ productId: 'x', spokenName: 'Ersatzteil', shortName: 'Ersatzteil', productType: 'Zubehör', priceText: '5,00 Euro', priceValue: 5, score: 2, categoryHit: true, typeHit: false }],
      faqMatch: () => null,
      knowledgeRetriever: kbHit('Wir bieten einen Reparatur-Service; die Bearbeitung dauert etwa zehn Werktage.', 'Reparatur-Service'),
      knowledgePriority: true,
      onKnowledgeChunk: () => { kbHook += 1; },
      evidenceLookup: noEvidence,
    });
    expect(captured).toContain('Wissens-Beleg');
    expect(captured).toContain('Reparatur-Service');
    expect(kbHook).toBe(1);
  });

  it('a SERVICE question routes to knowledge even with a product word ("Föhn ... Reparatur")', async () => {
    // "reparatur" also lives in DRKALLA_CARE_INTENT, so without the service veto a
    // repair question with "Föhn" gets hijacked into a product pitch. It must route
    // to the knowledge/FAQ layer instead.
    let captured = '';
    let kbHook = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Kann ich einen defekten Föhn zur Reparatur einschicken?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { captured = system; return 'Ja, das Einschicken ist möglich.'; } },
      catalogSearch: (t: string) => (/föhn|foehn|haartrockner/i.test(t)
        ? [{ productId: 'f', spokenName: 'Haartrockner', shortName: 'Haartrockner', productType: 'Haartrockner', priceText: '29,90 Euro', priceValue: 29.9, score: 5, categoryHit: true, typeHit: true }]
        : []),
      faqMatch: () => null,
      knowledgeRetriever: kbHit('Defekte Geräte können kostenlos zur Reparatur eingeschickt werden; die Bearbeitung dauert etwa zehn Werktage.', 'Reparatur-Service'),
      onKnowledgeChunk: () => { kbHook += 1; },
      evidenceLookup: noEvidence,
    });
    expect(response.text).not.toContain('Da kann ich Ihnen');     // not a product pitch
    expect(captured).not.toContain('Katalog-Treffer zum Bedarf'); // catalog suppressed
    expect(captured).toContain('Wissens-Beleg');                  // grounded from knowledge
    expect(kbHook).toBe(1);
  });

  it('a clear PRODUCT question still hits the catalog (service routing does not over-veto)', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Habt ihr Shampoo?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'should not be used' },
      catalogSearch: (t: string) => (/shampoo/i.test(t)
        ? [{ productId: 's', spokenName: 'Glanz-Shampoo', shortName: 'Glanz-Shampoo', productType: 'Shampoo', priceText: '12,90 Euro', priceValue: 12.9, score: 5, categoryHit: true, typeHit: true }]
        : []),
      faqMatch: () => null,
      knowledgeRetriever: () => { throw new Error('knowledge layer must not run for a clean product question'); },
      evidenceLookup: noEvidence,
    });
    expect(response.text).toContain('Da kann ich Ihnen Glanz-Shampoo empfehlen'); // catalog need-reply still wins
  });
});
