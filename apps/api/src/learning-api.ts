/**
 * Learning System API
 *
 * Endpoints:
 *   GET  /learning/templates/:templateId/learnings  — list learnings for a template
 *   GET  /learning/patterns                          — list conversation patterns
 *   GET  /learning/stats                             — global learning stats
 *   POST /learning/apply-to-template/:templateId    — apply top learnings to a template
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import OpenAI from 'openai';
import { pool } from './db.js';

// Gate cross-tenant aggregate reads (template_learnings + conversation_patterns
// pool data across all orgs, so only platform admins may read them directly).
async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    const payload = req.user as Record<string, unknown>;
    if (!payload.admin) {
      reply.status(403).send({ error: 'Admin access required' });
    }
  } catch {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' });
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

export async function registerLearningApi(app: FastifyInstance): Promise<void> {

  // ── GET /learning/consent ──────────────────────────────────────────────────
  // Returns the caller's org's pattern-sharing opt-in state. Auth-only (not
  // admin) — the org owner needs to be able to read & toggle their own consent.
  app.get(
    '/learning/consent',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!pool) return reply.status(503).send({ error: 'Database not available' });
      const { orgId } = req.user as import('./auth.js').JwtPayload;
      const res = await pool.query(
        `SELECT share_patterns, share_patterns_consented_at
         FROM orgs WHERE id = $1 LIMIT 1`,
        [orgId],
      );
      const row = res.rows[0] ?? {};
      return {
        share_patterns: Boolean(row.share_patterns),
        consented_at: row.share_patterns_consented_at ?? null,
      };
    },
  );

  // ── POST /learning/consent ─────────────────────────────────────────────────
  // Toggle the opt-in. consented_at gets set on TRUE (audit trail for GDPR
  // Art. 7 — proof of consent), cleared on FALSE so re-opt-in records a fresh
  // timestamp.
  // INS-02: validate body with Zod — `Boolean(undefined)` is `false`, which
  // could silently disable consent on a malformed/empty request. Explicit
  // schema makes the intent clear and rejects ambiguous input.
  const ConsentBody = z.object({ share_patterns: z.boolean() });
  app.post(
    '/learning/consent',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!pool) return reply.status(503).send({ error: 'Database not available' });
      const { orgId } = req.user as import('./auth.js').JwtPayload;
      const parsed = ConsentBody.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'share_patterns (boolean) required' });
      const optIn = parsed.data.share_patterns;
      await pool.query(
        `UPDATE orgs
         SET share_patterns = $2,
             share_patterns_consented_at = CASE WHEN $2 THEN now() ELSE NULL END
         WHERE id = $1`,
        [orgId, optIn],
      );
      return { ok: true, share_patterns: optIn };
    },
  );

  // ── GET /learning/templates/:templateId/learnings ──────────────────────────
  app.get<{ Params: { templateId: string }; Querystring: { status?: string; limit?: string } }>(
    '/learning/templates/:templateId/learnings',
    { onRequest: [requireAdmin] },
    async (req, reply) => {
      if (!pool) return reply.status(503).send({ error: 'Database not available' });

      const { templateId } = req.params;
      const status = req.query.status ?? 'pending';
      const limit = Math.min(Number(req.query.limit ?? 50), 200);

      const res = await pool.query(
        `SELECT id, template_id, learning_type, content, source_count, avg_impact,
                confidence, status, created_at, applied_at
         FROM template_learnings
         WHERE template_id = $1 AND ($2 = 'all' OR status = $2)
         ORDER BY source_count DESC, created_at DESC
         LIMIT $3`,
        [templateId, status, limit],
      );

      return { learnings: res.rows };
    },
  );

  // ── GET /learning/patterns ─────────────────────────────────────────────────
  app.get<{ Querystring: { industry?: string; pattern_type?: string; limit?: string } }>(
    '/learning/patterns',
    { onRequest: [requireAdmin] },
    async (req, reply) => {
      if (!pool) return reply.status(503).send({ error: 'Database not available' });

      const industry = req.query.industry ?? null;
      const patternType = req.query.pattern_type ?? null;
      const limit = Math.min(Number(req.query.limit ?? 50), 200);

      const res = await pool.query(
        `SELECT id, direction, industry, pattern_type, situation, agent_response,
                effectiveness, usage_count, source_calls, created_at
         FROM conversation_patterns
         WHERE ($1::text IS NULL OR industry = $1)
           AND ($2::text IS NULL OR pattern_type = $2)
         ORDER BY effectiveness DESC NULLS LAST, source_calls DESC
         LIMIT $3`,
        [industry, patternType, limit],
      );

      return { patterns: res.rows };
    },
  );

  // ── GET /learning/stats ────────────────────────────────────────────────────
  app.get(
    '/learning/stats',
    { onRequest: [requireAdmin] },
    async (_req, reply) => {
      if (!pool) return reply.status(503).send({ error: 'Database not available' });

      const [transcriptsRes, patternsRes, learningsRes, trainRes] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total, AVG(score) AS avg_score FROM call_transcripts`),
        pool.query(`SELECT COUNT(*) AS total FROM conversation_patterns`),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'pending') AS pending,
             COUNT(*) FILTER (WHERE status = 'applied') AS applied,
             COUNT(DISTINCT template_id) AS templates_with_learnings
           FROM template_learnings`,
        ),
        pool.query(`SELECT COUNT(*) AS total FROM training_examples`),
      ]);

      return {
        transcripts: {
          total: Number(transcriptsRes.rows[0]?.total ?? 0),
          avg_score: transcriptsRes.rows[0]?.avg_score != null
            ? Number(Number(transcriptsRes.rows[0].avg_score).toFixed(2))
            : null,
        },
        patterns_found: Number(patternsRes.rows[0]?.total ?? 0),
        template_learnings: {
          pending: Number(learningsRes.rows[0]?.pending ?? 0),
          applied: Number(learningsRes.rows[0]?.applied ?? 0),
          templates_improved: Number(learningsRes.rows[0]?.templates_with_learnings ?? 0),
        },
        training_examples: Number(trainRes.rows[0]?.total ?? 0),
      };
    },
  );

  // ── POST /learning/apply-to-template/:templateId ───────────────────────────
  // SCOPED: only applies to the caller's own org. Previously pushed prompt updates
  // across ALL orgs using the template → cross-tenant prompt-sabotage vector.
  app.post<{ Params: { templateId: string }; Body: { limit?: number } }>(
    '/learning/apply-to-template/:templateId',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      if (!pool) return reply.status(503).send({ error: 'Database not available' });
      if (!process.env.OPENAI_API_KEY) return reply.status(503).send({ error: 'OpenAI not configured' });

      const { orgId } = req.user as import('./auth.js').JwtPayload;
      const { templateId } = req.params;
      const limit = Math.min(req.body?.limit ?? 5, 20);

      // Fetch top pending learnings for this template — scoped to caller's org
      const learningsRes = await pool.query(
        `SELECT id, content, source_count, confidence
         FROM template_learnings
         WHERE template_id = $1 AND status = 'pending' AND org_id = $3
         ORDER BY source_count DESC, confidence DESC
         LIMIT $2`,
        [templateId, limit, orgId],
      );

      if (!learningsRes.rows.length) {
        return reply.status(200).send({ message: 'No pending learnings to apply', applied: 0 });
      }

      // Use OpenAI to synthesize learnings into a prompt addition
      const learningsSummary = learningsRes.rows
        .map((r: { content: string; source_count: number }) =>
          `- [${r.source_count} orgs] ${r.content}`)
        .join('\n');

      let promptAddition: string;
      try {
        const resp = await openai.chat.completions.create({
          model: MODEL,
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: 'Du bist Experte für KI-Sprachagenten-Prompts. Synthetisiere Erkenntnisse in klare Prompt-Regeln.',
            },
            {
              role: 'user',
              content: `Folgende Erkenntnisse wurden aus Anrufen von Unternehmen im Template "${templateId}" gesammelt:

${learningsSummary}

Synthetisiere diese zu einem kompakten Prompt-Abschnitt (max 400 Wörter), der als Ergänzung zum Basis-Template dient.
Schreibe direkte Anweisungen, keine Einleitung oder Erklärung.`,
            },
          ],
        });
        promptAddition = resp.choices[0]?.message?.content?.trim() ?? '';
      } catch {
        return reply.status(500).send({ error: 'Failed to synthesize learnings' });
      }

      if (!promptAddition) {
        return reply.status(500).send({ error: 'Empty synthesis result' });
      }

      // Mark learnings as applied — scoped to caller's org to prevent cross-tenant mutation
      const ids = learningsRes.rows.map((r: { id: string }) => r.id);
      await pool.query(
        `UPDATE template_learnings SET status = 'applied', applied_at = now()
         WHERE id = ANY($1::uuid[]) AND org_id = $2`,
        [ids, orgId],
      );

      // Apply ONLY to the caller's own org (was iterating across all orgs = cross-tenant bug)
      let updatedOrgs = 0;
      try {
        const cfgRes = await pool.query(
          `SELECT data FROM agent_configs WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 1`,
          [orgId],
        );
        if (cfgRes.rowCount) {
          const data = cfgRes.rows[0].data as Record<string, unknown>;
          const currentPrompt = (data.systemPrompt as string) ?? '';
          const newPrompt = currentPrompt + '\n\n' + promptAddition;

          await pool.query(
            `UPDATE agent_configs
             SET data = jsonb_set(data, '{systemPrompt}', to_jsonb($2::text)), updated_at = now()
             WHERE org_id = $1`,
            [orgId, newPrompt],
          );

          const llmId = data.retellLlmId as string | undefined;
          if (llmId) {
            const { buildAgentInstructions } = await import('./agent-instructions.js');
            const { updateLLM } = await import('./retell.js');
            const updatedData = { ...data, systemPrompt: newPrompt };
            const instructions = buildAgentInstructions(updatedData as Parameters<typeof buildAgentInstructions>[0]);
            await updateLLM(llmId, { generalPrompt: instructions });
          }
          updatedOrgs = 1;
        }
      } catch (e) {
        req.log.warn({ err: (e as Error).message, orgId }, 'apply-to-template: update failed');
      }

      return {
        applied: ids.length,
        template_id: templateId,
        prompt_addition: promptAddition,
        orgs_updated: updatedOrgs,
      };
    },
  );
}
