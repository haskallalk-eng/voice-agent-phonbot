import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import type { WebSocket } from 'ws';
import {
  buildDrkallaCustomLlmResponse,
  type DrkallaCustomLlmClient,
  type DrkallaSendLinkExecutor,
} from './drkalla-custom-llm-responder.js';
import {
  buildDrkallaProductEvidenceLookup,
  type DrkallaProductEvidenceLookup,
  type DrkallaRawCatalogProduct,
} from './drkalla-product-evidence.js';
import { DRKALLA_LINK_TOOL_PATH, drkallaLinkToolSignature } from './drkalla-link-tool.js';
import {
  buildDrkallaAmbiguousProductNameDetector,
  buildDrkallaProductNameDetector,
  deriveDrkallaAgentSpokeEvent,
  type DrkallaAmbiguousProductNameDetector,
  type DrkallaProductNameDetector,
  type DrkallaProductNameEntry,
} from './drkalla-product-name-detector.js';
import {
  createDrkallaShortTermMemory,
  nextDrkallaNoInputReminder,
  reduceDrkallaShortTermMemory,
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
// Snapshot resolution order: explicit arg/env, then the tracked deploy
// location (container cwd is /app, local API cwd is apps/api), then the
// local-dev tmp scratch. First readable file wins; all paths fail soft.
function resolveDrkallaSnapshotPath(fileName: string, explicit?: string): string[] {
  return [
    explicit,
    path.join(process.cwd(), 'apps', 'api', 'data', 'drkalla-rag', fileName),
    path.join(process.cwd(), 'data', 'drkalla-rag', fileName),
    path.join(process.cwd(), 'tmp', 'drkalla-rag', fileName),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function readFirstJson(candidates: string[]): unknown {
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8'));
    } catch {
      continue;
    }
  }
  return null;
}

export function loadDrkallaProductNameEntries(aliasPath?: string): DrkallaProductNameEntry[] {
  try {
    const parsed = readFirstJson(
      resolveDrkallaSnapshotPath('drkalla-product-voice-aliases.json', aliasPath ?? process.env.DRKALLA_PRODUCT_ALIAS_PATH),
    ) as { entries?: unknown } | null;
    if (!parsed) return [];
    if (!Array.isArray(parsed.entries)) return [];
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
    return entries;
  } catch {
    return [];
  }
}

export function loadDrkallaProductNameDetector(aliasPath?: string): DrkallaProductNameDetector | undefined {
  const entries = loadDrkallaProductNameEntries(aliasPath);
  return entries.length ? buildDrkallaProductNameDetector(entries) : undefined;
}

/**
 * Removes the canary auth secret from request URLs before they reach logs
 * (path segment and secret/token query params).
 */
export function redactDrkallaCanarySecretFromUrl(url: string): string {
  return url
    .replace(/(\/retell\/custom-llm\/drkalla\/auth\/)[^/?]+/i, '$1[redacted]')
    .replace(/([?&](?:secret|token)=)[^&]*/gi, '$1[redacted]');
}

/**
 * One-time startup load of the catalog snapshot into the structured product
 * evidence lookup (never per turn). Fail-soft: without the snapshot the
 * canary simply runs without grounded price/brand evidence.
 */
export function loadDrkallaProductEvidenceLookup(productsPath?: string): DrkallaProductEvidenceLookup | undefined {
  try {
    const parsed = readFirstJson(
      resolveDrkallaSnapshotPath('drkalla-products.json', productsPath ?? process.env.DRKALLA_PRODUCTS_PATH),
    ) as { products?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.products) || !parsed.products.length) return undefined;
    const lookup = buildDrkallaProductEvidenceLookup(parsed.products as DrkallaRawCatalogProduct[]);
    return lookup.size > 0 ? lookup : undefined;
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
  completeStream?: DrkallaCustomLlmClient['completeStream'];
  detectProducts?: DrkallaProductNameDetector;
  detectAmbiguousProduct?: DrkallaAmbiguousProductNameDetector;
  evidenceLookup?: DrkallaProductEvidenceLookup;
  executeSendLink?: DrkallaSendLinkExecutor;
  sequence?: number;
  noInputReminderCount?: number;
  onDelta?: (chunk: string) => void;
}): Promise<RetellDrkallaCustomLlmReply | null> {
  if (!input.secretAccepted) return null;

  const parsed = parseRetellDrkallaCustomLlmMessage(input.rawMessage);
  if (!parsed) return null;

  // Caller went silent (Retell reminder). Re-engage deterministically: no
  // model call, no end_call. Retell still owns the hard silence timeout.
  if (parsed.interactionType === 'reminder_required') {
    const memory = input.memory ?? createDrkallaShortTermMemory();
    const reminderText = nextDrkallaNoInputReminder(memory, Math.max(1, input.noInputReminderCount ?? 1));
    input.onMemory?.(reduceDrkallaShortTermMemory(
      memory,
      deriveDrkallaAgentSpokeEvent({ text: reminderText, turnIndex: input.sequence ?? 0 }),
    ));
    return reply(parsed.providerResponseId, reminderText);
  }

  if (parsed.interactionType !== 'response_required') return null;

  const response = await buildDrkallaCustomLlmResponse({
    canary: input.enabled
      ? {
          enabled: true,
          allowModelDirectives: true,
          allowLiveRollout: false,
          maxDirectiveChars: 800,
        }
      : {
          enabled: false,
          allowModelDirectives: false,
          allowLiveRollout: false,
          maxDirectiveChars: 0,
    },
    event: canonicalTurn(parsed, input.callId || 'drkalla-custom-runtime-canary', input.sequence ?? 0),
    memory: input.memory ?? createDrkallaShortTermMemory(),
    client: { complete: input.complete, completeStream: input.completeStream },
    detectProducts: input.detectProducts,
    detectAmbiguousProduct: input.detectAmbiguousProduct,
    evidenceLookup: input.evidenceLookup,
    executeSendLink: input.executeSendLink,
    onDelta: input.onDelta,
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
  // First-token budget. Live canary measurement (gpt-4.1-mini, de-DE) showed
  // real first-token latency ~560-760 ms, so the previous 700 ms default
  // aborted the stream before the first token on most turns and the agent
  // always fell back. 1500 ms lets the model actually answer while still
  // capping true outliers; tune via env per model.
  const timeoutMs = Math.max(250, Number(process.env.DRKALLA_CUSTOM_RUNTIME_MODEL_TIMEOUT_MS ?? 1500));
  // Streaming budget: the first token must arrive inside timeoutMs; once
  // streaming, the stream may run up to this total wall-clock budget.
  const streamTotalMs = Math.max(800, Number(process.env.DRKALLA_CUSTOM_RUNTIME_STREAM_TOTAL_MS ?? 3500));
  const model = process.env.DRKALLA_CUSTOM_RUNTIME_MODEL || 'gpt-4.1-mini';
  const openai = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: timeoutMs,
  });
  return {
    complete: async ({ system, user, maxOutputChars }) => {
      try {
        const completion = await openai.chat.completions.create({
          model,
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
    completeStream: async ({ system, user, maxOutputChars, onDelta }) => {
      const controller = new AbortController();
      let accumulated = '';
      let sawFirstToken = false;
      const firstTokenTimer = setTimeout(() => {
        if (!sawFirstToken) controller.abort();
      }, timeoutMs);
      const totalTimer = setTimeout(() => controller.abort(), streamTotalMs);
      try {
        const stream = await openai.chat.completions.create(
          {
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            max_completion_tokens: Math.max(80, Math.ceil(maxOutputChars / 3)),
            temperature: 0.2,
            stream: true,
          },
          { signal: controller.signal, timeout: streamTotalMs },
        );
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (!delta) continue;
          sawFirstToken = true;
          accumulated += delta;
          onDelta(delta);
          if (accumulated.length >= maxOutputChars) {
            controller.abort();
            break;
          }
        }
      } catch {
        // Abort or transport error: whatever was accumulated is the answer;
        // empty means the caller falls back deterministically.
      } finally {
        clearTimeout(firstTokenTimer);
        clearTimeout(totalTimer);
      }
      return accumulated;
    },
  };
}

export async function registerRetellDrkallaCustomLlmWs(
  app: FastifyInstance,
  options: {
    client?: DrkallaCustomLlmClient;
    detectProducts?: DrkallaProductNameDetector;
    evidenceLookup?: DrkallaProductEvidenceLookup;
  } = {},
): Promise<void> {
  const aliasEntries = options.detectProducts ? [] : loadDrkallaProductNameEntries();
  const detectProducts = options.detectProducts
    ?? (aliasEntries.length ? buildDrkallaProductNameDetector(aliasEntries) : undefined);
  const detectAmbiguousProduct: DrkallaAmbiguousProductNameDetector | undefined = aliasEntries.length
    ? buildDrkallaAmbiguousProductNameDetector(aliasEntries)
    : undefined;
  const evidenceLookup = options.evidenceLookup ?? loadDrkallaProductEvidenceLookup();
  // Real SMS sending stays off unless explicitly enabled; the executor goes
  // through the existing policied send_link tool endpoint (live-call verify,
  // URL allowlist, per-call dedupe, audit trace) via local injection.
  const smsToolEnabled = process.env.DRKALLA_CUSTOM_RUNTIME_SMS_TOOL_ENABLED === 'true';
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
    let noInputReminderCount = 0;
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
      const isReminderTurn = parsedPreview?.interactionType === 'reminder_required';
      // Both response and reminder turns produce a spoken frame and so must
      // claim arrival order; a reminder is dropped if the caller speaks first.
      const myArrival = (isResponseTurn || isReminderTurn) ? ++latestArrival : latestArrival;

      // Serialize turns per socket so concurrent events cannot drop memory
      // updates (lost-update race on the shared per-session memory).
      processing = processing.then(async () => {
        try {
          if (isResponseTurn) {
            turnCounter += 1;
            noInputReminderCount = 0; // the caller spoke; reset silence nudges
          }
          if (isReminderTurn) noInputReminderCount += 1;
          const startedAt = Date.now();
          let firstFrameMs: number | null = null;
          let sentText = '';
          let deltaBuffer = '';

          const sendFrame = (content: string, complete: boolean) => {
            if (!parsedPreview) return;
            if (myArrival !== latestArrival) return; // stale: a newer turn arrived
            if (firstFrameMs === null) firstFrameMs = Date.now() - startedAt;
            socket.send(JSON.stringify({
              response_type: 'response',
              response_id: parsedPreview.providerResponseId,
              content,
              content_complete: complete,
              end_call: false,
            }));
            if (!complete) sentText += content;
          };

          // Buffer streamed deltas to sentence boundaries (or ~60 chars) so
          // Retell TTS gets natural prosody chunks instead of single tokens.
          const onDelta = (chunk: string) => {
            deltaBuffer += chunk;
            if (/[.!?]\s*$/.test(deltaBuffer) || deltaBuffer.length >= 60) {
              sendFrame(deltaBuffer, false);
              deltaBuffer = '';
            }
          };

          const executeSendLink = smsToolEnabled
            ? async (link: { url: string; label: string; linkKind: 'product' | 'profi' }) => {
                try {
                  const injected = await app.inject({
                    method: 'POST',
                    url: `${DRKALLA_LINK_TOOL_PATH}?drkalla_sig=${drkallaLinkToolSignature()}`,
                    payload: {
                      call: { call_id: callId },
                      args: { url: link.url, label: link.label, linkKind: link.linkKind },
                    },
                  });
                  const result = injected.json() as { smsSent?: unknown; duplicate?: unknown };
                  return {
                    smsSent: result?.smsSent === true,
                    duplicate: result?.duplicate === true,
                  };
                } catch {
                  return { smsSent: false };
                }
              }
            : undefined;

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
            completeStream: client.completeStream,
            detectProducts,
            detectAmbiguousProduct,
            evidenceLookup,
            executeSendLink,
            sequence: turnCounter,
            noInputReminderCount,
            onDelta: isResponseTurn ? onDelta : undefined,
          });
          if (!outbound) return;
          if ((isResponseTurn || isReminderTurn) && myArrival !== latestArrival) return;

          // Final frame carries whatever was not streamed yet. If trimming or
          // fallback changed the text so streamed chunks are no longer a
          // prefix, fall back to a single full final frame.
          const fullText = String(outbound.content);
          const tail = fullText.startsWith(sentText) ? fullText.slice(sentText.length) : fullText;
          sendFrame(tail, true);

          app.log.info(
            {
              turn: turnCounter,
              firstFrameMs: firstFrameMs ?? Date.now() - startedAt,
              totalMs: Date.now() - startedAt,
              streamedFrames: sentText.length > 0,
            },
            'drkalla canary turn latency',
          );
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
