import { createClient, type RedisClientType } from 'redis';
import './env.js';

const REDIS_URL = process.env.REDIS_URL;

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
