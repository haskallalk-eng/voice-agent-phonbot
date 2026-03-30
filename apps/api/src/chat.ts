import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendTraceEvent, type TraceEvent } from './traces.js';
import { runAgentTurn } from './agent-runtime.js';
import { getMessages, clearSession, listSessions } from './session-store.js';

const ChatBody = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1),
  tenantId: z.string().min(1).default('demo'),
});

export async function registerChat(app: FastifyInstance) {
  // Send a message and get an agent reply (conversation-aware).
  app.post('/chat', async (req) => {
    const body = ChatBody.parse(req.body ?? {});

    await appendTraceEvent({
      type: 'user_transcript_final',
      sessionId: body.sessionId,
      text: body.text,
      at: Date.now(),
    } as TraceEvent);

    const reply = await runAgentTurn({
      tenantId: body.tenantId,
      sessionId: body.sessionId,
      text: body.text,
      source: 'web',
    });

    await appendTraceEvent({
      type: 'agent_text',
      sessionId: body.sessionId,
      text: reply.text,
      at: Date.now(),
    } as TraceEvent);

    return { ok: true, reply: reply.text };
  });

  // Get conversation history for a session.
  app.get('/chat/:sessionId/history', async (req) => {
    const params = z.object({ sessionId: z.string().min(1) }).parse(req.params);
    const q = z.object({ tenantId: z.string().min(1).default('demo') }).parse(req.query);
    const messages = await getMessages(params.sessionId, q.tenantId);
    return { sessionId: params.sessionId, messages };
  });

  // Clear / reset a conversation session.
  app.delete('/chat/:sessionId', async (req, reply) => {
    const params = z.object({ sessionId: z.string().min(1) }).parse(req.params);
    await clearSession(params.sessionId);
    reply.code(204);
    return;
  });

  // List active sessions (for admin/debug).
  app.get('/chat/sessions', async (req) => {
    const q = z.object({ tenantId: z.string().min(1).optional() }).parse(req.query);
    return { sessions: await listSessions(q.tenantId) };
  });
}
