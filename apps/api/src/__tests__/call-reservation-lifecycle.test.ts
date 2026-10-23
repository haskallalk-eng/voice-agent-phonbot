import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), reserve: vi.fn(), bind: vi.fn(), release: vi.fn(), create: vi.fn() }));
vi.mock('../db.js', () => ({ pool: { query: mocks.query } }));
vi.mock('../redis.js', () => ({ redis: null }));
vi.mock('../usage.js', () => ({ tryReserveMinutes: mocks.reserve, bindMinutesReservation: mocks.bind,
  releaseMinutesReservation: mocks.release, DEFAULT_CALL_RESERVE_MINUTES: 5 }));
vi.mock('../retell.js', async (actual) => ({ ...await actual<typeof import('../retell.js')>(), createWebCall: mocks.create }));
vi.mock('../logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { registerAgentConfig } = await import('../agent-config.js');
const { RetellApiError } = await import('../retell.js');
const RESERVATION = '11111111-1111-4111-8111-111111111111';

async function appFixture() {
  const app = Fastify();
  app.decorate('authenticate', async (req: import('fastify').FastifyRequest) => {
    req.user = { userId: 'user-1', orgId: 'org-1', role: 'owner' };
  });
  await registerAgentConfig(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('RETELL_API_KEY', 'synthetic-retell-key');
  mocks.query.mockReset().mockResolvedValue({ rowCount: 1, rows: [{ data: { tenantId: 'tenant-1', retellAgentId: 'agent-1' } }] });
  mocks.reserve.mockReset().mockResolvedValue({ allowed: true, reservationId: RESERVATION, minutesUsed: 0, minutesLimit: 30 });
  mocks.bind.mockReset().mockResolvedValue(undefined);
  mocks.release.mockReset().mockResolvedValue(undefined);
  mocks.create.mockReset().mockResolvedValue({ call_id: 'call-web-1', access_token: 'synthetic-token', web_call_link: 'https://example.test/call' });
});
afterEach(() => vi.unstubAllEnvs());

describe('web-call reservation lifecycle', () => {
  it.each(['not-owned', 'not-deployed', 'invalid-input', 'missing-provider-key'])('validates %s before reserving', async (failure) => {
    if (failure === 'not-owned') mocks.query.mockResolvedValue({ rowCount: 0, rows: [] });
    if (failure === 'not-deployed') mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ data: { tenantId: 'tenant-1' } }] });
    if (failure === 'missing-provider-key') vi.stubEnv('RETELL_API_KEY', '');
    const app = await appFixture();
    try {
      const res = await app.inject({ method: 'POST', url: '/agent-config/web-call', payload: { agentTenantId: failure === 'invalid-input' ? 123 : 'tenant-1' } });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(false);
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('uses server reservation metadata and binds the returned provider call', async () => {
    const app = await appFixture();
    try {
      const res = await app.inject({ method: 'POST', url: '/agent-config/web-call', payload: { agentTenantId: 'tenant-1', usage_reservation_id: 'attacker' } });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(mocks.create).toHaveBeenCalledWith('agent-1', expect.objectContaining({ metadata: expect.objectContaining({ usage_reservation_id: RESERVATION, org_id: 'org-1' }) }));
      expect(mocks.bind).toHaveBeenCalledWith('org-1', RESERVATION, 'call-web-1');
      expect(mocks.release).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([400, 401, 403, 404, 422, 429])('releases a hold after definite HTTP %i creation rejection', async (status) => {
    mocks.create.mockRejectedValue(new RetellApiError(status, 'synthetic rejection'));
    const app = await appFixture();
    try {
      const res = await app.inject({ method: 'POST', url: '/agent-config/web-call', payload: { agentTenantId: 'tenant-1' } });
      expect(res.statusCode).toBe(500);
      expect(mocks.release).toHaveBeenCalledWith('org-1', RESERVATION);
      expect(mocks.bind).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([408, 409, 500, 503, 'timeout', 'network', 'invalid-success', 'bind-failure'])(
    'retains the hold for uncertain creation/binding outcome %s', async (failure) => {
      if (typeof failure === 'number') mocks.create.mockRejectedValue(new RetellApiError(failure, 'synthetic failure'));
      else if (failure === 'invalid-success') mocks.create.mockResolvedValue({ access_token: 'synthetic-token' });
      else if (failure === 'bind-failure') mocks.bind.mockRejectedValue(new Error('synthetic DB failure'));
      else mocks.create.mockRejectedValue(new Error(failure));
      const app = await appFixture();
      try {
        const res = await app.inject({ method: 'POST', url: '/agent-config/web-call', payload: { agentTenantId: 'tenant-1' } });
        expect(res.statusCode).toBe(500);
        expect(mocks.release).not.toHaveBeenCalled();
      } finally { await app.close(); }
    },
  );

  it('does not contact the provider when quota reservation is denied', async () => {
    mocks.reserve.mockResolvedValue({ allowed: false, minutesUsed: 30, minutesLimit: 30 });
    const app = await appFixture();
    try {
      const res = await app.inject({ method: 'POST', url: '/agent-config/web-call', payload: { agentTenantId: 'tenant-1' } });
      expect(res.json().error).toBe('USAGE_LIMIT_REACHED');
      expect(mocks.create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
