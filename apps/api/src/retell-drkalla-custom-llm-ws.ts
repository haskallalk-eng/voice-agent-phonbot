import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import type { WebSocket } from 'ws';
import {
  buildDrkallaCustomLlmResponse,
  type DrkallaCustomLlmClient,
} from './drkalla-custom-llm-responder.js';
import {
  createDrkallaShortTermMemory,
  type DrkallaShortTermVoiceMemory,
} from './drkalla-short-term-memory.js';
import { createTrustedScope } from './trusted-scope.js';
import type { AgentTurnRequestedEvent } from './voice-runtime-contract.js';

export type RetellDrkallaCustomLlmParsedMessage = {
  interactionType: string;
  responseId: string;
  providerResponseId: string | number;
  currentUserText: string;
};

export type RetellDrkallaCustomLlmReply = {
  response_type: 'response';
  response_id: string | number;
  content: string;
  content_complete: true;
  end_call: false;
};

type RetellTranscriptTurn = {
  role?: unknown;
  content?: unknown;
  text?: unknown;
};

type RetellCustomLlmMessage = {
  interaction_type?: unknown;
  event?: unknown;
  response_id?: unknown;
  transcript?: unknown;
  last_user_transcript?: unknown;
  current_user_text?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstProviderResponseId(...values: unknown[]): string | number | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

function latestUserText(transcript: unknown): string {
  if (!Array.isArray(transcript)) return '';
  for (const turn of [...transcript].reverse()) {
    const item = asObject(turn) as RetellTranscriptTurn | null;
    if (!item) continue;
    if (typeof item.role === 'string' && item.role.toLowerCase() !== 'user') continue;
    const text = firstString(item.content, item.text);
    if (text) return text;
  }
  return '';
}

export function parseRetellDrkallaCustomLlmMessage(raw: string): RetellDrkallaCustomLlmParsedMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const message = asObject(parsed) as RetellCustomLlmMessage | null;
  if (!message) return null;

  const interactionType = firstString(message.interaction_type, message.event);
  const providerResponseId = firstProviderResponseId(message.response_id);
  if (providerResponseId === null) return null;
  const responseId = String(providerResponseId);
  const currentUserText = firstString(
    message.current_user_text,
    message.last_user_transcript,
    latestUserText(message.transcript),
  );
  if (!interactionType || !responseId) return null;

  return {
    interactionType,
    responseId,
    providerResponseId,
    currentUserText,
  };
}

function canaryTrustedScope() {
  return createTrustedScope({
    orgId: 'demo-drkalla',
    tenantId: 'demo-drkalla',
    agentId: 'drkalla-custom-runtime-canary',
    callId: 'drkalla-custom-runtime-canary',
    source: 'server',
    resolvedFrom: 'internal_job',
  });
}

function canonicalTurn(parsed: RetellDrkallaCustomLlmParsedMessage, callId: string): AgentTurnRequestedEvent {
  const now = new Date().toISOString();
  return {
    type: 'AgentTurnRequested',
    eventId: `retell-drkalla-custom-llm:${parsed.responseId}`,
    traceId: `retell-drkalla-custom-llm:${parsed.responseId}`,
    trustedScope: canaryTrustedScope(),
    provider: 'retell',
    channel: 'voice',
    providerCallId: callId,
    responseId: parsed.responseId,
    occurredAt: now,
    receivedAt: now,
    currentUserText: parsed.currentUserText,
  };
}

function reply(responseId: string | number, content: string): RetellDrkallaCustomLlmReply {
  return {
    response_type: 'response',
    response_id: responseId,
    content,
    content_complete: true,
    end_call: false,
  };
}

export async function buildRetellDrkallaCustomLlmWsReply(input: {
  enabled: boolean;
  secretAccepted: boolean;
  rawMessage: string;
  callId?: string;
  memory?: DrkallaShortTermVoiceMemory;
  onMemory?: (memory: DrkallaShortTermVoiceMemory) => void;
  complete: DrkallaCustomLlmClient['complete'];
}): Promise<RetellDrkallaCustomLlmReply | null> {
  if (!input.secretAccepted) return null;

  const parsed = parseRetellDrkallaCustomLlmMessage(input.rawMessage);
  if (!parsed) return null;
  if (parsed.interactionType !== 'response_required') return null;

  const response = await buildDrkallaCustomLlmResponse({
    canary: input.enabled
      ? {
          enabled: true,
          allowModelDirectives: true,
          allowLiveRollout: false,
          maxDirectiveChars: 650,
        }
      : {
          enabled: false,
          allowModelDirectives: false,
          allowLiveRollout: false,
          maxDirectiveChars: 0,
    },
    event: canonicalTurn(parsed, input.callId || 'drkalla-custom-runtime-canary'),
    memory: input.memory ?? createDrkallaShortTermMemory(),
    client: { complete: input.complete },
  });
  input.onMemory?.(response.memory);

  return reply(parsed.providerResponseId, response.text);
}

function secretAccepted(configuredSecret: string | undefined, candidate: unknown): boolean {
  if (!configuredSecret || typeof candidate !== 'string') return false;
  if (configuredSecret.length < 16) return false;
  const left = Buffer.from(configuredSecret);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

function createOpenAiClient(): DrkallaCustomLlmClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { complete: async () => '' };
  }
  const timeoutMs = Math.max(250, Number(process.env.DRKALLA_CUSTOM_RUNTIME_MODEL_TIMEOUT_MS ?? 700));
  const openai = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: timeoutMs,
  });
  return {
    complete: async ({ system, user, maxOutputChars }) => {
      try {
        const completion = await openai.chat.completions.create({
          model: process.env.DRKALLA_CUSTOM_RUNTIME_MODEL || 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_completion_tokens: Math.max(80, Math.ceil(maxOutputChars / 3)),
          temperature: 0.2,
        });
        return completion.choices[0]?.message?.content ?? '';
      } catch {
        return '';
      }
    },
  };
}

export async function registerRetellDrkallaCustomLlmWs(
  app: FastifyInstance,
  options: { client?: DrkallaCustomLlmClient } = {},
): Promise<void> {
  const handler = (socket: WebSocket, request: { query: unknown; params: unknown }) => {
    const query = request.query as { secret?: string; token?: string };
    const params = request.params as { secret?: string };
    const callId = typeof (request.params as { callId?: unknown }).callId === 'string'
      ? (request.params as { callId: string }).callId
      : 'drkalla-custom-runtime-canary';
    const secretOk = secretAccepted(
      process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET,
      params.secret ?? query.secret ?? query.token,
    );
    const enabled = process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED === 'true';
    const client = options.client ?? createOpenAiClient();
    let memory = createDrkallaShortTermMemory();

    if (!secretOk) {
      socket.close(1008, 'unauthorized');
      return;
    }

    socket.on('message', async (message) => {
      try {
        const outbound = await buildRetellDrkallaCustomLlmWsReply({
          enabled,
          secretAccepted: secretOk,
          rawMessage: message.toString(),
          callId,
          memory,
          onMemory: (nextMemory) => {
            memory = nextMemory;
          },
          complete: client.complete,
        });
        if (outbound) socket.send(JSON.stringify(outbound));
      } catch (error) {
        app.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'DrKalla custom LLM canary failed');
      }
    });
  };

  app.get('/retell/custom-llm/drkalla', { websocket: true }, handler);
  app.get('/retell/custom-llm/drkalla/:callId', { websocket: true }, handler);
  app.get('/retell/custom-llm/drkalla/auth/:secret/:callId', { websocket: true }, handler);
}
