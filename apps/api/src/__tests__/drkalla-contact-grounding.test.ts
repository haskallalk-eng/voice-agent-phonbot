import { describe, expect, it } from 'vitest';
import {
  buildDrkallaContactAnswer,
  buildDrkallaContactDirective,
  DRKALLA_CONTACT_FACTS,
  detectDrkallaContactIntent,
} from '../drkalla-contact-facts.js';
import { buildDrkallaCustomLlmResponse } from '../drkalla-custom-llm-responder.js';
import { createDrkallaShortTermMemory } from '../drkalla-short-term-memory.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { AgentTurnRequestedEvent } from '../voice-runtime-contract.js';

const trustedScope = createTrustedScope({
  orgId: 'org-1', tenantId: 'tenant-1', agentId: 'agent-drkalla', callId: 'call-1',
  source: 'server', resolvedFrom: 'call_registry',
});
const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 };

function turn(text: string, sequence = 1): AgentTurnRequestedEvent {
  return {
    type: 'AgentTurnRequested', eventId: `e${sequence}`, traceId: `t${sequence}`, trustedScope,
    provider: 'retell', channel: 'voice', providerCallId: 'call-1', responseId: `r${sequence}`,
    sequence, occurredAt: '2026-06-13T10:00:00.000Z', receivedAt: '2026-06-13T10:00:00.100Z',
    currentUserText: text,
  };
}

describe('DrKalla contact-intent detection', () => {
  it.each([
    ['Wo ist euer Laden?', 'address'],
    ['Was ist eure Adresse?', 'address'],
    ['Kann ich bei euch vorbeikommen?', 'address'],
    ['Wann habt ihr geöffnet?', 'hours'],
    ['Wie sind eure Öffnungszeiten?', 'hours'],
    ['Habt ihr heute auf?', 'hours'],
    // B: ASR/typed umlaut transliterations (oe/ae) must classify too. A-red:
    // "[öÖo]ffnungszeit" matched only a single ö/Ö/o, so "Oeffnungszeiten",
    // "geoeffnet", "Geschaeft", "oeffentliche" fell through to the model and
    // it abstained even though the fact is known (live smoke 2026-06-13).
    ['Wie sind eure Oeffnungszeiten?', 'hours'],
    ['Habt ihr ein Geschaeft in Berlin?', 'address'],
    ['Gibt es oeffentliche Verkehrsmittel zu euch?', 'anfahrt'],
    ['Wie ist eure E-Mail?', 'email'],
    ['Wie komme ich mit der U-Bahn zu euch?', 'anfahrt'],
    ['Ich bin Friseurin, bekomme ich Profi-Preise?', 'profi'],
    ['Wie funktioniert der Profi-Zugang?', 'profi'],
    ['Was kostet die Synthesis Color Cream?', null],
    ['Habt ihr Shampoo?', null],
  ])('classifies "%s" as %s', (text, expected) => {
    expect(detectDrkallaContactIntent(text)).toBe(expected);
  });
});

describe('DrKalla contact facts are canonical and Sie-form', () => {
  it('uses the real opening hours (10-18, no fabricated 9-18)', () => {
    expect(DRKALLA_CONTACT_FACTS.hoursSpoken).toContain('10 bis 18');
    expect(buildDrkallaContactAnswer('hours')).toContain('10 bis 18 Uhr');
    expect(buildDrkallaContactAnswer('hours')).not.toMatch(/\b(?:du|dir|dich)\b/i);
  });
  it('uses the real address and spoken email', () => {
    expect(buildDrkallaContactAnswer('address')).toContain('Silbersteinstraße 83, 12051 Berlin');
    // Spoken brand form — the TTS voice read the bare handle as "Der Kalla"
    // (owner complaint live 2026-07-04).
    expect(buildDrkallaContactAnswer('email')).toContain('kontakt at Doktor Kalla punkt com');
  });
  it('directives instruct verbatim quoting and never read a URL for Profi', () => {
    expect(buildDrkallaContactDirective('hours')).toContain('verbatim');
    expect(buildDrkallaContactDirective('hours')).toContain('10 bis 18');
    expect(buildDrkallaContactDirective('profi')).toContain('nie die URL vorlesen');
  });
});

describe('DrKalla custom runtime grounds contact facts (A: invents, B: grounded)', () => {
  it('B: an hours question is answered DETERMINISTICALLY with the grounded fact (0ms, no model)', async () => {
    // A-red evidence: before this change the custom runtime fed no contact
    // facts, so the model invented hours (live smoke produced "9 bis 18 Uhr").
    // Since 2026-07-04 contact questions do not even reach the model: the
    // governed deterministic answer wins (~700ms saved, no upsell drift).
    let modelCalls = 0;
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Wann habt ihr geöffnet?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => { modelCalls += 1; return 'unused'; } },
    });
    expect(modelCalls).toBe(0);
    expect(response.metrics.extraLlmCalls).toBe(0);
    expect(response.text).toContain('10 bis 18 Uhr');
    expect(response.text).not.toMatch(/\b9 bis 18\b/);
  });

  it('B: when the model is empty, the hours fallback states the real hours (no invention)', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Wann habt ihr geöffnet?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });
    expect(response.text).toContain('10 bis 18 Uhr');
    expect(response.text).not.toMatch(/\b9 bis 18\b/);
    expect(response.text).not.toMatch(/\b(?:du|dir|dich)\b/i);
    expect(response.metrics.extraKbCalls).toBe(0);
  });

  it('B: an address question fallback states the canonical address, not a generic prompt', async () => {
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was ist eure Adresse?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
    });
    expect(response.text).toContain('Silbersteinstraße 83, 12051 Berlin');
    expect(response.text).not.toContain('welches Produkt oder welche Produktart');
  });

  it('B: caller PII (address) is redacted before the utterance reaches the model (Codex rank 13)', async () => {
    const prompts: string[] = [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Schicken Sie es an Beispielstraße 5, ich heiße Test.'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ user }) => { prompts.push(user); return 'Alles klar.'; } },
    });
    // The user message sent to the model must not contain the raw street.
    expect(prompts[0]).not.toContain('Beispielstraße 5');
    expect(prompts[0]).toContain('[ADDRESS]');
  });

  it('B: the system prompt carries the salon-vs-shop guard and the abstain rule', async () => {
    const prompts: string[] = [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Kann ich einen Haarschnitt buchen?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { prompts.push(system); return 'Wir sind ein Friseurbedarf-Shop.'; } },
    });
    expect(prompts[0]).toContain('kein Friseursalon');
    expect(prompts[0]).toContain('keine Termine');
    expect(prompts[0]).toContain('erfinde nichts');
  });
});
