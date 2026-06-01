import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  knowledgeSearch: vi.fn(),
}));

vi.mock('../db.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
}));

vi.mock('../own-kb.js', () => ({
  knowledgeSearch: mocks.knowledgeSearch,
}));

const {
  extractShadowQuestionsFromTranscript,
  runOwnKbShadowFromTranscripts,
} = await import('../own-kb-shadow.js');

describe('own KB shadow runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts redacted customer questions and skips agent or PII-heavy lines', () => {
    const questions = extractShadowQuestionsFromTranscript([
      'Agent: Welche Leistung suchen Sie?',
      'Kunde: Was kostet der Starter Tarif?',
      'Kunde: Kannst du mich unter 0176 12345678 zurueckrufen?',
      'Kunde: Wie sind eure Oeffnungszeiten?',
    ].join('\n'), 5);

    expect(questions.map((item) => item.query)).toEqual([
      'Was kostet der Starter Tarif?',
      'Wie sind eure Oeffnungszeiten?',
    ]);
  });

  it('stores a shadow run with redacted queries and citation summaries only', async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('from agent_configs')) {
        return {
          rows: [{ agent_id: 'agent_1' }],
        };
      }
      if (sql.includes('from call_transcripts')) {
        return {
          rows: [{
            call_id: 'call_1',
            agent_id: 'agent_1',
            transcript: [
              'Agent: Welche Leistung suchen Sie?',
              'Kunde: Was kostet der Starter Tarif?',
              'Kunde: Bitte schreibe an test@example.com',
            ].join('\n'),
          }],
        };
      }
      if (sql.includes('insert into kb_shadow_runs')) {
        return { rows: [{ id: 'run_1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    mocks.knowledgeSearch.mockResolvedValue({
      answerable: true,
      confidence: 0.812,
      latencyMs: 123,
      snippets: [{
        chunkId: 'chunk_1',
        sourceId: 'source_1',
        sourceVersionId: 'version_1',
        rank: 1,
        text: 'Starter Tarif kostet 29 Euro.',
        category: 'pricing',
        allowedUse: 'voice_agent',
        verifiedAt: '2026-05-28T00:00:00.000Z',
        expiresAt: '2026-08-28T00:00:00.000Z',
        risk: 'low',
        score: 0.12,
      }],
      policy: {
        mayAnswer: true,
        mayMutate: false,
        reason: 'APPROVED_CURRENT_FACTUAL_CONTEXT',
      },
    });

    const result = await runOwnKbShadowFromTranscripts({
      orgId: '00000000-0000-0000-0000-000000000001',
      tenantId: 'tenant_1',
      agentId: 'agent_1',
      name: 'shadow-test',
      limit: 5,
      sinceHours: 24,
    });

    expect(result).toMatchObject({
      runId: 'run_1',
      total: 1,
      answerable: 1,
      errors: 0,
      p95LatencyMs: 123,
    });
    expect(mocks.knowledgeSearch).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'own_kb_shadow',
      trustedScope: expect.objectContaining({
        orgId: '00000000-0000-0000-0000-000000000001',
        tenantId: 'tenant_1',
        agentId: 'agent_1',
        callId: 'call_1',
      }),
      query: 'Was kostet der Starter Tarif?',
    }));

    const serializedWrites = JSON.stringify(mocks.poolQuery.mock.calls);
    expect(serializedWrites).toContain('insert into kb_shadow_results');
    expect(serializedWrites).toContain('Was kostet der Starter Tarif?');
    expect(serializedWrites).not.toContain('test@example.com');
    expect(serializedWrites).not.toContain('Starter Tarif kostet 29 Euro.');
  });
});
