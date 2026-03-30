import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { redis } from './redis.js';

export const TraceEventSchema = z.object({
  type: z.string().min(1),
  sessionId: z.string().min(1),
  at: z.number().int().nonnegative(),
}).passthrough();

export type TraceEvent = z.infer<typeof TraceEventSchema>;

const MAX_EVENTS_PER_SESSION = 500;

/** TTL: drop trace data after 1 hour. */
const TRACES_TTL_SECONDS = 60 * 60;

// In-memory fallback store
const eventsBySession = new Map<string, TraceEvent[]>();

// SSE listeners always stay in-memory (Redis Pub/Sub is overkill for MVP)
const listeners = new Set<(event: TraceEvent) => void>();

function redisKey(sessionId: string) {
  return `traces:${sessionId}`;
}

export async function appendTraceEvent(e: TraceEvent): Promise<void> {
  // Notify SSE listeners regardless of storage backend
  for (const l of listeners) l(e);

  if (redis) {
    const raw = await redis.get(redisKey(e.sessionId));
    const list: TraceEvent[] = raw ? JSON.parse(raw) : [];
    list.unshift(e);
    if (list.length > MAX_EVENTS_PER_SESSION) list.length = MAX_EVENTS_PER_SESSION;
    await redis.setEx(redisKey(e.sessionId), TRACES_TTL_SECONDS, JSON.stringify(list));
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

export async function getTraceEvents(sessionId: string, limit: number): Promise<TraceEvent[]> {
  if (redis) {
    const raw = await redis.get(redisKey(sessionId));
    const list: TraceEvent[] = raw ? JSON.parse(raw) : [];
    return list.slice(0, limit);
  }
  return (eventsBySession.get(sessionId) ?? []).slice(0, limit);
}

export async function registerTraces(app: FastifyInstance) {
  app.get('/sessions/:sessionId/events', async (req) => {
    const params = z.object({ sessionId: z.string().min(1) }).parse(req.params);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    return { items: await getTraceEvents(params.sessionId, q.limit) };
  });

  app.post('/sessions/:sessionId/events', async (req, reply) => {
    const params = z.object({ sessionId: z.string().min(1) }).parse(req.params);
    const body = TraceEventSchema.parse({ ...(req.body as any), sessionId: params.sessionId });
    await appendTraceEvent(body);
    reply.code(201);
    return { ok: true };
  });
}
