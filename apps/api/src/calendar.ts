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

type CalendarExternalEvent = {
  provider: 'google' | 'microsoft' | 'calcom';
  external_id: string;
  calendar_id: string | null;
  summary: string | null;
  slot_start: string;
  slot_end: string;
  all_day: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
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

type BookingTiming = {
  durationMinutes: number;
  bufferMinutes: number;
};

type CalendarServiceConfig = {
  name: string;
  duration?: string;
  bufferMinutes?: number;
};

const DEFAULT_BOOKING_TIMING: BookingTiming = { durationMinutes: 30, bufferMinutes: 0 };
const SLOT_STEP_MINUTES = 15;

function clampMinutes(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function parseDurationMinutes(value: string | null | undefined): number | null {
  const raw = value?.trim().toLowerCase();
  if (!raw) return null;
  const normalized = raw.replace(',', '.');
  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:h|std|stunde|stunden)/);
  const minMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:min|minute|minutes|minuten)/);
  const hours = hourMatch ? Number(hourMatch[1]) * 60 : 0;
  const minutes = minMatch ? Number(minMatch[1]) : 0;
  const total = hours + minutes;
  if (total > 0) return clampMinutes(total, 5, 480, DEFAULT_BOOKING_TIMING.durationMinutes);
  const plain = Number(normalized.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(plain) ? clampMinutes(plain, 5, 480, DEFAULT_BOOKING_TIMING.durationMinutes) : null;
}

function parseBufferMinutes(value: string | null | undefined): number | null {
  const raw = value?.trim().toLowerCase();
  if (!raw || !/puffer|buffer|pause|abstand/.test(raw)) return null;
  const match = raw.match(/(\d{1,3})\s*(?:min|minute|minutes|minuten)?\s*(?:puffer|buffer|pause|abstand)/)
    ?? raw.match(/(?:puffer|buffer|pause|abstand)\s*(\d{1,3})/);
  if (!match) return null;
  return clampMinutes(Number(match[1]), 0, 180, DEFAULT_BOOKING_TIMING.bufferMinutes);
}

function normalizeBookingTiming(input: { durationMinutes?: number | null; bufferMinutes?: number | null }): BookingTiming {
  return {
    durationMinutes: clampMinutes(input.durationMinutes ?? DEFAULT_BOOKING_TIMING.durationMinutes, 5, 480, DEFAULT_BOOKING_TIMING.durationMinutes),
    bufferMinutes: clampMinutes(input.bufferMinutes ?? DEFAULT_BOOKING_TIMING.bufferMinutes, 0, 180, DEFAULT_BOOKING_TIMING.bufferMinutes),
  };
}

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
  await pool.query(`ALTER TABLE chipy_bookings ADD COLUMN IF NOT EXISTS duration_minutes INT NOT NULL DEFAULT 30`);
  await pool.query(`ALTER TABLE chipy_bookings ADD COLUMN IF NOT EXISTS buffer_minutes INT NOT NULL DEFAULT 0`);

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
  await pool.query(`ALTER TABLE staff_chipy_bookings ADD COLUMN IF NOT EXISTS duration_minutes INT NOT NULL DEFAULT 30`);
  await pool.query(`ALTER TABLE staff_chipy_bookings ADD COLUMN IF NOT EXISTS buffer_minutes INT NOT NULL DEFAULT 0`);
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

function normalizeServiceLookup(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function serviceAliasTokens(value: string): Set<string> {
  const normalized = normalizeServiceLookup(value);
  const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
  if (/schnitt|schneiden|haarschnitt/.test(normalized)) tokens.add('haarschnitt');
  if (/herr|mann|barber/.test(normalized)) tokens.add('herrenschnitt');
  if (/dame|frau/.test(normalized)) tokens.add('damenhaarschnitt');
  if (/farbe|farben|faerben|color|ansatz|toenung|tonung|glossing/.test(normalized)) tokens.add('farbe');
  if (/strahne|strahnen|highlights/.test(normalized)) tokens.add('straehnen');
  if (/balayage/.test(normalized)) tokens.add('balayage');
  if (/bart|beard/.test(normalized)) tokens.add('bart');
  if (/fohn|foehn|blow/.test(normalized)) tokens.add('foehnen');
  return tokens;
}

function staffSupportsService(member: CalendarStaff, requestedService?: string | null): boolean {
  const requested = normalizeServiceLookup(requestedService);
  if (!requested) return true;
  // Backwards compatibility: legacy staff rows with no service list must not
  // suddenly stop receiving bookings after this feature ships.
  if (!member.services?.length) return true;

  const requestedTokens = serviceAliasTokens(requested);
  return member.services.some((service) => {
    const offered = normalizeServiceLookup(service);
    if (!offered) return false;
    if (offered.includes(requested) || requested.includes(offered)) return true;
    const offeredTokens = serviceAliasTokens(offered);
    if (requestedTokens.has('herrenschnitt') && offeredTokens.has('damenhaarschnitt') && !offeredTokens.has('herrenschnitt')) return false;
    if (requestedTokens.has('damenhaarschnitt') && offeredTokens.has('herrenschnitt') && !offeredTokens.has('damenhaarschnitt')) return false;
    for (const token of requestedTokens) {
      if (offeredTokens.has(token)) return true;
    }
    return false;
  });
}

function serviceNamesMatch(requestedService: string | null | undefined, offeredName: string | null | undefined): boolean {
  const requested = normalizeServiceLookup(requestedService);
  const offered = normalizeServiceLookup(offeredName);
  if (!requested || !offered) return false;
  if (offered.includes(requested) || requested.includes(offered)) return true;
  const requestedTokens = serviceAliasTokens(requested);
  const offeredTokens = serviceAliasTokens(offered);
  if (requestedTokens.has('herrenschnitt') && offeredTokens.has('damenhaarschnitt') && !offeredTokens.has('herrenschnitt')) return false;
  if (requestedTokens.has('damenhaarschnitt') && offeredTokens.has('herrenschnitt') && !offeredTokens.has('damenhaarschnitt')) return false;
  for (const token of requestedTokens) {
    if (offeredTokens.has(token)) return true;
  }
  return false;
}

function parseServiceConfigs(raw: unknown): CalendarServiceConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: CalendarServiceConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      duration: typeof record.duration === 'string' ? record.duration : undefined,
      bufferMinutes: typeof record.bufferMinutes === 'number' ? record.bufferMinutes : undefined,
    });
  }
  return out;
}

async function getOrgServiceConfigs(orgId: string): Promise<CalendarServiceConfig[]> {
  if (!pool) return [];
  const res = await pool.query<{ services: unknown }>(
    `SELECT data->'services' AS services
       FROM agent_configs
      WHERE org_id = $1 OR tenant_id = $1::text
      ORDER BY updated_at DESC
      LIMIT 1`,
    [orgId],
  );
  return parseServiceConfigs(res.rows[0]?.services);
}

async function resolveBookingTiming(
  orgId: string,
  requestedService?: string | null,
  overrides: { durationMinutes?: number | null; bufferMinutes?: number | null } = {},
): Promise<BookingTiming> {
  if (overrides.durationMinutes || overrides.bufferMinutes !== undefined) {
    return normalizeBookingTiming(overrides);
  }

  const fromServiceText = normalizeBookingTiming({
    durationMinutes: parseDurationMinutes(requestedService),
    bufferMinutes: parseBufferMinutes(requestedService),
  });

  const services = await getOrgServiceConfigs(orgId).catch(() => []);
  const matched = services.find((service) => serviceNamesMatch(requestedService, service.name));
  if (!matched) return fromServiceText;

  return normalizeBookingTiming({
    durationMinutes: parseDurationMinutes(matched.duration) ?? fromServiceText.durationMinutes,
    bufferMinutes: matched.bufferMinutes ?? fromServiceText.bufferMinutes,
  });
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

async function rankAvailableStaffForSlot(
  orgId: string,
  staff: CalendarStaff[],
  slotTime: Date,
  timing: BookingTiming = DEFAULT_BOOKING_TIMING,
): Promise<CalendarStaff[]> {
  const availability = await Promise.all(
    staff.map(async (member) => ({
      member,
      available: await isChipySlotAvailable(orgId, slotTime, member.id, timing).catch(() => false),
    })),
  );
  const available = availability.filter((item) => item.available).map((item) => item.member);
  if (!pool || available.length <= 1) return available;

  const counts = await pool.query<{ staff_id: string; bookings: number }>(
    `SELECT staff_id::text AS staff_id, count(*)::int AS bookings
       FROM staff_chipy_bookings
      WHERE org_id = $1
        AND staff_id = ANY($2::uuid[])
        AND (slot_time AT TIME ZONE 'Europe/Berlin')::date = ($3::timestamptz AT TIME ZONE 'Europe/Berlin')::date
      GROUP BY staff_id`,
    [orgId, available.map((member) => member.id), slotTime.toISOString()],
  );
  const bookingsByStaff = new Map(counts.rows.map((row) => [row.staff_id, Number(row.bookings) || 0]));
  return available.sort((a, b) =>
    (bookingsByStaff.get(a.id) ?? 0) - (bookingsByStaff.get(b.id) ?? 0)
    || a.sort_order - b.sort_order
    || a.name.localeCompare(b.name),
  );
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

function parseProviderEventTime(
  start?: { date?: string; dateTime?: string },
  end?: { date?: string; dateTime?: string },
): { start: string; end: string; allDay: boolean } | null {
  if (!start || !end) return null;
  if (start.date && end.date) {
    return {
      start: new Date(`${start.date}T00:00:00Z`).toISOString(),
      end: new Date(`${end.date}T00:00:00Z`).toISOString(),
      allDay: true,
    };
  }
  if (start.dateTime && end.dateTime) {
    return {
      start: new Date(start.dateTime).toISOString(),
      end: new Date(end.dateTime).toISOString(),
      allDay: false,
    };
  }
  return null;
}

async function listExternalEventsForConnection(
  conn: CalendarConnection,
  fromIso: string,
  toIso: string,
): Promise<CalendarExternalEvent[]> {
  const maxEvents = 500;

  if (conn.provider === 'google') {
    const token = await getValidTokenForConnection(conn);
    if (!token) return [];
    const calId = conn.calendar_id || 'primary';
    const params = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '250',
      timeMin: fromIso,
      timeMax: toIso,
      orderBy: 'startTime',
    });
    const events: {
      id: string;
      status?: string;
      summary?: string;
      start?: { date?: string; dateTime?: string };
      end?: { date?: string; dateTime?: string };
    }[] = [];
    let pageToken: string | null = null;
    let safety = 0;
    do {
      const q = new URLSearchParams(params);
      if (pageToken) q.set('pageToken', pageToken);
      const resp = await calFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${q.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return [];
      const page = await resp.json() as { items?: typeof events; nextPageToken?: string };
      for (const item of page.items ?? []) events.push(item);
      pageToken = page.nextPageToken ?? null;
    } while (pageToken && events.length < maxEvents && safety++ < 5);

    return events.flatMap((event) => {
      if (!event.id) return [];
      const parsed = parseProviderEventTime(event.start, event.end);
      if (!parsed) return [];
      return [{
        provider: 'google' as const,
        external_id: event.id,
        calendar_id: calId,
        summary: (event.summary ?? '').slice(0, 500) || null,
        slot_start: parsed.start,
        slot_end: parsed.end,
        all_day: parsed.allDay,
        status: event.status === 'cancelled' ? 'cancelled' as const : 'confirmed' as const,
      }];
    });
  }

  if (conn.provider === 'microsoft') {
    const token = await getValidMsTokenForConnection(conn);
    if (!token) return [];
    const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(fromIso)}&endDateTime=${encodeURIComponent(toIso)}&$top=250&$orderby=start/dateTime`;
    const events: {
      id: string;
      subject?: string;
      isCancelled?: boolean;
      isAllDay?: boolean;
      start?: { dateTime: string };
      end?: { dateTime: string };
    }[] = [];
    let nextLink: string | null = url;
    let safety = 0;
    while (nextLink && events.length < maxEvents && safety++ < 5) {
      const resp = await calFetch(nextLink, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      });
      if (!resp.ok) return [];
      const page = await resp.json() as { value?: typeof events; '@odata.nextLink'?: string };
      for (const item of page.value ?? []) events.push(item);
      nextLink = page['@odata.nextLink'] ?? null;
    }

    return events.flatMap((event) => {
      if (!event.id || !event.start?.dateTime || !event.end?.dateTime) return [];
      return [{
        provider: 'microsoft' as const,
        external_id: event.id,
        calendar_id: conn.calendar_id || null,
        summary: (event.subject ?? '').slice(0, 500) || null,
        slot_start: new Date(`${event.start.dateTime}Z`).toISOString(),
        slot_end: new Date(`${event.end.dateTime}Z`).toISOString(),
        all_day: !!event.isAllDay,
        status: event.isCancelled ? 'cancelled' as const : 'confirmed' as const,
      }];
    });
  }

  if (conn.provider === 'calcom') {
    const apiKey = conn.api_key;
    if (!apiKey) return [];
    type CalcomBooking = { uid: string; title?: string; startTime: string; endTime: string; status?: string };
    const resp = await calFetch(`https://api.cal.com/v1/bookings?apiKey=${encodeURIComponent(apiKey)}&limit=250`);
    if (!resp.ok) return [];
    const page = await resp.json() as { bookings?: CalcomBooking[] };
    const from = new Date(fromIso).getTime();
    const to = new Date(toIso).getTime();
    return (page.bookings ?? []).flatMap((booking) => {
      if (!booking.uid || !booking.startTime || !booking.endTime) return [];
      const startMs = new Date(booking.startTime).getTime();
      const endMs = new Date(booking.endTime).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < from || startMs > to) return [];
      return [{
        provider: 'calcom' as const,
        external_id: booking.uid,
        calendar_id: null,
        summary: (booking.title ?? '').slice(0, 500) || null,
        slot_start: new Date(booking.startTime).toISOString(),
        slot_end: new Date(booking.endTime).toISOString(),
        all_day: false,
        status: booking.status === 'CANCELLED' || booking.status === 'REJECTED' ? 'cancelled' as const : 'confirmed' as const,
      }];
    });
  }

  return [];
}

async function listStaffExternalEvents(orgId: string, staffId: string, fromIso: string, toIso: string): Promise<CalendarExternalEvent[]> {
  const connections = await getAllConnections(orgId, staffId);
  const nested = await Promise.all(connections.map(async (conn) => {
    try {
      return await listExternalEventsForConnection(conn, fromIso, toIso);
    } catch (err) {
      log.warn(
        { orgId, staffId, provider: conn.provider, err: (err as Error).message?.slice(0, 200) },
        'calendar: staff external event fetch failed',
      );
      return [] as CalendarExternalEvent[];
    }
  }));
  return nested.flat().sort((a, b) => a.slot_start.localeCompare(b.slot_start));
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

async function msFindSlots(token: string, email: string, timing: BookingTiming = DEFAULT_BOOKING_TIMING): Promise<string[]> {
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

    return generateFreeSlots(busyPeriods, timing);
  } catch {
    return [];
  }
}

async function msBookSlot(
  token: string,
  opts: { customerName: string; customerPhone: string; time: string; service: string; notes?: string; durationMinutes?: number },
): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  const startTime = parseSlotTime(opts.time);
  if (!startTime) return { ok: false, error: `Cannot parse time: ${opts.time}` };
  const endTime = new Date(startTime.getTime() + clampMinutes(opts.durationMinutes ?? 30, 5, 480, 30) * 60 * 1000);

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
  timing: BookingTiming = DEFAULT_BOOKING_TIMING,
): string[] {
  const slots: string[] = [];
  const now = new Date();
  const occupiedMs = (timing.durationMinutes + timing.bufferMinutes) * 60 * 1000;

  for (let d = 0; d < 7; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    day.setHours(0, 0, 0, 0);
    const dayClose = new Date(day);
    dayClose.setHours(18, 0, 0, 0);

    for (let h = 8; h < 18; h++) {
      for (let m = 0; m < 60; m += SLOT_STEP_MINUTES) {
        const slotStart = new Date(day);
        slotStart.setHours(h, m, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + occupiedMs);

        if (slotStart <= now) continue; // skip past slots
        if (slotEnd > dayClose) continue;

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
          slots.push(formatSlotLabel(slotStart));
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
           ((slot_time AT TIME ZONE 'Europe/Berlin') + ((duration_minutes + buffer_minutes) * interval '1 minute'))::time::text AS end_time
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
         ((slot_time AT TIME ZONE 'Europe/Berlin') + ((duration_minutes + buffer_minutes) * interval '1 minute'))::time::text AS end_time
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

function clockMinutes(value: string | null | undefined): number | null {
  const match = value?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function rangesOverlap(start: number, end: number, busyStart: number, busyEnd: number): boolean {
  return start < busyEnd && end > busyStart;
}

function timeBlockOverlaps(block: ChipyBlock, startMin: number, endMin: number): boolean {
  const blockStart = clockMinutes(block.start_time);
  const blockEnd = clockMinutes(block.end_time);
  if (blockStart === null || blockEnd === null) return true;
  return rangesOverlap(startMin, endMin, blockStart, blockEnd);
}

function generateChipySlots(
  schedule: ChipySchedule,
  blocks: string[],
  timeBlocks: ChipyBlock[] = [],
  onlyDate?: string | null,
  timing: BookingTiming = DEFAULT_BOOKING_TIMING,
): string[] {
  const slots: string[] = [];
  const now = new Date();
  const blockedSet = new Set(blocks);
  const occupiedMinutes = timing.durationMinutes + timing.bufferMinutes;

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

    const startMin = clockMinutes(dayConfig.start) ?? 9 * 60;
    const endMin = clockMinutes(dayConfig.end) ?? 17 * 60;
    const lastStart = endMin - occupiedMinutes;
    if (lastStart < startMin) continue;

    // Get time-specific blocks for this date
    const dayTimeBlocks = timeBlocks.filter(b => b.date === dateStr);

    for (let minutes = startMin; minutes <= lastStart; minutes += SLOT_STEP_MINUTES) {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      const slotStart = new Date(day);
      slotStart.setHours(h, m, 0, 0);
      if (slotStart <= now) continue;

      const slotEnd = minutes + occupiedMinutes;
      const isTimeBlocked = dayTimeBlocks.some((block) => timeBlockOverlaps(block, minutes, slotEnd));
      if (isTimeBlocked) continue;

      slots.push(formatSlotLabel(slotStart));
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

function formatSlotLabel(date: Date): string {
  const parts = berlinParts(date);
  const dow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const dd = parts.day.toString().padStart(2, '0');
  const mm = parts.month.toString().padStart(2, '0');
  const yyyy = parts.year.toString();
  const hh = parts.hour.toString().padStart(2, '0');
  const min = parts.minute.toString().padStart(2, '0');
  return `${DAY_LABELS[dow]} ${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

async function isChipySlotAvailable(
  orgId: string,
  slotTime: Date,
  staffId?: string | null,
  timing: BookingTiming = DEFAULT_BOOKING_TIMING,
): Promise<boolean> {
  const { schedule, blocks, timeBlocks } = await getChipySchedule(orgId, staffId);
  const dateStr = localDateKey(slotTime);
  if (blocks.includes(dateStr)) return false;

  const localParts = berlinParts(slotTime);
  const localDow = new Date(Date.UTC(localParts.year, localParts.month - 1, localParts.day)).getUTCDay().toString();
  const dayConfig = schedule[localDow] ?? DEFAULT_CHIPPY_SCHEDULE[localDow];
  if (!dayConfig?.enabled) return false;

  const timeStr = localTimeKey(slotTime);
  if (timeStr < dayConfig.start.slice(0, 5) || timeStr >= dayConfig.end.slice(0, 5)) return false;
  const startMin = clockMinutes(timeStr);
  const endMin = startMin === null ? null : startMin + timing.durationMinutes + timing.bufferMinutes;
  const scheduleEnd = clockMinutes(dayConfig.end);
  if (startMin === null || endMin === null || scheduleEnd === null || endMin > scheduleEnd) return false;

  const dayBlocks = timeBlocks.filter((b) => b.date === dateStr);
  return !dayBlocks.some((b) => timeBlockOverlaps(b, startMin, endMin));
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
  timing: BookingTiming = DEFAULT_BOOKING_TIMING,
): Promise<{ ok: true; id?: string; externalRefs: ExternalBookingRefs; reused: boolean } | { ok: false; error: string }> {
  if (!pool) return { ok: true, externalRefs: {}, reused: false };

  const sourceCallId = normalizeSourceCallId(opts.sourceCallId);
  const safeTiming = normalizeBookingTiming(timing);
  const slotEnd = new Date(slotTime.getTime() + (safeTiming.durationMinutes + safeTiming.bufferMinutes) * 60 * 1000);
  const table = staffId ? 'staff_chipy_bookings' : 'chipy_bookings';
  const scope = `${orgId}:${staffId ?? 'salon'}:${localDateKey(slotTime)}`;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [scope]);

    const overlapSql = staffId
      ? `SELECT id, source_call_id, external_refs, slot_time
           FROM staff_chipy_bookings
          WHERE org_id = $1
            AND staff_id = $2
            AND slot_time < $4::timestamptz
            AND (slot_time + ((duration_minutes + buffer_minutes) * interval '1 minute')) > $3::timestamptz
          LIMIT 1`
      : `SELECT id, source_call_id, external_refs, slot_time
           FROM chipy_bookings
          WHERE org_id = $1
            AND slot_time < $3::timestamptz
            AND (slot_time + ((duration_minutes + buffer_minutes) * interval '1 minute')) > $2::timestamptz
          LIMIT 1`;
    const overlapParams = staffId
      ? [orgId, staffId, slotTime.toISOString(), slotEnd.toISOString()]
      : [orgId, slotTime.toISOString(), slotEnd.toISOString()];
    const overlap = await client.query<ChipyBookingState & { slot_time: Date | string }>(overlapSql, overlapParams);
    const existingRow = overlap.rows[0];
    if (existingRow) {
      const existingStart = existingRow.slot_time instanceof Date ? existingRow.slot_time : new Date(existingRow.slot_time);
      if (sourceCallId && existingRow.source_call_id === sourceCallId && Math.abs(existingStart.getTime() - slotTime.getTime()) < 1000) {
        await client.query('COMMIT');
        return { ok: true, id: existingRow.id, externalRefs: parseExternalBookingRefs(existingRow.external_refs), reused: true };
      }
      await client.query('ROLLBACK');
      return { ok: false, error: `${staffId ? 'Staff Chipy' : 'Chipy'} slot overlaps existing booking: ${slotTime.toISOString()}` };
    }

    const insertSql = staffId
      ? `INSERT INTO staff_chipy_bookings
           (org_id, staff_id, customer_name, customer_phone, service, notes, slot_time, source_call_id, external_refs, duration_minutes, buffer_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb, $9, $10)
         RETURNING id, source_call_id, external_refs`
      : `INSERT INTO chipy_bookings
           (org_id, customer_name, customer_phone, service, notes, slot_time, source_call_id, external_refs, duration_minutes, buffer_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb, $8, $9)
         RETURNING id, source_call_id, external_refs`;
    const insertParams = staffId
      ? [
          orgId,
          staffId,
          opts.customerName,
          opts.customerPhone,
          opts.service || null,
          opts.notes || null,
          slotTime.toISOString(),
          sourceCallId,
          safeTiming.durationMinutes,
          safeTiming.bufferMinutes,
        ]
      : [
          orgId,
          opts.customerName,
          opts.customerPhone,
          opts.service || null,
          opts.notes || null,
          slotTime.toISOString(),
          sourceCallId,
          safeTiming.durationMinutes,
          safeTiming.bufferMinutes,
        ];

    const inserted = await client.query<ChipyBookingState>(insertSql, insertParams);
    await client.query('COMMIT');
    const newRow = inserted.rows[0];
    return { ok: true, id: newRow?.id, externalRefs: parseExternalBookingRefs(newRow?.external_refs ?? {}), reused: false };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    const err = e as { code?: string; message?: string };
    if (err.code === '23505') return { ok: false, error: `${table} slot already booked: ${slotTime.toISOString()}` };
    return { ok: false, error: err.message ?? 'Chipy booking failed' };
  } finally {
    client.release();
  }
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

async function deleteChipyBooking(orgId: string, bookingId: string | undefined, staffId?: string | null): Promise<boolean> {
  if (!pool || !bookingId) return false;
  if (staffId) {
    const res = await pool.query(`DELETE FROM staff_chipy_bookings WHERE id = $1 AND org_id = $2 AND staff_id = $3`, [bookingId, orgId, staffId]);
    return (res.rowCount ?? 0) > 0;
  }
  const res = await pool.query(`DELETE FROM chipy_bookings WHERE id = $1 AND org_id = $2`, [bookingId, orgId]);
  return (res.rowCount ?? 0) > 0;
}

// ── Cal.com helpers ───────────────────────────────────────────────────────────

const CALCOM_API_VERSION = '2026-02-25';
const CALCOM_SLOTS_API_VERSION = '2024-09-04';
const CALCOM_EVENT_TYPES_API_VERSION = '2024-06-14';

function calcomHeaders(apiKey: string, apiVersion = CALCOM_API_VERSION): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'cal-api-version': apiVersion,
  };
}

interface CalcomAvailabilitySlot {
  start?: string; // v2
  time?: string; // legacy/self-hosted v1 compatibility
}

interface CalcomAvailabilityResponse {
  status?: string;
  data?: Record<string, CalcomAvailabilitySlot[]>;
  slots?: Record<string, CalcomAvailabilitySlot[]>;
  busy?: { start: string; end: string }[];
}

async function calcomFindSlots(
  apiKey: string,
  opts: { eventTypeId: number; dateFrom?: string; dateTo?: string },
): Promise<string[]> {
  const now = new Date();
  const dateFrom =
    opts.dateFrom ?? now.toISOString().slice(0, 10);
  const dateTo =
    opts.dateTo ??
    new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const params = new URLSearchParams({
      eventTypeId: String(opts.eventTypeId),
      start: dateFrom,
      end: dateTo,
      timeZone: 'Europe/Berlin',
    });
    const resp = await calFetch(`https://api.cal.com/v2/slots?${params.toString()}`, {
      headers: calcomHeaders(apiKey, CALCOM_SLOTS_API_VERSION),
    });

    if (!resp.ok) return [];

    const data = (await resp.json()) as CalcomAvailabilityResponse;

    // Cal.com v2 returns { status, data: { "YYYY-MM-DD": [{ start }] } }.
    // Self-hosted older installs may still return { slots: ... }.
    const slotMap = data.data ?? data.slots;
    if (slotMap && typeof slotMap === 'object') {
      const slots: string[] = [];
      for (const daySlots of Object.values(slotMap)) {
        for (const slot of daySlots) {
          const d = new Date(slot.start ?? slot.time ?? '');
          if (isNaN(d.getTime()) || d <= now) continue;
          slots.push(formatSlotLabel(d));
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
  status?: string;
  data?: { id?: number; uid?: string };
  id?: number;
  uid?: string;
  message?: string;
  error?: string;
}

async function calcomBookSlot(
  apiKey: string,
  opts: CalcomBookingOpts,
): Promise<{ ok: boolean; bookingId?: number | string; error?: string }> {
  try {
    const resp = await calFetch('https://api.cal.com/v2/bookings', {
      method: 'POST',
      headers: calcomHeaders(apiKey),
      body: JSON.stringify({
        eventTypeId: opts.eventTypeId,
        start: opts.start,
        attendee: {
          name: opts.name,
          email: opts.email || undefined,
          phoneNumber: opts.phone || undefined,
          timeZone: 'Europe/Berlin',
          language: 'de',
        },
        bookingFieldsResponses: opts.notes ? { notes: opts.notes } : {},
        metadata: { source: 'phonbot' },
      }),
    });

    const data = (await resp.json()) as CalcomBookingResponse;

    if (!resp.ok) {
      return { ok: false, error: data.message ?? data.error ?? `Cal.com API ${resp.status}` };
    }

    return { ok: true, bookingId: data.data?.uid ?? data.uid ?? data.data?.id ?? data.id };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: msg };
  }
}

async function calcomCancelBooking(
  apiKey: string,
  bookingUid: string | number,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof bookingUid !== 'string' || /^\d+$/.test(bookingUid)) {
    return { ok: false, error: 'Cal.com v2 cancellation requires booking uid; old numeric v1 id cannot be cancelled safely by API' };
  }
  try {
    const resp = await calFetch(`https://api.cal.com/v2/bookings/${encodeURIComponent(bookingUid)}/cancel`, {
      method: 'POST',
      headers: calcomHeaders(apiKey),
      body: JSON.stringify({ cancellationReason: reason, cancelSubsequentBookings: false }),
    });
    if (resp.ok || resp.status === 404) return { ok: true };
    const data = await resp.json().catch(() => ({})) as { message?: string; error?: string };
    return { ok: false, error: data.message ?? data.error ?? `Cal.com API ${resp.status}` };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

interface CalcomEventType {
  id: number;
  title: string;
  length?: number;
  lengthInMinutes?: number;
}

interface CalcomEventTypesResponse {
  status?: string;
  data?: CalcomEventType[];
  event_types?: CalcomEventType[];
  eventTypes?: CalcomEventType[];
}

async function calcomGetEventTypes(apiKey: string): Promise<CalcomEventType[]> {
  try {
    const resp = await calFetch(
      'https://api.cal.com/v2/event-types',
      { headers: calcomHeaders(apiKey, CALCOM_EVENT_TYPES_API_VERSION) },
    );

    if (!resp.ok) return [];

    const data = (await resp.json()) as CalcomEventTypesResponse;
    const list = data.data ?? data.event_types ?? data.eventTypes ?? [];
    return list.map((et) => ({
      id: et.id,
      title: et.title,
      length: et.length ?? et.lengthInMinutes ?? 30,
      lengthInMinutes: et.lengthInMinutes ?? et.length ?? 30,
    }));
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
  if (staffId) {
    const member = (await getCalendarStaff(orgId)).find((s) => s.id === staffId);
    if (member && !staffSupportsService(member, opts.service)) {
      return { slots: [], source: 'service-not-offered' };
    }
  }
  const connections = await getCheckableConnections(orgId, staffId);
  const sources = ['chipy'];
  const { schedule, blocks, timeBlocks } = await getChipySchedule(orgId, staffId);
  const timing = await resolveBookingTiming(orgId, opts.service);
  let slots = generateChipySlots(schedule, blocks, timeBlocks, requestedDateKey(opts), timing);

  if (connections.length === 0) {
    return { slots: [...new Set(slots)].sort(), source: 'chipy' };
  }

  if (slots.length === 0) {
    return { slots: [], source: `chipy+${connections.map((c) => c.provider).join('+')}` };
  }

  for (const conn of connections) {
    let connSlots: string[] | null = [];
    try {
      connSlots = await findSlotsForConnection(conn, orgId, timing);
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

export async function findFreeSlotsForAnyStaff(
  orgId: string,
  opts: { date?: string; range?: string; service?: string },
): Promise<{ slots: string[]; source: string; staffCount: number }> {
  const staff = await getCalendarStaff(orgId);
  if (staff.length === 0) {
    const result = await findFreeSlotsByContract(orgId, opts);
    return { ...result, staffCount: 0 };
  }
  const eligibleStaff = staff.filter((member) => staffSupportsService(member, opts.service));
  if (eligibleStaff.length === 0) {
    return { slots: [], source: 'team:service-not-offered', staffCount: staff.length };
  }

  const perStaff = await Promise.all(
    eligibleStaff.map(async (member) => {
      const result = await findFreeSlotsByContract(orgId, { ...opts, staffId: member.id });
      return { member, result };
    }),
  );
  const slots = new Set<string>();
  const sources = new Set<string>();

  for (const item of perStaff) {
    for (const slot of item.result.slots) slots.add(slot);
    for (const source of item.result.source.split('+')) {
      if (source) sources.add(source);
    }
  }

  return {
    slots: [...slots].sort(),
    source: `team:${sources.size ? [...sources].sort().join('+') : 'chipy'}`,
    staffCount: staff.length,
  };
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
  timing: BookingTiming = DEFAULT_BOOKING_TIMING,
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

    const eventTypes = await calcomGetEventTypes(apiKey);
    const eventType = eventTypes[0];
    if (!eventType) return null;

    const slots = await calcomFindSlots(apiKey, { eventTypeId: eventType.id, dateFrom, dateTo });
    return slots;
  }

  // ── Microsoft path ─────────────────────────────────────────────────────────
  if (conn.provider === 'microsoft') {
    const token = await getValidMsTokenForConnection(conn);
    if (!token) return null;
    const email = conn.email ?? '';
    return msFindSlots(token, email, timing);
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
    return generateFreeSlots(busyPeriods, timing);
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
    durationMinutes?: number;
    bufferMinutes?: number;
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
  if (staffId) {
    const member = (await getCalendarStaff(orgId)).find((s) => s.id === staffId);
    if (member && !staffSupportsService(member, opts.service)) {
      return { ok: false, error: `Service not offered by staff: ${opts.service}` };
    }
  }
  const connections = await getCheckableConnections(orgId, staffId);
  const slotTime = parseSlotTime(opts.time);
  if (!slotTime) return { ok: false, error: `Cannot parse time: ${opts.time}` };
  const timing = await resolveBookingTiming(orgId, opts.service, {
    durationMinutes: opts.durationMinutes,
    bufferMinutes: opts.bufferMinutes,
  });
  if (!(await isChipySlotAvailable(orgId, slotTime, staffId, timing))) {
    return { ok: false, error: `Chipy slot unavailable: ${opts.time}` };
  }

  let chipyBooking: { id?: string; externalRefs: ExternalBookingRefs; reused: boolean };
  try {
    const claimed = await claimChipyBooking(orgId, opts, slotTime, staffId, timing);
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
        const result = await bookSlotForConnection(conn, orgId, { ...opts, ...timing });
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

export async function bookSlotForAnyStaff(
  orgId: string,
  opts: {
    customerName: string;
    customerPhone: string;
    time: string;
    service: string;
    notes?: string;
    sourceCallId?: string;
    durationMinutes?: number;
    bufferMinutes?: number;
  },
): Promise<{
  ok: boolean;
  eventId?: string;
  bookingId?: number | string;
  chipyBookingId?: string;
  externalResults?: ExternalBookingResult[];
  partial?: boolean;
  error?: string;
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
}> {
  const staff = await getCalendarStaff(orgId);
  if (staff.length === 0) {
    const result = await bookSlot(orgId, { ...opts, staffId: null });
    return { ...result, assignedStaffId: null, assignedStaffName: null };
  }
  const eligibleStaff = staff.filter((member) => staffSupportsService(member, opts.service));
  if (eligibleStaff.length === 0) {
    return { ok: false, error: `No staff offers service: ${opts.service}` };
  }

  const slotTime = parseSlotTime(opts.time);
  if (!slotTime) return { ok: false, error: `Cannot parse time: ${opts.time}` };
  const timing = await resolveBookingTiming(orgId, opts.service, {
    durationMinutes: opts.durationMinutes,
    bufferMinutes: opts.bufferMinutes,
  });

  const candidates = await rankAvailableStaffForSlot(orgId, eligibleStaff, slotTime, timing);
  const contractCandidates: CalendarStaff[] = [];
  for (const member of candidates) {
    const result = await findFreeSlotsByContract(orgId, {
      date: opts.time,
      service: opts.service,
      staffId: member.id,
    });
    if (result.slots.some((slot) => {
      const parsed = parseSlotTime(slot);
      return Boolean(parsed && Math.abs(parsed.getTime() - slotTime.getTime()) < 60_000);
    })) {
      contractCandidates.push(member);
    }
  }

  const errors: string[] = [];
  for (const member of contractCandidates) {
    const result = await bookSlot(orgId, { ...opts, staffId: member.id, ...timing });
    if (result.ok) {
      return { ...result, assignedStaffId: member.id, assignedStaffName: member.name };
    }
    if (result.error) errors.push(`${member.name}: ${result.error}`);
  }

  return {
    ok: false,
    error: errors.length > 0
      ? `No available staff for ${opts.time}: ${errors.join('; ')}`
      : `No available staff for ${opts.time}`,
  };
}

async function bookSlotForConnection(
  conn: CalendarConnection,
  orgId: string,
  opts: { customerName: string; customerPhone: string; time: string; service: string; notes?: string; durationMinutes?: number; bufferMinutes?: number },
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
  const endTime = new Date(startTime.getTime() + clampMinutes(opts.durationMinutes ?? 30, 5, 480, 30) * 60 * 1000);

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

// ── Booking-change helpers ────────────────────────────────────────────────────

type CalendarBookingRow = {
  id: string;
  staff_id: string | null;
  staff_name: string | null;
  customer_name: string;
  customer_phone: string;
  service: string | null;
  notes: string | null;
  slot_time: Date | string;
  source_call_id: string | null;
  external_refs: unknown;
};

export type CalendarBookingSummary = {
  bookingId: string;
  staffId: string | null;
  staffName: string | null;
  customerName: string;
  customerPhoneMasked: string;
  service: string | null;
  startAt: string;
  label: string;
};

type BookingChangeLookupOpts = {
  bookingId?: string;
  staffId?: string | null;
  customerPhone?: string;
  customerName?: string;
  currentTime?: string;
  service?: string;
  limit?: number;
};

type ExternalCancellationResult = {
  provider: string;
  connectionId: string;
  ok: boolean;
  eventId?: string | null;
  bookingId?: number | string | null;
  error?: string;
};

function normalizeLookupText(value: string | null | undefined): string {
  return normalizeSlotText(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function lookupPhoneticToken(input: string): string {
  let token = normalizeLookupText(input).replace(/\s+/g, '');
  if (!token) return '';
  token = token
    .replace(/tsch/g, 'ch')
    .replace(/sch/g, 'sh')
    .replace(/ph/g, 'f')
    .replace(/qu/g, 'kv')
    .replace(/(ai|ay|ei|ey)/g, 'ai')
    .replace(/ie/g, 'i')
    .replace(/ck/g, 'k')
    .replace(/c([eiy])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 'ts')
    .replace(/v/g, 'f')
    .replace(/w/g, 'v')
    .replace(/dt\b/g, 't')
    .replace(/(.)\1+/g, '$1');
  return token;
}

function lookupLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j < prev.length; j += 1) prev[j] = cur[j] ?? 0;
  }
  return prev[b.length] ?? Math.max(a.length, b.length);
}

function lookupNameSimilarity(wanted: string, stored: string): number {
  const needle = normalizeLookupText(wanted);
  const hay = normalizeLookupText(stored);
  if (!needle || !hay) return 0;
  if (needle === hay) return 1;
  if (hay.includes(needle) || needle.includes(hay)) return 0.88;

  const needleTokens = new Set(needle.split(' ').filter((token) => token.length >= 2));
  const hayTokens = new Set(hay.split(' ').filter((token) => token.length >= 2));
  const shared = [...needleTokens].filter((token) => hayTokens.has(token)).length;
  const tokenScore = shared / Math.max(needleTokens.size, hayTokens.size, 1);
  const needlePhonetic = new Set([...needleTokens].map(lookupPhoneticToken).filter((token) => token.length >= 2));
  const hayPhonetic = new Set([...hayTokens].map(lookupPhoneticToken).filter((token) => token.length >= 2));
  const phoneticShared = [...needlePhonetic].filter((token) => hayPhonetic.has(token)).length;
  const phoneticScore = phoneticShared / Math.max(needlePhonetic.size, hayPhonetic.size, 1);
  const distanceScore = 1 - lookupLevenshtein(needle, hay) / Math.max(needle.length, hay.length, 1);
  return Math.max(tokenScore * 0.82, phoneticScore * 0.9, distanceScore);
}

function phoneDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '');
}

function phoneLooksUsable(value: string | null | undefined): boolean {
  return phoneDigits(value).length >= 6;
}

function phoneMatches(stored: string | null | undefined, input: string | null | undefined): boolean {
  const a = phoneDigits(stored);
  const b = phoneDigits(input);
  if (a.length < 6 || b.length < 6) return false;
  const take = Math.min(10, a.length, b.length);
  return a.endsWith(b.slice(-take)) || b.endsWith(a.slice(-take));
}

function maskPhone(value: string | null | undefined): string {
  const digits = phoneDigits(value);
  return digits.length <= 4 ? 'unbekannt' : `***${digits.slice(-4)}`;
}

function bookingStart(row: CalendarBookingRow): Date {
  return row.slot_time instanceof Date ? row.slot_time : new Date(row.slot_time);
}

function bookingSummary(row: CalendarBookingRow): CalendarBookingSummary {
  const start = bookingStart(row);
  return {
    bookingId: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    customerName: row.customer_name,
    customerPhoneMasked: maskPhone(row.customer_phone),
    service: row.service,
    startAt: start.toISOString(),
    label: formatSlotLabel(start),
  };
}

function bookingMatchesTime(row: CalendarBookingRow, wanted: string | undefined): boolean {
  if (!wanted?.trim()) return true;
  const parsed = parseSlotTime(wanted);
  if (!parsed) return true;
  return Math.abs(bookingStart(row).getTime() - parsed.getTime()) <= 2 * 60 * 60 * 1000;
}

function bookingMatchesText(stored: string | null | undefined, wanted: string | undefined): boolean {
  const needle = normalizeLookupText(wanted);
  if (!needle) return true;
  const hay = normalizeLookupText(stored);
  return Boolean(hay) && (hay.includes(needle) || needle.includes(hay));
}

function bookingMatchesCustomerName(stored: string | null | undefined, wanted: string | undefined): boolean {
  const needle = normalizeLookupText(wanted);
  if (!needle) return true;
  const hay = normalizeLookupText(stored);
  if (!hay) return false;
  if (hay.includes(needle) || needle.includes(hay)) return true;
  if (needle.length < 3 || hay.length < 3) return false;
  return lookupNameSimilarity(needle, hay) >= 0.5;
}

function hasBookingLookupSelector(opts: BookingChangeLookupOpts): boolean {
  const hasName = normalizeLookupText(opts.customerName).length >= 2;
  const hasNarrowing = Boolean(opts.currentTime?.trim() || normalizeLookupText(opts.service));
  return Boolean(
    opts.bookingId?.trim()
    || phoneLooksUsable(opts.customerPhone)
    || (hasName && hasNarrowing)
  );
}

async function listFutureChipyBookings(orgId: string): Promise<CalendarBookingRow[]> {
  if (!pool) return [];
  const res = await pool.query<CalendarBookingRow>(
    `SELECT *
       FROM (
         SELECT b.id::text AS id,
                NULL::text AS staff_id,
                NULL::text AS staff_name,
                b.customer_name,
                b.customer_phone,
                b.service,
                b.notes,
                b.slot_time,
                b.source_call_id,
                b.external_refs
           FROM chipy_bookings b
          WHERE b.org_id = $1
            AND b.slot_time >= now() - interval '15 minutes'
         UNION ALL
         SELECT sb.id::text AS id,
                sb.staff_id::text AS staff_id,
                cs.name AS staff_name,
                sb.customer_name,
                sb.customer_phone,
                sb.service,
                sb.notes,
                sb.slot_time,
                sb.source_call_id,
                sb.external_refs
           FROM staff_chipy_bookings sb
           JOIN calendar_staff cs ON cs.id = sb.staff_id AND cs.org_id = sb.org_id
          WHERE sb.org_id = $1
            AND sb.slot_time >= now() - interval '15 minutes'
       ) x
      ORDER BY slot_time ASC
      LIMIT 200`,
    [orgId],
  );
  return res.rows;
}

function filterBookingsForChange(rows: CalendarBookingRow[], opts: BookingChangeLookupOpts): CalendarBookingRow[] {
  let out = rows;
  if (opts.bookingId?.trim()) out = out.filter((row) => row.id === opts.bookingId!.trim());
  if (opts.staffId) out = out.filter((row) => row.staff_id === opts.staffId);
  if (phoneLooksUsable(opts.customerPhone)) out = out.filter((row) => phoneMatches(row.customer_phone, opts.customerPhone));
  if (normalizeLookupText(opts.customerName).length >= 2) out = out.filter((row) => bookingMatchesCustomerName(row.customer_name, opts.customerName));
  if (opts.currentTime?.trim()) out = out.filter((row) => bookingMatchesTime(row, opts.currentTime));
  if (normalizeLookupText(opts.service)) out = out.filter((row) => bookingMatchesText(row.service, opts.service));
  return out.slice(0, opts.limit ?? 6);
}

export async function findChipyBookingsForChange(
  orgId: string,
  opts: BookingChangeLookupOpts,
): Promise<{
  ok: true;
  status: 'needs_more_data' | 'not_found' | 'found' | 'multiple';
  matches: CalendarBookingSummary[];
  instruction: string;
}> {
  if (!hasBookingLookupSelector(opts)) {
    return {
      ok: true,
      status: 'needs_more_data',
      matches: [],
      instruction: 'Frage nach Name und Terminzeit oder nutze die Anrufernummer. Gib keine fremden Terminlisten preis.',
    };
  }
  const matches = filterBookingsForChange(await listFutureChipyBookings(orgId), opts).map(bookingSummary);
  if (matches.length === 0) {
    return {
      ok: true,
      status: 'not_found',
      matches: [],
      instruction: 'Kein passender Termin gefunden. Frage nach einer genaueren Terminzeit oder erstelle ein Rueckruf-Ticket.',
    };
  }
  if (matches.length === 1) {
    return {
      ok: true,
      status: 'found',
      matches,
      instruction: 'Wiederhole Datum, Uhrzeit und Service kurz und frage nach ausdruecklicher Bestaetigung, bevor du absagst oder verschiebst.',
    };
  }
  return {
    ok: true,
    status: 'multiple',
    matches,
    instruction: 'Nenne maximal drei passende Termine und frage, welcher gemeint ist. Fuehre noch keine Aenderung aus.',
  };
}

function mutationAllowedForBooking(row: CalendarBookingRow, opts: BookingChangeLookupOpts): boolean {
  if (opts.bookingId?.trim() && opts.bookingId.trim() === row.id) return true;
  if (phoneMatches(row.customer_phone, opts.customerPhone)) return true;
  const hasName = normalizeLookupText(opts.customerName).length >= 2 && bookingMatchesCustomerName(row.customer_name, opts.customerName);
  const hasNarrowing = Boolean(opts.currentTime?.trim() || normalizeLookupText(opts.service));
  return hasName && hasNarrowing;
}

async function resolveSingleBookingForMutation(
  orgId: string,
  opts: BookingChangeLookupOpts,
): Promise<{ ok: true; row: CalendarBookingRow } | { ok: false; status: string; matches?: CalendarBookingSummary[]; error: string }> {
  const matches = filterBookingsForChange(await listFutureChipyBookings(orgId), { ...opts, limit: 8 });
  if (matches.length === 0) return { ok: false, status: 'not_found', error: 'BOOKING_NOT_FOUND' };
  if (matches.length > 1) return { ok: false, status: 'multiple_matches', matches: matches.map(bookingSummary), error: 'MULTIPLE_BOOKINGS_MATCH' };
  const row = matches[0]!;
  if (!mutationAllowedForBooking(row, opts)) return { ok: false, status: 'verification_required', error: 'BOOKING_VERIFICATION_REQUIRED' };
  return { ok: true, row };
}

async function cancelExternalRefs(
  orgId: string,
  staffId: string | null,
  refs: ExternalBookingRefs,
  reason: string,
): Promise<ExternalCancellationResult[]> {
  const connections = await getAllConnections(orgId, staffId);
  const byId = new Map(connections.map((conn) => [conn.id, conn]));
  const results: ExternalCancellationResult[] = [];

  for (const ref of Object.values(refs)) {
    if (!ref.ok || (!ref.eventId && !ref.bookingId)) continue;
    const conn = byId.get(ref.connectionId) ?? connections.find((item) => item.provider === ref.provider);
    if (!conn) {
      results.push({ provider: ref.provider, connectionId: ref.connectionId, ok: false, eventId: ref.eventId ?? null, bookingId: ref.bookingId ?? null, error: 'CALENDAR_CONNECTION_NOT_FOUND' });
      continue;
    }
    try {
      if (conn.provider === 'google') {
        const token = await getValidTokenForConnection(conn);
        if (!token || !ref.eventId) throw new Error('GOOGLE_EVENT_NOT_CONNECTED');
        const resp = await calFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(conn.calendar_id || 'primary')}/events/${encodeURIComponent(ref.eventId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok && resp.status !== 404) throw new Error(`Google API ${resp.status}`);
        results.push({ provider: conn.provider, connectionId: conn.id, ok: true, eventId: ref.eventId });
      } else if (conn.provider === 'microsoft') {
        const token = await getValidMsTokenForConnection(conn);
        if (!token || !ref.eventId) throw new Error('MICROSOFT_EVENT_NOT_CONNECTED');
        const resp = await calFetch(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(ref.eventId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok && resp.status !== 404) throw new Error(`Microsoft Graph ${resp.status}`);
        results.push({ provider: conn.provider, connectionId: conn.id, ok: true, eventId: ref.eventId });
      } else if (conn.provider === 'calcom') {
        if (!conn.api_key || ref.bookingId === undefined) throw new Error('CALCOM_BOOKING_NOT_CONNECTED');
        const cancelled = await calcomCancelBooking(conn.api_key, ref.bookingId, reason);
        if (!cancelled.ok) throw new Error(cancelled.error ?? 'Cal.com cancellation failed');
        results.push({ provider: conn.provider, connectionId: conn.id, ok: true, bookingId: ref.bookingId });
      }
    } catch (e: unknown) {
      results.push({
        provider: conn.provider,
        connectionId: conn.id,
        ok: false,
        eventId: ref.eventId ?? null,
        bookingId: ref.bookingId ?? null,
        error: e instanceof Error ? e.message : 'UNKNOWN_EXTERNAL_CANCEL_ERROR',
      });
    }
  }

  return results;
}

export async function cancelChipyBookingForChange(
  orgId: string,
  opts: BookingChangeLookupOpts & { reason?: string; sourceCallId?: string },
): Promise<{
  ok: boolean;
  status: 'cancelled' | 'cancelled_partial' | 'not_found' | 'multiple_matches' | 'verification_required' | 'failed';
  booking?: CalendarBookingSummary;
  matches?: CalendarBookingSummary[];
  externalResults?: ExternalCancellationResult[];
  partial?: boolean;
  error?: string;
}> {
  const resolved = await resolveSingleBookingForMutation(orgId, opts);
  if (!resolved.ok) {
    return {
      ok: false,
      status: resolved.status as 'not_found' | 'multiple_matches' | 'verification_required',
      matches: resolved.matches,
      error: resolved.error,
    };
  }

  const row = resolved.row;
  return withChipyBookingLock(orgId, row.id, async () => {
    try {
      const refs = parseExternalBookingRefs(row.external_refs);
      const externalResults = await cancelExternalRefs(orgId, row.staff_id, refs, opts.reason ?? 'Customer requested cancellation by phone');
      const deleted = await deleteChipyBooking(orgId, row.id, row.staff_id);
      if (!deleted) {
        return { ok: false, status: 'failed', booking: bookingSummary(row), externalResults, partial: true, error: 'CHIPY_DELETE_FAILED' };
      }
      const partial = externalResults.some((item) => !item.ok);
      return {
        ok: true,
        status: partial ? 'cancelled_partial' : 'cancelled',
        booking: bookingSummary(row),
        externalResults,
        partial,
      };
    } catch (e: unknown) {
      return {
        ok: false,
        status: 'failed',
        booking: bookingSummary(row),
        externalResults: [],
        partial: true,
        error: e instanceof Error ? e.message : 'CHIPY_CANCEL_FAILED',
      };
    }
  }, row.staff_id);
}

export async function rescheduleChipyBookingForChange(
  orgId: string,
  opts: BookingChangeLookupOpts & {
    newTime: string;
    newService?: string;
    newStaffId?: string | null;
    newAnyStaff?: boolean;
    reason?: string;
    sourceCallId?: string;
  },
): Promise<{
  ok: boolean;
  status: 'rescheduled' | 'rescheduled_partial' | 'book_failed' | 'not_found' | 'multiple_matches' | 'verification_required';
  oldBooking?: CalendarBookingSummary;
  newBookingId?: number | string;
  newChipyBookingId?: string;
  matches?: CalendarBookingSummary[];
  externalResults?: ExternalCancellationResult[];
  partial?: boolean;
  error?: string;
}> {
  const resolved = await resolveSingleBookingForMutation(orgId, opts);
  if (!resolved.ok) {
    return {
      ok: false,
      status: resolved.status as 'not_found' | 'multiple_matches' | 'verification_required',
      matches: resolved.matches,
      error: resolved.error,
    };
  }

  const old = resolved.row;
  const targetStaffId = opts.newStaffId === undefined ? old.staff_id : opts.newStaffId;
  const bookingOpts = {
    customerName: old.customer_name,
    customerPhone: old.customer_phone,
    time: opts.newTime,
    service: opts.newService ?? old.service ?? opts.service ?? 'Termin',
    notes: [old.notes, opts.reason ? `Verschoben per Telefon: ${opts.reason}` : 'Verschoben per Telefon'].filter(Boolean).join('\n'),
    sourceCallId: opts.sourceCallId,
  };
  const booked = opts.newAnyStaff
    ? await bookSlotForAnyStaff(orgId, bookingOpts)
    : await bookSlot(orgId, {
        ...bookingOpts,
        staffId: targetStaffId,
      });
  if (!booked.ok) {
    return { ok: false, status: 'book_failed', oldBooking: bookingSummary(old), error: booked.error ?? 'BOOK_NEW_SLOT_FAILED' };
  }

  const cancelled = await cancelChipyBookingForChange(orgId, {
    bookingId: old.id,
    customerPhone: old.customer_phone,
    reason: opts.reason ?? 'Customer requested reschedule by phone',
  });
  const partial = booked.partial || !cancelled.ok || cancelled.partial;
  return {
    ok: true,
    status: partial ? 'rescheduled_partial' : 'rescheduled',
    oldBooking: bookingSummary(old),
    newBookingId: booked.bookingId,
    newChipyBookingId: booked.chipyBookingId,
    externalResults: cancelled.externalResults,
    partial,
    error: cancelled.ok ? booked.error : cancelled.error,
  };
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
        `SELECT id, customer_name, customer_phone, service, notes, slot_time, duration_minutes, buffer_minutes
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
  const StaffBookingParamsSchema = z.object({ id: z.string().uuid(), bookingId: z.string().uuid() });
  const ChipyBookingBodySchema = z.object({
    customer_name: z.string().min(1).max(200),
    customer_phone: z.string().max(50).optional().default(''),
    service: z.string().max(200).optional(),
    notes: z.string().max(1000).optional(),
    slot_time: z.string().min(1),
    duration_minutes: z.number().int().min(5).max(480).optional(),
    buffer_minutes: z.number().int().min(0).max(180).optional(),
  });

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
        `SELECT id, customer_name, customer_phone, service, notes, slot_time, duration_minutes, buffer_minutes
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

  app.get('/calendar/staff/:id/chipy/bookings', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const params = StaffParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid staff id' });
    const staff = await resolveRouteStaff(orgId, params.data.id, reply);
    if (!staff.ok) return;
    const staffId = staff.staffId!;
    if (!pool) return reply.send({ bookings: [] });

    const query = req.query as { from?: string; to?: string };
    const from = query.from ?? new Date().toISOString().slice(0, 10);
    const toDate = query.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await pool.query(
      `SELECT id, customer_name, customer_phone, service, notes, slot_time, duration_minutes, buffer_minutes, created_at
       FROM staff_chipy_bookings
       WHERE org_id = $1 AND staff_id = $2 AND slot_time >= $3::date AND slot_time < ($4::date + interval '1 day')
       ORDER BY slot_time`,
      [orgId, staffId, from, toDate],
    );
    return reply.send({ bookings: res.rows });
  });

  app.post('/calendar/staff/:id/chipy/bookings', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const params = StaffParamsSchema.safeParse(req.params);
    const parsed = ChipyBookingBodySchema.safeParse(req.body);
    if (!params.success || !parsed.success) {
      return reply.status(400).send({ error: 'Ungültige Daten', details: parsed.success ? undefined : parsed.error.flatten() });
    }
    const staff = await resolveRouteStaff(orgId, params.data.id, reply);
    if (!staff.ok) return;
    const staffId = staff.staffId!;
    if (!pool) return reply.send({ ok: true, id: 'mock' });

    const slotTime = parseSlotTime(parsed.data.slot_time);
    if (!slotTime) return reply.status(400).send({ error: 'Ungueltige Uhrzeit' });
    const timing = await resolveBookingTiming(orgId, parsed.data.service, {
      durationMinutes: parsed.data.duration_minutes,
      bufferMinutes: parsed.data.buffer_minutes,
    });
    if (!(await isChipySlotAvailable(orgId, slotTime, staffId, timing))) {
      return reply.status(409).send({ error: 'Dieser Zeitraum ist nicht frei. Bitte waehle einen anderen Slot.', code: 'SLOT_TAKEN' });
    }
    const claimed = await claimChipyBooking(orgId, {
      customerName: parsed.data.customer_name,
      customerPhone: parsed.data.customer_phone,
      service: parsed.data.service ?? 'Termin',
      notes: parsed.data.notes,
    }, slotTime, staffId, timing);
    if (!claimed.ok || !claimed.id) {
      return reply.status(409).send({ error: 'Dieser Zeitraum ist bereits belegt. Bitte waehle einen anderen Slot.', code: 'SLOT_TAKEN' });
    }
    const res = await pool.query(
      `SELECT id, customer_name, customer_phone, service, notes, slot_time, duration_minutes, buffer_minutes, created_at
         FROM staff_chipy_bookings
        WHERE org_id = $1 AND staff_id = $2 AND id = $3`,
      [orgId, staffId, claimed.id],
    );
    return reply.send({ ok: true, booking: res.rows[0] });
  });

  app.delete('/calendar/staff/:id/chipy/bookings/:bookingId', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const params = StaffBookingParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid staff booking id' });
    const staff = await resolveRouteStaff(orgId, params.data.id, reply);
    if (!staff.ok) return;
    const staffId = staff.staffId!;
    if (!pool) return reply.send({ ok: true });
    await pool.query(
      `DELETE FROM staff_chipy_bookings WHERE id = $1 AND org_id = $2 AND staff_id = $3`,
      [params.data.bookingId, orgId, staffId],
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

  /** GET /calendar/staff/:id/external-events?from=YYYY-MM-DD&to=YYYY-MM-DD
   * Staff-specific external calendars are not written into the org-scoped cache.
   * Fetch them live for the staff calendar UI so connected Google/Outlook/Cal.com
   * blocks are visible without risking cross-staff cache overwrites. */
  app.get('/calendar/staff/:id/external-events', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    const q = req.query as { from?: string; to?: string };
    if (!pool) return { events: [] };
    try {
      const staffId = await assertStaffBelongs(orgId, id);
      if (!staffId) return { events: [] };
      const from = q.from ?? new Date().toISOString().slice(0, 10);
      const to = q.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const events = await listStaffExternalEvents(
        orgId,
        staffId,
        `${from}T00:00:00.000Z`,
        `${to}T23:59:59.999Z`,
      );
      return { events };
    } catch (err) {
      if (err instanceof StaffNotFoundError) return reply.status(404).send({ error: 'Staff not found' });
      throw err;
    }
  });

  /** GET /calendar/chipy/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD — list bookings in a range */
  app.get('/calendar/chipy/bookings', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const query = req.query as { from?: string; to?: string };
    if (!pool) return { bookings: [] };
    const from = query.from ?? new Date().toISOString().slice(0, 10);
    const toDate = query.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await pool.query(
      `SELECT id, customer_name, customer_phone, service, notes, slot_time, duration_minutes, buffer_minutes, created_at
       FROM chipy_bookings WHERE org_id = $1 AND slot_time >= $2::date AND slot_time < ($3::date + interval '1 day')
       ORDER BY slot_time`,
      [orgId, from, toDate],
    );
    return { bookings: res.rows };
  });

  /** POST /calendar/chipy/bookings — create a manual booking */
  app.post('/calendar/chipy/bookings', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const parsed = ChipyBookingBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Ungültige Daten', details: parsed.error.flatten() });
    if (!pool) return { ok: true, id: 'mock' };
    const slotTime = parseSlotTime(parsed.data.slot_time);
    if (!slotTime) return reply.status(400).send({ error: 'Ungueltige Uhrzeit' });
    const timing = await resolveBookingTiming(orgId, parsed.data.service, {
      durationMinutes: parsed.data.duration_minutes,
      bufferMinutes: parsed.data.buffer_minutes,
    });
    if (!(await isChipySlotAvailable(orgId, slotTime, null, timing))) {
      return reply.status(409).send({ error: 'Dieser Zeitraum ist nicht frei. Bitte waehle einen anderen Slot.', code: 'SLOT_TAKEN' });
    }
    const claimed = await claimChipyBooking(orgId, {
      customerName: parsed.data.customer_name,
      customerPhone: parsed.data.customer_phone,
      service: parsed.data.service ?? 'Termin',
      notes: parsed.data.notes,
    }, slotTime, null, timing);
    if (!claimed.ok || !claimed.id) {
      return reply.status(409).send({ error: 'Dieser Zeitraum ist bereits belegt. Bitte waehle einen anderen Slot.', code: 'SLOT_TAKEN' });
    }
    const res = await pool.query(
      `SELECT id, customer_name, customer_phone, service, notes, slot_time, duration_minutes, buffer_minutes, created_at
         FROM chipy_bookings
        WHERE org_id = $1 AND id = $2`,
      [orgId, claimed.id],
    );
    return { ok: true, booking: res.rows[0] };
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
