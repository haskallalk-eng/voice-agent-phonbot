/**
 * In-process LRU cache for agentId → orgId lookups.
 *
 * Extracted into its own module to break the circular dependency between
 * agent-config.ts (which needs invalidateOrgIdCache after deploy) and
 * retell-webhooks.ts (which needs getOrgIdByAgentId on every webhook).
 * Both import from here; neither imports from each other for cache access.
 */

import { pool } from './db.js';

const ORG_ID_CACHE_MAX = 500;
const cache = new Map<string, string>();

/**
 * Resolve org_id from agent_configs by retellAgentId (JSONB lookup).
 * Caches positive hits (orgId found) in an LRU Map. Negative results
 * (null) are NOT cached — a brand-new agent whose first webhook arrives
 * before the DB row is queryable would otherwise be permanently stuck
 * at "unknown agent" until LRU eviction.
 */
export async function getOrgIdByAgentId(agentId: string): Promise<string | null> {
  if (!pool) return null;
  const cached = cache.get(agentId);
  if (cached !== undefined) return cached;

  // Check BOTH main and callback agent IDs — Retell sends agent_id in webhooks
  // which could be either. Without the OR, callback-agent webhooks would always
  // resolve to null (the query only checked retellAgentId, not retellCallbackAgentId).
  const res = await pool.query(
    `SELECT org_id FROM agent_configs
     WHERE data->>'retellAgentId' = $1 OR data->>'retellCallbackAgentId' = $1
     LIMIT 1`,
    [agentId],
  );
  const orgId = (res.rows[0]?.org_id as string | undefined) ?? null;

  if (orgId) {
    if (cache.size >= ORG_ID_CACHE_MAX) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
    cache.set(agentId, orgId);
  }
  return orgId;
}

/**
 * Evict a specific agentId from the cache. Called from agent-config.ts
 * after deploy so a re-deployed agent with a new retellAgentId doesn't
 * serve stale orgId → cross-tenant billing/transcript attribution.
 */
export function invalidateOrgIdCache(agentId: string): void {
  cache.delete(agentId);
}
