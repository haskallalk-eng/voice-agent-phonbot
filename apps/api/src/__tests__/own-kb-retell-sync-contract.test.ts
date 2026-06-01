import { describe, expect, it } from 'vitest';
import {
  RETELL_KB_SYNC_STATE_FIELDS,
  buildRetellKbSyncState,
  planRetellKbSync,
  retellKbSyncEligibility,
  type OwnKbSourceVersionForRetellSync,
} from '../own-kb-retell-sync-contract.js';

function source(overrides: Partial<OwnKbSourceVersionForRetellSync> = {}): OwnKbSourceVersionForRetellSync {
  return {
    org_id: 'org_1',
    tenant_id: 'tenant_1',
    agent_id: 'agent_1',
    own_source_id: 'src_1',
    source_version_id: 'ver_1',
    source_version_hash: 'hash_1',
    status: 'approved',
    current: true,
    approved: true,
    expires_at: '2026-06-29T00:00:00.000Z',
    risk: 'low',
    allowed_use: 'voice_factual_answer',
    retell_auto_refresh_enabled: false,
    retell_auto_crawl_enabled: false,
    retell_refresh_verified_by_own_kb: false,
    ...overrides,
  };
}

describe('Own-KB to Retell-KB sync contract', () => {
  it('tracks every required Retell sync metadata field', () => {
    expect(RETELL_KB_SYNC_STATE_FIELDS).toEqual([
      'org_id',
      'tenant_id',
      'agent_id',
      'own_source_id',
      'source_version_id',
      'source_version_hash',
      'retell_knowledge_base_id',
      'retell_source_id',
      'retell_auto_refresh_enabled',
      'retell_auto_crawl_enabled',
      'synced_at',
      'expires_at',
      'risk',
      'allowed_use',
      'sync_status',
      'last_sync_error',
    ]);

    const state = buildRetellKbSyncState({
      source: source(),
      retell_knowledge_base_id: 'kb_1',
      retell_source_id: 'retell_src_1',
      synced_at: '2026-05-29T00:00:00.000Z',
    });
    for (const field of RETELL_KB_SYNC_STATE_FIELDS) {
      expect(state).toHaveProperty(field);
    }
  });

  it('plans deterministic create/update work only for approved current source versions', () => {
    const decision = planRetellKbSync({
      source: source(),
      actor: 'worker',
      now: '2026-05-29T00:00:00.000Z',
      retell_knowledge_base_id: 'kb_1',
      retell_source_id: 'retell_src_1',
    });

    expect(decision.eligible).toBe(true);
    expect(decision.blockers).toEqual([]);
    expect(decision.action).toBe('create_or_update_retell_content');
    expect(decision.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(decision.nextState).toMatchObject({
      org_id: 'org_1',
      tenant_id: 'tenant_1',
      agent_id: 'agent_1',
      own_source_id: 'src_1',
      source_version_id: 'ver_1',
      source_version_hash: 'hash_1',
      retell_knowledge_base_id: 'kb_1',
      retell_source_id: 'retell_src_1',
      retell_auto_refresh_enabled: false,
      retell_auto_crawl_enabled: false,
      sync_status: 'active',
      last_sync_error: null,
    });
    expect(decision.auditEvent.type).toBe('retell_kb_sync_create_or_update_planned');
    expect(decision.auditEvent).toMatchObject({
      org_id: 'org_1',
      tenant_id: 'tenant_1',
      agent_id: 'agent_1',
    });
  });

  it('blocks sync decisions when existing Retell sync state belongs to a different scope', () => {
    const existing = buildRetellKbSyncState({
      source: source({ org_id: 'org_old', tenant_id: 'tenant_old', agent_id: 'agent_old' }),
      retell_knowledge_base_id: 'kb_1',
      retell_source_id: 'retell_src_1',
      synced_at: '2026-05-28T00:00:00.000Z',
    });
    const decision = planRetellKbSync({
      source: source(),
      existingState: existing,
      actor: 'worker',
      now: '2026-05-29T00:00:00.000Z',
      retell_knowledge_base_id: 'kb_1',
      retell_source_id: 'retell_src_1',
    });

    expect(decision.eligible).toBe(false);
    expect(decision.action).toBe('noop');
    expect(decision.blockers).toContain('SYNC_SCOPE_MISMATCH');
    expect(decision.idempotencyKey).toBeNull();
    expect(decision.nextState).toBeNull();
  });

  it('blocks active create/update work without a concrete Retell KB ID', () => {
    const decision = planRetellKbSync({
      source: source(),
      actor: 'worker',
      now: '2026-05-29T00:00:00.000Z',
    });

    expect(decision.eligible).toBe(false);
    expect(decision.action).toBe('noop');
    expect(decision.blockers).toContain('MISSING_RETELL_KB_ID');
    expect(decision.idempotencyKey).toBeNull();
    expect(decision.nextState).toBeNull();
    expect(decision.auditEvent.retell_knowledge_base_id).toBeUndefined();
  });

  it('may reuse an existing scoped Retell KB ID for source-version updates', () => {
    const existing = buildRetellKbSyncState({
      source: source({ source_version_hash: 'hash_old' }),
      retell_knowledge_base_id: 'kb_1',
      retell_source_id: 'retell_src_1',
      synced_at: '2026-05-28T00:00:00.000Z',
    });
    const decision = planRetellKbSync({
      source: source({ source_version_hash: 'hash_new' }),
      existingState: existing,
      actor: 'worker',
      now: '2026-05-29T00:00:00.000Z',
    });

    expect(decision.eligible).toBe(true);
    expect(decision.nextState?.retell_knowledge_base_id).toBe('kb_1');
  });

  it('blocks newly syncing unapproved, expired, malformed, unsafe, or disallowed source versions', () => {
    const cases: Array<[Partial<OwnKbSourceVersionForRetellSync>, string]> = [
      [{ approved: false, status: 'pending' }, 'SOURCE_NOT_APPROVED_CURRENT'],
      [{ expires_at: '2026-01-01T00:00:00.000Z' }, 'SOURCE_EXPIRED'],
      [{ expires_at: null }, 'MISSING_EXPIRES_AT'],
      [{ expires_at: 'not-a-date' }, 'EXPIRES_AT_INVALID'],
      [{ status: 'unsafe', unsafe: true }, 'SOURCE_UNSAFE'],
      [{ allowed_use: 'internal_only' }, 'SOURCE_ALLOWED_USE_DISALLOWED'],
    ];

    for (const [overrides, blocker] of cases) {
      const eligibility = retellKbSyncEligibility(source(overrides), { now: '2026-05-29T00:00:00.000Z' });
      const decision = planRetellKbSync({
        source: source(overrides),
        actor: 'worker',
        now: '2026-05-29T00:00:00.000Z',
        retell_knowledge_base_id: 'kb_1',
      });

      expect(eligibility.eligible).toBe(false);
      expect(eligibility.blockers).toContain(blocker);
      expect(decision.action).toBe('noop');
      expect(decision.nextState).toBeNull();
    }
  });

  it('deterministically disables or removes existing Retell content when source governance changes', () => {
    const existing = buildRetellKbSyncState({
      source: source(),
      retell_knowledge_base_id: 'kb_1',
      retell_source_id: 'retell_src_1',
      synced_at: '2026-05-28T00:00:00.000Z',
    });
    const expired = planRetellKbSync({
      source: source({ expires_at: '2026-01-01T00:00:00.000Z' }),
      existingState: existing,
      actor: 'worker',
      now: '2026-05-29T00:00:00.000Z',
    });
    const rejected = planRetellKbSync({
      source: source({ status: 'rejected', approved: false }),
      existingState: existing,
      actor: 'worker',
      now: '2026-05-29T00:00:00.000Z',
    });

    expect(expired.action).toBe('disable_retell_content');
    expect(expired.nextState?.sync_status).toBe('disabled');
    expect(expired.blockers).toContain('SOURCE_EXPIRED');
    expect(rejected.action).toBe('remove_retell_content');
    expect(rejected.nextState?.sync_status).toBe('removed');
    expect(rejected.blockers).toContain('SOURCE_REJECTED');
  });

  it('blocks Retell auto-refresh and auto-crawl unless refreshed content is verified by Own-KB', () => {
    const unverified = planRetellKbSync({
      source: source({
        retell_auto_refresh_enabled: true,
        retell_auto_crawl_enabled: true,
        retell_refresh_verified_by_own_kb: false,
      }),
      actor: 'worker',
      now: '2026-05-29T00:00:00.000Z',
      retell_knowledge_base_id: 'kb_1',
    });
    const verified = planRetellKbSync({
      source: source({
        retell_auto_refresh_enabled: true,
        retell_auto_crawl_enabled: true,
        retell_refresh_verified_by_own_kb: true,
      }),
      actor: 'worker',
      now: '2026-05-29T00:00:00.000Z',
      retell_knowledge_base_id: 'kb_1',
    });

    expect(unverified.eligible).toBe(false);
    expect(unverified.blockers).toContain('RETELL_AUTO_REFRESH_UNVERIFIED');
    expect(unverified.blockers).toContain('RETELL_AUTO_CRAWL_UNVERIFIED');
    expect(verified.eligible).toBe(true);
    expect(verified.nextState).toMatchObject({
      retell_auto_refresh_enabled: true,
      retell_auto_crawl_enabled: true,
    });
  });

  it('never lets the model decide sync, refresh, crawl, disable, or delete work', () => {
    const decision = planRetellKbSync({
      source: source(),
      actor: 'model',
      now: '2026-05-29T00:00:00.000Z',
      retell_knowledge_base_id: 'kb_1',
    });

    expect(decision.eligible).toBe(false);
    expect(decision.action).toBe('noop');
    expect(decision.blockers[0]).toBe('MODEL_MUST_NOT_CONTROL_SYNC');
    expect(decision.idempotencyKey).toBeNull();
    expect(decision.nextState).toBeNull();
  });

  it('plans update work when source version hash changes', () => {
    const existing = buildRetellKbSyncState({
      source: source({ source_version_hash: 'hash_old' }),
      retell_knowledge_base_id: 'kb_1',
      retell_source_id: 'retell_src_1',
      synced_at: '2026-05-28T00:00:00.000Z',
    });
    const decision = planRetellKbSync({
      source: source({ source_version_hash: 'hash_new' }),
      existingState: existing,
      actor: 'worker',
      now: '2026-05-29T00:00:00.000Z',
    });

    expect(decision.action).toBe('create_or_update_retell_content');
    expect(decision.nextState).toMatchObject({
      source_version_hash: 'hash_new',
      sync_status: 'active',
    });
  });
});
