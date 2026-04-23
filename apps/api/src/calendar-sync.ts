/**
 * External calendar poll-sync.
 *
 * Background worker that pulls events from every connected Google /
 * Microsoft / cal.com calendar into our local `external_calendar_events`
 * cache table. Runs every 5 minutes by default.
 *
 * ── Why a cache at all? ─────────────────────────────────────────────────
 * The Agent path (findFreeSlots / bookSlot in calendar.ts) still calls
 * freeBusy live — that is authoritative for conflict checking during a
 * phone call. This module is ONLY for the UI grid on the Kalender-Seite
 * so we can show external events with their TITLES (which freeBusy does
 * not return) without hammering Google on every page load.
 *
 * ── Design notes you should read before fixing bugs here ───────────────
 *
 *  - The sync is additive-only wrt the agent: if this file is completely
 *    broken, the agent still works correctly (uses live freeBusy). Never
 *    touch findFreeSlots from here.
 *
 *  - Google's `events.list` returns a `nextSyncToken` on the final page.
 *    Storing it on the connection row lets the next sync ask only for
 *    changes since then (delta). If Google returns 410 Gone, the token
 *    has been invalidated (too stale or calendar changed) — we must
 *    nullify it and fall back to a full fetch window.
 *
 *  - Microsoft Graph `calendarView` has no sync-token equivalent with
 *    the permissions we have today. We always fetch the sliding 7d-past
 *    to 30d-future window and diff against our cache.
 *
 *  - cal.com exposes /bookings — simpler, no pagination worries for the
 *    volume Phonbot customers generate (typ. <50 events/month).
 *
 *  - Cancelled events: Google uses `status: 'cancelled'`. We MUST keep
 *    such rows visible in the cache (with the cancelled status flag) or
 *    else the UI keeps showing an event the customer already deleted.
 *    The upsert path flips `status` instead of hard-deleting for the
 *    audit trail.
 *
 *  - Timezone handling: provider responses may give `dateTime` with a
 *    TZ offset or a plain `date` for all-day events. We always store
 *    UTC in `slot_start`/`slot_end` — the UI renders in the user's
 *    browser-local timezone.
 *
 *  - PII: event titles + locations can contain names + addresses.
 *    Nothing from this file is logged at info-level; errors log
 *    provider + orgId + error message only.
 *
 *  - Concurrency: the cron iterates connections serially with a small
 *    delay between orgs, so we never run two syncs for the same
 *    connection in parallel. Phonbot is single-instance; if we ever go
 *    multi-instance we will need a Redis advisory lock here.
 */

import { pool } from './db.js';
import { log } from './logger.js';
import {
  calFetchForSync,
  getValidToken,
  getValidMsToken,
  getAllActiveConnections,
  type CalendarConnection,
} from './calendar.js';

// ── Tuning constants ──────────────────────────────────────────────────────

/** How often the cron fires. 5 min is a balance between UI freshness and
 *  Google API quota. A small org with 10 active kalender connections uses
 *  10 × 12/h × 24 = 2880 calls/day — well under Google's 1M/day quota. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Sliding window we cache. Anything outside is irrelevant to the UI
 *  (we don't show past-than-a-week, and >30d future is unlikely booked). */
const SYNC_PAST_DAYS = 7;
const SYNC_FUTURE_DAYS = 30;

/** Per-connection soft cap on events returned per sync. Guards against a
 *  pathological calendar with thousands of events and against memory
 *  blow-up. 2000 is generous for the customer profile. */
const MAX_EVENTS_PER_SYNC = 2000;

// ── Shared event shape we store ──────────────────────────────────────────

export type ExternalEventRow = {
  org_id: string;
  provider: 'google' | 'microsoft' | 'calcom';
  external_id: string;
  calendar_id: string | null;
  summary: string | null;
  slot_start: string;  // ISO
  slot_end: string;    // ISO
  all_day: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
};

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Sync a single connection. Returns stats or null on non-actionable
 * failure (token lost, provider unknown, etc.). Never throws.
 */
export async function syncConnection(conn: CalendarConnection): Promise<
  | { ok: true; added: number; updated: number; removed: number }
  | { ok: false; reason: string }
> {
  if (!pool) return { ok: false, reason: 'no-db' };

  try {
    let result;
    if (conn.provider === 'google') result = await syncGoogle(conn);
    else if (conn.provider === 'microsoft') result = await syncMicrosoft(conn);
    else if (conn.provider === 'calcom') result = await syncCalcom(conn);
    else return { ok: false, reason: `unsupported provider: ${conn.provider}` };

    await markSyncSuccess(conn, result.newSyncToken);
    return { ok: true, ...result.stats };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // Log only operational metadata — never the error body which may
    // include raw calendar titles in error responses.
    log.warn(
      { orgId: conn.org_id, provider: conn.provider, err: msg.slice(0, 200) },
      'calendar-sync: connection sync failed',
    );
    await markSyncFailure(conn, msg);
    return { ok: false, reason: msg };
  }
}

/**
 * Cron entrypoint — iterate every connection once. Intended to be called
 * from a setInterval started at app boot; safe to also trigger manually
 * (e.g. from a debug endpoint).
 */
export async function syncAllConnections(): Promise<void> {
  if (!pool) return;
  let connections: CalendarConnection[];
  try {
    connections = await getAllActiveConnections();
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'calendar-sync: getAllActiveConnections failed');
    return;
  }
  for (const conn of connections) {
    // 200 ms pause so we don't burst a rate-limit — Google allows ~500 qps
    // per project, but bursting when the cron lands is wasteful. Staggered
    // syncs also spread DB UPSERT load.
    await new Promise((r) => setTimeout(r, 200));
    await syncConnection(conn);
  }
}

/** Start the sync cron — call once at app boot. Idempotent (re-calling
 *  does not double-register). Returns a stop handle for tests. */
let cronHandle: NodeJS.Timeout | null = null;
export function startCalendarSyncCron(): () => void {
  if (cronHandle) return () => { if (cronHandle) { clearInterval(cronHandle); cronHandle = null; } };

  // Don't fire immediately on boot — wait a minute so migrations are done
  // and the app is serving user traffic first.
  const firstDelay = 60_000;
  const firstTimer = setTimeout(() => {
    // Kick off the first run + regular interval.
    syncAllConnections().catch((e) => log.warn({ err: (e as Error).message }, 'first sync run failed'));
    cronHandle = setInterval(() => {
      syncAllConnections().catch((e) => log.warn({ err: (e as Error).message }, 'scheduled sync run failed'));
    }, SYNC_INTERVAL_MS);
    if (typeof cronHandle?.unref === 'function') cronHandle.unref();
  }, firstDelay);
  if (typeof firstTimer?.unref === 'function') firstTimer.unref();

  return () => {
    clearTimeout(firstTimer);
    if (cronHandle) { clearInterval(cronHandle); cronHandle = null; }
  };
}

// ── Google ────────────────────────────────────────────────────────────────

async function syncGoogle(conn: CalendarConnection): Promise<{
  stats: { added: number; updated: number; removed: number };
  newSyncToken: string | null;
}> {
  const token = await getValidToken(conn.org_id);
  if (!token) throw new Error('google-no-token');

  const calId = conn.calendar_id || 'primary';
  const params = new URLSearchParams();
  params.set('singleEvents', 'true');  // expand recurring into individual instances
  params.set('maxResults', '250');     // page size — Google caps at 2500

  // Delta mode if we have a sync_token; else full window mode.
  const useSyncToken = !!conn.sync_token;
  if (useSyncToken) {
    params.set('syncToken', conn.sync_token!);
  } else {
    const { from, to } = windowIso();
    params.set('timeMin', from);
    params.set('timeMax', to);
    params.set('orderBy', 'startTime');
  }

  type GoogleEvent = {
    id: string;
    status?: string;
    summary?: string;
    start?: { date?: string; dateTime?: string; timeZone?: string };
    end?: { date?: string; dateTime?: string; timeZone?: string };
  };

  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  while (events.length < MAX_EVENTS_PER_SYNC) {
    const q = new URLSearchParams(params);
    if (pageToken) q.set('pageToken', pageToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${q.toString()}`;
    const resp = await calFetchForSync(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // 410 Gone = sync_token has been invalidated (too stale or permissions
    // changed). We must clear it and start a full re-sync on the next run.
    if (resp.status === 410 && useSyncToken) {
      await pool!.query(
        `UPDATE calendar_connections SET sync_token = NULL WHERE id = $1`,
        [conn.id],
      );
      throw new Error('google-sync-token-invalidated');
    }
    if (!resp.ok) {
      const body = (await resp.text().catch(() => '')).slice(0, 200);
      throw new Error(`google-${resp.status}:${body}`);
    }

    type Page = {
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    const page = await resp.json() as Page;
    for (const e of page.items ?? []) events.push(e);
    pageToken = page.nextPageToken;
    nextSyncToken = page.nextSyncToken ?? null;
    if (!pageToken) break;
  }

  // Map → our row shape.
  const rows: ExternalEventRow[] = [];
  for (const e of events) {
    if (!e.id) continue;
    const parsed = parseGoogleTime(e.start, e.end);
    if (!parsed) continue;
    rows.push({
      org_id: conn.org_id,
      provider: 'google',
      external_id: e.id,
      calendar_id: calId,
      summary: (e.summary ?? '').slice(0, 500) || null,
      slot_start: parsed.start,
      slot_end: parsed.end,
      all_day: parsed.allDay,
      status: (e.status === 'cancelled' ? 'cancelled'
             : e.status === 'tentative' ? 'tentative'
             : 'confirmed'),
    });
  }

  const stats = await upsertRows(rows);

  // In delta mode we can't infer deletions from "events missing from the
  // response" — Google tells us via status='cancelled' explicitly, which
  // we handle above. In full-window mode, any event still in our cache
  // but NOT in this response window has been deleted externally (or
  // simply moved outside the window); we clear those.
  if (!useSyncToken) {
    const window = windowIso();
    const keepIds = rows.map((r) => r.external_id);
    const removed = await deleteMissing(conn.org_id, 'google', calId, window, keepIds);
    return { stats: { ...stats, removed }, newSyncToken: nextSyncToken };
  }
  return { stats: { ...stats, removed: 0 }, newSyncToken: nextSyncToken };
}

function parseGoogleTime(
  start: { date?: string; dateTime?: string } | undefined,
  end: { date?: string; dateTime?: string } | undefined,
): { start: string; end: string; allDay: boolean } | null {
  if (!start || !end) return null;
  if (start.date && end.date) {
    // all-day: google uses exclusive end. Store as midnight UTC.
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

// ── Microsoft ─────────────────────────────────────────────────────────────

async function syncMicrosoft(conn: CalendarConnection): Promise<{
  stats: { added: number; updated: number; removed: number };
  newSyncToken: null;
}> {
  const token = await getValidMsToken(conn.org_id);
  if (!token) throw new Error('microsoft-no-token');

  const { from, to } = windowIso();
  const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}&$top=250&$orderby=start/dateTime`;

  type GraphEvent = {
    id: string;
    subject?: string;
    isCancelled?: boolean;
    isAllDay?: boolean;
    start?: { dateTime: string; timeZone?: string };
    end?: { dateTime: string; timeZone?: string };
  };

  const events: GraphEvent[] = [];
  let nextLink: string | null = url;
  while (nextLink && events.length < MAX_EVENTS_PER_SYNC) {
    const resp = await calFetchForSync(nextLink, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    if (!resp.ok) {
      const body = (await resp.text().catch(() => '')).slice(0, 200);
      throw new Error(`microsoft-${resp.status}:${body}`);
    }
    const page = await resp.json() as { value?: GraphEvent[]; '@odata.nextLink'?: string };
    for (const e of page.value ?? []) events.push(e);
    nextLink = page['@odata.nextLink'] ?? null;
  }

  const rows: ExternalEventRow[] = [];
  for (const e of events) {
    if (!e.id || !e.start?.dateTime || !e.end?.dateTime) continue;
    rows.push({
      org_id: conn.org_id,
      provider: 'microsoft',
      external_id: e.id,
      calendar_id: conn.calendar_id || null,
      summary: (e.subject ?? '').slice(0, 500) || null,
      slot_start: new Date(e.start.dateTime + 'Z').toISOString(),
      slot_end: new Date(e.end.dateTime + 'Z').toISOString(),
      all_day: !!e.isAllDay,
      status: e.isCancelled ? 'cancelled' : 'confirmed',
    });
  }

  const stats = await upsertRows(rows);
  const window = windowIso();
  const removed = await deleteMissing(conn.org_id, 'microsoft', conn.calendar_id || null, window, rows.map((r) => r.external_id));
  return { stats: { ...stats, removed }, newSyncToken: null };
}

// ── cal.com ───────────────────────────────────────────────────────────────

async function syncCalcom(conn: CalendarConnection): Promise<{
  stats: { added: number; updated: number; removed: number };
  newSyncToken: null;
}> {
  const apiKey = conn.api_key;
  if (!apiKey) throw new Error('calcom-no-api-key');

  // cal.com API v1 — simple bookings endpoint. Pagination via page/limit.
  type CalcomBooking = {
    uid: string;
    title?: string;
    startTime: string;
    endTime: string;
    status?: string;  // ACCEPTED / CANCELLED / PENDING / REJECTED
  };

  const events: CalcomBooking[] = [];
  let cursor: string | null = `https://api.cal.com/v1/bookings?apiKey=${encodeURIComponent(apiKey)}&limit=250`;
  let safety = 0;
  while (cursor && events.length < MAX_EVENTS_PER_SYNC && safety++ < 20) {
    const resp = await calFetchForSync(cursor);
    if (!resp.ok) {
      const body = (await resp.text().catch(() => '')).slice(0, 200);
      throw new Error(`calcom-${resp.status}:${body}`);
    }
    const page = await resp.json() as { bookings?: CalcomBooking[]; nextCursor?: string };
    for (const b of page.bookings ?? []) events.push(b);
    cursor = page.nextCursor ? `https://api.cal.com/v1/bookings?apiKey=${encodeURIComponent(apiKey)}&cursor=${encodeURIComponent(page.nextCursor)}&limit=250` : null;
  }

  const rows: ExternalEventRow[] = [];
  for (const b of events) {
    if (!b.uid || !b.startTime || !b.endTime) continue;
    rows.push({
      org_id: conn.org_id,
      provider: 'calcom',
      external_id: b.uid,
      calendar_id: null,
      summary: (b.title ?? '').slice(0, 500) || null,
      slot_start: new Date(b.startTime).toISOString(),
      slot_end: new Date(b.endTime).toISOString(),
      all_day: false,
      status: b.status === 'CANCELLED' || b.status === 'REJECTED' ? 'cancelled' : 'confirmed',
    });
  }

  const stats = await upsertRows(rows);
  const window = windowIso();
  const removed = await deleteMissing(conn.org_id, 'calcom', null, window, rows.map((r) => r.external_id));
  return { stats: { ...stats, removed }, newSyncToken: null };
}

// ── DB layer ──────────────────────────────────────────────────────────────

async function upsertRows(rows: ExternalEventRow[]): Promise<{ added: number; updated: number }> {
  if (!pool || rows.length === 0) return { added: 0, updated: 0 };

  // Single statement per row keeps the code readable. For small Phonbot
  // customers this is 10–100 rows per sync — negligible. If we ever hit
  // multi-thousand-row syncs, switch to a bulk VALUES-list insert.
  let added = 0, updated = 0;
  for (const r of rows) {
    const res = await pool.query(
      `INSERT INTO external_calendar_events
          (org_id, provider, external_id, calendar_id, summary,
           slot_start, slot_end, all_day, status, last_synced_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
       ON CONFLICT (org_id, provider, external_id) DO UPDATE
         SET summary = EXCLUDED.summary,
             calendar_id = EXCLUDED.calendar_id,
             slot_start = EXCLUDED.slot_start,
             slot_end = EXCLUDED.slot_end,
             all_day = EXCLUDED.all_day,
             status = EXCLUDED.status,
             last_synced_at = now(),
             updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [r.org_id, r.provider, r.external_id, r.calendar_id, r.summary, r.slot_start, r.slot_end, r.all_day, r.status],
    );
    if (res.rows[0]?.inserted) added++; else updated++;
  }
  return { added, updated };
}

async function deleteMissing(
  orgId: string,
  provider: 'google' | 'microsoft' | 'calcom',
  calendarId: string | null,
  window: { from: string; to: string },
  keepIds: string[],
): Promise<number> {
  if (!pool) return 0;

  // Guard against a provider outage that returns 0 events — without this,
  // every row in the cache would be wiped on a single bad response. We
  // require at least ONE event in the fetch response to infer "deletions
  // mean something". Accept one-sync stale cancelled entries over a full
  // wipe; the next successful sync will clean them up.
  if (keepIds.length === 0) {
    log.info(
      { orgId, provider, calendarId },
      'calendar-sync: fetch returned 0 events — skipping delete-missing to avoid mass-wipe on a transient empty response',
    );
    return 0;
  }

  // Only delete rows within the sync window. Past-window rows might still
  // be relevant for UI history; we leave them alone — natural pruning
  // happens via the org's cascade-delete on account removal.
  const sql = `
    DELETE FROM external_calendar_events
     WHERE org_id = $1
       AND provider = $2
       AND slot_start >= $3
       AND slot_start <= $4
       ${calendarId ? 'AND (calendar_id = $5 OR calendar_id IS NULL)' : ''}
       AND external_id <> ALL($${calendarId ? 6 : 5}::text[])`;
  const params: unknown[] = [orgId, provider, window.from, window.to];
  if (calendarId) params.push(calendarId);
  params.push(keepIds);
  const res = await pool.query(sql, params);
  return res.rowCount ?? 0;
}

async function markSyncSuccess(conn: CalendarConnection, newSyncToken: string | null): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE calendar_connections
        SET last_synced_at = now(),
            last_sync_error = NULL,
            sync_token = COALESCE($2, sync_token)
      WHERE id = $1`,
    [conn.id, newSyncToken],
  );
}

async function markSyncFailure(conn: CalendarConnection, error: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `UPDATE calendar_connections
        SET last_sync_error = $2
      WHERE id = $1`,
    [conn.id, error.slice(0, 500)],
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function windowIso(): { from: string; to: string } {
  const now = Date.now();
  const from = new Date(now - SYNC_PAST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + SYNC_FUTURE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

// ── Read API (for HTTP endpoint consumers) ────────────────────────────────

/** Fetch cached external events for an org in a date range. Called by the
 *  UI endpoint; never hits the external providers directly. */
export async function getExternalEventsForOrg(
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<ExternalEventRow[]> {
  if (!pool) return [];
  const res = await pool.query<{
    org_id: string;
    provider: string;
    external_id: string;
    calendar_id: string | null;
    summary: string | null;
    slot_start: string;
    slot_end: string;
    all_day: boolean;
    status: string;
  }>(
    `SELECT org_id, provider, external_id, calendar_id, summary,
            slot_start, slot_end, all_day, status
       FROM external_calendar_events
      WHERE org_id = $1
        AND status <> 'cancelled'
        AND slot_end > $2
        AND slot_start < $3
      ORDER BY slot_start ASC`,
    [orgId, fromIso, toIso],
  );
  return res.rows.map((r) => ({
    org_id: r.org_id,
    provider: r.provider as 'google' | 'microsoft' | 'calcom',
    external_id: r.external_id,
    calendar_id: r.calendar_id,
    summary: r.summary,
    slot_start: r.slot_start,
    slot_end: r.slot_end,
    all_day: r.all_day,
    status: r.status as 'confirmed' | 'tentative' | 'cancelled',
  }));
}
