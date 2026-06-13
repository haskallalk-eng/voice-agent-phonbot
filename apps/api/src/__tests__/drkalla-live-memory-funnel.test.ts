import { describe, expect, it } from 'vitest';
import {
  buildDrkallaCustomLlmResponse,
  DRKALLA_PROFI_LINK_QUESTION,
  DRKALLA_PROFI_PRICE_DISCLOSURE,
} from '../drkalla-custom-llm-responder.js';
import {
  buildDrkallaProductNameDetector,
  type DrkallaProductNameEntry,
} from '../drkalla-product-name-detector.js';
import {
  createDrkallaShortTermMemory,
  nextDrkallaProductFunnelAction,
  nextInaudibleRepair,
  reduceDrkallaShortTermMemory,
  type DrkallaShortTermVoiceMemory,
} from '../drkalla-short-term-memory.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { AgentTurnRequestedEvent } from '../voice-runtime-contract.js';

const CATALOG: DrkallaProductNameEntry[] = [
  {
    productId: 'synthesis-color-cream',
    spokenName: 'Synthesis Color Cream',
    productKind: 'Haarfarbe/Farbcreme',
    aliases: ['Synthesis Color Cream', 'Synthesis Farbcreme'],
  },
  {
    productId: 'luxe-oel-serum',
    spokenName: 'Luxe-Oel Serum',
    productKind: 'Serum',
    aliases: ['Luxe-Oel Serum'],
  },
];
const detectProducts = buildDrkallaProductNameDetector(CATALOG);
const CANARY = {
  enabled: true,
  allowModelDirectives: true,
  allowLiveRollout: false,
  maxDirectiveChars: 650,
};
const trustedScope = createTrustedScope({
  orgId: 'org-1',
  tenantId: 'tenant-1',
  agentId: 'agent-drkalla',
  callId: 'call-1',
  source: 'server',
  resolvedFrom: 'call_registry',
});

function liveTurn(currentUserText: string, sequence: number): AgentTurnRequestedEvent {
  return {
    type: 'AgentTurnRequested',
    eventId: `event-${sequence}`,
    traceId: `trace-${sequence}`,
    trustedScope,
    provider: 'retell',
    channel: 'voice',
    providerCallId: 'call-1',
    responseId: `response-${sequence}`,
    sequence,
    occurredAt: '2026-06-13T10:00:00.000Z',
    receivedAt: '2026-06-13T10:00:00.100Z',
    currentUserText,
  };
}

async function liveExchange(input: {
  memory: DrkallaShortTermVoiceMemory;
  userText: string;
  sequence: number;
  modelText?: string;
}) {
  return buildDrkallaCustomLlmResponse({
    canary: CANARY,
    event: liveTurn(input.userText, input.sequence),
    memory: input.memory,
    client: { complete: async () => input.modelText ?? '' },
    detectProducts,
  });
}

function heard(text: string, turnIndex = 1) {
  return reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
    type: 'user_audio',
    turnIndex,
    text,
    audioState: 'heard' as const,
  });
}

describe('DrKalla end-call strictness (A: old failures, B: fixed behavior)', () => {
  it('B: explicit "do not hang up" requests are never farewell end-call candidates', () => {
    // A-red evidence: before the NOT-farewell guard these texts matched the
    // unanchored FAREWELL regex ("leg auf" / "das war's") and produced
    // endCallEligible=true with reason caller_farewell.
    const cases = [
      'Bitte leg nicht auf, ich habe noch eine Frage.',
      'Nicht auflegen, warte mal kurz.',
      'Nein, das war’s noch nicht.',
      'Das war noch nicht alles.',
    ];
    for (const text of cases) {
      const memory = heard(text);
      expect(memory.endCallEligible, text).toBe(false);
      expect(memory.endCallReason, text).toBeNull();
    }
  });

  it('B: a farewell followed by an open question stays on the line', () => {
    const memory = heard('Tschüss, oder soll ich noch was bestellen?');
    expect(memory.endCallEligible).toBe(false);
  });

  it('B: clear goodbyes and explicit hang-up requests remain end-call eligible', () => {
    for (const text of ['Tschüss!', 'Auf Wiederhören.', 'Du kannst auflegen.', 'Beende den Anruf bitte.']) {
      const memory = heard(text);
      expect(memory.endCallEligible, text).toBe(true);
      expect(memory.endCallReason, text).toBe('caller_farewell');
    }
  });
});

describe('DrKalla inaudible repair ladder (spec wording)', () => {
  it('B: first consecutive inaudible turn answers exactly "Wie bitte?"', () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio',
      turnIndex: 1,
      text: '(inaudible speech)',
      audioState: 'inaudible',
    });
    expect(memory.inaudibleStreak).toBe(1);
    expect(nextInaudibleRepair(memory)).toBe('Wie bitte?');
  });

  it('B: second consecutive inaudible turn says it was acoustically not understood', () => {
    // A-red evidence: without context the second step used to be
    // "Sag bitte nur ein Stichwort: ..." without the required sentence.
    let memory = createDrkallaShortTermMemory();
    for (let i = 1; i <= 2; i += 1) {
      memory = reduceDrkallaShortTermMemory(memory, {
        type: 'user_audio',
        turnIndex: i,
        text: '(inaudible speech)',
        audioState: 'inaudible',
      });
    }
    expect(memory.inaudibleStreak).toBe(2);
    expect(nextInaudibleRepair(memory)).toContain('Ich habe es akustisch nicht verstanden.');
  });

  it('B: third consecutive inaudible turn asks for louder, clearer repetition', () => {
    let memory = createDrkallaShortTermMemory();
    for (let i = 1; i <= 3; i += 1) {
      memory = reduceDrkallaShortTermMemory(memory, {
        type: 'user_audio',
        turnIndex: i,
        text: '(inaudible speech)',
        audioState: 'inaudible',
      });
    }
    expect(memory.inaudibleStreak).toBe(3);
    const repair = nextInaudibleRepair(memory);
    expect(repair).toContain('Verbindung');
    expect(repair).toMatch(/lauter/i);
  });

  it('B: inaudible turns never become end-call candidates at any streak depth', () => {
    let memory = createDrkallaShortTermMemory();
    for (let i = 1; i <= 5; i += 1) {
      memory = reduceDrkallaShortTermMemory(memory, {
        type: 'user_audio',
        turnIndex: i,
        text: '(inaudible speech)',
        audioState: 'inaudible',
      });
      expect(memory.endCallEligible).toBe(false);
    }
  });
});

describe('DrKalla live funnel: memory is written by real turns, not test fixtures', () => {
  // A-red evidence (review finding): before this change no live code path
  // produced agent_spoke events, so lastMentionedProduct stayed null in real
  // calls and every price/link turn reset to generic discovery.
  it('B: a user naming a product moves the funnel to product level in the same turn', async () => {
    const response = await liveExchange({
      memory: createDrkallaShortTermMemory(),
      userText: 'Was kostet die Synthesis Color Cream?',
      sequence: 1,
    });

    expect(response.memory.lastMentionedProduct?.spokenName).toBe('Synthesis Color Cream');
    // First non-perfume price turn: canonical disclosure + SMS link choice.
    expect(response.text).toContain(DRKALLA_PROFI_PRICE_DISCLOSURE);
    expect(response.text).toContain(DRKALLA_PROFI_LINK_QUESTION);
    expect(response.text).not.toContain('Produktkategorie');
    expect(response.memory.profiPriceDisclosureGiven).toBe(true);
  });

  it('B: the Profi disclosure is not repeated on the next price question', async () => {
    const first = await liveExchange({
      memory: createDrkallaShortTermMemory(),
      userText: 'Was kostet die Synthesis Color Cream?',
      sequence: 1,
    });
    const second = await liveExchange({
      memory: first.memory,
      userText: 'Und was kostet sie im Angebot?',
      sequence: 2,
    });

    expect(second.text).not.toContain(DRKALLA_PROFI_PRICE_DISCLOSURE);
    expect(second.text).toContain('Synthesis Color Cream');
    expect(second.text).toContain('SMS');
  });

  it('B: model-spoken product facts are remembered per product across live turns', async () => {
    const first = await liveExchange({
      memory: createDrkallaShortTermMemory(),
      userText: 'Erzähl mir was über die Synthesis Color Cream.',
      sequence: 1,
      modelText: 'Die Synthesis Color Cream kostet laut Shop-Datenstand 9,99 Euro bei 100 ml.',
    });

    const state = first.memory.productConversations[
      Object.keys(first.memory.productConversations)[0] as string
    ];
    expect(first.memory.lastMentionedProduct?.spokenName).toBe('Synthesis Color Cream');
    expect(state?.facts.price).toBe(true);
    expect(state?.facts.size).toBe(true);
  });

  it('B: two discussed products enable comparison instead of category reset', async () => {
    const first = await liveExchange({
      memory: createDrkallaShortTermMemory(),
      userText: 'Was ist das Luxe-Oel Serum?',
      sequence: 1,
      modelText: 'Das Luxe-Oel Serum pflegt die Spitzen.',
    });
    const second = await liveExchange({
      memory: first.memory,
      userText: 'Und die Synthesis Color Cream?',
      sequence: 2,
      modelText: 'Die Synthesis Color Cream ist unsere Farbcreme.',
    });
    const comparison = await liveExchange({
      memory: second.memory,
      userText: 'Was ist der Unterschied?',
      sequence: 3,
    });

    expect(comparison.text).toContain('Luxe-Oel Serum');
    expect(comparison.text).toContain('Synthesis Color Cream');
    expect(comparison.text).not.toContain('Produktkategorie');
  });

  it('B: the repair prompt stays anchored to the live product context', async () => {
    const first = await liveExchange({
      memory: createDrkallaShortTermMemory(),
      userText: 'Was kostet die Synthesis Color Cream?',
      sequence: 1,
    });
    const inaudibleOnce = await liveExchange({
      memory: first.memory,
      userText: '(inaudible speech)',
      sequence: 2,
    });
    const inaudibleTwice = await liveExchange({
      memory: inaudibleOnce.memory,
      userText: '(inaudible speech)',
      sequence: 3,
    });

    expect(inaudibleOnce.text).toBe('Wie bitte?');
    expect(inaudibleTwice.text).toContain('Ich habe es akustisch nicht verstanden.');
    expect(inaudibleTwice.text).toContain('Synthesis Color Cream');
    expect(inaudibleTwice.metrics.extraLlmCalls).toBe(0);
  });
});

describe('DrKalla Profi price re-ask funnel', () => {
  it('B: an explicit Profi-price question reopens the Profi link offer after the one-time disclosure', () => {
    // A-red evidence: after profiPriceDisclosureGiven the funnel returned
    // offer_product_link even for explicit Profi questions.
    const withProduct = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Die Synthesis Color Cream kostet laut Shop-Datenstand 9,99 Euro.',
      lastProduct: {
        spokenName: 'Synthesis Color Cream',
        productId: 'synthesis-color-cream',
        productKind: 'Haarfarbe/Farbcreme',
      },
      profiPriceDisclosureGiven: true,
    });
    expect(withProduct.profiPriceDisclosureGiven).toBe(true);
    expect(nextDrkallaProductFunnelAction(withProduct, 'Was kostet die nochmal?')).toBe('offer_product_link');
    expect(nextDrkallaProductFunnelAction(withProduct, 'Und was ist mit Profi-Preisen?')).toBe('offer_product_or_profi_link');
    expect(nextDrkallaProductFunnelAction(withProduct, 'Wie komme ich an den Profi-Zugang?')).toBe('offer_product_or_profi_link');
  });
});
