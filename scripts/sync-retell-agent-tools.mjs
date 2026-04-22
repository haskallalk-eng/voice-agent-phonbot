#!/usr/bin/env node
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: new URL('../apps/api/.env', import.meta.url) });

const RETELL_API = 'https://api.retellai.com';
const CORE_AGENT_TOOLS = ['calendar.findSlots', 'calendar.book', 'ticket.create'];
const dryRun = process.argv.includes('--dry-run');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function toolAuthSecret() {
  return process.env.RETELL_TOOL_AUTH_SECRET || process.env.JWT_SECRET || 'dev-retell-tool-auth';
}

function signToolTenant(tenantId) {
  return crypto.createHmac('sha256', toolAuthSecret()).update(tenantId).digest('base64url');
}

function toolUrl(path, tenantId) {
  const webhookBase = requiredEnv('WEBHOOK_BASE_URL').replace(/\/$/, '');
  const params = new URLSearchParams({
    tenant_id: tenantId,
    tool_sig: signToolTenant(tenantId),
  });
  return `${webhookBase}${path}?${params.toString()}`;
}

function withCoreTools(tools) {
  return [...new Set([...CORE_AGENT_TOOLS, ...(Array.isArray(tools) ? tools : [])])];
}

function retellTools(tenantId) {
  return [
    {
      type: 'custom',
      name: 'calendar_find_slots',
      description: 'Find available appointment slots for the requested service or time range.',
      url: toolUrl('/retell/tools/calendar.findSlots', tenantId),
      execution_message_description: 'Searching for available slots...',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Requested service, if known.' },
          range: { type: 'string', description: 'Requested date range, e.g. next week.' },
          preferredTime: { type: 'string', description: 'Preferred time or day from the customer.' },
        },
      },
    },
    {
      type: 'custom',
      name: 'calendar_book',
      description: 'Create a booking after the user confirmed a slot and service.',
      url: toolUrl('/retell/tools/calendar.book', tenantId),
      execution_message_description: 'Booking your appointment...',
      parameters: {
        type: 'object',
        required: ['preferredTime', 'service'],
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string', description: 'Caller phone number. Optional when Retell provides from_number.' },
          preferredTime: { type: 'string', description: 'Confirmed slot/time.' },
          service: { type: 'string', description: 'Booked service.' },
          notes: { type: 'string' },
        },
      },
    },
    {
      type: 'custom',
      name: 'ticket_create',
      description: 'Create a callback or handoff ticket when the user wants human follow-up.',
      url: toolUrl('/retell/tools/ticket.create', tenantId),
      execution_message_description: 'Creating your callback request...',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          customerPhone: { type: 'string', description: 'Callback phone number. Optional when Retell provides from_number.' },
          preferredTime: { type: 'string' },
          service: { type: 'string' },
          notes: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  ];
}

async function retellPatch(llmId, tools) {
  const res = await fetch(`${RETELL_API}/update-retell-llm/${encodeURIComponent(llmId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${requiredEnv('RETELL_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ general_tools: tools }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Retell ${res.status}: ${await res.text()}`);
}

const pool = new pg.Pool({ connectionString: requiredEnv('DATABASE_URL') });

try {
  const { rows } = await pool.query(
    `SELECT tenant_id, data
     FROM agent_configs
     WHERE data->>'retellLlmId' IS NOT NULL
        OR data->>'retellCallbackLlmId' IS NOT NULL
     ORDER BY updated_at DESC`,
  );

  console.log(`${dryRun ? '[dry-run] ' : ''}syncing ${rows.length} agent config(s)`);

  for (const row of rows) {
    const tenantId = row.tenant_id;
    const data = row.data ?? {};
    const tools = retellTools(tenantId);
    const toolNames = withCoreTools(data.tools);
    const llmIds = [...new Set([data.retellLlmId, data.retellCallbackLlmId].filter(Boolean))];

    console.log(`${tenantId}: ${llmIds.length} Retell LLM(s), tools=${toolNames.join(',')}`);

    if (!dryRun) {
      await pool.query(
        `UPDATE agent_configs
         SET data = jsonb_set(data, '{tools}', $2::jsonb, true),
             updated_at = now()
         WHERE tenant_id = $1`,
        [tenantId, JSON.stringify(toolNames)],
      );

      for (const llmId of llmIds) {
        await retellPatch(llmId, tools);
      }
    }
  }

  console.log('done');
} finally {
  await pool.end();
}
