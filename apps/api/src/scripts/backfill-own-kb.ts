import 'dotenv/config';
import { pool } from '../db.js';
import { backfillOwnKnowledgeBaseFromAgentConfig, type OwnKbBackfillResult } from '../own-kb.js';

type AgentConfigRow = {
  tenant_id: string;
  org_id: string;
  data: Record<string, unknown>;
};

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1]?.trim() || null;
  return null;
}

function intArg(name: string, fallback: number): number {
  const raw = argValue(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.trunc(parsed))) : fallback;
}

function usage(): void {
  console.log([
    'Usage:',
    '  pnpm --filter @vas/api own-kb:backfill -- [--tenant TENANT_ID] [--limit 25] [--execute] [--allow-fts-only]',
    '',
    'Defaults to dry-run. --execute writes sources, versions, chunks, and embeddings.',
    '--allow-fts-only permits execute without embeddings when OPENAI_API_KEY is unavailable.',
  ].join('\n'));
}

function summarize(results: OwnKbBackfillResult[]): Record<string, unknown> {
  return {
    agents: results.length,
    prepared: results.reduce((sum, result) => sum + result.prepared, 0),
    indexed: results.reduce((sum, result) => sum + result.indexed, 0),
    rejected: results.reduce((sum, result) => sum + result.rejected, 0),
    failed: results.reduce((sum, result) => sum + result.failed, 0),
    chunks: results.reduce((sum, result) => sum + result.chunks, 0),
    embeddings: results.reduce((sum, result) => sum + result.embeddings, 0),
    rejectionReasons: results
      .flatMap((result) => result.results)
      .filter((result) => result.rejectionReason)
      .reduce<Record<string, number>>((acc, result) => {
        const key = result.rejectionReason ?? 'UNKNOWN';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  if (!pool) throw new Error('DATABASE_URL is required');

  const execute = process.argv.includes('--execute');
  const tenantId = argValue('--tenant') ?? argValue('--tenant-id');
  const limit = intArg('--limit', 25);
  const allowFtsOnly = process.argv.includes('--allow-fts-only');

  const params: unknown[] = [];
  const where = ['org_id is not null'];
  if (tenantId) {
    params.push(tenantId);
    where.push(`tenant_id = $${params.length}`);
  }
  params.push(limit);

  const rows = await pool.query<AgentConfigRow>(`
    select tenant_id, org_id::text as org_id, data
    from agent_configs
    where ${where.join(' and ')}
    order by updated_at desc
    limit $${params.length}
  `, params);

  const results: OwnKbBackfillResult[] = [];
  for (const row of rows.rows) {
    const config: Record<string, unknown> = { ...(row.data ?? {}), tenantId: row.tenant_id };
    results.push(await backfillOwnKnowledgeBaseFromAgentConfig({
      orgId: row.org_id,
      tenantId: row.tenant_id,
      agentTenantId: row.tenant_id,
      agentId: typeof config.retellAgentId === 'string' ? config.retellAgentId : null,
      config,
      dryRun: !execute,
      requireEmbeddings: execute ? !allowFtsOnly : false,
    }));
  }

  console.log(JSON.stringify({
    dryRun: !execute,
    execute,
    requireEmbeddings: execute ? !allowFtsOnly : false,
    tenantId: tenantId ?? null,
    limit,
    ...summarize(results),
    results: results.map((result) => ({
      tenantId: result.tenantId,
      prepared: result.prepared,
      indexed: result.indexed,
      rejected: result.rejected,
      failed: result.failed,
      chunks: result.chunks,
      embeddings: result.embeddings,
      rejectionReasons: result.results
        .filter((item) => item.rejectionReason)
        .map((item) => ({ sourceName: item.sourceName, reason: item.rejectionReason })),
    })),
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end().catch(() => {});
  });
