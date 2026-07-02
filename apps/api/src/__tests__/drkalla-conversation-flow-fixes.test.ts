/**
 * Regression tests for the 2026-07 conversation-flow hardening, built from the
 * REAL failing calls (transcripts pulled 2026-07-02): wind-down loop, silence
 * reminder resurrecting declined topics, hair-profile memory, referent theft,
 * frustration re-pitch, multi-class enumeration, send-promise claims, combined
 * send+farewell intents, "(unintelligible audio)" marker, template variation.
 */
import { describe, expect, it } from 'vitest';
import { buildDrkallaCustomLlmResponse } from '../drkalla-custom-llm-responder.js';
import {
  createDrkallaShortTermMemory,
  nextDrkallaNoInputReminder,
  reduceDrkallaShortTermMemory,
} from '../drkalla-short-term-memory.js';
import {
  buildRetellDrkallaCustomLlmWsReply,
  buildDrkallaSendOfferQuestion,
  rewriteDrkallaSendPromise,
} from '../retell-drkalla-custom-llm-ws.js';
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

const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 };

function turn(currentUserText: string, sequence = 0): AgentTurnRequestedEvent {
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
    occurredAt: '2026-07-02T10:00:00.000Z',
    receivedAt: '2026-07-02T10:00:00.100Z',
    currentUserText,
    sequence,
  };
}

const noEvidence = { byId: () => null, byKeyHash: () => null } as never;

type StubHit = {
  productId: string; spokenName: string; shortName: string; productType: string | null;
  priceText: string | null; priceValue: number | null; score: number; categoryHit: boolean; typeHit: boolean;
};
function hit(id: string, name: string, type: string, price: number, score = 4): StubHit {
  return {
    productId: id, spokenName: name, shortName: name, productType: type,
    priceText: `${price} Euro`, priceValue: price, score, categoryHit: true, typeHit: true,
  };
}

describe('wind-down escalation (live 2026-06-30: four identical "Kann ich Ihnen sonst noch weiterhelfen?")', () => {
  function woundDownMemory() {
    return reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 3,
      text: 'Alles klar. Kann ich Ihnen sonst noch weiterhelfen?',
      lastAgentQuestion: 'Kann ich Ihnen sonst noch weiterhelfen?',
      windDown: true,
    });
  }

  it('first bare Nein winds down; the SECOND Nein says goodbye and hangs up', async () => {
    const first = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Nein.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'unused' },
    });
    expect(first.text).toContain('sonst noch');
    expect(first.endCall).not.toBe(true);
    expect(first.memory.windDownStreak).toBe(1);

    const second = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Nein.'),
      memory: woundDownMemory(),
      client: { complete: async () => 'unused' },
    });
    expect(second.endCall).toBe(true);
    expect(second.text).toContain('Auf Wiederhören');
  });

  it('a bare danke after our wind-down question also closes the call gracefully', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Danke.'),
      memory: woundDownMemory(),
      client: { complete: async () => 'unused' },
    });
    expect(response.endCall).toBe(true);
    expect(response.text).toContain('Auf Wiederhören');
  });

  it('a content question after the wind-down resets the streak (no premature hangup)', async () => {
    const memory = reduceDrkallaShortTermMemory(woundDownMemory(), {
      type: 'user_audio', turnIndex: 4, text: 'Doch, eine Frage: haben Sie Shampoo?', audioState: 'heard',
    });
    expect(memory.windDownStreak).toBe(0);
    expect(memory.topicClosed).toBe(false);
  });
});

describe('silence reminder must not resurrect a declined topic (live 2026-06-30)', () => {
  it('topicClosed reminder offers a graceful exit instead of the declined product', () => {
    const declined = reduceDrkallaShortTermMemory(
      reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
        type: 'agent_spoke',
        turnIndex: 2,
        text: 'Black Professional Line Sintesis kostet 9 Euro.',
        lastProduct: { spokenName: 'Black Professional Line Sintesis', productId: 'bpl', productKind: 'Haarfarbe' },
      }),
      { type: 'agent_spoke', turnIndex: 3, text: 'Alles klar, dann schicke ich nichts. Kann ich sonst noch etwas für Sie tun?', windDown: true },
    );
    const reminder = nextDrkallaNoInputReminder(declined, 1);
    expect(reminder).not.toContain('Black Professional');
    expect(reminder).toContain('schönen Tag');
  });

  it('ws reminder after a wound-down call says goodbye with end_call on the second nudge', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke', turnIndex: 3, text: 'Alles klar. Kann ich Ihnen sonst noch weiterhelfen?', windDown: true,
    });
    const reply = await buildRetellDrkallaCustomLlmWsReply({
      enabled: true,
      secretAccepted: true,
      rawMessage: JSON.stringify({ interaction_type: 'reminder_required', response_id: 11 }),
      memory,
      complete: async () => 'darf nicht laufen',
      noInputReminderCount: 2,
    });
    expect(reply?.end_call).toBe(true);
    expect(reply?.content).toContain('Auf Wiederhören');
  });

  it('ws reminder without a wound-down call never ends the call', async () => {
    const reply = await buildRetellDrkallaCustomLlmWsReply({
      enabled: true,
      secretAccepted: true,
      rawMessage: JSON.stringify({ interaction_type: 'reminder_required', response_id: 12 }),
      memory: createDrkallaShortTermMemory(),
      complete: async () => 'darf nicht laufen',
      noInputReminderCount: 2,
    });
    expect(reply?.end_call).toBe(false);
  });
});

describe('caller hair profile steers later product picks (live 2026-06-27 + 2026-07-02)', () => {
  it('persists "lockige Haare" and enriches a later Shampoo search with it', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio', turnIndex: 1, text: 'Ich brauch Produkte, weil ich ziemlich lockige Haare habe.', audioState: 'heard',
    });
    expect(memory.callerNeeds.map((n) => n.label)).toContain('lockige');

    const queries: string[] = [];
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ich möchte ein Shampoo kaufen.'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'unused'; } },
      catalogSearch: (q: string) => {
        queries.push(q);
        return /shampoo/i.test(q)
          ? [hit('locken-shampoo', 'Locken Shampoo', 'Locken Shampoo', 8, 6), hit('glanz-shampoo', 'Glanz-Shampoo', 'Glanz Shampoo', 12, 4)]
          : [];
      },
      evidenceLookup: noEvidence,
    });
    expect(modelCalls).toBe(0);
    expect(queries.some((q) => q.includes('lockige'))).toBe(true);
    expect(response.text).toContain('Locken Shampoo');
  });

  it('the hair profile survives a product-type switch (Shampoo -> Maske)', () => {
    let memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio', turnIndex: 1, text: 'Ich habe lockige Haare und suche ein Shampoo.', audioState: 'heard',
    });
    memory = reduceDrkallaShortTermMemory(memory, {
      type: 'user_audio', turnIndex: 2, text: 'Habt ihr auch eine Maske?', audioState: 'heard',
    });
    expect(memory.callerNeeds.map((n) => n.label)).toContain('lockige');
  });
});

describe('frustration/meta turns are never answered with a pitch (live 2026-06-30)', () => {
  it('"wie oft fragst du denn nach Link" goes to the model, not the recommender', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio', turnIndex: 1, text: 'Ich suche eine Haarfarbe.', audioState: 'heard',
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Wie oft fragst Du denn bitte nach Link. Ist ja wirklich krank.'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'Entschuldigen Sie bitte, ich wollte nicht drängen.'; } },
      catalogSearch: () => [hit('f', 'Haarfarbe Ammoniakfrei', 'Haarfarbe und Blondierung', 4)],
      evidenceLookup: noEvidence,
    });
    expect(modelCalls).toBe(1);
    expect(response.text).not.toContain('empfehlen');
  });

  it('a short rant fragment does not fuse the remembered category into a pitch', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio', turnIndex: 1, text: 'Ich suche eine Haarfarbe.', audioState: 'heard',
    });
    let modelCalls = 0;
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ist ja wirklich hecheloskrank.'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'ok'; } },
      // The label-only and combined searches return the SAME top score — the
      // rant adds no catalog signal, so the fallback must not fire.
      catalogSearch: (q: string) => (/haarfarbe|farbcreme/i.test(q) ? [hit('f', 'Haarfarbe Ammoniakfrei', 'Haarfarbe und Blondierung', 4)] : []),
      evidenceLookup: noEvidence,
    });
    expect(modelCalls).toBe(1);
  });
});

describe('multi-class enumeration goes to the model (live 2026-07-02)', () => {
  it('"Shampoo oder eine Kur oder eine Maske" is a consultation, not a template pitch', async () => {
    let modelCalls = 0;
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Hat sie auch irgendwas so Flüssiges, irgend Shampoo oder eine Kur oder eine Maske oder so?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'Gern — für welchen Haartyp suchen Sie etwas?'; } },
      catalogSearch: () => [hit('g', 'Glanz-Shampoo', 'Shampoo', 12)],
      evidenceLookup: noEvidence,
    });
    expect(modelCalls).toBe(1);
  });

  it('a clear single-class request stays deterministic', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ich möchte gerne eine Haarfarbe kaufen.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'unused'; } },
      catalogSearch: () => [hit('f', 'Black Professional Line Sintesis', 'Haarfarbe und Blondierung', 9)],
      evidenceLookup: noEvidence,
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Black Professional Line Sintesis');
  });
});

describe('referent question keeps the product under discussion (live 2026-07-02)', () => {
  it('"Ist das jetzt ein Lockenshampoo?" answers about the PRIOR product and restores it in memory', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Da kann ich Ihnen Glanz-Shampoo empfehlen.',
      lastProduct: { spokenName: 'Glanz-Shampoo', productId: 'glanz-shampoo', productKind: 'Shampoo' },
    });
    let seenSystem = '';
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ist das jetzt aber ein Lockenshampoo oder was?'),
      memory,
      client: { complete: async ({ system }) => { seenSystem = system; return 'Nein, das Glanz-Shampoo ist kein reines Lockenshampoo.'; } },
      detectProducts: (text: string) => (/lockenshampoo/i.test(text)
        ? [{ spokenName: 'Locken Shampoo', productId: 'locken-shampoo', productKind: 'Locken Shampoo' }]
        : []),
      evidenceLookup: noEvidence,
    });
    expect(seenSystem).toContain('Referenz-Hinweis');
    expect(seenSystem).toContain('Glanz-Shampoo');
    expect(response.memory.lastMentionedProduct?.spokenName).toBe('Glanz-Shampoo');
  });
});

describe('send-promise rewrite (live 2026-06-29: three empty promises, no SMS)', () => {
  it('rewrites a model send-promise sentence into the compliant offer question', () => {
    const offer = 'Soll ich Ihnen den Link zu Friseurscheren per SMS schicken?';
    const { text, rewritten } = rewriteDrkallaSendPromise(
      'Ich sende Ihnen gleich den Link zu unseren Friseurscheren per SMS zu. Falls Sie weitere Fragen haben, stehe ich Ihnen gern zur Verfügung.',
      offer,
    );
    expect(rewritten).toBe(true);
    expect(text).toContain(offer);
    expect(text).not.toContain('Ich sende Ihnen gleich');
    expect(text).toContain('weitere Fragen');
  });

  it('leaves genuine offers and truthful confirmations untouched', () => {
    expect(rewriteDrkallaSendPromise('Soll ich Ihnen den Link zu X per SMS schicken?', 'ANGEBOT').rewritten).toBe(false);
    expect(rewriteDrkallaSendPromise('Erledigt, ich habe Ihnen den Produktlink zu X per SMS geschickt. Kann ich sonst noch etwas klären?', 'ANGEBOT').rewritten).toBe(false);
    expect(rewriteDrkallaSendPromise('Wenn Sie mögen, schicke ich Ihnen den Link zu X per SMS — soll ich?', 'ANGEBOT').rewritten).toBe(false);
  });

  it('builds the offer from the active product', () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Basis Schere kostet 9 Euro dreißig.',
      lastProduct: { spokenName: 'Basis Schere', productId: 'basis-schere', productKind: 'Friseur-Tool' },
    });
    expect(buildDrkallaSendOfferQuestion(memory)).toContain('Basis Schere');
  });
});

describe('combined send+farewell and compound-yes intents', () => {
  function offerMemory() {
    return reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Professionelle Haarschneidemaschine kostet 75 Euro neunzig. Soll ich Ihnen den Link zu Professionelle Haarschneidemaschine per SMS schicken?',
      lastProduct: { spokenName: 'Professionelle Haarschneidemaschine', productId: 'cut-pro', productKind: 'Friseur-Tool' },
      lastAgentQuestion: 'Soll ich Ihnen den Link zu Professionelle Haarschneidemaschine per SMS schicken?',
    });
  }
  const evidenceWithUrl = {
    byId: () => ({ url: 'https://drkalla.com/products/cut-pro', priceText: '75 Euro neunzig' }),
    byKeyHash: () => ({ url: 'https://drkalla.com/products/cut-pro', priceText: '75 Euro neunzig' }),
  } as never;

  it('"Ja, schick mir den Link und dann leg bitte auf" sends AND hangs up (live 2026-06-27)', async () => {
    let sent = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, schick mir den Link und dann leg bitte auf.'),
      memory: offerMemory(),
      client: { complete: async () => 'unused' },
      evidenceLookup: evidenceWithUrl,
      executeSendLink: async () => { sent += 1; return { smsSent: true as const }; },
    });
    expect(sent).toBe(1);
    expect(response.endCall).toBe(true);
    expect(response.text).toContain('per SMS geschickt');
    expect(response.text).toContain('Auf Wiederhören');
  });

  it('a compound "Ja, gerne. Aber was ist das genau?" sends the link AND answers the question via the model', async () => {
    let sent = 0;
    let seenSystem = '';
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, gerne. Aber was ist das genau?'),
      memory: offerMemory(),
      client: { complete: async ({ system }) => { seenSystem = system; return 'Der Link ist unterwegs. Die Maschine ist für den Dauereinsatz geeignet.'; } },
      evidenceLookup: evidenceWithUrl,
      executeSendLink: async () => { sent += 1; return { smsSent: true as const }; },
    });
    expect(sent).toBe(1);
    expect(seenSystem).toContain('Soeben ausgeführt');
    expect(Object.keys(response.memory.sentLinkHashes).length).toBe(1);
  });

  it('an aborted (superseded) turn never fires the real SMS', async () => {
    let sent = 0;
    const controller = new AbortController();
    controller.abort();
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, bitte.'),
      memory: offerMemory(),
      client: { complete: async () => 'unused' },
      evidenceLookup: evidenceWithUrl,
      executeSendLink: async () => { sent += 1; return { smsSent: true as const }; },
      signal: controller.signal,
    });
    expect(sent).toBe(0);
  });

  it('"Das hast du mir doch schon geschickt" is answered honestly from the ledger', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Das hast du mir doch schon geschickt.'),
      memory: offerMemory(),
      client: { complete: async () => 'unused' },
      evidenceLookup: evidenceWithUrl,
    });
    expect(response.text).toContain('noch kein Link rausgegangen');
    expect(response.text).toContain('?');
  });
});

describe('color-shade questions are answerable (live 2026-07-01: "Was habt ihr für Farben?" twice unanswered)', () => {
  const shadeSummary = {
    totalShades: 221,
    families: ['Schwarz', 'Braun', 'Blond', 'Rot', 'Grün'],
    spoken: 'über 220 Nuancen, zum Beispiel in Schwarz, Braun, Blond und Rot',
  };

  it('"Was habt ihr denn für Farben?" gets the deterministic shade-range answer', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio', turnIndex: 1, text: 'Habt ihr auch Haarfarben?', audioState: 'heard',
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was habt ihr denn für Farben?'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'unused'; } },
      catalogSearch: () => [hit('f', 'Haarfarbe Ammoniakfrei', 'Haarfarbe und Blondierung', 4)],
      colorShadeSummary: shadeSummary,
      evidenceLookup: noEvidence,
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Nuancen');
    expect(response.text).toContain('Fantasiefarbe');
    expect(response.text).not.toContain('empfehlen');
  });

  it('a color-direction reply ("Rot, grün.") grounds the model on the shade range', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio', turnIndex: 1, text: 'Ich suche eine Haarfarbe.', audioState: 'heard',
    });
    let seenSystem = '';
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Rot, grün.'),
      memory,
      client: { complete: async ({ system }) => { seenSystem = system; return 'In Rottönen haben wir zum Beispiel …'; } },
      catalogSearch: (q: string) => (/haarfarbe|farbcreme/i.test(q) ? [hit('f', 'Black Professional Line Sintesis', 'Haarfarbe und Blondierung', 9)] : []),
      colorShadeSummary: shadeSummary,
      evidenceLookup: noEvidence,
    });
    expect(seenSystem).toContain('Farb-Beleg');
    expect(seenSystem).toContain('Nuancen');
  });
});

describe('unintelligible-audio marker triggers the repair ladder (live 2026-06-30)', () => {
  it('"(unintelligible audio)" gets "Wie bitte?" instead of reaching the model', async () => {
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('(unintelligible audio)'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'unused'; } },
    });
    expect(modelCalls).toBe(0);
    expect(response.text).toContain('Wie bitte');
  });
});

describe('deterministic pitch varies its phrasing across turns (live: "immer wieder das Gleiche")', () => {
  const search = () => [hit('a', 'Locken Shampoo', 'Locken Shampoo', 8, 6), hit('b', 'Glanz-Shampoo', 'Shampoo', 12, 4)];

  it('two pitches at different turn indices use different lead phrasings', async () => {
    const first = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ich möchte ein Shampoo kaufen.', 0),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'unused' },
      catalogSearch: search,
      evidenceLookup: noEvidence,
    });
    const second = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ich möchte ein Shampoo kaufen.', 1),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'unused' },
      catalogSearch: search,
      evidenceLookup: noEvidence,
    });
    expect(first.text).toContain('Locken Shampoo');
    expect(second.text).toContain('Locken Shampoo');
    expect(first.text.split('.')[0]).not.toBe(second.text.split('.')[0]);
  });

  it('a product already discussed this call is never re-pitched deterministically', async () => {
    // The product was discussed at turn 2; an intervening turn cleared the
    // 1-turn lookback — the call-scoped ledger must still block the repeat.
    let memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Da kann ich Ihnen Locken Shampoo empfehlen.',
      lastProduct: { spokenName: 'Locken Shampoo', productId: 'a', productKind: 'Locken Shampoo' },
    });
    memory = reduceDrkallaShortTermMemory(memory, {
      type: 'agent_spoke', turnIndex: 3, text: 'Unsere Öffnungszeiten sind Montag bis Freitag.', lastAgentQuestion: 'Kann ich sonst helfen?',
    });
    let modelCalls = 0;
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ich möchte ein Shampoo kaufen.', 4),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'Gern, dazu hatte ich Ihnen ja das Locken Shampoo empfohlen.'; } },
      catalogSearch: search,
      evidenceLookup: noEvidence,
    });
    expect(modelCalls).toBe(1);
  });
});
