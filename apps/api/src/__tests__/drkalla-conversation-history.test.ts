import { describe, expect, it } from 'vitest';
import { extractRetellDrkallaRecentTurns } from '../retell-drkalla-custom-llm-ws.js';
import { buildDrkallaCustomLlmResponse } from '../drkalla-custom-llm-responder.js';
import { createDrkallaShortTermMemory } from '../drkalla-short-term-memory.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { AgentTurnRequestedEvent } from '../voice-runtime-contract.js';

const trustedScope = createTrustedScope({
  orgId: 'org-1', tenantId: 'tenant-1', agentId: 'agent-drkalla', callId: 'call-1',
  source: 'server', resolvedFrom: 'call_registry',
});
const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 };

function turn(text: string, sequence = 2): AgentTurnRequestedEvent {
  return {
    type: 'AgentTurnRequested', eventId: `e${sequence}`, traceId: `t${sequence}`, trustedScope,
    provider: 'retell', channel: 'voice', providerCallId: 'call-1', responseId: `r${sequence}`,
    sequence, occurredAt: '2026-06-27T10:00:00.000Z', receivedAt: '2026-06-27T10:00:00.100Z',
    currentUserText: text,
  };
}

describe('extractRetellDrkallaRecentTurns', () => {
  it('maps roles and drops the trailing (current) user turn', () => {
    const transcript = [
      { role: 'agent', content: 'Begruessung' },
      { role: 'user', content: 'Frage eins' },
      { role: 'agent', content: 'Antwort eins' },
      { role: 'user', content: 'aktuelle Frage' },
    ];
    expect(extractRetellDrkallaRecentTurns(transcript, 6)).toEqual([
      { role: 'agent', text: 'Begruessung' },
      { role: 'user', text: 'Frage eins' },
      { role: 'agent', text: 'Antwort eins' },
    ]);
  });

  it('returns [] for a non-array / empty transcript', () => {
    expect(extractRetellDrkallaRecentTurns(undefined)).toEqual([]);
    expect(extractRetellDrkallaRecentTurns([])).toEqual([]);
  });

  it('bounds the window to the most recent maxTurns', () => {
    const transcript = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'agent' : 'user', content: `t${i}` }));
    const turns = extractRetellDrkallaRecentTurns(transcript, 3);
    expect(turns.length).toBe(3);
    expect(turns[turns.length - 1]?.text).toBe('t8'); // index 9 (user) dropped, then last 3
  });
});

describe('the model keeps the topic via recent history (no extra LLM call)', () => {
  it('feeds the prior topic into the model user message', async () => {
    const captured: string[] = [];
    const res = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was empfehlen Sie mir denn?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ user }) => { captured.push(user); return 'Gerne, ich helfe Ihnen.'; } },
      conversationHistory: [
        { role: 'user', text: 'Ich suche ein Shampoo gegen Schuppen.' },
        { role: 'agent', text: 'Da haben wir mehrere Optionen.' },
      ],
    });
    expect(captured[0]).toContain('Schuppen');
    expect(captured[0]).toContain('Aktuelle Aussage des Anrufers: Was empfehlen Sie mir denn?');
    // History adds NO extra KB lookup (it reuses turns already in the message).
    expect(res.metrics.extraKbCalls).toBe(0);
  });

  it('without history the model gets only the current utterance (unchanged behaviour)', async () => {
    const captured: string[] = [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was empfehlen Sie mir denn?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ user }) => { captured.push(user); return 'Gerne.'; } },
    });
    expect(captured[0]).toBe('Was empfehlen Sie mir denn?');
    expect(captured[0]).not.toContain('Gespraechsverlauf');
  });

  it('redacts caller PII inside history before it reaches the model', async () => {
    const captured: string[] = [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Koennen Sie mir bitte weiterhelfen?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ user }) => { captured.push(user); return 'Ja.'; } },
      conversationHistory: [{ role: 'user', text: 'Meine Adresse ist Beispielstraße 5.' }],
    });
    expect(captured[0]).not.toContain('Beispielstraße 5');
  });
});
