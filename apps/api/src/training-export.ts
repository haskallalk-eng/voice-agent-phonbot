/**
 * Training Data Export
 *
 * Generates and exports training examples from stored call transcripts.
 *
 * Quality rules:
 *   - score ≥ 8  → quality_label = 'good'
 *   - score ≤ 4  → quality_label = 'bad'
 *   - DPO pairs: when both good and bad examples exist for the same industry
 *
 * Export endpoint:
 *   GET /learning/export?format=jsonl&industry=hairdresser&quality=good
 */

import type { FastifyInstance } from 'fastify';
import { pool } from './db.js';
import { redis } from './redis.js';

// Distributed lock for generateTrainingExamples — prevents duplicate inserts when
// multiple /learning/export requests fire the fire-and-forget generator concurrently.
const LOCK_KEY = 'lock:generate_training_examples';
const LOCK_TTL_SEC = 300;

async function acquireLock(): Promise<boolean> {
  if (!redis?.isOpen) return true; // no redis → best-effort, proceed
  // SET NX with TTL — atomic. Returns 'OK' if acquired, null otherwise.
  const res = await redis.set(LOCK_KEY, '1', { NX: true, EX: LOCK_TTL_SEC });
  return res === 'OK';
}
async function releaseLock(): Promise<void> {
  if (redis?.isOpen) await redis.del(LOCK_KEY).catch(() => {});
}

// ── Training example generation ───────────────────────────────────────────────

interface TranscriptRow {
  call_id: string;
  transcript: string;
  agent_prompt: string | null;
  score: number;
  industry: string | null;
  direction: string;
}

function buildMessages(transcript: string): Array<{ role: string; content: string }> {
  // Parse "Agent: ...\nUser: ..." style transcripts into chat messages.
  // Falls back to a single user message containing the whole transcript.
  const lines = transcript.split('\n').filter(Boolean);
  const messages: Array<{ role: string; content: string }> = [];

  for (const line of lines) {
    if (/^(agent|assistant|bot|ki|ai):/i.test(line)) {
      messages.push({ role: 'assistant', content: line.replace(/^[^:]+:\s*/i, '').trim() });
    } else if (/^(user|customer|kunde|caller|anrufer):/i.test(line)) {
      messages.push({ role: 'user', content: line.replace(/^[^:]+:\s*/i, '').trim() });
    }
  }

  if (!messages.length) {
    messages.push({ role: 'user', content: transcript.slice(0, 6000) });
  }

  return messages;
}

/**
 * Auto-generate training examples from call_transcripts.
 * Called periodically or on-demand — idempotent (uses ON CONFLICT DO NOTHING on call_id + quality_label).
 */
export async function generateTrainingExamples(limit = 100): Promise<number> {
  if (!pool) return 0;
  // Skip if another worker is already running the generator
  if (!(await acquireLock())) return 0;
  try {
    return await _generateTrainingExamplesImpl(limit);
  } finally {
    await releaseLock();
  }
}

async function _generateTrainingExamplesImpl(limit: number): Promise<number> {
  if (!pool) return 0;

  // Fetch transcripts with scores that don't yet have training examples
  const res = await pool.query<TranscriptRow & { org_id: string | null }>(
    `SELECT ct.call_id, ct.transcript, ct.agent_prompt, ct.score::float AS score,
            ct.industry, ct.direction, ct.org_id
     FROM call_transcripts ct
     WHERE ct.score IS NOT NULL
       AND ct.transcript IS NOT NULL
       AND ct.call_id NOT IN (
         SELECT DISTINCT (metadata->>'call_id')
         FROM training_examples
         WHERE metadata->>'call_id' IS NOT NULL
       )
     ORDER BY ct.created_at DESC
     LIMIT $1`,
    [limit],
  );

  let created = 0;

  for (const row of res.rows) {
    const score = Number(row.score);
    let qualityLabel: string | null = null;

    if (score >= 8) qualityLabel = 'good';
    else if (score <= 4) qualityLabel = 'bad';
    else continue; // Skip middle-ground scores

    // Build messages then redact PII (phone/email/IBAN/CC/address/DOB) before persisting.
    // Training data must be free of customer-identifying info even if export is org-scoped —
    // in case we ever fine-tune + share derived models.
    const { redactMessages, redactPII } = await import('./pii.js');
    const messages = redactMessages(buildMessages(row.transcript));
    const safeSystemPrompt = redactPII(row.agent_prompt ?? null);

    await pool.query(
      `INSERT INTO training_examples
         (org_id, example_type, direction, industry, system_prompt, messages, score, quality_label, metadata)
       VALUES ($1, 'chat_completion', $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        row.org_id,
        row.direction,
        row.industry ?? null,
        safeSystemPrompt,
        JSON.stringify(messages),
        score.toFixed(2),
        qualityLabel,
        JSON.stringify({ call_id: row.call_id }),
      ],
    );
    created++;
  }

  // Generate DPO pairs: for each industry that has both good and bad examples
  await generateDpoPairs();

  return created;
}

async function generateDpoPairs(): Promise<void> {
  if (!pool) return;

  // Find industries with both good and bad examples not yet paired
  const industriesRes = await pool.query(
    `SELECT industry FROM training_examples
     WHERE quality_label IN ('good', 'bad') AND industry IS NOT NULL
     GROUP BY industry
     HAVING COUNT(DISTINCT quality_label) = 2`,
  );

  for (const row of industriesRes.rows as Array<{ industry: string }>) {
    const industry = row.industry;

    // Get one good and one bad example for this industry
    const [goodRes, badRes] = await Promise.all([
      pool.query(
        `SELECT id, messages, system_prompt, score FROM training_examples
         WHERE industry = $1 AND quality_label = 'good'
           AND id NOT IN (
             SELECT (metadata->>'good_id')::uuid FROM training_examples
             WHERE example_type = 'dpo_pair'
               AND metadata->>'good_id' IS NOT NULL
               AND metadata->>'good_id' ~ '^[0-9a-f]{8}-'
           )
         ORDER BY score DESC LIMIT 1`,
        [industry],
      ),
      pool.query(
        `SELECT id, messages, system_prompt, score FROM training_examples
         WHERE industry = $1 AND quality_label = 'bad'
           AND id NOT IN (
             SELECT (metadata->>'bad_id')::uuid FROM training_examples
             WHERE example_type = 'dpo_pair'
               AND metadata->>'bad_id' IS NOT NULL
               AND metadata->>'bad_id' ~ '^[0-9a-f]{8}-'
           )
         ORDER BY score ASC LIMIT 1`,
        [industry],
      ),
    ]);

    const good = goodRes.rows[0];
    const bad = badRes.rows[0];
    if (!good || !bad) continue;

    await pool.query(
      `INSERT INTO training_examples
         (example_type, direction, industry, system_prompt, messages, quality_label, metadata)
       VALUES ('dpo_pair', 'inbound', $1, $2, $3, 'dpo', $4)`,
      [
        industry,
        good.system_prompt ?? null,
        JSON.stringify({ chosen: good.messages, rejected: bad.messages }),
        JSON.stringify({ good_id: good.id, bad_id: bad.id }),
      ],
    );
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export async function registerTrainingExport(app: FastifyInstance): Promise<void> {

  // GET /learning/export — export training data as JSONL
  app.get<{
    Querystring: {
      format?: string;
      industry?: string;
      quality?: string;
      direction?: string;
      example_type?: string;
      limit?: string;
    };
  }>(
    '/learning/export',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (!pool) return reply.status(503).send({ error: 'Database not available' });

      const { orgId } = req.user as import('./auth.js').JwtPayload;
      const format = req.query.format ?? 'jsonl';
      const industry = req.query.industry ?? null;
      const quality = req.query.quality ?? null;
      const direction = req.query.direction ?? null;
      const exampleType = req.query.example_type ?? 'chat_completion';
      const limit = Math.min(Number(req.query.limit ?? 1000), 10000);

      // Optionally trigger generation of new examples first
      generateTrainingExamples(200).catch(() => {});

      // CRITICAL: org_id filter — was previously missing, allowing any authenticated user
      // to download ALL tenants' call transcripts as training data.
      const res = await pool.query(
        `SELECT example_type, direction, industry, system_prompt, messages, score,
                quality_label, metadata, created_at
         FROM training_examples
         WHERE org_id = $1
           AND ($2::text IS NULL OR industry = $2)
           AND ($3::text IS NULL OR quality_label = $3)
           AND ($4::text IS NULL OR direction = $4)
           AND ($5::text IS NULL OR example_type = $5)
         ORDER BY created_at DESC
         LIMIT $6`,
        [orgId, industry, quality, direction, exampleType, limit],
      );

      if (format === 'jsonl') {
        // Return OpenAI fine-tuning JSONL format
        const lines = res.rows.map((row: {
          system_prompt: string | null;
          messages: unknown;
          score: number | null;
          quality_label: string | null;
          industry: string | null;
          example_type: string;
        }) => {
          const messages = (Array.isArray(row.messages) ? row.messages : []) as Array<{ role: string; content: string }>;

          if (row.example_type === 'dpo_pair') {
            // DPO format: { prompt, chosen, rejected }
            const parsed = row.messages as { chosen?: unknown; rejected?: unknown };
            return JSON.stringify({
              prompt: row.system_prompt ?? '',
              chosen: parsed.chosen ?? [],
              rejected: parsed.rejected ?? [],
              industry: row.industry,
            });
          }

          // Standard chat_completion format for OpenAI fine-tuning
          const allMessages = [
            ...(row.system_prompt ? [{ role: 'system', content: row.system_prompt }] : []),
            ...messages,
          ];
          return JSON.stringify({
            messages: allMessages,
            score: row.score,
            quality: row.quality_label,
            industry: row.industry,
          });
        });

        reply.header('Content-Type', 'application/x-ndjson');
        reply.header('Content-Disposition', `attachment; filename="training_${Date.now()}.jsonl"`);
        return reply.send(lines.join('\n'));
      }

      // Default: return JSON array
      return { examples: res.rows, total: res.rows.length };
    },
  );

  // POST /learning/generate — manually trigger training example generation
  app.post(
    '/learning/generate',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (_req, reply) => {
      if (!pool) return reply.status(503).send({ error: 'Database not available' });

      const created = await generateTrainingExamples(500);
      return { created, message: `Generated ${created} new training examples` };
    },
  );
}
