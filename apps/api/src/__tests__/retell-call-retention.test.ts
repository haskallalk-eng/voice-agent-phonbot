import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn(async (_sql: unknown, _params?: unknown[]) => ({ rowCount: 1, rows: [] as unknown[] }));
const mockDeleteCall = vi.fn(async (_callId: unknown) => {});

vi.mock('../db.js', () => ({
  pool: { query: (sql: unknown, params?: unknown[]) => mockQuery(sql, params) },
}));

vi.mock('../retell.js', () => ({
  deleteCall: (callId: unknown) => mockDeleteCall(callId),
}));

const { trackRetellCallRetention, cleanupRetellStoredCalls, shortenRetellRetentionForAgentConfig } = await import('../retell-retention.js');

describe('Retell call retention tracking', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    mockDeleteCall.mockReset();
    mockDeleteCall.mockResolvedValue(undefined);
  });

  it('records a Retell deletion deadline for positive retention windows', async () => {
    await trackRetellCallRetention({
      orgId: '11111111-1111-1111-1111-111111111111',
      callId: 'call-1',
      agentId: 'agent-1',
      retentionDays: 7,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO retell_call_retention'),
      expect.arrayContaining(['call-1', '11111111-1111-1111-1111-111111111111', 'agent-1']),
    );
  });

  it('deletes due Retell calls before marking them deleted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ call_id: 'call-a' }, { call_id: 'call-b' }] })
      .mockResolvedValue({ rowCount: 1, rows: [] });

    await expect(cleanupRetellStoredCalls()).resolves.toEqual({ deleted: 2, failed: 0 });

    expect(mockDeleteCall).toHaveBeenCalledWith('call-a');
    expect(mockDeleteCall).toHaveBeenCalledWith('call-b');
    expect(mockQuery.mock.calls.filter((call) => String(call[0]).includes('retell_deleted_at = now()'))).toHaveLength(2);
  });

  it('shortens existing Retell deadlines when retention is lowered', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 3, rows: [] });

    await expect(shortenRetellRetentionForAgentConfig({
      orgId: '11111111-1111-1111-1111-111111111111',
      agentIds: ['agent-1', 'agent-callback'],
      recordCalls: false,
      retentionDays: 30,
    })).resolves.toBe(3);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE retell_call_retention'),
      ['11111111-1111-1111-1111-111111111111', ['agent-1', 'agent-callback'], 0],
    );
  });

  it('treats already-deleted Retell calls as successfully deleted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ call_id: 'gone-call' }] })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    mockDeleteCall.mockRejectedValueOnce(new Error('Retell delete-call 404: not found'));

    await expect(cleanupRetellStoredCalls()).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('retell_deleted_at = now()'))).toBe(true);
  });

  it('keeps failed deletions queued with the error captured', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ call_id: 'call-fail' }] })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    mockDeleteCall.mockRejectedValueOnce(new Error('Retell timeout'));

    await expect(cleanupRetellStoredCalls()).resolves.toEqual({ deleted: 0, failed: 1 });
    expect(mockQuery.mock.calls.some((call) => String(call[0]).includes('delete_error = $2'))).toBe(true);
  });
});
