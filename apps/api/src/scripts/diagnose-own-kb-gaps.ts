import 'dotenv/config';
import { pool } from '../db.js';
import { diagnoseOwnKbShadowGaps } from '../own-kb-gaps.js';

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
    '  pnpm --filter @vas/api own-kb:gaps -- --org ORG_ID --tenant TENANT_ID [--run RUN_ID]',
    '',
    'Prints a non-sensitive coverage diagnosis for the latest or selected own-KB shadow run.',
  ].join('\n'));
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  const tenantId = argValue('--tenant') ?? argValue('--tenant-id');
  if (!tenantId) throw new Error('--tenant is required');
  const orgId = argValue('--org') ?? argValue('--org-id');
  if (!orgId) throw new Error('--org is required; Own-KB gap diagnosis must use explicit server-derived org scope');
  const report = await diagnoseOwnKbShadowGaps({
    orgId,
    tenantId,
    runId: argValue('--run') ?? argValue('--run-id'),
  });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end().catch(() => {});
  });
