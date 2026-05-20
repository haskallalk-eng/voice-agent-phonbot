import crypto from 'node:crypto';
import dns from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { createKnowledgeBase, deleteKnowledgeBase, waitForKnowledgeBaseComplete } from './retell.js';
import { pool } from './db.js';
import { isPrivateHost, isPrivateResolved, isBlockedPort } from './ssrf-guard.js';
import {
  customerModuleActiveForAgentConfig,
  getActiveCustomerQuestions,
  normalizeCustomerModuleConfig,
  type CustomerModuleConfig,
} from './customers.js';
import { chipyScheduleToOpeningHours } from './opening-hours-sync.js';
import { ocrPdfWithOpenAI, type KnowledgeOcrResult } from './knowledge-ocr.js';

export type KnowledgeSource = {
  id: string;
  type: 'url' | 'pdf' | 'text';
  name: string;
  content: string;
  url?: string;
  fileId?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  status?: 'pending' | 'indexed' | 'error';
  error?: string;
  category?: string;
  allowedUse?: string;
  sourceOfTruth?: string;
  owner?: string;
  verifiedAt?: string;
  expiresAt?: string;
  fetchedAt?: string;
  lastIndexedAt?: string;
  contentHash?: string;
  etag?: string;
  lastModified?: string;
  sitemapLastmod?: string;
  containsPii?: boolean;
  reviewStatus?: string;
  risk?: string;
  autoRefresh?: boolean;
  ocrStatus?: 'completed' | 'failed';
  ocrEngine?: string;
};

export type KnowledgeText = { title: string; text: string };
export type KnowledgeFile = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  data: Buffer;
};

type KnowledgeFileRef = Omit<KnowledgeFile, 'data'>;

export type PrepareKnowledgeOptions = {
  requirePdfBytes?: boolean;
  loadPdfFile?: (source: KnowledgeSource) => Promise<KnowledgeFile | null>;
  ocrPdfFile?: (file: KnowledgeFile, source: KnowledgeSource) => Promise<KnowledgeOcrResult>;
  inspectUrlContent?: boolean;
  fetchUrlContent?: (url: string) => Promise<KnowledgeUrlContentResult>;
  includeCanonicalBusinessFacts?: boolean;
  canonicalBusinessFacts?: CanonicalBusinessFactOptions;
  now?: Date | string;
};

export type KnowledgeUrlContentResult = {
  finalUrl?: string;
  contentType?: string;
  text: string;
  etag?: string | null;
  lastModified?: string | null;
} | {
  error: string;
};

export type KnowledgePayload = {
  sources: KnowledgeSource[];
  texts: KnowledgeText[];
  urls: string[];
  files: KnowledgeFile[];
  enableAutoRefresh: boolean;
  signature: string | null;
};

export type KnowledgeRetrievalMode = 'strict' | 'balanced' | 'broad';

export type KnowledgeRetrievalSettings = {
  mode: KnowledgeRetrievalMode;
  topK: number;
  filterScore: number;
};

export const DEFAULT_KNOWLEDGE_RETRIEVAL: KnowledgeRetrievalSettings = {
  mode: 'balanced',
  topK: 3,
  filterScore: 0.6,
};

export type CanonicalBusinessFactStaff = {
  name?: unknown;
  role?: unknown;
  services?: unknown;
};

export type CanonicalBusinessFactOptions = {
  now?: Date | string;
  staff?: CanonicalBusinessFactStaff[];
  openingHoursSchedule?: unknown;
  staffSchedules?: Array<{ name?: unknown; schedule?: unknown }>;
};

const MAX_SOURCES = 25;
const MAX_TEXT_CHARS = 50000;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_URL_SNAPSHOT_CHARS = 50000;
const MAX_URL_SCAN_BYTES = 300000;
const URL_FETCH_TIMEOUT_MS = 8000;
const MAX_URL_REDIRECTS = 3;

const KNOWLEDGE_RETRIEVAL_PRESETS: Record<KnowledgeRetrievalMode, Omit<KnowledgeRetrievalSettings, 'mode'>> = {
  strict: { topK: 2, filterScore: 0.72 },
  balanced: { topK: 3, filterScore: 0.6 },
  broad: { topK: 5, filterScore: 0.48 },
};

function compact(input: string | null | undefined): string {
  return (input ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(input: string, max: number): string {
  const text = input.trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
}

function cleanFact(input: unknown, max = 600): string {
  return typeof input === 'string' ? truncate(compact(input), max) : '';
}

function cleanFactList(input: unknown, maxItems = 20): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    const text = cleanFact(item, 160);
    if (text) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function pushFact(lines: string[], label: string, value: unknown, max = 600): void {
  const text = cleanFact(value, max);
  if (text) lines.push(`${label}: ${text}`);
}

function formatServiceFact(input: unknown): string | null {
  const service = asRecord(input);
  if (!service) return null;
  const name = cleanFact(service.name, 120);
  if (!name) return null;
  const parts: string[] = [name];
  const price = cleanFact(service.price, 30);
  const priceUpTo = cleanFact(service.priceUpTo, 30);
  if (price) {
    if (service.priceFrom === true) parts.push(`ab ${price} Euro`);
    else if (priceUpTo) parts.push(`${price}-${priceUpTo} Euro`);
    else parts.push(`${price} Euro`);
  }
  const duration = cleanFact(service.duration, 40);
  if (duration) parts.push(duration);
  const tag = cleanFact(service.tag, 30);
  if (tag) parts.push(tag);
  const description = cleanFact(service.description, 240);
  if (description) parts.push(description);
  return parts.join(' | ');
}

function formatVocabularyFact(input: unknown): string | null {
  if (typeof input === 'string') return cleanFact(input, 160) || null;
  const item = asRecord(input);
  if (!item) return null;
  const term = cleanFact(item.term, 120);
  if (!term) return null;
  const parts = [term];
  const explanation = cleanFact(item.explanation, 220);
  const context = cleanFact(item.context, 180);
  if (explanation) parts.push(`= ${explanation}`);
  if (context) parts.push(`Kontext: ${context}`);
  return parts.join(' | ');
}

function formatStaffFact(input: unknown): string | null {
  const staff = asRecord(input);
  if (!staff) return null;
  const name = cleanFact(staff.name, 120);
  if (!name) return null;
  const parts = [name];
  const role = cleanFact(staff.role, 100);
  if (role) parts.push(role);
  const services = cleanFactList(staff.services, 20);
  if (services.length > 0) parts.push(`Leistungen: ${services.join(', ')}`);
  return parts.join(' | ');
}

function formatScheduleFact(input: unknown): string {
  const schedule = asRecord(input);
  if (!schedule) return '';
  try {
    return cleanFact(chipyScheduleToOpeningHours(schedule as Record<string, { enabled: boolean; start: string; end: string }>), 700);
  } catch {
    return '';
  }
}

function normalizeIso(input: Date | string | undefined): string {
  if (input instanceof Date) return input.toISOString();
  if (typeof input === 'string' && input.trim()) {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const APPROVED_REVIEW_STATUSES = new Set(['approved', 'verified']);
const BLOCKED_SOURCE_RISKS = new Set(['high', 'critical']);
const ALLOWED_KNOWLEDGE_USES = new Set(['agent_facts', 'customer_faq', 'voice_agent', 'public_faq']);

const KNOWLEDGE_PII_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30}\b/i,
  /\b(0?[1-9]|[12]\d|3[01])[./](0?[1-9]|1[0-2])[./](19\d{2}|20[0-2]\d)\b/,
  /\b(?:\d[\s-]?){13,19}\b/,
  /\b(?:kundenliste|customer\s+list|stammkunde|patientenliste)\b/i,
  /\b(?:\+?\d[\d\s()./-]{6,}\d)\b/,
  /\b(?:strasse|straße|str\.|weg|platz|allee|gasse|ring)\s+\d+[a-z]?\b/i,
];

const EMBEDDED_CONTENT_PII_PATTERNS = [
  ...KNOWLEDGE_PII_PATTERNS,
  /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30}\b/i,
  /\b(0?[1-9]|[12]\d|3[01])[./](0?[1-9]|1[0-2])[./](19\d{2}|20[0-2]\d)\b/,
  /\b(?:\d[\s-]?){13,19}\b/,
  /\b(?:api[_ -]?key|secret|bearer\s+token|password|passwort)\b/i,
  /\b(?:kundenliste|customer\s+list|stammkunde|patientenliste)\b/i,
];

const CANONICAL_FACTS_SENSITIVE_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30}\b/i,
  /\b(?:api[_ -]?key|secret|bearer\s+token|password|passwort)\b/i,
  /\b(?:kundenliste|customer\s+list|stammkunde|patientenliste|patient|geburtsdatum)\b/i,
];

const KNOWLEDGE_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|above|system|developer)\s+instructions?\b/i,
  /\bdisregard\s+(?:all\s+)?(?:previous|above|system|developer)\s+instructions?\b/i,
  /\bignoriere\s+(?:alle\s+)?(?:vorherigen|bisherigen|obigen|system|entwickler)[\w\s-]{0,40}anweisungen\b/i,
  /\bvergiss\s+(?:alle\s+)?(?:vorherigen|bisherigen|obigen)[\w\s-]{0,40}anweisungen\b/i,
  /\bueberschreibe\s+(?:die\s+)?(?:system|entwickler|plattform)[\w\s-]{0,40}regeln\b/i,
  /\bÃ¼berschreibe\s+(?:die\s+)?(?:system|entwickler|plattform)[\w\s-]{0,40}regeln\b/i,
  /\breveal\s+(?:the\s+)?system\s+prompt\b/i,
  /\bshow\s+(?:the\s+)?system\s+prompt\b/i,
  /\b(?:zeige|nenne|verrate)\s+(?:den\s+)?systemprompt\b/i,
  /\b(?:call|use|invoke|trigger)\s+(?:the\s+)?(?:tool|function|api)\b/i,
  /\b(?:rufe|nutze|verwende|starte|trigger)\s+(?:das\s+)?(?:tool|funktion|api)\b/i,
  /\b(?:calendar|customer|stripe|billing|ticket)\.(?:book|cancel|reschedule|delete|upsert|create|refund|charge)\b/i,
  /(?:^|[^\p{L}\p{N}_])(?:ue|ü)berschreibe\s+(?:die\s+)?(?:system|entwickler|plattform)[\p{L}\p{N}\s_-]{0,40}regeln/iu,
];

const SENSITIVE_URL_QUERY_KEYS = new Set([
  'access_token',
  'auth',
  'code',
  'key',
  'password',
  'secret',
  'signature',
  'sig',
  'token',
  'x-amz-credential',
  'x-amz-security-token',
  'x-amz-signature',
]);

function parseTime(input: unknown): number | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.getTime();
  if (typeof input !== 'string' || !input.trim()) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function containsKnowledgePii(text: string): boolean {
  return KNOWLEDGE_PII_PATTERNS.some((pattern) => pattern.test(text));
}

function containsEmbeddedSensitiveData(text: string): boolean {
  return EMBEDDED_CONTENT_PII_PATTERNS.some((pattern) => pattern.test(text));
}

function containsPromptInjection(text: string): boolean {
  const normalized = text
    .normalize('NFKC')
    .replace(/Ã¼|ÃƒÂ¼/g, 'ü')
    .replace(/Ã¶|ÃƒÂ¶/g, 'ö')
    .replace(/Ã¤|ÃƒÂ¤/g, 'ä')
    .replace(/ÃŸ|ÃƒÅ¸/g, 'ß');
  return KNOWLEDGE_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function containsCanonicalSensitiveData(text: string): boolean {
  return CANONICAL_FACTS_SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function sourcePolicyError(src: KnowledgeSource, textForScanning: string, now: Date | string | undefined): string | null {
  const expiresAt = parseTime(src.expiresAt);
  const nowMs = parseTime(now) ?? Date.now();
  if (expiresAt != null && expiresAt <= nowMs) return 'SOURCE_EXPIRED';

  const reviewStatus = compact(src.reviewStatus).toLowerCase();
  if (reviewStatus && !APPROVED_REVIEW_STATUSES.has(reviewStatus)) return 'SOURCE_REVIEW_REQUIRED';

  const risk = compact(src.risk).toLowerCase();
  if (BLOCKED_SOURCE_RISKS.has(risk)) return 'SOURCE_RISK_TOO_HIGH';

  const allowedUse = compact(src.allowedUse).toLowerCase();
  if (allowedUse && !ALLOWED_KNOWLEDGE_USES.has(allowedUse)) return 'SOURCE_USE_NOT_ALLOWED';

  if (src.containsPii === true) return 'PII_DETECTED';
  if (textForScanning && containsPromptInjection(textForScanning)) return 'PROMPT_INJECTION_DETECTED';
  if (textForScanning && containsKnowledgePii(textForScanning)) return 'PII_DETECTED';
  return null;
}

function rejectedSource(src: KnowledgeSource, error: string): KnowledgeSource {
  return { ...src, status: 'error', error };
}

function embeddedContentPolicyError(textForScanning: string): string | null {
  if (textForScanning && containsPromptInjection(textForScanning)) return 'PROMPT_INJECTION_DETECTED';
  if (textForScanning && containsEmbeddedSensitiveData(textForScanning)) return 'PII_DETECTED';
  return null;
}

function canonicalFactsPolicyError(textForScanning: string): string | null {
  if (textForScanning && containsPromptInjection(textForScanning)) return 'PROMPT_INJECTION_DETECTED';
  if (textForScanning && containsCanonicalSensitiveData(textForScanning)) return 'PII_DETECTED';
  return null;
}

function externalOcrProcessorAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.KNOWLEDGE_OCR_ALLOW_EXTERNAL_PROCESSOR === 'true';
}

export function normalizeKnowledgeRetrievalSettings(input: unknown): KnowledgeRetrievalSettings {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawMode = typeof raw.mode === 'string' ? raw.mode : DEFAULT_KNOWLEDGE_RETRIEVAL.mode;
  const mode: KnowledgeRetrievalMode = rawMode === 'strict' || rawMode === 'broad' ? rawMode : 'balanced';
  const preset = KNOWLEDGE_RETRIEVAL_PRESETS[mode];
  return {
    mode,
    topK: Math.round(clampNumber(raw.topK, 1, 8, preset.topK)),
    filterScore: Number(clampNumber(raw.filterScore, 0.2, 0.9, preset.filterScore).toFixed(2)),
  };
}

export function toRetellKbConfig(input: unknown): { top_k: number; filter_score: number } {
  const normalized = normalizeKnowledgeRetrievalSettings(input);
  return { top_k: normalized.topK, filter_score: normalized.filterScore };
}

export function buildCanonicalBusinessFacts(
  config: Record<string, unknown>,
  options: CanonicalBusinessFactOptions = {},
): KnowledgeSource | null {
  const factLines: string[] = [];

  pushFact(factLines, 'Betrieb', config.businessName, 180);
  pushFact(factLines, 'Beschreibung', config.businessDescription, 900);
  pushFact(factLines, 'Branche', config.industry, 80);
  pushFact(factLines, 'Adresse', config.address, 300);
  pushFact(factLines, 'Oeffnungszeiten', config.openingHours, 700);
  const structuredSchedule = formatScheduleFact(options.openingHoursSchedule);
  if (structuredSchedule) factLines.push(`Betriebskalender: ${structuredSchedule}`);

  const services = Array.isArray(config.services)
    ? config.services.map(formatServiceFact).filter((line): line is string => Boolean(line)).slice(0, 40)
    : [];
  if (services.length > 0) {
    factLines.push('Leistungen:');
    factLines.push(...services.map((line) => `- ${line}`));
  } else {
    pushFact(factLines, 'Leistungen', config.servicesText, 1200);
  }

  const vocab = Array.isArray(config.customVocabulary)
    ? config.customVocabulary.map(formatVocabularyFact).filter((line): line is string => Boolean(line)).slice(0, 40)
    : [];
  if (vocab.length > 0) {
    factLines.push('Spezielle Begriffe:');
    factLines.push(...vocab.map((line) => `- ${line}`));
  }

  const staffFacts = Array.isArray(options.staff)
    ? options.staff.map(formatStaffFact).filter((line): line is string => Boolean(line)).slice(0, 40)
    : [];
  if (staffFacts.length > 0) {
    factLines.push('Mitarbeiter:');
    factLines.push(...staffFacts.map((line) => `- ${line}`));
  }

  const staffScheduleFacts = Array.isArray(options.staffSchedules)
    ? options.staffSchedules
      .map((item) => {
        const name = cleanFact(item?.name, 120);
        const schedule = formatScheduleFact(item?.schedule);
        return name && schedule ? `${name}: ${schedule}` : '';
      })
      .filter(Boolean)
      .slice(0, 40)
    : [];
  if (staffScheduleFacts.length > 0) {
    factLines.push('Mitarbeiterkalender:');
    factLines.push(...staffScheduleFacts.map((line) => `- ${line}`));
  }

  const customerModule = asRecord(config.customerModule) as CustomerModuleConfig | null;
  if (customerModuleActiveForAgentConfig({
    industry: cleanFact(config.industry, 80) || undefined,
    customerModule: customerModule ?? undefined,
  })) {
    const normalized = normalizeCustomerModuleConfig(customerModule ?? undefined);
    const questions = getActiveCustomerQuestions(normalized)
      .map((q) => {
        const label = cleanFact(q.label, 120);
        if (!label) return '';
        const prompt = cleanFact(q.prompt, 180);
        const condition = cleanFact(q.condition, 120);
        const suffix = [prompt, condition ? `Bedingung: ${condition}` : ''].filter(Boolean).join(' | ');
        return suffix ? `${label} (${suffix})` : label;
      })
      .filter(Boolean)
      .slice(0, 24);
    if (questions.length > 0) {
      factLines.push('Kundenaufnahme:');
      factLines.push(`- Modul aktiv: ${normalized.allowBookingWithoutApproval === false ? 'Termine neuer/pending Kunden nur mit Freigabe' : 'Terminbuchung neuer/pending Kunden nach Bestaetigung erlaubt'}`);
      factLines.push(...questions.map((line) => `- ${line}`));
    }
  }

  const aliases = cleanFactList(config.businessAliases, 10);
  if (aliases.length > 0) {
    factLines.push('Namensvarianten:');
    factLines.push(...aliases.map((line) => `- ${line}`));
  }

  if (factLines.length === 0) return null;
  const includesCalendarTables = Boolean(
    structuredSchedule || staffFacts.length > 0 || staffScheduleFacts.length > 0,
  );
  const containsPersonalData = staffFacts.length > 0 || staffScheduleFacts.length > 0;

  const content = truncate([
    'Quelle: Phonbot Datenbank / verifizierte Betriebsdaten.',
    'Nutzung: Nur zur Beantwortung von Faktenfragen und zur korrekten Gespraechsfuehrung verwenden. Kritische Aktionen brauchen weiterhin Tool-Erfolg und Bestaetigung.',
    ...factLines,
  ].join('\n'), MAX_TEXT_CHARS);
  const now = normalizeIso(options.now);

  return {
    id: 'db_canonical_business_facts',
    type: 'text',
    name: 'Phonbot Business Fakten',
    content,
    status: 'indexed',
    category: 'verified_facts',
    allowedUse: 'agent_facts',
    sourceOfTruth: includesCalendarTables ? 'agent_configs.data+calendar_tables' : 'agent_configs.data',
    owner: 'tenant',
    verifiedAt: now,
    fetchedAt: now,
    lastIndexedAt: now,
    contentHash: crypto.createHash('sha256').update(content).digest('hex'),
    containsPii: containsPersonalData,
    reviewStatus: 'approved',
    risk: containsPersonalData ? 'medium' : 'low',
  };
}

function sourceTitle(src: KnowledgeSource, fallback: string): string {
  return truncate(compact(src.name) || fallback, 120);
}

function stableSignature(
  texts: KnowledgeText[],
  urls: string[],
  files: KnowledgeFileRef[],
  enableAutoRefresh: boolean,
): string | null {
  if (texts.length === 0 && urls.length === 0 && files.length === 0) return null;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      texts: texts.map((t) => ({ title: t.title, text: t.text })),
      urls,
      files: files.map((f) => ({ filename: f.filename, sha256: f.sha256, sizeBytes: f.sizeBytes })),
      enableAutoRefresh,
    }))
    .digest('hex');
}

function contentHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function nowIso(now: Date | string | undefined): string {
  const parsed = parseTime(now);
  return new Date(parsed ?? Date.now()).toISOString();
}

function sanitizeFilename(input: string | null | undefined): string {
  const basename = compact(input).split(/[\\/]/).pop() || 'wissen.pdf';
  const cleaned = basename.replace(/[^\p{L}\p{N}\s._-]+/gu, '').trim();
  const fallback = cleaned || 'wissen.pdf';
  return truncate(fallback.toLowerCase().endsWith('.pdf') ? fallback : `${fallback}.pdf`, 120);
}

function isPdfUpload(filename: string, mimeType: string): boolean {
  return mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
}

function assertPdfBuffer(data: Buffer): void {
  if (data.length === 0) {
    const err = new Error('PDF_EMPTY') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  if (data.length > MAX_PDF_BYTES) {
    const err = new Error('PDF_TOO_LARGE') as Error & { statusCode?: number };
    err.statusCode = 413;
    throw err;
  }
  if (data.subarray(0, 1024).indexOf('%PDF-') === -1) {
    const err = new Error('PDF_INVALID') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
}

function parseKnowledgeUrl(raw: string): URL {
  const trimmed = raw.trim();
  return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
}

async function validateKnowledgeUrl(raw: string): Promise<{ ok: true; url: string; host: string } | { ok: false; error: string }> {
  try {
    const url = parseKnowledgeUrl(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'BAD_PROTOCOL' };
    if (url.username || url.password) return { ok: false, error: 'URL_CREDENTIALS_NOT_ALLOWED' };
    for (const key of url.searchParams.keys()) {
      const normalizedKey = key.trim().toLowerCase();
      if (SENSITIVE_URL_QUERY_KEYS.has(normalizedKey) || normalizedKey.startsWith('x-amz-')) {
        return { ok: false, error: 'URL_SENSITIVE_QUERY' };
      }
    }
    if (isBlockedPort(url.port)) return { ok: false, error: 'BLOCKED_PORT' };
    if (isPrivateHost(url.hostname)) return { ok: false, error: 'PRIVATE_HOST' };
    if (await isPrivateResolved(url.hostname)) return { ok: false, error: 'PRIVATE_HOST' };
    url.hash = '';
    return { ok: true, url: url.toString(), host: url.hostname };
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }
}

function isTextLikeContentType(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return type.startsWith('text/')
    || type === 'application/json'
    || type === 'application/ld+json'
    || type === 'application/xml'
    || type === 'application/xhtml+xml'
    || type.endsWith('+json')
    || type.endsWith('+xml');
}

async function readIncomingMessageWithLimit(
  res: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Buffer);
    total += bytes.byteLength;
    if (total > maxBytes) {
      res.destroy();
      return { ok: false, error: 'URL_CONTENT_TOO_LARGE' };
    }
    chunks.push(bytes);
  }
  return { ok: true, text: new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks, total)) };
}

type NodeKnowledgeResponse = {
  statusCode: number;
  headers: IncomingMessage['headers'];
  text?: string;
};

function guardedLookup(
  hostname: string,
  _options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err, '', 4);
      return;
    }
    const address = addresses.find((item) => !isPrivateHost(item.address));
    if (!address) {
      const blocked = Object.assign(new Error('PRIVATE_HOST'), { code: 'PRIVATE_HOST' }) as NodeJS.ErrnoException;
      callback(blocked, '', 4);
      return;
    }
    callback(null, address.address, address.family);
  });
}

function fetchKnowledgeUrlViaGuardedLookup(checkedUrl: string): Promise<NodeKnowledgeResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(checkedUrl);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        accept: 'text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1',
        'user-agent': 'PhonbotKnowledgeScanner/1.0',
      },
      lookup: guardedLookup,
      timeout: URL_FETCH_TIMEOUT_MS,
    }, async (res) => {
      try {
        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 300 && statusCode < 400) {
          res.resume();
          resolve({ statusCode, headers: res.headers });
          return;
        }
        const body = await readIncomingMessageWithLimit(res, MAX_URL_SCAN_BYTES);
        if (!body.ok) {
          reject(new Error(body.error));
          return;
        }
        resolve({ statusCode, headers: res.headers, text: body.text });
      } catch (err) {
        reject(err);
      }
    });
    req.on('timeout', () => req.destroy(new Error('URL_FETCH_TIMEOUT')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchKnowledgeUrlContent(url: string, redirects = 0): Promise<KnowledgeUrlContentResult> {
  if (redirects > MAX_URL_REDIRECTS) return { error: 'URL_TOO_MANY_REDIRECTS' };
  const checked = await validateKnowledgeUrl(url);
  if (!checked.ok) return { error: checked.error };

  try {
    const res = await fetchKnowledgeUrlViaGuardedLookup(checked.url);

    if (res.statusCode >= 300 && res.statusCode < 400) {
      const rawLocation = res.headers.location;
      const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
      if (!location) return { error: 'URL_REDIRECT_WITHOUT_LOCATION' };
      return fetchKnowledgeUrlContent(new URL(location, checked.url).toString(), redirects + 1);
    }

    if (res.statusCode < 200 || res.statusCode >= 300) return { error: 'URL_FETCH_FAILED' };
    const rawContentType = res.headers['content-type'];
    const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType) ?? 'text/html';
    if (!isTextLikeContentType(contentType)) return { error: 'URL_CONTENT_UNSUPPORTED' };

    if (res.text == null) return { error: 'URL_EMPTY' };
    return {
      finalUrl: checked.url,
      contentType,
      text: res.text,
      etag: Array.isArray(res.headers.etag) ? res.headers.etag[0] : res.headers.etag,
      lastModified: Array.isArray(res.headers['last-modified']) ? res.headers['last-modified'][0] : res.headers['last-modified'],
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'URL_FETCH_TIMEOUT') return { error: 'URL_FETCH_TIMEOUT' };
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'PRIVATE_HOST') return { error: 'PRIVATE_HOST' };
    if (err instanceof Error && err.message === 'URL_CONTENT_TOO_LARGE') return { error: 'URL_CONTENT_TOO_LARGE' };
    return { error: 'URL_FETCH_FAILED' };
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function snapshotTextFromUrlContent(raw: string, contentType = ''): string {
  const type = contentType.toLowerCase();
  const stripped = type.includes('html') || /<\/?[a-z][\s\S]*>/i.test(raw)
    ? raw
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
    : raw;
  return truncate(decodeHtmlEntities(stripped).replace(/\s+/g, ' '), MAX_URL_SNAPSHOT_CHARS);
}

function extractPdfScanText(data: Buffer | Uint8Array): string {
  const buffer = Buffer.from(data);
  const utf8 = buffer.toString('utf8');
  const latin1 = buffer.toString('latin1');
  return truncate(`${utf8}\n${latin1}`.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u017f]+/g, ' '), MAX_TEXT_CHARS);
}

function pdfActiveContentPolicyError(data: Buffer | Uint8Array): string | null {
  const raw = Buffer.from(data).toString('latin1');
  if (/\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|Filespec|RichMedia|XFA)\b/i.test(raw)) {
    return 'PDF_ACTIVE_CONTENT_NOT_ALLOWED';
  }
  return null;
}

function hasReadablePdfScanText(text: string): boolean {
  const structuralWords = new Set([
    'pdf', 'obj', 'endobj', 'stream', 'endstream', 'xref', 'trailer',
    'type', 'catalog', 'pages', 'page', 'kids', 'count', 'length', 'filter',
    'flatedecode', 'mediabox', 'resources', 'font', 'procset', 'contents',
    'metadata', 'creator', 'producer', 'creationdate', 'moddate',
  ]);
  const words = text
    .match(/\b[\p{L}]{3,}\b/gu)
    ?.map((word) => word.toLowerCase())
    .filter((word) => !structuralWords.has(word)) ?? [];
  const uniqueWords = new Set(words);
  return words.length >= 20 && uniqueWords.size >= 8;
}

function hasUsableOcrText(text: string): boolean {
  const words = text.match(/\b[\p{L}\p{N}]{2,}\b/gu) ?? [];
  return words.length >= 5 && text.trim().length >= 20;
}

export async function storeKnowledgePdf(input: {
  orgId: string;
  tenantId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}): Promise<KnowledgeSource> {
  if (!pool) {
    const err = new Error('Database not configured') as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  }

  const filename = sanitizeFilename(input.filename);
  if (!isPdfUpload(filename, input.mimeType)) {
    const err = new Error('PDF_ONLY') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  assertPdfBuffer(input.data);

  const sha256 = crypto.createHash('sha256').update(input.data).digest('hex');
  const res = await pool.query(
    `INSERT INTO knowledge_files (org_id, tenant_id, filename, mime_type, size_bytes, sha256, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (org_id, tenant_id, sha256) DO UPDATE
       SET filename = EXCLUDED.filename,
           mime_type = EXCLUDED.mime_type,
           size_bytes = EXCLUDED.size_bytes,
           data = EXCLUDED.data
     RETURNING id, filename, mime_type, size_bytes, sha256`,
    [input.orgId, input.tenantId, filename, 'application/pdf', input.data.length, sha256, input.data],
  );
  const row = res.rows[0] as {
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    sha256: string;
  };

  return {
    id: row.id,
    type: 'pdf',
    name: row.filename,
    content: row.filename,
    fileId: row.id,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    status: 'pending',
  };
}

async function loadStoredKnowledgePdf(orgId: string, tenantId: string, source: KnowledgeSource): Promise<KnowledgeFile | null> {
  if (!pool || !source.fileId) return null;
  const res = await pool.query(
    `SELECT filename, mime_type, size_bytes, sha256, data
     FROM knowledge_files
     WHERE id = $1 AND org_id = $2 AND tenant_id = $3`,
    [source.fileId, orgId, tenantId],
  );
  const row = res.rows[0] as {
    filename: string;
    mime_type: string;
    size_bytes: number;
    sha256: string;
    data: Buffer;
  } | undefined;
  if (!row) return null;
  return {
    filename: sanitizeFilename(row.filename),
    mimeType: row.mime_type || 'application/pdf',
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    data: Buffer.from(row.data),
  };
}

export async function prepareKnowledgePayload(
  config: Record<string, unknown>,
  options: PrepareKnowledgeOptions = {},
): Promise<KnowledgePayload> {
  const rawSources = Array.isArray(config.knowledgeSources)
    ? (config.knowledgeSources as KnowledgeSource[])
    : [];

  const sources: KnowledgeSource[] = [];
  const texts: KnowledgeText[] = [];
  const urls: string[] = [];
  const files: KnowledgeFile[] = [];
  const fileRefs: KnowledgeFileRef[] = [];
  const enableAutoRefresh = false;

  if (options.includeCanonicalBusinessFacts !== false) {
    const canonicalFacts = buildCanonicalBusinessFacts(config, options.canonicalBusinessFacts);
    if (canonicalFacts) {
      const canonicalPolicyError = canonicalFactsPolicyError(canonicalFacts.content);
      if (canonicalPolicyError) {
        sources.push(rejectedSource(canonicalFacts, canonicalPolicyError));
      } else {
        texts.push({ title: sourceTitle(canonicalFacts, 'Phonbot Business Fakten'), text: canonicalFacts.content });
      }
    }
  }

  for (const raw of rawSources.slice(0, MAX_SOURCES)) {
    if (!raw || typeof raw !== 'object') continue;
    const src = raw as KnowledgeSource;
    if (!src.id || !src.type) continue;
    const scanText = src.type === 'text'
      ? `${src.name}\n${src.content ?? ''}`
      : src.type === 'url'
        ? `${src.name}`
        : `${src.name}\n${src.url ?? src.content ?? ''}`;
    const policyError = sourcePolicyError(src, scanText, options.now);
    if (policyError) {
      sources.push(rejectedSource(src, policyError));
      continue;
    }

    if (src.type === 'text') {
      const text = truncate((src.content ?? '').trim(), MAX_TEXT_CHARS);
      if (!text) {
        sources.push({ ...src, status: 'error', error: 'EMPTY_TEXT' });
        continue;
      }
      const title = sourceTitle(src, 'Eigener Text');
      texts.push({ title, text });
      sources.push({ ...src, name: title, content: text, status: 'indexed', error: undefined });
      continue;
    }

    if (src.type === 'url') {
      const checked = await validateKnowledgeUrl(src.url || src.content);
      if (!checked.ok) {
        sources.push({ ...src, status: 'error', error: checked.error });
        continue;
      }

      if (options.inspectUrlContent) {
        const fetched = options.fetchUrlContent
          ? await options.fetchUrlContent(checked.url)
          : await fetchKnowledgeUrlContent(checked.url);
        if ('error' in fetched) {
          sources.push({ ...src, url: checked.url, content: checked.url, status: 'error', error: fetched.error });
          continue;
        }

        const finalChecked = await validateKnowledgeUrl(fetched.finalUrl || checked.url);
        if (!finalChecked.ok) {
          sources.push({ ...src, url: checked.url, content: checked.url, status: 'error', error: finalChecked.error });
          continue;
        }

        const snapshot = snapshotTextFromUrlContent(fetched.text, fetched.contentType);
        if (!snapshot) {
          sources.push({ ...src, url: finalChecked.url, content: finalChecked.url, status: 'error', error: 'URL_EMPTY' });
          continue;
        }

        const embeddedPolicyError = embeddedContentPolicyError(`${src.name}\n${fetched.text}\n${snapshot}`);
        if (embeddedPolicyError) {
          sources.push(rejectedSource({ ...src, url: finalChecked.url, content: finalChecked.url }, embeddedPolicyError));
          continue;
        }

        const title = sourceTitle(src, finalChecked.host);
        texts.push({ title, text: snapshot });
        sources.push({
          ...src,
          name: title,
          url: finalChecked.url,
          content: finalChecked.url,
          status: 'indexed',
          error: undefined,
          fetchedAt: nowIso(options.now),
          contentHash: contentHash(snapshot),
          etag: compact(fetched.etag ?? undefined) || undefined,
          lastModified: compact(fetched.lastModified ?? undefined) || undefined,
        });
        continue;
      }

      urls.push(checked.url);
      sources.push({
        ...src,
        name: sourceTitle(src, checked.host),
        url: checked.url,
        content: checked.url,
        status: 'indexed',
        error: undefined,
      });
      continue;
    }

    if (src.type === 'pdf') {
      const title = sanitizeFilename(sourceTitle(src, src.content || 'wissen.pdf'));
      const fileId = compact(src.fileId || src.id);
      const sha256 = compact(src.sha256);
      const sizeBytes = Number.isFinite(src.sizeBytes) ? Number(src.sizeBytes) : 0;
      if (!fileId || !sha256) {
        sources.push({ ...src, name: title, content: title, status: 'error', error: 'PDF_FILE_MISSING' });
        continue;
      }

      if (!options.loadPdfFile) {
        if (options.requirePdfBytes) {
          sources.push({ ...src, name: title, content: title, status: 'error', error: 'PDF_UPLOAD_REQUIRES_DATABASE' });
          continue;
        }
        sources.push({
          ...src,
          name: title,
          content: title,
          fileId,
          sha256,
          sizeBytes: sizeBytes || undefined,
          mimeType: src.mimeType || 'application/pdf',
          status: 'pending',
          error: undefined,
        });
        fileRefs.push({ filename: title, mimeType: src.mimeType || 'application/pdf', sha256, sizeBytes });
        continue;
      }

      const loaded = await options.loadPdfFile({ ...src, fileId, sha256, name: title, content: title });
      if (!loaded) {
        sources.push({ ...src, name: title, content: title, status: 'error', error: 'PDF_FILE_MISSING' });
        continue;
      }
      if (loaded.sha256 !== sha256) {
        sources.push({ ...src, name: title, content: title, status: 'error', error: 'PDF_FILE_CHANGED' });
        continue;
      }

      const filename = sanitizeFilename(loaded.filename || title);
      const file: KnowledgeFile = {
        filename,
        mimeType: loaded.mimeType || 'application/pdf',
        sizeBytes: loaded.sizeBytes,
        sha256: loaded.sha256,
        data: loaded.data,
      };
      const activeContentError = pdfActiveContentPolicyError(loaded.data);
      if (activeContentError) {
        sources.push(rejectedSource({ ...src, name: filename, content: filename, fileId, sha256 }, activeContentError));
        continue;
      }
      const pdfScanText = extractPdfScanText(loaded.data);
      const pdfPolicyError = embeddedContentPolicyError(`${src.name}\n${filename}\n${pdfScanText}`);
      if (pdfPolicyError) {
        sources.push(rejectedSource({ ...src, name: filename, content: filename, fileId, sha256 }, pdfPolicyError));
        continue;
      }
      if (!hasReadablePdfScanText(pdfScanText)) {
        if (options.ocrPdfFile) {
          if (!externalOcrProcessorAllowed()) {
            sources.push(rejectedSource({ ...src, name: filename, content: filename, fileId, sha256 }, 'PDF_OCR_PROCESSOR_NOT_ENABLED'));
            continue;
          }
          const ocr = await options.ocrPdfFile(file, { ...src, name: filename, content: filename, fileId, sha256 });
          if ('error' in ocr) {
            sources.push(rejectedSource({ ...src, name: filename, content: filename, fileId, sha256, ocrStatus: 'failed' }, ocr.error));
            continue;
          }

          const ocrText = truncate(ocr.text, MAX_TEXT_CHARS);
          const ocrPolicyError = embeddedContentPolicyError(`${src.name}\n${filename}\n${ocrText}`);
          if (ocrPolicyError) {
            sources.push(rejectedSource({ ...src, name: filename, content: filename, fileId, sha256, ocrStatus: 'completed', ocrEngine: ocr.engine }, ocrPolicyError));
            continue;
          }

          if (!hasUsableOcrText(ocrText)) {
            sources.push(rejectedSource({ ...src, name: filename, content: filename, fileId, sha256, ocrStatus: 'failed', ocrEngine: ocr.engine }, 'OCR_EMPTY'));
            continue;
          }

          const ocrTitle = `${filename} OCR`;
          texts.push({ title: ocrTitle, text: ocrText });
          sources.push({
            ...src,
            name: filename,
            content: filename,
            fileId,
            sha256,
            sizeBytes: file.sizeBytes,
            mimeType: file.mimeType,
            status: 'indexed',
            error: undefined,
            ocrStatus: 'completed',
            ocrEngine: ocr.engine,
            fetchedAt: nowIso(options.now),
            contentHash: contentHash(ocrText),
          });
          continue;
        }

        sources.push(rejectedSource({ ...src, name: filename, content: filename, fileId, sha256 }, 'PDF_REVIEW_REQUIRED'));
        continue;
      }
      const pdfText = truncate(pdfScanText, MAX_TEXT_CHARS);
      texts.push({ title: filename, text: pdfText });
      fileRefs.push({ filename, mimeType: 'text/plain', sizeBytes: Buffer.byteLength(pdfText, 'utf8'), sha256: contentHash(pdfText) });
      sources.push({
        ...src,
        name: filename,
        content: filename,
        fileId,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        status: 'indexed',
        error: undefined,
        fetchedAt: nowIso(options.now),
        contentHash: contentHash(pdfText),
      });
    }
  }

  return { sources, texts, urls, files, enableAutoRefresh, signature: stableSignature(texts, urls, fileRefs, enableAutoRefresh) };
}

export async function normalizeKnowledgeSources<T extends Record<string, unknown>>(config: T): Promise<T> {
  const payload = await prepareKnowledgePayload(config);
  if (payload.sources.length === 0 && !Array.isArray(config.knowledgeSources)) return config;
  const sources = payload.sources.map((src) =>
    src.status === 'indexed' ? { ...src, status: 'pending' as const } : src,
  );
  return { ...config, knowledgeSources: sources } as T;
}

function knowledgeBaseName(config: Record<string, unknown>): string {
  const rawName = compact(config.businessName as string | undefined)
    || compact(config.name as string | undefined)
    || 'Phonbot Wissen';
  return truncate(rawName.replace(/[^\p{L}\p{N}\s._-]+/gu, ''), 38) || 'Phonbot Wissen';
}

async function loadCanonicalBusinessFactContext(orgId?: string): Promise<CanonicalBusinessFactOptions> {
  if (!pool || !orgId) return {};
  try {
    const [staffRes, scheduleRes, staffScheduleRes] = await Promise.all([
      pool.query<{ name: string | null; role: string | null; services: string[] | null }>(
        `SELECT name, role, services
         FROM calendar_staff
         WHERE org_id = $1 AND active = true
         ORDER BY sort_order, name
         LIMIT 40`,
        [orgId],
      ),
      pool.query<{ schedule: unknown }>(
        `SELECT schedule FROM chipy_schedules WHERE org_id = $1 LIMIT 1`,
        [orgId],
      ),
      pool.query<{ name: string | null; schedule: unknown }>(
        `SELECT cs.name, scs.schedule
         FROM staff_chipy_schedules scs
         JOIN calendar_staff cs ON cs.id = scs.staff_id AND cs.org_id = scs.org_id
         WHERE scs.org_id = $1 AND cs.active = true
         ORDER BY cs.sort_order, cs.name
         LIMIT 40`,
        [orgId],
      ),
    ]);
    return {
      staff: staffRes.rows.map((row) => ({ name: row.name, role: row.role, services: row.services })),
      openingHoursSchedule: scheduleRes.rows[0]?.schedule,
      staffSchedules: staffScheduleRes.rows.map((row) => ({ name: row.name, schedule: row.schedule })),
    };
  } catch {
    return {};
  }
}

export async function syncRetellKnowledgeBase<T extends Record<string, unknown>>(config: T, orgId?: string): Promise<T> {
  const tenantId = typeof config.tenantId === 'string' ? config.tenantId : '';
  const canonicalBusinessFacts = await loadCanonicalBusinessFactContext(orgId);
  const payload = await prepareKnowledgePayload(config, {
    requirePdfBytes: true,
    inspectUrlContent: true,
    loadPdfFile: orgId && tenantId
      ? (source) => loadStoredKnowledgePdf(orgId, tenantId, source)
      : undefined,
    ocrPdfFile: ocrPdfWithOpenAI,
    canonicalBusinessFacts,
  });
  const previousId = typeof config.retellKnowledgeBaseId === 'string' ? config.retellKnowledgeBaseId : '';
  const previousSignature = typeof config.knowledgeBaseSignature === 'string' ? config.knowledgeBaseSignature : '';

  if (!payload.signature) {
    const next: Record<string, unknown> = { ...config, knowledgeSources: payload.sources };
    delete next.retellKnowledgeBaseId;
    delete next.knowledgeBaseSignature;
    return next as T;
  }

  if (previousId && previousSignature === payload.signature) {
    try {
      await waitForKnowledgeBaseComplete(previousId, { timeoutMs: 5_000, intervalMs: 1_000 });
      return {
        ...config,
        knowledgeSources: payload.sources,
        retellKnowledgeBaseId: previousId,
        knowledgeBaseSignature: previousSignature,
      } as T;
    } catch {
      // The stored KB can be manually deleted or left broken after a partial deploy.
      // Fall through and create a fresh KB from the unchanged payload.
    }
  }

  const kb = await createKnowledgeBase({
    name: knowledgeBaseName(config),
    texts: payload.texts,
    urls: payload.urls,
    files: payload.files,
    enableAutoRefresh: payload.enableAutoRefresh,
  });
  let readyKb;
  try {
    readyKb = await waitForKnowledgeBaseComplete(kb.knowledge_base_id);
  } catch (err) {
    await Promise.resolve(deleteKnowledgeBase(kb.knowledge_base_id)).catch(() => {});
    throw err;
  }

  return {
    ...config,
    knowledgeSources: payload.sources,
    retellKnowledgeBaseId: readyKb.knowledge_base_id,
    knowledgeBaseSignature: payload.signature,
  } as T;
}
