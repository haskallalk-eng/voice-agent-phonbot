import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ count: 0, key: '', fail: false, reply: undefined as unknown, open: true }));
vi.mock('../redis.js', () => ({ redis: {
  get isOpen() { return state.open; },
  get isReady() { return state.open; },
  multi: () => {
    const transaction = {
      incr(key: string) { state.key = key; return transaction; },
      expire: vi.fn().mockReturnThis(),
      async exec() {
        if (state.fail) throw new Error('offline');
        return state.reply ?? [++state.count, true];
      },
    };
    return transaction;
  },
} }));
import { reservePublicCallback } from '../public-callback-budget.js';
beforeEach(() => {
  Object.assign(state, { count: 0, key: '', fail: false, reply: undefined, open: true });
  vi.stubEnv('DEMO_GLOBAL_HOURLY_CAP', '3');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('public callback budget', () => {
  it('admits exactly the configured number of concurrent reservations', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => reservePublicCallback()));
    expect(results.filter(result => result.ok)).toHaveLength(3);
    expect(results.filter(result => !result.ok)).toEqual(Array(17).fill({ ok: false, reason: 'limit' }));
  });
  it('uses the existing shared key and changes its bucket on the UTC-hour boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T10:59:59Z'));
    await reservePublicCallback();
    expect(state.key).toBe('demo:global:callback:2026-10-26T10');
    vi.setSystemTime(new Date('2026-10-26T11:00:00Z'));
    await reservePublicCallback();
    expect(state.key).toBe('demo:global:callback:2026-10-26T11');
  });
  it.each(['0', '-1', 'NaN', '2.5', 'Infinity', '9007199254740992'])('rejects invalid configuration %s', async cap => {
    vi.stubEnv('DEMO_GLOBAL_HOURLY_CAP', cap);
    expect(await reservePublicCallback()).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('blocks when Redis is disconnected, throws, or returns an invalid counter', async () => {
    state.open = false;
    expect(await reservePublicCallback()).toEqual({ ok: false, reason: 'unavailable' });
    state.open = true; state.fail = true;
    expect(await reservePublicCallback()).toEqual({ ok: false, reason: 'unavailable' });
    state.fail = false; state.reply = ['not-a-counter'];
    expect(await reservePublicCallback()).toEqual({ ok: false, reason: 'unavailable' });
  });
});
