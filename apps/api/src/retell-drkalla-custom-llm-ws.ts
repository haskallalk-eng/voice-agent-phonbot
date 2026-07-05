import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import type { WebSocket } from 'ws';
import {
  buildDrkallaCustomLlmResponse,
  type DrkallaConversationTurn,
  type DrkallaCustomLlmClient,
  type DrkallaCustomLlmResponse,
  type DrkallaSendLinkExecutor,
} from './drkalla-custom-llm-responder.js';
import {
  buildDrkallaProductEvidenceLookup,
  type DrkallaProductEvidenceLookup,
  type DrkallaRawCatalogProduct,
} from './drkalla-product-evidence.js';
import {
  buildDrkallaProductCatalogSearch,
  buildDrkallaExternalBrandStock,
  buildDrkallaColorShadeSummary,
  drkallaVarietySeedFromCallId,
  type DrkallaProductCatalogSearch,
  type DrkallaExternalBrandStock,
  type DrkallaCatalogSearchRawProduct,
  type DrkallaColorShadeSummary,
} from './drkalla-product-catalog-search.js';
import {
  buildDrkallaFaqMatcher,
  type DrkallaFaqMatcher,
  type DrkallaFaqRawEntry,
} from './drkalla-faq-match.js';
import {
  buildDrkallaKnowledgeRetriever,
  type DrkallaKnowledgeRetriever,
  type DrkallaKnowledgeChunksSnapshot,
} from './drkalla-knowledge-chunks-retriever.js';
import {
  buildDrkallaLiveOverlay,
  type DrkallaLiveOverlay,
  type DrkallaPublishPayload,
} from './drkalla-faq-overlay.js';
import type { DrkallaContactFacts } from './drkalla-contact-facts.js';
import {
  buildDrkallaSummaryMessages,
  selectDrkallaOlderTurns,
  shouldRefreshDrkallaSummary,
} from './drkalla-conversation-summary.js';
import { DRKALLA_LINK_TOOL_PATH, drkallaLinkToolSignature } from './drkalla-link-tool.js';
import {
  createDrkallaCanaryLatencyRecorder,
  type DrkallaCanaryLatencyRecorder,
} from './drkalla-canary-latency-stats.js';
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
import {
  buildDrkallaKnowledgeChunks,
  buildDrkallaKnowledgeSeedsFromData,
} from './scripts/build-drkalla-knowledge-chunks.js';
import {
  readDrkallaCentralSnapshot,
  refreshDrkallaCentralKnowledge,
} from './drkalla-central-knowledge.js';
import { scoreDrkallaTurnReadiness } from './drkalla-turn-readiness.js';
import { speakDrkallaText, speakDrkallaPriceText } from './drkalla-speakable.js';
import type { AgentTurnRequestedEvent } from './voice-runtime-contract.js';

// Content-aware turn hold: how many consecutive incomplete utterances we stay
// silent on before answering anyway, so a misclassification can never make the
// agent go permanently silent within one gap.
const DRKALLA_MAX_CONSECUTIVE_HOLDS = 2;

const SAFE_UNAVAILABLE_TEXT = 'Entschuldigung, ich kann gerade nicht weiterhelfen. Bitte versuchen Sie es später noch einmal oder besuchen Sie uns auf Doktor Kalla punkt com.';

// Custom-llm agents have no Retell begin_message; Retell elicits the agent's
// first line via an empty response_required at call start. This deterministic
// Sie greeting is spoken then (no model call), so the very first thing the
// caller hears is on-brand and in the right register.
// "Doktor Kalla" (not "Dr.Kalla") so the neural TTS reads it as one warm name
// instead of an audible mid-name period/abbreviation; "der Assistent von Doktor
// Kalla" flows better than the compound "der Dr.Kalla Assistent".
export const DRKALLA_CUSTOM_RUNTIME_GREETING = 'Hallo, hier ist der Assistent von Doktor Kalla Cosmetics. Wie kann ich Ihnen beim Friseurbedarf helfen?';

// Only the deterministic confirm path can actually send an SMS — a MODEL
// sentence that PROMISES a send ("Ich sende Ihnen gleich den Link …") is a
// false claim: it reached the TTS raw and no SMS ever went out, three times in
// one call (live 2026-06-29). Promise sentences are rewritten into the
// compliant OFFER question; committing that offer as lastAgentQuestion (see
// the turn body) makes the caller's following "Ja" trigger a REAL send.
// Truthful past confirmations after a real send ("ich habe … geschickt",
// "wurde soeben verschickt") are deliberately NOT matched.
const DRKALLA_SEND_PROMISE = /\bich\s+(?:sende|schicke|werde\b[^.?!]*\b(?:send|schick)\w*)\b[^.?!]*\b(?:link|sms|nachricht)\b/i;

export function rewriteDrkallaSendPromise(text: string, offer: string): { text: string; rewritten: boolean } {
  if (!DRKALLA_SEND_PROMISE.test(text)) return { text, rewritten: false };
  let rewritten = false;
  const out = text
    .split(/(?<=[.!?])/)
    .map((sentence) => {
      if (sentence.includes('?')) return sentence; // already an offer/question
      if (!DRKALLA_SEND_PROMISE.test(sentence)) return sentence;
      rewritten = true;
      const lead = /^\s*/.exec(sentence)?.[0] ?? '';
      return `${lead}${offer}`;
    })
    .join('');
  return { text: out, rewritten };
}

export function buildDrkallaSendOfferQuestion(memory: DrkallaShortTermVoiceMemory): string {
  const product = memory.lastMentionedProduct?.spokenName;
  if (product) return `Soll ich Ihnen den Link zu ${product} per SMS schicken?`;
  const category = memory.activeProductType?.label;
  if (category) return `Soll ich Ihnen den Link zu unserer ${category}-Auswahl per SMS schicken?`;
  return 'Soll ich Ihnen den Link per SMS schicken?';
}

// Spoken when the agent is switched OFF (env gate or the platform's on/off toggle):
// one short line, then hang up — the caller is never left in silence.
export const DRKALLA_CUSTOM_RUNTIME_UNAVAILABLE = 'Hallo, der telefonische Assistent von Doktor Kalla ist im Moment leider nicht verfügbar. Bitte versuchen Sie es später noch einmal. Auf Wiederhören.';

export type RetellDrkallaCustomLlmParsedMessage = {
  interactionType: string;
  responseId: string;
  providerResponseId: string | number;
  currentUserText: string;
  history: DrkallaConversationTurn[];
  allTurns: DrkallaConversationTurn[];
};

export type RetellDrkallaCustomLlmReply = {
  response_type: 'response';
  response_id: string | number;
  content: string;
  content_complete: true;
  end_call: boolean;
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

/**
 * Extract the recent prior turns of the call from Retell's transcript so the
 * model keeps the topic across turns. Retell already sends the full transcript
 * in every message — we simply pass a short window through (no extra LLM/KB
 * call, no added latency). The FINAL user turn is the current utterance (handled
 * separately as currentUserText), so it is dropped here to avoid duplication.
 */
export function extractRetellDrkallaAllTurns(transcript: unknown): DrkallaConversationTurn[] {
  if (!Array.isArray(transcript)) return [];
  const turns: DrkallaConversationTurn[] = [];
  for (const turn of transcript) {
    const item = asObject(turn) as RetellTranscriptTurn | null;
    if (!item) continue;
    const text = firstString(item.content, item.text);
    if (!text) continue;
    const role: 'user' | 'agent' =
      typeof item.role === 'string' && item.role.toLowerCase() === 'user' ? 'user' : 'agent';
    turns.push({ role, text });
  }
  // The final user turn is the current utterance (handled separately) — drop it.
  if (turns.length && turns[turns.length - 1]?.role === 'user') turns.pop();
  return turns;
}

export function extractRetellDrkallaRecentTurns(transcript: unknown, maxTurns = 6): DrkallaConversationTurn[] {
  return extractRetellDrkallaAllTurns(transcript).slice(-Math.max(0, maxTurns));
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

  const allTurns = extractRetellDrkallaAllTurns(message.transcript);
  return {
    interactionType,
    responseId,
    providerResponseId,
    currentUserText,
    history: allTurns.slice(-6),
    allTurns,
  };
}

export type RetellDrkallaControlFrame = {
  interactionType: string;
  timestamp: number | null;
  fromNumber: string;
};

/**
 * Lightweight read of the real Retell custom-LLM control frames that carry no
 * response_id and so are rejected by parseRetellDrkallaCustomLlmMessage:
 *   - ping_pong   : keepalive; Retell expects the same timestamp echoed back.
 *   - call_details: one-shot call metadata at connect (from/to numbers, etc.).
 *   - update_only : transcript refresh with no reply expected.
 * Fail-soft: malformed frames return null and are treated as unknown/no-op.
 */
export function parseRetellControlFrame(raw: string): RetellDrkallaControlFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const message = asObject(parsed);
  if (!message) return null;
  const interactionType = firstString(message.interaction_type, message.event);
  if (!interactionType) return null;
  const ts = message.timestamp;
  const timestamp = typeof ts === 'number' && Number.isFinite(ts) ? ts : null;
  const call = asObject(message.call);
  const fromNumber = call ? firstString(call.from_number, call.from) : '';
  return { interactionType, timestamp, fromNumber };
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

/**
 * One-time startup load of the deterministic catalog category/need search from
 * the products snapshot (never per turn). Lets the agent NAME real products for
 * open-ended needs ("was habt ihr für Dauerwelle?") instead of looping.
 */
export function loadDrkallaProductCatalogSearch(productsPath?: string): DrkallaProductCatalogSearch | undefined {
  try {
    const parsed = readFirstJson(
      resolveDrkallaSnapshotPath('drkalla-products.json', productsPath ?? process.env.DRKALLA_PRODUCTS_PATH),
    ) as { products?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.products) || !parsed.products.length) return undefined;
    return buildDrkallaProductCatalogSearch(parsed.products as DrkallaCatalogSearchRawProduct[]);
  } catch {
    return undefined;
  }
}

/**
 * One-time startup load of the vendor-strict external-brand stock lookup from the
 * products snapshot (never per turn). Lets the agent answer a brand request
 * honestly: name the real product when we carry the brand (e.g. the L'Oréal Inoa)
 * and say "führen wir nicht" only when we genuinely do not.
 */
export function loadDrkallaExternalBrandStock(productsPath?: string): DrkallaExternalBrandStock | undefined {
  try {
    const parsed = readFirstJson(
      resolveDrkallaSnapshotPath('drkalla-products.json', productsPath ?? process.env.DRKALLA_PRODUCTS_PATH),
    ) as { products?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.products) || !parsed.products.length) return undefined;
    return buildDrkallaExternalBrandStock(parsed.products as DrkallaCatalogSearchRawProduct[]);
  } catch {
    return undefined;
  }
}

/**
 * Spoken color-shade summary aggregated from the color products' variant
 * titles, built once at startup. Lets the agent ANSWER "Was habt ihr für
 * Farben?" (live 2026-07-01: asked twice, got a product pitch both times).
 */
export function loadDrkallaColorShadeSummary(productsPath?: string): DrkallaColorShadeSummary | undefined {
  try {
    const parsed = readFirstJson(
      resolveDrkallaSnapshotPath('drkalla-products.json', productsPath ?? process.env.DRKALLA_PRODUCTS_PATH),
    ) as { products?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.products) || !parsed.products.length) return undefined;
    return buildDrkallaColorShadeSummary(parsed.products as DrkallaCatalogSearchRawProduct[]) ?? undefined;
  } catch {
    return undefined;
  }
}

export function loadDrkallaFaqMatcher(faqPath?: string): DrkallaFaqMatcher | undefined {
  try {
    const parsed = readFirstJson(
      resolveDrkallaSnapshotPath('drkalla-faq.json', faqPath ?? process.env.DRKALLA_FAQ_PATH),
    ) as { entries?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.entries) || !parsed.entries.length) return undefined;
    return buildDrkallaFaqMatcher(parsed.entries as DrkallaFaqRawEntry[]);
  } catch {
    return undefined;
  }
}

/**
 * One-time startup load of the in-memory chunked-document retriever (shop
 * policies, product usage/info, ingested PDFs) from the chunk snapshot. Fail-soft:
 * a missing/invalid snapshot disables the layer (the agent answers as before).
 * The retriever is synchronous + pure in-memory — no per-turn network/DB.
 */
export function loadDrkallaKnowledgeRetriever(chunksPath?: string): DrkallaKnowledgeRetriever | undefined {
  try {
    const parsed = readFirstJson(
      resolveDrkallaSnapshotPath('drkalla-knowledge-chunks.json', chunksPath ?? process.env.DRKALLA_KNOWLEDGE_CHUNKS_PATH),
    ) as DrkallaKnowledgeChunksSnapshot | null;
    if (!parsed || !Array.isArray(parsed.chunks) || !parsed.chunks.length) return undefined;
    return buildDrkallaKnowledgeRetriever(parsed);
  } catch {
    return undefined;
  }
}

function loadDrkallaFaqRawEntries(faqPath?: string): DrkallaFaqRawEntry[] {
  try {
    const parsed = readFirstJson(
      resolveDrkallaSnapshotPath('drkalla-faq.json', faqPath ?? process.env.DRKALLA_FAQ_PATH),
    ) as { entries?: unknown } | null;
    return parsed && Array.isArray(parsed.entries) ? (parsed.entries as DrkallaFaqRawEntry[]) : [];
  } catch {
    return [];
  }
}

function loadDrkallaBakedSnapshotScrapedAt(productsPath?: string): number | null {
  try {
    const parsed = readFirstJson(
      resolveDrkallaSnapshotPath('drkalla-products.json', productsPath ?? process.env.DRKALLA_PRODUCTS_PATH),
    ) as { scrapedAt?: unknown } | null;
    const ts = typeof parsed?.scrapedAt === 'string' ? Date.parse(parsed.scrapedAt) : NaN;
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

export type DrkallaVoiceRuntimeParts = {
  aliasEntries: DrkallaProductNameEntry[];
  detectProducts?: DrkallaProductNameDetector;
  detectAmbiguousProduct?: DrkallaAmbiguousProductNameDetector;
  evidenceLookup?: DrkallaProductEvidenceLookup;
  catalogSearch?: DrkallaProductCatalogSearch;
  brandStock?: DrkallaExternalBrandStock;
  colorShadeSummary?: DrkallaColorShadeSummary;
  knowledgeRetriever?: DrkallaKnowledgeRetriever;
};

/**
 * DETERMINISTIC derivation central snapshot → voice-optimized in-memory
 * structures. Same inputs, same result — the central DB rows are the source of
 * truth, this is the voice agent's latency-shaped projection of them (owner
 * architecture 2026-07-05). Curated alias entries survive for products still
 * live, new products get conservative exact-title entries, dead handles drop
 * (this automates the 2026-07-05 manual alias patch).
 */
export async function deriveDrkallaVoiceRuntimeFromSnapshot(input: {
  snapshot: { products?: unknown[]; pages?: Array<{ title?: string; url?: string; text?: string }> };
  bakedAliasEntries: DrkallaProductNameEntry[];
  faqEntries?: DrkallaFaqRawEntry[];
}): Promise<DrkallaVoiceRuntimeParts> {
  const products = (input.snapshot.products ?? []) as Array<{
    handle?: string; title?: string; url?: string; productType?: string | null; description?: string;
  }>;
  const liveHandles = new Set(products.map((p) => p.handle).filter(Boolean));
  const aliasEntries: DrkallaProductNameEntry[] = input.bakedAliasEntries.filter((e) => liveHandles.has(e.productId));
  const known = new Set(aliasEntries.map((e) => e.productId));
  for (const p of products) {
    if (!p.handle || !p.title || known.has(p.handle)) continue;
    aliasEntries.push({
      productId: p.handle,
      spokenName: p.title,
      productKind: p.productType ?? null,
      url: typeof p.url === 'string' ? p.url : undefined,
      aliases: [],
    });
  }
  const rawProducts = products as DrkallaCatalogSearchRawProduct[];
  const evidence = products.length
    ? buildDrkallaProductEvidenceLookup(products as unknown as DrkallaRawCatalogProduct[])
    : undefined;
  const chunksSnapshot = await buildDrkallaKnowledgeChunks({
    seeds: buildDrkallaKnowledgeSeedsFromData({
      products,
      pages: input.snapshot.pages,
      faqEntries: input.faqEntries,
    }),
  });
  return {
    aliasEntries,
    detectProducts: aliasEntries.length ? buildDrkallaProductNameDetector(aliasEntries) : undefined,
    detectAmbiguousProduct: aliasEntries.length ? buildDrkallaAmbiguousProductNameDetector(aliasEntries) : undefined,
    evidenceLookup: evidence && evidence.size > 0 ? evidence : undefined,
    catalogSearch: products.length ? buildDrkallaProductCatalogSearch(rawProducts) : undefined,
    brandStock: products.length ? buildDrkallaExternalBrandStock(rawProducts) : undefined,
    colorShadeSummary: products.length ? buildDrkallaColorShadeSummary(rawProducts) ?? undefined : undefined,
    knowledgeRetriever: chunksSnapshot.chunks.length ? buildDrkallaKnowledgeRetriever(chunksSnapshot) : undefined,
  };
}

function reply(responseId: string | number, content: string, endCall = false): RetellDrkallaCustomLlmReply {
  return {
    response_type: 'response',
    response_id: responseId,
    content,
    content_complete: true,
    end_call: endCall,
  };
}

export async function buildRetellDrkallaCustomLlmWsReply(input: {
  enabled: boolean;
  secretAccepted: boolean;
  rawMessage: string;
  callId?: string;
  memory?: DrkallaShortTermVoiceMemory;
  onMemory?: (memory: DrkallaShortTermVoiceMemory) => void;
  onQuality?: (quality: DrkallaCustomLlmResponse['quality']) => void;
  complete: DrkallaCustomLlmClient['complete'];
  completeStream?: DrkallaCustomLlmClient['completeStream'];
  detectProducts?: DrkallaProductNameDetector;
  detectAmbiguousProduct?: DrkallaAmbiguousProductNameDetector;
  evidenceLookup?: DrkallaProductEvidenceLookup;
  catalogSearch?: DrkallaProductCatalogSearch;
  brandStock?: DrkallaExternalBrandStock;
  colorShadeSummary?: DrkallaColorShadeSummary;
  faqMatch?: DrkallaFaqMatcher;
  knowledgeRetriever?: DrkallaKnowledgeRetriever;
  knowledgePriority?: boolean;
  contactFacts?: DrkallaContactFacts;
  conversationSummary?: string;
  executeSendLink?: DrkallaSendLinkExecutor;
  sequence?: number;
  noInputReminderCount?: number;
  // Per-call variety seed for the catalog tie rotation. Only the LIVE handler
  // sets it (hash of the Retell call id); sims/tests omit it, so their outputs
  // stay byte-identical to the unrotated baseline.
  varietySeed?: number;
  onDelta?: (chunk: string) => void;
  onFaqCandidate?: (question: string, answer: string) => void;
  onKnowledgeChunk?: (sourceId: string, chunkId: string, query: string, score: number) => void;
  signal?: AbortSignal;
  isCallOpening?: boolean;
}): Promise<RetellDrkallaCustomLlmReply | null> {
  if (!input.secretAccepted) return null;

  const parsed = parseRetellDrkallaCustomLlmMessage(input.rawMessage);
  if (!parsed) return null;

  // Call opening: greet deterministically in Sie (no model call) so the first
  // utterance is on-brand. Only when the canary is enabled; a disabled canary
  // falls through to the safe-unavailable path.
  if (input.isCallOpening && input.enabled && parsed.interactionType === 'response_required') {
    const memory = input.memory ?? createDrkallaShortTermMemory();
    input.onMemory?.(reduceDrkallaShortTermMemory(
      memory,
      deriveDrkallaAgentSpokeEvent({ text: DRKALLA_CUSTOM_RUNTIME_GREETING, turnIndex: input.sequence ?? 0 }),
    ));
    return reply(parsed.providerResponseId, DRKALLA_CUSTOM_RUNTIME_GREETING);
  }

  // Caller went silent (Retell reminder). Re-engage deterministically: no
  // model call. Retell still owns the hard silence timeout — EXCEPT after a
  // completed wind-down (caller declined, said Nein, then went silent): a
  // second reminder then says goodbye and ends the call instead of nagging a
  // caller who is clearly done (live 2026-06-30: the reminder resurrected the
  // four-times-declined product). Never fires without a prior explicit decline.
  if (parsed.interactionType === 'reminder_required') {
    const memory = input.memory ?? createDrkallaShortTermMemory();
    const count = Math.max(1, input.noInputReminderCount ?? 1);
    if (memory.topicClosed && count >= 2) {
      const byeText = 'Dann wünsche ich Ihnen einen schönen Tag. Auf Wiederhören!';
      input.onMemory?.(reduceDrkallaShortTermMemory(
        memory,
        deriveDrkallaAgentSpokeEvent({ text: byeText, turnIndex: input.sequence ?? 0 }),
      ));
      return reply(parsed.providerResponseId, byeText, true);
    }
    const reminderText = nextDrkallaNoInputReminder(memory, count);
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
          // 1100, not 800: owner-overridable Kontakt-Fakt lines (bis 200 Zeichen)
          // plus both evidence lines could exceed 800 even after shedding; the
          // ~10-15ms extra prefill is far cheaper than a degraded turn.
          maxDirectiveChars: 1100,
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
    catalogSearch: input.catalogSearch,
    brandStock: input.brandStock,
    colorShadeSummary: input.colorShadeSummary,
    faqMatch: input.faqMatch,
    knowledgeRetriever: input.knowledgeRetriever,
    knowledgePriority: input.knowledgePriority,
    contactFacts: input.contactFacts,
    varietySeed: input.varietySeed,
    // Recent prior turns of this call → the model keeps the topic (no extra call).
    conversationHistory: parsed.history,
    // Rolling note for the older part of long calls (built off the hot path).
    conversationSummary: input.conversationSummary,
    executeSendLink: input.executeSendLink,
    onDelta: input.onDelta,
    onFaqCandidate: input.onFaqCandidate,
    onKnowledgeChunk: input.onKnowledgeChunk,
    signal: input.signal,
  });
  input.onMemory?.(response.memory);
  input.onQuality?.(response.quality);

  // Never speak internal diagnostics ("Canary disabled: ...") to a caller.
  return reply(
    parsed.providerResponseId,
    response.blocked ? SAFE_UNAVAILABLE_TEXT : response.text,
    response.blocked ? false : response.endCall === true,
  );
}

function secretAccepted(configuredSecret: string | undefined, candidate: unknown): boolean {
  if (!configuredSecret || typeof candidate !== 'string') return false;
  if (configuredSecret.length < 16) return false;
  const left = Buffer.from(configuredSecret);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

// GPT-5.x chat models run internal reasoning BY DEFAULT, which adds hundreds of ms
// to seconds of time-to-first-token — fatal for a live voice turn (it blows past
// DRKALLA_CUSTOM_RUNTIME_MODEL_TIMEOUT_MS and every turn falls back to a robotic
// deterministic template). Force reasoning OFF for any gpt-5* model unless an env
// override is set. gpt-4.x/4o do not accept the field, but a `undefined` value is
// omitted from the request body, so this is safe for every model. Verified live
// (2026-07-01): gpt-5.4-mini needs reasoning_effort 'none' (not 'minimal').
function drkallaReasoningEffort(model: string): string | undefined {
  const override = process.env.DRKALLA_CUSTOM_RUNTIME_REASONING_EFFORT?.trim();
  if (override) return override;
  return /^gpt-5/i.test(model) ? 'none' : undefined;
}

// GPT-5.x native verbosity steering: 'low' pushes the model toward the "two
// short sentences" voice style at the source instead of relying only on the
// 420-char cap — fewer generated tokens, shorter generation time. Omitted for
// gpt-4.x (undefined is dropped from the request body).
function drkallaVerbosity(model: string): string | undefined {
  const override = process.env.DRKALLA_CUSTOM_RUNTIME_VERBOSITY?.trim();
  if (override) return override;
  return /^gpt-5/i.test(model) ? 'low' : undefined;
}

// Provider warm-up throttle, module-level: the client is per-connection, but
// the cold-start being warmed (TLS/route to OpenAI) is process-wide.
let drkallaLastModelWarmAt = 0;
const DRKALLA_MODEL_WARM_INTERVAL_MS = 5 * 60_000;

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
  // Cast: the SDK's typed union lags the API's accepted values ('none'/'xhigh');
  // undefined (for gpt-4.x) is dropped from the request body.
  const reasoningEffort = drkallaReasoningEffort(model) as
    OpenAI.Chat.Completions.ChatCompletionCreateParams['reasoning_effort'];
  const verbosity = drkallaVerbosity(model) as
    OpenAI.Chat.Completions.ChatCompletionCreateParams['verbosity'];
  const openai = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: timeoutMs,
  });
  return {
    complete: async ({ system, user, maxOutputChars, signal }) => {
      if (signal?.aborted) return ''; // barge-in: a newer turn already arrived
      try {
        const completion = await openai.chat.completions.create(
          {
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            max_completion_tokens: Math.max(80, Math.ceil(maxOutputChars / 3)),
            temperature: 0.2,
            reasoning_effort: reasoningEffort,
            verbosity,
          },
          { signal },
        );
        return completion.choices[0]?.message?.content ?? '';
      } catch {
        return '';
      }
    },
    completeStream: async ({ system, user, maxOutputChars, onDelta, signal }) => {
      const controller = new AbortController();
      let accumulated = '';
      let sawFirstToken = false;
      const firstTokenTimer = setTimeout(() => {
        if (!sawFirstToken) controller.abort();
      }, timeoutMs);
      const totalTimer = setTimeout(() => controller.abort(), streamTotalMs);
      // Barge-in: a newer caller turn aborts the in-flight stream so the
      // serialized chain advances immediately instead of waiting out the
      // stale turn's stream budget. Chain the external signal onto the local
      // timer controller and detach the listener when the turn ends.
      const onExternalAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onExternalAbort, { once: true });
      }
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
            reasoning_effort: reasoningEffort,
            verbosity,
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
        signal?.removeEventListener('abort', onExternalAbort);
      }
      return accumulated;
    },
    // Background rolling-summary call. OFF the hot path, so it gets a generous
    // timeout (it must never block a turn) and a small output budget.
    summarize: async ({ system, user, signal }) => {
      if (signal?.aborted) return '';
      try {
        const completion = await openai.chat.completions.create(
          {
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            max_completion_tokens: 220,
            temperature: 0.2,
            reasoning_effort: reasoningEffort,
          },
          { signal, timeout: 10_000 },
        );
        return completion.choices[0]?.message?.content ?? '';
      } catch {
        return '';
      }
    },
    // Fire-and-forget provider warm-up at call start: after idle hours the
    // first real model turn paid the full cold TLS/route setup (live
    // 2026-07-04: turn 1 took ~4.4s against a 4s first-token budget). One
    // 1-token request while the greeting plays absorbs it; throttled so busy
    // periods do not re-warm on every call.
    warmup: () => {
      const now = Date.now();
      if (now - drkallaLastModelWarmAt < DRKALLA_MODEL_WARM_INTERVAL_MS) return;
      drkallaLastModelWarmAt = now;
      void openai.chat.completions
        .create(
          {
            model,
            messages: [{ role: 'user', content: 'OK' }],
            max_completion_tokens: 1,
            reasoning_effort: reasoningEffort,
          },
          { timeout: 8_000 },
        )
        .catch(() => {});
    },
  };
}

export async function registerRetellDrkallaCustomLlmWs(
  app: FastifyInstance,
  options: {
    client?: DrkallaCustomLlmClient;
    detectProducts?: DrkallaProductNameDetector;
    evidenceLookup?: DrkallaProductEvidenceLookup;
    catalogSearch?: DrkallaProductCatalogSearch;
    brandStock?: DrkallaExternalBrandStock;
    colorShadeSummary?: DrkallaColorShadeSummary;
    faqMatch?: DrkallaFaqMatcher;
    knowledgeRetriever?: DrkallaKnowledgeRetriever;
  } = {},
): Promise<void> {
  // The voice runtime deps are MUTABLE (let): the central-knowledge refresh
  // re-derives and swaps them in place, so a data update needs NO restart and
  // in-flight calls simply see the fresh catalog on their next turn.
  const bakedAliasEntries = options.detectProducts ? [] : loadDrkallaProductNameEntries();
  let aliasEntries = bakedAliasEntries;
  let detectProducts = options.detectProducts
    ?? (aliasEntries.length ? buildDrkallaProductNameDetector(aliasEntries) : undefined);
  let detectAmbiguousProduct: DrkallaAmbiguousProductNameDetector | undefined = aliasEntries.length
    ? buildDrkallaAmbiguousProductNameDetector(aliasEntries)
    : undefined;
  let evidenceLookup = options.evidenceLookup ?? loadDrkallaProductEvidenceLookup();
  let catalogSearch = options.catalogSearch ?? loadDrkallaProductCatalogSearch();
  let brandStock = options.brandStock ?? loadDrkallaExternalBrandStock();
  let colorShadeSummary = options.colorShadeSummary ?? loadDrkallaColorShadeSummary();
  const faqMatch = options.faqMatch ?? loadDrkallaFaqMatcher();
  let knowledgeRetriever = options.knowledgeRetriever ?? loadDrkallaKnowledgeRetriever();
  // Real SMS sending stays off unless explicitly enabled; the executor goes
  // through the existing policied send_link tool endpoint (live-call verify,
  // URL allowlist, per-call dedupe, audit trace) via local injection.
  const smsToolEnabled = process.env.DRKALLA_CUSTOM_RUNTIME_SMS_TOOL_ENABLED === 'true';
  // Process-wide rolling latency stats from the real WS turns (shared across
  // calls). Only the two timings the custom-LLM socket truly observes are
  // recorded; no ASR/provider timestamps are fabricated. See PLANS.md: p50<=
  // 500ms is unmet on MODEL turns (TTFT-bound) but met on deterministic turns.
  const latencyRecorder: DrkallaCanaryLatencyRecorder = createDrkallaCanaryLatencyRecorder();

  // Live "publish overlay": the platform (dr-kalla-ultimate-app) POSTs the
  // approved FAQ + an on/off flag here; this in-memory overlay then overrides the
  // baked FAQ matcher and the on/off, so an owner edit takes effect in seconds
  // without a redeploy. In-memory only (v1): a restart reverts to baked snapshots
  // until the next publish (the platform is the source of truth).
  let liveOverlay: DrkallaLiveOverlay = { faqCount: 0, knowledgeChunks: 0 };

  // Authenticated publish endpoint (reachable from the platform via Caddy's
  // /retell* proxy). Shared-secret auth, timing-safe; reuses secretAccepted().
  const publishSecret = process.env.DRKALLA_ADMIN_PUBLISH_SECRET;
  app.post('/retell/custom-llm/drkalla/admin/publish', async (request, reply) => {
    const header = typeof request.headers.authorization === 'string'
      ? request.headers.authorization.replace(/^Bearer\s+/i, '')
      : '';
    const body = (request.body ?? {}) as DrkallaPublishPayload & { secret?: unknown };
    const candidate = header || (typeof body.secret === 'string' ? body.secret : '');
    if (!secretAccepted(publishSecret, candidate)) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
    try {
      liveOverlay = await buildDrkallaLiveOverlay(body, new Date().toISOString());
      app.log.info(
        { event: 'drkalla_publish', faqCount: liveOverlay.faqCount, knowledgeChunks: liveOverlay.knowledgeChunks, contactOverride: !!liveOverlay.contactFacts, enabled: liveOverlay.enabled ?? null },
        'drkalla canary publish applied',
      );
      return reply.send({
        ok: true,
        faqCount: liveOverlay.faqCount,
        knowledgeChunks: liveOverlay.knowledgeChunks,
        contactOverride: !!liveOverlay.contactFacts,
        enabled: liveOverlay.enabled ?? null,
        publishedAt: liveOverlay.publishedAt,
      });
    } catch (error) {
      app.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'drkalla canary publish failed');
      return reply.code(400).send({ ok: false, error: 'invalid_payload' });
    }
  });

  // Read-only status for the platform to confirm what is live.
  app.get('/retell/custom-llm/drkalla/admin/status', async (request, reply) => {
    const header = typeof request.headers.authorization === 'string'
      ? request.headers.authorization.replace(/^Bearer\s+/i, '')
      : '';
    const q = request.query as { secret?: string };
    if (!secretAccepted(publishSecret, header || q.secret || '')) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
    return reply.send({
      ok: true,
      envEnabled: process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED === 'true',
      overlayEnabled: liveOverlay.enabled ?? null,
      faqCount: liveOverlay.faqCount,
      knowledgeChunks: liveOverlay.knowledgeChunks,
      contactOverride: !!liveOverlay.contactFacts,
      publishedAt: liveOverlay.publishedAt ?? null,
    });
  });

  // ── CENTRAL-KNOWLEDGE AUTO-REFRESH (owner architecture 2026-07-05) ────────
  // website → central Postgres (canonical, all agents) → deterministic derive
  // → in-place swap of the voice deps above. Gated by env; every step fail-soft
  // (a bad scrape or DB outage keeps the last good in-memory state).
  const faqEntriesForSeeds = loadDrkallaFaqRawEntries();
  let lastVoiceReload: { at: string; source: string; products: number } | null = null;
  const applyCentralSnapshot = async (
    snapshot: { products?: unknown[]; pages?: Array<{ title?: string; url?: string; text?: string }>; productCount?: number; scrapedAt?: string },
    source: string,
  ): Promise<void> => {
    const parts = await deriveDrkallaVoiceRuntimeFromSnapshot({
      snapshot,
      bakedAliasEntries,
      faqEntries: faqEntriesForSeeds,
    });
    aliasEntries = parts.aliasEntries;
    detectProducts = parts.detectProducts;
    detectAmbiguousProduct = parts.detectAmbiguousProduct;
    evidenceLookup = parts.evidenceLookup;
    catalogSearch = parts.catalogSearch;
    brandStock = parts.brandStock;
    colorShadeSummary = parts.colorShadeSummary;
    knowledgeRetriever = parts.knowledgeRetriever;
    lastVoiceReload = { at: new Date().toISOString(), source, products: (snapshot.products ?? []).length };
    app.log.info(
      { event: 'drkalla_voice_reload', source, products: (snapshot.products ?? []).length, aliases: parts.aliasEntries.length, snapshotAt: snapshot.scrapedAt ?? null },
      'drkalla voice runtime deps swapped',
    );
  };

  let centralRefreshRunning = false;
  const runCentralRefresh = async (trigger: string) => {
    if (centralRefreshRunning) return { status: 'already_running' as const };
    centralRefreshRunning = true;
    try {
      // The curated FAQ syncs into the central store (kind 'faq') alongside the
      // scrape, so ALL agents share the same human-approved answers.
      const result = await refreshDrkallaCentralKnowledge(undefined, { faqEntries: loadDrkallaFaqRawEntries() });
      if (result.status === 'ok') {
        await applyCentralSnapshot(result.snapshot, `refresh:${trigger}`);
        app.log.info(
          { event: 'drkalla_central_refresh', trigger, status: result.status, products: result.snapshot.productCount, added: result.counts.added, changed: result.counts.changed, removed: result.counts.removed, dbPersisted: result.dbPersisted, durationMs: result.durationMs },
          'drkalla central knowledge refreshed',
        );
      } else {
        app.log.warn(
          { event: 'drkalla_central_refresh', trigger, status: result.status, durationMs: result.durationMs, ...(result.status === 'validation_failed' ? { reasons: result.reasons } : {}), ...(result.status === 'error' ? { error: result.error } : {}) },
          'drkalla central knowledge refresh did not apply',
        );
      }
      return result;
    } finally {
      centralRefreshRunning = false;
    }
  };

  // Manual trigger + status for ops (same shared-secret auth as publish).
  app.post('/retell/custom-llm/drkalla/admin/refresh-central', async (request, reply) => {
    const header = typeof request.headers.authorization === 'string'
      ? request.headers.authorization.replace(/^Bearer\s+/i, '')
      : '';
    const body = (request.body ?? {}) as { secret?: unknown };
    if (!secretAccepted(publishSecret, header || (typeof body.secret === 'string' ? body.secret : ''))) {
      return reply.code(401).send({ ok: false, error: 'unauthorized' });
    }
    const result = await runCentralRefresh('manual');
    return reply.send({
      ok: result.status === 'ok',
      status: result.status,
      ...(result.status === 'ok'
        ? { products: result.snapshot.productCount, added: result.counts.added, changed: result.counts.changed, removed: result.counts.removed, dbPersisted: result.dbPersisted, durationMs: result.durationMs }
        : {}),
      ...(result.status === 'validation_failed' ? { reasons: result.reasons } : {}),
      ...(result.status === 'error' ? { error: result.error } : {}),
      lastVoiceReload,
    });
  });

  const centralRefreshEnabled = process.env.DRKALLA_CENTRAL_REFRESH_ENABLED === 'true';
  if (centralRefreshEnabled) {
    // Boot: adopt fresher CENTRAL rows immediately (no network) — the DB
    // outlives deploys, so a restart keeps yesterday's refresh instead of
    // silently reverting to the baked snapshot.
    void (async () => {
      try {
        const central = await readDrkallaCentralSnapshot();
        const bakedAt = loadDrkallaBakedSnapshotScrapedAt();
        if (central && (!bakedAt || Date.parse(central.scrapedAt) > bakedAt)) {
          await applyCentralSnapshot(central, 'boot:central-db');
        }
      } catch (error) {
        app.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'drkalla central boot adoption failed');
      }
    })();
    const intervalHours = Math.max(1, Number(process.env.DRKALLA_CENTRAL_REFRESH_HOURS ?? 24) || 24);
    const bootDelayMs = Math.max(10_000, Number(process.env.DRKALLA_CENTRAL_REFRESH_BOOT_DELAY_MS ?? 300_000) || 300_000);
    const intervalTimer = setInterval(() => { void runCentralRefresh('interval'); }, intervalHours * 3_600_000);
    const bootTimer = setTimeout(() => { void runCentralRefresh('boot'); }, bootDelayMs);
    intervalTimer.unref?.();
    bootTimer.unref?.();
    app.addHook('onClose', async () => {
      clearInterval(intervalTimer);
      clearTimeout(bootTimer);
    });
  }

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
    // Effective on/off: the env gate AND the platform's live override (the owner's
    // "Agent ausschalten" sets overlay.enabled=false → calls are declined).
    const enabled = process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED === 'true'
      && liveOverlay.enabled !== false;
    const client = options.client ?? createOpenAiClient();
    let memory = createDrkallaShortTermMemory();
    let turnCounter = 0;
    let latestArrival = 0;
    let noInputReminderCount = 0;
    let greeted = false;
    let loggedCallDetails = false;
    let consecutiveHolds = 0;
    let processing: Promise<void> = Promise.resolve();
    // The model call of the turn currently allowed to speak. A newer turn
    // aborts it on arrival (barge-in) so the serialized chain does not wait
    // out a stale turn's stream budget.
    let inFlightAbort: AbortController | null = null;
    // Rolling background note for the OLDER part of long calls (Step 2). Built
    // off the hot path; the turn only READS the last completed note, so it adds
    // zero turn latency. Reverts to '' on a new call (per-socket).
    let rollingSummary = '';
    let summarizedThroughTurn = 0;
    let summarizing = false;
    const summaryAbort = new AbortController();
    socket.on('close', () => summaryAbort.abort());

    if (!secretOk) {
      socket.close(1008, 'unauthorized');
      return;
    }

    // AGENT SPEAKS FIRST. Custom-LLM has no begin_message (Retell silently drops
    // it), and Retell sends NO opener event at connect — verified live
    // 2026-06-15: ~10s of silence, the agent only greeted AFTER the caller spoke.
    // Per Retell's custom-LLM protocol the server must send the begin message
    // PROACTIVELY with response_id 0 right after the socket opens
    // (https://docs.retellai.com/integrate-llm/setup-websocket-server). Mark
    // greeted + commit the greeting to memory so the per-turn opening path never
    // double-greets and the funnel knows the opener was already spoken.
    if (enabled) {
      greeted = true;
      // Warm the model path while the greeting plays — the caller's first real
      // turn then finds a warm connection instead of paying the cold start.
      client.warmup?.();
      memory = reduceDrkallaShortTermMemory(
        memory,
        deriveDrkallaAgentSpokeEvent({ text: DRKALLA_CUSTOM_RUNTIME_GREETING, turnIndex: 0 }),
      );
      try {
        socket.send(JSON.stringify({
          response_type: 'response',
          response_id: 0,
          content: DRKALLA_CUSTOM_RUNTIME_GREETING,
          content_complete: true,
          end_call: false,
        }));
      } catch (error) {
        app.log.warn({ callId, err: error instanceof Error ? error.message : String(error) }, 'drkalla canary begin-message send failed');
      }
    } else if (secretOk) {
      // Agent is OFF (env gate or the platform's "ausschalten" toggle): do not run
      // a conversation. Say one short unavailable line and hang up so the caller is
      // not left in silence. ("Agent geht nicht mehr ans Telefon.")
      greeted = true;
      try {
        socket.send(JSON.stringify({
          response_type: 'response',
          response_id: 0,
          content: DRKALLA_CUSTOM_RUNTIME_UNAVAILABLE,
          content_complete: true,
          end_call: true,
        }));
      } catch (error) {
        app.log.warn({ callId, err: error instanceof Error ? error.message : String(error) }, 'drkalla canary unavailable-message send failed');
      }
    }

    let framesTraced = 0;
    socket.on('message', (message) => {
      const rawMessage = message.toString();

      // Call-start diagnostic: trace the first few frames so we can see whether
      // Retell ELICITS an opener at connect (an empty response_required => the
      // agent can speak first) or only sends a turn AFTER the caller speaks
      // (userTextLen>0 on the first turn => caller speaks first, no proactive
      // greeting possible for custom-llm). Bounded to the first 4 frames/call.
      if (framesTraced < 4) {
        framesTraced += 1;
        const ctl = parseRetellControlFrame(rawMessage);
        const pre = parseRetellDrkallaCustomLlmMessage(rawMessage);
        app.log.info(
          {
            callId,
            seq: framesTraced,
            type: ctl?.interactionType ?? pre?.interactionType ?? 'unknown',
            userTextLen: (pre?.currentUserText ?? '').length,
          },
          'drkalla canary frame trace',
        );
      }

      // Real Retell custom-LLM control frames (no response_id) are handled here
      // and never enter the serialized turn chain or affect barge-in ordering.
      const control = parseRetellControlFrame(rawMessage);
      const controlType = control?.interactionType ?? '';

      // ping_pong keepalive: Retell sends one every ~2s and expects the same
      // timestamp echoed back, else it may treat the socket as dead. Echo and
      // return immediately — must not abort the in-flight model call or log.
      if (controlType === 'ping_pong') {
        if (control?.timestamp != null) {
          socket.send(JSON.stringify({ response_type: 'ping_pong', timestamp: control.timestamp }));
        }
        return;
      }

      // call_details: one-shot connect metadata (caller/callee numbers). Log
      // once for diagnostics, never respond. The SMS link tool still resolves
      // the caller number server-side via call_id, so we only record presence.
      if (controlType === 'call_details') {
        if (!loggedCallDetails) {
          loggedCallDetails = true;
          app.log.info({ callId, hasCaller: control?.fromNumber !== '' }, 'drkalla canary call_details');
        }
        return;
      }

      // Anything that is not a turn (update_only transcript refresh, unknown, or
      // malformed) produces no reply. Log the raw type once so a real call can
      // be analyzed, then return — response/reminder turns emit their own
      // latency log below, so they are not double-logged here.
      if (controlType !== 'response_required' && controlType !== 'reminder_required') {
        app.log.info({ callId, interactionType: controlType || 'unknown' }, 'drkalla canary non-turn interaction');
        return;
      }

      // Track arrival order so a reply computed for an older response_required
      // is dropped once a newer user turn has arrived (barge-in safety).
      const parsedPreview = parseRetellDrkallaCustomLlmMessage(rawMessage);
      const isResponseTurn = parsedPreview?.interactionType === 'response_required';
      const isReminderTurn = parsedPreview?.interactionType === 'reminder_required';

      // Content-aware turn hold: if the caller's utterance clearly dangles
      // (mid-sentence — ends on a conjunction, a bare article/preposition or a
      // filler), stay SILENT for this turn and let them finish, instead of
      // answering a fragment and getting cut off (real call 2026-06-14:
      // "...kaufen. Und" -> agent started "Darf..." -> caller kept talking).
      // This is content-based, not a global latency delay. Bounded: the caller's
      // next words arrive as a fresh turn and Retell's silence reminder is the
      // backstop, and we never hold the same gap more than twice. A held turn
      // sends NO frame and does NOT advance turn/memory state.
      const turnReadiness = scoreDrkallaTurnReadiness(parsedPreview?.currentUserText ?? '', {
        // askedQuestionLastTurn, NOT lastAgentQuestion: the latter deliberately
        // persists across statement turns (for the pending-offer logic), so it
        // stayed "true" long after the question was answered and disabled the
        // content holds exactly when they were needed (review 2026-07-04).
        pendingQuestion: memory.askedQuestionLastTurn || Boolean(memory.pendingClarification),
      });
      const heldTurn = isResponseTurn
        && consecutiveHolds < DRKALLA_MAX_CONSECUTIVE_HOLDS
        && turnReadiness.decision === 'hold';
      if (heldTurn) {
        // The caller is still talking — treat it as a barge-in over any in-flight
        // answer, then say nothing. No arrival claim, no turnCounter, no memory.
        consecutiveHolds += 1;
        inFlightAbort?.abort();
        inFlightAbort = null;
        app.log.info(
          { callId, turn: turnCounter, holds: consecutiveHolds, readiness: Number(turnReadiness.readiness.toFixed(2)), reasons: turnReadiness.reasons },
          'drkalla canary turn held (low turn-readiness)',
        );
        return;
      }
      if (isResponseTurn || isReminderTurn) consecutiveHolds = 0;

      // Both response and reminder turns produce a spoken frame and so must
      // claim arrival order; a reminder is dropped if the caller speaks first.
      const myArrival = (isResponseTurn || isReminderTurn) ? ++latestArrival : latestArrival;

      // Barge-in: a newer turn supersedes any in-flight model call. Abort it
      // synchronously here (at arrival, before the serialized body runs) so the
      // stale turn's stream stops at once and the chain advances to this turn
      // instead of waiting out streamTotalMs. Only response turns call the
      // model, so only they get a controller, but any newer turn cancels.
      if (isResponseTurn || isReminderTurn) {
        inFlightAbort?.abort();
        inFlightAbort = null;
      }
      const myAbort = isResponseTurn ? new AbortController() : null;
      if (myAbort) inFlightAbort = myAbort;

      // Serialize turns per socket so concurrent events cannot drop memory
      // updates (lost-update race on the shared per-session memory).
      processing = processing.then(async () => {
        try {
          if (isResponseTurn) {
            turnCounter += 1;
            noInputReminderCount = 0; // the caller spoke; reset silence nudges
          }
          if (isReminderTurn) noInputReminderCount += 1;
          // Call opening: greet on the FIRST response turn when the caller has
          // not asked anything substantive yet — i.e. an empty turn (Retell
          // eliciting the opener) OR a bare greeting/ack. Real Retell often puts
          // the caller's "Hallo" into that first turn, so empty-only detection
          // skipped the greeting (observed live: caller had to say "Hallo"
          // twice). If the caller opens with a real question, answer it instead.
          const openingText = (parsedPreview?.currentUserText ?? '').trim();
          // Match an opener made up only of greeting/filler tokens, possibly
          // repeated ("Hallo? Hallo.") — a real call opened that way and the
          // single-token regex missed it, so the greeting never fired.
          const isOpeningUtterance = openingText === ''
            || /^(?:(?:hallo|hall[oö]chen|hi|hey|hej|moin|servus|gr(?:ü|ue)(?:zi|ss\s+gott)|guten\s+(?:tag|morgen|abend)|jo|ja+|hm+|h(?:a|ä)|hallu)[\s.,!?]*)+$/i.test(openingText);
          const isCallOpening = isResponseTurn && !greeted && turnCounter === 1 && isOpeningUtterance;
          if (isCallOpening) greeted = true;
          const startedAt = Date.now();
          let firstFrameMs: number | null = null;
          let sentText = '';
          // RAW (pre-normalization) text streamed so far. The final tail is
          // computed by diffing against the RAW model text, NOT the normalized
          // sentText — otherwise per-chunk vs whole-text price normalization can
          // diverge, fullText.startsWith(sentText) goes false, and the WHOLE
          // answer is re-sent on the final frame (caller hears it twice — review
          // finding 2026-06-30). Raw chunks are exact slices of the stream, so a
          // raw-vs-raw prefix check is exact.
          let rawStreamed = '';
          let deltaBuffer = '';

          const sendFrame = (content: string, complete: boolean, endCall = false) => {
            if (!parsedPreview) return;
            if (myArrival !== latestArrival) return; // stale: a newer turn arrived
            if (firstFrameMs === null) firstFrameMs = Date.now() - startedAt;
            socket.send(JSON.stringify({
              response_type: 'response',
              response_id: parsedPreview.providerResponseId,
              content,
              content_complete: complete,
              // Only the final frame may hang up, and only on a clear caller
              // farewell (never on silence) — see endCall computation below.
              end_call: complete ? endCall : false,
            }));
            if (!complete) sentText += content;
          };

          // Buffer streamed deltas to sentence boundaries (or ~80 chars) so
          // Retell TTS gets natural prosody chunks instead of single tokens.
          // Each flushed chunk is price-normalized ("7,60 Euro" -> "7 Euro
          // sechzig") because streamed MODEL frames otherwise reach the wire raw
          // and the voice reads decimal cents digit-by-digit (the live "Euro O"
          // complaint). Normalization is per-token-local, so flushing must never
          // split a number/price across chunks — the length backoff guards that.
          const flushChunk = (raw: string) => {
            rawStreamed += raw;
            // rawStreamed accumulates the RAW model text (the final-tail prefix
            // diff depends on it); only the SPOKEN side is price-normalized and
            // send-promise-rewritten.
            const safe = rewriteDrkallaSendPromise(raw, buildDrkallaSendOfferQuestion(memory)).text;
            sendFrame(speakDrkallaPriceText(safe), false);
          };
          const onDelta = (chunk: string) => {
            deltaBuffer += chunk;
            // A real sentence break = sentence punctuation NOT preceded by a digit
            // (so a decimal "7.60" is never treated as a sentence end and split).
            if (/(?<!\d)[.!?]["')\]]?$/.test(deltaBuffer.trimEnd())) {
              flushChunk(deltaBuffer);
              deltaBuffer = '';
              return;
            }
            if (deltaBuffer.length >= 80) {
              let cut = deltaBuffer.lastIndexOf(' ');
              if (cut <= 0) return; // no safe word boundary yet — keep buffering
              let head = deltaBuffer.slice(0, cut);
              // Never end a flush inside/right after a price's numeric part: a head
              // ending in a number could be a price whose currency word ("Euro"/"€")
              // is still coming in the next chunk ("...24,50" | " €,"), which would
              // split the price and read it digit-by-digit. Step back through EVERY
              // trailing number token (one space is not enough — review 2026-06-30).
              while (cut > 0 && /\d[\d.,]*$/.test(head)) {
                const prev = head.lastIndexOf(' ');
                if (prev <= 0) { cut = -1; break; }
                cut = prev;
                head = deltaBuffer.slice(0, cut);
              }
              if (cut <= 0) return; // still unsafe — wait for the rest of the price
              if (head.trim()) {
                flushChunk(head);
                deltaBuffer = deltaBuffer.slice(cut);
              }
            }
          };

          const executeSendLink = smsToolEnabled
            ? async (link: { url: string; label: string; linkKind: 'product' | 'profi' | 'category' | 'page' }) => {
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

          // Defer the memory commit: a superseded turn never speaks, so its
          // agent-spoke reduction (Profi disclosure, facts-answered,
          // lastAgentQuestion) must not pollute the session memory the next
          // live turn builds on. Capture the candidate and only commit if this
          // turn is still the newest when the reply is ready.
          let pendingMemory: DrkallaShortTermVoiceMemory | null = null;
          let pendingQuality: DrkallaCustomLlmResponse['quality'] = undefined;
          const outbound = await buildRetellDrkallaCustomLlmWsReply({
            enabled,
            secretAccepted: secretOk,
            rawMessage,
            callId,
            // Live calls rotate score-tied catalog candidates by a stable hash
            // of the call id, so different callers hear different examples.
            varietySeed: drkallaVarietySeedFromCallId(callId),
            memory,
            onMemory: (nextMemory) => {
              pendingMemory = nextMemory;
            },
            onQuality: (quality) => {
              pendingQuality = quality;
            },
            complete: client.complete,
            completeStream: client.completeStream,
            detectProducts,
            detectAmbiguousProduct,
            evidenceLookup,
            catalogSearch,
            brandStock,
            colorShadeSummary,
            // Live-published FAQ + knowledge (from the platform) override the baked snapshots.
            faqMatch: liveOverlay.faqMatch ?? faqMatch,
            knowledgeRetriever: liveOverlay.knowledgeRetriever ?? knowledgeRetriever,
            // Owner-published knowledge grounds even over weak catalog tag-matches.
            knowledgePriority: !!liveOverlay.knowledgeRetriever,
            // Owner-published contact facts (address/hours/email/anfahrt) override the baked ones.
            contactFacts: liveOverlay.contactFacts,
            executeSendLink,
            conversationSummary: rollingSummary,
            sequence: turnCounter,
            noInputReminderCount,
            onDelta: isResponseTurn ? onDelta : undefined,
            onFaqCandidate: (question, answer) => {
              // Offline curation signal: a general question the model had to
              // answer. Logged only; the owner reviews via drkalla:faq-propose.
              app.log.info({ event: 'faq_candidate', callId, question, answer }, 'drkalla canary faq candidate');
            },
            onKnowledgeChunk: (sourceId, chunkId, _query, score) => {
              // Observability: which knowledge chunk grounded a turn (no query text
              // logged — privacy). Lets us tune KB_CONFIDENCE + spot weak sources.
              app.log.info({ event: 'kb_chunk', callId, sourceId, chunkId, score: Number(score.toFixed(3)) }, 'drkalla canary knowledge chunk');
            },
            signal: myAbort?.signal,
            isCallOpening,
          });
          const superseded = (isResponseTurn || isReminderTurn) && myArrival !== latestArrival;
          if (!superseded && pendingMemory) memory = pendingMemory;
          if (!outbound) return;
          if (superseded) return;

          // Final frame carries whatever was not streamed yet.
          // - Deterministic replies (nothing streamed) get the FULL TTS
          //   normalization: "Dr.Kalla" -> "Doktor Kalla", "&" -> "und",
          //   "9,00 Euro" -> "9 Euro", etc.
          // - Streamed model replies: diff the model text against the RAW streamed
          //   text (exact prefix) and price-normalize only the remaining tail, so
          //   the streamed chunks and the final frame can never diverge and the
          //   answer is never re-sent (no double-speak — review 2026-06-30). If
          //   trimming/fallback changed the text so the raw prefix no longer
          //   matches, fall back to a single full final frame.
          let tail: string;
          if (sentText === '') {
            tail = speakDrkallaText(
              rewriteDrkallaSendPromise(String(outbound.content), buildDrkallaSendOfferQuestion(memory)).text,
            );
          } else {
            const rawFull = String(outbound.content);
            const rawTail = rawFull.startsWith(rawStreamed) ? rawFull.slice(rawStreamed.length) : rawFull;
            tail = speakDrkallaPriceText(
              rewriteDrkallaSendPromise(rawTail, buildDrkallaSendOfferQuestion(memory)).text,
            );
          }
          // A rewritten send-promise must ALSO become the pending question in
          // memory, so the caller's following "Ja" hits the deterministic send
          // path and a real SMS goes out (the spoken rewrite alone would leave
          // "Ja" answering a question the memory never saw).
          if (isResponseTurn) {
            const promiseOffer = buildDrkallaSendOfferQuestion(memory);
            if (rewriteDrkallaSendPromise(String(outbound.content), promiseOffer).rewritten) {
              memory = reduceDrkallaShortTermMemory(memory, {
                type: 'agent_spoke',
                turnIndex: turnCounter,
                text: promiseOffer,
                lastAgentQuestion: promiseOffer,
              });
              app.log.warn({ event: 'send_claim_rewritten', callId }, 'drkalla canary: model send-promise converted to offer');
            }
          }
          // Hard hang-up only on a clear caller farewell (response.endCall),
          // carried on the final frame; never on streamed/intermediate frames.
          sendFrame(tail, true, outbound.end_call === true);

          // Surface the non-blocking Sie-consistency signal so live du-form
          // slips are observable in logs (never alters the spoken answer).
          const quality = pendingQuality as DrkallaCustomLlmResponse['quality'];
          if (quality?.duFormDetected) {
            app.log.warn(
              { turn: turnCounter, duFormConfidence: quality.duFormConfidence, duFormSlips: quality.duFormSlips },
              'drkalla canary du-form slip detected',
            );
          }
          const turnFirstFrameMs = firstFrameMs ?? Date.now() - startedAt;
          const turnTotalMs = Date.now() - startedAt;
          latencyRecorder.record({
            firstFrameMs: turnFirstFrameMs,
            totalMs: turnTotalMs,
            streamed: sentText.length > 0,
          });
          const rolling = latencyRecorder.summary();
          app.log.info(
            {
              turn: turnCounter,
              firstFrameMs: turnFirstFrameMs,
              totalMs: turnTotalMs,
              streamedFrames: sentText.length > 0,
              duFormDetected: quality?.duFormDetected ?? false,
              rollingSamples: rolling.samples,
              rollingFirstFrameP50: rolling.firstFrameP50,
              rollingFirstFrameP90: rolling.firstFrameP90,
              rollingFirstFrameP95: rolling.firstFrameP95,
              rollingModelTurnShare: Number(rolling.modelTurnShare.toFixed(2)),
            },
            'drkalla canary turn latency',
          );

          // STEP 2 — rolling background summary for long calls. The reply is
          // ALREADY sent above; this is fire-and-forget (never awaited) and only
          // updates rollingSummary for FUTURE turns, so it adds zero turn
          // latency. Guarded so at most one summary runs at a time.
          if (isResponseTurn && client.summarize && !summarizing) {
            const allTurns = parsedPreview?.allTurns ?? [];
            const totalTurns = allTurns.length;
            if (shouldRefreshDrkallaSummary({ totalTurns, summarizedThroughTurn })) {
              summarizing = true;
              const { system, user } = buildDrkallaSummaryMessages(selectDrkallaOlderTurns(allTurns), rollingSummary);
              client.summarize({ system, user, signal: summaryAbort.signal })
                .then((note) => {
                  const trimmed = note.trim();
                  if (trimmed) {
                    rollingSummary = trimmed.slice(0, 600);
                    summarizedThroughTurn = totalTurns;
                    app.log.info({ callId, turn: turnCounter, summaryLen: rollingSummary.length }, 'drkalla rolling summary updated');
                  }
                })
                .catch(() => {})
                .finally(() => { summarizing = false; });
            }
          }
        } catch (error) {
          app.log.warn({ err: error instanceof Error ? error.message : String(error) }, 'DrKalla custom LLM canary failed');
        } finally {
          // Release the in-flight slot only if a newer turn has not already
          // claimed it (otherwise we would clear the next turn's controller).
          if (myAbort && inFlightAbort === myAbort) inFlightAbort = null;
        }
      });
    });
  };

  app.get('/retell/custom-llm/drkalla', { websocket: true }, handler);
  app.get('/retell/custom-llm/drkalla/:callId', { websocket: true }, handler);
  app.get('/retell/custom-llm/drkalla/auth/:secret/:callId', { websocket: true }, handler);
}
