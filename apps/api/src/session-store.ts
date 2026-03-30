/**
 * Conversation session store.
 *
 * Uses Redis when REDIS_URL is configured, falls back to in-memory for dev.
 * All public functions are async.
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

function memGetOrCreate(sessionId: string, tenantId: string): Session {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { tenantId, messages: [], createdAt: Date.now(), lastActiveAt: Date.now() };
    sessions.set(sessionId, s);
  }
  s.lastActiveAt = Date.now();
  return s;
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

function redisKey(sessionId: string) {
  return `session:${sessionId}`;
}

async function redisGetOrCreate(sessionId: string, tenantId: string): Promise<Session> {
  const raw = await redis!.get(redisKey(sessionId));
  if (raw) {
    const s: Session = JSON.parse(raw);
    s.lastActiveAt = Date.now();
    await redis!.setEx(redisKey(sessionId), SESSION_TTL_SECONDS, JSON.stringify(s));
    return s;
  }
  const s: Session = { tenantId, messages: [], createdAt: Date.now(), lastActiveAt: Date.now() };
  await redis!.setEx(redisKey(sessionId), SESSION_TTL_SECONDS, JSON.stringify(s));
  return s;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function pushMessage(
  sessionId: string,
  tenantId: string,
  msg: ConversationMessage,
): Promise<void> {
  if (redis) {
    const s = await redisGetOrCreate(sessionId, tenantId);
    s.messages.push(msg);
    if (s.messages.length > MAX_MESSAGES) {
      s.messages = s.messages.slice(-MAX_MESSAGES);
    }
    s.lastActiveAt = Date.now();
    await redis.setEx(redisKey(sessionId), SESSION_TTL_SECONDS, JSON.stringify(s));
  } else {
    const s = memGetOrCreate(sessionId, tenantId);
    s.messages.push(msg);
    if (s.messages.length > MAX_MESSAGES) {
      s.messages = s.messages.slice(-MAX_MESSAGES);
    }
  }
}

export async function getMessages(
  sessionId: string,
  tenantId: string,
): Promise<ConversationMessage[]> {
  if (redis) {
    const s = await redisGetOrCreate(sessionId, tenantId);
    return s.messages;
  }
  return memGetOrCreate(sessionId, tenantId).messages;
}

export async function clearSession(sessionId: string): Promise<void> {
  if (redis) {
    await redis.del(redisKey(sessionId));
  } else {
    sessions.delete(sessionId);
  }
}

export async function listSessions(
  tenantId?: string,
): Promise<{ sessionId: string; messageCount: number; lastActiveAt: number }[]> {
  if (redis) {
    const keys = await redis.keys('session:*');
    const result: { sessionId: string; messageCount: number; lastActiveAt: number }[] = [];
    for (const key of keys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const s: Session = JSON.parse(raw);
      if (tenantId && s.tenantId !== tenantId) continue;
      const sessionId = key.replace(/^session:/, '');
      result.push({ sessionId, messageCount: s.messages.length, lastActiveAt: s.lastActiveAt });
    }
    return result.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  const result: { sessionId: string; messageCount: number; lastActiveAt: number }[] = [];
  for (const [id, s] of sessions) {
    if (tenantId && s.tenantId !== tenantId) continue;
    result.push({ sessionId: id, messageCount: s.messages.length, lastActiveAt: s.lastActiveAt });
  }
  return result.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
