import '../env.js';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_STANDARD_VOICE_ID,
  createCustomLlmAgent,
  createWebCall,
  listAgents,
  updateCustomLlmAgent,
  type RetellDenoisingMode,
} from '../retell.js';

export const DRKALLA_CUSTOM_RUNTIME_CANARY_AGENT_NAME = 'DrKalla Custom Runtime Canary';
export const DRKALLA_CUSTOM_RUNTIME_CANARY_RESPONSIVENESS = 0.87;
export const DRKALLA_CUSTOM_RUNTIME_CANARY_INTERRUPTION_SENSITIVITY = 0.77;
export const DRKALLA_CUSTOM_RUNTIME_CANARY_DENOISING_MODE: RetellDenoisingMode = 'no-denoise';
export const DRKALLA_CUSTOM_RUNTIME_CANARY_VOICE_SPEED = 1.03;

type BuildWsUrlInput = {
  publicBaseUrl: string;
  secret: string;
  requireSecure?: boolean;
};

export type DrkallaCustomRuntimeCanarySyncReport = {
  dryRun: boolean;
  agentName: string;
  existingAgentId: string | null;
  websocketUrl: string;
  action: 'create' | 'update';
};

export type SanitizedDrkallaCustomRuntimeCanarySyncReport = Omit<DrkallaCustomRuntimeCanarySyncReport, 'websocketUrl'> & {
  websocketUrlMasked: string;
};

function webhookBaseUrl(): string {
  const base = process.env.WEBHOOK_BASE_URL?.trim()
    || process.env.PUBLIC_BASE_URL?.trim()
    || 'https://phonbot.de';
  return base.replace(/\/+$/, '');
}

function requireSecret(): string {
  const secret = process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET?.trim();
  if (!secret) throw new Error('DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET_REQUIRED');
  if (secret.length < 16) throw new Error('DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET_TOO_SHORT');
  return secret;
}

export function buildDrkallaCustomRuntimeCanaryWsUrl(input: BuildWsUrlInput): string {
  const base = new URL(input.publicBaseUrl.replace(/\/+$/, ''));
  if (input.requireSecure && base.protocol !== 'https:') {
    throw new Error('DRKALLA_CUSTOM_RUNTIME_REQUIRES_HTTPS_PUBLIC_BASE_URL');
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error('DRKALLA_CUSTOM_RUNTIME_UNSUPPORTED_PUBLIC_BASE_URL_PROTOCOL');
  }
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${base.toString().replace(/\/+$/, '')}/retell/custom-llm/drkalla/auth/${encodeURIComponent(input.secret)}`;
}

export function sanitizeDrkallaCustomRuntimeCanarySyncReport(
  report: DrkallaCustomRuntimeCanarySyncReport,
): SanitizedDrkallaCustomRuntimeCanarySyncReport {
  return {
    dryRun: report.dryRun,
    agentName: report.agentName,
    existingAgentId: report.existingAgentId ? `${report.existingAgentId.slice(0, 12)}...` : null,
    action: report.action,
    websocketUrlMasked: report.websocketUrl.replace(/\/auth\/[^/?#]+/i, '/auth/[secret]'),
  };
}

async function syncDrkallaCustomRuntimeCanary(execute: boolean, createTestWebCall: boolean): Promise<void> {
  const websocketUrl = buildDrkallaCustomRuntimeCanaryWsUrl({
    publicBaseUrl: webhookBaseUrl(),
    secret: requireSecret(),
    requireSecure: execute,
  });
  const existing = (await listAgents()).find((agent) => agent.agent_name === DRKALLA_CUSTOM_RUNTIME_CANARY_AGENT_NAME);
  const report: DrkallaCustomRuntimeCanarySyncReport = {
    dryRun: !execute,
    agentName: DRKALLA_CUSTOM_RUNTIME_CANARY_AGENT_NAME,
    existingAgentId: existing?.agent_id ?? null,
    websocketUrl,
    action: existing ? 'update' : 'create',
  };

  if (!execute) {
    console.log(JSON.stringify(sanitizeDrkallaCustomRuntimeCanarySyncReport(report), null, 2));
    return;
  }

  const config = {
    name: DRKALLA_CUSTOM_RUNTIME_CANARY_AGENT_NAME,
    llmWebsocketUrl: websocketUrl,
    voiceId: DEFAULT_STANDARD_VOICE_ID,
    language: 'de-DE',
    voiceSpeed: DRKALLA_CUSTOM_RUNTIME_CANARY_VOICE_SPEED,
    responsiveness: DRKALLA_CUSTOM_RUNTIME_CANARY_RESPONSIVENESS,
    interruptionSensitivity: DRKALLA_CUSTOM_RUNTIME_CANARY_INTERRUPTION_SENSITIVITY,
    denoisingMode: DRKALLA_CUSTOM_RUNTIME_CANARY_DENOISING_MODE,
    enableDynamicResponsiveness: true,
    reminderTriggerMs: 6500,
    reminderMaxCount: 2,
    enableBackchannel: false,
    webhookUrl: `${webhookBaseUrl()}/retell/webhook`,
    dataStorageSetting: 'everything' as const,
    dataStorageRetentionDays: 30,
  };
  const agent = existing
    ? await updateCustomLlmAgent(existing.agent_id, config)
    : await createCustomLlmAgent(config);
  const webCall = createTestWebCall
    ? await createWebCall(agent.agent_id, {
        dynamicVariables: { business_name: 'Dr.Kalla Cosmetics', custom_runtime_canary: 'true' },
        metadata: { template_id: 'drkalla-custom-runtime-canary' },
      })
    : null;

  console.log(JSON.stringify({
    ...sanitizeDrkallaCustomRuntimeCanarySyncReport({
      ...report,
      existingAgentId: agent.agent_id,
    }),
    ok: true,
    agentIdMasked: `${agent.agent_id.slice(0, 12)}...`,
    responseEngineType: agent.response_engine.type,
    webCall: webCall ? {
      callIdMasked: `${webCall.call_id.slice(0, 12)}...`,
      webCallLink: webCall.web_call_link,
    } : null,
    phoneAssigned: false,
  }, null, 2));
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  syncDrkallaCustomRuntimeCanary(
    process.argv.includes('--execute'),
    process.argv.includes('--web-call'),
  ).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
