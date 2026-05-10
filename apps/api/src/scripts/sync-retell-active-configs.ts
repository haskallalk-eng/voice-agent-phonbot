import dotenv from 'dotenv';

dotenv.config({ path: new URL('../../.env', import.meta.url) });

if (!process.env.RETELL_TOOL_AUTH_SECRET && !process.env.JWT_SECRET) {
  throw new Error('RETELL_TOOL_AUTH_SECRET or JWT_SECRET is required to sync signed Retell tool URLs');
}

// This is a one-off maintenance runner, not the API server. Some unrelated
// modules imported by agent-config enforce production startup guards (Stripe
// live/test key checks). Keep the runner in tooling mode while still requiring
// the Retell signing secret above.
process.env.NODE_ENV = 'development';

type AgentConfigRow = {
  tenant_id: string;
  org_id: string | null;
  data: Record<string, unknown>;
};

const execute = process.argv.includes('--execute');
if (execute && !process.env.WEBHOOK_BASE_URL) {
  throw new Error('WEBHOOK_BASE_URL is required when executing Retell sync; refusing to publish placeholder tool URLs.');
}

const { pool } = await import('../db.js');
const { deployToRetell } = await import('../agent-config.js');

if (!pool) throw new Error('DATABASE_URL is required');

const { rows } = await pool.query<AgentConfigRow>(
  `SELECT tenant_id, org_id, data
   FROM agent_configs
   WHERE data->>'retellAgentId' IS NOT NULL
     AND data->>'retellLlmId' IS NOT NULL
   ORDER BY updated_at DESC`,
);

console.log(`${execute ? '[execute]' : '[dry-run]'} syncing ${rows.length} active Retell config(s)`);

for (const row of rows) {
  const config = {
    ...row.data,
    tenantId: row.tenant_id,
  } as Parameters<typeof deployToRetell>[0];

  const agentId = typeof row.data.retellAgentId === 'string' ? row.data.retellAgentId : null;
  const llmId = typeof row.data.retellLlmId === 'string' ? row.data.retellLlmId : null;
  console.log(`${row.tenant_id}: agent=${agentId ?? '-'} llm=${llmId ?? '-'}`);

  if (!execute) continue;

  const deployed = await deployToRetell(config, row.org_id ?? undefined);
  const changed =
    deployed.retellAgentId !== row.data.retellAgentId ||
    deployed.retellLlmId !== row.data.retellLlmId ||
    deployed.retellCallbackAgentId !== row.data.retellCallbackAgentId ||
    deployed.retellCallbackLlmId !== row.data.retellCallbackLlmId;

  if (changed) {
    await pool.query(
      `UPDATE agent_configs
       SET data = $2::jsonb,
           updated_at = now()
       WHERE tenant_id = $1`,
      [row.tenant_id, JSON.stringify(deployed)],
    );
    console.log(`${row.tenant_id}: persisted changed Retell IDs`);
  }
}

await pool.end();
console.log('done');
