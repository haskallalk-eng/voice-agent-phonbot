/**
 * Tests for the idempotency marker strip used in /admin/learnings/decide
 * (admin.ts). Each applied learning lands in the global demo epilogue wrapped
 * in `<!-- learning:KIND:UUID -->` markers; re-applying or correcting the same
 * learning must replace the prior block in-place, not double-append.
 *
 * The regex lives inline in the handler. We re-derive it here so any future
 * change to the live code requires updating these tests, which is the point.
 */
import { describe, it, expect } from 'vitest';

// Re-derived from admin.ts decide-handler. If the live regex changes, copy
// it here and re-run the tests — they encode the contract.
function stripMarker(current: string, sourceKind: string, sourceId: string): string {
  const marker = `<!-- learning:${sourceKind}:${sourceId} -->`;
  const escapedMarker = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return current.replace(
    new RegExp(`\\n*${escapedMarker}[\\s\\S]*?(?=\\n*<!-- learning:|$)`, 'g'),
    '',
  );
}

describe('learning-marker strip-and-replace idempotency', () => {
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';

  it('strips a single block at end of string', () => {
    const text = `Original epilogue content.\n\n<!-- learning:prompt_suggestion:${A} -->\nNew rule for orgs.`;
    const stripped = stripMarker(text, 'prompt_suggestion', A);
    expect(stripped).toBe('Original epilogue content.');
  });

  it('strips a block in the middle, preserving siblings on both sides', () => {
    const text =
      `Header text.` +
      `\n\n<!-- learning:prompt_suggestion:${A} -->\nFirst rule.` +
      `\n\n<!-- learning:template_learning:${B} -->\nSecond rule.`;
    const stripped = stripMarker(text, 'prompt_suggestion', A);
    expect(stripped).toContain('Header text.');
    expect(stripped).not.toContain(`learning:prompt_suggestion:${A}`);
    expect(stripped).toContain(`learning:template_learning:${B}`);
    expect(stripped).toContain('Second rule.');
  });

  it('strips first block, keeping later ones intact', () => {
    const text =
      `<!-- learning:prompt_suggestion:${A} -->\nFirst rule.` +
      `\n\n<!-- learning:template_learning:${B} -->\nSecond rule.`;
    const stripped = stripMarker(text, 'prompt_suggestion', A);
    expect(stripped).not.toContain(`learning:prompt_suggestion:${A}`);
    expect(stripped).toContain(`learning:template_learning:${B}`);
  });

  it('does not strip a block belonging to a different source', () => {
    const text = `<!-- learning:prompt_suggestion:${A} -->\nUnrelated rule.`;
    const stripped = stripMarker(text, 'prompt_suggestion', B);
    expect(stripped).toBe(text);
  });

  it('strips both markers when the same UUID appears with different kinds', () => {
    // Same UUID but different kind = different source — only the matching one strips.
    const text =
      `<!-- learning:prompt_suggestion:${A} -->\nFor org.` +
      `\n\n<!-- learning:template_learning:${A} -->\nSystemic.`;
    const stripped = stripMarker(text, 'prompt_suggestion', A);
    expect(stripped).not.toContain(`learning:prompt_suggestion:${A}`);
    expect(stripped).toContain(`learning:template_learning:${A}`);
  });

  it('handles two consecutive blocks for the same source (deduped)', () => {
    // Should only happen if the strip ever failed earlier — make sure we
    // recover cleanly when we encounter the legacy mess.
    const text =
      `<!-- learning:prompt_suggestion:${A} -->\nFirst copy.` +
      `\n\n<!-- learning:prompt_suggestion:${A} -->\nSecond copy.`;
    const stripped = stripMarker(text, 'prompt_suggestion', A);
    expect(stripped).not.toContain(`learning:prompt_suggestion:${A}`);
    expect(stripped.trim()).toBe('');
  });

  it('returns original string when no matching marker present', () => {
    const text = 'Just a plain epilogue without any learning markers.';
    expect(stripMarker(text, 'prompt_suggestion', A)).toBe(text);
  });

  it('strip + append produces a stable string after repeated applies', () => {
    const baseEpilogue = 'Default rules.';
    const marker = `<!-- learning:prompt_suggestion:${A} -->`;
    const block = `\n\n${marker}\nOriginal rule.`;

    // First apply: nothing to strip, just append.
    const after1 = stripMarker(baseEpilogue, 'prompt_suggestion', A) + block;
    expect(after1).toBe(`${baseEpilogue}${block}`);

    // Second apply (same source): strip first, then append. Length stable.
    const updatedBlock = `\n\n${marker}\nUpdated rule.`;
    const after2 = stripMarker(after1, 'prompt_suggestion', A) + updatedBlock;
    expect(after2).toBe(`${baseEpilogue}${updatedBlock}`);
    // Crucially: the previous "Original rule." text is gone.
    expect(after2).not.toContain('Original rule.');
  });
});

describe('correctedText marker-smuggling defense', () => {
  // Mirrors the Zod-Refine in admin.ts decide-handler.
  const markerSmugglingPattern = /<!--\s*learning:/i;

  it('rejects a literal marker prefix', () => {
    expect(markerSmugglingPattern.test('<!-- learning:prompt_suggestion:fake -->')).toBe(true);
  });

  it('rejects with extra whitespace', () => {
    expect(markerSmugglingPattern.test('<!--    learning:foo')).toBe(true);
  });

  it('rejects mixed-case attempt', () => {
    expect(markerSmugglingPattern.test('<!-- LEARNING:bar -->')).toBe(true);
  });

  it('accepts legitimate text that mentions "learning" without the marker syntax', () => {
    expect(markerSmugglingPattern.test('Adjust the agent\'s active-learning setting to be more conservative.')).toBe(false);
  });

  it('accepts an HTML comment that does NOT carry the learning prefix', () => {
    expect(markerSmugglingPattern.test('<!-- this is a regular comment -->')).toBe(false);
  });
});
