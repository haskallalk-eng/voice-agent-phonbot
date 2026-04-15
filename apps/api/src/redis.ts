import { createClient, type RedisClientType } from 'redis';
import './env.js';

const REDIS_URL = process.env.REDIS_URL;

// Refuse plain-text Redis connections in production. Managed Redis (Upstash,
// ElastiCache, Redis Cloud) always offers rediss://, and our session store +
// refresh-cookie rate-limiter flow through these queries — unencrypted would
// expose session blobs on the wire. The opt-out allows an intra-VPC/Docker-
// network deploy (REDIS_ALLOW_PLAINTEXT=true) where TLS would be overhead.
if (
  REDIS_URL &&
  process.env.NODE_ENV === 'production' &&
  !REDIS_URL.startsWith('rediss://') &&
  process.env.REDIS_ALLOW_PLAINTEXT !== 'true'
) {
  throw new Error(
    '[redis] REDIS_URL must use rediss:// in production — refusing to boot with plaintext Redis transport. Set REDIS_ALLOW_PLAINTEXT=true only if Redis is on a private network you fully control.',
  );
}

export const redis: RedisClientType | null = REDIS_URL
  ? (createClient({ url: REDIS_URL }) as RedisClientType)
  : null;

export async function connectRedis() {
  if (!redis) return;

  redis.on('error', (err: Error) => {
    // Log to stderr — we intentionally don't throw here since Redis errors
    // are non-fatal (session store falls back to in-memory).
    process.stderr.write(`[redis] Error: ${err.message}\n`);
  });

  try {
    await redis.connect();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[redis] Failed to connect: ${msg} — falling back to in-memory session store\n`);
  }
}
