import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/testdb');

const mockQuery = vi.fn(async (_sql: unknown, _params?: unknown[]) => ({ rows: [{ deleted: '0' }], rowCount: 1 }));
const mockOn = vi.fn((_event: unknown, _handler?: unknown) => undefined);

vi.mock('pg', () => ({
  default: {
    Pool: class {
      query = (sql: unknown, params?: unknown[]) => mockQuery(sql, params);
      on = (event: unknown, handler?: unknown) => mockOn(event, handler);
    },
    types: { setTypeParser: vi.fn() },
  },
}));

vi.mock('node:dns/promises', () => ({
  default: {
    resolve4: vi.fn(async () => ['127.0.0.1']),
    resolve6: vi.fn(async () => []),
  },
}));

vi.mock('../logger.js', () => ({ logBg: () => () => {} }));

const { cleanupOldTranscripts } = await import('../db.js');

describe('cleanupOldTranscripts', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue({ rows: [{ deleted: '2' }], rowCount: 1 });
  });

  it('applies retention per Retell agent instead of newest config per org', async () => {
    await expect(cleanupOldTranscripts()).resolves.toBe(2);

    const sql = String((mockQuery.mock.calls as unknown[][])[0]?.[0] ?? '');
    expect(sql).toContain("data->>'retellAgentId'");
    expect(sql).toContain("data->>'retellCallbackAgentId'");
    expect(sql).toContain('DISTINCT ON (org_id, agent_id)');
    expect(sql).toContain('COALESCE(ct.agent_id, rc.agent_id)');
    expect(sql).toContain('LEFT JOIN recording_consents rc ON rc.call_id = ct.call_id');
    expect(sql).toContain('ta.agent_id = r.agent_id');
  });

  it('backfills Retell retention from valid org transcripts using the original call timestamp', () => {
    const source = readFileSync(new URL('../db.ts', import.meta.url), 'utf8');

    expect(source).toContain('INSERT INTO retell_call_retention (call_id, org_id, agent_id, delete_after, created_at)');
    expect(source).toContain('JOIN orgs o ON o.id = ct.org_id');
    expect(source).toContain('ct.created_at + (COALESCE(r.days, 90) * INTERVAL');
    expect(source).toContain('ct.created_at');
  });
});
