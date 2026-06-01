import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTrustedScope } from '../trusted-scope.js';
import { createOpenAIRealtimeAdapter } from '../provider-adapters/openai-realtime-adapter.js';
import { createRetellAdapter } from '../provider-adapters/retell-adapter.js';
import type { RuntimeCommand } from '../voice-runtime-contract.js';

const trustedScope = createTrustedScope({
  orgId: 'org-1',
  tenantId: 'tenant-1',
  agentId: 'agent-1',
  callId: 'call-1',
  source: 'server',
  resolvedFrom: 'call_registry',
});

const context = {
  trustedScope,
  traceId: 'trace-1',
  receivedAt: '2026-05-30T10:00:00.100Z',
};

const retellAdapter = createRetellAdapter(context);
const openAiAdapter = createOpenAIRealtimeAdapter({
  ...context,
  providerCallId: 'call-1',
});

const commandBase = {
  commandId: 'command-1',
  traceId: 'trace-1',
  trustedScope,
  provider: 'retell' as const,
  channel: 'voice' as const,
  providerCallId: 'call-1',
};

describe('canonical runtime provider fixture adapters', () => {
  it('normalizes the same requested user turn from Retell and OpenAI into the same core-facing fields', () => {
    const retellEvents = retellAdapter.normalizeEvent({
      event: 'response_required',
      event_id: 'retell-event-1',
      call_id: 'call-1',
      response_id: 'response-1',
      turn_id: 'turn-1',
      sequence: 7,
      timestamp: '2026-05-30T10:00:00.000Z',
      last_user_transcript: 'Ich brauche einen Termin morgen.',
      transcript: [
        { role: 'user', content: 'Ich brauche einen Termin morgen, meine Nummer ist 030 12345678 und mail max@example.com.', timestamp: '2026-05-30T10:00:00.000Z' },
      ],
      transcript_with_tool_calls: [{ provider: 'full-transcript-not-for-core' }],
    });
    const openAiEvents = openAiAdapter.normalizeEvent({
      type: 'response.create',
      event_id: 'openai-event-1',
      session_id: 'session-1',
      response_id: 'response-1',
      turn_id: 'turn-1',
      sequence: 7,
      created_at: '2026-05-30T10:00:00.000Z',
      transcript: 'Ich brauche einen Termin morgen.',
    });

    expect(retellEvents).toHaveLength(1);
    expect(openAiEvents).toHaveLength(1);
    expect(retellEvents[0]).toMatchObject({
      type: 'AgentTurnRequested',
      trustedScope,
      provider: 'retell',
      channel: 'voice',
      providerCallId: 'call-1',
      turnId: 'turn-1',
      responseId: 'response-1',
      sequence: 7,
      currentUserText: 'Ich brauche einen Termin morgen.',
    });
    expect(openAiEvents[0]).toMatchObject({
      type: 'AgentTurnRequested',
      trustedScope,
      provider: 'openai_realtime',
      channel: 'voice',
      providerCallId: 'call-1',
      providerSessionId: 'session-1',
      turnId: 'turn-1',
      responseId: 'response-1',
      sequence: 7,
      currentUserText: 'Ich brauche einen Termin morgen.',
    });
    expect(JSON.stringify(retellEvents[0])).not.toContain('full-transcript-not-for-core');
    expect(JSON.stringify(retellEvents[0])).not.toContain('030 12345678');
    expect(JSON.stringify(retellEvents[0])).not.toContain('max@example.com');
    expect(JSON.stringify(retellEvents[0])).toContain('[PHONE]');
    expect(JSON.stringify(retellEvents[0])).toContain('[EMAIL]');
  });

  it('normalizes interruption and response correlation without leaking provider schemas into core', () => {
    const retellEvents = retellAdapter.normalizeEvent({
      event: 'user_interrupted',
      event_id: 'retell-interrupt',
      call_id: 'call-1',
      response_id: 'response-1',
      turn_id: 'turn-1',
      sequence: 8,
      timestamp: '2026-05-30T10:00:01.000Z',
      interruption: {
        response_id: 'response-1',
        partial_transcript: 'warte kurz',
      },
    });
    const openAiEvents = openAiAdapter.normalizeEvent({
      type: 'input_audio_buffer.speech_started',
      event_id: 'openai-interrupt',
      session_id: 'session-1',
      response_id: 'response-1',
      turn_id: 'turn-1',
      sequence: 8,
      created_at: '2026-05-30T10:00:01.000Z',
    });

    expect(retellEvents[0]).toMatchObject({
      type: 'UserInterrupted',
      interruptedTurnId: 'turn-1',
      interruptedResponseId: 'response-1',
      currentPartialText: 'warte kurz',
    });
    expect(openAiEvents[0]).toMatchObject({
      type: 'UserInterrupted',
      interruptedTurnId: 'turn-1',
      interruptedResponseId: 'response-1',
    });
  });

  it('renders speech commands as provider messages without executing tools or policy decisions', () => {
    const command: RuntimeCommand = {
      ...commandBase,
      type: 'SpeakDelta',
      turnId: 'turn-1',
      responseId: 'response-1',
      text: 'Ich pruefe das kurz.',
      isFinal: false,
      interruptible: true,
      evidenceIds: ['evidence-1'],
      voiceStyle: 'short',
    };

    expect(retellAdapter.renderCommand(command)).toEqual([{
      response_id: 'response-1',
      content: 'Ich pruefe das kurz.',
      content_complete: false,
    }]);
    expect(openAiAdapter.renderCommand(command)).toEqual([{
      type: 'response.output_text.delta',
      response_id: 'response-1',
      text: 'Ich pruefe das kurz.',
      final: false,
    }]);
  });

  it('does not render RequestToolExecution as provider business logic', () => {
    const command: RuntimeCommand = {
      ...commandBase,
      type: 'RequestToolExecution',
      turnId: 'turn-1',
      toolName: 'knowledge.search',
      toolCallId: 'tool-call-1',
      args: { query: 'oeffnungszeiten' },
    };

    expect(retellAdapter.renderCommand(command)).toEqual([]);
    expect(openAiAdapter.renderCommand(command)).toEqual([]);
  });

  it('keeps UpdateRuntimeTuning transport-only in provider renderers', () => {
    const command: RuntimeCommand = {
      ...commandBase,
      type: 'UpdateRuntimeTuning',
      patch: {
        audioInputEnabled: true,
        audioOutputEnabled: true,
        responseInterruptible: true,
        vadSensitivity: 'medium',
        maxSilenceMs: 1200,
      },
      reason: 'barge_in_recovery',
    };

    const rendered = [
      ...retellAdapter.renderCommand(command),
      ...openAiAdapter.renderCommand(command),
    ];

    expect(JSON.stringify(rendered)).toContain('1200');
    expect(JSON.stringify(rendered)).not.toMatch(/\b(orgId|tenantId|agentId|callId|customerId|authorization|policy|knowledge|allowedUse)\b/);
  });

  it('keeps provider adapters free of SDK imports and policy-layer imports', () => {
    const retellSource = readFileSync(join(__dirname, '..', 'provider-adapters', 'retell-adapter.ts'), 'utf8');
    const openAiSource = readFileSync(join(__dirname, '..', 'provider-adapters', 'openai-realtime-adapter.ts'), 'utf8');

    for (const source of [retellSource, openAiSource]) {
      expect(source).not.toMatch(/from ['"](?:openai|retell|@retell|retell-sdk)/);
      expect(source).not.toMatch(/from ['"]\.\.\/(?:policy-layer|action-contracts|agent-tools)\.js['"]/);
    }
  });
});
