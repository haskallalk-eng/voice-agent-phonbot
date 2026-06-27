import { describe, expect, it } from 'vitest';
import {
  buildDrkallaContactAnswer,
  buildDrkallaContactDirective,
  DRKALLA_CONTACT_FACTS,
  mergeDrkallaContactFacts,
} from '../drkalla-contact-facts.js';
import { buildDrkallaLiveOverlay, parseContactOverrides } from '../drkalla-faq-overlay.js';
import { buildDrkallaCustomLlmResponse } from '../drkalla-custom-llm-responder.js';
import { DRKALLA_CUSTOM_RUNTIME_GREETING } from '../retell-drkalla-custom-llm-ws.js';
import { createDrkallaShortTermMemory } from '../drkalla-short-term-memory.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { AgentTurnRequestedEvent } from '../voice-runtime-contract.js';

const trustedScope = createTrustedScope({
  orgId: 'org-1', tenantId: 'tenant-1', agentId: 'agent-drkalla', callId: 'call-1',
  source: 'server', resolvedFrom: 'call_registry',
});
const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 };
const NOW = '2026-06-27T10:00:00.000Z';

function turn(text: string, sequence = 1): AgentTurnRequestedEvent {
  return {
    type: 'AgentTurnRequested', eventId: `e${sequence}`, traceId: `t${sequence}`, trustedScope,
    provider: 'retell', channel: 'voice', providerCallId: 'call-1', responseId: `r${sequence}`,
    sequence, occurredAt: NOW, receivedAt: NOW, currentUserText: text,
  };
}

describe('mergeDrkallaContactFacts', () => {
  it('overrides only the fields the owner published, keeping baked values for the rest', () => {
    const merged = mergeDrkallaContactFacts({ hoursSpoken: 'Montag bis Samstag von 9 bis 20 Uhr' });
    expect(merged.hoursSpoken).toBe('Montag bis Samstag von 9 bis 20 Uhr');
    expect(merged.addressSpoken).toBe(DRKALLA_CONTACT_FACTS.addressSpoken);
    expect(merged.emailSpoken).toBe(DRKALLA_CONTACT_FACTS.emailSpoken);
  });
  it('never blanks a fact: empty/whitespace overrides fall back to the baked value', () => {
    const merged = mergeDrkallaContactFacts({ hoursSpoken: '   ', addressSpoken: '' });
    expect(merged.hoursSpoken).toBe(DRKALLA_CONTACT_FACTS.hoursSpoken);
    expect(merged.addressSpoken).toBe(DRKALLA_CONTACT_FACTS.addressSpoken);
  });
  it('never lets the owner override the system Profi link', () => {
    const merged = mergeDrkallaContactFacts({ hoursSpoken: 'x bis y' } as never);
    expect(merged.profiUrl).toBe(DRKALLA_CONTACT_FACTS.profiUrl);
  });
});

describe('parseContactOverrides', () => {
  it('returns null when there is no usable contact field', () => {
    expect(parseContactOverrides(undefined)).toBeNull();
    expect(parseContactOverrides({})).toBeNull();
    expect(parseContactOverrides({ hoursSpoken: '   ' })).toBeNull();
    expect(parseContactOverrides('Montag')).toBeNull();
  });
  it('extracts trimmed non-empty fields', () => {
    const o = parseContactOverrides({ hoursSpoken: '  Mo bis Sa 9-20  ', emailSpoken: '' });
    expect(o?.hoursSpoken).toBe('Mo bis Sa 9-20');
    expect(o?.emailSpoken).toBeUndefined();
  });
});

describe('buildDrkallaContact* honour an override facts object', () => {
  const facts = mergeDrkallaContactFacts({ hoursSpoken: 'Montag bis Samstag von 9 bis 20 Uhr' });
  it('the deterministic answer speaks the overridden hours', () => {
    expect(buildDrkallaContactAnswer('hours', facts)).toContain('Montag bis Samstag von 9 bis 20 Uhr');
  });
  it('the model directive carries the overridden hours', () => {
    expect(buildDrkallaContactDirective('hours', facts)).toContain('Montag bis Samstag von 9 bis 20 Uhr');
  });
});

describe('buildDrkallaLiveOverlay builds contactFacts from the publish payload', () => {
  it('sets contactFacts when the payload carries contact overrides', async () => {
    const overlay = await buildDrkallaLiveOverlay({ contact: { hoursSpoken: 'Montag bis Samstag von 9 bis 20 Uhr' } }, NOW);
    expect(overlay.contactFacts?.hoursSpoken).toBe('Montag bis Samstag von 9 bis 20 Uhr');
    expect(overlay.contactFacts?.addressSpoken).toBe(DRKALLA_CONTACT_FACTS.addressSpoken);
  });
  it('leaves contactFacts undefined when no contact is published (agent uses baked facts)', async () => {
    const overlay = await buildDrkallaLiveOverlay({ faq: [] }, NOW);
    expect(overlay.contactFacts).toBeUndefined();
  });
});

describe('end-to-end: a published hours override is spoken by the live responder', () => {
  it('the deterministic fallback speaks the published hours, not the baked default', async () => {
    const contactFacts = mergeDrkallaContactFacts({ hoursSpoken: 'Montag bis Samstag von 9 bis 20 Uhr' });
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Wann habt ihr geöffnet?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
      contactFacts,
    });
    expect(response.text).toContain('Montag bis Samstag von 9 bis 20 Uhr');
    expect(response.text).not.toContain('10 bis 18');
  });
  it('the model is fed the published hours as the verbatim grounding fact', async () => {
    const contactFacts = mergeDrkallaContactFacts({ hoursSpoken: 'Montag bis Samstag von 9 bis 20 Uhr' });
    const prompts: string[] = [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Wann habt ihr geöffnet?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { prompts.push(system); return 'ok'; } },
      contactFacts,
    });
    expect(prompts[0]).toContain('Montag bis Samstag von 9 bis 20 Uhr');
    expect(prompts[0]).not.toContain('10 bis 18');
  });
});

describe('email override does not leak the baked email into the model prompt', () => {
  it('the system prompt carries the overridden email and NOT the baked default', async () => {
    const contactFacts = mergeDrkallaContactFacts({ emailSpoken: 'info at drkalla punkt de' });
    const prompts: string[] = [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Wie ist eure E-Mail-Adresse?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ system }) => { prompts.push(system); return 'ok'; } },
      contactFacts,
    });
    expect(prompts[0]).toContain('info at drkalla punkt de');
    expect(prompts[0]).not.toContain('kontakt at drkalla punkt com');
  });

  it('the deterministic fallback speaks the overridden email', async () => {
    const contactFacts = mergeDrkallaContactFacts({ emailSpoken: 'info at drkalla punkt de' });
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Wie ist eure E-Mail-Adresse?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async () => '' },
      contactFacts,
    });
    expect(response.text).toContain('info at drkalla punkt de');
    expect(response.text).not.toContain('kontakt at drkalla punkt com');
  });
});

describe('greeting carries the full brand name', () => {
  it('greets as "Doktor Kalla Cosmetics"', () => {
    expect(DRKALLA_CUSTOM_RUNTIME_GREETING).toContain('Doktor Kalla Cosmetics');
  });
});
