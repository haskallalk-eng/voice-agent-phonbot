import { describe, expect, it } from 'vitest';
import {
  buildDrkallaSummaryMessages,
  selectDrkallaOlderTurns,
  shouldRefreshDrkallaSummary,
  DRKALLA_SUMMARY_SYSTEM,
} from '../drkalla-conversation-summary.js';
import { buildDrkallaCustomLlmResponse, type DrkallaConversationTurn } from '../drkalla-custom-llm-responder.js';
import { createDrkallaShortTermMemory } from '../drkalla-short-term-memory.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { AgentTurnRequestedEvent } from '../voice-runtime-contract.js';

const trustedScope = createTrustedScope({
  orgId: 'org-1', tenantId: 'tenant-1', agentId: 'agent-drkalla', callId: 'call-1',
  source: 'server', resolvedFrom: 'call_registry',
});
const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 };

function turn(text: string, sequence = 9): AgentTurnRequestedEvent {
  return {
    type: 'AgentTurnRequested', eventId: `e${sequence}`, traceId: `t${sequence}`, trustedScope,
    provider: 'retell', channel: 'voice', providerCallId: 'call-1', responseId: `r${sequence}`,
    sequence, occurredAt: '2026-06-27T10:00:00.000Z', receivedAt: '2026-06-27T10:00:00.100Z',
    currentUserText: text,
  };
}

function turns(n: number): DrkallaConversationTurn[] {
  return Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'agent', text: `turn ${i}` }));
}

describe('shouldRefreshDrkallaSummary', () => {
  it('is false until there are older turns beyond the verbatim window', () => {
    expect(shouldRefreshDrkallaSummary({ totalTurns: 7, summarizedThroughTurn: 0 })).toBe(false);
  });
  it('is true once enough older + new turns have accrued', () => {
    expect(shouldRefreshDrkallaSummary({ totalTurns: 8, summarizedThroughTurn: 0 })).toBe(true);
  });
  it('does not re-run until REFRESH_EVERY new turns since the last note', () => {
    expect(shouldRefreshDrkallaSummary({ totalTurns: 10, summarizedThroughTurn: 8 })).toBe(false);
    expect(shouldRefreshDrkallaSummary({ totalTurns: 12, summarizedThroughTurn: 8 })).toBe(true);
  });
});

describe('selectDrkallaOlderTurns', () => {
  it('returns only the turns before the verbatim window', () => {
    const older = selectDrkallaOlderTurns(turns(10)); // 10 - 6 = 4 older
    expect(older.length).toBe(4);
    expect(older[0]?.text).toBe('turn 0');
    expect(older[older.length - 1]?.text).toBe('turn 3');
  });
  it('caps a very long older history', () => {
    const older = selectDrkallaOlderTurns(turns(40)); // 34 older, capped to 16
    expect(older.length).toBe(16);
  });
});

describe('buildDrkallaSummaryMessages', () => {
  it('includes the previous note and the older turns', () => {
    const { system, user } = buildDrkallaSummaryMessages(
      [{ role: 'user', text: 'Ich suche einen Föhn' }],
      'Vorherige Notiz: Anrufer interessiert sich für Styling.',
    );
    expect(system).toBe(DRKALLA_SUMMARY_SYSTEM);
    expect(user).toContain('Ich suche einen Föhn');
    expect(user).toContain('Vorherige Notiz: Anrufer interessiert sich für Styling.');
    expect(user).toContain('Aktualisierte Gedaechtnisnotiz');
  });

  it('redacts caller PII from the older turns before the summarizer sees them', () => {
    const { user } = buildDrkallaSummaryMessages(
      [{ role: 'user', text: 'Meine Adresse ist Beispielstraße 5 und meine Nummer 0151 23456789.' }],
      '',
    );
    expect(user).not.toContain('Beispielstraße 5');
    expect(user).not.toContain('0151 23456789');
  });
});

describe('the rolling note is fed to the model (older context on long calls)', () => {
  it('prepends the note to the model user message, before the verbatim window', async () => {
    const captured: string[] = [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was raten Sie mir?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ user }) => { captured.push(user); return 'Gerne.'; } },
      conversationSummary: 'Anrufer sucht einen Föhn, Marke noch offen, Budget ca. 50 Euro.',
      conversationHistory: [{ role: 'agent', text: 'Welche Marke bevorzugen Sie?' }],
    });
    const u = captured[0] ?? '';
    expect(u).toContain('Gedaechtnisnotiz zum bisherigen Gespraech: Anrufer sucht einen Föhn');
    // order: note → verbatim window → current
    expect(u.indexOf('Gedaechtnisnotiz')).toBeLessThan(u.indexOf('Gespraechsverlauf'));
    expect(u.indexOf('Gespraechsverlauf')).toBeLessThan(u.indexOf('Aktuelle Aussage des Anrufers:'));
  });

  it('without a note or history the model still gets only the current utterance', async () => {
    const captured: string[] = [];
    await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn('Was raten Sie mir?'),
      memory: createDrkallaShortTermMemory(),
      client: { complete: async ({ user }) => { captured.push(user); return 'Gerne.'; } },
    });
    expect(captured[0]).toBe('Was raten Sie mir?');
  });
});
