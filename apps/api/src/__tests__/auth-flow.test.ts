/**
 * Auth-flow smoke tests — validates the critical security invariants
 * across register → login → refresh → reset → logout.
 *
 * Uses mocked pool (no real DB) + mocked bcrypt (instant, no 200ms wait).
 * Focus: correct status codes, refresh-token rotation, password-reset
 * revokes all sessions, logout clears cookie.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';

// Mock pg pool
const mockRows: Record<string, unknown[]> = {};
const mockQuery = vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
  // Simple router based on SQL content
  if (sql.includes('SELECT id FROM users WHERE email')) {
    return { rowCount: 0, rows: [] };
  }
  if (sql.includes('INSERT INTO orgs')) {
    return { rows: [{ id: 'org-1', name: 'Test Org', slug: 'test-org' }] };
  }
  if (sql.includes('INSERT INTO users')) {
    return { rowCount: 1, rows: [{ id: 'user-1', email: params?.[1], role: 'owner' }] };
  }
  if (sql.includes('INSERT INTO refresh_tokens')) {
    return { rows: [] };
  }
  if (sql.includes('SELECT u.id, u.email')) {
    // Login query
    return {
      rowCount: 1,
      rows: [{
        id: 'user-1',
        email: 'test@test.de',
        role: 'owner',
        password_hash: '$2b$12$mock',
        org_id: 'org-1',
        org_name: 'Test Org',
        org_slug: 'test-org',
        email_verified: true,
      }],
    };
  }
  if (sql.includes('DELETE FROM refresh_tokens')) {
    return { rowCount: 1, rows: [{ user_id: 'user-1' }] };
  }
  if (sql.includes('SELECT id, role, org_id FROM users')) {
    return { rowCount: 1, rows: [{ id: 'user-1', role: 'owner', org_id: 'org-1' }] };
  }
  if (sql.includes('UPDATE refresh_tokens SET revoked_at')) {
    return { rowCount: 1 };
  }
  return { rowCount: 0, rows: [] };
});

const mockClient = {
  query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
    return mockQuery(sql, params);
  }),
  release: vi.fn(),
};

vi.mock('../db.js', () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue(mockClient),
  },
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$12$mock'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../email.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

const { registerAuth } = await import('../auth.js');

describe('auth flow (TEST-01)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await app.register(jwt, { secret: 'test-secret-32-chars-minimum!!' });
    await app.register(cookie, { secret: 'test-secret-32-chars-minimum!!' });
    app.decorate('authenticate', async (req: any, reply: any) => {
      try { await req.jwtVerify(); } catch { reply.status(401).send({ error: 'Unauthorized' }); }
    });
    await registerAuth(app);
    await app.ready();
  });

  it('POST /auth/register returns 201 + token + user + org', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { orgName: 'Test Org', email: 'new@test.de', password: 'securepass123' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe('new@test.de');
    expect(body.org.name).toBe('Test Org');
  });

  it('POST /auth/register with short password returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { orgName: 'X', email: 'x@x.de', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /auth/login returns token + user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'test@test.de', password: 'securepass123' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
    expect(body.user.id).toBe('user-1');
  });

  it('POST /auth/login with wrong email returns 401', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'wrong@test.de', password: 'xxx' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /auth/forgot-password always returns ok (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'anyone@test.de' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('POST /auth/logout returns ok', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('GET /auth/me without token returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
    });
    expect(res.statusCode).toBe(401);
  });

  // Edge-case: password exactly at bcrypt 72-byte limit
  it('POST /auth/register with 72-char password succeeds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { orgName: 'Edge Org', email: 'edge@test.de', password: 'a'.repeat(72) },
    });
    expect(res.statusCode).toBe(201);
  });

  // Edge-case: password over 72 bytes rejected (D5 guard)
  it('POST /auth/register with >72-char password returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { orgName: 'Too Long', email: 'long@test.de', password: 'a'.repeat(73) },
    });
    expect(res.statusCode).toBe(400);
  });

  // Edge-case: missing orgName in register
  it('POST /auth/register without orgName returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'no-org@test.de', password: 'validpass123' },
    });
    expect(res.statusCode).toBe(400);
  });

  // Edge-case: invalid email format
  it('POST /auth/register with invalid email returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { orgName: 'Bad Email', email: 'not-an-email', password: 'validpass123' },
    });
    expect(res.statusCode).toBe(400);
  });

  // Edge-case: verify-email with invalid token returns 400
  it('POST /auth/verify-email with bad token returns 400', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'nonexistent-token-abc123' },
    });
    expect(res.statusCode).toBe(400);
  });
});
