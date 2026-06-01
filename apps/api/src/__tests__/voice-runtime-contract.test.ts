import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTrustedScope } from '../trusted-scope.js';
import type {
  InteractionChannel,
  RuntimeCommand,
  RuntimeProvider,
  UpdateRuntimeTuningCommand,
} from '../voice-runtime-contract.js';

const contractSource = readFileSync(join(__dirname, '..', 'voice-runtime-contract.ts'), 'utf8');
const trustedScope = createTrustedScope({
  orgId: 'org-1',
  tenantId: 'tenant-1',
  agentId: 'agent-1',
  callId: 'call-1',
  source: 'server',
  resolvedFrom: 'call_registry',
});

const commandBase = {
  commandId: 'command-1',
  traceId: 'trace-1',
  trustedScope,
  provider: 'retell' as const,
  channel: 'voice' as const,
  providerCallId: 'provider-call-1',
};

describe('canonical voice runtime contract', () => {
  it('keeps runtime provider and interaction channel as separate axes', () => {
    const providers: RuntimeProvider[] = ['retell', 'openai_realtime', 'web_chat', 'unknown'];
    const channels: InteractionChannel[] = ['voice', 'web', 'internal_test'];

    expect(providers).toEqual(['retell', 'openai_realtime', 'web_chat', 'unknown']);
    expect(channels).toEqual(['voice', 'web', 'internal_test']);
  });

  it('represents streaming speech with turn, response, finality, interruptibility, and evidence fields', () => {
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
      sequence: 1,
    };

    expect(command.type).toBe('SpeakDelta');
    expect(command.turnId).toBe('turn-1');
    expect(command.responseId).toBe('response-1');
    expect(command.interruptible).toBe(true);
    expect(command.evidenceIds).toEqual(['evidence-1']);
  });

  it('keeps runtime tuning limited to transport-safe parameters', () => {
    const command: UpdateRuntimeTuningCommand = {
      ...commandBase,
      type: 'UpdateRuntimeTuning',
      patch: {
        audioInputEnabled: true,
        responseInterruptible: true,
        vadSensitivity: 'medium',
        maxSilenceMs: 1200,
      },
      reason: 'barge_in_recovery',
    };

    expect(command.trustedScope.source).toBe('server');
    expect(command.provider).toBe('retell');
    expect(command.patch).toEqual({
      audioInputEnabled: true,
      responseInterruptible: true,
      vadSensitivity: 'medium',
      maxSilenceMs: 1200,
    });
  });

  it('does not expose raw provider event names or transport message shapes', () => {
    expect(contractSource).not.toMatch(/\b(response_required|reminder_required|update_only)\b/);
    expect(contractSource).not.toMatch(/\b(response\.output_audio|response\.output_text|input_audio_buffer|conversation\.item)\b/);
    expect(contractSource).not.toMatch(/\b(transcript_with_tool_calls|full_transcript|live_transcript)\b/);
    expect(contractSource).not.toMatch(/\b(websocket|web_socket)\b/i);
  });

  it('does not let runtime tuning carry business policy, KB, tool authorization, or tenant-scope fields', () => {
    const tuningSource = contractSource.slice(
      contractSource.indexOf('export type RuntimeTuningPatch'),
      contractSource.indexOf('export type UpdateRuntimeTuningCommand'),
    );

    expect(tuningSource).not.toMatch(/\b(orgId|tenantId|agentId|callId|customerId|authorization|authContext)\b/);
    expect(tuningSource).not.toMatch(/\b(policy|toolAuthorization|knowledge|sourceVersion|allowedUse|truthfulness)\b/i);
  });

  it('requires canonical commands to carry trusted scope and provider correlation fields', () => {
    expect(contractSource).toContain('export type CanonicalCommandBase');
    expect(contractSource).toContain('trustedScope: TrustedScope');
    expect(contractSource).toContain('provider: RuntimeProvider');
    expect(contractSource).toContain('channel: InteractionChannel');
    expect(contractSource).toContain('providerCallId?: string');
    expect(contractSource).toContain('providerSessionId?: string');
  });
});
