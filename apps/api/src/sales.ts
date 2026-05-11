import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from './db.js';
import { sendSalesTestLinkEmail } from './email.js';

const SALES_ACCESS_TTL = '12h';
const DEFAULT_SALES_PASSWORD = 'phonbotvertrieb123';
const DEFAULT_SALES_EMAIL = 'info@mindrails.de';

type SalesMode = 'auto' | 'semi' | 'self';
type AppointmentType = 'phone' | 'video' | 'field';

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function marker(kind: string, value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  if (!v) return null;
  return crypto.createHash('sha256').update(`${kind}:${v}`).digest('hex');
}

function leadMarkers(lead: { email?: string | null; phone?: string | null; website?: string | null; company_name?: string | null }): string[] {
  return [
    marker('email', lead.email),
    marker('phone', lead.phone),
    marker('website', lead.website?.replace(/^https?:\/\//, '').replace(/\/$/, '')),
    marker('company', lead.company_name),
  ].filter((v): v is string => Boolean(v));
}

async function requireSales(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    const payload = req.user as Record<string, unknown>;
    if (payload.aud !== 'phonbot:sales' || typeof payload.salesRepId !== 'string') {
      return reply.status(403).send({ error: 'Sales access required' });
    }
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    const payload = req.user as Record<string, unknown>;
    if (!payload.admin || payload.aud !== 'phonbot:admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

function salesRepId(req: FastifyRequest): string {
  const payload = req.user as Record<string, unknown>;
  return String(payload.salesRepId);
}

async function loadSalesRep(id: string) {
  if (!pool) return null;
  const res = await pool.query(
    `SELECT id, name, email, active, must_change_password, mode, commission_booker_pct, commission_closer_pct
       FROM sales_reps
      WHERE id = $1 AND active = true`,
    [id],
  );
  return res.rows[0] ?? null;
}

function signSalesToken(app: FastifyInstance, rep: { id: string; email: string; name: string; must_change_password: boolean }) {
  return app.jwt.sign(
    { aud: 'phonbot:sales', salesRepId: rep.id, email: rep.email, name: rep.name, mustChangePassword: rep.must_change_password },
    { expiresIn: SALES_ACCESS_TTL },
  );
}

export async function migrateSales() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_reps (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      name                  TEXT NOT NULL,
      email                 TEXT NOT NULL UNIQUE,
      password_hash         TEXT NOT NULL,
      active                BOOLEAN NOT NULL DEFAULT true,
      must_change_password  BOOLEAN NOT NULL DEFAULT true,
      mode                  TEXT NOT NULL DEFAULT 'semi' CHECK (mode IN ('auto','semi','self')),
      commission_booker_pct NUMERIC(5,4) NOT NULL DEFAULT 0.05,
      commission_closer_pct NUMERIC(5,4) NOT NULL DEFAULT 0.07,
      last_login_at         TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_leads (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      source                TEXT NOT NULL,
      source_external_id    TEXT,
      source_url            TEXT,
      industry              TEXT NOT NULL,
      company_name          TEXT NOT NULL,
      contact_name          TEXT,
      contact_role          TEXT,
      email                 TEXT,
      phone                 TEXT,
      website               TEXT,
      address               TEXT,
      city                  TEXT,
      lat                   NUMERIC(10,7),
      lng                   NUMERIC(10,7),
      need_score            INT NOT NULL DEFAULT 3 CHECK (need_score BETWEEN 1 AND 5),
      need_reasons          JSONB NOT NULL DEFAULT '[]'::jsonb,
      status                TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','called','hot','converted','do_not_call')),
      last_called_at        TIMESTAMPTZ,
      next_callable_at      TIMESTAMPTZ,
      last_testlink_sent_at TIMESTAMPTZ,
      booked_by_rep_id      UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
      closed_by_rep_id      UUID REFERENCES sales_reps(id) ON DELETE SET NULL
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sales_leads_source_ext_uniq ON sales_leads(source, source_external_id) WHERE source_external_id IS NOT NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_leads_queue_idx ON sales_leads(status, next_callable_at, city, need_score DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_leads_email_idx ON sales_leads(lower(email)) WHERE email IS NOT NULL;`);
  await pool.query(`DELETE FROM sales_leads WHERE status IN ('new','called') AND NULLIF(btrim(phone), '') IS NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_suppression (
      marker_hash TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      reason      TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_hot_leads (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      lead_id               UUID REFERENCES sales_leads(id) ON DELETE SET NULL,
      customer_name         TEXT NOT NULL,
      customer_company      TEXT NOT NULL,
      customer_email        TEXT,
      customer_phone        TEXT,
      customer_address      TEXT,
      appointment_type      TEXT NOT NULL CHECK (appointment_type IN ('phone','video','field')),
      slot_time             TIMESTAMPTZ NOT NULL,
      duration_minutes      INT NOT NULL DEFAULT 45,
      booked_by_rep_id      UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
      owner_rep_id          UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
      claimed_by_rep_id     UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
      handoff_mode          TEXT NOT NULL DEFAULT 'semi' CHECK (handoff_mode IN ('auto','semi','self')),
      status                TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','contract_pending','failed','closed','cancelled')),
      notes                 TEXT,
      close_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
      org_id                UUID REFERENCES orgs(id) ON DELETE SET NULL,
      stripe_customer_id    TEXT,
      stripe_subscription_id TEXT,
      closed_at             TIMESTAMPTZ
    );
  `);
  await pool.query(`
    ALTER TABLE sales_hot_leads DROP CONSTRAINT IF EXISTS sales_hot_leads_status_check;
    ALTER TABLE sales_hot_leads ADD CONSTRAINT sales_hot_leads_status_check
      CHECK (status IN ('scheduled','in_progress','contract_pending','failed','closed','cancelled'));
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_hot_leads_calendar_idx ON sales_hot_leads(appointment_type, slot_time, status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_hot_leads_email_idx ON sales_hot_leads(lower(customer_email)) WHERE customer_email IS NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_commissions (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      hot_lead_id    UUID NOT NULL REFERENCES sales_hot_leads(id) ON DELETE CASCADE,
      rep_id         UUID NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
      role           TEXT NOT NULL CHECK (role IN ('booker','closer')),
      percent        NUMERIC(5,4) NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','stopped')),
      org_id         UUID REFERENCES orgs(id) ON DELETE SET NULL,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      UNIQUE (hot_lead_id, rep_id, role)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      rep_id      UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
      lead_id     UUID REFERENCES sales_leads(id) ON DELETE SET NULL,
      hot_lead_id UUID REFERENCES sales_hot_leads(id) ON DELETE SET NULL,
      kind        TEXT NOT NULL,
      metadata    JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  const defaultHash = await bcrypt.hash(DEFAULT_SALES_PASSWORD, 12);
  await pool.query(
    `INSERT INTO sales_reps (name, email, password_hash, must_change_password, mode)
     VALUES ($1, $2, $3, true, 'semi')
     ON CONFLICT (email) DO NOTHING`,
    ['Hassieb Kalla', DEFAULT_SALES_EMAIL, defaultHash],
  );
}

type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

const INDUSTRY_OSM: Record<string, { label: string; filters: string[] }> = {
  friseur: { label: 'Friseure', filters: ['["shop"="hairdresser"]'] },
  barber: { label: 'Barber', filters: ['["shop"="hairdresser"]'] },
  kosmetik: { label: 'Kosmetikstudios', filters: ['["shop"="beauty"]', '["shop"="cosmetics"]', '["craft"="beautician"]'] },
  restaurant: { label: 'Restaurants', filters: ['["amenity"="restaurant"]', '["amenity"="cafe"]', '["amenity"="fast_food"]'] },
};

function leadScore(input: { phone: string | null; email: string | null; website: string | null; tags: Record<string, string> }): { score: number; reasons: string[] } {
  let score = 2;
  const reasons: string[] = [];
  if (input.phone) {
    score += 1;
    reasons.push('Telefonnummer öffentlich sichtbar: hoher Anrufanteil wahrscheinlich.');
  }
  if (!input.website) {
    score += 1;
    reasons.push('Keine Website gefunden: Termin- und Infoanfragen landen vermutlich häufiger telefonisch.');
  } else if (!/termin|booking|book|treatwell|calendly|shore|planity/i.test(input.website)) {
    score += 1;
    reasons.push('Website gefunden, aber kein klarer Online-Buchungsanbieter erkennbar.');
  }
  if (input.tags.opening_hours) {
    reasons.push('Öffnungszeiten vorhanden: gute Grundlage für Gesprächsargument „außerhalb der Öffnungszeiten erreichbar“.');
  }
  if (!input.email) {
    reasons.push('Keine E-Mail in der Quelle: Telefon dürfte ein wichtiger Kanal sein.');
  }
  return { score: Math.max(1, Math.min(5, score)), reasons };
}

function osmAddress(tags: Record<string, string>): string | null {
  const parts = [
    [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
    [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' '),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

async function fetchOsmLeads(industry: string, city: string, limit: number, offset = 0) {
  const spec = INDUSTRY_OSM[industry] ?? INDUSTRY_OSM.friseur!;
  const safeCity = city.replace(/["\\]/g, '').slice(0, 80);
  const cappedLimit = Math.min(Math.max(limit, 5), 80);
  const safeOffset = Math.min(Math.max(offset, 0), 1000);
  const fetchLimit = Math.min(Math.max(safeOffset + cappedLimit * 4, 80), 500);
  const branches = spec.filters.flatMap((filter) => [
    `      node${filter}(area.searchArea);`,
    `      way${filter}(area.searchArea);`,
    `      relation${filter}(area.searchArea);`,
  ]).join('\n');
  const query = `
    [out:json][timeout:24];
    area["name"="${safeCity}"]["boundary"="administrative"]->.searchArea;
    (
${branches}
    );
    out center ${fetchLimit};
  `;
  const body = new URLSearchParams({ data: query });
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Phonbot Sales Research/1.0' },
    body,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = await res.json() as { elements?: OsmElement[] };
  const leads = (json.elements ?? []).map((el) => {
    const tags = el.tags ?? {};
    const company = tags.name?.trim();
    if (!company) return null;
    const phone = (tags.phone ?? tags['contact:phone'] ?? '').trim();
    if (!phone) return null;
    const email = tags.email ?? tags['contact:email'] ?? null;
    const website = tags.website ?? tags['contact:website'] ?? null;
    const { score, reasons } = leadScore({ phone, email, website, tags });
    return {
      source: 'openstreetmap',
      sourceExternalId: `${el.type}:${el.id}`,
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      industry,
      companyName: company.slice(0, 200),
      contactName: null as string | null,
      contactRole: null as string | null,
      email,
      phone,
      website,
      address: osmAddress(tags),
      city: tags['addr:city'] ?? city,
      lat: el.lat ?? el.center?.lat ?? null,
      lng: el.lon ?? el.center?.lon ?? null,
      needScore: score,
      needReasons: reasons,
    };
  }).filter((v): v is NonNullable<typeof v> => Boolean(v));
  return leads.slice(safeOffset, safeOffset + cappedLimit);
}

async function insertCommission(hotLeadId: string, repId: string | null | undefined, role: 'booker' | 'closer', percent: number, extras: { orgId?: string | null; stripeCustomerId?: string | null; stripeSubscriptionId?: string | null } = {}) {
  if (!pool || !repId) return;
  await pool.query(
    `INSERT INTO sales_commissions (hot_lead_id, rep_id, role, percent, status, org_id, stripe_customer_id, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, 'active', $5, $6, $7)
     ON CONFLICT (hot_lead_id, rep_id, role) DO UPDATE SET
       status = 'active',
       org_id = COALESCE(EXCLUDED.org_id, sales_commissions.org_id),
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, sales_commissions.stripe_customer_id),
       stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, sales_commissions.stripe_subscription_id)`,
    [hotLeadId, repId, role, percent, extras.orgId ?? null, extras.stripeCustomerId ?? null, extras.stripeSubscriptionId ?? null],
  );
}

export async function attributeSalesConversionForEmail(email: string, orgId?: string | null, stripeCustomerId?: string | null, stripeSubscriptionId?: string | null) {
  if (!pool || !email) return;
  const res = await pool.query(
    `SELECT h.*, b.commission_booker_pct, c.commission_closer_pct
       FROM sales_hot_leads h
       LEFT JOIN sales_reps b ON b.id = h.booked_by_rep_id
       LEFT JOIN sales_reps c ON c.id = COALESCE(h.claimed_by_rep_id, h.owner_rep_id, h.booked_by_rep_id)
      WHERE lower(h.customer_email) = lower($1)
        AND h.status IN ('scheduled','in_progress','contract_pending','failed')
      ORDER BY CASE WHEN h.status = 'contract_pending' THEN 0 WHEN h.status = 'in_progress' THEN 1 WHEN h.status = 'scheduled' THEN 2 ELSE 3 END, h.updated_at DESC
      LIMIT 1`,
    [email],
  );
  if (!res.rowCount) return;
  const hot = res.rows[0] as Record<string, unknown>;
  const hotLeadId = String(hot.id);
  const closerId = (hot.claimed_by_rep_id ?? hot.owner_rep_id ?? hot.booked_by_rep_id) as string | null;
  await pool.query(
    `UPDATE sales_hot_leads
        SET status = 'closed',
            closed_at = COALESCE(closed_at, now()),
            org_id = COALESCE($2, org_id),
            stripe_customer_id = COALESCE($3, stripe_customer_id),
            stripe_subscription_id = COALESCE($4, stripe_subscription_id),
            updated_at = now()
      WHERE id = $1`,
    [hotLeadId, orgId ?? null, stripeCustomerId ?? null, stripeSubscriptionId ?? null],
  );
  await insertCommission(hotLeadId, hot.booked_by_rep_id as string | null, 'booker', Number(hot.commission_booker_pct ?? 0.05), { orgId, stripeCustomerId, stripeSubscriptionId });
  await insertCommission(hotLeadId, closerId, 'closer', Number(hot.commission_closer_pct ?? 0.07), { orgId, stripeCustomerId, stripeSubscriptionId });
}

export async function registerSales(app: FastifyInstance) {
  const salesAuth = { onRequest: [requireSales] };
  const adminAuth = { onRequest: [requireAdmin] };

  app.post('/sales/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const parsed = z.object({ email: z.string().email(), password: z.string().min(1).max(72) }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });
    const email = normalizeEmail(parsed.data.email);
    const res = await pool.query(`SELECT * FROM sales_reps WHERE email = $1 AND active = true`, [email]);
    const rep = res.rows[0] as { id: string; email: string; name: string; password_hash: string; must_change_password: boolean } | undefined;
    if (!rep || !(await bcrypt.compare(parsed.data.password, rep.password_hash))) {
      return reply.status(401).send({ error: 'E-Mail oder Passwort falsch' });
    }
    await pool.query(`UPDATE sales_reps SET last_login_at = now() WHERE id = $1`, [rep.id]);
    return { token: signSalesToken(app, rep), rep: { id: rep.id, email: rep.email, name: rep.name, mustChangePassword: rep.must_change_password } };
  });

  app.post('/sales/password', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const parsed = z.object({ currentPassword: z.string().min(1).max(72), newPassword: z.string().min(8).max(72) }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Passwort muss 8 bis 72 Zeichen lang sein.' });
    const id = salesRepId(req);
    const res = await pool.query(`SELECT id, email, name, password_hash FROM sales_reps WHERE id = $1 AND active = true`, [id]);
    const rep = res.rows[0] as { id: string; email: string; name: string; password_hash: string } | undefined;
    if (!rep || !(await bcrypt.compare(parsed.data.currentPassword, rep.password_hash))) {
      return reply.status(401).send({ error: 'Aktuelles Passwort stimmt nicht.' });
    }
    const hash = await bcrypt.hash(parsed.data.newPassword, 12);
    await pool.query(`UPDATE sales_reps SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1`, [id, hash]);
    return { ok: true, token: signSalesToken(app, { id: rep.id, email: rep.email, name: rep.name, must_change_password: false }) };
  });

  app.get('/sales/me', { ...salesAuth }, async (req, reply) => {
    const rep = await loadSalesRep(salesRepId(req));
    if (!rep) return reply.status(404).send({ error: 'Rep not found' });
    return { rep };
  });

  app.get('/sales/dashboard', { ...salesAuth }, async (req) => {
    if (!pool) return { stats: { coldOpen: 0, hotOpen: 0, closed: 0, commissionPct: 12 }, commissions: [] };
    const id = salesRepId(req);
    const [cold, hot, closed, commissions] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n FROM sales_leads WHERE status IN ('new','called') AND NULLIF(btrim(phone), '') IS NOT NULL AND (next_callable_at IS NULL OR next_callable_at <= now())`),
      pool.query(`SELECT count(*)::int AS n FROM sales_hot_leads WHERE status IN ('scheduled','in_progress','contract_pending') AND (booked_by_rep_id = $1 OR owner_rep_id = $1 OR claimed_by_rep_id = $1 OR owner_rep_id IS NULL)`, [id]),
      pool.query(`SELECT count(*)::int AS n FROM sales_hot_leads WHERE status = 'closed' AND (booked_by_rep_id = $1 OR claimed_by_rep_id = $1 OR owner_rep_id = $1)`, [id]),
      pool.query(`SELECT role, percent, status, count(*)::int AS count FROM sales_commissions WHERE rep_id = $1 GROUP BY role, percent, status ORDER BY role`, [id]),
    ]);
    return {
      stats: {
        coldOpen: cold.rows[0]?.n ?? 0,
        hotOpen: hot.rows[0]?.n ?? 0,
        closed: closed.rows[0]?.n ?? 0,
        commissionPct: 12,
      },
      commissions: commissions.rows,
    };
  });

  app.post('/sales/leads/generate', { ...salesAuth, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const parsed = z.object({
      industry: z.string().min(2).max(40).default('friseur'),
      city: z.string().min(2).max(80).default('Berlin'),
      limit: z.coerce.number().int().min(5).max(80).default(30),
      offset: z.coerce.number().int().min(0).max(1000).default(0),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });
    await pool.query(`DELETE FROM sales_leads WHERE status IN ('new','called') AND NULLIF(btrim(phone), '') IS NULL`);
    const found = await fetchOsmLeads(parsed.data.industry, parsed.data.city, parsed.data.limit, parsed.data.offset);
    let inserted = 0;
    for (const lead of found) {
      const markers = leadMarkers({ email: lead.email, phone: lead.phone, website: lead.website, company_name: lead.companyName });
      if (markers.length) {
        const sup = await pool.query(`SELECT 1 FROM sales_suppression WHERE marker_hash = ANY($1::text[]) LIMIT 1`, [markers]);
        if (sup.rowCount) continue;
      }
      const res = await pool.query(
        `INSERT INTO sales_leads (
           source, source_external_id, source_url, industry, company_name, contact_name, contact_role,
           email, phone, website, address, city, lat, lng, need_score, need_reasons
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
         ON CONFLICT (source, source_external_id) WHERE source_external_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          lead.source, lead.sourceExternalId, lead.sourceUrl, lead.industry, lead.companyName, lead.contactName, lead.contactRole,
          lead.email, lead.phone, lead.website, lead.address, lead.city, lead.lat, lead.lng, lead.needScore, JSON.stringify(lead.needReasons),
        ],
      );
      if (res.rowCount) inserted += 1;
    }
    return { ok: true, found: found.length, inserted, source: 'OpenStreetMap / Overpass', offset: parsed.data.offset, nextOffset: parsed.data.offset + parsed.data.limit };
  });

  app.get('/sales/leads', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const q = z.object({
      industry: z.string().optional(),
      city: z.string().optional(),
      minScore: z.coerce.number().int().min(1).max(5).optional(),
      limit: z.coerce.number().int().min(10).max(80).default(30),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const args: unknown[] = [];
    const where = [`status IN ('new','called')`, `NULLIF(btrim(phone), '') IS NOT NULL`, `(next_callable_at IS NULL OR next_callable_at <= now())`];
    if (q.industry) { args.push(q.industry); where.push(`industry = $${args.length}`); }
    if (q.city) { args.push(`%${q.city}%`); where.push(`city ILIKE $${args.length}`); }
    if (q.minScore) { args.push(q.minScore); where.push(`need_score >= $${args.length}`); }
    args.push(q.limit, q.offset);
    const res = await pool.query(
      `SELECT * FROM sales_leads
        WHERE ${where.join(' AND ')}
        ORDER BY city NULLS LAST, lat NULLS LAST, lng NULLS LAST, need_score DESC, created_at DESC
        LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    return { items: res.rows };
  });

  app.get('/sales/leads/:id', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid id' });
    const res = await pool.query(`SELECT * FROM sales_leads WHERE id = $1`, [params.data.id]);
    if (!res.rowCount) return reply.status(404).send({ error: 'Lead nicht gefunden' });
    return { lead: res.rows[0] };
  });

  app.patch('/sales/leads/:id', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({
      email: z.string().trim().email().max(255).optional(),
      phone: z.string().trim().min(5).max(80).optional(),
    }).safeParse(req.body);
    if (!params.success || !body.success || (!body.data.email && !body.data.phone)) {
      return reply.status(400).send({ error: 'Bitte eine gueltige E-Mail oder Telefonnummer eintragen.' });
    }
    const markers = [
      body.data.email ? marker('email', body.data.email) : null,
      body.data.phone ? marker('phone', body.data.phone) : null,
    ].filter((v): v is string => Boolean(v));
    if (markers.length) {
      const sup = await pool.query(`SELECT 1 FROM sales_suppression WHERE marker_hash = ANY($1::text[]) LIMIT 1`, [markers]);
      if (sup.rowCount) return reply.status(409).send({ error: 'Dieser Kontakt wurde dauerhaft gesperrt.' });
    }
    const updates: string[] = [];
    const values: unknown[] = [params.data.id];
    if (body.data.email) {
      values.push(normalizeEmail(body.data.email));
      updates.push(`email = $${values.length}`);
    }
    if (body.data.phone) {
      values.push(body.data.phone);
      updates.push(`phone = $${values.length}`);
    }
    const res = await pool.query(
      `UPDATE sales_leads
          SET ${updates.join(', ')}, updated_at = now()
        WHERE id = $1
        RETURNING *`,
      values,
    );
    if (!res.rowCount) return reply.status(404).send({ error: 'Lead nicht gefunden' });
    return { ok: true, lead: res.rows[0] };
  });

  app.post('/sales/leads/:id/send-testlink', { ...salesAuth, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({
      contactBasis: z.enum(['explicit_request', 'existing_business_relation', 'manual_one_to_one_context']),
      confirm: z.literal(true),
    }).safeParse(req.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Kontaktgrund muss bestätigt werden.' });
    const [leadRes, rep] = await Promise.all([
      pool.query(`SELECT * FROM sales_leads WHERE id = $1`, [params.data.id]),
      loadSalesRep(salesRepId(req)),
    ]);
    const lead = leadRes.rows[0] as { id: string; email: string | null; phone: string | null; company_name: string; contact_name: string | null } | undefined;
    if (!lead) return reply.status(404).send({ error: 'Lead nicht gefunden' });
    if (!lead.phone?.trim()) return reply.status(409).send({ error: 'Dieser Lead hat keine Telefonnummer und wird nicht fuer Cold Calls genutzt.' });
    if (!lead.email) return reply.status(400).send({ error: 'Für diesen Lead ist keine E-Mail hinterlegt.' });
    const result = await sendSalesTestLinkEmail({
      toEmail: lead.email,
      companyName: lead.company_name,
      contactName: lead.contact_name,
      repName: String(rep?.name ?? 'Phonbot Vertrieb'),
      contactBasis: body.data.contactBasis,
    });
    if (!result.ok) return reply.status(502).send({ error: result.error });
    await pool.query(
      `UPDATE sales_leads SET last_testlink_sent_at = now(), updated_at = now() WHERE id = $1`,
      [lead.id],
    );
    await pool.query(
      `INSERT INTO sales_events (rep_id, lead_id, kind, metadata) VALUES ($1, $2, 'testlink_sent', $3::jsonb)`,
      [salesRepId(req), lead.id, JSON.stringify({ contactBasis: body.data.contactBasis })],
    );
    return { ok: true };
  });

  app.post('/sales/leads/:id/called', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid id' });
    await pool.query(
      `UPDATE sales_leads
          SET status = 'called',
              last_called_at = now(),
              next_callable_at = now() + interval '1 month',
              updated_at = now()
        WHERE id = $1`,
      [params.data.id],
    );
    await pool.query(`INSERT INTO sales_events (rep_id, lead_id, kind) VALUES ($1, $2, 'called')`, [salesRepId(req), params.data.id]);
    return { ok: true };
  });

  app.delete('/sales/leads/:id', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid id' });
    const res = await pool.query(`SELECT email, phone, website, company_name FROM sales_leads WHERE id = $1`, [params.data.id]);
    const lead = res.rows[0] as { email: string | null; phone: string | null; website: string | null; company_name: string | null } | undefined;
    if (lead) {
      const pairs = [
        ['email', marker('email', lead.email)],
        ['phone', marker('phone', lead.phone)],
        ['website', marker('website', lead.website?.replace(/^https?:\/\//, '').replace(/\/$/, ''))],
        ['company', marker('company', lead.company_name)],
      ] as const;
      for (const [kind, hash] of pairs) {
        if (hash) {
          await pool.query(
            `INSERT INTO sales_suppression (marker_hash, kind, reason)
             VALUES ($1, $2, 'sales_rep_deleted')
             ON CONFLICT (marker_hash) DO NOTHING`,
            [hash, kind],
          );
        }
      }
    }
    await pool.query(`DELETE FROM sales_leads WHERE id = $1`, [params.data.id]);
    return { ok: true };
  });

  app.post('/sales/leads/:id/book', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({
      appointmentType: z.enum(['phone', 'video', 'field']),
      slotTime: z.string().min(1),
      durationMinutes: z.coerce.number().int().min(15).max(240).default(45),
      notes: z.string().max(2000).optional(),
      handoffMode: z.enum(['auto', 'semi', 'self']).optional(),
    }).safeParse(req.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Invalid booking data' });
    const rep = await loadSalesRep(salesRepId(req)) as { id: string; mode: SalesMode } | null;
    if (!rep) return reply.status(404).send({ error: 'Rep not found' });
    const leadRes = await pool.query(`SELECT * FROM sales_leads WHERE id = $1`, [params.data.id]);
    const lead = leadRes.rows[0] as Record<string, unknown> | undefined;
    if (!lead) return reply.status(404).send({ error: 'Lead nicht gefunden' });
    if (!String(lead.phone ?? '').trim()) return reply.status(409).send({ error: 'Dieser Lead hat keine Telefonnummer und kann nicht gebucht werden.' });
    const handoffMode = body.data.handoffMode ?? rep.mode;
    const ownerRepId = handoffMode === 'auto' ? null : rep.id;
    const hot = await pool.query(
      `INSERT INTO sales_hot_leads (
         lead_id, customer_name, customer_company, customer_email, customer_phone, customer_address,
         appointment_type, slot_time, duration_minutes, booked_by_rep_id, owner_rep_id, handoff_mode, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        params.data.id,
        lead.contact_name ?? lead.company_name,
        lead.company_name,
        lead.email,
        lead.phone,
        lead.address,
        body.data.appointmentType,
        body.data.slotTime,
        body.data.durationMinutes,
        rep.id,
        ownerRepId,
        handoffMode,
        body.data.notes ?? null,
      ],
    );
    await pool.query(`UPDATE sales_leads SET status = 'hot', booked_by_rep_id = $2, updated_at = now() WHERE id = $1`, [params.data.id, rep.id]);
    return { ok: true, hotLead: hot.rows[0] };
  });

  app.get('/sales/hot-leads', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const q = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      status: z.string().optional(),
    }).parse(req.query);
    const args: unknown[] = [];
    const where: string[] = [];
    if (q.from) { args.push(q.from); where.push(`slot_time >= $${args.length}::date`); }
    if (q.to) { args.push(q.to); where.push(`slot_time < ($${args.length}::date + interval '1 day')`); }
    if (q.status) { args.push(q.status); where.push(`status = $${args.length}`); }
    const res = await pool.query(
      `SELECT h.*, br.name AS booked_by_name, cr.name AS claimed_by_name
         FROM sales_hot_leads h
         LEFT JOIN sales_reps br ON br.id = h.booked_by_rep_id
         LEFT JOIN sales_reps cr ON cr.id = h.claimed_by_rep_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY h.slot_time ASC
        LIMIT 250`,
      args,
    );
    return { items: res.rows };
  });

  app.post('/sales/hot-leads/:id/claim', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid id' });
    const repId = salesRepId(req);
    const current = await pool.query(`SELECT owner_rep_id, claimed_by_rep_id, handoff_mode, status FROM sales_hot_leads WHERE id = $1`, [params.data.id]);
    const row = current.rows[0] as { owner_rep_id: string | null; claimed_by_rep_id: string | null; handoff_mode: SalesMode; status: string } | undefined;
    if (!row) return reply.status(404).send({ error: 'Hotlead nicht gefunden' });
    if (row.handoff_mode === 'self' && row.owner_rep_id && row.owner_rep_id !== repId) {
      return reply.status(403).send({ error: 'Dieser Termin ist auf Selbst-Abschluss gestellt.' });
    }
    if (row.claimed_by_rep_id && row.claimed_by_rep_id !== repId && row.status === 'in_progress') {
      return reply.status(409).send({ error: 'Dieser Hotlead ist bereits in Bearbeitung.' });
    }
    await pool.query(
      `UPDATE sales_hot_leads SET claimed_by_rep_id = $2, status = 'in_progress', updated_at = now() WHERE id = $1`,
      [params.data.id, repId],
    );
    return { ok: true };
  });

  app.post('/sales/hot-leads/:id/fail', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid id' });
    const res = await pool.query(
      `UPDATE sales_hot_leads SET status = 'failed', updated_at = now() WHERE id = $1 RETURNING lead_id`,
      [params.data.id],
    );
    const leadId = res.rows[0]?.lead_id as string | null | undefined;
    if (leadId) {
      await pool.query(
        `UPDATE sales_leads
            SET status = 'called', next_callable_at = now() + interval '1 month', updated_at = now()
          WHERE id = $1`,
        [leadId],
      );
    }
    return { ok: true };
  });

  app.post('/sales/hot-leads/:id/close', { ...salesAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({
      planId: z.string().min(2).max(30),
      billingInterval: z.enum(['month', 'year']).default('month'),
      legalConfirmedByCustomer: z.boolean().default(false),
      notes: z.string().max(3000).optional(),
    }).safeParse(req.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Invalid close data' });
    if (body.data.planId) {
      if (!body.data.legalConfirmedByCustomer) {
        return reply.status(400).send({ error: 'Abschluss erst nach Kundenbestaetigung von AGB, Datenschutz, AVV und B2B-Status vorbereiten.' });
      }
      const repId = salesRepId(req);
      const res = await pool.query(
        `UPDATE sales_hot_leads
            SET status = 'contract_pending',
                claimed_by_rep_id = COALESCE(claimed_by_rep_id, $2),
                close_data = close_data || $3::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [params.data.id, repId, JSON.stringify(body.data)],
      );
      const hot = res.rows[0] as Record<string, unknown> | undefined;
      if (!hot) return reply.status(404).send({ error: 'Hotlead nicht gefunden' });
      await pool.query(
        `INSERT INTO sales_events (rep_id, hot_lead_id, kind, metadata)
         VALUES ($1, $2, 'contract_pending', $3::jsonb)`,
        [repId, params.data.id, JSON.stringify({ planId: body.data.planId, billingInterval: body.data.billingInterval })],
      );
      return { ok: true, hotLead: hot };
    }
    if (!body.data.legalConfirmedByCustomer) {
      return reply.status(400).send({ error: 'Abschluss erst nach Kundenbestätigung von AGB, Datenschutz, AVV und B2B-Status markieren.' });
    }
    const repId = salesRepId(req);
    const res = await pool.query(
      `UPDATE sales_hot_leads
          SET status = 'closed',
              claimed_by_rep_id = COALESCE(claimed_by_rep_id, $2),
              close_data = close_data || $3::jsonb,
              closed_at = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [params.data.id, repId, JSON.stringify(body.data)],
    );
    const hot = res.rows[0] as Record<string, unknown> | undefined;
    if (!hot) return reply.status(404).send({ error: 'Hotlead nicht gefunden' });
    const bookedBy = hot.booked_by_rep_id as string | null;
    const closer = (hot.claimed_by_rep_id ?? repId) as string;
    await insertCommission(params.data.id, bookedBy, 'booker', 0.05);
    await insertCommission(params.data.id, closer, 'closer', 0.07);
    if (hot.lead_id) await pool.query(`UPDATE sales_leads SET status = 'converted', closed_by_rep_id = $2, updated_at = now() WHERE id = $1`, [hot.lead_id, closer]);
    return { ok: true, hotLead: hot };
  });

  app.get('/sales/testers', { ...salesAuth }, async (_req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const res = await pool.query(
      `SELECT o.id, o.name, o.created_at, o.plan, o.minutes_used, o.minutes_limit,
              u.email,
              GREATEST(0, LEAST(o.minutes_limit, 30) - COALESCE(o.minutes_used, 0)) AS remaining_minutes,
              (o.minutes_used >= LEAST(o.minutes_limit, 30) OR o.created_at < now() - interval '10 days') AS due
         FROM orgs o
         LEFT JOIN LATERAL (
           SELECT email FROM users WHERE org_id = o.id ORDER BY created_at ASC LIMIT 1
         ) u ON true
        WHERE o.plan = 'free'
        ORDER BY due DESC, remaining_minutes ASC, o.created_at ASC
        LIMIT 100`,
    );
    return { items: res.rows };
  });

  app.get('/sales/messages', { ...salesAuth }, async (_req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const res = await pool.query(
      `SELECT o.name, u.email, o.minutes_used, o.minutes_limit, o.created_at
         FROM orgs o
         LEFT JOIN LATERAL (
           SELECT email FROM users WHERE org_id = o.id ORDER BY created_at ASC LIMIT 1
         ) u ON true
        WHERE o.plan = 'free'
          AND (o.minutes_used >= LEAST(o.minutes_limit, 30) OR o.created_at < now() - interval '10 days')
        ORDER BY o.created_at ASC
        LIMIT 30`,
    );
    return {
      items: res.rows.map((r) => ({
        id: `${r.email ?? r.name}:${r.created_at}`,
        created_at: new Date().toISOString(),
        text: `${r.name} ist nachfassreif: ${Number(r.minutes_used ?? 0).toFixed(1)} Minuten genutzt oder länger als 10 Tage Tester.`,
        anonymized: true,
      })),
    };
  });

  app.get('/admin/sales/reps', { ...adminAuth }, async (_req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const res = await pool.query(
      `SELECT r.id, r.created_at, r.updated_at, r.name, r.email, r.active, r.must_change_password, r.mode,
              r.commission_booker_pct, r.commission_closer_pct, r.last_login_at,
              count(h.id)::int AS hot_leads,
              count(h.id) FILTER (WHERE h.status = 'closed')::int AS closed_leads
         FROM sales_reps r
         LEFT JOIN sales_hot_leads h ON h.booked_by_rep_id = r.id OR h.claimed_by_rep_id = r.id OR h.owner_rep_id = r.id
        GROUP BY r.id
        ORDER BY r.created_at DESC`,
    );
    return { items: res.rows };
  });

  app.post('/admin/sales/reps', { ...adminAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const parsed = z.object({
      name: z.string().min(2).max(120),
      email: z.string().email(),
      temporaryPassword: z.string().min(8).max(72).default(DEFAULT_SALES_PASSWORD),
      mode: z.enum(['auto', 'semi', 'self']).default('semi'),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    const hash = await bcrypt.hash(parsed.data.temporaryPassword, 12);
    const res = await pool.query(
      `INSERT INTO sales_reps (name, email, password_hash, must_change_password, mode)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id, name, email, active, must_change_password, mode, created_at`,
      [parsed.data.name, normalizeEmail(parsed.data.email), hash, parsed.data.mode],
    );
    return reply.status(201).send({ ok: true, rep: res.rows[0] });
  });

  app.patch('/admin/sales/reps/:id', { ...adminAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({
      name: z.string().min(2).max(120).optional(),
      active: z.boolean().optional(),
      mode: z.enum(['auto', 'semi', 'self']).optional(),
    }).safeParse(req.body);
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Invalid input' });
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.data.name !== undefined) { values.push(body.data.name); fields.push(`name = $${values.length}`); }
    if (body.data.active !== undefined) { values.push(body.data.active); fields.push(`active = $${values.length}`); }
    if (body.data.mode !== undefined) { values.push(body.data.mode); fields.push(`mode = $${values.length}`); }
    if (!fields.length) return { ok: true };
    values.push(params.data.id);
    await pool.query(`UPDATE sales_reps SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
    return { ok: true };
  });

  app.post('/admin/sales/reps/:id/reset-password', { ...adminAuth }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({ temporaryPassword: z.string().min(8).max(72).default(DEFAULT_SALES_PASSWORD) }).safeParse(req.body ?? {});
    if (!params.success || !body.success) return reply.status(400).send({ error: 'Invalid input' });
    const hash = await bcrypt.hash(body.data.temporaryPassword, 12);
    await pool.query(
      `UPDATE sales_reps SET password_hash = $2, must_change_password = true, updated_at = now() WHERE id = $1`,
      [params.data.id, hash],
    );
    return { ok: true };
  });

  app.get('/admin/sales/hot-leads', { ...adminAuth }, async (_req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'DB not configured' });
    const res = await pool.query(
      `SELECT h.*, br.name AS booked_by_name, cr.name AS claimed_by_name
         FROM sales_hot_leads h
         LEFT JOIN sales_reps br ON br.id = h.booked_by_rep_id
         LEFT JOIN sales_reps cr ON cr.id = h.claimed_by_rep_id
        ORDER BY h.slot_time DESC
        LIMIT 300`,
    );
    return { items: res.rows };
  });
}
