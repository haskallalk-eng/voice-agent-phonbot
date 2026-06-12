import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_STANDARD_VOICE_ID,
  createAgent,
  createKnowledgeBase,
  createLLM,
  createWebCall,
  getDefaultRetellLlmHighPriority,
  getDefaultRetellLlmModel,
  getLLM,
  listAgents,
  listKnowledgeBases,
  listPhoneNumbers,
  updateAgent,
  updateLLM,
  updatePhoneNumber,
  waitForKnowledgeBaseComplete,
  type RetellKnowledgeBase,
  type RetellDenoisingMode,
  type RetellTool,
} from '../retell.js';
import {
  DRKALLA_RAG_AGENT_NAME,
  DRKALLA_RAG_BEGIN_MESSAGE,
  DRKALLA_RAG_KB_CONFIG,
  DRKALLA_RAG_KB_NAME_PREFIX,
  DRKALLA_RAG_KB_SCHEMA_VERSION,
  DRKALLA_RAG_PROMPT,
  DRKALLA_PROFI_ACCESS_URL,
  buildDrkallaKnowledgeTexts,
  drkallaSnapshotHash,
  type DrkallaKnowledgeSnapshot,
} from '../drkalla-rag-agent.js';
import { DRKALLA_LINK_TOOL_NAME, DRKALLA_LINK_TOOL_PATH, drkallaLinkToolSignature } from '../drkalla-link-tool.js';

const DEFAULT_SNAPSHOT_PATH = path.resolve(process.cwd(), 'tmp/drkalla-rag/drkalla-products.json');
export const DRKALLA_RAG_RESPONSIVENESS = 0.87;
export const DRKALLA_RAG_INTERRUPTION_SENSITIVITY = 0.77;
export const DRKALLA_RAG_DENOISING_MODE: RetellDenoisingMode = 'no-denoise';
export const DRKALLA_RAG_VOICE_SPEED = 1.03;
export const DRKALLA_RAG_REMINDER_TRIGGER_MS = 6500;
export const DRKALLA_RAG_REMINDER_MAX_COUNT = 2;
export const DRKALLA_RAG_END_CALL_DESCRIPTION = [
  'DrKalla only. Call only for clear final caller intent.',
  'Allowed only: tschüss, danke tschüss, auf Wiederhören, leg auf, or beende den Anruf.',
  'Say short goodbye, then call tool.',
  'Never call for alles klar, sehr schoen, hast du schon gesagt, ok, acknowledgements, questions, corrections, requests, or while caller may still speak.',
  'Never call after inaudible speech, noise, or unclear speech.',
  'Never call while collecting product, category, order, contact, variant, size, strength, price, or availability.',
  'If unsure, clarify instead of ending.',
].join(' ');

function webhookBaseUrl(): string {
  const base = process.env.WEBHOOK_BASE_URL?.trim()
    || process.env.PUBLIC_BASE_URL?.trim()
    || 'https://phonbot.de';
  return base.replace(/\/+$/, '');
}

export function drkallaRagTools(webhookBase?: string): RetellTool[] {
  const tools: RetellTool[] = [
    {
      type: 'end_call',
      name: 'end_call',
      description: DRKALLA_RAG_END_CALL_DESCRIPTION,
    },
  ];
  if (webhookBase) {
    tools.push({
      type: 'custom',
      name: DRKALLA_LINK_TOOL_NAME,
      description:
        `Send exactly one Dr.Kalla shop, product, category, contact, or Profi link by SMS. Profi-Zugang/Profi-Preise => use Profi linkKind=profi and ${DRKALLA_PROFI_ACCESS_URL}, not contact. Contact questions => contact linkKind=contact, not Profi. Never read URLs aloud; send them through this tool. Only call after the caller explicitly asks for a link or SMS, or after they clearly answer yes to "Soll ich dir den Link per SMS schicken?". Never call for "nenn mir", "sag mir", inaudible speech, or vague agreement. Use only drkalla.com URLs. Never claim the link was sent unless the tool result says smsSent=true.`,
      url: `${webhookBase.replace(/\/+$/, '')}${DRKALLA_LINK_TOOL_PATH}?drkalla_sig=${drkallaLinkToolSignature()}`,
      execution_message_description: 'Sende den Dr.Kalla Link per SMS.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full https://drkalla.com link from the KB or official Dr.Kalla contact/shop page.',
          },
          label: {
            type: 'string',
            description: 'Short spoken product, category, shop, or contact label.',
          },
          linkKind: {
            type: 'string',
            enum: ['shop', 'product', 'category', 'contact', 'profi'],
          },
        },
        required: ['url', 'label'],
        additionalProperties: false,
      },
    });
  }
  return tools;
}

function sha12(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  return `${value.slice(0, 12)}...`;
}

async function readSnapshot(filePath: string): Promise<DrkallaKnowledgeSnapshot> {
  return JSON.parse(await readFile(filePath, 'utf8')) as DrkallaKnowledgeSnapshot;
}

function drkallaTestPhoneNumber(): string {
  const phone = process.env.DRKALLA_DEMO_PHONE_NUMBER?.trim()
    || process.env.RETELL_DRKALLA_DEMO_PHONE_NUMBER?.trim();
  if (!phone) {
    throw new Error('DRKALLA_DEMO_PHONE_NUMBER_REQUIRED_FOR_ASSIGN_PHONE');
  }
  return phone;
}

function maskPhone(value: string): string {
  return value.replace(/\d(?=\d{3})/g, '*');
}

function retellTimestampMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value < 10_000_000_000 ? value * 1000 : value;
}

export function chooseReusableDrkallaKnowledgeBase(
  knowledgeBases: RetellKnowledgeBase[],
  kbName: string,
): RetellKnowledgeBase | null {
  return knowledgeBases
    .filter((kb) => kb.knowledge_base_name === kbName && kb.status === 'complete')
    .sort((a, b) => retellTimestampMs(b.user_modified_timestamp) - retellTimestampMs(a.user_modified_timestamp))[0]
    ?? null;
}

async function syncDrkallaRagAgent(
  execute: boolean,
  createTestWebCall: boolean,
  assignPhone: boolean,
  forceNewKnowledgeBase: boolean,
): Promise<void> {
  const snapshotPathArg = process.argv.find((arg) => arg.startsWith('--snapshot='));
  const snapshotPath = snapshotPathArg ? path.resolve(snapshotPathArg.slice('--snapshot='.length)) : DEFAULT_SNAPSHOT_PATH;
  const snapshot = await readSnapshot(snapshotPath);
  const snapshotHash = drkallaSnapshotHash(snapshot);
  const knowledgeTexts = buildDrkallaKnowledgeTexts(snapshot);
  const kbName = `${DRKALLA_RAG_KB_NAME_PREFIX} ${snapshotHash} ${DRKALLA_RAG_KB_SCHEMA_VERSION}`;
  const model = getDefaultRetellLlmModel();
  const modelHighPriority = getDefaultRetellLlmHighPriority();
  const webhookBase = webhookBaseUrl();
  const tools = drkallaRagTools(webhookBase);

  const agents = await listAgents();
  const existing = agents.find((agent) => agent.agent_name === DRKALLA_RAG_AGENT_NAME);

  if (!execute) {
    console.log(JSON.stringify({
      dryRun: true,
      agentName: DRKALLA_RAG_AGENT_NAME,
      existingAgentId: existing?.agent_id ? maskId(existing.agent_id) : null,
      existingLlmId: existing?.response_engine?.llm_id ? maskId(existing.response_engine.llm_id) : null,
      kbName,
      snapshotPath,
      productCount: snapshot.productCount,
      knowledgeTextCount: knowledgeTexts.length,
      model,
      modelHighPriority,
      forceNewKnowledgeBase,
      phoneNumberAssignment: assignPhone ? { phoneNumberMasked: maskPhone(drkallaTestPhoneNumber()) } : false,
    }, null, 2));
    return;
  }

  const reusableKb = forceNewKnowledgeBase
    ? null
    : chooseReusableDrkallaKnowledgeBase(await listKnowledgeBases(), kbName);
  const readyKb = reusableKb ?? await waitForKnowledgeBaseComplete((await createKnowledgeBase({
    name: kbName,
    texts: knowledgeTexts,
    urls: [],
    enableAutoRefresh: false,
  })).knowledge_base_id);

  let agentId = existing?.agent_id ?? null;
  let llmId = existing?.response_engine?.llm_id ?? null;

  if (agentId && llmId) {
    await updateLLM(llmId, {
      generalPrompt: DRKALLA_RAG_PROMPT,
      tools,
      model,
      modelHighPriority,
      modelTemperature: 0.2,
      beginMessage: DRKALLA_RAG_BEGIN_MESSAGE,
      knowledgeBaseIds: [readyKb.knowledge_base_id],
      kbConfig: DRKALLA_RAG_KB_CONFIG,
    });
    await updateAgent(agentId, {
      name: DRKALLA_RAG_AGENT_NAME,
      llmId,
      voiceId: DEFAULT_STANDARD_VOICE_ID,
      language: 'de-DE',
      voiceSpeed: DRKALLA_RAG_VOICE_SPEED,
      responsiveness: DRKALLA_RAG_RESPONSIVENESS,
      interruptionSensitivity: DRKALLA_RAG_INTERRUPTION_SENSITIVITY,
      denoisingMode: DRKALLA_RAG_DENOISING_MODE,
      enableDynamicResponsiveness: true,
      reminderTriggerMs: DRKALLA_RAG_REMINDER_TRIGGER_MS,
      reminderMaxCount: DRKALLA_RAG_REMINDER_MAX_COUNT,
      enableBackchannel: false,
      webhookUrl: `${webhookBase}/retell/webhook`,
      dataStorageSetting: 'everything',
      dataStorageRetentionDays: 30,
    });
  } else {
    const llm = await createLLM({
      generalPrompt: DRKALLA_RAG_PROMPT,
      tools,
      model,
      modelHighPriority,
      modelTemperature: 0.2,
      beginMessage: DRKALLA_RAG_BEGIN_MESSAGE,
      knowledgeBaseIds: [readyKb.knowledge_base_id],
      kbConfig: DRKALLA_RAG_KB_CONFIG,
    });
    llmId = llm.llm_id;
    const agent = await createAgent({
      name: DRKALLA_RAG_AGENT_NAME,
      llmId,
      voiceId: DEFAULT_STANDARD_VOICE_ID,
      language: 'de-DE',
      voiceSpeed: DRKALLA_RAG_VOICE_SPEED,
      responsiveness: DRKALLA_RAG_RESPONSIVENESS,
      interruptionSensitivity: DRKALLA_RAG_INTERRUPTION_SENSITIVITY,
      denoisingMode: DRKALLA_RAG_DENOISING_MODE,
      enableDynamicResponsiveness: true,
      reminderTriggerMs: DRKALLA_RAG_REMINDER_TRIGGER_MS,
      reminderMaxCount: DRKALLA_RAG_REMINDER_MAX_COUNT,
      enableBackchannel: false,
      webhookUrl: `${webhookBase}/retell/webhook`,
      dataStorageSetting: 'everything',
      dataStorageRetentionDays: 30,
    });
    agentId = agent.agent_id;
  }

  if (!agentId || !llmId) throw new Error('DRKALLA_RAG_SYNC_DID_NOT_RESOLVE_AGENT_OR_LLM');

  const assignedPhone = assignPhone ? drkallaTestPhoneNumber() : null;
  if (assignedPhone) {
    await updatePhoneNumber(assignedPhone, { inboundAgentId: agentId });
  }

  const syncedLlm = await getLLM(llmId);
  const phoneReadback = assignedPhone
    ? (await listPhoneNumbers()).find((phone) => phone.phone_number === assignedPhone)
    : null;
  const webCall = createTestWebCall
    ? await createWebCall(agentId, {
      dynamicVariables: { business_name: 'Dr.Kalla Cosmetics', knowledge_snapshot_hash: snapshotHash },
      metadata: { template_id: 'drkalla-rag', knowledge_snapshot_hash: snapshotHash },
    })
    : null;

  console.log(JSON.stringify({
    ok: true,
    agentName: DRKALLA_RAG_AGENT_NAME,
    agentIdMasked: maskId(agentId),
    llmIdMasked: maskId(llmId),
    kbIdMasked: maskId(readyKb.knowledge_base_id),
    knowledgeBaseReused: Boolean(reusableKb),
    kbStatus: readyKb.status,
    snapshotHash,
    productCount: snapshot.productCount,
    knowledgeTextCount: knowledgeTexts.length,
    promptHash12: sha12(syncedLlm.general_prompt ?? ''),
    beginMessageExact: syncedLlm.begin_message === DRKALLA_RAG_BEGIN_MESSAGE,
    knowledgeBaseAttached: (syncedLlm.knowledge_base_ids ?? []).includes(readyKb.knowledge_base_id),
    phoneNumberAssignment: assignedPhone ? {
      phoneNumberMasked: maskPhone(assignedPhone),
      assignedToAgent: phoneReadback?.agent_id === agentId
        || phoneReadback?.inbound_agents?.some((agent) => agent.agent_id === agentId) === true,
    } : false,
    webCall: webCall ? {
      callIdMasked: maskId(webCall.call_id),
      webCallLink: webCall.web_call_link,
    } : null,
  }, null, 2));
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  syncDrkallaRagAgent(
    process.argv.includes('--execute'),
    process.argv.includes('--web-call'),
    process.argv.includes('--assign-phone'),
    process.argv.includes('--force-new-kb'),
  )
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
