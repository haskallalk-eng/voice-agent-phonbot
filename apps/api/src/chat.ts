import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { appendTraceEvent, type TraceEvent } from './traces.js';
import { runAgentTurn } from './agent-runtime.js';
import { getMessages, clearSession, listSessions } from './session-store.js';
import { redis } from './redis.js';
import type { JwtPayload } from './auth.js';

const ChatBody = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(4000),
});

// Daily cost guard — each /chat request can expand to up to 6 OpenAI Responses
// round-trips (tool loop). Rate-limit caps burst, daily budget caps total spend
// per org/day. Configurable via env so we can raise for paying plans later.
const CHAT_DAILY_BUDGET = Number(process.env.CHAT_DAILY_BUDGET_PER_ORG ?? 300);

async function enforceDailyChatBudget(orgId: string): Promise<{ ok: true } | { ok: false; count: number }> {
  if (!redis?.isOpen) return { ok: true };
  const day = new Date().toISOString().slice(0, 10);
  const key = `budget:chat:${orgId}:${day}`;
  try {
    // Atomic INCR + EXPIRE pipelined. Previous code: INCR then conditional
    // EXPIRE on count===1 — if the connection dropped between INCR and EXPIRE,
    // the counter lived forever (user permanently locked out). Refreshing the
    // TTL on every call is idempotent and cheap.
    const results = await redis.multi()
      .incr(key)
      .expire(key, 86400)
      .exec();
    const count = Number(results?.[0] ?? 0);
    if (count > CHAT_DAILY_BUDGET) return { ok: false, count };
    return { ok: true };
  } catch {
    return { ok: true }; // fail open if Redis hiccups
  }
}

export async function registerChat(app: FastifyInstance) {
  // All /chat/* endpoints are authenticated and scoped by the caller's orgId.
  // Previously unauthenticated — allowed anyone to:
  // - Read transcripts of other tenants' voice calls (PII leak)
  // - Spend unlimited tokens on the Phonbot OpenAI bill
  // - Delete any session
  const auth = { onRequest: [app.authenticate] };

  // Send a message and get an agent reply (conversation-aware).
  // Burst limit 10/min + daily budget (see enforceDailyChatBudget) — a single
  // /chat can trigger up to 6 OpenAI round-trips inside runAgentTurn, so the old
  // 30/min allowed ~180 calls/min per user.
  app.post('/chat', {
    ...auth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, res) => {
    const { orgId } = req.user as JwtPayload;
    const body = ChatBody.parse(req.body ?? {});

    const budget = await enforceDailyChatBudget(orgId);
    if (!budget.ok) {
      return res.status(429).send({
        ok: false,
        error: 'DAILY_BUDGET_EXCEEDED',
        message: `Tägliches Chat-Limit erreicht (${CHAT_DAILY_BUDGET} Anfragen). Setzt sich um 00:00 UTC zurück.`,
      });
    }

    await appendTraceEvent({
      type: 'user_transcript_final',
      sessionId: body.sessionId,
      tenantId: orgId,
      text: body.text,
      at: Date.now(),
    } as TraceEvent);

    let reply: Awaited<ReturnType<typeof runAgentTurn>>;
    try {
      reply = await runAgentTurn({
        tenantId: orgId,        // forced from JWT — no client-side tenant override
        sessionId: body.sessionId,
        text: body.text,
        source: 'web',
      });
    } catch (e: unknown) {
      // Session-id collision: another tenant already owns this sessionId.
      // Client should pick a new sessionId. Map to 409 instead of a 500.
      if (e instanceof Error && e.message === 'SESSION_ID_COLLISION') {
        return res.status(409).send({
          ok: false,
          error: 'SESSION_ID_COLLISION',
          message: 'Session-ID gehört bereits einem anderen Account. Starte eine neue Session.',
        });
      }
      throw e;
    }

    await appendTraceEvent({
      type: 'agent_text',
      sessionId: body.sessionId,
      tenantId: orgId,
      text: reply.text,
      at: Date.now(),
    } as TraceEvent);

    return { ok: true, reply: reply.text };
  });

  // Get conversation history for a session (scoped to caller's org).
  app.get('/chat/:sessionId/history', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const params = z.object({ sessionId: z.string().min(1) }).parse(req.params);
    const messages = await getMessages(params.sessionId, orgId);
    return { sessionId: params.sessionId, messages };
  });

  // Clear / reset a conversation session (scoped to caller's org — no-op if session belongs elsewhere).
  app.delete('/chat/:sessionId', { ...auth }, async (req: FastifyRequest, reply) => {
    const { orgId } = req.user as JwtPayload;
    const params = z.object({ sessionId: z.string().min(1) }).parse(req.params);
    await clearSession(params.sessionId, orgId);
    reply.code(204);
    return;
  });

  // List active sessions for the caller's org (admin/debug).
  app.get('/chat/sessions', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    return { sessions: await listSessions(orgId) };
  });
}
