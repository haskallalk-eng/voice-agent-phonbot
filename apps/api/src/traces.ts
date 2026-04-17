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
// H6: Cap map sizes to prevent OOM when Redis is unavailable.
const MAX_TRACE_SESSIONS = 10000;
const eventsBySession = new Map<string, TraceEvent[]>();
// Per-session tenant stamp (tenant isolation — only the tenant who first wrote
// an event carrying tenantId can read the session's traces).
const tenantBySession = new Map<string, string>();

/** Evict the oldest entry (first key) when the map hits MAX_TRACE_SESSIONS. */
function boundedSet<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= MAX_TRACE_SESSIONS && !map.has(key)) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, value);
}

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
    boundedSet(tenantBySession, sessionId, tenantId);
  }
}

export async function appendTraceEvent(e: TraceEvent): Promise<void> {
  // Stamp first. This ordering is LOAD-BEARING — any future SSE/live-stream
  // mechanism must consume events AFTER the tenant stamp exists so a listener
  // can refuse events from a different tenant (otherwise cross-tenant leak via
  // shared sessionId). When adding SSE, key the subscription by (tenantId,
  // sessionId), not sessionId alone.
  if (e.tenantId) await stampSessionTenant(e.sessionId, e.tenantId);

  if (redis) {
    // Atomic LPUSH + LTRIM + EXPIRE — replaces a read-modify-write that lost
    // events under concurrent writes (e.g. tool_call + agent_text in flight at
    // the same time would overwrite each other). Multi() pipelines them in
    // order; each command is itself atomic at the Redis side.
    //
    // WRONGTYPE handling: pre-migration data was stored as a JSON-string at the
    // same key. If the legacy type is still there, DEL it once and proceed.
    // (Deployed data has TTL=1h, so this branch is rare and short-lived.)
    const key = eventsKey(e.sessionId);
    try {
      await redis.multi()
        .lPush(key, JSON.stringify(e))
        .lTrim(key, 0, MAX_EVENTS_PER_SESSION - 1)
        .expire(key, TRACES_TTL_SECONDS)
        .exec();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('WRONGTYPE')) {
        await redis.del(key);
        await redis.multi()
          .lPush(key, JSON.stringify(e))
          .lTrim(key, 0, MAX_EVENTS_PER_SESSION - 1)
          .expire(key, TRACES_TTL_SECONDS)
          .exec();
      } else {
        throw err;
      }
    }
  } else {
    const list = eventsBySession.get(e.sessionId) ?? [];
    list.unshift(e);
    if (list.length > MAX_EVENTS_PER_SESSION) list.length = MAX_EVENTS_PER_SESSION;
    boundedSet(eventsBySession, e.sessionId, list);
  }
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
    // Reads from the Redis list — paired with the LPUSH/LTRIM in appendTraceEvent.
    // lRange(0, limit-1) returns newest-first since we LPUSH (head insert).
    // WRONGTYPE catch covers legacy-format keys still in flight after the migration.
    try {
      const items = await redis.lRange(eventsKey(sessionId), 0, limit - 1);
      const out: TraceEvent[] = [];
      for (const raw of items) {
        try { out.push(JSON.parse(raw) as TraceEvent); } catch { /* skip malformed */ }
      }
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('WRONGTYPE')) return [];
      throw err;
    }
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
