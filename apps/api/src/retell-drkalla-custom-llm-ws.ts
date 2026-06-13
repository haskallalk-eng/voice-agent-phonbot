import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import type { WebSocket } from 'ws';
import {
  buildDrkallaCustomLlmResponse,
  type DrkallaCustomLlmClient,
} from './drkalla-custom-llm-responder.js';
import {
  buildDrkallaProductNameDetector,
  type DrkallaProductNameDetector,
  type DrkallaProductNameEntry,
} from './drkalla-product-name-detector.js';
import {
  createDrkallaShortTermMemory,
  type DrkallaShortTermVoiceMemory,
} from './drkalla-short-term-memory.js';
import { createTrustedScope } from './trusted-scope.js';
import type { AgentTurnRequestedEvent } from './voice-runtime-contract.js';

const SAFE_UNAVAILABLE_TEXT = 'Entschuldigung, ich kann gerade nicht weiterhelfen. Bitte versuchen Sie es später noch einmal oder schreiben Sie an kontakt at drkalla punkt com.';

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

function canonicalTurn(
  parsed: RetellDrkallaCustomLlmParsedMessage,
  callId: string,
  sequence: number,
): AgentTurnRequestedEvent {
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
    sequence,
    occurredAt: now,
    receivedAt: now,
    currentUserText: parsed.currentUserText,
  };
}

type RawAliasEntry = {
  handle?: unknown;
  title?: unknown;
  productType?: unknown;
  url?: unknown;
  spokenName?: unknown;
  searchAliases?: unknown;
};

/**
 * One-time startup load of the product alias snapshot (never per turn).
 * Fail-soft: a missing or invalid snapshot disables product-name detection
 * instead of breaking the canary route.
 */
export function loadDrkallaProductNameDetector(aliasPath?: string): DrkallaProductNameDetector | undefined {
  const resolved = aliasPath
    ?? process.env.DRKALLA_PRODUCT_ALIAS_PATH
    ?? path.join(process.cwd(), 'tmp', 'drkalla-rag', 'drkalla-product-voice-aliases.json');
  try {
    const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return undefined;
    const entries: DrkallaProductNameEntry[] = [];
    for (const raw of parsed.entries as RawAliasEntry[]) {
      if (typeof raw?.handle !== 'string' || typeof raw.spokenName !== 'string') continue;
      entries.push({
        productId: raw.handle,
        spokenName: raw.spokenName,
        productKind: typeof raw.productType === 'string' ? raw.productType : null,
        url: typeof raw.url === 'string' ? raw.url : undefined,
        aliases: Array.isArray(raw.searchAliases)
          ? raw.searchAliases.filter((alias): alias is string => typeof alias === 'string')
          : [],
      });
    }
    if (!entries.length) return undefined;
    return buildDrkallaProductNameDetector(entries);
  } catch {
    return undefined;
  }
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
  detectProducts?: DrkallaProductNameDetector;
  sequence?: number;
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
    event: canonicalTurn(parsed, input.callId || 'drkalla-custom-runtime-canary', input.sequence ?? 0),
    memory: input.memory ?? createDrkallaShortTermMemory(),
    client: { complete: input.complete },
    detectProducts: input.detectProducts,
  });
  input.onMemory?.(response.memory);

  // Never speak internal diagnostics ("Canary disabled: ...") to a caller.
  return reply(parsed.providerResponseId, response.blocked ? SAFE_UNAVAILABLE_TEXT : response.text);
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
  options: { client?: DrkallaCustomLlmClient; detectProducts?: DrkallaProductNameDetector } = {},
): Promise<void> {
  const detectProducts = options.detectProducts ?? loadDrkallaProductNameDetector();
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
    let turnCounter = 0;
    let latestArrival = 0;
    let processing: Promise<void> = Promise.resolve();

    if (!secretOk) {
      socket.close(1008, 'unauthorized');
      return;
    }

    socket.on('message', (message) => {
      const rawMessage = message.toString();
      // Track arrival order so a reply computed for an older response_required
      // is dropped once a newer user turn has arrived (barge-in safety).
      const parsedPreview = parseRetellDrkallaCustomLlmMessage(rawMessage);
      const isResponseTurn = parsedPreview?.interactionType === 'response_required';
      const myArrival = isResponseTurn ? ++latestArrival : latestArrival;

      // Serialize turns per socket so concurrent events cannot drop memory
      // updates (lost-update race on the shared per-session memory).
      processing = processing.then(async () => {
        try {
          if (isResponseTurn) turnCounter += 1;
          const outbound = await buildRetellDrkallaCustomLlmWsReply({
            enabled,
            secretAccepted: secretOk,
            rawMessage,
            callId,
            memory,
            onMemory: (nextMemory) => {
              memory = nextMemory;
            },
            complete: client.complete,
            detectProducts,
            sequence: turnCounter,
          });
          if (!outbound) return;
          if (isResponseTurn && myArrival !== latestArrival) return;
          socket.send(JSON.stringify(outbound));
        } catch (error) {
          app.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'DrKalla custom LLM canary failed');
        }
      });
    });
  };

  app.get('/retell/custom-llm/drkalla', { websocket: true }, handler);
  app.get('/retell/custom-llm/drkalla/:callId', { websocket: true }, handler);
  app.get('/retell/custom-llm/drkalla/auth/:secret/:callId', { websocket: true }, handler);
}
