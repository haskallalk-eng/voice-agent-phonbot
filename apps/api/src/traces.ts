import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { redis } from './redis.js';

export const TraceEventSchema = z.object({
  type: z.string().min(1),
  sessionId: z.string().min(1),
  at: z.number().int().nonnegative(),
  tenantId: z.string().optional(),
}).passthrough();

export type TraceEvent = z.infer<typeof TraceEventSchema>;

const MAX_EVENTS_PER_SESSION = 500;

/** TTL: drop trace data after 1 hour. */
const TRACES_TTL_SECONDS = 60 * 60;

// In-memory fallback store
const eventsBySession = new Map<string, TraceEvent[]>();
// Per-session tenant stamp (tenant isolation — only the tenant who first wrote
// an event carrying tenantId can read the session's traces).
const tenantBySession = new Map<string, string>();

// SSE listeners always stay in-memory (Redis Pub/Sub is overkill for MVP)
const listeners = new Set<(event: TraceEvent) => void>();

function eventsKey(sessionId: string) {
  return `traces:${sessionId}`;
}
function tenantKey(sessionId: string) {
  return `traces_tenant:${sessionId}`;
}

async function readSessionTenant(sessionId: string): Promise<string | null> {
  if (redis) return (await redis.get(tenantKey(sessionId))) ?? null;
  return tenantBySession.get(sessionId) ?? null;
}

async function stampSessionTenant(sessionId: string, tenantId: string): Promise<void> {
  // First-writer-wins: don't overwrite an existing stamp. Prevents a second
  // tenant from claiming someone else's sessionId just by writing an event.
  const existing = await readSessionTenant(sessionId);
  if (existing) return;
  if (redis) {
    await redis.setEx(tenantKey(sessionId), TRACES_TTL_SECONDS, tenantId);
  } else {
    tenantBySession.set(sessionId, tenantId);
  }
}

export async function appendTraceEvent(e: TraceEvent): Promise<void> {
  // Notify SSE listeners regardless of storage backend
  for (const l of listeners) l(e);

  if (e.tenantId) await stampSessionTenant(e.sessionId, e.tenantId);

  if (redis) {
    const raw = await redis.get(eventsKey(e.sessionId));
    const list: TraceEvent[] = raw ? JSON.parse(raw) : [];
    list.unshift(e);
    if (list.length > MAX_EVENTS_PER_SESSION) list.length = MAX_EVENTS_PER_SESSION;
    await redis.setEx(eventsKey(e.sessionId), TRACES_TTL_SECONDS, JSON.stringify(list));
  } else {
    const list = eventsBySession.get(e.sessionId) ?? [];
    list.unshift(e);
    if (list.length > MAX_EVENTS_PER_SESSION) list.length = MAX_EVENTS_PER_SESSION;
    eventsBySession.set(e.sessionId, list);
  }
}

export function onTraceEvent(handler: (event: TraceEvent) => void) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

/**
 * Returns trace events for the session ONLY if the caller's tenantId matches
 * the first-writer stamp. Returns [] when session is unstamped (legacy/foreign)
 * or when tenantId mismatches — fail closed to prevent cross-tenant trace leak.
 */
export async function getTraceEvents(
  sessionId: string,
  tenantId: string,
  limit: number,
): Promise<TraceEvent[]> {
  const owner = await readSessionTenant(sessionId);
  if (owner !== tenantId) return [];

  if (redis) {
    const raw = await redis.get(eventsKey(sessionId));
    const list: TraceEvent[] = raw ? JSON.parse(raw) : [];
    return list.slice(0, limit);
  }
  return (eventsBySession.get(sessionId) ?? []).slice(0, limit);
}

export async function registerTraces(app: FastifyInstance) {
  // Both endpoints require auth — they leak/write trace data that includes
  // tool_call parameters (customer name, phone, booking details).
  const auth = { onRequest: [app.authenticate] };

  app.get('/sessions/:sessionId/events', { ...auth }, async (req) => {
    const { orgId } = req.user as import('./auth.js').JwtPayload;
    const params = z.object({ sessionId: z.string().min(1) }).parse(req.params);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    return { items: await getTraceEvents(params.sessionId, orgId, q.limit) };
  });

  app.post('/sessions/:sessionId/events', {
    ...auth,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { orgId } = req.user as import('./auth.js').JwtPayload;
    const params = z.object({ sessionId: z.string().min(1) }).parse(req.params);
    // If session is already stamped to another tenant, refuse the write.
    const owner = await readSessionTenant(params.sessionId);
    if (owner && owner !== orgId) {
      return reply.code(404).send({ error: 'session not found' });
    }
    const body = TraceEventSchema.parse({
      ...(req.body as Record<string, unknown>),
      sessionId: params.sessionId,
      tenantId: orgId,
    });
    await appendTraceEvent(body);
    reply.code(201);
    return { ok: true };
  });
}
