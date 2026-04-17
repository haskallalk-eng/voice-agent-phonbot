import '@fastify/jwt';
import { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; orgId: string; role: string } | { admin: true; aud: 'phonbot:admin' };
    user: { userId: string; orgId: string; role: string } | { admin: true; aud: 'phonbot:admin' };
  }
}
