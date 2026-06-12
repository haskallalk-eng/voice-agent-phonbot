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
    expect(second.text).toContain('Sag bitte nur ein Stichwort');
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
});
