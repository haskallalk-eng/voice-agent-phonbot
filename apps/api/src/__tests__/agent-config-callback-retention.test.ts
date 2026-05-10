import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../outbound-baseline.js', () => ({ loadOutboundBaseline: vi.fn(async () => 'outbound baseline') }));
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

describe('deployToRetell callback privacy sync', () => {
  beforeEach(() => {
    mockUpdateLLM.mockClear();
    mockUpdateAgent.mockClear();
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
});
