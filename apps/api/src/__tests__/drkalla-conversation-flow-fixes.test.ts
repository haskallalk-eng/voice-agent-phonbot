/**
 * Regression tests for the 2026-07 conversation-flow hardening, built from the
 * REAL failing calls (transcripts pulled 2026-07-02): wind-down loop, silence
 * reminder resurrecting declined topics, hair-profile memory, referent theft,
 * frustration re-pitch, multi-class enumeration, send-promise claims, combined
 * send+farewell intents, "(unintelligible audio)" marker, template variation.
 */
import { describe, expect, it } from 'vitest';
import { buildDrkallaContactDirective } from '../drkalla-contact-facts.js';
import { buildDrkallaCustomLlmResponse } from '../drkalla-custom-llm-responder.js';
import { buildDrkallaProductNameDetector } from '../drkalla-product-name-detector.js';
import { looksIncompleteDrkallaUtterance } from '../drkalla-turn-completeness.js';
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

describe('Profi-Link offer resolution (live test call 2026-07-03: "Ja, gerne." sent a scissors link)', () => {
  function profiOfferMemory() {
    return reduceDrkallaShortTermMemory(
      reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
        type: 'agent_spoke',
        turnIndex: 20,
        text: 'Ja, wir haben auch Scheren, zum Beispiel die Basis Schere für 9 Euro dreißig.',
        lastProduct: { spokenName: 'Basis Schere', productId: 'basis-schere', productKind: 'Friseur-Tool' },
      }),
      {
        type: 'agent_spoke',
        turnIndex: 22,
        text: 'Profi-Preise gibt es über den Profi-Zugang. Soll ich Ihnen den Profi-Link per SMS schicken?',
        lastAgentQuestion: 'Soll ich Ihnen den Profi-Link per SMS schicken?',
      },
    );
  }
  const scissorsEvidence = {
    byId: () => ({ url: 'https://drkalla.com/products/basis-schere', priceText: '9,30 Euro' }),
    byKeyHash: () => ({ url: 'https://drkalla.com/products/basis-schere', priceText: '9,30 Euro' }),
  } as never;

  it('a bare "Ja, gerne." after the Profi-Link offer sends the PROFI link, never the remembered product', async () => {
    const sends: string[] = [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, gerne.'),
      memory: profiOfferMemory(),
      client: { complete: async () => 'unused' },
      evidenceLookup: scissorsEvidence,
      executeSendLink: async ({ linkKind }) => { sends.push(linkKind); return { smsSent: true as const }; },
    });
    expect(sends).toEqual(['profi']);
    expect(response.text).toContain('Profi-Zugang');
    expect(response.text).not.toContain('Schere');
  });

  it('the reducer records a statement-form Profi offer and keeps it across a repair turn', () => {
    let memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 24,
      text: 'Verstanden, dann war das nicht der Profi-Link. Wenn Sie möchten, kann ich Ihnen den richtigen Profi-Link noch einmal per SMS schicken.',
    });
    expect(memory.pendingLinkOffer?.kind).toBe('profi');
    memory = reduceDrkallaShortTermMemory(memory, {
      type: 'agent_spoke', turnIndex: 25, text: 'Wie bitte?', lastAgentQuestion: 'Wie bitte?',
    });
    expect(memory.pendingLinkOffer?.kind).toBe('profi');
    const afterSend = reduceDrkallaShortTermMemory(memory, {
      type: 'agent_spoke', turnIndex: 26, text: 'Erledigt.', linksSent: [{ url: 'https://drkalla.com/pages/profi', label: 'Profi-Zugang' }],
    });
    expect(afterSend.pendingLinkOffer).toBeNull();
  });

  it('"Ja, schick, gerne." after a repair turn still sends the pending Profi link (offer revival)', async () => {
    let memory = reduceDrkallaShortTermMemory(profiOfferMemory(), {
      type: 'agent_spoke',
      turnIndex: 24,
      text: 'Verstanden, dann war das nicht der Profi-Link. Wenn Sie möchten, kann ich Ihnen den richtigen Profi-Link noch einmal per SMS schicken.',
      lastAgentQuestion: 'Kann ich sonst noch etwas klären?',
    });
    memory = reduceDrkallaShortTermMemory(memory, {
      type: 'agent_spoke', turnIndex: 25, text: 'Wie bitte?', lastAgentQuestion: 'Wie bitte?',
    });
    const sends: string[] = [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, schick, gerne.'),
      memory,
      client: { complete: async () => 'unused' },
      evidenceLookup: scissorsEvidence,
      executeSendLink: async ({ linkKind }) => { sends.push(linkKind); return { smsSent: true as const }; },
    });
    expect(sends).toEqual(['profi']);
    expect(response.text).toContain('Profi-Zugang');
  });

  it('an explicit "Nein, den Produktlink bitte" after a Profi offer still sends the product', async () => {
    const sends: string[] = [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Nein, den Produktlink bitte.'),
      memory: profiOfferMemory(),
      client: { complete: async () => 'unused' },
      evidenceLookup: scissorsEvidence,
      executeSendLink: async ({ linkKind }) => { sends.push(linkKind); return { smsSent: true as const }; },
    });
    expect(sends).toEqual(['product']);
  });
});

describe('duplicate-send handling (live 2026-07-03: "schon geschickt" spoken right after a fresh send)', () => {
  function productOfferMemory() {
    return reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Basis Schere kostet 9,30 Euro. Soll ich Ihnen den Link zu Basis Schere per SMS schicken?',
      lastProduct: { spokenName: 'Basis Schere', productId: 'basis-schere', productKind: 'Friseur-Tool' },
      lastAgentQuestion: 'Soll ich Ihnen den Link zu Basis Schere per SMS schicken?',
    });
  }
  const evidence = {
    byId: () => ({ url: 'https://drkalla.com/products/basis-schere', priceText: '9,30 Euro' }),
    byKeyHash: () => ({ url: 'https://drkalla.com/products/basis-schere', priceText: '9,30 Euro' }),
  } as never;

  it('a duplicate outcome with a CLEAN memory ledger is a same-turn re-run: confirm the send', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, bitte.'),
      memory: productOfferMemory(),
      client: { complete: async () => 'unused' },
      evidenceLookup: evidence,
      executeSendLink: async () => ({ smsSent: false as const, duplicate: true }),
    });
    expect(response.text).toContain('Erledigt');
    expect(response.text).not.toContain('schon geschickt');
    expect(Object.keys(response.memory.sentLinkHashes).length).toBe(1);
  });

  it('a duplicate outcome with the link in COMMITTED memory names the product honestly', async () => {
    const memory = reduceDrkallaShortTermMemory(productOfferMemory(), {
      type: 'agent_spoke',
      turnIndex: 3,
      text: 'Erledigt, ich habe Ihnen den Produktlink zu Basis Schere per SMS geschickt. Soll ich Ihnen den Link zu Basis Schere per SMS schicken?',
      lastAgentQuestion: 'Soll ich Ihnen den Link zu Basis Schere per SMS schicken?',
      linksSent: [{ url: 'https://drkalla.com/products/basis-schere', label: 'Basis Schere' }],
    });
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, bitte.'),
      memory,
      client: { complete: async () => 'unused' },
      evidenceLookup: evidence,
      executeSendLink: async () => ({ smsSent: false as const, duplicate: true }),
    });
    expect(response.text).toContain('Basis Schere');
    expect(response.text).toContain('schon geschickt');
  });
});

describe('compound-yes send is announced and never swallowed (live 2026-07-03: silent scissors SMS)', () => {
  it('"Ja, kann ich mir — habt ihr auch Profipreise?" sends, ANNOUNCES the send, and skips the FAQ path', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 20,
      text: 'Wenn Sie möchten, kann ich Ihnen auch den Link zu Basis Schere per SMS schicken. Soll ich Ihnen den Link zu Basis Schere per SMS schicken?',
      lastProduct: { spokenName: 'Basis Schere', productId: 'basis-schere', productKind: 'Friseur-Tool' },
      lastAgentQuestion: 'Soll ich Ihnen den Link zu Basis Schere per SMS schicken?',
    });
    let sent = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja, kann ich mir. Habt ihr denn auch bestimmte Preise für Friseure?'),
      memory,
      client: { complete: async () => 'Profi-Preise gibt es über den Profi-Zugang; dafür ist ein Gewerbenachweis nötig.' },
      evidenceLookup: {
        byId: () => ({ url: 'https://drkalla.com/products/basis-schere', priceText: '9,30 Euro' }),
        byKeyHash: () => ({ url: 'https://drkalla.com/products/basis-schere', priceText: '9,30 Euro' }),
      } as never,
      executeSendLink: async () => { sent += 1; return { smsSent: true as const }; },
      faqMatch: () => ({ id: 'profi', answer: 'FAQ-ANTWORT DIE DEN SEND VERSCHLUCKT', tags: [] }),
    });
    expect(sent).toBe(1);
    expect(response.text.startsWith('Den Link zu Basis Schere habe ich Ihnen gerade per SMS geschickt.')).toBe(true);
    expect(response.text).not.toContain('VERSCHLUCKT');
    expect(Object.keys(response.memory.sentLinkHashes).length).toBe(1);
  });
});

describe('info-offer acceptance describes the product, never its siblings (live 2026-07-03)', () => {
  it('"Ja." after "Darf ich Ihnen kurz mehr zu Locken Shampoo sagen?" reaches the model with the Info directive', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 2,
      text: 'Dafür passt zum Beispiel Locken Shampoo gut. Darf ich Ihnen kurz mehr zu Locken Shampoo sagen?',
      lastProduct: { spokenName: 'Locken Shampoo', productId: 'ls', productKind: 'Shampoo' },
      lastAgentQuestion: 'Darf ich Ihnen kurz mehr zu Locken Shampoo sagen?',
    });
    let seenSystem = '';
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja.'),
      memory,
      client: { complete: async ({ system }) => { modelCalls += 1; seenSystem = system; return 'Locken Shampoo pflegt lockiges Haar und definiert die Locken.'; } },
      catalogSearch: (q: string) =>
        /locken shampoo/i.test(q)
          ? [hit('ls', 'Locken Shampoo', 'Shampoo', 8)]
          : [hit('gs', 'Glanz-Shampoo', 'Shampoo', 5), hit('fs', 'Farbschutz Shampoo Sulfatfrei', 'Shampoo', 6)],
      evidenceLookup: noEvidence,
    });
    expect(modelCalls).toBe(1);
    expect(seenSystem).toContain('Info-Zusage');
    expect(seenSystem).toContain('Locken Shampoo');
    expect(response.text).not.toContain('haben wir zum Beispiel');
    expect(response.text).not.toContain('Glanz-Shampoo');
  });

  it('a back-reference question ("die Du mir jetzt genannt hast … oder?") never re-triggers the type list', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 4,
      text: 'Bei Haarfarbe/Farbcreme haben wir zum Beispiel Haarfarbe Ammoniakfrei.',
      lastProduct: { spokenName: 'Haarfarbe Ammoniakfrei', productId: 'ha', productKind: 'Haarfarbe/Farbcreme' },
    });
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Die Nuancen kann ich mir ja dann aussuchen, oder? Bei den einzelnen Haarfarbenmarken, die Du mir jetzt genannt hast.'),
      memory,
      client: { complete: async () => { modelCalls += 1; return 'Ja, genau — die Nuance wählen Sie beim jeweiligen Produkt aus.'; } },
      catalogSearch: (q: string) => (/farbcreme/i.test(q) ? [hit('ha', 'Haarfarbe Ammoniakfrei', 'Haarfarbe/Farbcreme', 4)] : []),
      evidenceLookup: noEvidence,
    });
    expect(modelCalls).toBe(1);
    expect(response.text).not.toContain('haben wir zum Beispiel');
  });

  it('the type list keeps auxiliary chemistry (Entwickler/Oxidationsmittel) out of the short list', async () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 4,
      text: 'Bei Haarfarbe/Farbcreme kann ich Ihnen eine Auswahl nennen. Soll ich mit Marken anfangen?',
      lastProduct: { spokenName: 'Haarfarbe Ammoniakfrei', productId: 'ha', productKind: 'Haarfarbe/Farbcreme' },
      lastAgentQuestion: 'Soll ich mit Marken anfangen?',
    });
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Ja.'),
      memory,
      client: { complete: async () => 'unused' },
      catalogSearch: () => [
        hit('ha', 'Haarfarbe Ammoniakfrei', 'Haarfarbe/Farbcreme', 4, 9),
        hit('cc', 'Colorationscreme Haarfarbe', 'Haarfarbe/Farbcreme', 6, 8),
        hit('fe', 'Farbentwickler Oxidationsmittel', 'Haarfarbe/Farbcreme', 3, 7),
        hit('ev', 'evelon Professionelle Haarfarbe', 'Haarfarbe/Farbcreme', 9, 6),
      ],
      evidenceLookup: noEvidence,
    });
    expect(response.text).toContain('Haarfarbe Ammoniakfrei');
    expect(response.text).not.toContain('Oxidationsmittel');
  });
});

describe('hair-profile enrichment scope (live 2026-07-03: Lockenstab pitched for a scissors question)', () => {
  function curlyMemory() {
    return reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'user_audio', turnIndex: 1, text: 'Ich habe ziemlich lockige Haare.', audioState: 'heard',
    });
  }

  it('a descriptor-only first turn gets ONE clarifying question, not a tagged comb', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Hallo, der das lockiges Haar?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'unused' },
      catalogSearch: () => [hit('delrin', 'Delrin-Kamm 4053', 'Friseur-Tool', 8)],
      evidenceLookup: noEvidence,
    });
    expect(response.text).toContain('Pflege');
    expect(response.text).toContain('?');
    expect(response.text).not.toContain('Delrin');
  });

  it('"habt ihr auch bestimmte Scheren?" with a stored locken profile pitches scissors, never the Lockenstab', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Okay, aber hast Du denn auch bestimmte Scheren?'),
      memory: curlyMemory(),
      client: { complete: async () => 'unused' },
      catalogSearch: (q: string) =>
        /lockig|locken/i.test(q)
          ? [hit('stab', 'Sthauer Profi Lockenstab konisch', 'Lockenstäbe', 29, 12), hit('bs', 'Basis Schere', 'Friseur-Tool', 9, 8)]
          : [hit('bs', 'Basis Schere', 'Friseur-Tool', 9, 8), hit('be', 'Basis Effilierschere', 'Friseur-Tool', 9, 7)],
      evidenceLookup: noEvidence,
    });
    expect(response.text).toContain('Basis Schere');
    expect(response.text).not.toContain('Lockenstab');
  });

  it('a tool never appears as the "alternative" to a shampoo top hit', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Habt ihr auch Shampoos für meine Locken? Ich möchte eins kaufen.'),
      memory: curlyMemory(),
      client: { complete: async () => 'unused' },
      catalogSearch: () => [
        hit('ls', 'Locken Shampoo', 'Shampoo', 8, 12),
        hit('stab', 'Sthauer Profi Lockenstab konisch', 'Lockenstäbe', 29, 10),
        hit('fs', 'Farbschutz Shampoo Sulfatfrei', 'Shampoo', 9, 9),
      ],
      evidenceLookup: noEvidence,
    });
    expect(response.text).toContain('Locken Shampoo');
    expect(response.text).not.toContain('Lockenstab');
    expect(response.text).toContain('Farbschutz Shampoo Sulfatfrei');
  });
});

describe('closure farewells hang up (live 2026-07-03: "hat sich alles geklärt" left dead air)', () => {
  it('"Alles klar, hat sich alles geklärt." says goodbye with end_call', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Alles klar, hat sich alles geklärt.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'unused' },
    });
    expect(response.endCall).toBe(true);
    expect(response.text).toContain('Auf Wiederhören');
  });

  it('a garbled "… auf, tschau." still counts as a farewell', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('jährlich auf, tschau.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => 'unused' },
    });
    expect(response.endCall).toBe(true);
  });
});

describe('turn-taking: comma + trailing subject pronoun is a mid-build restart (live 2026-07-03)', () => {
  it('holds on "Nee, was? Ich will doch, ich" (internal question mark must not escape)', () => {
    expect(looksIncompleteDrkallaUtterance('Nee, was? Ich will doch, ich')).toBe(true);
  });
  it('never holds on complete V2 inversions or plain answers', () => {
    expect(looksIncompleteDrkallaUtterance('Das mach ich')).toBe(false);
    expect(looksIncompleteDrkallaUtterance('Ich nehme das')).toBe(false);
    expect(looksIncompleteDrkallaUtterance('Ja, gerne.')).toBe(false);
  });
});

describe('contact answers stay contact answers (live 2026-07-03: hours answer got a product pitch appended)', () => {
  it('the hours directive forbids product upsell and offers further contact facts instead', () => {
    const directive = buildDrkallaContactDirective('hours');
    expect(directive).toContain('KEIN Produkt');
    expect(directive).toContain('Kontaktdaten');
  });
});

describe('hair-condition tag fragments are never product aliases (live 2026-07-03: Delrin-Kamm via "Lockiges")', () => {
  it('drops bare condition aliases but keeps genuine product names', () => {
    const detect = buildDrkallaProductNameDetector([
      { productId: 'delrin', spokenName: 'Delrin-Kamm 4053', productKind: 'Friseur-Tool', aliases: ['Delrin-Kamm 4053', 'Lockiges', 'coloriertes Haar.', 'pflegt trockenes'] },
      { productId: 'express', spokenName: 'Express Beauty', productKind: 'Shampoo', aliases: ['Express Beauty - Trockenshampoo'] },
    ]);
    // The caller describing their OWN hair must never resolve to a product.
    expect(detect('Hallo, der das lockiges Haar?')).toEqual([]);
    expect(detect('Ich habe coloriertes Haar.')).toEqual([]);
    // Genuine names (even ones containing a condition stem) still resolve.
    expect(detect('Haben Sie das Express Beauty Trockenshampoo?').map((p) => p.productId)).toContain('express');
    expect(detect('Ich meine den Delrin-Kamm 4053.').map((p) => p.productId)).toContain('delrin');
  });
});
