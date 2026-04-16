/**
 * Smoke tests for session-store.ts — validates cross-tenant collision
 * protection (D1) and tenant-isolation in read/clear paths.
 *
 * Uses in-memory fallback (no Redis mock needed — session-store auto-falls
 * back when redis is null).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub redis as null so session-store uses in-memory Map
vi.mock('../redis.js', () => ({ redis: null }));

const { pushMessage, getMessages, clearSession } = await import('../session-store.js');

describe('session-store tenant isolation (D1)', () => {
  const SESSION = 'test-session-' + Date.now();
  const ORG_A = 'org-aaa';
  const ORG_B = 'org-bbb';

  beforeEach(() => {
    // Clear any stale sessions from prior tests by using unique IDs
  });

  it('creates a session on first pushMessage', async () => {
    const sid = SESSION + '-create';
    await pushMessage(sid, ORG_A, { role: 'user', content: 'hello' });
    const msgs = await getMessages(sid, ORG_A);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe('hello');
  });

  it('returns empty for a different tenantId (cross-tenant read blocked)', async () => {
    const sid = SESSION + '-xread';
    await pushMessage(sid, ORG_A, { role: 'user', content: 'secret' });
    const msgs = await getMessages(sid, ORG_B);
    expect(msgs).toHaveLength(0);
  });

  it('throws SESSION_ID_COLLISION when org B tries to write to org A session', async () => {
    const sid = SESSION + '-collision';
    // Org A creates the session
    await pushMessage(sid, ORG_A, { role: 'user', content: 'org-a-msg' });
    // Org B attempts to write → should throw
    await expect(
      pushMessage(sid, ORG_B, { role: 'user', content: 'org-b-intrusion' }),
    ).rejects.toThrow('SESSION_ID_COLLISION');
  });

  it('clearSession is a no-op for wrong tenant', async () => {
    const sid = SESSION + '-clear';
    await pushMessage(sid, ORG_A, { role: 'user', content: 'keep me' });
    // Org B tries to clear org A's session
    await clearSession(sid, ORG_B);
    // Org A's session should still be intact
    const msgs = await getMessages(sid, ORG_A);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe('keep me');
  });

  it('clearSession works for the owning tenant', async () => {
    const sid = SESSION + '-ownerclear';
    await pushMessage(sid, ORG_A, { role: 'user', content: 'goodbye' });
    await clearSession(sid, ORG_A);
    const msgs = await getMessages(sid, ORG_A);
    expect(msgs).toHaveLength(0);
  });

  it('multiple messages accumulate correctly', async () => {
    const sid = SESSION + '-multi';
    await pushMessage(sid, ORG_A, { role: 'user', content: 'one' });
    await pushMessage(sid, ORG_A, { role: 'assistant', content: 'two' });
    await pushMessage(sid, ORG_A, { role: 'user', content: 'three' });
    const msgs = await getMessages(sid, ORG_A);
    expect(msgs).toHaveLength(3);
    expect(msgs.map((m: { content: string }) => m.content)).toEqual(['one', 'two', 'three']);
  });
});
