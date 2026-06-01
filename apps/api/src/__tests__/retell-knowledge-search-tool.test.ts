import Fastify from 'fastify';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAppendTraceEvent = vi.fn(async (_event: Record<string, unknown>) => {});
const mockReadConfig = vi.fn();
const mockGetCall = vi.fn();
const mockKnowledgeSearch = vi.fn();
const tempDirs: string[] = [];

vi.mock('../db.js', () => ({
  pool: { query: mockQuery },
}));

vi.mock('../traces.js', () => ({
  appendTraceEvent: mockAppendTraceEvent,
  traceScopeFields: (scope: {
    orgId: string;
    tenantId: string;
    agentId?: string;
    callId?: string;
    sessionId?: string;
    source: 'server';
    resolvedFrom: string;
  }, options: { provider?: string; retrievalEventId?: string | null } = {}) => ({
    tenantId: scope.orgId,
    orgId: scope.orgId,
    tenantScopeId: scope.tenantId,
    agentId: scope.agentId,
    callId: scope.callId ?? scope.sessionId,
    provider: options.provider,
    retrievalEventId: options.retrievalEventId ?? undefined,
    scopeSource: scope.source,
    scopeResolvedFrom: scope.resolvedFrom,
  }),
}));

vi.mock('../agent-config.js', () => ({
  readConfig: mockReadConfig,
  triggerCallback: vi.fn(),
}));

vi.mock('../calendar.js', () => ({
  findFreeSlots: vi.fn(),
  findFreeSlotsForAnyStaff: vi.fn(),
  bookSlot: vi.fn(),
  bookSlotForAnyStaff: vi.fn(),
  findChipyBookingsForChange: vi.fn(),
  cancelChipyBookingForChange: vi.fn(),
  rescheduleChipyBookingForChange: vi.fn(),
  formatSpokenSlotLabel: vi.fn((slot: string) => slot),
}));

vi.mock('../customers.js', () => ({
  customerModuleActiveForAgentConfig: vi.fn(() => false),
  getActiveCustomerDetailsKeys: vi.fn(() => new Set()),
  normalizeCustomerModuleConfig: vi.fn(() => ({ active: false })),
  lookupCustomer: vi.fn(),
  upsertCustomer: vi.fn(),
}));

vi.mock('../tickets.js', () => ({
  createTicket: vi.fn(),
  mergeTicketMetadata: vi.fn(async () => {}),
}));

vi.mock('../sms.js', () => ({
  sendBookingConfirmationSms: vi.fn(),
  sendTicketAckSms: vi.fn(),
}));

vi.mock('../own-kb.js', () => ({
  knowledgeSearch: mockKnowledgeSearch,
}));

vi.mock('../retell.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../retell.js')>();
  return {
    ...actual,
    getCall: mockGetCall,
    deleteCall: vi.fn(),
  };
});

const { registerRetellWebhooks } = await import('../retell-webhooks.js');

const SECRET = 'retell-knowledge-search-test';
const canaryArtifactHash = 'a'.repeat(64);
const primaryArtifactHash = 'b'.repeat(64);

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
  process.env[kind === 'canary'
    ? 'OWN_KB_CANARY_APPROVED_0_5B_ATTESTATION_PATH'
    : 'OWN_KB_PRIMARY_APPROVED_0_5B_ATTESTATION_PATH'] = file;
}

function signToolContext(tenantId: string, agentId: string): string {
  return crypto.createHmac('sha256', SECRET).update(`${tenantId}:${agentId}`).digest('base64url');
}

function signedUrl(path: string, agentId = 'agent-real') {
  const params = new URLSearchParams({
    tenant_id: 'tenant-1',
    tool_agent_id: agentId,
    tool_sig: signToolContext('tenant-1', agentId),
  });
  return `${path}?${params.toString()}`;
}

function tenantOnlySignedUrl(path: string) {
  const params = new URLSearchParams({
    tenant_id: 'tenant-1',
    tool_sig: crypto.createHmac('sha256', SECRET).update('tenant-1').digest('base64url'),
  });
  return `${path}?${params.toString()}`;
}

async function postKnowledgeSearch(args: Record<string, unknown>, agentId = 'agent-real', url = signedUrl('/retell/tools/knowledge.search', agentId)) {
  const app = Fastify({ logger: false });
  await registerRetellWebhooks(app);
  await app.ready();
  try {
    return await app.inject({
      method: 'POST',
      url,
      payload: {
        _retell_call_id: 'call-1',
        from_number: '+491701234567',
        args,
      },
    });
  } finally {
    await app.close();
  }
}

describe('Retell knowledge.search TrustedScope contract', () => {
  beforeEach(() => {
    process.env.RETELL_TOOL_AUTH_SECRET = SECRET;
    process.env.OWN_KB_SEARCH_ENABLED = 'true';
    process.env.OWN_KB_ROLLOUT_ALLOWED_ORG_IDS = 'org-1';
    process.env.OWN_KB_CANARY_DEPLOY_UNLOCKED = 'true';
    process.env.OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_ID = '0.5b-canary-report-2026-05-30';
    process.env.OWN_KB_CANARY_APPROVED_0_5B_ARTIFACT_SHA256 = canaryArtifactHash;
    process.env.OWN_KB_CANARY_APPROVED_0_5B_DECISION = 'owkb_primary_candidate';
    writePromotionAttestation('canary', {
      artifactId: '0.5b-canary-report-2026-05-30',
      artifactSha256: canaryArtifactHash,
      decision: 'owkb_primary_candidate',
    });
    process.env.OWN_KB_PRIMARY_DEPLOY_UNLOCKED = 'true';
    process.env.OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_ID = '0.5b-primary-report-2026-05-30';
    process.env.OWN_KB_PRIMARY_APPROVED_0_5B_ARTIFACT_SHA256 = primaryArtifactHash;
    process.env.OWN_KB_PRIMARY_APPROVED_0_5B_DECISION = 'owkb_primary_candidate';
    writePromotionAttestation('primary', {
      artifactId: '0.5b-primary-report-2026-05-30',
      artifactSha256: primaryArtifactHash,
      decision: 'owkb_primary_candidate',
    });
    process.env.OWN_KB_PRIMARY_CANARY_WITHOUT_P0_DAYS = '14';
    process.env.OWN_KB_PRIMARY_RETELL_STANDBY_DAYS = '14';
    process.env.OWN_KB_PRIMARY_NO_UNRESOLVED_P1 = 'true';
    process.env.OWN_KB_PRIMARY_LATENCY_GATES_PASSED = 'true';
    process.env.OWN_KB_PRIMARY_QUALITY_GATES_PASSED = 'true';
    process.env.OWN_KB_PRIMARY_SAFETY_GATES_PASSED = 'true';
    process.env.OWN_KB_PRIMARY_RETELL_STANDBY_READY = 'true';
    process.env.OWN_KB_PRIMARY_ROLLBACK_TESTED = 'true';
    process.env.OWN_KB_PRIMARY_KILL_SWITCH_TESTED = 'true';
    process.env.OWN_KB_PRIMARY_PRODUCT_KPI_GATES_PASSED = 'true';
    process.env.OWN_KB_PRIMARY_EXCEPTION_PATH_SLO_REPORTED = 'true';
    mockQuery.mockReset();
    mockAppendTraceEvent.mockClear();
    mockReadConfig.mockReset();
    mockGetCall.mockReset();
    mockKnowledgeSearch.mockReset();

    mockReadConfig.mockResolvedValue({
      kbProvider: 'own_kb_primary',
      canaryEnabled: false,
      tenantId: 'tenant-1',
      retellAgentId: 'agent-real',
      tools: [],
      fallback: { enabled: true, reason: 'Allgemeine Uebergabe', reasons: [] },
    });
    mockGetCall.mockResolvedValue({
      call_id: 'call-1',
      agent_id: 'agent-real',
      from_number: '+491701234567',
      call_status: 'ongoing',
    });
    mockKnowledgeSearch.mockResolvedValue({
      answerable: true,
      confidence: 0.88,
      latencyMs: 45,
      snippets: [{
        rank: 1,
        text: 'Trusted Retell answer',
        category: 'faq',
        allowedUse: 'agent_facts',
        verifiedAt: '2026-05-29T00:00:00.000Z',
        expiresAt: '2026-06-29T00:00:00.000Z',
      }],
      policy: { mayAnswer: true, mayMutate: true, reason: 'MALFORMED_TEST_POLICY' },
    });
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT org_id FROM agent_configs WHERE tenant_id')) {
        return { rows: [{ org_id: 'org-1' }], rowCount: 1 };
      }
      if (text.includes('FROM agent_configs') && text.includes("data->>'retellAgentId'")) {
        return { rows: [{ tenant_id: 'tenant-1', org_id: 'org-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses verified Retell context instead of model/body-supplied scope fields', async () => {
    const res = await postKnowledgeSearch({
      query: 'Preise',
      orgId: 'org-attacker',
      tenantId: 'tenant-attacker',
      agentId: 'agent-attacker',
      callId: 'call-attacker',
      sessionId: 'session-attacker',
      source: 'server',
      resolvedFrom: 'call_registry',
      customerId: 'customer-attacker',
    });

    expect(res.statusCode).toBe(200);
    expect(mockKnowledgeSearch).toHaveBeenCalledWith(expect.objectContaining({
      query: 'Preise',
      provider: 'retell',
      trustedScope: expect.objectContaining({
        orgId: 'org-1',
        tenantId: 'tenant-1',
        agentId: 'agent-real',
        callId: 'call-1',
      }),
    }));
    expect(mockKnowledgeSearch).not.toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-attacker',
    }));
    expect(mockAppendTraceEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'security_event',
      tenantId: 'org-1',
      orgId: 'org-1',
      tenantScopeId: 'tenant-1',
      agentId: 'agent-real',
      callId: 'call-1',
      provider: 'retell',
      scopeSource: 'server',
      scopeResolvedFrom: 'call_registry',
      event: 'untrusted_scope_arg_seen',
      fields: expect.arrayContaining(['orgId', 'tenantId', 'agentId', 'callId', 'customerId']),
    }));
    expect(mockAppendTraceEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'security_event',
      event: 'untrusted_scope_arg_seen',
      fields: expect.arrayContaining(['sessionId', 'source', 'resolvedFrom']),
    }));
    const toolTraceEvent = mockAppendTraceEvent.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'tool_call' && event.tool === 'knowledge.search');
    expect(toolTraceEvent).toMatchObject({
      tenantId: 'org-1',
      orgId: 'org-1',
      tenantScopeId: 'tenant-1',
      agentId: 'agent-real',
      callId: 'call-1',
      provider: 'retell',
      scopeSource: 'server',
      scopeResolvedFrom: 'call_registry',
      input: { argKeys: ['query'] },
    });
    const toolResultEvent = mockAppendTraceEvent.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'tool_result' && event.tool === 'knowledge.search');
    expect(toolResultEvent).toMatchObject({
      tenantId: 'org-1',
      orgId: 'org-1',
      tenantScopeId: 'tenant-1',
      provider: 'retell',
    });
    expect(res.json()).toMatchObject({
      ok: true,
      policy: { mayAnswer: true, mayMutate: false, reason: 'MALFORMED_TEST_POLICY' },
    });
  });

  it('rejects Retell knowledge.search when live call agent does not match signed agent', async () => {
    mockGetCall.mockResolvedValue({
      call_id: 'call-1',
      agent_id: 'agent-other',
      from_number: '+491701234567',
      call_status: 'ongoing',
    });

    const res = await postKnowledgeSearch({ query: 'Preise' });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'CALL_AGENT_MISMATCH' });
    expect(mockKnowledgeSearch).not.toHaveBeenCalled();
  });

  it('rejects Retell knowledge.search when signed agent context is missing', async () => {
    const res = await postKnowledgeSearch(
      { query: 'Preise' },
      'agent-real',
      tenantOnlySignedUrl('/retell/tools/knowledge.search'),
    );

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'SIGNED_AGENT_REQUIRED' });
    expect(mockKnowledgeSearch).not.toHaveBeenCalled();
  });

  it('rejects Retell knowledge.search when Own-KB rollout is not enabled', async () => {
    mockReadConfig.mockResolvedValueOnce({
      kbProvider: 'retell_kb',
      canaryEnabled: false,
      tenantId: 'tenant-1',
      retellAgentId: 'agent-real',
      tools: [],
      fallback: { enabled: true, reason: 'Allgemeine Uebergabe', reasons: [] },
    });

    const res = await postKnowledgeSearch({ query: 'Preise' });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      ok: false,
      status: 'disabled',
      error: 'OWN_KB_SEARCH_NOT_ENABLED_FOR_AGENT',
    });
    expect(mockKnowledgeSearch).not.toHaveBeenCalled();
  });

  it('rejects Retell knowledge.search when the live call is inactive', async () => {
    mockGetCall.mockResolvedValue({
      call_id: 'call-1',
      agent_id: 'agent-real',
      from_number: '+491701234567',
      call_status: 'ended',
    });

    const res = await postKnowledgeSearch({ query: 'Preise' });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'CALL_NOT_ACTIVE' });
    expect(mockKnowledgeSearch).not.toHaveBeenCalled();
  });
});
