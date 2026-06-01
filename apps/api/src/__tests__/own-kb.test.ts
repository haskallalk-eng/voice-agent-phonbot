import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../db.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
}));

vi.mock('../logger.js', () => ({
  log: {
    warn: mocks.logWarn,
  },
}));

const { backfillOwnKnowledgeBaseFromAgentConfig, chunkKnowledgeText, knowledgeSearch } = await import('../own-kb.js');
const { createTrustedScope } = await import('../trusted-scope.js');

function trustedScope() {
  return createTrustedScope({
    orgId: 'org_1',
    tenantId: 'org_1',
    agentId: 'agent_1',
    source: 'server',
    resolvedFrom: 'internal_job',
  });
}

describe('own KB knowledge.search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENAI_API_KEY', '');
  });

  it('returns only approved current factual snippets and logs retrieval', async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('from kb_chunks c')) {
        return {
          rows: [{
            chunk_id: 'chunk_1',
            source_id: 'source_1',
            source_version_id: 'version_1',
            text: 'Unsere Preise starten bei 29 Euro. Kontakt: test@example.com',
            category: 'pricing',
            allowed_use: 'voice_factual_answer',
            verified_at: '2026-05-28T00:00:00.000Z',
            expires_at: '2026-08-28T00:00:00.000Z',
            risk: 'low',
            distance: null,
            rank: 1,
            channel: 'fts',
          }],
        };
      }
      if (sql.includes('insert into kb_retrieval_events')) {
        return { rows: [{ id: 'event_1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await knowledgeSearch({
      query: 'Was kostet es?',
      trustedScope: trustedScope(),
      provider: 'test',
    });

    expect(result.answerable).toBe(true);
    expect(result.policy.mayMutate).toBe(false);
    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0]?.text).toContain('[EMAIL]');
    expect(result.snippets[0]?.text).not.toContain('test@example.com');
    expect(mocks.poolQuery.mock.calls.some((call) => String(call[0]).includes('insert into kb_retrieval_events'))).toBe(true);
  });

  it('abstains when no approved source matches', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await knowledgeSearch({
      query: 'Unbekannte Frage',
      trustedScope: trustedScope(),
      provider: 'test',
    });

    expect(result.answerable).toBe(false);
    expect(result.policy.mayAnswer).toBe(false);
    expect(result.policy.mayMutate).toBe(false);
  });

  it('fails closed without TrustedScope before touching retrieval', async () => {
    const result = await knowledgeSearch({
      query: 'Was kostet es?',
      provider: 'test',
    } as never);

    expect(result).toMatchObject({
      answerable: false,
      policy: { mayAnswer: false, mayMutate: false, reason: 'TRUSTED_SCOPE_REQUIRED' },
    });
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('chunks long knowledge text with stable bounds', () => {
    const text = Array.from({ length: 30 }, (_value, index) =>
      `Abschnitt ${index + 1}: Der Basistarif kostet 29 Euro pro Monat und Termine koennen Montag bis Freitag gebucht werden.`,
    ).join('\n\n');
    const chunks = chunkKnowledgeText(text, { maxChars: 500, overlapChars: 40 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 500)).toBe(true);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_chunk, index) => index));
  });

  it('dry-runs approved own KB sources without writing', async () => {
    const result = await backfillOwnKnowledgeBaseFromAgentConfig({
      orgId: '00000000-0000-0000-0000-000000000001',
      tenantId: 'tenant_1',
      includeCanonicalBusinessFacts: false,
      dryRun: true,
      now: '2026-05-28T00:00:00.000Z',
      config: {
        knowledgeSources: [{
          id: 'faq_1',
          type: 'text',
          name: 'Preise FAQ',
          content: 'Der Starter Tarif kostet 29 Euro pro Monat. Das ist eine oeffentliche Produktinformation.',
          category: 'pricing',
          allowedUse: 'agent_facts',
          owner: 'tenant',
          reviewStatus: 'approved',
          verifiedAt: '2026-05-01T00:00:00.000Z',
          expiresAt: '2026-08-01T00:00:00.000Z',
          containsPii: false,
          risk: 'low',
        }],
      },
    });

    expect(result.dryRun).toBe(true);
    expect(result.prepared).toBe(1);
    expect(result.indexed).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.chunks).toBeGreaterThan(0);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('fails closed for own KB sources without approval metadata', async () => {
    const result = await backfillOwnKnowledgeBaseFromAgentConfig({
      orgId: '00000000-0000-0000-0000-000000000001',
      tenantId: 'tenant_1',
      includeCanonicalBusinessFacts: false,
      dryRun: true,
      now: '2026-05-28T00:00:00.000Z',
      config: {
        knowledgeSources: [{
          id: 'faq_1',
          type: 'text',
          name: 'Unsichere FAQ',
          content: 'Diese Quelle hat noch keine Review-Metadaten.',
        }],
      },
    });

    expect(result.indexed).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.results[0]?.rejectionReason).toBe('SOURCE_REVIEW_REQUIRED');
  });
});
