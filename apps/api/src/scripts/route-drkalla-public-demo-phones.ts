import { pathToFileURL } from 'node:url';
import { listAgents, listPhoneNumbers, updatePhoneNumber, type RetellPhoneNumber } from '../retell.js';

const DRKALLA_AGENT_NAME = 'DrKalla RAG Voice Agent';
const PUBLIC_DEMO_AGENT_NAME = 'Phonbot Public Phone Demo';

function maskPhone(value: string): string {
  return value.replace(/\d(?=\d{3})/g, '*');
}

function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  return `${value.slice(0, 12)}...`;
}

function inboundAgentIds(phone: RetellPhoneNumber): string[] {
  const ids = new Set<string>();
  if (phone.agent_id) ids.add(phone.agent_id);
  for (const agent of phone.inbound_agents ?? []) {
    if (agent.agent_id) ids.add(agent.agent_id);
  }
  return [...ids];
}

function phoneNumberValue(phone: RetellPhoneNumber): string {
  return phone.phone_number;
}

function byPhoneSuffix(phones: RetellPhoneNumber[], suffix: string): RetellPhoneNumber | null {
  const normalized = suffix.replace(/\D/g, '');
  const matches = phones.filter((phone) => phoneNumberValue(phone).replace(/\D/g, '').endsWith(normalized));
  if (matches.length !== 1) {
    throw new Error(`PHONE_SUFFIX_MATCH_COUNT:${suffix}:${matches.length}`);
  }
  return matches[0] ?? null;
}

async function routePhones(execute: boolean): Promise<void> {
  const drkallaSuffix = process.env.DRKALLA_PHONE_SUFFIX?.trim() || '69';
  const agents = await listAgents();
  const phones = await listPhoneNumbers();
  const drkallaAgent = agents.find((agent) => agent.agent_name === DRKALLA_AGENT_NAME);
  const publicDemoAgent = agents.find((agent) => agent.agent_name === PUBLIC_DEMO_AGENT_NAME);
  if (!drkallaAgent) throw new Error(`AGENT_NOT_FOUND:${DRKALLA_AGENT_NAME}`);
  if (!publicDemoAgent) throw new Error(`AGENT_NOT_FOUND:${PUBLIC_DEMO_AGENT_NAME}`);

  const drkallaTargetPhone = byPhoneSuffix(phones, drkallaSuffix);
  if (!drkallaTargetPhone) throw new Error(`PHONE_NOT_FOUND_SUFFIX:${drkallaSuffix}`);

  const currentDrkallaPhones = phones.filter((phone) => inboundAgentIds(phone).includes(drkallaAgent.agent_id));
  const demoTargetPhone = currentDrkallaPhones.find((phone) => phoneNumberValue(phone) !== phoneNumberValue(drkallaTargetPhone))
    ?? byPhoneSuffix(phones, process.env.PUBLIC_DEMO_PHONE_SUFFIX?.trim() || '286');
  if (!demoTargetPhone) throw new Error('PUBLIC_DEMO_TARGET_PHONE_NOT_FOUND');
  if (phoneNumberValue(demoTargetPhone) === phoneNumberValue(drkallaTargetPhone)) {
    throw new Error('REFUSING_TO_ASSIGN_BOTH_AGENTS_TO_SAME_PHONE');
  }

  if (execute) {
    await updatePhoneNumber(phoneNumberValue(drkallaTargetPhone), { inboundAgentId: drkallaAgent.agent_id });
    await updatePhoneNumber(phoneNumberValue(demoTargetPhone), { inboundAgentId: publicDemoAgent.agent_id });
  }

  const after = execute ? await listPhoneNumbers() : phones;
  const drkallaReadback = after.find((phone) => phoneNumberValue(phone) === phoneNumberValue(drkallaTargetPhone));
  const demoReadback = after.find((phone) => phoneNumberValue(phone) === phoneNumberValue(demoTargetPhone));

  console.log(JSON.stringify({
    ok: true,
    dryRun: !execute,
    drkalla: {
      agentName: DRKALLA_AGENT_NAME,
      agentIdMasked: maskId(drkallaAgent.agent_id),
      phoneMasked: maskPhone(phoneNumberValue(drkallaTargetPhone)),
      assignedToAgent: execute ? inboundAgentIds(drkallaReadback!).includes(drkallaAgent.agent_id) : null,
    },
    publicDemo: {
      agentName: PUBLIC_DEMO_AGENT_NAME,
      agentIdMasked: maskId(publicDemoAgent.agent_id),
      phoneMasked: maskPhone(phoneNumberValue(demoTargetPhone)),
      assignedToAgent: execute ? inboundAgentIds(demoReadback!).includes(publicDemoAgent.agent_id) : null,
    },
  }, null, 2));
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  routePhones(process.argv.includes('--execute')).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
