import crypto from 'node:crypto';
import { createKnowledgeBase, deleteKnowledgeBase } from './retell.js';
import { isPrivateHost, isPrivateResolved, isBlockedPort } from './ssrf-guard.js';

export type KnowledgeSource = {
  id: string;
  type: 'url' | 'pdf' | 'text';
  name: string;
  content: string;
  url?: string;
  status?: 'pending' | 'indexed' | 'error';
  error?: string;
};

export type KnowledgeText = { title: string; text: string };

export type KnowledgePayload = {
  sources: KnowledgeSource[];
  texts: KnowledgeText[];
  urls: string[];
  signature: string | null;
};

const MAX_SOURCES = 25;
const MAX_TEXT_CHARS = 50000;

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

function stableSignature(texts: KnowledgeText[], urls: string[]): string | null {
  if (texts.length === 0 && urls.length === 0) return null;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      texts: texts.map((t) => ({ title: t.title, text: t.text })),
      urls,
    }))
    .digest('hex');
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

export async function prepareKnowledgePayload(config: Record<string, unknown>): Promise<KnowledgePayload> {
  const rawSources = Array.isArray(config.knowledgeSources)
    ? (config.knowledgeSources as KnowledgeSource[])
    : [];

  const sources: KnowledgeSource[] = [];
  const texts: KnowledgeText[] = [];
  const urls: string[] = [];

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

    sources.push({
      ...src,
      status: 'error',
      error: 'PDF_UPLOAD_NOT_IMPLEMENTED',
    });
  }

  return { sources, texts, urls, signature: stableSignature(texts, urls) };
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

export async function syncRetellKnowledgeBase<T extends Record<string, unknown>>(config: T): Promise<T> {
  const payload = await prepareKnowledgePayload(config);
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
