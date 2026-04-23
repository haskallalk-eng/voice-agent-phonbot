import crypto from 'node:crypto';
import { createKnowledgeBase, deleteKnowledgeBase } from './retell.js';
import { pool } from './db.js';
import { isPrivateHost, isPrivateResolved, isBlockedPort } from './ssrf-guard.js';

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
};

export type KnowledgePayload = {
  sources: KnowledgeSource[];
  texts: KnowledgeText[];
  urls: string[];
  files: KnowledgeFile[];
  signature: string | null;
};

const MAX_SOURCES = 25;
const MAX_TEXT_CHARS = 50000;
const MAX_PDF_BYTES = 50 * 1024 * 1024;

function compact(input: string | null | undefined): string {
  return (input ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(input: string, max: number): string {
  const text = input.trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
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

export async function syncRetellKnowledgeBase<T extends Record<string, unknown>>(config: T, orgId?: string): Promise<T> {
  const tenantId = typeof config.tenantId === 'string' ? config.tenantId : '';
  const payload = await prepareKnowledgePayload(config, {
    requirePdfBytes: true,
    loadPdfFile: orgId && tenantId
      ? (source) => loadStoredKnowledgePdf(orgId, tenantId, source)
      : undefined,
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
