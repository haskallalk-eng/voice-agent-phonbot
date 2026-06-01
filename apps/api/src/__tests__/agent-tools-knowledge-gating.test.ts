import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const canaryArtifactHash = 'a'.repeat(64);
const primaryArtifactHash = 'b'.repeat(64);
const tempDirs: string[] = [];

const { evaluateToolPolicyMock, knowledgeSearchMock } = vi.hoisted(() => ({
  evaluateToolPolicyMock: vi.fn((_input: {
    toolName: string;
    args: Record<string, unknown>;
    callerPhoneVerified?: boolean;
    callerEmailConfirmed?: boolean;
    nowIsoDate: string;
  }) => ({ allowed: true })),
  knowledgeSearchMock: vi.fn(),
}));

vi.mock('../policy-layer.js', () => ({
  evaluateToolPolicy: evaluateToolPolicyMock,
}));

vi.mock('../own-kb.js', () => ({
  knowledgeSearch: knowledgeSearchMock,
}));

import {
  createTrustedScope,
  executeKnownTool,
  getEnabledKnownTools,
  getOpenAITools,
  knowledgeSearchTrustedScopeArgFields,
  sanitizeKnownToolResultForModel,
} from '../agent-tools.js';

const baseConfig = {
  tools: ['calendar.findSlots'],
  fallback: { enabled: true, reason: 'Allgemeine Uebergabe', reasons: [] },
  retellAgentId: 'agent_1',
  tenantId: 'tenant_1',
};

function searchEnabledConfig(overrides: Record<string, unknown> = {}) {
  return {
    ...baseConfig,
    kbProvider: 'own_kb_primary',
    canaryEnabled: false,
    ...overrides,
  } as never;
}

function trustedScope(overrides: Record<string, string | undefined> = {}) {
  return createTrustedScope({
    orgId: 'org_1',
    tenantId: 'tenant_1',
    agentId: 'agent_1',
    callId: 'call_1',
    sessionId: 'session_1',
    source: 'server',
    resolvedFrom: 'authenticated_request',
    ...overrides,
  });
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

function allowOwnKbForTest(...orgIds: string[]) {
  vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
  vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_ORG_IDS', orgIds.join(','));
  vi.stubEnv('OWN_KB_CANARY_DEPLOY_UNLOCKED', 'true');
  vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_ID', '0.5b-canary-report-2026-05-30');
  vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256', canaryArtifactHash);
  vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_DECISION', 'owkb_canary_candidate');
  writePromotionAttestation('canary', {
    artifactId: '0.5b-canary-report-2026-05-30',
    artifactSha256: canaryArtifactHash,
    decision: 'owkb_canary_candidate',
  });
  vi.stubEnv('OWN_KB_PRIMARY_DEPLOY_UNLOCKED', 'true');
  vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_ID', '0.5b-primary-report-2026-05-30');
  vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_SHA256', primaryArtifactHash);
  vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_DECISION', 'owkb_primary_candidate');
  writePromotionAttestation('primary', {
    artifactId: '0.5b-primary-report-2026-05-30',
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
}

function mockSearchResult(text = 'Trusted tenant answer') {
  knowledgeSearchMock.mockResolvedValue({
    answerable: true,
    confidence: 0.91,
    latencyMs: 42,
    snippets: [{
      rank: 1,
      text,
      category: 'faq',
      allowedUse: 'agent_facts',
      verifiedAt: '2026-05-29T00:00:00.000Z',
      expiresAt: '2026-06-29T00:00:00.000Z',
    }],
    policy: { mayAnswer: true, mayMutate: false, reason: 'APPROVED_CURRENT_FACTUAL_CONTEXT' },
  });
}

describe('knowledge.search rollout gating', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not expose own KB search globally in shadow/default mode', () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
    const tools = getEnabledKnownTools({
      ...baseConfig,
      kbProvider: 'own_kb_shadow',
      canaryEnabled: false,
    } as never);
    expect(tools).not.toContain('knowledge.search');
  });

  it('exposes own KB search only for canary or primary agents', () => {
    allowOwnKbForTest('org_1');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_TENANT_IDS', 'tenant_1');
    expect(getEnabledKnownTools({
      ...baseConfig,
      kbProvider: 'own_kb_shadow',
      canaryEnabled: true,
    } as never)).toContain('knowledge.search');
    expect(getEnabledKnownTools({
      ...baseConfig,
      kbProvider: 'own_kb_primary',
      canaryEnabled: false,
    } as never)).toContain('knowledge.search');
  });

  it('does not expose own KB search for canary agents before canary promotion gates pass', () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_TENANT_IDS', 'tenant_1');
    expect(getEnabledKnownTools({
      ...baseConfig,
      kbProvider: 'own_kb_shadow',
      canaryEnabled: true,
    } as never)).not.toContain('knowledge.search');
  });

  it('does not expose own KB search when rollout evidence is env-only without persisted attestation', () => {
    allowOwnKbForTest('org_1');
    vi.stubEnv('OWN_KB_CANARY_APPROVED_0_5B_ATTESTATION_PATH', '');
    vi.stubEnv('OWN_KB_PRIMARY_APPROVED_0_5B_ATTESTATION_PATH', '');

    expect(getEnabledKnownTools({
      ...baseConfig,
      kbProvider: 'own_kb_primary',
      canaryEnabled: false,
    } as never, { orgId: 'org_1' })).not.toContain('knowledge.search');
  });

  it('does not expose own KB search for canary agents outside the rollout allowlist', () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
    const tools = getEnabledKnownTools({
      ...baseConfig,
      kbProvider: 'own_kb_shadow',
      canaryEnabled: true,
    } as never);
    expect(tools).not.toContain('knowledge.search');
  });

  it('does not treat wildcard rollout allowlist entries as scope approval', () => {
    allowOwnKbForTest('*');
    const tools = getEnabledKnownTools({
      ...baseConfig,
      kbProvider: 'own_kb_primary',
      canaryEnabled: false,
    } as never, { orgId: 'org_1' });

    expect(tools).not.toContain('knowledge.search');
  });

  it('blocks direct knowledge.search execution when the agent is not canary or primary', async () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
    vi.stubEnv('OWN_KB_ROLLOUT_ALLOWED_ORG_IDS', 'org_1');
    const result = await executeKnownTool({
      name: 'knowledge_search',
      args: { query: 'Betrieb Leistungen' },
      tenantId: 'org_1',
      sessionId: 'session_1',
      source: 'web',
      trustedScope: trustedScope(),
      cfg: {
        ...baseConfig,
        kbProvider: 'own_kb_shadow',
        canaryEnabled: false,
      } as never,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'disabled',
      error: 'OWN_KB_SEARCH_NOT_ENABLED_FOR_AGENT',
    });
  });

  it('blocks direct knowledge.search execution when the agent is not in the rollout allowlist', async () => {
    vi.stubEnv('OWN_KB_SEARCH_ENABLED', 'true');
    const result = await executeKnownTool({
      name: 'knowledge_search',
      args: { query: 'Betrieb Leistungen' },
      tenantId: 'org_1',
      sessionId: 'session_1',
      source: 'web',
      trustedScope: trustedScope(),
      cfg: {
        ...baseConfig,
        kbProvider: 'own_kb_primary',
        canaryEnabled: false,
      } as never,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'disabled',
      error: 'OWN_KB_SEARCH_NOT_ENABLED_FOR_AGENT',
      policy: { mayAnswer: false, mayMutate: false, reason: 'OWN_KB_SEARCH_NOT_ENABLED' },
    });
  });

  it('fails closed when knowledge.search is missing server-derived TrustedScope', async () => {
    allowOwnKbForTest('org_1');
    const result = await executeKnownTool({
      name: 'knowledge_search',
      args: { query: 'Betrieb Leistungen' },
      tenantId: 'org_1',
      sessionId: 'session_1',
      source: 'web',
      cfg: searchEnabledConfig(),
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'trusted_scope_required',
      error: 'TRUSTED_SCOPE_REQUIRED',
      policy: { mayAnswer: false, mayMutate: false, reason: 'TRUSTED_SCOPE_REQUIRED' },
    });
    expect(knowledgeSearchMock).not.toHaveBeenCalled();
  });

  it('fails closed when TrustedScope lacks required provenance', async () => {
    allowOwnKbForTest('org_1');
    const unprovenScope = {
      ...trustedScope(),
      resolvedFrom: undefined,
    };

    const result = await executeKnownTool({
      name: 'knowledge_search',
      args: { query: 'Betrieb Leistungen' },
      tenantId: 'org_1',
      sessionId: 'session_1',
      source: 'web',
      trustedScope: unprovenScope as never,
      cfg: searchEnabledConfig(),
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'trusted_scope_required',
      error: 'TRUSTED_SCOPE_REQUIRED',
    });
    expect(knowledgeSearchMock).not.toHaveBeenCalled();
  });

  it('fails closed when TrustedScope lacks trusted agent scope', async () => {
    allowOwnKbForTest('org_1');
    const agentlessScope = {
      ...trustedScope(),
      agentId: undefined,
    };

    const result = await executeKnownTool({
      name: 'knowledge_search',
      args: { query: 'Betrieb Leistungen' },
      tenantId: 'org_1',
      sessionId: 'session_1',
      source: 'web',
      trustedScope: agentlessScope as never,
      cfg: searchEnabledConfig(),
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'trusted_scope_required',
      error: 'TRUSTED_SCOPE_REQUIRED',
    });
    expect(knowledgeSearchMock).not.toHaveBeenCalled();
  });

  it('does not expose trusted scope fields in the knowledge.search schema', () => {
    allowOwnKbForTest('org_1');
    const tools = getOpenAITools(searchEnabledConfig(), { orgId: 'org_1' });
    const knowledgeTool = tools.find((tool) => tool.name === 'knowledge_search');

    expect(knowledgeTool?.parameters.additionalProperties).toBe(false);
    const properties = knowledgeTool?.parameters.properties ?? {};
    for (const field of knowledgeSearchTrustedScopeArgFields) {
      expect(properties).not.toHaveProperty(field);
    }
  });

  it('ignores and logs model-supplied scope-like args instead of trusting them', async () => {
    allowOwnKbForTest('org_trusted');
    mockSearchResult();
    const logSecurityEvent = vi.fn();

    const result = await executeKnownTool({
      name: 'knowledge_search',
      args: {
        query: 'Preise',
        orgId: 'org_attacker',
        tenantId: 'tenant_attacker',
        agentId: 'agent_attacker',
        callId: 'call_attacker',
        sessionId: 'session_attacker',
        source: 'server',
        resolvedFrom: 'call_registry',
        customerId: 'customer_attacker',
      },
      tenantId: 'org_trusted',
      sessionId: 'session_1',
      source: 'web',
      trustedScope: trustedScope({
        orgId: 'org_trusted',
        tenantId: 'tenant_trusted',
        agentId: 'agent_trusted',
        callId: 'call_trusted',
      }),
      logSecurityEvent,
      cfg: searchEnabledConfig({ tenantId: 'tenant_trusted', retellAgentId: 'agent_trusted' }),
    });

    expect(result).toMatchObject({
      ok: true,
      policy: { mayMutate: false },
    });
    expect(knowledgeSearchMock).toHaveBeenCalledWith(expect.objectContaining({
      trustedScope: expect.objectContaining({
        orgId: 'org_trusted',
        tenantId: 'tenant_trusted',
        agentId: 'agent_trusted',
        callId: 'call_trusted',
      }),
    }));
    expect(knowledgeSearchMock).not.toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org_attacker',
    }));
    expect(logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'untrusted_scope_arg_seen',
      tool: 'knowledge.search',
      fields: expect.arrayContaining(['orgId', 'tenantId', 'agentId', 'callId', 'customerId']),
    }));
    expect(logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.arrayContaining(['sessionId', 'source', 'resolvedFrom']),
    }));
  });

  it('strips model-supplied scope-like args before policy evaluation', async () => {
    allowOwnKbForTest('org_trusted');
    mockSearchResult();

    await executeKnownTool({
      name: 'knowledge_search',
      args: {
        query: 'Preise',
        orgId: 'org_attacker',
        tenantId: 'tenant_attacker',
        agentId: 'agent_attacker',
        callId: 'call_attacker',
        sessionId: 'session_attacker',
        source: 'server',
        resolvedFrom: 'call_registry',
        customerIdentity: { id: 'customer_attacker' },
        authorization: 'Bearer attacker',
        authContext: { role: 'admin' },
      },
      tenantId: 'org_trusted',
      sessionId: 'session_1',
      source: 'web',
      trustedScope: trustedScope({
        orgId: 'org_trusted',
        tenantId: 'tenant_trusted',
        agentId: 'agent_trusted',
      }),
      cfg: searchEnabledConfig({ tenantId: 'tenant_trusted', retellAgentId: 'agent_trusted' }),
    });

    const policyInput = evaluateToolPolicyMock.mock.calls.at(-1)?.[0];
    expect(policyInput).toMatchObject({
      toolName: 'knowledge_search',
      args: { query: 'Preise' },
    });
    for (const field of knowledgeSearchTrustedScopeArgFields) {
      expect(policyInput?.args).not.toHaveProperty(field);
    }
  });

  it('does not leak when two orgs share the same tenantId', async () => {
    allowOwnKbForTest('org_trusted');
    knowledgeSearchMock.mockImplementation(async (input) => mockKnowledgeSearchByScope(input));

    const result = await executeKnownTool({
      name: 'knowledge_search',
      args: { query: 'SENTINEL_ORG_B', orgId: 'org_b' },
      tenantId: 'org_trusted',
      sessionId: 'session_1',
      source: 'web',
      trustedScope: trustedScope({ orgId: 'org_trusted', tenantId: 'shared_tenant' }),
      cfg: searchEnabledConfig({ tenantId: 'shared_tenant' }),
    });

    expect(JSON.stringify(result)).not.toContain('SENTINEL_ORG_B');
    expect(knowledgeSearchMock).toHaveBeenCalledWith(expect.objectContaining({
      trustedScope: expect.objectContaining({
        orgId: 'org_trusted',
        tenantId: 'shared_tenant',
      }),
    }));
  });

  it('does not leak when one org has two tenantIds', async () => {
    allowOwnKbForTest('org_shared');
    knowledgeSearchMock.mockImplementation(async (input) => mockKnowledgeSearchByScope(input));

    const result = await executeKnownTool({
      name: 'knowledge_search',
      args: { query: 'SENTINEL_TENANT_B', tenantId: 'tenant_b' },
      tenantId: 'org_shared',
      sessionId: 'session_1',
      source: 'web',
      trustedScope: trustedScope({ orgId: 'org_shared', tenantId: 'tenant_a' }),
      cfg: searchEnabledConfig({ tenantId: 'tenant_a' }),
    });

    expect(JSON.stringify(result)).not.toContain('SENTINEL_TENANT_B');
    expect(knowledgeSearchMock).toHaveBeenCalledWith(expect.objectContaining({
      trustedScope: expect.objectContaining({
        orgId: 'org_shared',
        tenantId: 'tenant_a',
      }),
    }));
  });

  it('does not return a cross-tenant sentinel from untrusted tool args', async () => {
    allowOwnKbForTest('org_1');
    knowledgeSearchMock.mockImplementation(async (input) => mockKnowledgeSearchByScope(input));

    const result = await executeKnownTool({
      name: 'knowledge_search',
      args: { query: 'Cross tenant Frage', tenantId: 'tenant_b', orgId: 'org_b' },
      tenantId: 'org_1',
      sessionId: 'session_1',
      source: 'web',
      trustedScope: trustedScope({ orgId: 'org_1', tenantId: 'tenant_1' }),
      cfg: searchEnabledConfig({ tenantId: 'tenant_1' }),
    });

    expect(JSON.stringify(result)).not.toContain('SENTINEL_TENANT_B');
    expect(JSON.stringify(result)).not.toContain('SENTINEL_ORG_B');
  });

  it('hard-clamps knowledge.search results to mayMutate=false', async () => {
    allowOwnKbForTest('org_1');
    knowledgeSearchMock.mockResolvedValue({
      answerable: true,
      confidence: 0.8,
      latencyMs: 20,
      snippets: [],
      policy: { mayAnswer: true, mayMutate: true, reason: 'MALFORMED_TEST_POLICY' },
    });

    const result = await executeKnownTool({
      name: 'knowledge_search',
      args: { query: 'Betrieb Leistungen' },
      tenantId: 'org_1',
      sessionId: 'session_1',
      source: 'web',
      trustedScope: trustedScope(),
      cfg: searchEnabledConfig(),
    });

    expect(result).toMatchObject({
      ok: true,
      policy: { mayAnswer: true, mayMutate: false, reason: 'MALFORMED_TEST_POLICY' },
    });
  });

  it('sanitizes knowledge snippets before returning them to model runtimes', () => {
    const sanitized = sanitizeKnownToolResultForModel({
      ok: true,
      status: 'answerable',
      confidence: 0.82,
      snippets: [{
        rank: 1,
        text: 'Mail test@example.com oder +49 170 1234567',
        category: 'service',
        allowedUse: 'answer',
        verifiedAt: '2026-05-28T00:00:00.000Z',
        expiresAt: '2026-06-28T00:00:00.000Z',
        chunkId: 'chunk_secret',
        sourceId: 'source_secret',
      }],
      policy: { mayAnswer: true, mayMutate: false, reason: 'ok' },
    });

    expect(sanitized).toMatchObject({
      ok: true,
      status: 'answerable',
      confidence: 0.82,
      snippets: [{
        rank: 1,
        text: 'Mail [EMAIL] oder [PHONE]',
        category: 'service',
        allowedUse: 'answer',
      }],
      policy: { mayAnswer: true, mayMutate: false, reason: 'ok' },
    });
    expect(JSON.stringify(sanitized)).not.toContain('chunk_secret');
    expect(JSON.stringify(sanitized)).not.toContain('source_secret');
  });
});

function mockKnowledgeSearchByScope(input: { trustedScope: { orgId: string; tenantId: string } }) {
  const text = input.trustedScope.orgId === 'org_b'
    ? 'SENTINEL_ORG_B'
    : input.trustedScope.tenantId === 'tenant_b'
      ? 'SENTINEL_TENANT_B'
      : 'Trusted scoped answer';
  return {
    answerable: true,
    confidence: 0.9,
    latencyMs: 30,
    snippets: [{
      rank: 1,
      text,
      category: 'faq',
      allowedUse: 'agent_facts',
      verifiedAt: '2026-05-29T00:00:00.000Z',
      expiresAt: '2026-06-29T00:00:00.000Z',
    }],
    policy: { mayAnswer: true, mayMutate: false, reason: 'APPROVED_CURRENT_FACTUAL_CONTEXT' },
  };
}
