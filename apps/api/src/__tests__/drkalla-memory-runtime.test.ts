import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTrustedScope } from '../trusted-scope.js';
import {
  applyDrkallaMemoryRuntimeEvent,
  createDrkallaMemoryRuntimeSession,
} from '../drkalla-memory-runtime.js';
import {
  createDrkallaShortTermMemory,
  isDrkallaMemoryLiveEffective,
  reduceDrkallaShortTermMemory,
} from '../drkalla-short-term-memory.js';
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
    providerEventId: 'event-1',
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

describe('DrKalla memory runtime bridge', () => {
  it('does not mark Retell-managed prompt mode as live-effective memory', () => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'retell_managed',
      memory: productMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn('Was kostet das?'));

    expect(result.memoryContextInjected).toBe(false);
    expect(result.memoryContext).toBeNull();
    expect(isDrkallaMemoryLiveEffective(result)).toBe(false);
  });

  it('injects bounded non-evidence memory context only in custom runtime mode', () => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: productMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn('Was kostet das?'));

    expect(result.memoryContextInjected).toBe(true);
    expect(isDrkallaMemoryLiveEffective(result)).toBe(true);
    expect(result.memoryContext).toContain('not_evidence=true');
    expect(result.memoryContext).toContain('active_product=Synthesis Color Cream');
    expect(result.memoryContext).toContain('product_facts=description,size,price');
    expect(result.memoryContext?.length).toBeLessThanOrEqual(550);
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
  });

  it('exposes the product-funnel dialogue view above retrieval/evidence context', () => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: productMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn('Wie kaufe ich das?'));

    expect(result.dialogueView.level).toBe('active_product');
    expect(result.dialogueView.nextAction).toBe('offer_product_link');
    expect(result.dialogueView.isEvidence).toBe(false);
    expect(result.dialogueView.forbiddenMoves).toContain('category_reset');
    expect(result.dialogueView.forbiddenMoves).toContain('contact_loop');
    expect(result.responsePlan.plan).toBe('offer_product_link');
    expect(result.responsePlan.mustDo).toContain('offer_specific_product_link_or_availability');
    expect(result.responsePlan.mustNotDo).toContain('offer_product_category');
  });

  it('keeps user-stated product type as live memory before a concrete product is named', () => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: createDrkallaShortTermMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn('Ich will eine Haarfarbe.'));

    expect(result.memory.activeProductType?.label).toBe('Haarfarbe/Farbcreme');
    expect(result.memoryContext).toContain('active_product_type=Haarfarbe/Farbcreme');
    expect(result.dialogueView.level).toBe('active_product_type');
    expect(result.responsePlan.mustNotDo).toContain('ask_for_category_when_type_known');
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
  });

  it('recognizes German plural product-type requests before a concrete product is named', () => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: createDrkallaShortTermMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn('Ich suche Haarfarben.'));

    expect(result.memory.activeProductType?.label).toBe('Haarfarbe/Farbcreme');
    expect(result.memoryContext).toContain('active_product_type=Haarfarbe/Farbcreme');
    expect(result.dialogueView.level).toBe('active_product_type');
    expect(result.responsePlan.mustNotDo).toContain('ask_for_category_when_type_known');
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
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
  ])('recognizes catalogue product-type voice request "%s"', (text, expectedProductType) => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: createDrkallaShortTermMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn(text));

    expect(result.memory.activeProductType?.label).toBe(expectedProductType);
    expect(result.memoryContext).toContain(`active_product_type=${expectedProductType}`);
    expect(result.dialogueView.level).toBe('active_product_type');
    expect(result.responsePlan.mustNotDo).toContain('ask_for_category_when_type_known');
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
  });

  it.each([
    ['Ich suche Shampoos.', 'Shampoo'],
    ['Habt ihr Haarmasken?', 'Haarmaske'],
    ['Ich brauche Conditioner.', 'Conditioner/Spülung'],
    ['Ich suche Leave-in Pflege.', 'Leave-in'],
    ['Habt ihr Haarserum?', 'Serum'],
  ])('keeps specific haircare product-type voice request "%s"', (text, expectedProductType) => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: createDrkallaShortTermMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn(text));

    expect(result.memory.activeProductType?.label).toBe(expectedProductType);
    expect(result.memoryContext).toContain(`active_product_type=${expectedProductType}`);
    expect(result.dialogueView.level).toBe('active_product_type');
    expect(result.responsePlan.mustNotDo).toContain('ask_for_category_when_type_known');
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
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
  ])('keeps plural tool product-type voice request "%s"', (text, expectedProductType) => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: createDrkallaShortTermMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn(text));

    expect(result.memory.activeProductType?.label).toBe(expectedProductType);
    expect(result.memoryContext).toContain(`active_product_type=${expectedProductType}`);
    expect(result.dialogueView.level).toBe('active_product_type');
    expect(result.responsePlan.mustNotDo).toContain('ask_for_category_when_type_known');
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
  });

  it.each([
    ['Habt ihr Dauerwellenlösung?', 'Styling'],
    ['Ich suche Dauerwelle.', 'Styling'],
    ['Ich brauche Dauerwellenmittel.', 'Styling'],
  ])('keeps Dauerwelle styling product-type voice request "%s"', (text, expectedProductType) => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: createDrkallaShortTermMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn(text));

    expect(result.memory.activeProductType?.label).toBe(expectedProductType);
    expect(result.memoryContext).toContain(`active_product_type=${expectedProductType}`);
    expect(result.dialogueView.level).toBe('active_product_type');
    expect(result.responsePlan.mustNotDo).toContain('ask_for_category_when_type_known');
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
  });

  it.each([
    ['Habt ihr Farbkarten?', 'Farbkarte'],
    ['Ich suche eine Farbkarte.', 'Farbkarte'],
    ['Habt ihr eine Koleston Farbkarte?', 'Farbkarte'],
  ])('keeps Farbkarte product-type voice request "%s"', (text, expectedProductType) => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: createDrkallaShortTermMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn(text));

    expect(result.memory.activeProductType?.label).toBe(expectedProductType);
    expect(result.memoryContext).toContain(`active_product_type=${expectedProductType}`);
    expect(result.dialogueView.level).toBe('active_product_type');
    expect(result.responsePlan.mustNotDo).toContain('ask_for_category_when_type_known');
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
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
  ])('keeps plural salon-equipment product-type voice request "%s"', (text, expectedProductType) => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: createDrkallaShortTermMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn(text));

    expect(result.memory.activeProductType?.label).toBe(expectedProductType);
    expect(result.memoryContext).toContain(`active_product_type=${expectedProductType}`);
    expect(result.dialogueView.level).toBe('active_product_type');
    expect(result.responsePlan.mustNotDo).toContain('ask_for_category_when_type_known');
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
  });

  it.each([
    ['Habt ihr Spitzenpapier?', 'Salon-Verbrauchsmaterial'],
    ['Ich brauche Nackenpapier.', 'Salon-Verbrauchsmaterial'],
    ['Habt ihr Friseurumhänge?', 'Salon-Verbrauchsmaterial'],
    ['Ich suche Handschuhe.', 'Salon-Verbrauchsmaterial'],
  ])('keeps salon-consumable product-type voice request "%s"', (text, expectedProductType) => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: createDrkallaShortTermMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn(text));

    expect(result.memory.activeProductType?.label).toBe(expectedProductType);
    expect(result.memoryContext).toContain(`active_product_type=${expectedProductType}`);
    expect(result.dialogueView.level).toBe('active_product_type');
    expect(result.responsePlan.mustNotDo).toContain('ask_for_category_when_type_known');
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
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
  ])('keeps catalog-backed accessory voice request "%s"', (text, expectedProductType) => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: createDrkallaShortTermMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn(text));

    expect(result.memory.activeProductType?.label).toBe(expectedProductType);
    expect(result.memoryContext).toContain(`active_product_type=${expectedProductType}`);
    expect(result.dialogueView.level).toBe('active_product_type');
    expect(result.responsePlan.mustNotDo).toContain('ask_for_category_when_type_known');
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
  });

  it('keeps inaudible speech inside memory without creating an end-call candidate', () => {
    const session = createDrkallaMemoryRuntimeSession({
      mode: 'custom_runtime',
      memory: productMemory(),
    });
    const result = applyDrkallaMemoryRuntimeEvent(session, turn('(inaudible speech)'));

    expect(result.memory.inaudibleStreak).toBe(1);
    expect(result.memory.endCallEligible).toBe(false);
    expect(result.memoryContext).toContain('inaudible_streak=1');
  });

  it('keeps the memory runtime bridge provider-neutral and free of SDK imports', () => {
    const source = readFileSync(join(__dirname, '..', 'drkalla-memory-runtime.ts'), 'utf8');

    expect(source).not.toMatch(/from ['"].*(?:retell|openai|@retell|retell-sdk)/i);
    expect(source).not.toMatch(/\b(response_required|update_only|transcript_with_tool_calls|input_audio_buffer)\b/);
  });

  it('keeps product-type alias matching in the shared detector instead of growing memory regexes', () => {
    const source = readFileSync(join(__dirname, '..', 'drkalla-short-term-memory.ts'), 'utf8');

    expect(source).toContain('detectDrkallaUserProductType');
    expect(source).not.toMatch(/\b(?:spitzenpapier|rasierpinsel|barberstuhl|spr(?:ü|ue)hflasche|watteschnur|servicewagen|haarsauger|alligatorclips)\b/i);
  });
});
