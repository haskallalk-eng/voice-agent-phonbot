import { describe, expect, it } from 'vitest';
import { sanitizeToolOutputForModel } from '../agent-runtime.js';

describe('agent runtime knowledge tool output', () => {
  it('keeps redacted snippets and policy visible to the model', () => {
    const result = sanitizeToolOutputForModel({
      ok: true,
      status: 'answerable',
      confidence: 0.82,
      latencyMs: 180,
      policy: { mayAnswer: true, mayMutate: false, reason: 'APPROVED_CURRENT_FACTUAL_CONTEXT' },
      snippets: [{
        rank: 1,
        text: 'Der Starter kostet 29 Euro. Kontakt test@example.com oder +49 151 12345678.',
        category: 'pricing',
        allowedUse: 'agent_facts',
        verifiedAt: '2026-05-01T00:00:00.000Z',
        expiresAt: '2026-08-01T00:00:00.000Z',
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'answerable',
      confidence: 0.82,
      latencyMs: 180,
      policy: {
        mayAnswer: true,
        mayMutate: false,
        reason: 'APPROVED_CURRENT_FACTUAL_CONTEXT',
      },
    });
    const snippets = result.snippets as Array<{ text?: string }>;
    expect(snippets).toHaveLength(1);
    expect(snippets[0]?.text).toContain('29 Euro');
    expect(snippets[0]?.text).toContain('[EMAIL]');
    expect(snippets[0]?.text).toContain('[PHONE]');
    expect(snippets[0]?.text).not.toContain('test@example.com');
  });
});
