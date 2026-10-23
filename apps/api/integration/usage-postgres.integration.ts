import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg, { type Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { USAGE_LEDGER_SCHEMA_SQL } from '../src/usage-schema.js';

// Only the DB boundary and external services are substituted. Transactions,
// migration SQL, usage calculations and invoice outbox writes are real.
const { connect, query } = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
vi.mock('../src/db.js', () => ({ pool: { connect, query } }));
vi.mock('../src/billing.js', () => ({ PLANS: {
  starter: { id: 'starter', overchargePerMinute: 0.05 }, free: { id: 'free', overchargePerMinute: 0 },
} }));
vi.mock('../src/redis.js', () => ({ redis: null }));
const { tryReserveMinutes, reconcileMinutes, releaseMinutesReservation, bindMinutesReservation, BLOCKED_PLAN_STATUSES } = await import('../src/usage.js');
const orgId = '00000000-0000-4000-8000-000000000001';
const otherOrgId = '00000000-0000-4000-8000-000000000002';
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

describe('usage ledger on PostgreSQL', () => {
  const schema = `usage_test_${randomUUID().replaceAll('-', '')}`;
  let control: Client;
  let first: Client;
  let second: Client;
  let secondPid: number;
  let connections: Client[] = [];
  let schemaCreated = false;
  let blockCommit: { client: Client; reached: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>; rollback?: boolean } | undefined;
  let failInvoiceWrite = false;
  const clients: Client[] = [];
  let pending: Promise<unknown>[] = [];

  beforeAll(async () => {
    // Never load .env, DATABASE_URL, db.ts or PG* environment defaults.
    if (process.env.USAGE_TEST_DATABASE !== 'phonbot_usage_test' || !process.env.USAGE_TEST_DATABASE_PASSWORD) {
      throw new Error('Use a disposable local phonbot_usage_test database and set USAGE_TEST_DATABASE and USAGE_TEST_DATABASE_PASSWORD explicitly.');
    }
    const portText = process.env.USAGE_TEST_DATABASE_PORT ?? '5432';
    const port = Number(portText);
    if (!/^\d+$/.test(portText) || port < 1 || port > 65535) throw new Error('USAGE_TEST_DATABASE_PORT must be a valid local port.');
    const config = {
      host: '127.0.0.1', port, user: 'phonbot_usage_test', database: 'phonbot_usage_test',
      password: process.env.USAGE_TEST_DATABASE_PASSWORD, ssl: false,
      connectionTimeoutMillis: 2_000, statement_timeout: 5_000, application_name: schema,
    };
    control = new pg.Client(config); first = new pg.Client(config); second = new pg.Client(config);
    clients.push(control, first, second);
    await Promise.all(clients.map((client) => client.connect()));
    await control.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    for (const client of clients) await client.query(`SET search_path TO "${schema}"`);
    await control.query(`CREATE TABLE orgs (
      id uuid PRIMARY KEY, name text NOT NULL DEFAULT 'Synthetic test',
      minutes_used numeric NOT NULL DEFAULT 0, minutes_limit numeric NOT NULL,
      plan text NOT NULL, plan_status text NOT NULL
    )`);
    // Execute the actual additive migration, then the db-init copy (idempotence).
    const migration = readFileSync(new URL('../../../supabase/migrations/20261023073000_usage_reservation_ledger.sql', import.meta.url), 'utf8');
    expect(migration.trim()).toBe(USAGE_LEDGER_SCHEMA_SQL.trim());
    await control.query(migration);
    expect((await control.query('SELECT activated_at FROM usage_ledger_state')).rows[0].activated_at).toBeNull();
    await control.query(USAGE_LEDGER_SCHEMA_SQL);
    await control.query(`CREATE TABLE failed_invoice_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL,
      kind text NOT NULL, amount_cents integer NOT NULL, currency text,
      description text, idempotency_key text NOT NULL UNIQUE, metadata jsonb,
      retry_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await control.query('CREATE TABLE agent_configs (org_id uuid NOT NULL, data jsonb NOT NULL)');
    const [a, b] = await Promise.all([first.query('SELECT pg_backend_pid() AS pid'), second.query('SELECT pg_backend_pid() AS pid')]);
    secondPid = Number(b.rows[0].pid);
    expect(Number(a.rows[0].pid)).not.toBe(secondPid);
  });

  beforeEach(async () => {
    connections = []; pending = []; blockCommit = undefined; failInvoiceWrite = false;
    connect.mockReset(); query.mockReset();
    connect.mockImplementation(async () => {
      const client = connections.shift();
      if (!client) throw new Error('Assign an explicit real connection to every usage operation.');
      return {
        query: async (sql: string, values?: unknown[]) => {
          if (sql === 'COMMIT' && blockCommit?.client === client) {
            const hold = blockCommit;
            hold.reached.resolve(); await hold.release.promise;
            if (hold.rollback) throw new Error('synthetic commit failure');
          }
          if (failInvoiceWrite && sql.includes('INSERT INTO failed_invoice_items')) throw new Error('synthetic outbox failure');
          return client.query(sql, values);
        },
        release() {}, // suite owns these checked-out clients until afterAll
      };
    });
    query.mockImplementation((sql: string, values: unknown[]) => control.query(sql, values));
    await control.query('TRUNCATE usage_settlements, usage_reservations, failed_invoice_items, agent_configs, orgs');
    await control.query("UPDATE usage_ledger_state SET activated_at = '2000-01-01T00:00:00Z'");
  });
  afterEach(async () => {
    blockCommit?.release.resolve();
    await Promise.allSettled(pending);
    await Promise.allSettled([first?.query('ROLLBACK'), second?.query('ROLLBACK')]);
  });
  afterAll(async () => {
    try { if (schemaCreated) await control.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await Promise.allSettled(clients.map((client) => client.end())); }
  });

  function using<T>(client: Client, run: () => Promise<T>): Promise<T> {
    connections.push(client);
    const result = run(); pending.push(result); void result.catch(() => {}); return result;
  }
  function reserve(client: Client, id = orgId, minutes = 5) { return using(client, () => tryReserveMinutes(id, minutes)); }
  function settle(client: Client, actual: number, callId: string, reservationId?: string, startedAt?: number) {
    return using(client, () => reconcileMinutes(orgId, actual, { callId, reservationId, startedAt }));
  }
  async function seed(plan = 'free', status = 'active', used = 0, limit = 5, id = orgId) {
    await control.query('INSERT INTO orgs (id, minutes_used, minutes_limit, plan, plan_status) VALUES ($1, $2, $3, $4, $5)', [id, used, limit, plan, status]);
  }
  async function state() {
    const { rows } = await control.query('SELECT minutes_used, minutes_reserved FROM orgs WHERE id = $1', [orgId]);
    return { used: Number(rows[0].minutes_used), held: Number(rows[0].minutes_reserved) };
  }
  async function invoices() {
    const { rows } = await control.query("SELECT metadata->>'overageMinutes' AS minutes, amount_cents FROM failed_invoice_items WHERE kind = 'overage' ORDER BY idempotency_key");
    return rows.map((row) => ({ minutes: Number(row.minutes), cents: row.amount_cents }));
  }
  async function waitForLock() {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const { rows } = await control.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [secondPid]);
      if (rows[0]?.wait_event_type === 'Lock') return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Second PostgreSQL connection did not contend for the row lock.');
  }
  function holdFirstCommit(rollback = false) {
    blockCommit = { client: first, reached: deferred(), release: deferred(), rollback };
    return blockCommit;
  }

  it('allows one free-plan hold when two real connections contend for the final five minutes', async () => {
    await seed(); const hold = holdFirstCommit();
    const a = reserve(first); await hold.reached.promise;
    const b = reserve(second); await waitForLock(); hold.release.resolve();
    expect(await a).toMatchObject({ allowed: true, minutesUsed: 5, minutesLimit: 5 });
    expect(await b).toEqual({ allowed: false, minutesUsed: 5, minutesLimit: 5 });
    expect(await state()).toEqual({ used: 0, held: 5 });
  });
  it('makes rolled-back hold capacity available to the waiting caller', async () => {
    await seed(); const hold = holdFirstCommit(true);
    const a = reserve(first); await hold.reached.promise;
    const b = reserve(second); await waitForLock(); hold.release.resolve();
    await expect(a).rejects.toThrow('synthetic commit failure');
    expect(await b).toMatchObject({ allowed: true, minutesUsed: 5 });
    expect(await state()).toEqual({ used: 0, held: 5 });
  });
  it('permits paid holds across the soft cap without counting them as consumed or invoicing them', async () => {
    await seed('starter'); const hold = holdFirstCommit();
    const a = reserve(first); await hold.reached.promise;
    const b = reserve(second); await waitForLock(); hold.release.resolve();
    expect((await a).allowed).toBe(true); expect((await b).allowed).toBe(true);
    expect(await state()).toEqual({ used: 0, held: 10 }); expect(await invoices()).toEqual([]);
  });
  it.each(BLOCKED_PLAN_STATUSES)('denies holds for subscription status %s', async (status) => {
    await seed('starter', status);
    expect(await reserve(first)).toEqual({ allowed: false, minutesUsed: 0, minutesLimit: 5 });
    expect(await state()).toEqual({ used: 0, held: 0 });
  });
  it('denies unknown organizations', async () => {
    expect(await reserve(first)).toEqual({ allowed: false, minutesUsed: 0, minutesLimit: 0 });
  });
  it.each([2, 5, 8])('queues exactly %s actual overage minutes, regardless of the five-minute hold', async (actual) => {
    await seed('starter', 'active', 100, 100);
    const reservation = await reserve(first);
    await settle(first, actual, 'call-actual', reservation.reservationId);
    expect(await state()).toEqual({ used: 100 + actual, held: 0 });
    expect(await invoices()).toEqual([{ minutes: actual, cents: actual * 5 }]);
  });
  it('queues only the consumed minutes beyond the quota boundary', async () => {
    await seed('starter', 'active', 98, 100);
    const reservation = await reserve(first);
    await settle(first, 5, 'call-crossing', reservation.reservationId);
    expect(await state()).toEqual({ used: 103, held: 0 });
    expect(await invoices()).toEqual([{ minutes: 3, cents: 15 }]);
  });
  it('handles NUMERIC string values and fractional minutes without concatenation', async () => {
    await seed('starter', 'active', 99.75, 100);
    const reservation = await reserve(first);
    await settle(first, 1.25, 'fractional', reservation.reservationId);
    expect(await state()).toEqual({ used: 101, held: 0 });
    expect(await invoices()).toEqual([{ minutes: 1, cents: 5 }]);
  });
  it('releases a zero-duration call without adding consumed usage or an invoice', async () => {
    await seed('starter', 'active', 100, 100);
    const reservation = await reserve(first);
    await settle(first, 0, 'zero-duration', reservation.reservationId);
    expect(await state()).toEqual({ used: 100, held: 0 }); expect(await invoices()).toEqual([]);
  });
  it('queues premium voice consumption atomically and only for the matching org agent', async () => {
    await seed('starter', 'active', 0, 100);
    const reservation = await reserve(first);
    await control.query('INSERT INTO agent_configs (org_id, data) VALUES ($1, $2)', [orgId, JSON.stringify({ retellAgentId: 'agent-test', voice: 'elevenlabs-test-voice' })]);
    await using(first, () => reconcileMinutes(orgId, 2, { callId: 'premium', reservationId: reservation.reservationId, agentId: 'agent-test' }));
    const { rows } = await control.query('SELECT kind, amount_cents, metadata FROM failed_invoice_items');
    expect(rows).toEqual([{ kind: 'premium_voice', amount_cents: 10, metadata: { orgId, premiumMinutes: '2', surcharge: '0.05' } }]);
    expect(await state()).toEqual({ used: 2, held: 0 });
  });
  it('does not charge a premium voice configuration from another org', async () => {
    await seed('starter', 'active', 0, 100);
    await control.query('INSERT INTO agent_configs (org_id, data) VALUES ($1, $2)', [otherOrgId, JSON.stringify({ retellAgentId: 'foreign-agent', voice: 'elevenlabs-test-voice' })]);
    await using(first, () => reconcileMinutes(orgId, 2, { callId: 'no-foreign-voice', agentId: 'foreign-agent', startedAt: Date.now() }));
    expect((await control.query('SELECT count(*) FROM failed_invoice_items')).rows[0].count).toBe('0');
  });
  it('does not let another open reservation turn below-limit consumption into an invoice', async () => {
    await seed('starter', 'active', 95, 100);
    const a = await reserve(first); const b = await reserve(second);
    await settle(first, 2, 'call-a', a.reservationId);
    expect(await state()).toEqual({ used: 97, held: 5 }); expect(await invoices()).toEqual([]);
    await settle(second, 2, 'call-b', b.reservationId);
    expect(await state()).toEqual({ used: 99, held: 0 }); expect(await invoices()).toEqual([]);
  });
  it('serializes simultaneous settlements and invoices the exact aggregate overage once', async () => {
    await seed('starter', 'active', 99, 100);
    const a = await reserve(first); const b = await reserve(second);
    const hold = holdFirstCommit();
    const doneA = settle(first, 2, 'call-a', a.reservationId); await hold.reached.promise;
    const doneB = settle(second, 5, 'call-b', b.reservationId); await waitForLock(); hold.release.resolve();
    await Promise.all([doneA, doneB]);
    expect(await state()).toEqual({ used: 106, held: 0 });
    expect(await invoices()).toEqual([{ minutes: 1, cents: 5 }, { minutes: 5, cents: 25 }]);
  });
  it('settles an unreserved inbound call using its full duration', async () => {
    await seed('starter', 'active', 100, 100);
    await settle(first, 2, 'inbound', undefined, Date.now());
    expect(await state()).toEqual({ used: 102, held: 0 });
    expect(await invoices()).toEqual([{ minutes: 2, cents: 10 }]);
  });
  it('settles duplicate calls only once, including concurrent duplicates', async () => {
    await seed('starter', 'active', 100, 100); const reservation = await reserve(first);
    const hold = holdFirstCommit();
    const a = settle(first, 5, 'duplicate', reservation.reservationId); await hold.reached.promise;
    const b = settle(second, 5, 'duplicate', reservation.reservationId); await waitForLock(); hold.release.resolve();
    await Promise.all([a, b]);
    expect(await state()).toEqual({ used: 105, held: 0 });
    expect(await invoices()).toEqual([{ minutes: 5, cents: 25 }]);
    expect(Number((await control.query('SELECT count(*) FROM usage_settlements')).rows[0].count)).toBe(1);
  });
  it('rejects a replay with a conflicting duration', async () => {
    await seed('starter', 'active', 100, 100); const reservation = await reserve(first);
    await settle(first, 5, 'conflict', reservation.reservationId);
    await expect(settle(first, 8, 'conflict', reservation.reservationId)).rejects.toThrow('USAGE_SETTLEMENT_CONFLICT');
    expect(await state()).toEqual({ used: 105, held: 0 }); expect((await invoices()).length).toBe(1);
  });
  it('rolls back usage, reservation release and settlement when invoice persistence fails', async () => {
    await seed('starter', 'active', 100, 100); const reservation = await reserve(first);
    failInvoiceWrite = true;
    await expect(settle(first, 5, 'retry', reservation.reservationId)).rejects.toThrow('synthetic outbox failure');
    expect(await state()).toEqual({ used: 100, held: 5 }); expect(await invoices()).toEqual([]);
    expect(Number((await control.query('SELECT count(*) FROM usage_settlements')).rows[0].count)).toBe(0);
    expect((await control.query('SELECT state FROM usage_reservations')).rows[0].state).toBe('held');
    failInvoiceWrite = false;
    await settle(first, 5, 'retry', reservation.reservationId);
    expect(await invoices()).toEqual([{ minutes: 5, cents: 25 }]);
  });
  it('releases a rejected call hold once without changing actual usage', async () => {
    await seed(); const reservation = await reserve(first);
    await using(first, () => releaseMinutesReservation(orgId, reservation.reservationId!));
    await using(second, () => releaseMinutesReservation(orgId, reservation.reservationId!));
    expect(await state()).toEqual({ used: 0, held: 0 }); expect(await invoices()).toEqual([]);
  });
  it('allows webhook-before-bind through its scoped reservation ID', async () => {
    await seed('starter', 'active', 100, 100); const reservation = await reserve(first);
    await settle(first, 2, 'early-webhook', reservation.reservationId);
    await using(second, () => bindMinutesReservation(orgId, reservation.reservationId!, 'early-webhook'));
    expect(await state()).toEqual({ used: 102, held: 0 }); expect(await invoices()).toEqual([{ minutes: 2, cents: 10 }]);
  });
  it('releases a late binding after an unreserved settlement without charging the call again', async () => {
    await seed('starter', 'active', 100, 100); const reservation = await reserve(first);
    await settle(first, 2, 'late-bind', undefined, Date.now());
    await using(second, () => bindMinutesReservation(orgId, reservation.reservationId!, 'late-bind'));
    await settle(first, 2, 'late-bind', reservation.reservationId);
    expect(await state()).toEqual({ used: 102, held: 0 }); expect((await invoices()).length).toBe(1);
  });
  it('rejects a reservation bound to another call', async () => {
    await seed(); const reservation = await reserve(first);
    await using(first, () => bindMinutesReservation(orgId, reservation.reservationId!, 'correct-call'));
    await expect(settle(second, 2, 'wrong-call', reservation.reservationId)).rejects.toThrow('USAGE_RESERVATION_CALL_MISMATCH');
    expect(await state()).toEqual({ used: 0, held: 5 });
  });
  it('rejects a reservation from another organization', async () => {
    await seed(); await seed('free', 'active', 0, 5, otherOrgId);
    const other = await reserve(first, otherOrgId);
    await expect(settle(second, 2, 'cross-org', other.reservationId)).rejects.toThrow('USAGE_RESERVATION_NOT_FOUND');
    expect(await state()).toEqual({ used: 0, held: 0 });
  });
  it('does not activate new ledger behavior automatically or rewrite the old baseline', async () => {
    await seed('starter', 'active', 105, 100);
    await control.query('UPDATE usage_ledger_state SET activated_at = NULL');
    await expect(reserve(first)).rejects.toThrow('USAGE_LEDGER_NOT_ACTIVATED');
    await expect(settle(first, 5, 'legacy', undefined, Date.now())).rejects.toThrow('USAGE_LEDGER_NOT_ACTIVATED');
    expect(await state()).toEqual({ used: 105, held: 0 }); expect(await invoices()).toEqual([]);
  });
  it.each([undefined, Date.UTC(1999, 0, 1)])('refuses unproven or pre-cutover legacy calls (%s)', async (startedAt) => {
    await seed('starter', 'active', 105, 100);
    await expect(settle(first, 5, 'legacy', undefined, startedAt)).rejects.toThrow('USAGE_LEGACY_CALL_REQUIRES_REVIEW');
    expect(await state()).toEqual({ used: 105, held: 0 }); expect(await invoices()).toEqual([]);
  });
});
