import 'dotenv/config';
import { pool } from '../db.js';
import { checkOwnKbDatabaseReadiness } from '../own-kb-readiness.js';

async function main(): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required');
  const report = await checkOwnKbDatabaseReadiness(pool);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end().catch(() => {});
  });
