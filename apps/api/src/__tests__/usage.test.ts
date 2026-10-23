import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { mockQuery, mockConnect, mockRelease, database } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockRelease = vi.fn();
  const mockConnect = vi.fn(async () => ({ query: mockQuery, release: mockRelease }));
  return { mockQuery, mockConnect, mockRelease, database: { pool: { query: mockQuery, connect: mockConnect } as { query: typeof mockQuery; connect: typeof mockConnect } | null } };
});
vi.mock('../db.js', () => ({ get pool() { return database.pool; } }));
vi.mock('../billing.js', () => ({ PLANS: {
  starter: { id: 'starter', overchargePerMinute: 0.05 }, free: { id: 'free', overchargePerMinute: 0 },
} }));
vi.mock('../redis.js', () => ({ redis: null }));
const { tryReserveMinutes, reconcileMinutes, checkUsageLimit } = await import('../usage.js');
const org = { id: 'org-1', minutes_used: 0, minutes_reserved: 0, minutes_limit: 5, plan: 'free', plan_status: 'active', name: 'Synthetic' };
beforeEach(() => {
  mockQuery.mockReset(); mockConnect.mockClear(); mockRelease.mockClear();
  database.pool = { query: mockQuery, connect: mockConnect };
  vi.stubEnv('NODE_ENV', 'production');
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT id, minutes_used')) return { rows: [org], rowCount: 1 };
    if (sql.startsWith('SELECT activated_at')) return { rows: [{ activated_at: new Date(0) }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('usage database boundary', () => {
  it.each(['production', 'development'])('fails closed with a null pool in %s', async (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    database.pool = null;
    const denied = { allowed: false, minutesUsed: 0, minutesLimit: 0 };
    expect(await tryReserveMinutes('org-1')).toEqual(denied);
    expect(await checkUsageLimit('org-1')).toEqual(denied);
    await expect(reconcileMinutes('org-1', 5, { callId: 'call-1' })).rejects.toThrow('USAGE_DATABASE_UNAVAILABLE');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });
  it('propagates connection failure instead of authorizing usage', async () => {
    mockConnect.mockRejectedValueOnce(new Error('test database unavailable'));
    await expect(tryReserveMinutes('org-1')).rejects.toThrow('test database unavailable');
  });
  it('rolls back and releases its connection after a failed reservation insert', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id, minutes_used')) return { rows: [org], rowCount: 1 };
      if (sql.startsWith('SELECT activated_at')) return { rows: [{ activated_at: new Date(0) }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO usage_reservations')) throw new Error('test write failure');
      return { rows: [], rowCount: 0 };
    });
    await expect(tryReserveMinutes('org-1')).rejects.toThrow('test write failure');
    expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockQuery).not.toHaveBeenCalledWith('COMMIT');
    expect(mockRelease).toHaveBeenCalledOnce();
  });
  it('uses the default five-minute capacity hold and returns its reservation ID', async () => {
    const result = await tryReserveMinutes('org-1');
    expect(result).toMatchObject({ allowed: true, minutesUsed: 5, minutesLimit: 5 });
    expect(result.reservationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockQuery).toHaveBeenCalledWith('UPDATE orgs SET minutes_reserved = minutes_reserved + $2 WHERE id = $1', ['org-1', 5]);
    expect(mockRelease).toHaveBeenCalledOnce();
  });
  it.each([-1, 0, NaN, Infinity])('rejects invalid reservation amount %s before querying', async (minutes) => {
    await expect(tryReserveMinutes('org-1', minutes)).rejects.toThrow('USAGE_MINUTES_INVALID');
    expect(mockConnect).not.toHaveBeenCalled();
  });
  it.each([-1, NaN, Infinity])('rejects invalid actual usage %s before querying', async (minutes) => {
    await expect(reconcileMinutes('org-1', minutes, { callId: 'call-1' })).rejects.toThrow('USAGE_MINUTES_INVALID');
    expect(mockConnect).not.toHaveBeenCalled();
  });
  it('requires a stable call identity for settlement', async () => {
    await expect(reconcileMinutes('org-1', 5, { callId: '' })).rejects.toThrow('USAGE_CALL_ID_REQUIRED');
    expect(mockConnect).not.toHaveBeenCalled();
  });
  it('rejects malformed reservation metadata before touching the database', async () => {
    await expect(reconcileMinutes('org-1', 5, { callId: 'call-1', reservationId: 'not-a-uuid' })).rejects.toThrow('USAGE_RESERVATION_INVALID');
    expect(mockConnect).not.toHaveBeenCalled();
  });
  it('propagates a UI query error without allowing a call', async () => {
    mockQuery.mockRejectedValueOnce(new Error('test query failure'));
    await expect(checkUsageLimit('org-1')).rejects.toThrow('test query failure');
  });
  it('includes outstanding holds in the read-only capacity hint', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...org, minutes_used: 1, minutes_reserved: 4 }], rowCount: 1 });
    expect(await checkUsageLimit('org-1')).toEqual({ allowed: false, minutesUsed: 5, minutesLimit: 5 });
  });
});
