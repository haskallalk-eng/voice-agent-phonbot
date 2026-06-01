import crypto from 'node:crypto';
import { pool } from './db.js';

export type OwnKbGapInput = {
  orgId: string;
  tenantId: string;
  runId?: string | null;
};

export type OwnKbGapReport = {
  orgId: string;
  tenantId: string;
  runId: string | null;
  sourceInventory: Record<string, number>;
  versionInventory: Record<string, number>;
  chunkInventory: Record<string, number>;
  sourceBreakdown: Array<Record<string, unknown>>;
  shadowBuckets: Array<Record<string, unknown>>;
  recommendations: string[];
};

const ALLOWED_OWN_KB_USES = ['agent_facts', 'customer_faq', 'voice_agent', 'public_faq'];

function numericInventory(row: Record<string, unknown> | undefined): Record<string, number> {
  if (!row) return {};
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? value : Number(value) || 0]),
  );
}

function stableBucketId(label: string): string {
  return crypto.createHash('sha256').update(label).digest('hex').slice(0, 12);
}

function recommendationsFor(input: {
  sourceInventory: Record<string, number>;
  chunkInventory: Record<string, number>;
  shadowBuckets: Array<Record<string, unknown>>;
}): string[] {
  const recommendations: string[] = [];
  const retrievableChunks = input.chunkInventory.chunks_retrievable ?? 0;
  const approvedSources = input.sourceInventory.sources_approved ?? 0;
  if (approvedSources === 0 || retrievableChunks === 0) {
    recommendations.push('No approved/current retrievable KB source exists for this tenant. Backfill or approve sources before another rollout attempt.');
  }
  const unansweredBuckets = input.shadowBuckets
    .filter((bucket) => bucket.status === 'not_answerable')
    .map((bucket) => String(bucket.query_bucket ?? 'other'));
  const uniqueBuckets = [...new Set(unansweredBuckets)];
  for (const bucket of uniqueBuckets) {
    if (bucket === 'opening_hours') recommendations.push('Add or verify an approved opening-hours source; current retrievable chunks did not answer these questions.');
    if (bucket === 'appointment') recommendations.push('Add an approved appointment/booking policy source, or keep appointment questions routed to tools instead of KB.');
    if (bucket === 'services') recommendations.push('Add approved service/offer facts with common German ASR variants.');
    if (bucket === 'pricing') recommendations.push('Add approved pricing facts with current validity and expiry.');
    if (bucket === 'location') recommendations.push('Add approved public location/contact facts if the agent may answer them.');
    if (bucket === 'other') recommendations.push('Review hashed uncategorized shadow questions and extend the bucket taxonomy before using them as quality failures.');
  }
  if (retrievableChunks > 0 && unansweredBuckets.length > 0) {
    recommendations.push('Coverage, not table readiness, is the blocker: approved chunks exist but do not match the transcript-derived questions.');
  }
  return [...new Set(recommendations)];
}

export async function diagnoseOwnKbShadowGaps(input: OwnKbGapInput): Promise<OwnKbGapReport> {
  if (!pool) throw new Error('DATABASE_URL is required');
  const allowedUses = ALLOWED_OWN_KB_USES;
  const run = input.runId
    ? await pool.query<{ id: string }>(`
      select id
        from kb_shadow_runs
       where id = $1
         and org_id = $2
         and tenant_id = $3
       limit 1
    `, [input.runId, input.orgId, input.tenantId])
    : await pool.query<{ id: string }>(`
      select id
        from kb_shadow_runs
       where org_id = $1
         and tenant_id = $2
       order by started_at desc
       limit 1
    `, [input.orgId, input.tenantId]);
  const runId = run.rows[0]?.id ?? null;

  const sourceInventory = await pool.query<Record<string, unknown>>(`
    select
      count(*)::int as sources_total,
      count(*) filter (where review_status = 'approved')::int as sources_approved,
      count(*) filter (where contains_pii = false)::int as sources_without_pii,
      count(*) filter (where current_version_id is not null)::int as sources_with_current_version,
      count(*) filter (where allowed_use = any($3::text[]))::int as sources_allowed_for_search,
      count(*) filter (where risk <> 'high')::int as sources_not_high_risk
    from kb_sources
    where org_id = $1
      and tenant_id = $2
  `, [input.orgId, input.tenantId, allowedUses]);

  const versionInventory = await pool.query<Record<string, unknown>>(`
    select
      count(*)::int as versions_total,
      count(*) filter (where status = 'indexed')::int as versions_indexed,
      count(*) filter (where verified_at is not null)::int as versions_verified,
      count(*) filter (where expires_at > now())::int as versions_current
    from kb_source_versions
    where org_id = $1
      and tenant_id = $2
  `, [input.orgId, input.tenantId]);

  const chunkInventory = await pool.query<Record<string, unknown>>(`
    select
      count(*)::int as chunks_total,
      count(*) filter (
        where s.review_status = 'approved'
          and s.current_version_id = v.id
          and v.status = 'indexed'
          and v.expires_at > now()
          and s.contains_pii = false
          and s.allowed_use = any($3::text[])
          and s.risk <> 'high'
      )::int as chunks_retrievable,
      count(e.id)::int as embeddings_total
    from kb_chunks c
    join kb_sources s
      on s.id = c.source_id
     and s.org_id = c.org_id
     and s.tenant_id = c.tenant_id
    join kb_source_versions v
      on v.id = c.source_version_id
     and v.source_id = c.source_id
     and v.org_id = c.org_id
     and v.tenant_id = c.tenant_id
    left join kb_embeddings e
      on e.chunk_id = c.id
     and e.org_id = c.org_id
     and e.tenant_id = c.tenant_id
    where c.org_id = $1
      and c.tenant_id = $2
  `, [input.orgId, input.tenantId, allowedUses]);

  const sourceBreakdown = await pool.query<Record<string, unknown>>(`
    select type, category, allowed_use, review_status, risk, contains_pii, count(*)::int as count
      from kb_sources
     where org_id = $1
       and tenant_id = $2
     group by type, category, allowed_use, review_status, risk, contains_pii
     order by count desc, type, category
  `, [input.orgId, input.tenantId]);

  const shadowBuckets = runId
    ? await pool.query<Record<string, unknown>>(`
      with bucketed as (
        select
          case
            when lower(kb_shadow_results.query_text_redacted) ~ '(kost|preis|euro|tarif)' then 'pricing'
            when lower(kb_shadow_results.query_text_redacted) ~ '(oeffnungs|offnungs|wann|uhr)' then 'opening_hours'
            when lower(kb_shadow_results.query_text_redacted) ~ '(termin|buch|stornier)' then 'appointment'
            when lower(kb_shadow_results.query_text_redacted) ~ '(leistung|service|behandlung)' then 'services'
            when lower(kb_shadow_results.query_text_redacted) ~ '(adresse|wo)' then 'location'
            else 'other'
          end as query_bucket,
          kb_shadow_results.status,
          kb_shadow_results.failure_reason,
          kb_shadow_results.own_latency_ms
        from kb_shadow_results
        join kb_shadow_runs r
          on r.id = kb_shadow_results.run_id
         and r.org_id = $2
         and r.tenant_id = $3
        where kb_shadow_results.run_id = $1
      )
      select
        query_bucket,
        status,
        failure_reason,
        count(*)::int as count,
        percentile_disc(0.95) within group (order by own_latency_ms)::int as p95_latency_ms
      from bucketed
      group by query_bucket, status, failure_reason
      order by count desc, query_bucket
    `, [runId, input.orgId, input.tenantId])
    : { rows: [] };

  const sourceInv = numericInventory(sourceInventory.rows[0]);
  const chunkInv = numericInventory(chunkInventory.rows[0]);
  const buckets = shadowBuckets.rows.map((bucket) => ({
    ...bucket,
    bucket_hash: stableBucketId(String(bucket.query_bucket ?? 'other')),
  }));

  return {
    orgId: input.orgId,
    tenantId: input.tenantId,
    runId,
    sourceInventory: sourceInv,
    versionInventory: numericInventory(versionInventory.rows[0]),
    chunkInventory: chunkInv,
    sourceBreakdown: sourceBreakdown.rows,
    shadowBuckets: buckets,
    recommendations: recommendationsFor({
      sourceInventory: sourceInv,
      chunkInventory: chunkInv,
      shadowBuckets: buckets,
    }),
  };
}
