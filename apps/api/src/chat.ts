import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { appendTraceEvent, type TraceEvent } from './traces.js';
import { runAgentTurn } from './agent-runtime.js';
import { getMessages, clearSession, listSessions } from './session-store.js';
import type { JwtPayload } from './auth.js';

const ChatBody = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(4000),
});

export async function registerChat(app: FastifyInstance) {
  // All /chat/* endpoints are authenticated and scoped by the caller's orgId.
  // Previously unauthenticated — allowed anyone to:
  // - Read transcripts of other tenants' voice calls (PII leak)
  // - Spend unlimited tokens on the Phonbot OpenAI bill
  // - Delete any session
  const auth = { onRequest: [app.authenticate] };

  // Send a message and get an agent reply (conversation-aware).
  app.post('/chat', {
    ...auth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const body = ChatBody.parse(req.body ?? {});

    await appendTraceEvent({
      type: 'user_transcript_final',
      sessionId: body.sessionId,
      tenantId: orgId,
      text: body.text,
      at: Date.now(),
    } as TraceEvent);

    const reply = await runAgentTurn({
      tenantId: orgId,        // forced from JWT — no client-side tenant override
      sessionId: body.sessionId,
      text: body.text,
      source: 'web',
    });

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
