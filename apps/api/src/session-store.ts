/**
 * Conversation session store.
 *
 * Uses Redis when REDIS_URL is configured, falls back to in-memory for dev.
 * All public functions are async.
 *
 * Tenant isolation: all read/mutate operations enforce `tenantId` match.
 * A caller with tenantId X cannot read, clear, or write to a session owned by tenantId Y
 * (even if they know the sessionId). Previously: only the sessionId gate existed.
 */

import { redis } from './redis.js';

export type MessageRole = 'user' | 'assistant' | 'tool';

export type ConversationMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; name: string; content: string };

interface Session {
  tenantId: string;
  messages: ConversationMessage[];
  createdAt: number;
  lastActiveAt: number;
}

/** Max messages kept per session (avoid unbounded growth). */
const MAX_MESSAGES = 100;

/** TTL: drop sessions after 2 hours of inactivity. */
const SESSION_TTL_SECONDS = 2 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

// ── In-memory fallback ────────────────────────────────────────────────────────

const sessions = new Map<string, Session>();

// Periodic cleanup every 10 minutes (in-memory only).
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.lastActiveAt < cutoff) sessions.delete(id);
  }
}, 10 * 60 * 1000).unref();

function redisKey(sessionId: string) {
  return `session:${sessionId}`;
}

// ── Internal: read-with-tenant-check ─────────────────────────────────────────
// Returns null if session doesn't exist OR belongs to a different tenant.
// Prevents cross-tenant leak when sessionId is known but ownership isn't.

async function readSession(sessionId: string, tenantId: string): Promise<Session | null> {
  if (redis) {
    const raw = await redis.get(redisKey(sessionId));
    if (!raw) return null;
    const s: Session = JSON.parse(raw);
    if (s.tenantId !== tenantId) return null;   // ← tenant isolation
    return s;
  }
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (s.tenantId !== tenantId) return null;
  return s;
}

// Distinguish "session doesn't exist" from "exists but owned by another tenant".
// getOrCreate needs this so a cross-tenant collision can fail closed instead of
// being silently overwritten.
async function peekSessionOwner(sessionId: string): Promise<string | null> {
  if (redis) {
    const raw = await redis.get(redisKey(sessionId));
    if (!raw) return null;
    try { return (JSON.parse(raw) as Session).tenantId ?? null; } catch { return null; }
  }
  return sessions.get(sessionId)?.tenantId ?? null;
}

async function writeSession(sessionId: string, s: Session): Promise<void> {
  s.lastActiveAt = Date.now();
  if (redis) {
    await redis.setEx(redisKey(sessionId), SESSION_TTL_SECONDS, JSON.stringify(s));
  } else {
    sessions.set(sessionId, s);
  }
}

async function getOrCreate(sessionId: string, tenantId: string): Promise<Session> {
  const existing = await readSession(sessionId, tenantId);
  if (existing) { existing.lastActiveAt = Date.now(); await writeSession(sessionId, existing); return existing; }

  // Before creating a new session under our tenant, check whether the key is
  // already claimed by a different tenant. Previously we silently overwrote —
  // attacker with a leaked sessionId from another org could POST /chat with
  // the same sessionId and wipe the victim's transcript (cross-tenant DoS).
  // sessionId is client-supplied (Zod allows any non-empty string), so we
  // cannot rely on UUID uniqueness alone.
  const owner = await peekSessionOwner(sessionId);
  if (owner && owner !== tenantId) {
    const err = new Error('SESSION_ID_COLLISION') as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  const s: Session = { tenantId, messages: [], createdAt: Date.now(), lastActiveAt: Date.now() };
  await writeSession(sessionId, s);
  return s;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function pushMessage(
  sessionId: string,
  tenantId: string,
  msg: ConversationMessage,
): Promise<void> {
  const s = await getOrCreate(sessionId, tenantId);
  s.messages.push(msg);
  if (s.messages.length > MAX_MESSAGES) {
    s.messages = s.messages.slice(-MAX_MESSAGES);
  }
  await writeSession(sessionId, s);
}

export async function getMessages(
  sessionId: string,
  tenantId: string,
): Promise<ConversationMessage[]> {
  const s = await readSession(sessionId, tenantId);
  return s ? s.messages : [];
}

/** Delete session — only if caller owns it (tenantId must match). */
export async function clearSession(sessionId: string, tenantId: string): Promise<void> {
  const s = await readSession(sessionId, tenantId);
  if (!s) return;   // not found OR not ours — no-op (don't leak existence)
  if (redis) {
    await redis.del(redisKey(sessionId));
  } else {
    sessions.delete(sessionId);
  }
}

export async function listSessions(
  tenantId: string,
): Promise<{ sessionId: string; messageCount: number; lastActiveAt: number }[]> {
  if (redis) {
    const result: { sessionId: string; messageCount: number; lastActiveAt: number }[] = [];
    let cursor = 0;
    do {
      const reply = await redis.scan(cursor, { MATCH: 'session:*', COUNT: 100 });
      cursor = reply.cursor;
      for (const key of reply.keys) {
        const raw = await redis.get(key);
        if (!raw) continue;
        const s: Session = JSON.parse(raw);
        if (s.tenantId !== tenantId) continue;
        const sessionId = key.replace(/^session:/, '');
        result.push({ sessionId, messageCount: s.messages.length, lastActiveAt: s.lastActiveAt });
      }
    } while (cursor !== 0);
    return result.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  const result: { sessionId: string; messageCount: number; lastActiveAt: number }[] = [];
  for (const [id, s] of sessions) {
    if (s.tenantId !== tenantId) continue;
    result.push({ sessionId: id, messageCount: s.messages.length, lastActiveAt: s.lastActiveAt });
  }
  return result.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
