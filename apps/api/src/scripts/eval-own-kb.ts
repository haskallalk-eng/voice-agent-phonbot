import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pool } from '../db.js';
import { evaluateOwnKbCases, parseOwnKbEvalJsonl, type OwnKbEvalCase } from '../own-kb-eval.js';

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1]?.trim() || null;
  return null;
}

function usage(): void {
  console.log([
    'Usage:',
    '  pnpm --filter @vas/api own-kb:eval -- --org ORG_ID --tenant TENANT_ID --cases cases.jsonl [--name run-name] [--no-store]',
    '  pnpm --filter @vas/api own-kb:eval -- --org ORG_ID --tenant TENANT_ID --smoke [--no-store]',
    '',
    'JSONL case format:',
    '  {"caseId":"pricing_1","query":"Was kostet es?","mustAnswer":true,"minConfidence":0.55}',
  ].join('\n'));
}

async function loadCases(): Promise<OwnKbEvalCase[]> {
  if (process.argv.includes('--smoke')) {
    return [{
      caseId: 'smoke_business_facts',
      query: 'Betrieb Leistungen',
      mustAnswer: true,
      minConfidence: 0.55,
      maxLatencyMs: 2200,
    }];
  }
  const casesPath = argValue('--cases');
  if (!casesPath) throw new Error('--cases is required unless --smoke is set');
  return parseOwnKbEvalJsonl(await readFile(casesPath, 'utf8'));
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  const tenantId = argValue('--tenant') ?? argValue('--tenant-id');
  if (!tenantId) throw new Error('--tenant is required');
  const orgId = argValue('--org') ?? argValue('--org-id');
  if (!orgId) throw new Error('--org is required; Own-KB eval must use explicit server-derived org scope');
  const cases = await loadCases();
  const result = await evaluateOwnKbCases({
    orgId,
    tenantId,
    name: argValue('--name') ?? `own-kb-eval-${new Date().toISOString()}`,
    cases,
    store: !process.argv.includes('--no-store'),
  });
  console.log(JSON.stringify({
    runId: result.runId,
    name: result.name,
    total: result.total,
    passed: result.passed,
    failed: result.failed,
    skipped: result.skipped,
    p95LatencyMs: result.p95LatencyMs,
    failures: result.results
      .filter((item) => item.status === 'failed')
      .map((item) => ({ caseId: item.caseId, reason: item.failureReason, latencyMs: item.latencyMs })),
  }, null, 2));
  if (result.failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end().catch(() => {});
  });
