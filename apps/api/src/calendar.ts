import './env.js';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import type { JwtPayload } from './auth.js';
import { encrypt as encryptToken, decrypt as decryptToken } from './crypto.js';
import { redis } from './redis.js';
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

function signOAuthState(orgId: string, provider: 'google' | 'microsoft'): string {
  // Nonce binds the state to exactly one successful callback. After first
  // verifyOAuthState, the nonce is marked used in Redis and any replay
  // (double-click, leaked log, stolen URL) is rejected.
  const nonce = crypto.randomBytes(16).toString('base64url');
  const payload = { orgId, provider, nonce, exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SEC };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', OAUTH_STATE_KEY).update(body).digest('base64url');
  return `${body}.${mac}`;
}

async function verifyOAuthState(state: string, expectedProvider: 'google' | 'microsoft'): Promise<{ orgId: string } | null> {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts as [string, string];
  const expectedMac = crypto.createHmac('sha256', OAUTH_STATE_KEY).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { orgId: string; provider: string; exp: number; nonce?: string };
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (payload.provider !== expectedProvider) return null;

    // Replay-protection: atomically claim the nonce. SET NX succeeds only on
    // first callback; any subsequent verifyOAuthState with the same state
    // finds the key and rejects. TTL = remaining state lifetime, so memory
    // doesn't grow unboundedly. When Redis is down we accept the state (fail
    // open — OAuth flows must not brick because of cache outage), but a
    // warning is emitted.
    if (payload.nonce && redis?.isOpen) {
      const key = `oauth_state_used:${payload.nonce}`;
      const ttl = Math.max(1, payload.exp - now);
      const claimed = await redis.set(key, '1', { NX: true, EX: ttl }).catch(() => 'OK');
      if (claimed === null) {
        // Already used → replay
        return null;
      }
    }

    return { orgId: payload.orgId };
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalendarConnection {
  id: string;
  org_id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: Date | null;
  calendar_id: string;
  email: string | null;
  api_key: string | null;
  username: string | null;
}

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

  // Ensure upsert-able unique constraint (Postgres doesn't support IF NOT EXISTS for constraints)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cal_conn_org_provider_uniq ON calendar_connections(org_id, provider);
  `);

  // Cal.com integration columns
  await pool.query(`
    ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS api_key TEXT;
  `);
  await pool.query(`
    ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS username TEXT;
  `);

  // ── Chipy Kalender ─────────────────────────────────────────────────────────
  // Simple built-in calendar for orgs without Google/Microsoft/Cal.com
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chippy_schedules (
      org_id      UUID PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
      schedule    JSONB NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chippy_blocks (
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
  await pool.query(`ALTER TABLE chippy_blocks ADD COLUMN IF NOT EXISTS start_time TIME`);
  await pool.query(`ALTER TABLE chippy_blocks ADD COLUMN IF NOT EXISTS end_time   TIME`);
  // Drop old full-day unique index (we now allow multiple time-based blocks per day)
  await pool.query(`DROP INDEX IF EXISTS chippy_blocks_org_date_uniq`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chippy_blocks_org_idx ON chippy_blocks(org_id, date);
  `);
  // Unique index only for full-day blocks (start_time IS NULL)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS chippy_blocks_fullday_uniq
      ON chippy_blocks(org_id, date) WHERE start_time IS NULL;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chippy_bookings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      customer_name   TEXT NOT NULL,
      customer_phone  TEXT NOT NULL,
      service         TEXT,
      notes           TEXT,
      slot_time       TIMESTAMPTZ NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Prevent double bookings for the same org + slot time.
  // PLAN #2: on existing servers, duplicate rows may already exist (before this
  // index was added). Clean them up first — keep only the newest per (org_id,
  // slot_time) so the UNIQUE INDEX creation succeeds.
  await pool.query(`
    DELETE FROM chippy_bookings a
      USING chippy_bookings b
      WHERE a.org_id = b.org_id
        AND a.slot_time = b.slot_time
        AND a.created_at < b.created_at;
  `).catch(() => {/* table may not exist yet on first boot */});
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS chippy_bookings_org_slot_uniq ON chippy_bookings(org_id, slot_time);
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
  if (row.access_token) {
    const dec = decryptToken(row.access_token);
    if (dec === null) {
      process.stderr.write(`[calendar] decrypt access_token failed for org ${row.org_id}/${row.provider}\n`);
    }
    row.access_token = dec ?? '';
  }
  if (row.refresh_token) {
    const dec = decryptToken(row.refresh_token);
    if (dec === null) {
      process.stderr.write(`[calendar] decrypt refresh_token failed for org ${row.org_id}/${row.provider}\n`);
    }
    row.refresh_token = dec;
  }
  if (row.api_key !== undefined && row.api_key !== null) {
    const dec = decryptToken(row.api_key);
    if (dec === null) {
      process.stderr.write(`[calendar] decrypt api_key failed for org ${row.org_id}/${row.provider}\n`);
    }
    row.api_key = dec;
  }
  return row;
}

async function getConnection(orgId: string): Promise<CalendarConnection | null> {
  if (!pool) return null;
  const res = await pool.query<CalendarConnection>(
    `SELECT * FROM calendar_connections WHERE org_id = $1 LIMIT 1`,
    [orgId],
  );
  return decryptConn(res.rows[0] ?? null);
}

async function getAllConnections(orgId: string): Promise<CalendarConnection[]> {
  if (!pool) return [];
  const res = await pool.query<CalendarConnection>(
    `SELECT * FROM calendar_connections WHERE org_id = $1 ORDER BY created_at`,
    [orgId],
  );
  return res.rows.map((r) => decryptConn(r)!).filter((r): r is CalendarConnection => r !== null);
}

// ── Token Management (Microsoft) ─────────────────────────────────────────────

async function getValidMsToken(orgId: string): Promise<string | null> {
  if (!pool) return null;
  const res = await pool.query<CalendarConnection>(
    `SELECT * FROM calendar_connections WHERE org_id = $1 AND provider = 'microsoft' LIMIT 1`,
    [orgId],
  );
  const conn = decryptConn(res.rows[0] ?? null);
  if (!conn) return null;

  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const needsRefresh =
    conn.token_expires_at != null && new Date(conn.token_expires_at) < fiveMinFromNow;

  if (needsRefresh) {
    if (!conn.refresh_token) return null;
    // CAL-02: serialise concurrent refreshes per (org, provider). Two parallel
    // getValidMsToken() calls used to each hit Microsoft, race on the UPDATE
    // and potentially race-invalidate the refresh_token rotation. Redis lock
    // with 30s TTL — fail-open if Redis is down (single-instance dev).
    const lockKey = `cal:refresh:ms:${orgId}`;
    let gotLock: string | null | undefined = 'skip';
    if (redis?.isOpen) {
      gotLock = await redis.set(lockKey, '1', { NX: true, EX: 30 }).catch(() => null);
      if (!gotLock) {
        // Another request is refreshing — wait briefly then re-read fresh token.
        await new Promise((r) => setTimeout(r, 500));
        const fresh = await pool.query<CalendarConnection>(
          `SELECT * FROM calendar_connections WHERE org_id = $1 AND provider = 'microsoft' LIMIT 1`,
          [orgId],
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
         WHERE org_id = $4 AND provider = 'microsoft'`,
        [encryptToken(data.access_token), encryptToken(data.refresh_token ?? null), expiresAt, orgId],
      );
      return data.access_token;
    } catch {
      return null;
    } finally {
      if (redis?.isOpen && gotLock === '1') {
        await redis.del(lockKey).catch(() => {});
      }
    }
  }

  return conn.access_token;
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

async function getValidToken(orgId: string): Promise<string | null> {
  if (!pool) return null;
  const res = await pool.query<CalendarConnection>(
    `SELECT * FROM calendar_connections WHERE org_id = $1 AND provider = 'google' LIMIT 1`,
    [orgId],
  );
  const conn = decryptConn(res.rows[0] ?? null);
  if (!conn) return null;

  // Refresh if token expires within 5 minutes
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const needsRefresh =
    conn.token_expires_at != null && new Date(conn.token_expires_at) < fiveMinFromNow;

  if (needsRefresh) {
    if (!conn.refresh_token) return null;

    // CAL-02: serialise Google token refresh per org. Redis SET NX EX 30 keeps
    // two concurrent getValidToken() calls from hitting Google at once and
    // racing on the UPDATE. Fail-open when Redis unavailable.
    const lockKey = `cal:refresh:google:${orgId}`;
    let gotLock: string | null | undefined = 'skip';
    if (redis?.isOpen) {
      gotLock = await redis.set(lockKey, '1', { NX: true, EX: 30 }).catch(() => null);
      if (!gotLock) {
        await new Promise((r) => setTimeout(r, 500));
        const fresh = await pool.query<CalendarConnection>(
          `SELECT * FROM calendar_connections WHERE org_id = $1 AND provider = 'google' LIMIT 1`,
          [orgId],
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
         WHERE org_id = $4 AND provider = 'google'`,
        [encryptToken(data.access_token), encryptToken(data.refresh_token ?? null), expiresAt, orgId],
      );

      return data.access_token;
    } catch {
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
  // Accepts e.g. "Mo 10:00", "Di 14:30"
  const dayIndex: Record<string, number> = {
    So: 0, Mo: 1, Di: 2, Mi: 3, Do: 4, Fr: 5, Sa: 6,
  };

  const match = slot.match(/^(\w{2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const [, dayStr, hourStr, minStr] = match;
  if (!dayStr || !hourStr || !minStr) return null;
  const targetDay = dayIndex[dayStr];
  if (targetDay === undefined) return null;

  const now = new Date();
  const result = new Date(now);
  result.setHours(parseInt(hourStr, 10), parseInt(minStr, 10), 0, 0);
  result.setSeconds(0, 0);

  let daysAhead = targetDay - now.getDay();
  if (daysAhead < 0 || (daysAhead === 0 && result <= now)) {
    daysAhead += 7;
  }
  result.setDate(result.getDate() + daysAhead);

  return result;
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

async function getChipySchedule(orgId: string): Promise<{ schedule: ChipySchedule; blocks: string[]; timeBlocks: ChipyBlock[] }> {
  if (!pool) return { schedule: DEFAULT_CHIPPY_SCHEDULE, blocks: [], timeBlocks: [] };

  const [schedRes, blockRes] = await Promise.all([
    pool.query(`SELECT schedule FROM chippy_schedules WHERE org_id = $1`, [orgId]),
    pool.query(
      `SELECT date::text, start_time::text, end_time::text FROM chippy_blocks WHERE org_id = $1 AND date >= CURRENT_DATE ORDER BY date`,
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
  return { schedule, blocks, timeBlocks };
}

function generateChipySlots(schedule: ChipySchedule, blocks: string[], timeBlocks: ChipyBlock[] = []): string[] {
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

    const dateStr = day.toISOString().slice(0, 10);
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
  opts: { date?: string; range?: string; service?: string },
): Promise<{ slots: string[]; source: string }> {
  // Search ALL connected calendars + Chipy, merge results
  const connections = await getAllConnections(orgId);
  const allSlots: string[] = [];
  const sources: string[] = [];

  // Always check Chipy built-in calendar first
  const { schedule, blocks, timeBlocks } = await getChipySchedule(orgId);
  const hasChipy = Object.values(schedule).some((d) => d.enabled);
  if (hasChipy) {
    allSlots.push(...generateChipySlots(schedule, blocks, timeBlocks));
    sources.push('chippy');
  }

  // Check each external calendar
  for (const conn of connections) {
    try {
      const connSlots = await findSlotsForConnection(conn, orgId);
      if (connSlots.length > 0) {
        allSlots.push(...connSlots);
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
  const unique = [...new Set(allSlots)].sort();
  return { slots: unique, source: sources.join('+') || 'chippy' };
}

async function findSlotsForConnection(
  conn: CalendarConnection,
  orgId: string,
): Promise<string[]> {
  // ── Cal.com path ───────────────────────────────────────────────────────────
  if (conn.provider === 'calcom') {
    const apiKey = conn.api_key;
    if (!apiKey) return [];

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
    const token = await getValidMsToken(orgId);
    if (!token) return [];
    const email = conn.email ?? '';
    return msFindSlots(token, email);
  }

  // ── Google path ────────────────────────────────────────────────────────────
  const token = await getValidToken(orgId);
  if (!token) return [];

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

    if (!resp.ok) return [];

    const data = (await resp.json()) as {
      calendars: Record<string, { busy: { start: string; end: string }[] }>;
    };

    const busyPeriods = data.calendars[conn.calendar_id]?.busy ?? [];
    return generateFreeSlots(busyPeriods);
  } catch {
    return [];
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
  },
): Promise<{ ok: boolean; eventId?: string; bookingId?: number; error?: string }> {
  const connections = await getAllConnections(orgId);
  const slotTime = parseSlotTime(opts.time);

  // No external calendars — book directly into Chipy
  if (connections.length === 0) {
    if (!slotTime) return { ok: false, error: `Cannot parse time: ${opts.time}` };
    let chippyBookingId: string | undefined;
    if (pool) {
      const res = await pool.query(
        `INSERT INTO chippy_bookings (org_id, customer_name, customer_phone, service, notes, slot_time)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, opts.customerName, opts.customerPhone, opts.service || null, opts.notes || null, slotTime.toISOString()],
      );
      chippyBookingId = res.rows[0]?.id as string | undefined;
    }
    return { ok: true, eventId: chippyBookingId };
  }

  // Book into ALL connected external calendars (fire-and-collect)
  const results: { provider: string; ok: boolean; eventId?: string; error?: string }[] = [];
  for (const conn of connections) {
    try {
      const result = await bookSlotForConnection(conn, orgId, opts);
      results.push({ provider: conn.provider, ...result });
    } catch (e) {
      results.push({ provider: conn.provider, ok: false, error: (e instanceof Error ? e.message : 'Unknown error') });
    }
  }

  // If at least one external booking succeeded, also create chippy record
  const anySuccess = results.some(r => r.ok);
  const firstSuccess = results.find(r => r.ok);

  let chippyBookingId: string | undefined;
  if (anySuccess && slotTime && pool) {
    try {
      const res = await pool.query(
        `INSERT INTO chippy_bookings (org_id, customer_name, customer_phone, service, notes, slot_time)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, opts.customerName, opts.customerPhone, opts.service || null, opts.notes || null, slotTime.toISOString()],
      );
      chippyBookingId = res.rows[0]?.id as string | undefined;
    } catch {
      // Chipy record is best-effort; external booking already succeeded
    }
  }

  if (anySuccess) {
    return { ok: true, eventId: firstSuccess?.eventId ?? chippyBookingId };
  }

  // All external failed — try chippy-only as fallback
  if (slotTime && pool) {
    try {
      const res = await pool.query(
        `INSERT INTO chippy_bookings (org_id, customer_name, customer_phone, service, notes, slot_time)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, opts.customerName, opts.customerPhone, opts.service || null, opts.notes || null, slotTime.toISOString()],
      );
      chippyBookingId = res.rows[0]?.id as string | undefined;
      return { ok: true, eventId: chippyBookingId };
    } catch {
      // Fall through to error
    }
  }

  return { ok: false, error: results.map(r => `${r.provider}: ${r.error}`).join('; ') };
}

async function bookSlotForConnection(
  conn: CalendarConnection,
  orgId: string,
  opts: { customerName: string; customerPhone: string; time: string; service: string; notes?: string },
): Promise<{ ok: boolean; eventId?: string; error?: string }> {

  // ── Microsoft path ─────────────────────────────────────────────────────────
  if (conn.provider === 'microsoft') {
    const token = await getValidMsToken(orgId);
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
  const token = await getValidToken(orgId);
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

      const state = signOAuthState(orgId, 'google');

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

      // Short-lived HMAC state token (separate secret to prevent CSRF / JWT-leak cross-contamination)
      const state = signOAuthState(orgId, 'google');

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

    // Upsert calendar connection (unique on org_id + provider)
    await pool.query(
      `INSERT INTO calendar_connections
         (org_id, provider, access_token, refresh_token, token_expires_at, calendar_id, email)
       VALUES ($1, 'google', $2, $3, $4, 'primary', $5)
       ON CONFLICT (org_id, provider) DO UPDATE SET
         access_token    = EXCLUDED.access_token,
         refresh_token   = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
         token_expires_at = EXCLUDED.token_expires_at,
         email           = COALESCE(EXCLUDED.email, calendar_connections.email)`,
      [orgId, encryptToken(tokens.access_token), encryptToken(tokens.refresh_token ?? null), expiresAt, calendarEmail],
    );

    return reply.redirect(`${appUrl}?calendarConnected=true`);
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
      }).safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'apiKey required (10-200 chars)' });
      }
      const { apiKey, username: usernameInput } = parsed.data;

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
      await pool.query(
        `INSERT INTO calendar_connections
           (org_id, provider, access_token, calendar_id, email, api_key, username)
         VALUES ($1, 'calcom', '', 'calcom', $2, $3, $4)
         ON CONFLICT (org_id, provider) DO UPDATE SET
           email    = COALESCE(EXCLUDED.email, calendar_connections.email),
           api_key  = EXCLUDED.api_key,
           username = COALESCE(EXCLUDED.username, calendar_connections.username)`,
        [orgId, calEmail, encryptToken(apiKey), calUsername],
      );

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

      if (!pool) {
        return reply.send({ connected: false, source: 'no-db' });
      }

      const conn = await getConnection(orgId);

      // Check if Chipy built-in calendar has configured hours
      const { schedule } = await getChipySchedule(orgId);
      const hasChipy = Object.values(schedule).some((d) => d.enabled);

      if (!conn) {
        // No external calendar — report Chipy status
        return reply.send({
          connected: hasChipy,
          provider: hasChipy ? 'chippy' : null,
          email: null,
          chippy: { configured: hasChipy, schedule },
        });
      }

      // Verify external connection is still valid
      let connectionValid = true;
      if (conn.provider === 'google') {
        const token = await getValidToken(orgId);
        if (!token) connectionValid = false;
      } else if (conn.provider === 'microsoft') {
        const token = await getValidMsToken(orgId);
        if (!token) connectionValid = false;
      }

      const base = {
        connected: connectionValid,
        provider: connectionValid ? conn.provider : (hasChipy ? 'chippy' : null),
        email: connectionValid ? (conn.email ?? null) : null,
        calendarId: conn.calendar_id ?? null,
        chippy: { configured: hasChipy, schedule },
        ...((!connectionValid && conn.provider) ? { expired: true, expiredProvider: conn.provider } : {}),
      };

      if (conn.provider === 'calcom' && conn.api_key) {
        const eventTypes = await calcomGetEventTypes(conn.api_key);
        return reply.send({ ...base, username: conn.username ?? null, eventTypes });
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

      if (!pool) {
        return reply.send({ ok: true, note: 'No-op (no database configured)' });
      }

      await pool.query(
        `DELETE FROM calendar_connections WHERE org_id = $1`,
        [orgId],
      );

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
      const state = signOAuthState(orgId, 'microsoft');

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

    await pool.query(
      `INSERT INTO calendar_connections
         (org_id, provider, access_token, refresh_token, token_expires_at, calendar_id, email)
       VALUES ($1, 'microsoft', $2, $3, $4, 'primary', $5)
       ON CONFLICT (org_id, provider) DO UPDATE SET
         access_token     = EXCLUDED.access_token,
         refresh_token    = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
         token_expires_at = EXCLUDED.token_expires_at,
         email            = COALESCE(EXCLUDED.email, calendar_connections.email)`,
      [orgId, encryptToken(tokens.access_token), encryptToken(tokens.refresh_token ?? null), expiresAt, msEmail],
    );

    return reply.redirect(`${appUrl}?calendarConnected=true`);
  });

  // ── Chipy Calendar Routes ─────────────────────────────────────────────────

  const auth = { onRequest: [app.authenticate] };

  /** GET /calendar/chippy — get schedule + blocks + upcoming bookings */
  app.get('/calendar/chippy', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const { schedule } = await getChipySchedule(orgId);

    let bookings: unknown[] = [];
    if (pool) {
      const res = await pool.query(
        `SELECT id, customer_name, customer_phone, service, notes, slot_time
         FROM chippy_bookings WHERE org_id = $1 AND slot_time >= now()
         ORDER BY slot_time LIMIT 50`,
        [orgId],
      );
      bookings = res.rows;
    }

    const blockRes = pool ? await pool.query(
      `SELECT id, date::text, start_time::text, end_time::text, reason
       FROM chippy_blocks WHERE org_id = $1 AND date >= CURRENT_DATE ORDER BY date, start_time NULLS FIRST`,
      [orgId],
    ) : { rows: [] };

    return { schedule, blocks: blockRes.rows, bookings };
  });

  /** PUT /calendar/chippy — save weekly schedule */
  // CAL-09: Zod-validate the schedule blob so a 100MB JSON payload or a
  // deeply-nested prototype-pollution object can't land in the DB.
  const ChipyScheduleSchema = z.record(z.string(), z.object({
    enabled: z.boolean(),
    start: z.string().max(10),
    end: z.string().max(10),
  }));
  app.put('/calendar/chippy', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const parsed = z.object({ schedule: ChipyScheduleSchema }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid schedule format' });
    if (!pool) return { ok: true };

    await pool.query(
      `INSERT INTO chippy_schedules (org_id, schedule, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (org_id) DO UPDATE SET schedule = $2, updated_at = now()`,
      [orgId, JSON.stringify(parsed.data.schedule)],
    );
    return { ok: true };
  });

  /** POST /calendar/chippy/block — block a specific date or time range */
  // CAL-09: validated with Zod to prevent arbitrary-length strings in DB.
  const ChipyBlockSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start_time: z.string().max(10).optional(),
    end_time: z.string().max(10).optional(),
    reason: z.string().max(500).optional(),
  });
  app.post('/calendar/chippy/block', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const parsed = ChipyBlockSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid block format (date must be YYYY-MM-DD)' });
    if (!pool) return { ok: true };

    const res = await pool.query(
      `INSERT INTO chippy_blocks (org_id, date, start_time, end_time, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [orgId, parsed.data.date, parsed.data.start_time ?? null, parsed.data.end_time ?? null, parsed.data.reason ?? null],
    );
    return { ok: true, id: res.rows[0]?.id };
  });

  /** DELETE /calendar/chippy/block/:id — remove a date block */
  app.delete('/calendar/chippy/block/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    if (!pool) return reply.send({ ok: true });
    await pool.query(`DELETE FROM chippy_blocks WHERE id = $1 AND org_id = $2`, [id, orgId]);
    return { ok: true };
  });

  /** GET /calendar/chippy/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD — list bookings in a range */
  app.get('/calendar/chippy/bookings', { ...auth }, async (req: FastifyRequest) => {
    const { orgId } = req.user as JwtPayload;
    const query = req.query as { from?: string; to?: string };
    if (!pool) return { bookings: [] };
    const from = query.from ?? new Date().toISOString().slice(0, 10);
    const toDate = query.to ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await pool.query(
      `SELECT id, customer_name, customer_phone, service, notes, slot_time, created_at
       FROM chippy_bookings WHERE org_id = $1 AND slot_time >= $2::date AND slot_time < ($3::date + interval '1 day')
       ORDER BY slot_time`,
      [orgId, from, toDate],
    );
    return { bookings: res.rows };
  });

  /** POST /calendar/chippy/bookings — create a manual booking */
  app.post('/calendar/chippy/bookings', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
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
        `INSERT INTO chippy_bookings (org_id, customer_name, customer_phone, service, notes, slot_time)
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

  /** DELETE /calendar/chippy/bookings/:id — delete a manual booking */
  app.delete('/calendar/chippy/bookings/:id', { ...auth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { orgId } = req.user as JwtPayload;
    const { id } = req.params as { id: string };
    if (!pool) return reply.send({ ok: true });
    await pool.query(`DELETE FROM chippy_bookings WHERE id = $1 AND org_id = $2`, [id, orgId]);
    return { ok: true };
  });
}
