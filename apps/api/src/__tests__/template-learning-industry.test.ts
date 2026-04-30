/**
 * processTemplateLearning(industry) tests — Audit-Round-14.
 *
 * After Round-12, `agent_configs.data->>'industry'` is the single clustering
 * key for cross-org learning. Round-12 removed the dead `data->>'templateId'`
 * fallback; this test pins down two invariants:
 *   1. without industry → early-return (no peer-orgs query)
 *   2. with industry    → peer-orgs query uses the industry as $1
 *
 * Mock-pool pattern (matches usage.test.ts).
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// share_patterns consent gate must pass for the function to proceed.
const consentRow = { rows: [{ share_patterns: true }], rowCount: 1 };

// Codex Round-14 review D2: stubEnv leaks into later test files in the same
// vitest-run if not unstubbed. afterAll restores the original value.
vi.stubEnv('OPENAI_API_KEY', 'test-key');

const { processTemplateLearning } = await import('../template-learning.js');

describe('processTemplateLearning: industry clustering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('early-returns when industry is null on the agent_configs row', async () => {
    mockQuery
      .mockResolvedValueOnce(consentRow)
      // SELECT data->>'industry' AS industry FROM agent_configs
      .mockResolvedValueOnce({ rows: [{ industry: null }], rowCount: 1 });

    await processTemplateLearning('org-1', 'call-1', {
      score: 5,
      bad_moments: [{ category: 'pricing' }],
    });

    // Two queries total: consent + industry-lookup. NO peer-orgs SELECT.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const queries = mockQuery.mock.calls.map((c) => c[0] as string);
    expect(queries.some((q) => q.includes('FROM call_transcripts'))).toBe(false);
  });

  it('passes industry as $1 to the peer-orgs query when set', async () => {
    mockQuery
      .mockResolvedValueOnce(consentRow)
      .mockResolvedValueOnce({ rows: [{ industry: 'hairdresser' }], rowCount: 1 })
      // SELECT DISTINCT org_id FROM call_transcripts WHERE industry = $1
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await processTemplateLearning('org-1', 'call-1', {
      score: 5,
      bad_moments: [{ category: 'pricing' }],
    });

    const peerCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('FROM call_transcripts'),
    );
    expect(peerCall).toBeDefined();
    const params = peerCall![1] as unknown[];
    expect(params[0]).toBe('hairdresser');
    expect(params[1]).toBe('org-1');
  });

  it('honours the share_patterns consent gate (no industry-lookup if opt-out)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ share_patterns: false }],
      rowCount: 1,
    });

    await processTemplateLearning('org-1', 'call-1', {
      score: 5,
      bad_moments: [{ category: 'pricing' }],
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
