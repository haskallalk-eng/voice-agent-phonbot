import { describe, expect, it } from 'vitest';
import {
  buildDrkallaCustomLlmResponse,
  DRKALLA_PROFI_LINK_QUESTION,
  DRKALLA_PROFI_PRICE_DISCLOSURE,
  DRKALLA_SMS_NOT_WIRED_TEXT,
} from '../drkalla-custom-llm-responder.js';
import { buildDrkallaProductEvidenceLookup } from '../drkalla-product-evidence.js';
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
const evidenceLookup = buildDrkallaProductEvidenceLookup([
  {
    handle: 'synthesis-color-cream',
    title: 'Synthesis Color Cream',
    vendor: 'Dr.Kalla Cosmetics',
    productType: 'Haarfarbe/Farbcreme',
    url: 'https://drkalla.com/products/synthesis-color-cream',
    variants: [{ price: '9.99', available: true }],
  },
  {
    handle: 'luxe-oel-serum',
    title: 'Luxe-Oel Serum',
    vendor: 'Dr.Kalla Cosmetics',
    productType: 'Serum',
    url: 'https://drkalla.com/products/luxe-oel-serum',
    variants: [{ price: '12.99', available: true }],
  },
]);
// Mirrors the live route budget (800 since the evidence line was added).
const CANARY = {
  enabled: true,
  allowModelDirectives: true,
  allowLiveRollout: false,
  maxDirectiveChars: 800,
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
  withEvidence?: boolean;
}) {
  return buildDrkallaCustomLlmResponse({
    canary: CANARY,
    event: liveTurn(input.userText, input.sequence),
    memory: input.memory,
    client: { complete: async () => input.modelText ?? '' },
    detectProducts,
    evidenceLookup: input.withEvidence ? evidenceLookup : undefined,
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
    // Regression locks: most of these were already safe on 39a3da5 (the old
    // FAREWELL regex happened not to match them); the genuinely red cases on
    // 39a3da5 were the trailing-question goodbye below and the
    // "das wars... ach nein" continuation (Codex P1).
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

  it('B: a goodbye taken back in the same utterance stays on the line (Codex P1)', () => {
    // A-red evidence: "das wars... ach nein" returned endCallEligible=true.
    const cases = [
      'Das wars... ach nein.',
      'Das war alles, ach nein, eine Sache noch.',
      'Tschüss, doch nicht, ich brauche noch was.',
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

  it('B: a two-product model reply stores facts on the right products (Codex P1)', async () => {
    // A-red evidence: both facts landed on lastMentionedProduct (Synthesis)
    // and the Serum never became a recent product, breaking comparison.
    const response = await liveExchange({
      memory: createDrkallaShortTermMemory(),
      userText: 'Vergleich bitte.',
      sequence: 1,
      modelText: 'Synthesis Color Cream kostet 9 Euro. Luxe-Oel Serum hat 100 ml.',
    });

    const conversations = Object.values(response.memory.productConversations);
    const synthesis = conversations.find((entry) => entry?.spokenName === 'Synthesis Color Cream');
    const serum = conversations.find((entry) => entry?.spokenName === 'Luxe-Oel Serum');
    expect(synthesis?.facts.price).toBe(true);
    expect(synthesis?.facts.size).toBeUndefined();
    expect(serum?.facts.size).toBe(true);
    expect(serum?.facts.price).toBeUndefined();
    expect(response.memory.recentProducts.map((product) => product.spokenName).sort()).toEqual([
      'Luxe-Oel Serum',
      'Synthesis Color Cream',
    ]);
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

describe('DrKalla grounded evidence answers (catalog facts, not memory)', () => {
  it('B: the price fallback states the real catalog price with the disclosure', async () => {
    // A-red evidence: without the evidence lookup the fallback dodged to the
    // link offer and never said the actual price.
    const response = await liveExchange({
      memory: createDrkallaShortTermMemory(),
      userText: 'Was kostet die Synthesis Color Cream?',
      sequence: 1,
      withEvidence: true,
    });

    expect(response.text).toContain('kostet laut Shop-Datenstand 9,99 Euro');
    expect(response.text).toContain(DRKALLA_PROFI_PRICE_DISCLOSURE);
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it('B: the model receives a compact evidence line inside the directive budget', async () => {
    const prompts: string[] = [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: { ...CANARY, maxDirectiveChars: 800 },
      event: liveTurn('Erzähl mir was über die Synthesis Color Cream.', 1),
      memory: createDrkallaShortTermMemory(),
      client: {
        complete: async ({ system }) => {
          prompts.push(system);
          return 'Die Synthesis Color Cream ist unsere Farbcreme.';
        },
      },
      detectProducts,
      evidenceLookup,
    });

    expect(response.blocked).toBe(false);
    expect(prompts[0]).toContain('Evidence (Shop-Datenstand)');
    expect(prompts[0]).toContain('9,99 Euro');
    expect(prompts[0]).toContain('Behaupte nie, eine SMS oder einen Link bereits gesendet zu haben.');
    expect(response.metrics.directiveChars).toBeLessThanOrEqual(800);
  });
});

describe('DrKalla SMS truthfulness without a wired tool', () => {
  it('B: a confirmed SMS offer gets a truthful deterministic reply without a model call', async () => {
    // A-red evidence: the confirmation used to go to the model, which nothing
    // stopped from claiming "SMS ist raus" despite no tool execution.
    let modelCalls = 0;
    const offerTurn = await liveExchange({
      memory: createDrkallaShortTermMemory(),
      userText: 'Wie kaufe ich die Synthesis Color Cream?',
      sequence: 1,
    });
    expect(offerTurn.text).toContain('per SMS schicken?');

    const confirm = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: liveTurn('Ja bitte.', 2),
      memory: offerTurn.memory,
      client: {
        complete: async () => {
          modelCalls += 1;
          return 'SMS ist raus!';
        },
      },
      detectProducts,
    });

    expect(modelCalls).toBe(0);
    expect(confirm.text).toBe(DRKALLA_SMS_NOT_WIRED_TEXT);
    expect(confirm.metrics.extraLlmCalls).toBe(0);
    expect(confirm.text).not.toMatch(/gesendet|ist raus/i);
  });
});

describe('DrKalla streaming replies', () => {
  it('B: streamed chunks are forwarded, capped, and equal the final text', async () => {
    const chunks = ['Die Synthesis Color Cream ', 'kostet 9,99 Euro. ', 'Soll ich dir den Produktlink per SMS schicken?'];
    const received: string[] = [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: liveTurn('Was kostet die Synthesis Color Cream?', 1),
      memory: createDrkallaShortTermMemory(),
      client: {
        complete: async () => {
          throw new Error('complete must not be used when streaming is available');
        },
        completeStream: async ({ onDelta }) => {
          let full = '';
          for (const chunk of chunks) {
            full += chunk;
            onDelta(chunk);
          }
          return full;
        },
      },
      detectProducts,
      onDelta: (chunk) => received.push(chunk),
    });

    expect(received.join('')).toBe(response.text);
    expect(response.text).toBe(chunks.join(''));
    expect(response.metrics.extraLlmCalls).toBe(1);
    // The spoken reply is reduced into memory from the full streamed text.
    expect(response.memory.lastMentionedProduct?.spokenName).toBe('Synthesis Color Cream');
    expect(response.memory.profiPriceDisclosureGiven).toBe(false);
  });

  it('B: the stream is hard-capped at the output limit', async () => {
    const received: string[] = [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: liveTurn('Erzähl mir alles.', 1),
      memory: createDrkallaShortTermMemory(),
      client: {
        complete: async () => '',
        completeStream: async ({ onDelta }) => {
          const long = 'Wort '.repeat(200); // 1000 chars
          onDelta(long);
          return long;
        },
      },
      detectProducts,
      onDelta: (chunk) => received.push(chunk),
    });

    expect(received.join('').length).toBeLessThanOrEqual(420);
    expect(response.text.length).toBeLessThanOrEqual(420);
    expect(response.text.startsWith(received.join(''))).toBe(true);
  });

  it('B: an empty stream falls back deterministically with no chunks spoken', async () => {
    const received: string[] = [];
    const response = await liveExchangeStreaming({
      userText: 'Was kostet die Synthesis Color Cream?',
      received,
    });
    expect(received.join('')).toBe('');
    expect(response.text).toContain(DRKALLA_PROFI_PRICE_DISCLOSURE);
  });
});

async function liveExchangeStreaming(input: { userText: string; received: string[] }) {
  return buildDrkallaCustomLlmResponse({
    canary: CANARY,
    event: liveTurn(input.userText, 1),
    memory: createDrkallaShortTermMemory(),
    client: {
      complete: async () => '',
      completeStream: async () => '',
    },
    detectProducts,
    onDelta: (chunk) => input.received.push(chunk),
  });
}

describe('DrKalla gated SMS link executor', () => {
  async function offerThenConfirm(executor: Parameters<typeof buildDrkallaCustomLlmResponse>[0]['executeSendLink']) {
    const offer = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: liveTurn('Wie kaufe ich die Synthesis Color Cream?', 1),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
      detectProducts,
      evidenceLookup,
    });
    expect(offer.text).toContain('per SMS schicken?');
    return buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: liveTurn('Ja bitte.', 2),
      memory: offer.memory,
      client: { complete: async () => 'darf nicht laufen' },
      detectProducts,
      evidenceLookup,
      executeSendLink: executor,
    });
  }

  it('B: a confirmed offer sends through the executor and speaks the truthful success', async () => {
    const sent: Array<{ url: string; label: string }> = [];
    const confirm = await offerThenConfirm(async (link) => {
      sent.push({ url: link.url, label: link.label });
      return { smsSent: true };
    });

    expect(sent).toEqual([
      { url: 'https://drkalla.com/products/synthesis-color-cream', label: 'Synthesis Color Cream' },
    ]);
    expect(confirm.text).toContain('per SMS geschickt');
    expect(confirm.metrics.extraLlmCalls).toBe(0);
    // The sent link lands in memory so it is never sent twice.
    expect(Object.keys(confirm.memory.sentLinkHashes)).toHaveLength(1);
  });

  it('B: duplicate and failure outcomes are spoken truthfully without send claims', async () => {
    const duplicate = await offerThenConfirm(async () => ({ smsSent: false, duplicate: true }));
    expect(duplicate.text).toContain('schon geschickt');

    const failed = await offerThenConfirm(async () => ({ smsSent: false }));
    expect(failed.text).toContain('nicht geklappt');
    expect(failed.text).not.toContain('per SMS geschickt');
    expect(Object.keys(failed.memory.sentLinkHashes)).toHaveLength(0);
  });

  it('B: an explicit "Produktlink bitte" choice also triggers the executor', async () => {
    const offer = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: liveTurn('Was kostet die Synthesis Color Cream?', 1),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
      detectProducts,
      evidenceLookup,
    });
    const confirm = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: liveTurn('Den Produktlink bitte.', 2),
      memory: offer.memory,
      client: { complete: async () => 'darf nicht laufen' },
      detectProducts,
      evidenceLookup,
      executeSendLink: async () => ({ smsSent: true }),
    });
    expect(confirm.text).toContain('per SMS geschickt');
    expect(confirm.metrics.extraLlmCalls).toBe(0);
  });
});

describe('DrKalla ambiguous product names', () => {
  it('B: a duplicate catalog name asks a variant question instead of guessing', async () => {
    const { buildDrkallaAmbiguousProductNameDetector } = await import('../drkalla-product-name-detector.js');
    const detectAmbiguousProduct = buildDrkallaAmbiguousProductNameDetector([
      { productId: 'towel-small', spokenName: 'Universal Salonhandtuch', productKind: 'Salon-Verbrauchsmaterial', aliases: [] },
      { productId: 'towel-big', spokenName: 'Universal Salonhandtuch', productKind: 'Salon-Verbrauchsmaterial', aliases: [] },
    ]);
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: liveTurn('Ich suche das Universal Salonhandtuch.', 1),
      memory: createDrkallaShortTermMemory(),
      client: {
        complete: async () => {
          modelCalls += 1;
          return 'sollte nicht laufen';
        },
      },
      detectProducts,
      detectAmbiguousProduct,
    });

    expect(modelCalls).toBe(0);
    expect(response.text).toContain('mehrere Ausführungen');
    expect(response.text).toContain('Universal Salonhandtuch');
    expect(response.memory.pendingClarification?.kind).toBe('product_variant');
    expect(response.metrics.extraLlmCalls).toBe(0);
  });
});

describe('DrKalla Sie voice consistency', () => {
  it('B: deterministic customer-facing replies never use du-form', async () => {
    const replies: string[] = [];
    const offer = await liveExchange({
      memory: createDrkallaShortTermMemory(),
      userText: 'Wie kaufe ich die Synthesis Color Cream?',
      sequence: 1,
      withEvidence: true,
    });
    replies.push(offer.text);
    const price = await liveExchange({
      memory: offer.memory,
      userText: 'Und was kostet sie?',
      sequence: 2,
      withEvidence: true,
    });
    replies.push(price.text);
    const confirm = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: liveTurn('Ja bitte.', 3),
      memory: price.memory,
      client: { complete: async () => '' },
      detectProducts,
      evidenceLookup,
    });
    replies.push(confirm.text);

    for (const reply of replies) {
      expect(reply, reply).not.toMatch(/\b(?:du|dir|dich|dein|deine|deinen)\b/i);
    }
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
