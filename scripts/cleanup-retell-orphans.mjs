#!/usr/bin/env node
import { createRequire } from 'node:module';

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const dotenv = requireFromApi('dotenv');
const pg = requireFromApi('pg');

dotenv.config({ path: new URL('../apps/api/.env', import.meta.url) });

const RETELL_API = 'https://api.retellai.com';
const execute = process.argv.includes('--execute');
const includeUnreferenced = process.argv.includes('--include-unreferenced');
const deleteCurrentDemos = process.argv.includes('--delete-current-demos');
const cleanPhoneOnly = process.argv.includes('--clean-phone-only');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function llmIdOf(agent) {
  return agent?.response_engine?.llm_id ?? agent?.llm_id ?? null;
}

function phoneNumberOf(phone) {
  return phone?.phone_number ?? phone?.number ?? phone?.phone_number_pretty ?? null;
}

async function retell(path, init = {}) {
  const res = await fetch(`${RETELL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requiredEnv('RETELL_API_KEY')}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`Retell ${res.status} ${path}: ${await res.text()}`);
  }
  if (res.status === 204 || res.status === 404) return null;
  return res.json();
}

function rowsOrEmpty(promise) {
  return promise.then((res) => res.rows).catch(() => []);
}

const pool = new pg.Pool({ connectionString: requiredEnv('DATABASE_URL') });

try {
  const [configRows, demoRows, localPhoneRows, agentsRaw, retellPhoneRaw] = await Promise.all([
    rowsOrEmpty(pool.query(
      `SELECT tenant_id, org_id,
              data->>'retellAgentId' AS agent_id,
              data->>'retellCallbackAgentId' AS callback_agent_id,
              data->>'retellLlmId' AS llm_id,
              data->>'retellCallbackLlmId' AS callback_llm_id
       FROM agent_configs`,
    )),
    rowsOrEmpty(pool.query(
      `SELECT agent_id, template_id, created_at
       FROM demo_agent_templates
       ORDER BY created_at DESC`,
    )),
    rowsOrEmpty(pool.query(
      `SELECT number, agent_id
       FROM phone_numbers
       WHERE agent_id IS NOT NULL`,
    )),
    retell('/list-agents'),
    retell('/list-phone-numbers'),
  ]);

  const agents = Array.isArray(agentsRaw) ? agentsRaw : (agentsRaw?.agents ?? agentsRaw?.value ?? []);
  const retellPhones = Array.isArray(retellPhoneRaw)
    ? retellPhoneRaw
    : (retellPhoneRaw?.phone_numbers ?? retellPhoneRaw?.value ?? []);

  const protectedAgentIds = new Set();
  const protectedLlmIds = new Set();
  const retellPhoneAssignments = new Map();
  const outboundNumber = process.env.RETELL_OUTBOUND_NUMBER;

  function rememberPhoneAssignment(agentId, phone, field) {
    if (!agentId) return;
    const number = phoneNumberOf(phone);
    if (!number) return;
    const list = retellPhoneAssignments.get(agentId) ?? [];
    list.push({ number, field });
    retellPhoneAssignments.set(agentId, list);
  }

  for (const row of configRows) {
    for (const id of [row.agent_id, row.callback_agent_id]) if (id) protectedAgentIds.add(id);
    for (const id of [row.llm_id, row.callback_llm_id]) if (id) protectedLlmIds.add(id);
  }
  for (const row of localPhoneRows) if (row.agent_id) protectedAgentIds.add(row.agent_id);

  for (const phone of retellPhones) {
    for (const field of ['agent_id', 'inbound_agent_id', 'outbound_agent_id']) {
      if (!phone[field]) continue;
      rememberPhoneAssignment(phone[field], phone, field);
      const isCurrentSalesOutbound =
        field === 'outbound_agent_id' &&
        outboundNumber &&
        [phone.phone_number, phone.phone_number_pretty, phone.number].includes(outboundNumber);
      if (!cleanPhoneOnly || isCurrentSalesOutbound) protectedAgentIds.add(phone[field]);
    }
  }

  const latestDemoByTemplate = new Map();
  for (const row of demoRows) {
    if (row.template_id && row.agent_id && !latestDemoByTemplate.has(row.template_id)) {
      latestDemoByTemplate.set(row.template_id, row.agent_id);
    }
  }
  if (!deleteCurrentDemos) {
    for (const id of latestDemoByTemplate.values()) protectedAgentIds.add(id);
  }

  for (const agent of agents) {
    if (protectedAgentIds.has(agent.agent_id)) {
      const llmId = llmIdOf(agent);
      if (llmId) protectedLlmIds.add(llmId);
    }
  }

  const demoMetaIds = new Set(demoRows.map((row) => row.agent_id).filter(Boolean));
  const candidates = [];
  const skipped = [];
  for (const agent of agents) {
    if (protectedAgentIds.has(agent.agent_id)) {
      skipped.push({ agent, reason: 'protected' });
      continue;
    }
    const name = String(agent.agent_name ?? '');
    let reason = null;
    if (retellPhoneAssignments.has(agent.agent_id)) reason = 'phone_only_unreferenced';
    else if (demoMetaIds.has(agent.agent_id)) reason = 'old_demo_meta';
    else if (name.startsWith('Demo:')) reason = 'demo_no_meta';
    else if (name === 'Phonbot Sales Callback') reason = 'old_sales_callback';
    else if (includeUnreferenced) reason = 'unreferenced';

    if (reason) candidates.push({ agent, reason });
    else skipped.push({ agent, reason: 'unreferenced_not_included' });
  }

  const candidateLlmIds = new Set();
  for (const { agent } of candidates) {
    const llmId = llmIdOf(agent);
    if (llmId && !protectedLlmIds.has(llmId)) candidateLlmIds.add(llmId);
  }

  const groups = {};
  for (const item of candidates) groups[item.reason] = (groups[item.reason] ?? 0) + 1;
  const skippedGroups = {};
  for (const item of skipped) skippedGroups[item.reason] = (skippedGroups[item.reason] ?? 0) + 1;

  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'dry-run',
    includeUnreferenced,
    deleteCurrentDemos,
    cleanPhoneOnly,
    retellAgents: agents.length,
    protectedAgents: protectedAgentIds.size,
    candidates: candidates.length,
    candidateLlms: candidateLlmIds.size,
    groups,
    skippedGroups,
    sample: candidates.slice(0, 30).map(({ agent, reason }) => ({
      reason,
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      llm_id: llmIdOf(agent),
    })),
  }, null, 2));

  if (!execute) {
    console.log('\nDry-run only. Re-run with --execute to delete the candidates.');
  } else {
    const deletedAgentIds = [];
    const errors = [];
    for (const { agent, reason } of candidates) {
      try {
        for (const assignment of retellPhoneAssignments.get(agent.agent_id) ?? []) {
          await retell(`/update-phone-number/${encodeURIComponent(assignment.number)}`, {
            method: 'PATCH',
            body: JSON.stringify({ [assignment.field]: null }),
          });
          console.log(`unassigned ${assignment.field} on ${assignment.number} from ${agent.agent_id}`);
        }
        await retell(`/delete-agent/${encodeURIComponent(agent.agent_id)}`, { method: 'DELETE' });
        deletedAgentIds.push(agent.agent_id);
        console.log(`deleted agent ${agent.agent_id} (${reason}) ${agent.agent_name ?? ''}`);
      } catch (err) {
        errors.push({ type: 'agent', id: agent.agent_id, error: err.message });
        console.error(`failed agent ${agent.agent_id}: ${err.message}`);
      }
    }

    const deletedLlmIds = [];
    for (const llmId of candidateLlmIds) {
      try {
        await retell(`/delete-retell-llm/${encodeURIComponent(llmId)}`, { method: 'DELETE' });
        deletedLlmIds.push(llmId);
        console.log(`deleted llm ${llmId}`);
      } catch (err) {
        errors.push({ type: 'llm', id: llmId, error: err.message });
        console.error(`failed llm ${llmId}: ${err.message}`);
      }
    }

    if (deletedAgentIds.length) {
      await pool.query(
        `DELETE FROM demo_agent_templates WHERE agent_id = ANY($1::text[])`,
        [deletedAgentIds],
      ).catch((err) => {
        errors.push({ type: 'db_demo_meta', id: 'demo_agent_templates', error: err.message });
      });
    }

    console.log(JSON.stringify({
      deletedAgents: deletedAgentIds.length,
      deletedLlms: deletedLlmIds.length,
      errors,
    }, null, 2));
  }
} finally {
  await pool.end();
}
