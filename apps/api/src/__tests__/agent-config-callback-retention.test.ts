import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('WEBHOOK_BASE_URL', 'https://api.phonbot.test');

const mockUpdateLLM = vi.fn(async (_id: unknown, _config: unknown) => ({}));
const mockUpdateAgent = vi.fn(async (_id: unknown, _config: unknown) => ({}));

vi.mock('../db.js', () => ({ pool: null }));
vi.mock('../logger.js', () => {
  const noop = () => {};
  return { log: { info: noop, warn: noop, error: noop, debug: noop } };
});
vi.mock('../agent-instructions.js', () => ({ buildAgentInstructions: vi.fn(() => 'agent instructions') }));
vi.mock('../platform-baseline.js', () => ({ loadPlatformBaseline: vi.fn(async () => 'platform baseline') }));
vi.mock('../outbound-baseline.js', () => ({
  loadOutboundBaseline: vi.fn(async () => 'outbound baseline'),
  ensureOutboundSafetyKernel: vi.fn((prompt: string) => prompt),
}));
vi.mock('../knowledge.js', () => ({
  normalizeKnowledgeSources: vi.fn(async (cfg: unknown) => cfg),
  storeKnowledgePdf: vi.fn(),
  syncRetellKnowledgeBase: vi.fn(async (cfg: unknown) => cfg),
}));
vi.mock('../api-integrations.js', () => ({
  buildIntegrationTools: vi.fn(() => []),
  mergeAndEncryptIntegrations: vi.fn(async (cfg: unknown) => cfg),
  maskApiIntegrationsForClient: vi.fn((cfg: unknown) => cfg),
}));
vi.mock('../opening-hours-sync.js', () => ({ syncOpeningHoursToChipy: vi.fn(async () => {}) }));
vi.mock('../inbound-webhooks.js', () => ({ invalidateInboundWebhooksCache: vi.fn() }));
vi.mock('../org-id-cache.js', () => ({ invalidateOrgIdCache: vi.fn(), setOrgIdCache: vi.fn() }));
vi.mock('../voice-ownership.js', () => ({ isVoiceAllowedForOrg: vi.fn(async () => true) }));
vi.mock('../usage.js', () => ({
  tryReserveMinutes: vi.fn(async () => ({ allowed: true })),
  DEFAULT_CALL_RESERVE_MINUTES: 5,
}));
vi.mock('../billing.js', () => ({
  PLANS: {
    free: { id: 'free', minutesLimit: 30, agentsLimit: 1, overchargePerMinute: 0 },
    starter: { id: 'starter', minutesLimit: 360, agentsLimit: 3, overchargePerMinute: 0.05 },
  },
}));
vi.mock('../customers.js', () => ({
  customerModuleActiveForAgentConfig: vi.fn(() => false),
  customerModuleStatus: vi.fn(async () => ({ available: false })),
  getActiveCustomerQuestions: vi.fn(async () => []),
  getCustomCustomerQuestions: vi.fn(async () => []),
  normalizeCustomerModuleConfig: vi.fn(() => ({ enabled: false })),
}));
vi.mock('../retell.js', () => ({
  createLLM: vi.fn(async () => ({ llm_id: 'new-llm' })),
  updateLLM: (id: unknown, config: unknown) => mockUpdateLLM(id, config),
  createAgent: vi.fn(async () => ({ agent_id: 'new-agent' })),
  updateAgent: (id: unknown, config: unknown) => mockUpdateAgent(id, config),
  createWebCall: vi.fn(),
  listCalls: vi.fn(async () => ({ calls: [] })),
  getCall: vi.fn(),
  getAgent: vi.fn(),
  getLLM: vi.fn(),
  deleteAgent: vi.fn(),
  deleteLLM: vi.fn(),
  updatePhoneNumber: vi.fn(),
  DEFAULT_VOICE_ID: 'voice-default',
  DEFAULT_STANDARD_VOICE_ID: 'voice-standard',
  getDefaultRetellLlmModel: vi.fn(() => 'gpt-5.4-mini'),
}));
vi.mock('@vas/shared', () => ({
  deriveTechnicalRuntimeSettings: vi.fn(() => ({
    voiceSpeed: undefined,
    responsiveness: undefined,
    maxCallDurationMs: undefined,
    interruptionSensitivity: undefined,
    enableBackchannel: undefined,
    allowUserDtmf: undefined,
    modelTemperature: undefined,
  })),
  toE164: (value: string) => value,
}));
vi.mock('../twilio-openai-bridge.js', () => ({ triggerBridgeCall: vi.fn() }));

const { deployToRetell } = await import('../agent-config.js');

const canaryArtifactHash = 'a'.repeat(64);
const primaryArtifactHash = 'b'.repeat(64);
const tempDirs: string[] = [];

type ConfigArg = Parameters<typeof deployToRetell>[0];

function cfg(overrides: Partial<ConfigArg> = {}): ConfigArg {
  return {
    tenantId: 'tenant-1',
    name: 'Chipy',
    language: 'de',
    voice: 'voice-1',
    businessName: 'Phonbot Test',
    businessDescription: 'Test business.',
    address: '',
    openingHours: '',
    servicesText: '',
    services: [],
    systemPrompt: 'Sei freundlich.',
    selectedRoles: [],
    customPromptAddition: '',
    roleBlockOverrides: {},
    sectionTextOverrides: {},
    tools: [],
    fallback: { enabled: true, reason: 'handoff' },
    retellLlmId: 'llm-main',
    retellAgentId: 'agent-main',
    retellCallbackLlmId: 'llm-callback',
    retellCallbackAgentId: 'agent-callback',
    ...overrides,
  } as unknown as ConfigArg;
}

function writePromotionAttestation(kind: 'canary' | 'primary', input: {
  artifactId: string;
  artifactSha256: string;
  decision: string;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'own-kb-attestation-'));
  tempDirs.push(dir);
  const file = join(dir, `${kind}.json`);
  writeFileSync(file, JSON.stringify({
    artifactId: input.artifactId,
    artifactSha256: input.artifactSha256,
    decision: input.decision,
    promotionEvidenceUsable: true,
  }));
  vi.stubEnv(kind === 'canary'
    ? 'OWN_KB_CANARY_APPROVED_0_5B_ATTESTATION_PATH'
    : 'OWN_KB_PRIMARY_APPROVED_0_5B_ATTESTATION_PATH', file);
}

describe('deployToRetell callback privacy sync', () => {
  beforeEach(() => {
    mockUpdateLLM.mockClear();
    mockUpdateAgent.mockClear();
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'false');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOW_ALL', 'false');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_ORG_IDS', '');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_TENANT_IDS', '');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_AGENT_IDS', '');
    vi.stubEnv('OWN_KB_CANARY_DEPLOY_UNLOCKED', 'false');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_ID', '');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256', '');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_DECISION', '');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ATTESTATION_PATH', '');
    vi.stubEnv('OWN_KB_PRIMARY_DEPLOY_UNLOCKED', 'false');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_ID', '');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_SHA256', '');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_DECISION', '');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ATTESTATION_PATH', '');
    vi.stubEnv('OWN_KB_PRIMARY_CANARY_WITHOUT_P0_DAYS', '0');
    vi.stubEnv('OWN_KB_PRIMARY_RETELL_STANDBY_DAYS', '0');
    vi.stubEnv('OWN_KB_PRIMARY_NO_UNRESOLVED_P1', 'false');
    vi.stubEnv('OWN_KB_PRIMARY_LATENCY_GATES_PASSED', 'false');
    vi.stubEnv('OWN_KB_PRIMARY_QUALITY_GATES_PASSED', 'false');
    vi.stubEnv('OWN_KB_PRIMARY_SAFETY_GATES_PASSED', 'false');
    vi.stubEnv('OWN_KB_PRIMARY_RETELL_STANDBY_READY', 'false');
    vi.stubEnv('OWN_KB_PRIMARY_ROLLBACK_TESTED', 'false');
    vi.stubEnv('OWN_KB_PRIMARY_KILL_SWITCH_TESTED', 'false');
    vi.stubEnv('OWN_KB_PRIMARY_PRODUCT_KPI_GATES_PASSED', 'false');
    vi.stubEnv('OWN_KB_PRIMARY_EXCEPTION_PATH_SLO_REPORTED', 'false');
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('updates existing callback agents to basic storage when retention is disabled', async () => {
    await deployToRetell(cfg({ recordCalls: true, dataRetentionDays: 0 }));

    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'agent-callback',
      expect.objectContaining({
        name: 'Chipy (Callback)',
        llmId: 'llm-callback',
        dataStorageSetting: 'basic_attributes_only',
        dataStorageRetentionDays: 1,
      }),
    );
  });

  it('syncs positive Retell-native storage retention to main and callback agents', async () => {
    await deployToRetell(cfg({ recordCalls: true, dataRetentionDays: 7 }));

    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'agent-main',
      expect.objectContaining({
        dataStorageSetting: 'everything',
        dataStorageRetentionDays: 7,
      }),
    );
    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'agent-callback',
      expect.objectContaining({
        dataStorageSetting: 'everything',
        dataStorageRetentionDays: 7,
      }),
    );
  });

  it('rejects Own-KB primary deploys outside the server-side rollout allowlist', async () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');

    await expect(deployToRetell(cfg({ kbProvider: 'own_kb_primary' }), 'org-1'))
      .rejects.toThrow('OWN_KB_ROLLOUT_NOT_ALLOWED');
  });

  it('rejects Own-KB primary deploys when primary promotion gates are missing even if allowlisted', async () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_ORG_IDS', 'org-1');

    await expect(deployToRetell(cfg({ kbProvider: 'own_kb_primary' }), 'org-1'))
      .rejects.toThrow('OWN_KB_PRIMARY_PROMOTION_GATES_NOT_PASSED');
    expect(mockUpdateLLM).not.toHaveBeenCalled();
    expect(mockUpdateAgent).not.toHaveBeenCalledWith('agent-main', expect.anything());
  });

  it('rejects Own-KB canary deploys when canary promotion gates are missing even if allowlisted', async () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_ORG_IDS', 'org-1');

    await expect(deployToRetell(cfg({ kbProvider: 'own_kb_shadow', canaryEnabled: true }), 'org-1'))
      .rejects.toThrow('OWN_KB_CANARY_PROMOTION_GATES_NOT_PASSED');
    expect(mockUpdateLLM).not.toHaveBeenCalled();
    expect(mockUpdateAgent).not.toHaveBeenCalledWith('agent-main', expect.anything());
  });

  it('rejects Own-KB primary deploys when the 0.5B artifact evidence is only a boolean-like flag', async () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_ORG_IDS', 'org-1');
    vi.stubEnv('OWN_KB_CANARY_DEPLOY_UNLOCKED', 'true');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_ID', '0.5b-canary-report-2026-05-30');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256', canaryArtifactHash);
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_DECISION', 'owkb_primary_candidate');
    writePromotionAttestation('canary', {
      artifactId: '0.5b-canary-report-2026-05-30',
      artifactSha256: canaryArtifactHash,
      decision: 'owkb_primary_candidate',
    });
    vi.stubEnv('OWN_KB_PRIMARY_DEPLOY_UNLOCKED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_ID', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_SHA256', primaryArtifactHash);
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_DECISION', 'owkb_primary_candidate');
    vi.stubEnv('OWN_KB_PRIMARY_CANARY_WITHOUT_P0_DAYS', '14');
    vi.stubEnv('OWN_KB_PRIMARY_RETELL_STANDBY_DAYS', '14');
    vi.stubEnv('OWN_KB_PRIMARY_NO_UNRESOLVED_P1', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_LATENCY_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_QUALITY_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_SAFETY_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_RETELL_STANDBY_READY', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_ROLLBACK_TESTED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_KILL_SWITCH_TESTED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_PRODUCT_KPI_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_EXCEPTION_PATH_SLO_REPORTED', 'true');

    await expect(deployToRetell(cfg({ kbProvider: 'own_kb_primary' }), 'org-1'))
      .rejects.toThrow('OWN_KB_PRIMARY_PROMOTION_GATES_NOT_PASSED');
    expect(mockUpdateLLM).not.toHaveBeenCalled();
  });

  it('allows Own-KB primary deploys only when allowlist and primary promotion gates pass', async () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_ORG_IDS', 'org-1');
    vi.stubEnv('OWN_KB_CANARY_DEPLOY_UNLOCKED', 'true');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_ID', '0.5b-canary-report-2026-05-30');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256', canaryArtifactHash);
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_DECISION', 'owkb_primary_candidate');
    writePromotionAttestation('canary', {
      artifactId: '0.5b-canary-report-2026-05-30',
      artifactSha256: canaryArtifactHash,
      decision: 'owkb_primary_candidate',
    });
    vi.stubEnv('OWN_KB_PRIMARY_DEPLOY_UNLOCKED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_ID', '0.5b-report-2026-05-30');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_SHA256', primaryArtifactHash);
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_DECISION', 'owkb_primary_candidate');
    writePromotionAttestation('primary', {
      artifactId: '0.5b-report-2026-05-30',
      artifactSha256: primaryArtifactHash,
      decision: 'owkb_primary_candidate',
    });
    vi.stubEnv('OWN_KB_PRIMARY_CANARY_WITHOUT_P0_DAYS', '14');
    vi.stubEnv('OWN_KB_PRIMARY_RETELL_STANDBY_DAYS', '14');
    vi.stubEnv('OWN_KB_PRIMARY_NO_UNRESOLVED_P1', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_LATENCY_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_QUALITY_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_SAFETY_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_RETELL_STANDBY_READY', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_ROLLBACK_TESTED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_KILL_SWITCH_TESTED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_PRODUCT_KPI_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_EXCEPTION_PATH_SLO_REPORTED', 'true');

    const deployed = await deployToRetell(cfg({
      kbProvider: 'own_kb_primary',
      retellKnowledgeBaseId: 'kb-standby',
      knowledgeBaseSignature: 'sig-standby',
    } as Partial<ConfigArg>), 'org-1');

    expect(mockUpdateLLM).toHaveBeenCalled();
    expect((deployed as Record<string, unknown>).retellKnowledgeBaseId).toBe('kb-standby');
    expect((deployed as Record<string, unknown>).knowledgeBaseSignature).toBe('sig-standby');
    const llmToolsUpdate = mockUpdateLLM.mock.calls.find((call) =>
      JSON.stringify(call[1]).includes('knowledge_search'),
    );
    expect(llmToolsUpdate).toBeTruthy();
  });

  it('rejects Own-KB primary deploys when primary and canary artifact evidence are identical', async () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_ORG_IDS', 'org-1');
    vi.stubEnv('OWN_KB_CANARY_DEPLOY_UNLOCKED', 'true');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_ID', '0.5b-same-report-2026-05-30');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256', canaryArtifactHash);
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_DECISION', 'owkb_primary_candidate');
    writePromotionAttestation('canary', {
      artifactId: '0.5b-same-report-2026-05-30',
      artifactSha256: canaryArtifactHash,
      decision: 'owkb_primary_candidate',
    });
    vi.stubEnv('OWN_KB_PRIMARY_DEPLOY_UNLOCKED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_ID', '0.5b-same-report-2026-05-30');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_SHA256', canaryArtifactHash);
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_DECISION', 'owkb_primary_candidate');
    vi.stubEnv('OWN_KB_PRIMARY_CANARY_WITHOUT_P0_DAYS', '14');
    vi.stubEnv('OWN_KB_PRIMARY_RETELL_STANDBY_DAYS', '14');
    vi.stubEnv('OWN_KB_PRIMARY_NO_UNRESOLVED_P1', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_LATENCY_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_QUALITY_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_SAFETY_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_RETELL_STANDBY_READY', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_ROLLBACK_TESTED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_KILL_SWITCH_TESTED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_PRODUCT_KPI_GATES_PASSED', 'true');
    vi.stubEnv('OWN_KB_PRIMARY_EXCEPTION_PATH_SLO_REPORTED', 'true');

    await expect(deployToRetell(cfg({ kbProvider: 'own_kb_primary' }), 'org-1'))
      .rejects.toThrow('OWN_KB_PRIMARY_PROMOTION_GATES_NOT_PASSED');
    expect(mockUpdateLLM).not.toHaveBeenCalled();
  });
});
