import 'dotenv/config';
import { pool } from '../db.js';
import { runOwnKbShadowFromTranscripts } from '../own-kb-shadow.js';

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1]?.trim() || null;
  return null;
}

function intArg(name: string, fallback: number, min: number, max: number): number {
  const raw = argValue(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function usage(): void {
  console.log([
    'Usage:',
    '  pnpm --filter @vas/api own-kb:shadow -- --org ORG_ID --tenant TENANT_ID [--agent AGENT_ID] [--limit 25] [--since-hours 168] [--name run-name] [--no-store]',
    '',
    'Reads call_transcripts, extracts redacted customer questions, runs own knowledge.search in shadow mode, and stores only redacted results.',
  ].join('\n'));
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  if (!pool) throw new Error('DATABASE_URL is required');

  const tenantId = argValue('--tenant') ?? argValue('--tenant-id');
  if (!tenantId) throw new Error('--tenant is required');
  const agentId = argValue('--agent') ?? argValue('--agent-id');
  const orgId = argValue('--org') ?? argValue('--org-id');
  if (!orgId) throw new Error('--org is required; Own-KB shadow must use explicit server-derived org scope');
  const limit = intArg('--limit', 25, 1, 200);
  const sinceHours = intArg('--since-hours', 168, 1, 24 * 365);
  const name = argValue('--name') ?? `own-kb-shadow-${new Date().toISOString()}`;
  const result = await runOwnKbShadowFromTranscripts({
    orgId,
    tenantId,
    agentId,
    name,
    limit,
    sinceHours,
    store: !process.argv.includes('--no-store'),
  });

  console.log(JSON.stringify({
    runId: result.runId,
    name: result.name,
    total: result.total,
    answerable: result.answerable,
    notAnswerable: result.notAnswerable,
    errors: result.errors,
    skipped: result.skipped,
    p95LatencyMs: result.p95LatencyMs,
    sample: result.results.slice(0, 10).map((item) => ({
      callId: item.callId,
      agentId: item.agentId,
      turnIndex: item.turnIndex,
      status: item.status,
      confidence: item.confidence,
      latencyMs: item.latencyMs,
      reason: item.failureReason,
    })),
  }, null, 2));

  if (result.errors > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end().catch(() => {});
  });
