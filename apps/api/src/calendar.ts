import './env.js';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import type { JwtPayload } from './auth.js';
import { encrypt as encryptToken, decrypt as decryptToken } from './crypto.js';
import { redis } from './redis.js';
import { log } from './logger.js';
import crypto from 'node:crypto';

// CAL-04: every outbound HTTP to Google/Microsoft/Cal.com goes through this
// helper so a hung upstream can't pin a Fastify worker indefinitely. 10s is
// generous (Google Calendar p99 is well under 2s) but short enough that a
// truly stuck remote turns into a timed-out request instead of a leaked
// connection. Caller-supplied `signal` wins, default otherwise.
const CAL_FETCH_TIMEOUT_MS = 10_000;
async function calFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(CAL_FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal });
}

// Exposed for the poll-sync module. Same timeout semantics as the internal
// one — everything that talks to Google/Microsoft/cal.com should go through
// a bounded fetch so a hung upstream can't pin a worker.
export async function calFetchForSync(url: string, init: RequestInit = {}): Promise<Response> {
  return calFetch(url, init);
}

// OAuth state uses a SEPARATE HMAC key (defense-in-depth: a JWT_SECRET leak must
// not also grant OAuth-state forgery, which would let an attacker bind their
// calendar to someone else's org). In production we require OAUTH_STATE_SECRET
// explicitly — falling back to JWT_SECRET defeats the isolation and 'dev-oauth-state'
// is only acceptable for local development.
const OAUTH_STATE_KEY = (() => {
  if (process.env.OAUTH_STATE_SECRET) return process.env.OAUTH_STATE_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OAUTH_STATE_SECRET is required in production — refusing to reuse JWT_SECRET for OAuth state HMAC');
  }
  return process.env.JWT_SECRET || 'dev-oauth-state';
})();
const OAUTH_STATE_TTL_SEC = 600;

function signOAuthState(orgId: string, provider: 'google' | 'microsoft', staffId?: string | null): string {
  // Nonce binds the state to exactly one successful callback. After first
  // verifyOAuthState, the nonce is marked used in Redis and any replay
  // (double-click, leaked log, stolen URL) is rejected.
  const nonce = crypto.randomBytes(16).toString('base64url');
  const payload = { orgId, provider, nonce, staffId: staffId ?? null, exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SEC };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', OAUTH_STATE_KEY).update(body).digest('base64url');
  return `${body}.${mac}`;
}

async function verifyOAuthState(state: string, expectedProvider: 'google' | 'microsoft'): Promise<{ orgId: string; staffId: string | null } | null> {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts as [string, string];
  const expectedMac = crypto.createHmac('sha256', OAUTH_STATE_KEY).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { orgId: string; provider: string; exp: number; nonce?: string; staffId?: string | null };
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (payload.provider !== expectedProvider) return null;

    // Replay-protection: atomically claim the nonce. SET NX succeeds only on
    // first callback; any subsequent verifyOAuthState with the same state
    // finds the key and rejects. TTL = remaining state lifetime, so memory
    // doesn't grow unboundedly. When Redis connection is fully down (!isOpen)
    // we skip the check (dev-friendliness, OAuth must work without Redis).
    // But when Redis is reachable and the SET itself fails, we let the error
    // bubble to the outer try/catch which returns null (fail-closed) — a
    // silent catch(() => 'OK') here would mean transient Redis errors
    // allow replay, which is worse than a brief OAuth outage.
    if (payload.nonce && redis?.isOpen) {
      const key = `oauth_state_used:${payload.nonce}`;
      const ttl = Math.max(1, payload.exp - now);
      const claimed = await redis.set(key, '1', { NX: true, EX: ttl });
      if (claimed === null) {
        // Already used → replay
        return null;
      }
    }

    return { orgId: payload.orgId, staffId: payload.staffId ?? null };
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarConnection {
  id: string;
  org_id: string;
  staff_id: string | null;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: Date | null;
  calendar_id: string;
  email: string | null;
  api_key: string | null;
  username: string | null;
  sync_token?: string | null;
  last_synced_at?: Date | null;
  last_sync_error?: string | null;
}

const CALENDAR_PROVIDERS = ['google', 'microsoft', 'calcom'] as const;

type CalendarConnectionStatus = {
  provider: string;
  staffId?: string | null;
  connected: boolean;
  email: string | null;
  calendarId: string | null;
  expired?: boolean;
  username?: string | null;
  eventTypes?: CalcomEventType[];
};

interface ExternalBookingResult {
  provider: string;
  connectionId: string;
  ok: boolean;
  eventId?: string;
  bookingId?: number | string;
  error?: string;
  reused?: boolean;
  bookedAt?: string;
}

type ExternalBookingRefs = Record<string, ExternalBookingResult>;

interface ChipyBookingState {
  id: string;
  source_call_id: string | null;
  external_refs: unknown;
}

type CalendarStaff = {
  id: string;
  org_id: string;
  name: string;
  role: string | null;
  services: string[];
  color: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// ── DB Migration ──────────────────────────────────────────────────────────────

export async function migrateCalendar(): Promise<void> {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_connections (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      provider        TEXT NOT NULL DEFAULT 'google',
      access_token    TEXT NOT NULL DEFAULT '',
      refresh_token   TEXT,
      token_expires_at TIMESTAMPTZ,
      calendar_id     TEXT NOT NULL DEFAULT 'primary',
      email           TEXT
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cal_conn_org_idx ON calendar_connections(org_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_staff (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      role        TEXT,
      services    TEXT[] NOT NULL DEFAULT '{}',
      color       TEXT,
      active      BOOLEAN NOT NULL DEFAULT true,
      sort_order  INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS calendar_staff_org_idx
      ON calendar_staff(org_id, active, sort_order, name);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS calendar_staff_org_name_active_uniq
      ON calendar_staff(org_id, lower(name)) WHERE active;
  `);

  await pool.query(`
    ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES calendar_staff(id) ON DELETE CASCADE;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS cal_conn_org_staff_idx ON calendar_connections(org_id, staff_id);
  `);

  // Staff support changes the old org+provider uniqueness into two scopes:
  // salon-wide rows (staff_id IS NULL) and per-employee rows.
  await pool.query(`DROP INDEX IF EXISTS cal_conn_org_provider_uniq`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cal_conn_org_provider_default_uniq
      ON calendar_connections(org_id, provider) WHERE staff_id IS NULL;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cal_conn_org_staff_provider_uniq
      ON calendar_connections(org_id, staff_id, provider) WHERE staff_id IS NOT NULL;
  `);

  // Cal.com integration columns
  await pool.query(`
    ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS api_key TEXT;
  `);
  await pool.query(`
    ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS username TEXT;
  `);

  // Poll-sync columns. We keep `sync_token` so Google's delta API only
  // returns changed events instead of re-fetching the full window every
  // time (saves quota + DB churn). `last_synced_at` tells the cron when
  // this connection last completed successfully — a stale value means
  // either the connection expired or the cron itself is broken, which
  // lets ops see drift at a glance.
  await pool.query(`
    ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS sync_token TEXT;
  `);
  await pool.query(`
    ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
  `);

  // ── External calendar events cache ─────────────────────────────────────────
  // Why a cache table and not pure live-fetching:
  //  - The Agent path (findFreeSlots/bookSlot) still uses live `freeBusy` —
  //    that is authoritative for conflict-checking.
  //  - This table is for the UI grid so we can render external events
  //    offline-consistent with their TITLES (freeBusy only returns times).
  //  - Storing avoids one Google API call per Kalender-Seiten-Öffnung.
  //
  // Schema notes:
  //  - (org_id, provider, external_id) is the natural key — Google/Microsoft
  //    event ids are unique only within a calendar, so we pin to our own
  //    org_id+provider tuple.
  //  - `status` carries cancelled/confirmed/tentative so we can grey out
  //    or hide cancelled events instead of deleting (audit trail).
  //  - `slot_start`/`slot_end` are timestamptz — all provider responses are
  //    converted to UTC before insert.
  //  - `raw` keeps the original provider payload for debugging ONE level of
  //    detail — we strip the description field (can contain PII) before store.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_calendar_events (
      id              BIGSERIAL PRIMARY KEY,
      org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      provider        TEXT NOT NULL,
      external_id     TEXT NOT NULL,
      calendar_id     TEXT,
      summary         TEXT,
      slot_start      TIMESTAMPTZ NOT NULL,
      slot_end        TIMESTAMPTZ NOT NULL,
      all_day         BOOLEAN NOT NULL DEFAULT false,
      status          TEXT NOT NULL DEFAULT 'confirmed',
      last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ext_cal_events_uniq
      ON external_calendar_events(org_id, provider, external_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ext_cal_events_range_idx
      ON external_calendar_events(org_id, slot_start, slot_end);
  `);

  // ── Chipy Kalender ─────────────────────────────────────────────────────────
  // Simple built-in calendar for orgs without Google/Microsoft/Cal.com.
  // Migration: rename old "chippy_*" tables to "chipy_*" (User: "CHIPY immer so").
  // Safe no-op if old tables don't exist or new ones already do.
  for (const t of ['schedules', 'blocks', 'bookings']) {
    await pool.query(`ALTER TABLE IF EXISTS chippy_${t} RENAME TO chipy_${t}`).catch(() => {});
  }
  // Rename old indexes too (Postgres keeps index names on table rename)
  await pool.query(`ALTER INDEX IF EXISTS chippy_blocks_fullday_uniq RENAME TO chipy_blocks_fullday_uniq`).catch(() => {});
  await pool.query(`ALTER INDEX IF EXISTS chippy_bookings_org_slot_uniq RENAME TO chipy_bookings_org_slot_uniq`).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chipy_schedules (
      org_id      UUID PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
      schedule    JSONB NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chipy_blocks (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      date        DATE NOT NULL,
      start_time  TIME,
      end_time    TIME,
      reason      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Add time columns if they don't exist yet (idempotent migration)
  await pool.query(`ALTER TABLE chipy_blocks ADD COLUMN IF NOT EXISTS start_time TIME`);
  await pool.query(`ALTER TABLE chipy_blocks ADD COLUMN IF NOT EXISTS end_time   TIME`);
  // Drop old full-day unique index (we now allow multiple time-based blocks per day)
  await pool.query(`DROP INDEX IF EXISTS chipy_blocks_org_date_uniq`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chipy_blocks_org_idx ON chipy_blocks(org_id, date);
  `);
  // Unique index only for full-day blocks (start_time IS NULL)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS chipy_blocks_fullday_uniq
      ON chipy_blocks(org_id, date) WHERE start_time IS NULL;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chipy_bookings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      customer_name   TEXT NOT NULL,
      customer_phone  TEXT NOT NULL,
      service         TEXT,
      notes           TEXT,
      slot_time       TIMESTAMPTZ NOT NULL,
      source_call_id  TEXT,
      external_refs   JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE chipy_bookings ADD COLUMN IF NOT EXISTS source_call_id TEXT`);
  await pool.query(`ALTER TABLE chipy_bookings ADD COLUMN IF NOT EXISTS external_refs JSONB NOT NULL DEFAULT '{}'::jsonb`);

  // Prevent double bookings for the same org + slot time.
  // PLAN #2: on existing servers, duplicate rows may already exist (before this
  // index was added). Clean them up first — keep only the newest per (org_id,
  // slot_time) so the UNIQUE INDEX creation succeeds.
  // Deterministic dedup: keep the row with the highest `id` per (org_id,
  // slot_time). Using `id` instead of `created_at` because multiple rows
  // can share the same `created_at` timestamp (concurrent inserts, clock
  // resolution) — `id` is always unique and monotonic.
  await pool.query(`
    DELETE FROM chipy_bookings a
      USING chipy_bookings b
      WHERE a.org_id = b.org_id
        AND a.slot_time = b.slot_time
        AND a.id < b.id;
  `).catch(() => {/* table may not exist yet on first boot */});
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS chipy_bookings_org_slot_uniq ON chipy_bookings(org_id, slot_time);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chipy_bookings_source_call_idx
      ON chipy_bookings(org_id, source_call_id)
      WHERE source_call_id IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_chipy_schedules (
      staff_id    UUID PRIMARY KEY REFERENCES calendar_staff(id) ON DELETE CASCADE,
      org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      schedule    JSONB NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS staff_chipy_schedules_org_idx
      ON staff_chipy_schedules(org_id, staff_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_chipy_blocks (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      staff_id    UUID NOT NULL REFERENCES calendar_staff(id) ON DELETE CASCADE,
      date        DATE NOT NULL,
      start_time  TIME,
      end_time    TIME,
      reason      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS staff_chipy_blocks_staff_idx
      ON staff_chipy_blocks(org_id, staff_id, date);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS staff_chipy_blocks_fullday_uniq
      ON staff_chipy_blocks(org_id, staff_id, date) WHERE start_time IS NULL;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_chipy_bookings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      staff_id        UUID NOT NULL REFERENCES calendar_staff(id) ON DELETE CASCADE,
      customer_name   TEXT NOT NULL,
      customer_phone  TEXT NOT NULL,
      service         TEXT,
      notes           TEXT,
      slot_time       TIMESTAMPTZ NOT NULL,
      source_call_id  TEXT,
      external_refs   JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS staff_chipy_bookings_slot_uniq
      ON staff_chipy_bookings(org_id, staff_id, slot_time);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS staff_chipy_bookings_source_call_idx
      ON staff_chipy_bookings(org_id, staff_id, source_call_id)
      WHERE source_call_id IS NOT NULL;
  `);
}

// ── Internal DB helpers ───────────────────────────────────────────────────────

// Decrypts sensitive fields in-place. Works transparently for both encrypted
// and legacy-plaintext rows (decrypt() passes plaintext through if unprefixed).
// CAL-07: decryptToken returns null on corrupt ciphertext (e.g. after a botched
// manual DB edit or an ENCRYPTION_KEY rotation without re-encrypt). We now log
// a warning once per load so ops can see it, instead of silently handing back
// an empty access_token that makes every downstream call 401.
function decryptConn(row: CalendarConnection | null): CalendarConnection | null {
  if (!row) return null;
  // Decryption fails when ENCRYPTION_KEY rotates without a re-encrypt sweep
  // — the connection silently disappears from the UI and the customer wonders
  // why "Google connected" but no events sync. log.error so the spike shows
  // up in Sentry / structured logs instead of just stderr.
  if (row.access_token) {
    const dec = decryptToken(row.access_token);
    if (dec === null) {
      log.error({ orgId: row.org_id, provider: row.provider, field: 'access_token' }, 'calendar: token decrypt failed (key rotated?)');
    }
    row.access_token = dec ?? '';
  }
  if (row.refresh_token) {
    const dec = decryptToken(row.refresh_token);
    if (dec === null) {
      log.error({ orgId: row.org_id, provider: row.provider, field: 'refresh_token' }, 'calendar: token decrypt failed (key rotated?)');
    }
    row.refresh_token = dec;
  }
  if (row.api_key !== undefined && row.api_key !== null) {
    const dec = decryptToken(row.api_key);
    if (dec === null) {
      log.error({ orgId: row.org_id, provider: row.provider, field: 'api_key' }, 'calendar: token decrypt failed (key rotated?)');
    }
    row.api_key = dec;
  }
  return row;
}

class StaffNotFoundError extends Error {
  constructor() {
    super('STAFF_NOT_FOUND');
  }
}

function sanitizeStaffServices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const services: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const service = raw.trim().slice(0, 80);
    if (!service || seen.has(service.toLowerCase())) continue;
    seen.add(service.toLowerCase());
    services.push(service);
    if (services.length >= 20) break;
  }
  return services;
}

async function assertStaffBelongs(orgId: string, staffId?: string | null): Promise<string | null> {
  if (!staffId) return null;
  if (!pool) return staffId;
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM calendar_staff WHERE id = $1 AND org_id = $2 AND active = true LIMIT 1`,
    [staffId, orgId],
  );
  if (!res.rows[0]) throw new StaffNotFoundError();
  return staffId;
}

async function getCalendarStaff(orgId: string): Promise<CalendarStaff[]> {
  if (!pool) return [];
  const res = await pool.query<CalendarStaff>(
    `SELECT id, org_id, name, role, services, color, active, sort_order, created_at, updated_at
     FROM calendar_staff
     WHERE org_id = $1 AND active = true
     ORDER BY sort_order, name`,
    [orgId],
  );
  return res.rows;
}

async function upsertCalendarConnection(input: {
  orgId: string;
  staffId?: string | null;
  provider: 'google' | 'microsoft' | 'calcom';
  accessToken?: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  calendarId?: string;
  email?: string | null;
  apiKey?: string | null;
  username?: string | null;
}): Promise<void> {
  if (!pool) return;
  const encryptedAccess = encryptToken(input.accessToken ?? '');
  const encryptedRefresh = encryptToken(input.refreshToken ?? null);
  const encryptedApiKey = input.apiKey == null ? null : encryptToken(input.apiKey);
  const values = [
    input.orgId,
    input.staffId ?? null,
    input.provider,
    encryptedAccess,
    encryptedRefresh,
    input.tokenExpiresAt ?? null,
    input.calendarId ?? (input.provider === 'calcom' ? 'calcom' : 'primary'),
    input.email ?? null,
    encryptedApiKey,
    input.username ?? null,
  ];

  if (input.staffId) {
    await pool.query(
      `INSERT INTO calendar_connections
         (org_id, staff_id, provider, access_token, refresh_token, token_expires_at, calendar_id, email, api_key, username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (org_id, staff_id, provider) WHERE staff_id IS NOT NULL DO UPDATE SET
         access_token      = EXCLUDED.access_token,
         refresh_token     = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
         token_expires_at  = EXCLUDED.token_expires_at,
         calendar_id       = EXCLUDED.calendar_id,
         email             = COALESCE(EXCLUDED.email, calendar_connections.email),
         api_key           = COALESCE(EXCLUDED.api_key, calendar_connections.api_key),
         username          = COALESCE(EXCLUDED.username, calendar_connections.username)`,
      values,
    );
    return;
  }

  await pool.query(
    `INSERT INTO calendar_connections
       (org_id, staff_id, provider, access_token, refresh_token, token_expires_at, calendar_id, email, api_key, username)
     VALUES ($1, NULL, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (org_id, provider) WHERE staff_id IS NULL DO UPDATE SET
       access_token      = EXCLUDED.access_token,
       refresh_token     = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
       token_expires_at  = EXCLUDED.token_expires_at,
       calendar_id       = EXCLUDED.calendar_id,
       email             = COALESCE(EXCLUDED.email, calendar_connections.email),
       api_key           = COALESCE(EXCLUDED.api_key, calendar_connections.api_key),
       username          = COALESCE(EXCLUDED.username, calendar_connections.username)`,
    values,
  );
}

async function getAllConnections(orgId: string, staffId: string | null = null): Promise<CalendarConnection[]> {
  if (!pool) return [];
  const res = staffId
    ? await pool.query<CalendarConnection>(
        `SELECT * FROM calendar_connections WHERE org_id = $1 AND staff_id = $2 ORDER BY created_at`,
        [orgId, staffId],
      )
    : await pool.query<CalendarConnection>(
        `SELECT * FROM calendar_connections WHERE org_id = $1 AND staff_id IS NULL ORDER BY created_at`,
        [orgId],
      );
  return res.rows.map((r) => decryptConn(r)!).filter((r): r is CalendarConnection => r !== null);
}

// Exposed for `calendar-sync.ts` — it needs the decrypted connection rows
// (tokens in plaintext) to fetch events. `getValidToken` + `getValidMsToken`
// handle OAuth refresh; this helper just lists everything for cron iteration.
export async function getAllConnectionsForSync(orgId: string): Promise<CalendarConnection[]> {
  if (!pool) return [];
  const res = await pool.query<CalendarConnection>(
    `SELECT * FROM calendar_connections WHERE org_id = $1 ORDER BY created_at`,
    [orgId],
  );
  return res.rows.map((r) => decryptConn(r)!).filter((r): r is CalendarConnection => r !== null);
}

// List every connection across every org, for the background sync cron.
// Returns decrypted tokens — caller must never log or expose them.
export async function getAllActiveConnections(): Promise<CalendarConnection[]> {
  if (!pool) return [];
  const res = await pool.query<CalendarConnection>(
    // Staff-specific connections are used live by staff-scoped booking flows.
    // The external_events cache is still org-scoped, so the cron must not sync
    // staff rows into it or one staff calendar can delete/overwrite another.
    `SELECT * FROM calendar_connections WHERE staff_id IS NULL ORDER BY org_id`,
  );
  return res.rows.map((r) => decryptConn(r)!).filter((r): r is CalendarConnection => r !== null);
}

async function canCheckConnection(conn: CalendarConnection, orgId: string): Promise<boolean> {
  const slots = await findSlotsForConnection(conn, orgId);
  return slots !== null;
}

async function getCheckableConnections(orgId: string, staffId: string | null = null): Promise<CalendarConnection[]> {
  const connections = await getAllConnections(orgId, staffId);
  const usable: CalendarConnection[] = [];
  for (const conn of connections) {
    try {
      if (await canCheckConnection(conn, orgId)) usable.push(conn);
    } catch (err) {
      // A broken/stale integration must not make the agent unusable. Treat it
      // as disconnected and fall back to Chipy for this call — BUT log it so
      // an ops engineer can see WHY a connected calendar is being ignored.
      log.warn(
        { orgId, provider: conn.provider, err: (err as Error).message?.slice(0, 200) },
        'calendar: canCheckConnection threw, connection excluded from agent',
      );
    }
  }
  return usable;
}

async function getConnectionStatus(conn: CalendarConnection, orgId: string): Promise<CalendarConnectionStatus> {
  let connected = true;
  if (conn.provider === 'google') {
    connected = Boolean(await getValidTokenForConnection(conn));
  } else if (conn.provider === 'microsoft') {
    connected = Boolean(await getValidMsTokenForConnection(conn));
  }

  const status: CalendarConnectionStatus = {
    provider: conn.provider,
    staffId: conn.staff_id ?? null,
    connected,
    email: connected ? (conn.email ?? null) : null,
    calendarId: conn.calendar_id ?? null,
    ...(!connected ? { expired: true } : {}),
  };

  if (conn.provider === 'calcom') {
    status.username = conn.username ?? null;
    if (conn.api_key) {
      status.eventTypes = await calcomGetEventTypes(conn.api_key);
    }
  }

  return status;
}

// ── Token Management (Microsoft) ─────────────────────────────────────────────

async function getValidMsTokenForConnection(conn: CalendarConnection): Promise<string | null> {
  if (!pool) return conn.access_token || null;

  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const needsRefresh =
    conn.token_expires_at != null && new Date(conn.token_expires_at) < fiveMinFromNow;

  if (needsRefresh) {
    if (!conn.refresh_token) return null;
    // CAL-02: serialise concurrent refreshes per (org, provider). Two parallel
    // getValidMsToken() calls used to each hit Microsoft, race on the UPDATE
    // and potentially race-invalidate the refresh_token rotation. Redis lock
    // with 30s TTL — fail-open if Redis is down (single-instance dev).
    const lockKey = `cal:refresh:ms:${conn.id}`;
    let gotLock: string | null | undefined = 'skip';
    if (redis?.isOpen) {
      gotLock = await redis.set(lockKey, '1', { NX: true, EX: 30 }).catch(() => null);
      if (!gotLock) {
        // Another request is refreshing — wait briefly then re-read fresh token.
        await new Promise((r) => setTimeout(r, 500));
        const fresh = await pool.query<CalendarConnection>(
          `SELECT * FROM calendar_connections WHERE id = $1 LIMIT 1`,
          [conn.id],
        );
        const refreshed = decryptConn(fresh.rows[0] ?? null);
        return refreshed?.access_token || null;
      }
    }
    try {
      const resp = await calFetch(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
            client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
            refresh_token: conn.refresh_token,
            grant_type: 'refresh_token',
            scope: 'https://graph.microsoft.com/Calendars.ReadWrite offline_access User.Read',
          }),
        },
      );
      if (!resp.ok) return null;
      const data = (await resp.json()) as { access_token: string; expires_in: number; refresh_token?: string };
      const expiresAt = new Date(Date.now() + data.expires_in * 1000);
      await pool!.query(
        `UPDATE calendar_connections
         SET access_token = $1, refresh_token = COALESCE($2, refresh_token), token_expires_at = $3
         WHERE id = $4`,
        [encryptToken(data.access_token), encryptToken(data.refresh_token ?? null), expiresAt, conn.id],
      );
      return data.access_token;
    } catch (err) {
      // Loud log: silent null-returns here masked 5 months of Google 403s
      // historically. Caller treats null as "no token" → user sees no Google
      // mirror without knowing why. Surface the error so Ops can spot
      // revoked-refresh-token / scope-change patterns.
      log.warn(
        { err: (err as Error).message, orgId: conn.org_id, staffId: conn.staff_id, provider: 'microsoft' },
        'calendar: token refresh failed — connection likely needs reconnect',
      );
      return null;
    } finally {
      if (redis?.isOpen && gotLock === '1') {
        await redis.del(lockKey).catch(() => {});
      }
    }
  }

  return conn.access_token;
}

export async function getValidMsToken(orgId: string): Promise<string | null> {
  if (!pool) return null;
  const res = await pool.query<CalendarConnection>(
    `SELECT * FROM calendar_connections WHERE org_id = $1 AND staff_id IS NULL AND provider = 'microsoft' LIMIT 1`,
    [orgId],
  );
  const conn = decryptConn(res.rows[0] ?? null);
  return conn ? getValidMsTokenForConnection(conn) : null;
}

// ── Microsoft Graph helpers ───────────────────────────────────────────────────

async function msFindSlots(token: string, email: string): Promise<string[]> {
  const now = new Date();
  const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const resp = await calFetch('https://graph.microsoft.com/v1.0/me/calendar/getSchedule', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.timezone="Europe/Berlin"',
      },
      body: JSON.stringify({
        schedules: [email],
        startTime: { dateTime: now.toISOString(), timeZone: 'UTC' },
        endTime: { dateTime: timeMax.toISOString(), timeZone: 'UTC' },
        availabilityViewInterval: 30,
      }),
    });

    if (!resp.ok) return [];

    const data = (await resp.json()) as {
      value?: { scheduleItems?: { start: { dateTime: string }; end: { dateTime: string }; status: string }[] }[];
    };

    const busyItems = data.value?.[0]?.scheduleItems?.filter(
      (i) => i.status === 'busy' || i.status === 'tentative' || i.status === 'oof',
    ) ?? [];

    const busyPeriods = busyItems.map((i) => ({
      start: i.start.dateTime,
      end: i.end.dateTime,
    }));

    return generateFreeSlots(busyPeriods);
  } catch {
    return [];
  }
}

async function msBookSlot(
  token: string,
  opts: { customerName: string; customerPhone: string; time: string; service: string; notes?: string },
): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  const startTime = parseSlotTime(opts.time);
  if (!startTime) return { ok: false, error: `Cannot parse time: ${opts.time}` };
  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

  try {
    const resp = await calFetch('https://graph.microsoft.com/v1.0/me/calendar/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.timezone="Europe/Berlin"',
      },
      body: JSON.stringify({
        subject: `${opts.service} – ${opts.customerName}`,
        body: {
          contentType: 'text',
          content: [
            `Service: ${opts.service}`,
            `Kunde: ${opts.customerName}`,
            `Telefon: ${opts.customerPhone}`,
            opts.notes ? `Notizen: ${opts.notes}` : null,
          ].filter(Boolean).join('\n'),
        },
        start: { dateTime: startTime.toISOString(), timeZone: 'UTC' },
        end: { dateTime: endTime.toISOString(), timeZone: 'UTC' },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { ok: false, error: `Microsoft Graph ${resp.status}: ${body}` };
    }

    const event = (await resp.json()) as { id: string };
    return { ok: true, eventId: event.id };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ── Token Management (Google) ─────────────────────────────────────────────────

async function getValidTokenForConnection(conn: CalendarConnection): Promise<string | null> {
  if (!pool) return conn.access_token || null;

  // Refresh if token expires within 5 minutes
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const needsRefresh =
    conn.token_expires_at != null && new Date(conn.token_expires_at) < fiveMinFromNow;

  if (needsRefresh) {
    if (!conn.refresh_token) return null;

    // CAL-02: serialise Google token refresh per org. Redis SET NX EX 30 keeps
    // two concurrent getValidToken() calls from hitting Google at once and
    // racing on the UPDATE. Fail-open when Redis unavailable.
    const lockKey = `cal:refresh:google:${conn.id}`;
    let gotLock: string | null | undefined = 'skip';
    if (redis?.isOpen) {
      gotLock = await redis.set(lockKey, '1', { NX: true, EX: 30 }).catch(() => null);
      if (!gotLock) {
        await new Promise((r) => setTimeout(r, 500));
        const fresh = await pool.query<CalendarConnection>(
          `SELECT * FROM calendar_connections WHERE id = $1 LIMIT 1`,
          [conn.id],
        );
        const refreshed = decryptConn(fresh.rows[0] ?? null);
        return refreshed?.access_token || null;
      }
    }

    try {
      const resp = await calFetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID ?? '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
          refresh_token: conn.refresh_token,
          grant_type: 'refresh_token',
        }),
      });

      if (!resp.ok) return null;

      const data = (await resp.json()) as { access_token: string; expires_in: number; refresh_token?: string };
      const expiresAt = new Date(Date.now() + data.expires_in * 1000);

      await pool!.query(
        `UPDATE calendar_connections
         SET access_token = $1, refresh_token = COALESCE($2, refresh_token), token_expires_at = $3
         WHERE id = $4`,
        [encryptToken(data.access_token), encryptToken(data.refresh_token ?? null), expiresAt, conn.id],
      );

      return data.access_token;
    } catch (err) {
      // Loud log: silent null-returns here masked 5 months of Google 403s
      // historically. Caller treats null as "no token" → user sees no Google
      // mirror without knowing why. Surface the error so Ops can spot
      // revoked-refresh-token / scope-change patterns.
      log.warn(
        { err: (err as Error).message, orgId: conn.org_id, staffId: conn.staff_id, provider: 'google' },
        'calendar: token refresh failed — connection likely needs reconnect',
      );
      return null;
    } finally {
      if (redis?.isOpen && gotLock === '1') {
        await redis.del(lockKey).catch(() => {});
      }
    }
  }

  return conn.access_token;
}

// ── Slot Generation ───────────────────────────────────────────────────────────

export async function getValidToken(orgId: string): Promise<string | null> {
  if (!pool) return null;
  const res = await pool.query<CalendarConnection>(
    `SELECT * FROM calendar_connections WHERE org_id = $1 AND staff_id IS NULL AND provider = 'google' LIMIT 1`,
    [orgId],
  );
  const conn = decryptConn(res.rows[0] ?? null);
  return conn ? getValidTokenForConnection(conn) : null;
}

const DAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

function generateFreeSlots(
  busyPeriods: { start: string; end: string }[],
): string[] {
  const slots: string[] = [];
  const now = new Date();

  for (let d = 0; d < 7; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    day.setHours(0, 0, 0, 0);

    const dayLabel = DAY_LABELS[day.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6];

    for (let h = 8; h < 18; h++) {
      for (const m of [0, 30] as const) {
        const slotStart = new Date(day);
        slotStart.setHours(h, m, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

        if (slotStart <= now) continue; // skip past slots

        const isBusy = busyPeriods.some((bp) => {
          const bStart = new Date(bp.start);
          const bEnd = new Date(bp.end);
          // CAL-11: Invalid Date compares as NaN → comparison returns false →
          // the whole slot would be marked free even though Google/MS sent us
          // a malformed busy-period. Fail-closed: treat unparseable as busy.
          if (Number.isNaN(bStart.getTime()) || Number.isNaN(bEnd.getTime())) return true;
          return slotStart < bEnd && slotEnd > bStart;
        });

        if (!isBusy) {
          const hStr = h.toString().padStart(2, '0');
          const mStr = m.toString().padStart(2, '0');
          slots.push(`${dayLabel} ${hStr}:${mStr}`);
        }
      }
    }
  }

  return slots;
}

// ── Parse slot time string → Date ────────────────────────────────────────────

function parseSlotTime(slot: string): Date | null {
  const raw = slot.trim();
  if (!raw) return null;

  const absolute = parseAbsoluteSlotTime(raw);
  if (absolute) return absolute;

  const normalized = normalizeSlotText(raw);
  const time = extractTimeOfDay(normalized);
  if (!time) return null;

  const now = new Date();
  const relativeMatch = normalized.match(/\b(heute|morgen|uebermorgen)\b/);
  if (relativeMatch) {
    const daysAhead = relativeMatch[1] === 'heute' ? 0 : relativeMatch[1] === 'morgen' ? 1 : 2;
    const result = new Date(now);
    result.setDate(now.getDate() + daysAhead);
    result.setHours(time.hour, time.minute, 0, 0);
    if (daysAhead === 0 && result <= now) result.setDate(result.getDate() + 7);
    return result;
  }

  const dayIndex: Record<string, number> = {
    sonntag: 0,
    so: 0,
    montag: 1,
    mo: 1,
    dienstag: 2,
    di: 2,
    mittwoch: 3,
    mi: 3,
    donnerstag: 4,
    do: 4,
    freitag: 5,
    fr: 5,
    samstag: 6,
    sa: 6,
  };

  const dayMatch = normalized.match(/\b(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|so|mo|di|mi|do|fr|sa)\b/);
  if (!dayMatch) return null;

  const targetDay = dayIndex[dayMatch[1]!];
  if (targetDay === undefined) return null;

  const result = new Date(now);
  result.setHours(time.hour, time.minute, 0, 0);

  let daysAhead = targetDay - now.getDay();
  if (daysAhead < 0 || (daysAhead === 0 && result <= now)) daysAhead += 7;
  result.setDate(result.getDate() + daysAhead);

  return result;
}

function normalizeSlotText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function extractTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = value.match(/\b(\d{1,2})(?:(?::|\.)(\d{2})|\s*(?:uhr|h)(?:\s*(\d{1,2}))?)?\b/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] !== undefined ? Number(match[2]) : match[3] !== undefined ? Number(match[3]) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
}

function parseAbsoluteSlotTime(value: string): Date | null {
  const isoDateTimeMatch = value.match(
    /^\s*(\d{4})-(\d{1,2})-(\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*$/,
  );
  if (isoDateTimeMatch) {
    const [, year, month, day, hour, minute] = isoDateTimeMatch;
    return buildLocalDate(Number(year), Number(month), Number(day), {
      hour: Number(hour),
      minute: Number(minute),
    });
  }

  const isoMatch = value.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const rest = value.slice((isoMatch.index ?? 0) + isoMatch[0].length).replace(/^[T\s,]+/, '');
    const time = extractTimeOfDay(normalizeSlotText(rest));
    if (!time) return null;
    return buildLocalDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]), time);
  }

  const germanDateMatch = value.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (germanDateMatch) {
    const rest = value.slice((germanDateMatch.index ?? 0) + germanDateMatch[0].length);
    const time = extractTimeOfDay(normalizeSlotText(rest));
    if (!time) return null;
    return buildLocalDate(Number(germanDateMatch[3]), Number(germanDateMatch[2]), Number(germanDateMatch[1]), time);
  }

  return null;
}

function buildLocalDate(year: number, month: number, day: number, time: { hour: number; minute: number }): Date | null {
  const result = berlinLocalTimeToDate(year, month, day, time.hour, time.minute);
  const parts = berlinParts(result);
  if (parts.year !== year || parts.month !== month || parts.day !== day) return null;
  return result;
}

function berlinParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function berlinOffsetMs(date: Date): number {
  const parts = berlinParts(date);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asUtc - date.getTime();
}

function berlinLocalTimeToDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let instant = new Date(localAsUtc);
  for (let i = 0; i < 2; i++) {
    instant = new Date(localAsUtc - berlinOffsetMs(instant));
  }
  return instant;
}

// ── Chipy Calendar helpers ───────────────────────────────────────────────────

interface ChipyDaySchedule {
  enabled: boolean;
  start: string; // "09:00"
  end: string;   // "17:00"
}

type ChipySchedule = Record<string, ChipyDaySchedule>; // key = "0".."6" (day of week)

const DEFAULT_CHIPPY_SCHEDULE: ChipySchedule = {
  '0': { enabled: false, start: '09:00', end: '17:00' }, // So
  '1': { enabled: true,  start: '09:00', end: '17:00' }, // Mo
  '2': { enabled: true,  start: '09:00', end: '17:00' }, // Di
  '3': { enabled: true,  start: '09:00', end: '17:00' }, // Mi
  '4': { enabled: true,  start: '09:00', end: '17:00' }, // Do
  '5': { enabled: true,  start: '09:00', end: '17:00' }, // Fr
  '6': { enabled: false, start: '09:00', end: '17:00' }, // Sa
};

type ChipyBlock = { date: string; start_time: string | null; end_time: string | null };

async function getChipySchedule(orgId: string, staffId?: string | null): Promise<{ schedule: ChipySchedule; blocks: string[]; timeBlocks: ChipyBlock[] }> {
  if (!pool) return { schedule: DEFAULT_CHIPPY_SCHEDULE, blocks: [], timeBlocks: [] };

  if (staffId) {
    const [schedRes, blockRes, bookingRes] = await Promise.all([
      pool.query(`SELECT schedule FROM staff_chipy_schedules WHERE org_id = $1 AND staff_id = $2`, [orgId, staffId]),
      pool.query(
        `SELECT date::text, start_time::text, end_time::text FROM staff_chipy_blocks WHERE org_id = $1 AND staff_id = $2 AND date >= CURRENT_DATE ORDER BY date`,
        [orgId, staffId],
      ),
      pool.query(
        `SELECT
           (slot_time AT TIME ZONE 'Europe/Berlin')::date::text AS date,
           (slot_time AT TIME ZONE 'Europe/Berlin')::time::text AS start_time,
           ((slot_time AT TIME ZONE 'Europe/Berlin') + interval '30 minutes')::time::text AS end_time
         FROM staff_chipy_bookings
         WHERE org_id = $1 AND staff_id = $2 AND slot_time >= now()
         ORDER BY slot_time`,
        [orgId, staffId],
      ),
    ]);

    const schedule: ChipySchedule = (schedRes.rows[0]?.schedule as ChipySchedule | undefined) ?? DEFAULT_CHIPPY_SCHEDULE;
    const blocks: string[] = blockRes.rows.filter((r) => !r.start_time).map((r) => r.date as string);
    const timeBlocks: ChipyBlock[] = blockRes.rows.filter((r) => r.start_time).map((r) => ({
      date: r.date as string, start_time: r.start_time as string, end_time: r.end_time as string,
    }));
    timeBlocks.push(...bookingRes.rows.map((r) => ({
      date: r.date as string,
      start_time: r.start_time as string,
      end_time: r.end_time as string,
    })));
    return { schedule, blocks, timeBlocks };
  }

  const [schedRes, blockRes, bookingRes] = await Promise.all([
    pool.query(`SELECT schedule FROM chipy_schedules WHERE org_id = $1`, [orgId]),
    pool.query(
      `SELECT date::text, start_time::text, end_time::text FROM chipy_blocks WHERE org_id = $1 AND date >= CURRENT_DATE ORDER BY date`,
      [orgId],
    ),
    pool.query(
      `SELECT
         (slot_time AT TIME ZONE 'Europe/Berlin')::date::text AS date,
         (slot_time AT TIME ZONE 'Europe/Berlin')::time::text AS start_time,
         ((slot_time AT TIME ZONE 'Europe/Berlin') + interval '30 minutes')::time::text AS end_time
       FROM chipy_bookings
       WHERE org_id = $1 AND slot_time >= now()
       ORDER BY slot_time`,
      [orgId],
    ),
  ]);

  const schedule: ChipySchedule = (schedRes.rows[0]?.schedule as ChipySchedule | undefined) ?? DEFAULT_CHIPPY_SCHEDULE;
  // Full-day blocks (no start_time)
  const blocks: string[] = blockRes.rows.filter((r) => !r.start_time).map((r) => r.date as string);
  // Time-specific blocks
  const timeBlocks: ChipyBlock[] = blockRes.rows.filter((r) => r.start_time).map((r) => ({
    date: r.date as string, start_time: r.start_time as string, end_time: r.end_time as string,
  }));
  timeBlocks.push(...bookingRes.rows.map((r) => ({
    date: r.date as string,
    start_time: r.start_time as string,
    end_time: r.end_time as string,
  })));
  return { schedule, blocks, timeBlocks };
}

function generateChipySlots(
  schedule: ChipySchedule,
  blocks: string[],
  timeBlocks: ChipyBlock[] = [],
  onlyDate?: string | null,
): string[] {
  const slots: string[] = [];
  const now = new Date();
  const blockedSet = new Set(blocks);

  for (let d = 0; d < 14; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    day.setHours(0, 0, 0, 0);

    const dow = day.getDay().toString();
    const dayConfig = schedule[dow] ?? DEFAULT_CHIPPY_SCHEDULE[dow];
    if (!dayConfig?.enabled) continue;

    const dateStr = localDateKey(day);
    if (onlyDate && dateStr !== onlyDate) continue;
    if (blockedSet.has(dateStr)) continue;

    const dayLabel = DAY_LABELS[day.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6];
    const [startH] = dayConfig.start.split(':').map(Number);
    const [endH] = dayConfig.end.split(':').map(Number);

    // Get time-specific blocks for this date
    const dayTimeBlocks = timeBlocks.filter(b => b.date === dateStr);

    for (let h = (startH ?? 9); h < (endH ?? 17); h++) {
      for (const m of [0, 30] as const) {
        const slotStart = new Date(day);
        slotStart.setHours(h, m, 0, 0);
        if (slotStart <= now) continue;

        // Check if this slot falls within a time-specific block
        const slotTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        const isTimeBlocked = dayTimeBlocks.some(b =>
          b.start_time && b.end_time && slotTime >= b.start_time.slice(0, 5) && slotTime < b.end_time.slice(0, 5)
        );
        if (isTimeBlocked) continue;

        const hStr = h.toString().padStart(2, '0');
        const mStr = m.toString().padStart(2, '0');
        slots.push(`${dayLabel} ${hStr}:${mStr}`);
      }
    }
  }

  return slots;
}

function requestedDateKey(opts: { date?: string; range?: string; service?: string }): string | null {
  const raw = `${opts.date ?? ''} ${opts.range ?? ''}`.trim();
  if (!raw) return null;
  const normalized = normalizeSlotText(raw);
  const now = new Date();

  if (/\bheute\b/.test(normalized)) return localDateKey(now);
  if (/\buebermorgen\b/.test(normalized)) {
    const date = new Date(now);
    date.setDate(now.getDate() + 2);
    return localDateKey(date);
  }
  if (/\bmorgen\b/.test(normalized)) {
    const date = new Date(now);
    date.setDate(now.getDate() + 1);
    return localDateKey(date);
  }

  const isoDate = raw.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoDate) {
    const date = buildLocalDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]), { hour: 12, minute: 0 });
    return date ? localDateKey(date) : null;
  }

  return null;
}

function localDateKey(date: Date): string {
  const parts = berlinParts(date);
  return `${parts.year}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

function localTimeKey(date: Date): string {
  const parts = berlinParts(date);
  return `${parts.hour.toString().padStart(2, '0')}:${parts.minute.toString().padStart(2, '0')}`;
}

async function isChipySlotAvailable(orgId: string, slotTime: Date, staffId?: string | null): Promise<boolean> {
  const { schedule, blocks, timeBlocks } = await getChipySchedule(orgId, staffId);
  const dateStr = localDateKey(slotTime);
  if (blocks.includes(dateStr)) return false;

  const dayConfig = schedule[slotTime.getDay().toString()] ?? DEFAULT_CHIPPY_SCHEDULE[slotTime.getDay().toString()];
  if (!dayConfig?.enabled) return false;

  const timeStr = localTimeKey(slotTime);
  if (timeStr < dayConfig.start.slice(0, 5) || timeStr >= dayConfig.end.slice(0, 5)) return false;

  const dayBlocks = timeBlocks.filter((b) => b.date === dateStr);
  return !dayBlocks.some((b) =>
    b.start_time && b.end_time && timeStr >= b.start_time.slice(0, 5) && timeStr < b.end_time.slice(0, 5)
  );
}

function normalizeSourceCallId(sourceCallId: string | undefined): string | null {
  const trimmed = sourceCallId?.trim();
  if (!trimmed || trimmed === 'retell') return null;
  return trimmed.slice(0, 160);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseExternalBookingRefs(raw: unknown): ExternalBookingRefs {
  if (!isRecord(raw)) return {};
  const refs: ExternalBookingRefs = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const provider = typeof value.provider === 'string' ? value.provider : null;
    const connectionId = typeof value.connectionId === 'string' ? value.connectionId : null;
    const ok = typeof value.ok === 'boolean' ? value.ok : null;
    if (!provider || !connectionId || ok === null) continue;
    refs[key] = {
      provider,
      connectionId,
      ok,
      eventId: typeof value.eventId === 'string' ? value.eventId : undefined,
      bookingId: typeof value.bookingId === 'string' || typeof value.bookingId === 'number' ? value.bookingId : undefined,
      error: typeof value.error === 'string' ? value.error : undefined,
      reused: typeof value.reused === 'boolean' ? value.reused : undefined,
      bookedAt: typeof value.bookedAt === 'string' ? value.bookedAt : undefined,
    };
  }
  return refs;
}

function externalBookingKey(conn: CalendarConnection): string {
  return `${conn.provider}:${conn.id}`;
}

async function claimChipyBooking(
  orgId: string,
  opts: { customerName: string; customerPhone: string; service: string; notes?: string; sourceCallId?: string },
  slotTime: Date,
  staffId?: string | null,
): Promise<{ ok: true; id?: string; externalRefs: ExternalBookingRefs; reused: boolean } | { ok: false; error: string }> {
  if (!pool) return { ok: true, externalRefs: {}, reused: false };

  const sourceCallId = normalizeSourceCallId(opts.sourceCallId);
  if (staffId) {
    const inserted = await pool.query<ChipyBookingState>(
      `INSERT INTO staff_chipy_bookings
         (org_id, staff_id, customer_name, customer_phone, service, notes, slot_time, source_call_id, external_refs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb)
       ON CONFLICT (org_id, staff_id, slot_time) DO NOTHING
       RETURNING id, source_call_id, external_refs`,
      [
        orgId,
        staffId,
        opts.customerName,
        opts.customerPhone,
        opts.service || null,
        opts.notes || null,
        slotTime.toISOString(),
        sourceCallId,
      ],
    );
    const newRow = inserted.rows[0];
    if (newRow) {
      return { ok: true, id: newRow.id, externalRefs: parseExternalBookingRefs(newRow.external_refs), reused: false };
    }

    const existing = await pool.query<ChipyBookingState>(
      `SELECT id, source_call_id, external_refs
       FROM staff_chipy_bookings
       WHERE org_id = $1 AND staff_id = $2 AND slot_time = $3
       LIMIT 1`,
      [orgId, staffId, slotTime.toISOString()],
    );
    const existingRow = existing.rows[0];
    if (existingRow && sourceCallId && existingRow.source_call_id === sourceCallId) {
      return { ok: true, id: existingRow.id, externalRefs: parseExternalBookingRefs(existingRow.external_refs), reused: true };
    }

    return { ok: false, error: `Staff Chipy slot already booked: ${slotTime.toISOString()}` };
  }

  const inserted = await pool.query<ChipyBookingState>(
    `INSERT INTO chipy_bookings
       (org_id, customer_name, customer_phone, service, notes, slot_time, source_call_id, external_refs)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb)
     ON CONFLICT (org_id, slot_time) DO NOTHING
     RETURNING id, source_call_id, external_refs`,
    [
      orgId,
      opts.customerName,
      opts.customerPhone,
      opts.service || null,
      opts.notes || null,
      slotTime.toISOString(),
      sourceCallId,
    ],
  );
  const newRow = inserted.rows[0];
  if (newRow) {
    return { ok: true, id: newRow.id, externalRefs: parseExternalBookingRefs(newRow.external_refs), reused: false };
  }

  const existing = await pool.query<ChipyBookingState>(
    `SELECT id, source_call_id, external_refs
     FROM chipy_bookings
     WHERE org_id = $1 AND slot_time = $2
     LIMIT 1`,
    [orgId, slotTime.toISOString()],
  );
  const existingRow = existing.rows[0];
  if (existingRow && sourceCallId && existingRow.source_call_id === sourceCallId) {
    return { ok: true, id: existingRow.id, externalRefs: parseExternalBookingRefs(existingRow.external_refs), reused: true };
  }

  return { ok: false, error: `Chipy slot already booked: ${slotTime.toISOString()}` };
}

async function loadChipyExternalRefs(
  orgId: string,
  bookingId: string | undefined,
  fallback: ExternalBookingRefs,
  staffId?: string | null,
): Promise<ExternalBookingRefs> {
  if (!pool || !bookingId) return fallback;
  const res = staffId
    ? await pool.query<Pick<ChipyBookingState, 'external_refs'>>(
        `SELECT external_refs FROM staff_chipy_bookings WHERE org_id = $1 AND staff_id = $2 AND id = $3`,
        [orgId, staffId, bookingId],
      )
    : await pool.query<Pick<ChipyBookingState, 'external_refs'>>(
        `SELECT external_refs FROM chipy_bookings WHERE org_id = $1 AND id = $2`,
        [orgId, bookingId],
      );
  return parseExternalBookingRefs(res.rows[0]?.external_refs ?? fallback);
}

async function saveChipyExternalRefs(
  orgId: string,
  bookingId: string | undefined,
  refs: ExternalBookingRefs,
  staffId?: string | null,
): Promise<void> {
  if (!pool || !bookingId) return;
  if (staffId) {
    await pool.query(
      `UPDATE staff_chipy_bookings SET external_refs = $4::jsonb WHERE org_id = $1 AND staff_id = $2 AND id = $3`,
      [orgId, staffId, bookingId, JSON.stringify(refs)],
    );
    return;
  }
  await pool.query(
    `UPDATE chipy_bookings SET external_refs = $3::jsonb WHERE org_id = $1 AND id = $2`,
    [orgId, bookingId, JSON.stringify(refs)],
  );
}

async function withChipyBookingLock<T>(
  orgId: string,
  bookingId: string | undefined,
  fn: () => Promise<T>,
  staffId?: string | null,
): Promise<T> {
  if (!bookingId || !redis?.isOpen) return fn();

  const lockKey = `calendar_booking:${orgId}:${staffId ?? 'salon'}:${bookingId}`;
  const lockToken = crypto.randomUUID();
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const acquired = await redis.set(lockKey, lockToken, { NX: true, EX: 45 }).catch(() => null);
    if (acquired) {
      try {
        return await fn();
      } finally {
        const current = await redis.get(lockKey).catch(() => null);
        if (current === lockToken) {
          await redis.del(lockKey).catch(() => undefined);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return fn();
}

async function deleteChipyBooking(orgId: string, bookingId: string | undefined, staffId?: string | null): Promise<void> {
  if (!pool || !bookingId) return;
  if (staffId) {
    await pool.query(`DELETE FROM staff_chipy_bookings WHERE id = $1 AND org_id = $2 AND staff_id = $3`, [bookingId, orgId, staffId]).catch(() => {});
    return;
  }
  await pool.query(`DELETE FROM chipy_bookings WHERE id = $1 AND org_id = $2`, [bookingId, orgId]).catch(() => {});
}

// ── Cal.com helpers ───────────────────────────────────────────────────────────

interface CalcomAvailabilitySlot {
  time: string; // ISO datetime
}

interface CalcomAvailabilityResponse {
  slots?: Record<string, CalcomAvailabilitySlot[]>;
  busy?: { start: string; end: string }[];
}

async function calcomFindSlots(
  apiKey: string,
  opts: { dateFrom?: string; dateTo?: string },
): Promise<string[]> {
  const now = new Date();
  const dateFrom =
    opts.dateFrom ?? now.toISOString().slice(0, 10);
  const dateTo =
    opts.dateTo ??
    new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const params = new URLSearchParams({ apiKey, dateFrom, dateTo });
    const resp = await calFetch(`https://api.cal.com/v1/availability?${params}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!resp.ok) return [];

    const data = (await resp.json()) as CalcomAvailabilityResponse;

    // If the API returns a slots map (some event-type endpoints do)
    if (data.slots && typeof data.slots === 'object') {
      const slots: string[] = [];
      for (const daySlots of Object.values(data.slots)) {
        for (const slot of daySlots) {
          const d = new Date(slot.time);
          if (isNaN(d.getTime()) || d <= now) continue;
          const dayLabel = DAY_LABELS[d.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6];
          const hStr = d.getHours().toString().padStart(2, '0');
          const mStr = d.getMinutes().toString().padStart(2, '0');
          slots.push(`${dayLabel} ${hStr}:${mStr}`);
        }
      }
      return slots;
    }

    // If the API returns busy periods, generate free slots from them
    if (Array.isArray(data.busy)) {
      return generateFreeSlots(data.busy);
    }

    return [];
  } catch {
    return [];
  }
}

interface CalcomBookingOpts {
  eventTypeId: number;
  start: string; // ISO datetime
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
}

interface CalcomBookingResponse {
  id?: number;
  uid?: string;
  message?: string;
  error?: string;
}

async function calcomBookSlot(
  apiKey: string,
  opts: CalcomBookingOpts,
): Promise<{ ok: boolean; bookingId?: number; error?: string }> {
  try {
    const resp = await calFetch(`https://api.cal.com/v1/bookings?apiKey=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventTypeId: opts.eventTypeId,
        start: opts.start,
        responses: {
          name: opts.name,
          email: opts.email ?? '',
          phone: opts.phone ?? '',
          notes: opts.notes ?? '',
        },
        timeZone: 'Europe/Berlin',
        language: 'de',
        metadata: {},
      }),
    });

    const data = (await resp.json()) as CalcomBookingResponse;

    if (!resp.ok) {
      return { ok: false, error: data.message ?? data.error ?? `Cal.com API ${resp.status}` };
    }

    return { ok: true, bookingId: data.id };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: msg };
  }
}

interface CalcomEventType {
  id: number;
  title: string;
  length: number;
}

interface CalcomEventTypesResponse {
  event_types?: CalcomEventType[];
  eventTypes?: CalcomEventType[];
}

async function calcomGetEventTypes(apiKey: string): Promise<CalcomEventType[]> {
  try {
    const resp = await calFetch(
      `https://api.cal.com/v1/event-types?apiKey=${encodeURIComponent(apiKey)}`,
      { headers: { 'Content-Type': 'application/json' } },
    );

    if (!resp.ok) return [];

    const data = (await resp.json()) as CalcomEventTypesResponse;
    // Cal.com v1 returns { event_types: [...] }
    const list = data.event_types ?? data.eventTypes ?? [];
    return list.map((et) => ({ id: et.id, title: et.title, length: et.length }));
  } catch {
    return [];
  }
}

// ── Public Calendar Helpers (used by agent-tools) ─────────────────────────────

export async function findFreeSlots(
  orgId: string,
  opts: { date?: string; range?: string; service?: string; staffId?: string | null },
): Promise<{ slots: string[]; source: string }> {
  return findFreeSlotsByContract(orgId, opts);

  // Search ALL connected calendars + Chipy, merge results.
  // Chipy calendar acts as the MASTER scheduler: blocked days/times in
  // Chipy are removed from ALL sources (including external calendars).
  const staffId = await assertStaffBelongs(orgId, opts.staffId);
  const connections = await getCheckableConnections(orgId, staffId);
  const allSlots: string[] = [];
  const sources: string[] = [];

  // Always load Chipy schedule (needed for blocking even if no Chipy slots)
  const { schedule, blocks, timeBlocks } = await getChipySchedule(orgId, staffId);
  const hasChipy = Object.values(schedule).some((d) => d.enabled);
  if (hasChipy) {
    allSlots.push(...generateChipySlots(schedule, blocks, timeBlocks));
    sources.push('chipy');
  }

  // Check each external calendar
  for (const conn of connections) {
    try {
      const connSlots = await findSlotsForConnection(conn, orgId);
      const validSlots = connSlots ?? [];
      if (validSlots.length > 0) {
        allSlots.push(...validSlots);
        sources.push(conn.provider);
      }
    } catch {
      // Skip failed connections, continue with others
    }
  }

  if (allSlots.length === 0 && sources.length === 0) {
    return { slots: [], source: 'not-connected' };
  }

  // Deduplicate and sort slots
  let unique = [...new Set(allSlots)].sort();

  // ── Chipy-block filter: remove slots that fall on blocked days/times ──
  // This ensures Chipy blocks are authoritative even when external calendars
  // report those times as free. Without this, a blocked Monday in Chipy would
  // still show up if Google Calendar has Monday slots.
  if (blocks.length > 0 || timeBlocks.length > 0) {
    const blockedDates = new Set(blocks); // full-day blocks: "2026-04-21"
    const now = new Date();

    unique = unique.filter((slot) => {
      // Slots are formatted as "Montag 14:00" or "2026-04-21T14:00" etc.
      // Try to resolve the slot to a concrete date for blocking checks.
      const resolved = resolveSlotDate(slot, now);
      if (!resolved) return true; // can't parse → keep it

      const { dateStr, timeStr } = resolved;

      // Full-day block check
      if (blockedDates.has(dateStr)) return false;

      // Time-range block check
      if (timeStr) {
        const dayBlocks = timeBlocks.filter(b => b.date === dateStr);
        for (const b of dayBlocks) {
          if (b.start_time && b.end_time && timeStr >= b.start_time.slice(0, 5) && timeStr < b.end_time.slice(0, 5)) {
            return false;
          }
        }
      }

      return true;
    });
  }

  return { slots: unique, source: sources.join('+') || 'chipy' };
}

async function findFreeSlotsByContract(
  orgId: string,
  opts: { date?: string; range?: string; service?: string; staffId?: string | null },
): Promise<{ slots: string[]; source: string }> {
  const staffId = await assertStaffBelongs(orgId, opts.staffId);
  const connections = await getCheckableConnections(orgId, staffId);
  const sources = ['chipy'];
  const { schedule, blocks, timeBlocks } = await getChipySchedule(orgId, staffId);
  let slots = generateChipySlots(schedule, blocks, timeBlocks, requestedDateKey(opts));

  if (connections.length === 0) {
    return { slots: [...new Set(slots)].sort(), source: 'chipy' };
  }

  if (slots.length === 0) {
    return { slots: [], source: `chipy+${connections.map((c) => c.provider).join('+')}` };
  }

  for (const conn of connections) {
    let connSlots: string[] | null = [];
    try {
      connSlots = await findSlotsForConnection(conn, orgId);
    } catch {
      connSlots = null;
    }
    if (connSlots === null) continue;

    sources.push(conn.provider);
    const connSet = new Set(connSlots);
    slots = slots.filter((slot) => connSet.has(slot));
    if (slots.length === 0) break;
  }

  return { slots: [...new Set(slots)].sort(), source: sources.join('+') };
}

/** Resolve a human-readable slot like "Montag 14:00" to a concrete date string. */
function resolveSlotDate(slot: string, now: Date): { dateStr: string; timeStr: string | null } | null {
  // ISO format: "2026-04-21T14:00"
  const isoMatch = slot.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (isoMatch) {
    return { dateStr: isoMatch[1]!, timeStr: isoMatch[2] ?? null };
  }

  // German day label format: "Montag 14:00", "Dienstag 09:30"
  const dayMap: Record<string, number> = {
    'Sonntag': 0, 'Montag': 1, 'Dienstag': 2, 'Mittwoch': 3,
    'Donnerstag': 4, 'Freitag': 5, 'Samstag': 6,
    'So': 0, 'Mo': 1, 'Di': 2, 'Mi': 3, 'Do': 4, 'Fr': 5, 'Sa': 6,
  };
  const labelMatch = slot.match(/^(\w+)\s+(\d{2}:\d{2})/);
  if (labelMatch) {
    const targetDow = dayMap[labelMatch[1]!];
    if (targetDow === undefined) return null;
    const timeStr = labelMatch[2]!;

    // Find the next occurrence of this day-of-week within 14 days
    for (let d = 0; d < 14; d++) {
      const date = new Date(now);
      date.setDate(now.getDate() + d);
      if (date.getDay() === targetDow) {
        return { dateStr: localDateKey(date), timeStr };
      }
    }
  }

  return null;
}

async function findSlotsForConnection(
  conn: CalendarConnection,
  orgId: string,
): Promise<string[] | null> {
  // ── Cal.com path ───────────────────────────────────────────────────────────
  if (conn.provider === 'calcom') {
    const apiKey = conn.api_key;
    if (!apiKey) return null;

    const now = new Date();
    const dateFrom = now.toISOString().slice(0, 10);
    const dateTo = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const slots = await calcomFindSlots(apiKey, { dateFrom, dateTo });
    return slots;
  }

  // ── Microsoft path ─────────────────────────────────────────────────────────
  if (conn.provider === 'microsoft') {
    const token = await getValidMsTokenForConnection(conn);
    if (!token) return null;
    const email = conn.email ?? '';
    return msFindSlots(token, email);
  }

  // ── Google path ────────────────────────────────────────────────────────────
  const token = await getValidTokenForConnection(conn);
  if (!token) return null;

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const resp = await calFetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: conn.calendar_id }],
      }),
    });

    if (!resp.ok) {
      // Visibility fix 2026-04-23: prior code silently returned null on any
      // upstream non-2xx, which hid months of 403 errors from the
      // "Google Calendar API has not been enabled in project X" problem.
      // The silent fallback meant the agent quietly ignored Google
      // availability and booked over existing external events. Logging the
      // status + a truncated body surfaces the issue to ops without risking
      // PII leakage (Google error bodies don't carry calendar content).
      const body = (await resp.text().catch(() => '')).slice(0, 200);
      log.warn(
        { orgId, provider: 'google', status: resp.status, body },
        'calendar: freeBusy returned non-2xx, falling back to chipy-only',
      );
      return null;
    }

    const data = (await resp.json()) as {
      calendars: Record<string, { busy: { start: string; end: string }[] }>;
    };

    const busyPeriods = data.calendars[conn.calendar_id]?.busy ?? [];
    return generateFreeSlots(busyPeriods);
  } catch (err) {
    log.warn(
      { orgId, provider: 'google', err: (err as Error).message?.slice(0, 200) },
      'calendar: freeBusy threw, falling back to chipy-only',
    );
    return null;
  }
}

export async function bookSlot(
  orgId: string,
  opts: {
    customerName: string;
    customerPhone: string;
    time: string;
    service: string;
    notes?: string;
    sourceCallId?: string;
    staffId?: string | null;
  },
): Promise<{
  ok: boolean;
  eventId?: string;
  bookingId?: number | string;
  chipyBookingId?: string;
  externalResults?: ExternalBookingResult[];
  partial?: boolean;
  error?: string;
}> {
  const staffId = await assertStaffBelongs(orgId, opts.staffId);
  const connections = await getCheckableConnections(orgId, staffId);
  const slotTime = parseSlotTime(opts.time);
  if (!slotTime) return { ok: false, error: `Cannot parse time: ${opts.time}` };
  if (!(await isChipySlotAvailable(orgId, slotTime, staffId))) {
    return { ok: false, error: `Chipy slot unavailable: ${opts.time}` };
  }

  let chipyBooking: { id?: string; externalRefs: ExternalBookingRefs; reused: boolean };
  try {
    const claimed = await claimChipyBooking(orgId, opts, slotTime, staffId);
    if (!claimed.ok) return { ok: false, error: claimed.error };
    chipyBooking = claimed;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `Chipy booking failed: ${e.message}` : 'Chipy booking failed' };
  }

  // No external calendars — book directly into Chipy
  if (connections.length === 0) {
    return { ok: true, eventId: chipyBooking.id, bookingId: chipyBooking.id, chipyBookingId: chipyBooking.id };
  }

  return withChipyBookingLock(orgId, chipyBooking.id, async () => {
    const refs = await loadChipyExternalRefs(orgId, chipyBooking.id, chipyBooking.externalRefs, staffId);
    const results: ExternalBookingResult[] = [];

    for (const conn of connections) {
      const key = externalBookingKey(conn);
      const existingRef = refs[key];
      if (existingRef?.ok) {
        results.push({ ...existingRef, reused: true });
        continue;
      }

      const bookedAt = new Date().toISOString();
      let nextRef: ExternalBookingResult;
      try {
        const result = await bookSlotForConnection(conn, orgId, opts);
        nextRef = {
          provider: conn.provider,
          connectionId: conn.id,
          ok: result.ok,
          eventId: result.eventId,
          bookingId: result.bookingId,
          error: result.error,
          bookedAt,
        };
      } catch (e) {
        nextRef = {
          provider: conn.provider,
          connectionId: conn.id,
          ok: false,
          error: e instanceof Error ? e.message : 'Unknown error',
          bookedAt,
        };
      }

      refs[key] = nextRef;
      results.push(nextRef);
      await saveChipyExternalRefs(orgId, chipyBooking.id, refs, staffId);
    }

    // Chipy is the source of truth for the customer-facing booking. External
    // calendars are best-effort mirrors: failures stay recorded so a retry from
    // the same call can complete missing calendars, but they do not turn a
    // successful Chipy booking into a failed appointment.
    const allExternalSucceeded = results.length > 0 && results.every((r) => r.ok);
    const firstSuccess = results.find((r) => r.ok);

    if (allExternalSucceeded) {
      return {
        ok: true,
        eventId: firstSuccess?.eventId ?? chipyBooking.id,
        bookingId: firstSuccess?.bookingId ?? chipyBooking.id,
        chipyBookingId: chipyBooking.id,
        externalResults: results,
      };
    }

    const failed = results.filter((r) => !r.ok);
    return {
      ok: true,
      eventId: chipyBooking.id,
      bookingId: chipyBooking.id,
      partial: failed.length > 0,
      chipyBookingId: chipyBooking.id,
      externalResults: results,
    };
  }, staffId);
}

async function bookSlotForConnection(
  conn: CalendarConnection,
  orgId: string,
  opts: { customerName: string; customerPhone: string; time: string; service: string; notes?: string },
): Promise<{ ok: boolean; eventId?: string; bookingId?: number | string; error?: string }> {

  // ── Microsoft path ─────────────────────────────────────────────────────────
  if (conn.provider === 'microsoft') {
    const token = await getValidMsTokenForConnection(conn);
    if (!token) return { ok: false, error: 'Microsoft calendar not connected' };
    return msBookSlot(token, opts);
  }

  // ── Cal.com path ───────────────────────────────────────────────────────────
  if (conn.provider === 'calcom') {
    const apiKey = conn.api_key;
    if (!apiKey) return { ok: false, error: 'calcom-no-key' };

    const eventTypes = await calcomGetEventTypes(apiKey);
    const eventType = eventTypes[0];
    if (!eventType) return { ok: false, error: 'No event type configured in Cal.com' };

    const startTime = parseSlotTime(opts.time);
    if (!startTime) return { ok: false, error: `Cannot parse time: ${opts.time}` };

    return calcomBookSlot(apiKey, {
      eventTypeId: eventType.id,
      start: startTime.toISOString(),
      name: opts.customerName,
      phone: opts.customerPhone,
      notes: opts.notes,
    });
  }

  // ── Google path ────────────────────────────────────────────────────────────
  const token = await getValidTokenForConnection(conn);
  if (!token) return { ok: false, error: 'Calendar not connected' };

  const startTime = parseSlotTime(opts.time);
  if (!startTime) {
    return { ok: false, error: `Cannot parse time: ${opts.time}` };
  }
  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

  const description = [
    `Service: ${opts.service}`,
    `Customer: ${opts.customerName}`,
    `Phone: ${opts.customerPhone}`,
    opts.notes ? `Notes: ${opts.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const resp = await calFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(conn.calendar_id)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: `${opts.service} – ${opts.customerName}`,
          description,
          start: { dateTime: startTime.toISOString() },
          end: { dateTime: endTime.toISOString() },
        }),
      },
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { ok: false, error: `Google API ${resp.status}: ${body}` };
    }

    const event = (await resp.json()) as { id: string };
    return { ok: true, eventId: event.id };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: msg };
  }
}

// ── Route Registration ────────────────────────────────────────────────────────

export async function registerCalendar(app: FastifyInstance): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3001/calendar/google/callback';
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  const SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ].join(' ');

  const OptionalStaffQuerySchema = z.object({
    staffId: z.string().uuid().optional(),
  });

  async function resolveRouteStaff(
    orgId: string,
    staffId: string | undefined,
    reply: FastifyReply,
  ): Promise<{ ok: true; staffId: string | null } | { ok: false }> {
    try {
      return { ok: true, staffId: await assertStaffBelongs(orgId, staffId) };
    } catch (e) {
      if (e instanceof StaffNotFoundError) {
        reply.status(404).send({ error: 'STAFF_NOT_FOUND' });
        return { ok: false };
      }
      throw e;
    }
  }

  /**
   * GET /calendar/google/auth-url
   * Returns the Google OAuth URL as JSON (for frontend to redirect).
   * Requires a valid JWT.
   */
  app.get(
    '/calendar/google/auth-url',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!clientId) {
        return reply.status(503).send({ error: 'Google OAuth not configured (GOOGLE_CLIENT_ID missing)' });
      }

      const { orgId } = req.user as JwtPayload;
      const staffQuery = OptionalStaffQuerySchema.safeParse(req.query);
      if (!staffQuery.success) return reply.status(400).send({ error: 'Invalid staffId' });
      const staff = await resolveRouteStaff(orgId, staffQuery.data.staffId, reply);
      if (!staff.ok) return;

      const state = signOAuthState(orgId, 'google', staff.staffId);

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state,
      });

      const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      return reply.send({ url });
    },
  );

  /**
   * GET /calendar/google/connect
   * Initiates the OAuth consent screen redirect. Requires a valid JWT (user must be logged in).
   */
  app.get(
    '/calendar/google/connect',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!clientId) {
        return reply.status(503).send({ error: 'Google OAuth not configured (GOOGLE_CLIENT_ID missing)' });
      }

      const { orgId } = req.user as JwtPayload;
      const staffQuery = OptionalStaffQuerySchema.safeParse(req.query);
      if (!staffQuery.success) return reply.status(400).send({ error: 'Invalid staffId' });
      const staff = await resolveRouteStaff(orgId, staffQuery.data.staffId, reply);
      if (!staff.ok) return;

      // Short-lived HMAC state token (separate secret to prevent CSRF / JWT-leak cross-contamination)
      const state = signOAuthState(orgId, 'google', staff.staffId);

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent', // always request refresh_token
        state,
      });

      return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    },
  );

  /**
   * GET /calendar/google/callback
   * Google redirects here with ?code=...&state=...
   * No JWT auth required — the state param carries orgId.
   */
  app.get('/calendar/google/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    // CAL-06: cap the incoming code/state so an attacker can't POST an
    // oversize query (Google caps at ~500 chars anyway; 1000 is a safe ceiling).
    const parsed = z.object({
      code: z.string().max(1000).optional(),
      state: z.string().max(500).optional(),
      error: z.string().max(100).optional(),
    }).safeParse(req.query);
    if (!parsed.success) {
      return reply.redirect(`${appUrl}?calendarError=invalid_callback`);
    }
    const { code, state, error } = parsed.data;

    if (error || !code || !state) {
      const reason = encodeURIComponent(error ?? 'missing_params');
      return reply.redirect(`${appUrl}?calendarError=${reason}`);
    }

    if (!clientId || !clientSecret) {
      return reply.redirect(`${appUrl}?calendarError=not_configured`);
    }

    // Verify HMAC state → extract orgId (rejects expired/forged/wrong-provider states)
    const verified = await verifyOAuthState(state, 'google');
    if (!verified) {
      return reply.redirect(`${appUrl}?calendarError=invalid_state`);
    }
    const orgId = verified.orgId;
    let staffId: string | null = null;
    try {
      staffId = await assertStaffBelongs(orgId, verified.staffId);
    } catch (e) {
      if (e instanceof StaffNotFoundError) {
        return reply.redirect(`${appUrl}?calendarError=staff_not_found`);
      }
      throw e;
    }
    // Exchange authorization code for tokens
    const tokenResp = await calFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!tokenResp.ok) {
      return reply.redirect(`${appUrl}?calendarError=token_exchange_failed`);
    }

    const tokens = (await tokenResp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Fetch the Google account email (non-critical)
    let calendarEmail: string | null = null;
    try {
      const profileResp = await calFetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (profileResp.ok) {
        const profile = (await profileResp.json()) as { email?: string };
        calendarEmail = profile.email ?? null;
      }
    } catch {
      /* non-critical — continue without email */
    }

    if (!pool) {
      return reply.redirect(`${appUrl}?calendarConnected=true&dev=true`);
    }

    await upsertCalendarConnection({
      orgId,
      staffId,
      provider: 'google',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiresAt: expiresAt,
      calendarId: 'primary',
      email: calendarEmail,
    });

    // Return a small HTML page that notifies the opener (dashboard) and
    // closes this OAuth tab automatically — much better UX than leaving
    // a stale redirect page open.
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(`<!DOCTYPE html><html><head><title>Verbunden!</title></head><body style="background:#0A0A0F;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center">
  <p style="font-size:1.25rem;font-weight:600;margin-bottom:.5rem">\u2705 Google Kalender verbunden!</p>
  <p style="color:rgba(255,255,255,.5);font-size:.875rem">Dieses Fenster schlie\u00dft sich automatisch\u2026</p>
</div>
<script>
if(window.opener){try{window.opener.postMessage({type:'calendarConnected',provider:'google'}, ${JSON.stringify(appUrl)})}catch(e){}}
setTimeout(function(){window.close()},1500);
setTimeout(function(){window.location.href = ${JSON.stringify(appUrl)} + '?calendarConnected=true'},3000);
</script></body></html>`);
  });

  /**
   * POST /calendar/calcom/connect
   * Connect a Cal.com account via API key. Validates the key against Cal.com /me endpoint.
   */
  app.post(
    '/calendar/calcom/connect',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = req.user as JwtPayload;
      // CAL-03: bound apiKey length so a 1MB string can't land in the DB and
      // be decrypted + sent upstream on every request. Cal.com keys follow
      // `cal_live_<uuid>` / `cal_test_<uuid>` — ~40 chars — 10..200 covers all.
      const parsed = z.object({
        apiKey: z.string().min(10).max(200),
        username: z.string().max(100).optional(),
        staffId: z.string().uuid().optional(),
      }).safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'apiKey required (10-200 chars)' });
      }
      const { apiKey, username: usernameInput } = parsed.data;
      const staff = await resolveRouteStaff(orgId, parsed.data.staffId, reply);
      if (!staff.ok) return;

      // Validate key via Cal.com /me
      let calEmail: string | null = null;
      let calUsername: string | null = usernameInput ?? null;

      try {
        const meResp = await calFetch(
          `https://api.cal.com/v1/me?apiKey=${encodeURIComponent(apiKey)}`,
          { headers: { 'Content-Type': 'application/json' } },
        );

        if (!meResp.ok) {
          return reply.status(401).send({ error: 'Invalid Cal.com API key' });
        }

        const me = (await meResp.json()) as { email?: string; username?: string };
        calEmail = me.email ?? null;
        calUsername = calUsername ?? me.username ?? null;
      } catch {
        return reply.status(502).send({ error: 'Could not reach Cal.com API' });
      }

      if (!pool) {
        return reply.send({ ok: true, email: calEmail, username: calUsername, note: 'no-db' });
      }

      // Upsert — provider='calcom', api_key holds the key; access_token not used (set empty)
      await upsertCalendarConnection({
        orgId,
        staffId: staff.staffId,
        provider: 'calcom',
        accessToken: '',
        calendarId: 'calcom',
        email: calEmail,
        apiKey,
        username: calUsername,
      });

      return reply.send({ ok: true, email: calEmail, username: calUsername });
    },
  );

  /**
   * GET /calendar/status
   * Returns whether the org has a connected calendar and which account.
   * For Cal.com connections, also returns the configured event types.
   */
  app.get(
    '/calendar/status',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = req.user as JwtPayload;
      const staffQuery = OptionalStaffQuerySchema.safeParse(req.query);
      if (!staffQuery.success) return reply.status(400).send({ error: 'Invalid staffId' });
      const staff = await resolveRouteStaff(orgId, staffQuery.data.staffId, reply);
      if (!staff.ok) return;

      if (!pool) {
        return reply.send({ connected: false, source: 'no-db' });
      }

      // Check if Chipy built-in calendar has configured hours
      const { schedule } = await getChipySchedule(orgId, staff.staffId);
      const hasChipy = Object.values(schedule).some((d) => d.enabled);
      const connections = await getAllConnections(orgId, staff.staffId);
      const connectionStatuses = await Promise.all(connections.map((conn) => getConnectionStatus(conn, orgId)));
      const primary = connectionStatuses.find((conn) => conn.connected) ?? connectionStatuses[0] ?? null;

      if (!primary) {
        // No external calendar — report Chipy status
        return reply.send({
          connected: hasChipy,
          provider: hasChipy ? 'chipy' : null,
          staffId: staff.staffId,
          email: null,
          connections: connectionStatuses,
          chipy: { configured: hasChipy, schedule },
        });
      }

      const connectionValid = primary.connected;
      const base = {
        connected: connectionValid,
        provider: connectionValid ? primary.provider : (hasChipy ? 'chipy' : null),
        staffId: staff.staffId,
        email: connectionValid ? (primary.email ?? null) : null,
        calendarId: primary.calendarId ?? null,
        connections: connectionStatuses,
        chipy: { configured: hasChipy, schedule },
        ...((!connectionValid && primary.provider) ? { expired: true, expiredProvider: primary.provider } : {}),
      };

      if (primary.provider === 'calcom') {
        return reply.send({ ...base, username: primary.username ?? null, eventTypes: primary.eventTypes ?? [] });
      }

      return reply.send(base);
    },
  );

  /**
   * DELETE /calendar/disconnect
   * Removes the org's calendar connection.
   */
  app.delete(
    '/calendar/disconnect',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = req.user as JwtPayload;
      const parsed = z.object({
        provider: z.enum(CALENDAR_PROVIDERS).optional(),
        staffId: z.string().uuid().optional(),
      }).safeParse(req.query);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid provider' });
      const provider = parsed.data.provider;
      const staff = await resolveRouteStaff(orgId, parsed.data.staffId, reply);
      if (!staff.ok) return;

      if (!pool) {
        return reply.send({ ok: true, note: 'No-op (no database configured)' });
      }

      if (provider) {
        if (staff.staffId) {
          await pool.query(
            `DELETE FROM calendar_connections WHERE org_id = $1 AND staff_id = $2 AND provider = $3`,
            [orgId, staff.staffId, provider],
          );
        } else {
          await pool.query(
            `DELETE FROM calendar_connections WHERE org_id = $1 AND staff_id IS NULL AND provider = $2`,
            [orgId, provider],
          );
        }
        return reply.send({ ok: true, provider });
      }

      const existing = await pool.query<{ provider: string }>(
        staff.staffId
          ? `SELECT provider FROM calendar_connections WHERE org_id = $1 AND staff_id = $2 ORDER BY created_at`
          : `SELECT provider FROM calendar_connections WHERE org_id = $1 AND staff_id IS NULL ORDER BY created_at`,
        staff.staffId ? [orgId, staff.staffId] : [orgId],
      );
      if (existing.rows.length > 1) {
        return reply.status(409).send({
          error: 'PROVIDER_REQUIRED',
          providers: existing.rows.map((row) => row.provider),
          message: 'Multiple calendar providers are connected; pass ?provider=google|microsoft|calcom.',
        });
      }

      if (staff.staffId) {
        await pool.query(
          `DELETE FROM calendar_connections WHERE org_id = $1 AND staff_id = $2`,
          [orgId, staff.staffId],
        );
      } else {
        await pool.query(
          `DELETE FROM calendar_connections WHERE org_id = $1 AND staff_id IS NULL`,
          [orgId],
        );
      }

      return reply.send({ ok: true });
    },
  );

  // ── Microsoft Calendar OAuth ───────────────────────────────────────────────

  const msClientId = process.env.MICROSOFT_CLIENT_ID;
  const msClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const msRedirectUri =
    process.env.MICROSOFT_REDIRECT_URI ?? 'http://localhost:3001/calendar/microsoft/callback';
  const msScopes = 'https://graph.microsoft.com/Calendars.ReadWrite offline_access User.Read';

  /**
   * GET /calendar/microsoft/auth-url
   * Returns the Microsoft OAuth URL for the frontend to redirect to.
   */
  app.get(
    '/calendar/microsoft/auth-url',
    { onRequest: [app.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!msClientId) {
        return reply.status(503).send({ error: 'Microsoft OAuth not configured (MICROSOFT_CLIENT_ID missing)' });
      }

      const { orgId } = req.user as JwtPayload;
      const staffQuery = OptionalStaffQuerySchema.safeParse(req.query);
      if (!staffQuery.success) return reply.status(400).send({ error: 'Invalid staffId' });
      const staff = await resolveRouteStaff(orgId, staffQuery.data.staffId, reply);
      if (!staff.ok) return;
      const state = signOAuthState(orgId, 'microsoft', staff.staffId);

      const params = new URLSearchParams({
        client_id: msClientId,
        redirect_uri: msRedirectUri,
        response_type: 'code',
        scope: msScopes,
        response_mode: 'query',
        state,
      });

      const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
      return reply.send({ url });
    },
  );

  /**
   * GET /calendar/microsoft/callback
   * Microsoft redirects here with ?code=...&state=...
   */
  app.get('/calendar/microsoft/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    // CAL-06: bound callback params (Microsoft emits ~400 chars for code).
    const parsed = z.object({
      code: z.string().max(1000).optional(),
      state: z.string().max(500).optional(),
      error: z.string().max(100).optional(),
    }).safeParse(req.query);
    if (!parsed.success) {
      return reply.redirect(`${appUrl}?calendarError=invalid_callback`);
    }
    const { code, state, error } = parsed.data;

    if (error || !code || !state) {
      return reply.redirect(`${appUrl}?calendarError=${encodeURIComponent(error ?? 'missing_params')}`);
    }

    if (!msClientId || !msClientSecret) {
      return reply.redirect(`${appUrl}?calendarError=not_configured`);
    }

    const verified = await verifyOAuthState(state, 'microsoft');
    if (!verified) {
      return reply.redirect(`${appUrl}?calendarError=invalid_state`);
    }
    const orgId = verified.orgId;
    let staffId: string | null = null;
    try {
      staffId = await assertStaffBelongs(orgId, verified.staffId);
    } catch (e) {
      if (e instanceof StaffNotFoundError) {
        return reply.redirect(`${appUrl}?calendarError=staff_not_found`);
      }
      throw e;
    }

    // Exchange code for tokens
    const tokenResp = await calFetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: msClientId,
          client_secret: msClientSecret,
          redirect_uri: msRedirectUri,
          grant_type: 'authorization_code',
          scope: msScopes,
          code,
        }),
      },
    );

    if (!tokenResp.ok) {
      return reply.redirect(`${appUrl}?calendarError=token_exchange_failed`);
    }

    const tokens = (await tokenResp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Fetch Microsoft account email
    let msEmail: string | null = null;
    try {
      const meResp = await calFetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (meResp.ok) {
        const me = (await meResp.json()) as { mail?: string; userPrincipalName?: string };
        msEmail = me.mail ?? me.userPrincipalName ?? null;
      }
    } catch { /* non-critical */ }

    if (!pool) {
      return reply.redirect(`${appUrl}?calendarConnected=true&dev=true`);
    }

    // CAL-13: if Microsoft didn't grant offline_access (consent screen checkbox
    // or admin-policy), refresh_token is null → getValidMsToken will fail once
    // the access_token expires (~1h). Warn so ops can advise the user to reconnect.
    if (!tokens.refresh_token) {
      process.stderr.write(`[calendar] Microsoft callback for org ${orgId}: no refresh_token (offline_access not granted?). Calendar will stop working after ~1h.\n`);
    }

    await upsertCalendarConnection({
      orgId,
      staffId,
      provider: 'microsoft',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiresAt: expiresAt,
      calendarId: 'primary',
      email: msEmail,
    });

    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(`<!DOCTYPE html><html><head><title>Verbunden!</title></head><body style="background:#0A0A0F;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center">
  <p style="font-size:1.25rem;font-weight:600;margin-bottom:.5rem">\u2705 Microsoft Kalender verbunden!</p>
  <p style="color:rgba(255,255,255,.5);font-size:.875rem">Dieses Fenster schlie\u00dft sich automatisch\u2026</p>
</div>
<script>
if(window.opener){try{window.opener.postMessage({type:'calendarConnected',provider:'microsoft'}, ${JSON.stringify(appUrl)})}catch(e){}}
setTimeout(function(){window.close()},1500);
setTimeout(function(){window.location.href = ${JSON.stringify(appUrl)} + '?calendarConnected=true'},3000);
</script></body></html>`);
  });

  // ── Chipy Calendar Routes ─────────────────────────────────────────────────

  const auth = { onRequest: [app.authenticate] };

  /** GET /calendar/chipy — get schedule + blocks + upcoming bookings */
  app.get('/calendar/chipy', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const { schedule } = await getChipySchedule(orgId);

    let bookings: unknown[] = [];
    if (pool) {
      const res = await pool.query(
        `SELECT id, customer_name, customer_phone, service, notes, slot_time
         FROM chipy_bookings WHERE org_id = $1 AND slot_time >= now()
         ORDER BY slot_time LIMIT 50`,
        [orgId],
      );
      bookings = res.rows;
    }

    const blockRes = pool ? await pool.query(
      `SELECT id, date::text, start_time::text, end_time::text, reason
       FROM chipy_blocks WHERE org_id = $1 AND date >= CURRENT_DATE ORDER BY date, start_time NULLS FIRST`,
      [orgId],
    ) : { rows: [] };

    return { schedule, blocks: blockRes.rows, bookings };
  });

  /** PUT /calendar/chipy — save weekly schedule */
  // CAL-09: Zod-validate the schedule blob so a 100MB JSON payload or a
  // deeply-nested prototype-pollution object can't land in the DB.
  const ChipyScheduleSchema = z.record(z.string(), z.object({
    enabled: z.boolean(),
    start: z.string().max(10),
    end: z.string().max(10),
  }));
  app.put('/calendar/chipy', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const parsed = z.object({ schedule: ChipyScheduleSchema }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid schedule format' });
    if (!pool) return { ok: true };

    await pool.query(
      `INSERT INTO chipy_schedules (org_id, schedule, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (org_id) DO UPDATE SET schedule = $2, updated_at = now()`,
      [orgId, JSON.stringify(parsed.data.schedule)],
    );

    // Reflect the new availability back to agent_configs.openingHours so the
    // Agent-Builder card stays in step and buildAgentInstructions reads the
    // latest truth on the next Retell deploy.
    void import('./opening-hours-sync.js').then(({ syncChipyToOpeningHours }) =>
      syncChipyToOpeningHours(orgId, parsed.data.schedule),
    ).catch(() => {/* non-fatal */});

    return { ok: true };
  });

  /** POST /calendar/chipy/block — block a specific date or time range */
  // CAL-09: validated with Zod to prevent arbitrary-length strings in DB.
  const ChipyBlockSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start_time: z.string().max(10).optional(),
    end_time: z.string().max(10).optional(),
    reason: z.string().max(500).optional(),
  });

  const StaffBodySchema = z.object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().max(120).optional(),
    services: z.array(z.string().max(80)).max(20).optional(),
    color: z.string().trim().max(40).optional(),
  });
  const StaffParamsSchema = z.object({ id: z.string().uuid() });
  const StaffBlockParamsSchema = z.object({ id: z.string().uuid(), blockId: z.string().uuid() });

  app.get('/calendar/staff', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    if (!pool) return reply.send({ staff: [] });

    const staff = await getCalendarStaff(orgId);
    const enriched = await Promise.all(staff.map(async (member) => {
      const connections = await getAllConnections(orgId, member.id);
      const connectionStatuses = await Promise.all(connections.map((conn) => getConnectionStatus(conn, orgId)));
      const { schedule } = await getChipySchedule(orgId, member.id);
      const chipyConfigured = Object.values(schedule).some((d) => d.enabled);
      return {
        ...member,
        chipy: { configured: chipyConfigured, schedule },
        connections: connectionStatuses,
      };
    }));

    return reply.send({ staff: enriched });
  });

  app.post('/calendar/staff', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const parsed = StaffBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid staff data', details: parsed.error.flatten() });
    if (!pool) return reply.send({ ok: true, staff: { id: 'mock', ...parsed.data } });

    try {
      const res = await pool.query<CalendarStaff>(
        `INSERT INTO calendar_staff (org_id, name, role, services, color, sort_order)
         VALUES (
           $1, $2, $3, $4, $5,
           COALESCE((SELECT MAX(sort_order) + 1 FROM calendar_staff WHERE org_id = $1), 0)
         )
         RETURNING id, org_id, name, role, services, color, active, sort_order, created_at, updated_at`,
        [
          orgId,
          parsed.data.name,
          parsed.data.role || null,
          sanitizeStaffServices(parsed.data.services),
          parsed.data.color || null,
        ],
      );
      const staff = res.rows[0]!;
      await pool.query(
        `INSERT INTO staff_chipy_schedules (org_id, staff_id, schedule, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (staff_id) DO NOTHING`,
        [orgId, staff.id, JSON.stringify(DEFAULT_CHIPPY_SCHEDULE)],
      );
      return reply.status(201).send({ ok: true, staff });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === '23505') return reply.status(409).send({ error: 'STAFF_NAME_EXISTS' });
      throw e;
    }
  });

  app.patch('/calendar/staff/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const params = StaffParamsSchema.safeParse(req.params);
    const parsed = StaffBodySchema.partial().safeParse(req.body);
    if (!params.success || !parsed.success) return reply.status(400).send({ error: 'Invalid staff data' });
    if (!pool) return reply.send({ ok: true });
    const staff = await resolveRouteStaff(orgId, params.data.id, reply);
    if (!staff.ok) return;

    try {
      const res = await pool.query<CalendarStaff>(
        `UPDATE calendar_staff
         SET name = COALESCE($3, name),
             role = COALESCE($4, role),
             services = COALESCE($5, services),
             color = COALESCE($6, color),
             updated_at = now()
         WHERE id = $1 AND org_id = $2 AND active = true
         RETURNING id, org_id, name, role, services, color, active, sort_order, created_at, updated_at`,
        [
          params.data.id,
          orgId,
          parsed.data.name ?? null,
          parsed.data.role ?? null,
          parsed.data.services ? sanitizeStaffServices(parsed.data.services) : null,
          parsed.data.color ?? null,
        ],
      );
      return reply.send({ ok: true, staff: res.rows[0] });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === '23505') return reply.status(409).send({ error: 'STAFF_NAME_EXISTS' });
      throw e;
    }
  });

  app.delete('/calendar/staff/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const params = StaffParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid staff id' });
    if (!pool) return reply.send({ ok: true });
    const staff = await resolveRouteStaff(orgId, params.data.id, reply);
    if (!staff.ok) return;
    await pool.query(
      `UPDATE calendar_staff SET active = false, updated_at = now() WHERE id = $1 AND org_id = $2`,
      [params.data.id, orgId],
    );
    return reply.send({ ok: true });
  });

  app.get('/calendar/staff/:id/chipy', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const params = StaffParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid staff id' });
    const staff = await resolveRouteStaff(orgId, params.data.id, reply);
    if (!staff.ok) return;
    const staffId = staff.staffId!;
    const { schedule } = await getChipySchedule(orgId, staffId);
    if (!pool) return reply.send({ schedule, blocks: [], bookings: [] });

    const [blockRes, bookingRes] = await Promise.all([
      pool.query(
        `SELECT id, date::text, start_time::text, end_time::text, reason
         FROM staff_chipy_blocks WHERE org_id = $1 AND staff_id = $2 AND date >= CURRENT_DATE ORDER BY date, start_time NULLS FIRST`,
        [orgId, staffId],
      ),
      pool.query(
        `SELECT id, customer_name, customer_phone, service, notes, slot_time
         FROM staff_chipy_bookings WHERE org_id = $1 AND staff_id = $2 AND slot_time >= now()
         ORDER BY slot_time LIMIT 50`,
        [orgId, staffId],
      ),
    ]);

    return reply.send({ schedule, blocks: blockRes.rows, bookings: bookingRes.rows });
  });

  app.put('/calendar/staff/:id/chipy', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const params = StaffParamsSchema.safeParse(req.params);
    const parsed = z.object({ schedule: ChipyScheduleSchema }).safeParse(req.body);
    if (!params.success || !parsed.success) return reply.status(400).send({ error: 'Invalid staff schedule' });
    const staff = await resolveRouteStaff(orgId, params.data.id, reply);
    if (!staff.ok) return;
    const staffId = staff.staffId!;
    if (!pool) return reply.send({ ok: true });
    await pool.query(
      `INSERT INTO staff_chipy_schedules (org_id, staff_id, schedule, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (staff_id) DO UPDATE SET schedule = $3, updated_at = now()`,
      [orgId, staffId, JSON.stringify(parsed.data.schedule)],
    );
    return reply.send({ ok: true });
  });

  app.post('/calendar/staff/:id/chipy/block', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const params = StaffParamsSchema.safeParse(req.params);
    const parsed = ChipyBlockSchema.safeParse(req.body);
    if (!params.success || !parsed.success) return reply.status(400).send({ error: 'Invalid staff block' });
    const staff = await resolveRouteStaff(orgId, params.data.id, reply);
    if (!staff.ok) return;
    const staffId = staff.staffId!;
    if (!pool) return reply.send({ ok: true });
    const res = await pool.query(
      `INSERT INTO staff_chipy_blocks (org_id, staff_id, date, start_time, end_time, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [orgId, staffId, parsed.data.date, parsed.data.start_time ?? null, parsed.data.end_time ?? null, parsed.data.reason ?? null],
    );
    return reply.send({ ok: true, id: res.rows[0]?.id });
  });

  app.delete('/calendar/staff/:id/chipy/block/:blockId', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const params = StaffBlockParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid staff block id' });
    const staff = await resolveRouteStaff(orgId, params.data.id, reply);
    if (!staff.ok) return;
    const staffId = staff.staffId!;
    if (!pool) return reply.send({ ok: true });
    await pool.query(
      `DELETE FROM staff_chipy_blocks WHERE id = $1 AND org_id = $2 AND staff_id = $3`,
      [params.data.blockId, orgId, staffId],
    );
    return reply.send({ ok: true });
  });

  app.post('/calendar/chipy/block', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const parsed = ChipyBlockSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid block format (date must be YYYY-MM-DD)' });
    if (!pool) return { ok: true };

    const res = await pool.query(
      `INSERT INTO chipy_blocks (org_id, date, start_time, end_time, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [orgId, parsed.data.date, parsed.data.start_time ?? null, parsed.data.end_time ?? null, parsed.data.reason ?? null],
    );
    return { ok: true, id: res.rows[0]?.id };
  });

  /** DELETE /calendar/chipy/block/:id — remove a date block */
  app.delete('/calendar/chipy/block/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    if (!pool) return reply.send({ ok: true });
    await pool.query(`DELETE FROM chipy_blocks WHERE id = $1 AND org_id = $2`, [id, orgId]);
    return { ok: true };
  });

  /** GET /calendar/external-events?from=YYYY-MM-DD&to=YYYY-MM-DD — list
   *  cached external calendar events (Google/Microsoft/cal.com) for the
   *  org in the given range. Served from the external_calendar_events
   *  cache; the background cron (calendar-sync.ts) keeps it fresh every
   *  5 min. See calendar-sync.ts for the fill path. */
  app.get('/calendar/external-events', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const q = req.query as { from?: string; to?: string };
    const from = q.from ?? new Date().toISOString().slice(0, 10);
    const to = q.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { getExternalEventsForOrg } = await import('./calendar-sync.js');
    const rows = await getExternalEventsForOrg(
      orgId,
      `${from}T00:00:00.000Z`,
      `${to}T23:59:59.999Z`,
    );
    // Strip org_id from the client-facing payload — it's the caller's own,
    // but there's no reason to echo it back. `external_id` + provider is
    // enough for the UI to key on.
    return { events: rows.map(({ org_id: _oid, ...rest }) => rest) };
  });

  /** GET /calendar/chipy/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD — list bookings in a range */
  app.get('/calendar/chipy/bookings', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const query = req.query as { from?: string; to?: string };
    if (!pool) return { bookings: [] };
    const from = query.from ?? new Date().toISOString().slice(0, 10);
    const toDate = query.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await pool.query(
      `SELECT id, customer_name, customer_phone, service, notes, slot_time, created_at
       FROM chipy_bookings WHERE org_id = $1 AND slot_time >= $2::date AND slot_time < ($3::date + interval '1 day')
       ORDER BY slot_time`,
      [orgId, from, toDate],
    );
    return { bookings: res.rows };
  });

  /** POST /calendar/chipy/bookings — create a manual booking */
  app.post('/calendar/chipy/bookings', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const parsed = z.object({
      customer_name: z.string().min(1).max(200),
      customer_phone: z.string().min(1).max(50),
      service: z.string().max(200).optional(),
      notes: z.string().max(1000).optional(),
      slot_time: z.string().min(1), // ISO datetime
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Ungültige Daten', details: parsed.error.flatten() });
    if (!pool) return { ok: true, id: 'mock' };
    try {
      const res = await pool.query(
        `INSERT INTO chipy_bookings (org_id, customer_name, customer_phone, service, notes, slot_time)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, customer_name, customer_phone, service, notes, slot_time`,
        [orgId, parsed.data.customer_name, parsed.data.customer_phone, parsed.data.service ?? null, parsed.data.notes ?? null, parsed.data.slot_time],
      );
      return { ok: true, booking: res.rows[0] };
    } catch (e: unknown) {
      // Unique constraint violation on (org_id, slot_time) → slot already booked
      const err = e as { code?: string; constraint?: string };
      if (err.code === '23505') {
        return reply.status(409).send({
          error: 'Dieser Zeitslot ist bereits gebucht. Bitte wähle einen anderen Slot.',
          code: 'SLOT_TAKEN',
        });
      }
      throw e;
    }
  });

  /** DELETE /calendar/chipy/bookings/:id — delete a manual booking */
  app.delete('/calendar/chipy/bookings/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    if (!pool) return reply.send({ ok: true });
    await pool.query(`DELETE FROM chipy_bookings WHERE id = $1 AND org_id = $2`, [id, orgId]);
    return { ok: true };
  });
}
