import type { FastifyReply, FastifyRequest } from 'fastify';

/** Shared gate for platform-wide admin reads and mutations. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    const payload = req.user as Record<string, unknown>;
    if (payload.admin !== true || payload.aud !== 'phonbot:admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}
