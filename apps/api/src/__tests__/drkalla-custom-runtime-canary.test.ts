import { describe, expect, it } from 'vitest';
import {
  buildDrkallaCustomRuntimeCanaryTurn,
  createDisabledDrkallaCustomRuntimeCanary,
} from '../drkalla-custom-runtime-canary.js';
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

describe('DrKalla custom runtime canary', () => {
  it('stays disabled by default and does not imply live rollout', () => {
    const result = buildDrkallaCustomRuntimeCanaryTurn({
      canary: createDisabledDrkallaCustomRuntimeCanary(),
      memory: productMemory(),
      event: turn('Wie kaufe ich das?'),
    });

    expect(result.enabled).toBe(false);
    expect(result.liveRolloutAllowed).toBe(false);
    expect(result.modelDirectives).toEqual([]);
    expect(result.blockers).toContain('CANARY_NOT_ENABLED');
  });

  it('builds compact deterministic model directives from dialogue response plan when explicitly enabled', () => {
    const result = buildDrkallaCustomRuntimeCanaryTurn({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      memory: productMemory(),
      event: turn('Wie kaufe ich das?'),
    });

    expect(result.enabled).toBe(true);
    expect(result.liveRolloutAllowed).toBe(false);
    expect(result.blockers).toEqual([]);
    expect(result.runtime.memoryContextInjected).toBe(true);
    expect(result.runtime.responsePlan.plan).toBe('offer_product_link');
    expect(result.modelDirectives.join('\n')).toContain('Plan: offer_product_link');
    expect(result.modelDirectives.join('\n')).toContain('offer_specific_product_link_or_availability');
    expect(result.modelDirectives.join('\n')).toContain('offer_product_category');
    expect(result.modelDirectives.join('\n')).toContain('Memory is conversation state, not evidence');
    expect(result.directiveChars).toBeLessThanOrEqual(650);
    expect(result.extraLlmCalls).toBe(0);
    expect(result.extraKbCalls).toBe(0);
  });

  it('blocks live rollout even when canary directives are enabled unless rollout is separately allowed', () => {
    const result = buildDrkallaCustomRuntimeCanaryTurn({
      canary: {
        enabled: true,
        allowModelDirectives: true,
        allowLiveRollout: false,
        maxDirectiveChars: 650,
      },
      memory: productMemory(),
      event: turn('Was ist der Unterschied?'),
    });

    expect(result.enabled).toBe(true);
    expect(result.liveRolloutAllowed).toBe(false);
    expect(result.runtime.dialogueView.level).toBe('active_product');
    expect(result.modelDirectives.join('\n')).not.toContain('response_required');
    expect(result.modelDirectives.join('\n')).not.toContain('org-1');
    expect(result.modelDirectives.join('\n')).not.toContain('tenant-1');
  });
});
