import './env.js';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from './db.js';
import type { JwtPayload } from './auth.js';

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
}

// ── Internal DB helpers ───────────────────────────────────────────────────────

async function getConnection(orgId: string): Promise<CalendarConnection | null> {
  if (!pool) return null;
  const res = await pool.query<CalendarConnection>(
    `SELECT * FROM calendar_connections WHERE org_id = $1 LIMIT 1`,
    [orgId],
  );
  return res.rows[0] ?? null;
}

// ── Token Management (Microsoft) ─────────────────────────────────────────────

async function getValidMsToken(orgId: string): Promise<string | null> {
  if (!pool) return null;
  const res = await pool.query<CalendarConnection>(
    `SELECT * FROM calendar_connections WHERE org_id = $1 AND provider = 'microsoft' LIMIT 1`,
    [orgId],
  );
  const conn = res.rows[0] ?? null;
  if (!conn) return null;

  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const needsRefresh =
    conn.token_expires_at != null && new Date(conn.token_expires_at) < fiveMinFromNow;

  if (needsRefresh) {
    if (!conn.refresh_token) return null;
    try {
      const resp = await fetch(
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
        [data.access_token, data.refresh_token ?? null, expiresAt, orgId],
      );
      return data.access_token;
    } catch {
      return null;
    }
  }

  return conn.access_token;
}

// ── Microsoft Graph helpers ───────────────────────────────────────────────────

async function msFindSlots(token: string, email: string): Promise<string[]> {
  const now = new Date();
  const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const resp = await fetch('https://graph.microsoft.com/v1.0/me/calendar/getSchedule', {
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
    const resp = await fetch('https://graph.microsoft.com/v1.0/me/calendar/events', {
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
  const conn = res.rows[0] ?? null;
  if (!conn) return null;

  // Refresh if token expires within 5 minutes
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const needsRefresh =
    conn.token_expires_at != null && new Date(conn.token_expires_at) < fiveMinFromNow;

  if (needsRefresh) {
    if (!conn.refresh_token) return null;

    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
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

      const data = (await resp.json()) as { access_token: string; expires_in: number };
      const expiresAt = new Date(Date.now() + data.expires_in * 1000);

      await pool!.query(
        `UPDATE calendar_connections
         SET access_token = $1, token_expires_at = $2
         WHERE org_id = $3 AND provider = 'google'`,
        [data.access_token, expiresAt, orgId],
      );

      return data.access_token;
    } catch {
      return null;
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
    const resp = await fetch(`https://api.cal.com/v1/availability?${params}`, {
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
    const resp = await fetch(`https://api.cal.com/v1/bookings?apiKey=${encodeURIComponent(apiKey)}`, {
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
    const resp = await fetch(
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
  const conn = await getConnection(orgId);
  if (!conn) return { slots: [], source: 'not-connected' };

  // ── Cal.com path ───────────────────────────────────────────────────────────
  if (conn.provider === 'calcom') {
    const apiKey = conn.api_key;
    if (!apiKey) return { slots: [], source: 'calcom-no-key' };

    const now = new Date();
    const dateFrom = now.toISOString().slice(0, 10);
    const dateTo = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const slots = await calcomFindSlots(apiKey, { dateFrom, dateTo });
    return { slots, source: 'calcom' };
  }

  // ── Microsoft path ─────────────────────────────────────────────────────────
  if (conn.provider === 'microsoft') {
    const token = await getValidMsToken(orgId);
    if (!token) return { slots: [], source: 'microsoft-not-connected' };
    const email = conn.email ?? '';
    const slots = await msFindSlots(token, email);
    return { slots, source: 'microsoft' };
  }

  // ── Google path ────────────────────────────────────────────────────────────
  const token = await getValidToken(orgId);
  if (!token) return { slots: [], source: 'not-connected' };

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const resp = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
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
      return { slots: [], source: 'google-error' };
    }

    const data = (await resp.json()) as {
      calendars: Record<string, { busy: { start: string; end: string }[] }>;
    };

    const busyPeriods = data.calendars[conn.calendar_id]?.busy ?? [];
    const slots = generateFreeSlots(busyPeriods);

    return { slots, source: 'google' };
  } catch {
    return { slots: [], source: 'google-error' };
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
  const conn = await getConnection(orgId);
  if (!conn) return { ok: false, error: 'Calendar not connected' };

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
    const resp = await fetch(
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

      const state = app.jwt.sign(
        { orgId, userId: '', role: '' } as { userId: string; orgId: string; role: string },
        { expiresIn: '10m' },
      );

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

      // Short-lived state token to prevent CSRF
      const state = app.jwt.sign(
        { orgId, userId: '', role: '' } as { userId: string; orgId: string; role: string },
        { expiresIn: '10m' },
      );

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
    const query = req.query as Record<string, string>;
    const { code, state, error } = query;

    if (error || !code || !state) {
      const reason = encodeURIComponent(error ?? 'missing_params');
      return reply.redirect(`${appUrl}?calendarError=${reason}`);
    }

    if (!clientId || !clientSecret) {
      return reply.redirect(`${appUrl}?calendarError=not_configured`);
    }

    // Verify state → extract orgId
    let orgId: string;
    try {
      const decoded = app.jwt.verify<{ orgId: string }>(state);
      orgId = decoded.orgId;
    } catch {
      return reply.redirect(`${appUrl}?calendarError=invalid_state`);
    }

    // Exchange authorization code for tokens
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
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
      const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
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
      [orgId, tokens.access_token, tokens.refresh_token ?? null, expiresAt, calendarEmail],
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
      const body = req.body as Record<string, unknown>;
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
      const usernameInput = typeof body.username === 'string' ? body.username : undefined;

      if (!apiKey) {
        return reply.status(400).send({ error: 'apiKey is required' });
      }

      // Validate key via Cal.com /me
      let calEmail: string | null = null;
      let calUsername: string | null = usernameInput ?? null;

      try {
        const meResp = await fetch(
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
        [orgId, calEmail, apiKey, calUsername],
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

      if (!conn) {
        return reply.send({ connected: false, provider: null });
      }

      const base = {
        connected: true,
        provider: conn.provider,
        email: conn.email ?? null,
        calendarId: conn.calendar_id ?? null,
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
      const state = app.jwt.sign(
        { orgId, userId: '', role: '' } as { userId: string; orgId: string; role: string },
        { expiresIn: '10m' },
      );

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
    const query = req.query as Record<string, string>;
    const { code, state, error } = query;

    if (error || !code || !state) {
      return reply.redirect(`${appUrl}?calendarError=${encodeURIComponent(error ?? 'missing_params')}`);
    }

    if (!msClientId || !msClientSecret) {
      return reply.redirect(`${appUrl}?calendarError=not_configured`);
    }

    let orgId: string;
    try {
      const decoded = app.jwt.verify<{ orgId: string }>(state);
      orgId = decoded.orgId;
    } catch {
      return reply.redirect(`${appUrl}?calendarError=invalid_state`);
    }

    // Exchange code for tokens
    const tokenResp = await fetch(
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
      const meResp = await fetch('https://graph.microsoft.com/v1.0/me', {
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

    await pool.query(
      `INSERT INTO calendar_connections
         (org_id, provider, access_token, refresh_token, token_expires_at, calendar_id, email)
       VALUES ($1, 'microsoft', $2, $3, $4, 'primary', $5)
       ON CONFLICT (org_id, provider) DO UPDATE SET
         access_token     = EXCLUDED.access_token,
         refresh_token    = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
         token_expires_at = EXCLUDED.token_expires_at,
         email            = COALESCE(EXCLUDED.email, calendar_connections.email)`,
      [orgId, tokens.access_token, tokens.refresh_token ?? null, expiresAt, msEmail],
    );

    return reply.redirect(`${appUrl}?calendarConnected=true`);
  });
}
