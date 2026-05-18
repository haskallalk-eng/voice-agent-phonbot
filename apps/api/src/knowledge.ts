import crypto from 'node:crypto';
import { createKnowledgeBase, deleteKnowledgeBase } from './retell.js';
import { pool } from './db.js';
import { isPrivateHost, isPrivateResolved, isBlockedPort } from './ssrf-guard.js';
import {
  customerModuleActiveForAgentConfig,
  getActiveCustomerQuestions,
  normalizeCustomerModuleConfig,
  type CustomerModuleConfig,
} from './customers.js';
import { chipyScheduleToOpeningHours } from './opening-hours-sync.js';

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
  includeCanonicalBusinessFacts?: boolean;
  canonicalBusinessFacts?: CanonicalBusinessFactOptions;
};

export type KnowledgePayload = {
  sources: KnowledgeSource[];
  texts: KnowledgeText[];
  urls: string[];
  files: KnowledgeFile[];
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

function stableSignature(texts: KnowledgeText[], urls: string[], files: KnowledgeFileRef[]): string | null {
  if (texts.length === 0 && urls.length === 0 && files.length === 0) return null;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      texts: texts.map((t) => ({ title: t.title, text: t.text })),
      urls,
      files: files.map((f) => ({ filename: f.filename, sha256: f.sha256, sizeBytes: f.sizeBytes })),
    }))
    .digest('hex');
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
    if (isBlockedPort(url.port)) return { ok: false, error: 'BLOCKED_PORT' };
    if (isPrivateHost(url.hostname)) return { ok: false, error: 'PRIVATE_HOST' };
    if (await isPrivateResolved(url.hostname)) return { ok: false, error: 'PRIVATE_HOST' };
    url.hash = '';
    return { ok: true, url: url.toString(), host: url.hostname };
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }
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

  if (options.includeCanonicalBusinessFacts !== false) {
    const canonicalFacts = buildCanonicalBusinessFacts(config, options.canonicalBusinessFacts);
    if (canonicalFacts) {
      texts.push({ title: sourceTitle(canonicalFacts, 'Phonbot Business Fakten'), text: canonicalFacts.content });
    }
  }

  for (const raw of rawSources.slice(0, MAX_SOURCES)) {
    if (!raw || typeof raw !== 'object') continue;
    const src = raw as KnowledgeSource;
    if (!src.id || !src.type) continue;

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
      files.push(file);
      fileRefs.push({ filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256: file.sha256 });
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
      });
    }
  }

  return { sources, texts, urls, files, signature: stableSignature(texts, urls, fileRefs) };
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
    loadPdfFile: orgId && tenantId
      ? (source) => loadStoredKnowledgePdf(orgId, tenantId, source)
      : undefined,
    canonicalBusinessFacts,
  });
  const previousId = typeof config.retellKnowledgeBaseId === 'string' ? config.retellKnowledgeBaseId : '';
  const previousSignature = typeof config.knowledgeBaseSignature === 'string' ? config.knowledgeBaseSignature : '';

  if (!payload.signature) {
    if (previousId) await deleteKnowledgeBase(previousId).catch(() => {});
    const next: Record<string, unknown> = { ...config, knowledgeSources: payload.sources };
    delete next.retellKnowledgeBaseId;
    delete next.knowledgeBaseSignature;
    return next as T;
  }

  if (previousId && previousSignature === payload.signature) {
    return {
      ...config,
      knowledgeSources: payload.sources,
      retellKnowledgeBaseId: previousId,
      knowledgeBaseSignature: previousSignature,
    } as T;
  }

  const kb = await createKnowledgeBase({
    name: knowledgeBaseName(config),
    texts: payload.texts,
    urls: payload.urls,
    files: payload.files,
    enableAutoRefresh: payload.urls.length > 0,
  });

  if (previousId && previousId !== kb.knowledge_base_id) {
    await deleteKnowledgeBase(previousId).catch(() => {});
  }

  return {
    ...config,
    knowledgeSources: payload.sources,
    retellKnowledgeBaseId: kb.knowledge_base_id,
    knowledgeBaseSignature: payload.signature,
  } as T;
}
