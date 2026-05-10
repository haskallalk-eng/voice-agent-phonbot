import { pool } from './db.js';
import { deleteCall } from './retell.js';

function clampRetentionDays(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(365, Math.max(0, Math.trunc(value)));
}

export async function trackRetellCallRetention(params: {
  orgId: string;
  callId: string;
  agentId?: string | null;
  retentionDays: number;
}): Promise<void> {
  if (!pool) return;
  const days = clampRetentionDays(params.retentionDays);
  const deleteAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO retell_call_retention (call_id, org_id, agent_id, delete_after, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (call_id) DO UPDATE SET
       org_id = EXCLUDED.org_id,
       agent_id = COALESCE(EXCLUDED.agent_id, retell_call_retention.agent_id),
       delete_after = EXCLUDED.delete_after,
       updated_at = now()`,
    [params.callId, params.orgId, params.agentId ?? null, deleteAfter.toISOString()],
  );
}

export async function shortenRetellRetentionForAgentConfig(params: {
  orgId: string;
  agentIds: string[];
  recordCalls?: boolean;
  retentionDays: number;
}): Promise<number> {
  if (!pool || params.agentIds.length === 0) return 0;
  const days = params.recordCalls === false ? 0 : clampRetentionDays(params.retentionDays);
  const res = await pool.query(
    `UPDATE retell_call_retention
        SET delete_after = LEAST(delete_after, created_at + ($3 * INTERVAL '1 day')),
            updated_at = now()
      WHERE org_id = $1
        AND agent_id = ANY($2::text[])
        AND retell_deleted_at IS NULL
        AND delete_after > created_at + ($3 * INTERVAL '1 day')`,
    [params.orgId, params.agentIds, days],
  );
  return (res as { rowCount?: number }).rowCount ?? 0;
}

export async function cleanupRetellStoredCalls(limit = 500): Promise<{ deleted: number; failed: number }> {
  if (!pool) return { deleted: 0, failed: 0 };
  const due = await pool.query<{ call_id: string }>(
    `SELECT call_id
       FROM retell_call_retention
      WHERE retell_deleted_at IS NULL
        AND delete_after <= now()
      ORDER BY delete_after ASC
      LIMIT $1`,
    [limit],
  );

  let deleted = 0;
  let failed = 0;
  for (const row of due.rows) {
    try {
      await deleteCall(row.call_id);
      await pool.query(
        `UPDATE retell_call_retention
            SET retell_deleted_at = now(),
                delete_error = NULL,
                attempts = attempts + 1,
                updated_at = now()
          WHERE call_id = $1`,
        [row.call_id],
      );
      deleted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/\b404\b/.test(message)) {
        await pool.query(
          `UPDATE retell_call_retention
              SET retell_deleted_at = now(),
                  delete_error = NULL,
                  attempts = attempts + 1,
                  updated_at = now()
            WHERE call_id = $1`,
          [row.call_id],
        );
        deleted += 1;
        continue;
      }
      failed += 1;
      await pool.query(
        `UPDATE retell_call_retention
            SET delete_error = $2,
                attempts = attempts + 1,
                updated_at = now()
          WHERE call_id = $1`,
        [row.call_id, message],
      ).catch(() => {});
    }
  }

  return { deleted, failed };
}
