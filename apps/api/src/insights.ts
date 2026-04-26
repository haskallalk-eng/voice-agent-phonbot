/**
 * AI Insights & Continuous Learning Loop — v4
 *
 * v3: embeddings, consolidation quality check, business context injection
 * v4 improvements:
 * 6. Rejected-suggestion protection: processIssue also checks rejected/applied
 *    suggestions — if a semantically-similar issue was already rejected, it is
 *    silently skipped instead of re-created as a new pending suggestion.
 *    If a similar issue recurs after being applied, a recurrence note is created
 *    (signals the fix may not be working).
 * 7. Embedding cache in holisticReview: group representatives store their
 *    embedding vector — avoids O(n²) API calls (was: n·groups embeds, now: n).
 * 8. Linear-regression trend: replaces the fragile 5-vs-5 average split with
 *    a proper least-squares slope over the full window — more robust against
 *    outliers.
 * 9. Dynamic auto-apply threshold: when avg score ≥ 8 the system requires human
 *    review (threshold = ∞). When avg < 6 it applies aggressively (threshold = 2).
 *    Prevents destabilising a prompt that is already performing well.
 */

import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { pool } from './db.js';
import { logBg } from './logger.js';
import { computeSatisfactionScore, extractSignalsFromCall, storeSatisfactionData } from './satisfaction-signals.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' });
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';

const AUTO_APPLY_THRESHOLD = 3;
const SIMILARITY_THRESHOLD = 0.82;       // cosine similarity — same issue
const HOLISTIC_REVIEW_INTERVAL = 10;
const CONSOLIDATION_FIX_INTERVAL = 5;
const MAX_PROMPT_CHARS = 4000;
const ROLLBACK_SCORE_DROP = 1.0;
const MIN_CALLS_AFTER_CONSOLIDATION = 3; // wait before checking consolidation quality
const COOLDOWN_CALLS = 5;               // min calls between auto-applies (anti-stacking)
const OUTLIER_STD_FACTOR = 1.5;         // calls below mean - N*std are treated as outliers
const MIN_STD_FOR_OUTLIER = 0.5;        // ignore outlier check if scores are very stable
const CONSOLIDATION_MIN_SIMILARITY = 0.70; // reject consolidation if too different from original
const AB_TEST_SCORE_THRESHOLD = 7.0;   // agents scoring >= this get A/B tested instead of direct apply
const AB_TEST_CALLS_TARGET = 15;       // calls needed to evaluate an A/B test (15 for statistical significance)
const AB_TEST_MIN_LIFT = 0.5;          // variant must beat control by this to be promoted
const AB_TEST_MAX_DROP = 0.3;          // rollback if variant drops by more than this

// ── Types ─────────────────────────────────────────────────────────────────────

interface BadMoment {
  quote: string;
  issue: string;
  category: string;
  prompt_fix: string;
}

interface SatisfactionSignalsGpt {
  sentiment?: number;
  task_completed?: boolean;
  escalation_requested?: boolean;
  interruption_count?: number;
}

interface CallAnalysis {
  score: number;
  bad_moments: BadMoment[];
  overall_feedback: string;
  satisfaction_signals?: SatisfactionSignalsGpt;
}

interface BusinessContext {
  name: string;
  description: string;
  industry?: string;
  templateId?: string;
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// INS-05/06: all OpenAI calls get explicit timeouts so a hung model
// endpoint can't stall the insight pipeline indefinitely. Embeddings are
// faster (~2s p99), chat completions need more headroom for long prompts.
const OPENAI_EMBED_TIMEOUT = 10_000;
const OPENAI_CHAT_TIMEOUT = 30_000;

async function embed(text: string): Promise<number[]> {
  const resp = await openai.embeddings.create(
    { model: EMBED_MODEL, input: text.slice(0, 512) },
    { timeout: OPENAI_EMBED_TIMEOUT },
  );
  return resp.data[0]?.embedding ?? [];
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getSystemPrompt(orgId: string): Promise<string> {
  if (!pool) return '';
  const res = await pool.query(
    `SELECT data->>'systemPrompt' AS prompt FROM agent_configs
     WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [orgId],
  );
  return (res.rows[0]?.prompt as string | undefined) ?? '';
}

async function getBusinessContext(orgId: string): Promise<BusinessContext> {
  if (!pool) return { name: '', description: '' };
  const res = await pool.query(
    `SELECT data->>'businessName' AS name, data->>'businessDescription' AS description,
            data->>'industry' AS industry, data->>'templateId' AS template_id
     FROM agent_configs WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [orgId],
  );
  return {
    name: (res.rows[0]?.name as string | undefined) ?? '',
    description: (res.rows[0]?.description as string | undefined) ?? '',
    industry: (res.rows[0]?.industry as string | undefined) ?? undefined,
    templateId: (res.rows[0]?.template_id as string | undefined) ?? undefined,
  };
}

function businessBlock(ctx: BusinessContext): string {
  if (!ctx.name && !ctx.description) return '';
  return `Unternehmen: ${ctx.name}${ctx.description ? `\nBeschreibung: ${ctx.description}` : ''}`;
}

async function getTotalCallCount(orgId: string): Promise<number> {
  if (!pool) return 0;
  const res = await pool.query(`SELECT COUNT(*) AS cnt FROM call_analyses WHERE org_id = $1`, [orgId]);
  return Number(res.rows[0]?.cnt ?? 0);
}

// How many calls have happened since the last prompt change (uses agent_configs.updated_at)
async function callsSinceLastChange(orgId: string): Promise<number> {
  if (!pool) return 999;
  const lastRes = await pool.query(
    `SELECT updated_at FROM agent_configs WHERE org_id=$1 ORDER BY updated_at DESC LIMIT 1`,
    [orgId],
  );
  if (lastRes.rows.length === 0) return 999;
  const lastChange = lastRes.rows[0].updated_at as Date;
  const countRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM call_analyses WHERE org_id=$1 AND created_at > $2`,
    [orgId, lastChange],
  );
  return Number(countRes.rows[0]?.cnt ?? 0);
}

// ── A/B Testing ───────────────────────────────────────────────────────────────

async function isAbTestRunning(orgId: string): Promise<boolean> {
  if (!pool) return false;
  const res = await pool.query(
    `SELECT 1 FROM ab_tests WHERE org_id=$1 AND status='running' LIMIT 1`,
    [orgId],
  );
  return res.rows.length > 0;
}

async function startAbTest(
  orgId: string,
  suggestionId: string,
  variantPrompt: string,
  controlPrompt: string,
): Promise<void> {
  if (!pool) return;
  // Capture the pre-test baseline (last AB_TEST_CALLS_TARGET calls)
  const baselineRes = await pool.query(
    `SELECT AVG(score) AS avg FROM (
       SELECT score FROM call_analyses WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2
     ) t`,
    [orgId, AB_TEST_CALLS_TARGET],
  );
  const controlAvg = baselineRes.rows[0]?.avg != null ? Number(baselineRes.rows[0].avg) : null;
  await pool.query(
    `INSERT INTO ab_tests
       (org_id, suggestion_id, variant_prompt, control_prompt, control_avg_score, calls_target)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [orgId, suggestionId, variantPrompt, controlPrompt, controlAvg, AB_TEST_CALLS_TARGET],
  );
}

async function evaluateAbTest(
  orgId: string,
  test: {
    id: string; suggestion_id: string;
    control_prompt: string; control_avg_score: number | null;
    variant_scores: number[];
  },
): Promise<void> {
  if (!pool) return;
  const variantAvg = test.variant_scores.reduce((a, b) => a + b, 0) / test.variant_scores.length;
  const controlAvg = test.control_avg_score;

  let status: 'promoted' | 'rejected';
  let reason: string;

  if (controlAvg == null) {
    status = 'promoted';
    reason = 'no_baseline';
  } else if (variantAvg >= controlAvg + AB_TEST_MIN_LIFT) {
    status = 'promoted';
    reason = `variant_better:+${(variantAvg - controlAvg).toFixed(2)}`;
  } else if (variantAvg < controlAvg - AB_TEST_MAX_DROP) {
    status = 'rejected';
    reason = `variant_worse:${(variantAvg - controlAvg).toFixed(2)}`;
  } else {
    // Inconclusive — be conservative and rollback
    status = 'rejected';
    reason = `inconclusive:${(variantAvg - controlAvg).toFixed(2)}`;
  }

  await pool.query(
    `UPDATE ab_tests SET status=$1, decision_reason=$2, completed_at=now() WHERE id=$3`,
    [status, reason, test.id],
  );

  if (status === 'rejected') {
    // Rollback to control prompt — variant didn't prove itself
    await pool.query(
      `UPDATE agent_configs
       SET data = jsonb_set(data, '{systemPrompt}', to_jsonb($2::text)), updated_at=now()
       WHERE org_id=$1`,
      [orgId, test.control_prompt],
    );
    await pool.query(
      `UPDATE prompt_suggestions SET effectiveness='ab_rejected' WHERE id=$1`,
      [test.suggestion_id],
    );
    await savePromptVersion(orgId, test.control_prompt, 'ab_rollback');
  } else {
    await pool.query(
      `UPDATE prompt_suggestions SET effectiveness='ab_promoted' WHERE id=$1`,
      [test.suggestion_id],
    );
  }
}

async function recordAbTestCall(orgId: string, score: number): Promise<void> {
  if (!pool) return;
  const testRes = await pool.query(
    `SELECT id, variant_calls, variant_scores, calls_target, control_avg_score,
            control_prompt, suggestion_id
     FROM ab_tests WHERE org_id=$1 AND status='running' ORDER BY created_at DESC LIMIT 1`,
    [orgId],
  );
  if (testRes.rows.length === 0) return;

  const test = testRes.rows[0] as {
    id: string; variant_calls: number; variant_scores: number[];
    calls_target: number; control_avg_score: number | null;
    control_prompt: string; suggestion_id: string;
  };

  const newScores = [...(Array.isArray(test.variant_scores) ? test.variant_scores : []), score];
  const newCalls = test.variant_calls + 1;

  await pool.query(
    `UPDATE ab_tests SET variant_calls=$1, variant_scores=$2 WHERE id=$3`,
    [newCalls, JSON.stringify(newScores), test.id],
  );

  if (newCalls >= test.calls_target) {
    await evaluateAbTest(orgId, { ...test, variant_scores: newScores });
  }
}

// Dynamic threshold — conservative when agent is already good
async function getDynamicThreshold(orgId: string): Promise<number> {
  if (!pool) return AUTO_APPLY_THRESHOLD;
  // Use larger window (20 calls) for more stable threshold
  const res = await pool.query(
    `SELECT AVG(score) AS avg, COUNT(*) AS cnt FROM (
       SELECT score FROM call_analyses WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20
     ) t`,
    [orgId],
  );
  const avg = res.rows[0]?.avg != null ? Number(res.rows[0].avg) : null;
  const cnt = Number(res.rows[0]?.cnt ?? 0);
  if (avg == null || cnt < 5) return AUTO_APPLY_THRESHOLD; // not enough data yet
  // Smooth gradient instead of hard cutoffs
  if (avg >= 8.5) return 10;   // very high quality — conservative, needs 10 occurrences
  if (avg >= 7.5) return 5;    // good quality — moderate threshold
  if (avg < 5.5)  return 2;    // poor quality — aggressive improvement
  return AUTO_APPLY_THRESHOLD;  // default: 3
}

async function getAppliedFixCount(orgId: string): Promise<number> {
  if (!pool) return 0;
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt FROM prompt_suggestions WHERE org_id = $1 AND status IN ('applied','auto_applied')`,
    [orgId],
  );
  return Number(res.rows[0]?.cnt ?? 0);
}

// ── Prompt versioning ─────────────────────────────────────────────────────────

async function savePromptVersion(orgId: string, prompt: string, reason: string): Promise<string | null> {
  if (!pool) return null;
  const scoreRes = await pool.query(
    `SELECT AVG(score) AS avg FROM (
       SELECT score FROM call_analyses WHERE org_id = $1 ORDER BY created_at DESC LIMIT 5
     ) t`,
    [orgId],
  );
  const avg = scoreRes.rows[0]?.avg != null ? Number(scoreRes.rows[0].avg) : null;
  const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM call_analyses WHERE org_id = $1`, [orgId]);
  const res = await pool.query(
    `INSERT INTO prompt_versions (org_id, prompt, reason, avg_score, call_count)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [orgId, prompt, reason, avg, Number(countRes.rows[0]?.cnt ?? 0)],
  );
  return res.rows[0]?.id as string | null;
}

async function setPrompt(orgId: string, newPrompt: string, reason: string): Promise<string | null> {
  if (!pool) return null;
  const old = await getSystemPrompt(orgId);
  let versionId: string | null = null;
  if (old) versionId = await savePromptVersion(orgId, old, `before:${reason}`);
  await pool.query(
    `UPDATE agent_configs
     SET data = jsonb_set(data, '{systemPrompt}', to_jsonb($2::text)), updated_at = now()
     WHERE org_id = $1`,
    [orgId, newPrompt],
  );

  // Sync to live Retell agent — rebuild full instructions and push to Retell LLM
  syncPromptToRetell(orgId).catch((e) => {
    process.stderr.write(`[insights] Retell sync failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}\n`);
  });

  return versionId;
}

/**
 * Reads the full agent config for an org, rebuilds instructions, and pushes to Retell.
 * Fire-and-forget safe — errors are swallowed.
 */
async function syncPromptToRetell(orgId: string): Promise<void> {
  if (!pool) return;
  const configRes = await pool.query(
    `SELECT data FROM agent_configs WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [orgId],
  );
  if (!configRes.rowCount || configRes.rowCount === 0) return;
  const data = configRes.rows[0].data as Record<string, unknown>;
  const llmId = data.retellLlmId as string | undefined;
  if (!llmId) return; // not deployed yet — nothing to sync

  const { buildAgentInstructions } = await import('./agent-instructions.js');
  const { updateLLM } = await import('./retell.js');
  const { loadPlatformBaseline } = await import('./platform-baseline.js');

  // Reconstruct a minimal config object for buildAgentInstructions, then
  // re-prepend the platform baseline so this auto-learning resync doesn't
  // strip the quality floor that deployToRetell originally added.
  const instructions = buildAgentInstructions(data as Parameters<typeof buildAgentInstructions>[0]);
  const baseline = await loadPlatformBaseline();
  await updateLLM(llmId, { generalPrompt: `${baseline}\n\n${instructions}` });
}

async function applyPromptAddition(orgId: string, addition: string): Promise<void> {
  const current = await getSystemPrompt(orgId);
  const updated = current ? `${current}\n\n${addition}` : addition;
  await setPrompt(orgId, updated, 'fix_addition');

  const fixCount = await getAppliedFixCount(orgId);
  // fixCount > 0 guard prevents triggering consolidation on the very first fix (0 % 5 === 0 is a trap)
  if (updated.length > MAX_PROMPT_CHARS || (fixCount > 0 && fixCount % CONSOLIDATION_FIX_INTERVAL === 0)) {
    consolidatePrompt(orgId).catch(logBg('consolidatePrompt', { orgId }));
  }
}

// ── Prompt consolidation ───────────────────────────────────────────────────────

async function consolidatePrompt(orgId: string): Promise<void> {
  if (!pool || !process.env.OPENAI_API_KEY) return;
  const current = await getSystemPrompt(orgId);
  if (!current || current.length < 500) return;

  const ctx = await getBusinessContext(orgId);
  const callCountBefore = await getTotalCallCount(orgId);

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Du bist Experte für präzise KI-Sprachagenten-Prompts. Antworte NUR mit dem Prompt-Text.' },
        {
          role: 'user',
          content: `${businessBlock(ctx) ? businessBlock(ctx) + '\n\n' : ''}Der folgende System-Prompt wurde durch automatisches Lernen erweitert. Schreibe ihn neu als sauberes, strukturiertes Dokument:
- Alle Regeln und Fakten behalten
- Duplikate entfernen
- Widersprüche auflösen (neuere Regeln haben Vorrang)
- Klare Abschnitte
- Auf das Unternehmen und seine Branche angepasst

Aktueller Prompt:
${current}`,
        },
      ],
    }, { timeout: OPENAI_CHAT_TIMEOUT });

    const consolidated = resp.choices[0]?.message?.content?.trim();
    if (!consolidated || consolidated.length < 100) return;

    // Similarity guard — reject consolidation if the rewrite diverges too much from the original.
    // A low cosine score means important rules were likely dropped or fundamentally changed.
    try {
      const [origEmbed, newEmbed] = await Promise.all([
        embed(current.slice(0, 512)),
        embed(consolidated.slice(0, 512)),
      ]);
      if (origEmbed.length > 0 && newEmbed.length > 0 && cosine(origEmbed, newEmbed) < CONSOLIDATION_MIN_SIMILARITY) {
        return; // Too different — possible silent rule loss, abort
      }
    } catch { /* if embedding fails, allow consolidation */ }

    // Save consolidation event with call count for quality check later
    await setPrompt(orgId, consolidated, 'consolidation');
    await pool.query(
      `INSERT INTO prompt_versions (org_id, prompt, reason, avg_score, call_count)
       VALUES ($1, $2, 'consolidation_checkpoint', null, $3)`,
      [orgId, consolidated, callCountBefore],
    );
  } catch { /* silent */ }
}

// ── Consolidation quality check ────────────────────────────────────────────────

async function checkConsolidationQuality(orgId: string): Promise<void> {
  if (!pool) return;

  // Find the most recent consolidation checkpoint
  const cpRes = await pool.query(
    `SELECT id, avg_score, call_count, prompt FROM prompt_versions
     WHERE org_id = $1 AND reason = 'consolidation_checkpoint'
     ORDER BY created_at DESC LIMIT 1`,
    [orgId],
  );
  if (cpRes.rows.length === 0) return;

  const cp = cpRes.rows[0] as { id: string; avg_score: number | null; call_count: number; prompt: string };
  const totalNow = await getTotalCallCount(orgId);
  if (totalNow - cp.call_count < MIN_CALLS_AFTER_CONSOLIDATION) return;

  // Get avg score before consolidation (from the before: snapshot)
  const beforeRes = await pool.query(
    `SELECT avg_score FROM prompt_versions
     WHERE org_id = $1 AND reason = 'before:consolidation'
     ORDER BY created_at DESC LIMIT 1`,
    [orgId],
  );
  const scoreBefore = beforeRes.rows[0]?.avg_score != null ? Number(beforeRes.rows[0].avg_score) : null;
  if (scoreBefore == null) return;

  // Avg score after consolidation
  const afterRes = await pool.query(
    `SELECT AVG(score) AS avg FROM (
       SELECT score FROM call_analyses WHERE org_id = $1 ORDER BY created_at DESC LIMIT ${MIN_CALLS_AFTER_CONSOLIDATION}
     ) t`,
    [orgId],
  );
  const scoreAfter = afterRes.rows[0]?.avg != null ? Number(afterRes.rows[0].avg) : null;
  if (scoreAfter == null) return;

  if (scoreBefore - scoreAfter >= ROLLBACK_SCORE_DROP) {
    // Consolidation hurt quality → roll back to pre-consolidation prompt
    const preRes = await pool.query(
      `SELECT prompt FROM prompt_versions
       WHERE org_id = $1 AND reason = 'before:consolidation'
       ORDER BY created_at DESC LIMIT 1`,
      [orgId],
    );
    if (preRes.rows.length > 0) {
      const prePrompt = preRes.rows[0].prompt as string;
      await pool.query(
        `UPDATE agent_configs
         SET data = jsonb_set(data, '{systemPrompt}', to_jsonb($2::text)), updated_at = now()
         WHERE org_id = $1`,
        [orgId, prePrompt],
      );
      await savePromptVersion(orgId, prePrompt, 'consolidation_rollback');
    }
  }

  // Remove checkpoint so we don't check it again
  await pool.query(`DELETE FROM prompt_versions WHERE id = $1`, [cp.id]);
}

// ── Score-based rollback ───────────────────────────────────────────────────────

async function checkScoreRollback(orgId: string): Promise<void> {
  if (!pool) return;
  // Never interfere with a running A/B test — the test's evaluateAbTest handles its own rollback
  if (await isAbTestRunning(orgId)) return;

  const versionRes = await pool.query(
    `SELECT id, prompt, avg_score, call_count FROM prompt_versions
     WHERE org_id = $1 AND reason LIKE 'before:%'
     ORDER BY created_at DESC LIMIT 1`,
    [orgId],
  );
  if (versionRes.rows.length === 0) return;

  const version = versionRes.rows[0] as { id: string; prompt: string; avg_score: number | null; call_count: number };
  if (version.avg_score == null) return;

  const totalNow = await getTotalCallCount(orgId);
  if (totalNow - version.call_count < 5) return;

  const recentRes = await pool.query(
    `SELECT AVG(score) AS avg FROM (
       SELECT score FROM call_analyses WHERE org_id = $1 ORDER BY created_at DESC LIMIT 5
     ) t`,
    [orgId],
  );
  const recentAvg = recentRes.rows[0]?.avg != null ? Number(recentRes.rows[0].avg) : null;
  if (recentAvg == null) return;

  if (version.avg_score - recentAvg >= ROLLBACK_SCORE_DROP) {
    await pool.query(
      `UPDATE agent_configs
       SET data = jsonb_set(data, '{systemPrompt}', to_jsonb($2::text)), updated_at = now()
       WHERE org_id = $1`,
      [orgId, version.prompt],
    );
    await pool.query(
      `INSERT INTO prompt_versions (org_id, prompt, reason, avg_score, call_count) VALUES ($1,$2,'auto_rollback',$3,$4)`,
      [orgId, version.prompt, recentAvg, totalNow],
    );
    await pool.query(
      `UPDATE prompt_suggestions SET effectiveness = 'rolled_back'
       WHERE org_id = $1 AND status IN ('applied','auto_applied')
         AND applied_at > (SELECT created_at FROM prompt_versions WHERE id = $2)`,
      [orgId, version.id],
    );
  }
}

// ── Optimized fix generation ───────────────────────────────────────────────────

async function generateOptimizedFix(
  examples: { issue: string; quote: string; prompt_fix: string }[],
  currentPrompt: string,
  ctx: BusinessContext,
): Promise<string> {
  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: `Du bist Experte für die Optimierung von KI-Sprachagenten-Prompts. Antworte NUR mit dem Anweisungstext.

PLATTFORM-REGELN:
- Dein Output ist IMMER eine Textergänzung für den System-Prompt des Agenten — keine UI-Anleitung ("klicke auf X", "verbinde Google Calendar") und keine Infrastruktur-Empfehlung.
- Terminbuchung funktioniert IMMER, auch ohne externen Kalender (interner Chipy-Kalender). Niemals empfehlen, einen externen Kalender zu verbinden.
- Wenn dem Agenten konkrete Info fehlt (Parkplätze, Preise, besondere Hausregeln), verwende eine eckige-Klammern-Lücke wie "[bitte konkrete Parkinfo eintragen]" statt etwas zu erfinden. Die UI zwingt den Kunden dann, die Lücke zu füllen, bevor der Prompt angewendet wird.
- 2-4 Sätze. Imperativ formuliert. Keine Kommentare, kein Markdown, nur die reine Anweisung.` },
        {
          role: 'user',
          content: `${businessBlock(ctx) ? businessBlock(ctx) + '\n\n' : ''}Folgendes Problem ist in ${examples.length} Gesprächen aufgetreten:

${examples.map((e, i) => `Beispiel ${i + 1}:\n- Problem: ${e.issue}\n- Zitat: "${e.quote}"\n- Vorschlag: ${e.prompt_fix}`).join('\n\n')}

Aktueller System-Prompt (letzte 500 Zeichen):
${currentPrompt.slice(-500)}

Schreibe eine präzise, direkte Anweisung für den System-Prompt die dieses Problem dauerhaft löst. Berücksichtige den Unternehmenskontext und die PLATTFORM-REGELN oben.`,
        },
      ],
    }, { timeout: OPENAI_CHAT_TIMEOUT });
    return resp.choices[0]?.message?.content?.trim() ?? examples[0]?.prompt_fix ?? '';
  } catch {
    return examples[0]?.prompt_fix ?? '';
  }
}

// ── Effectiveness check ────────────────────────────────────────────────────────

async function checkFixEffectiveness(orgId: string): Promise<void> {
  if (!pool) return;

  const appliedFixes = await pool.query(
    `SELECT id, category, issue_summary, suggested_addition, applied_at
     FROM prompt_suggestions
     WHERE org_id = $1 AND status IN ('applied','auto_applied')
       AND effectiveness IS NULL AND applied_at < now() - interval '1 hour'
     LIMIT 10`,
    [orgId],
  );

  for (const fix of appliedFixes.rows as {
    id: string; category: string; issue_summary: string; suggested_addition: string; applied_at: string;
  }[]) {
    const totalRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM call_analyses WHERE org_id = $1 AND created_at > $2`,
      [orgId, fix.applied_at],
    );
    const totalSinceFix = Number(totalRes.rows[0]?.cnt ?? 0);
    if (totalSinceFix < 3) continue;

    // Score before vs after fix
    const scoreBeforeRes = await pool.query(
      `SELECT AVG(score) AS avg FROM (
         SELECT score FROM call_analyses WHERE org_id = $1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 5
       ) t`,
      [orgId, fix.applied_at],
    );
    const scoreAfterRes = await pool.query(
      `SELECT AVG(score) AS avg FROM (
         SELECT score FROM call_analyses WHERE org_id = $1 AND created_at > $2 ORDER BY created_at LIMIT 5
       ) t`,
      [orgId, fix.applied_at],
    );

    const before = scoreBeforeRes.rows[0]?.avg != null ? Number(scoreBeforeRes.rows[0].avg) : null;
    const after = scoreAfterRes.rows[0]?.avg != null ? Number(scoreAfterRes.rows[0].avg) : null;

    if (before == null || after == null) continue;

    const effective = after >= before - 0.3; // small tolerance
    await pool.query(`UPDATE prompt_suggestions SET effectiveness = $1 WHERE id = $2`,
      [effective ? 'effective' : 'ineffective', fix.id]);

    if (!effective) {
      // Retry with stronger fix
      const recentExamples = await pool.query(
        `SELECT bad_moments FROM call_analyses WHERE org_id = $1 AND created_at > $2 ORDER BY created_at DESC LIMIT 5`,
        [orgId, fix.applied_at],
      );

      // Use embedding to find similar moments
      const fixEmbedding = await embed(fix.issue_summary).catch(() => [] as number[]);
      const moments: BadMoment[] = [];

      for (const row of recentExamples.rows as { bad_moments: BadMoment[] }[]) {
        for (const m of row.bad_moments) {
          if (fixEmbedding.length > 0) {
            const mEmbed = await embed(m.issue).catch(() => [] as number[]);
            if (mEmbed.length > 0 && cosine(fixEmbedding, mEmbed) >= SIMILARITY_THRESHOLD) {
              moments.push(m);
            }
          } else if (m.category === fix.category) {
            moments.push(m);
          }
        }
      }

      if (moments.length > 0) {
        const currentPrompt = await getSystemPrompt(orgId);
        const ctx = await getBusinessContext(orgId);
        const betterFix = await generateOptimizedFix(moments, currentPrompt, ctx);
        const newCount = moments.length;

        // Only create a pending suggestion — do NOT auto-apply here.
        // The normal learning loop (processIssue) will pick this up on the next call
        // and apply all guards (cooldown, A/B test, one-at-a-time, dynamic threshold).
        await pool.query(
          `INSERT INTO prompt_suggestions (org_id, category, issue_summary, suggested_addition, occurrence_count, status, all_examples)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
          [orgId, fix.category, `Retry nach ineffektivem Fix: ${fix.issue_summary}`, betterFix, newCount, JSON.stringify(moments)],
        );
      }
    }
  }
}

// ── Holistic meta-review ───────────────────────────────────────────────────────

async function holisticReview(orgId: string): Promise<void> {
  if (!pool || !process.env.OPENAI_API_KEY) return;

  const recentRes = await pool.query(
    `SELECT score, bad_moments, overall_feedback FROM call_analyses
     WHERE org_id = $1 ORDER BY created_at DESC LIMIT ${HOLISTIC_REVIEW_INTERVAL}`,
    [orgId],
  );
  if (recentRes.rows.length < HOLISTIC_REVIEW_INTERVAL) return;

  const ctx = await getBusinessContext(orgId);
  const currentPrompt = await getSystemPrompt(orgId);
  const rows = recentRes.rows as { score: number; bad_moments: BadMoment[]; overall_feedback: string }[];

  const avgScore = rows.reduce((s, r) => s + r.score, 0) / rows.length;
  const allBadMoments = rows.flatMap(r => r.bad_moments);
  const allFeedback = rows.map(r => r.overall_feedback).filter(Boolean).join('\n');

  // Group issues semantically — store embedding with each group to avoid O(n²) re-embedding
  const grouped: { representative: string; embed: number[]; count: number }[] = [];
  for (const m of allBadMoments) {
    const mEmbed = await embed(m.issue).catch(() => [] as number[]);
    let matched = false;
    for (const g of grouped) {
      if (mEmbed.length > 0 && g.embed.length > 0 && cosine(mEmbed, g.embed) >= SIMILARITY_THRESHOLD) {
        g.count++;
        matched = true;
        break;
      }
    }
    if (!matched) grouped.push({ representative: m.issue, embed: mEmbed, count: 1 });
  }

  // Strip the embed vectors before sending to GPT — they're 1536-dim arrays, useless in a prompt
  const topIssues = grouped.sort((a, b) => b.count - a.count).slice(0, 5)
    .map(g => ({ issue: g.representative, count: g.count }));

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: 'Du bist Senior-Coach für KI-Sprachagenten. Antworte ausschließlich mit JSON.' },
        {
          role: 'user',
          content: `${businessBlock(ctx) ? businessBlock(ctx) + '\n\n' : ''}Analyse der letzten ${HOLISTIC_REVIEW_INTERVAL} Anrufe:
- Ø Score: ${avgScore.toFixed(1)}/10
- Häufigste Probleme (semantisch gruppiert): ${JSON.stringify(topIssues)}
- Feedback-Auszüge: ${allFeedback.slice(0, 800)}

Aktueller System-Prompt:
${currentPrompt.slice(0, 1500)}

Identifiziere die EINE wirkungsvollste Verbesserung für dieses spezifische Unternehmen:
{
  "issue_summary": "<Kernproblem, 1 Satz>",
  "suggested_addition": "<Prompt-Anweisung, 2-5 Sätze, auf Unternehmenskontext angepasst>",
  "expected_improvement": "<warum hilft das, 1 Satz>"
}`,
        },
      ],
    }, { timeout: OPENAI_CHAT_TIMEOUT });

    const raw = (resp.choices[0]?.message?.content ?? '{}')
      .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const result = JSON.parse(raw) as { issue_summary: string; suggested_addition: string; expected_improvement: string };

    if (result.suggested_addition) {
      await pool.query(
        `INSERT INTO prompt_suggestions (org_id, category, issue_summary, suggested_addition, occurrence_count, status)
         VALUES ($1, 'holistic_review', $2, $3, $4, 'pending')`,
        [orgId, `[Holistische Analyse] ${result.issue_summary} — ${result.expected_improvement}`, result.suggested_addition, HOLISTIC_REVIEW_INTERVAL],
      );
    }
  } catch { /* silent */ }
}

// ── Core analysis ─────────────────────────────────────────────────────────────

export async function analyzeCall(
  orgId: string,
  callId: string,
  transcript: string,
  callMeta?: {
    duration_ms?: number;
    disconnection_reason?: string;
    from_number?: string;
    silence_duration_ms?: number;
  },
): Promise<void> {
  if (!pool || !process.env.OPENAI_API_KEY) return;
  if (!transcript?.trim()) return;

  const existing = await pool.query('SELECT id FROM call_analyses WHERE call_id = $1', [callId]);
  if (existing.rows.length > 0) return;

  const [currentPrompt, ctx, cooldownCallCount, avgScoreRow] = await Promise.all([
    getSystemPrompt(orgId),
    getBusinessContext(orgId),
    callsSinceLastChange(orgId),
    pool.query(
      `SELECT AVG(score) AS avg FROM (SELECT score FROM call_analyses WHERE org_id=$1 ORDER BY created_at DESC LIMIT 10) t`,
      [orgId],
    ),
  ]);
  const currentAvgScore: number | null = avgScoreRow.rows[0]?.avg != null ? Number(avgScoreRow.rows[0].avg) : null;

  // Derive dynamic threshold from the same avg score (avoids a second DB query)
  const autoApplyThreshold =
    currentAvgScore == null ? AUTO_APPLY_THRESHOLD :
    currentAvgScore >= 8.0  ? 99 :
    currentAvgScore < 6.0   ? 2  :
    AUTO_APPLY_THRESHOLD;

  // Cooldown guard — never auto-apply if fewer than COOLDOWN_CALLS calls happened since last change.
  // This ensures each fix gets evaluated before the next one is applied.
  const cooldownOk = cooldownCallCount >= COOLDOWN_CALLS;

  let analysis: CallAnalysis;
  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: `Du bist KI-Qualitätsanalyst für Sprachagenten. Antworte ausschließlich mit JSON.

PLATTFORM-REGELN (prompt_fix muss diese respektieren):
- Terminbuchung funktioniert IMMER, auch ohne externen Kalender — es gibt den internen Chipy-Kalender. NIE empfehlen "Google Calendar / Cal.com verbinden", wenn das eigentliche Problem an anderer Stelle liegt (z.B. fehlende Öffnungszeiten, unklarer Service-Katalog, Prompt-Regeln).
- prompt_fix ist IMMER eine Textergänzung für den System-Prompt des Agenten. Niemals eine UI-Anleitung ("klicke auf X", "verbinde Y") — solche Infrastruktur-Änderungen gehören nicht in den Prompt.
- Platzhalter sind erlaubt: wenn dem Agenten tatsächlich konkrete Info fehlt (Parkplätze, Preise, besondere Regeln), darf der prompt_fix eine ECKIGE-KLAMMERN-LÜCKE enthalten wie "[bitte konkrete Parkinfo eintragen]" — die UI gated das Übernehmen bis der Kunde das füllt. NIE etwas erfinden.
- Max. 2 Sätze pro prompt_fix, imperativ formuliert ("Wenn X, dann sage Y."), nicht mehr als eine Regel pro Vorschlag.` },
        {
          role: 'user',
          content: `${businessBlock(ctx) ? businessBlock(ctx) + '\n\n' : ''}System-Prompt des Agenten:
${currentPrompt || '(keiner gesetzt)'}

Transkript:
${transcript}

Analysiere das Gespräch im Kontext des Unternehmens und gib dieses JSON zurück (kein Markdown):
{
  "score": <1-10, 10 = perfekt für dieses Unternehmen>,
  "bad_moments": [
    {
      "quote": "<Zitat max 100 Zeichen>",
      "issue": "<was schiefgelaufen ist, präzise und spezifisch>",
      "category": "<misunderstanding|wrong_info|escalation|unanswered|frustration|other>",
      "prompt_fix": "<konkrete Anweisung für den System-Prompt — siehe Plattform-Regeln oben>"
    }
  ],
  "overall_feedback": "<2-3 Sätze Fazit, bezogen auf dieses Unternehmen>",
  "satisfaction_signals": {
    "sentiment": <Zahl von -1 bis 1, Tonalität des Kunden>,
    "task_completed": <true wenn Termin, Ticket oder Auskunft erfolgreich erledigt>,
    "escalation_requested": <true wenn Kunde nach einem Menschen verlangt hat>,
    "interruption_count": <Anzahl Male der Kunde den Agenten unterbrochen hat>
  }
}

Falls keine Probleme: bad_moments leer. satisfaction_signals ist immer auszufüllen.`,
        },
      ],
    }, { timeout: OPENAI_CHAT_TIMEOUT });

    const raw = (resp.choices[0]?.message?.content ?? '{}')
      .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    analysis = JSON.parse(raw) as CallAnalysis;
  } catch {
    return;
  }

  analysis.score = Math.max(1, Math.min(10, Math.round(analysis.score ?? 5)));
  analysis.bad_moments = Array.isArray(analysis.bad_moments) ? analysis.bad_moments : [];

  await pool.query(
    `INSERT INTO call_analyses (org_id, call_id, score, bad_moments, overall_feedback)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (call_id) DO NOTHING`,
    [orgId, callId, analysis.score, JSON.stringify(analysis.bad_moments), analysis.overall_feedback ?? ''],
  );

  // Enrich transcript record with analysis results (fire-and-forget)
  pool.query(
    `UPDATE call_transcripts SET
       score = $1, bad_moments = $2, agent_prompt = $3,
       industry = $4, template_id = $5, outcome = $6
     WHERE call_id = $7 AND org_id = $8`,
    [
      analysis.score,
      JSON.stringify(analysis.bad_moments),
      currentPrompt,
      ctx.industry ?? null,
      ctx.templateId ?? null,
      analysis.overall_feedback?.toLowerCase().includes('ticket') ? 'ticket' : 'resolved',
      callId,
      orgId,
    ],
  ).catch((err: unknown) => {
    // INS-09: silent swallow here means call_transcripts.score + feedback stay
    // null — all downstream analytics are blind to this call. Log so ops can
    // spot systematic DB issues (constraint violations, connection drops).
    process.stderr.write(`[insights] call_transcripts update failed (orgId=${orgId}, callId=${callId}): ${err instanceof Error ? err.message : String(err)}\n`);
  });

  // Compute and store implicit satisfaction score (fire-and-forget)
  if (callMeta) {
    extractSignalsFromCall(
      { ...callMeta, call_id: callId, org_id: orgId },
      analysis.satisfaction_signals ?? {},
    ).then(signals => {
      const satScore = computeSatisfactionScore(signals);
      return storeSatisfactionData(callId, orgId, satScore, signals, callMeta.disconnection_reason ?? null);
    }).catch((err: unknown) => {
      process.stderr.write(`[insights] satisfaction persist failed (callId=${callId}): ${err instanceof Error ? err.message : String(err)}\n`);
    });
  }

  // Cross-org template learning (fire-and-forget)
  import('./template-learning.js').then(({ processTemplateLearning }) => {
    processTemplateLearning(orgId, callId, analysis).catch(logBg('template-learning', { orgId, callId }));
  }).catch(logBg('template-learning-import'));

  // Outlier detection — if this call's score is a statistical outlier (e.g. angry caller, bad connection),
  // double the threshold so a single freak call can't trigger prompt changes.
  let effectiveThreshold = autoApplyThreshold;
  try {
    const statsRes = await pool.query(
      `SELECT AVG(score) AS avg, STDDEV(score) AS std
       FROM (SELECT score FROM call_analyses WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20) t`,
      [orgId],
    );
    const recentAvg = statsRes.rows[0]?.avg != null ? Number(statsRes.rows[0].avg) : null;
    const recentStd = statsRes.rows[0]?.std != null ? Number(statsRes.rows[0].std) : null;
    if (recentAvg != null && recentStd != null && recentStd >= MIN_STD_FOR_OUTLIER) {
      if (analysis.score < recentAvg - OUTLIER_STD_FACTOR * recentStd) {
        effectiveThreshold = Math.ceil(autoApplyThreshold * 2); // outlier — much harder to auto-apply
      }
    }
  } catch { /* keep default threshold */ }

  // One-fix-per-cycle guard — only one auto-apply per call analysis to prevent cascading changes.
  const appliedInThisCycle = { applied: false };

  // Record this call in any running A/B test before processing issues
  await recordAbTestCall(orgId, analysis.score).catch(logBg('recordAbTestCall', { orgId }));

  // Process each bad moment with semantic matching
  for (const moment of analysis.bad_moments) {
    await processIssue(orgId, moment, currentPrompt, ctx, effectiveThreshold, cooldownOk, appliedInThisCycle, currentAvgScore);
  }

  const totalCalls = await getTotalCallCount(orgId);
  if (totalCalls % HOLISTIC_REVIEW_INTERVAL === 0) holisticReview(orgId).catch(logBg('holisticReview', { orgId }));

  checkFixEffectiveness(orgId).catch(logBg('checkFixEffectiveness', { orgId }));
  checkScoreRollback(orgId).catch(logBg('checkScoreRollback', { orgId }));
  checkConsolidationQuality(orgId).catch(logBg('checkConsolidationQuality', { orgId }));
}

// ── Learning loop with semantic matching ──────────────────────────────────────

async function processIssue(
  orgId: string,
  moment: BadMoment,
  currentPrompt: string,
  ctx: BusinessContext,
  autoApplyThreshold: number,
  cooldownOk: boolean,
  appliedInThisCycle: { applied: boolean },
  currentAvgScore: number | null,
): Promise<void> {
  if (!pool) return;

  let momentEmbedding: number[] = [];
  try {
    momentEmbedding = await embed(moment.issue);
  } catch { /* fall back to category matching */ }

  // Load all non-expired suggestions (pending + rejected + applied) to find the best semantic match
  const allSuggestions = await pool.query(
    `SELECT id, occurrence_count, all_examples, issue_summary, embedding, status
     FROM prompt_suggestions
     WHERE org_id = $1 AND status IN ('pending', 'rejected', 'applied', 'auto_applied')`,
    [orgId],
  );

  let bestMatch: { id: string; occurrence_count: number; all_examples: BadMoment[]; status: string } | null = null;
  let bestSimilarity = 0;

  for (const row of allSuggestions.rows as {
    id: string; occurrence_count: number; all_examples: BadMoment[] | null;
    issue_summary: string; embedding: number[] | null; status: string;
  }[]) {
    let similarity = 0;

    if (momentEmbedding.length > 0 && row.embedding && row.embedding.length > 0) {
      similarity = cosine(momentEmbedding, row.embedding);
    } else {
      try {
        const rowEmbed = await embed(row.issue_summary);
        similarity = momentEmbedding.length > 0 ? cosine(momentEmbedding, rowEmbed) : 0;
      } catch { /* skip */ }
    }

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = {
        id: row.id,
        occurrence_count: row.occurrence_count,
        all_examples: row.all_examples ?? [],
        status: row.status,
      };
    }
  }

  if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
    if (bestMatch.status === 'rejected') {
      // User already rejected this class of issue — respect that decision, skip silently
      return;
    }

    if (bestMatch.status === 'applied' || bestMatch.status === 'auto_applied') {
      // Issue recurs after a fix was applied — create a recurrence note so the user can see the fix didn't hold
      const embeddingJson = momentEmbedding.length > 0 ? JSON.stringify(momentEmbedding) : null;
      await pool.query(
        `INSERT INTO prompt_suggestions
           (org_id, category, issue_summary, suggested_addition, occurrence_count, status, all_examples, embedding)
         VALUES ($1,$2,$3,$4,1,'pending',$5,$6)`,
        [orgId, moment.category,
         `[Recurrence] ${moment.issue}`,
         moment.prompt_fix,
         JSON.stringify([moment]),
         embeddingJson],
      );
      return;
    }

    // Pending match — atomically increment occurrence count (prevents race condition)
    const updated = await pool.query(
      `UPDATE prompt_suggestions
       SET occurrence_count = occurrence_count + 1,
           all_examples = all_examples::jsonb || $1::jsonb
       WHERE id = $2
       RETURNING occurrence_count`,
      [JSON.stringify([moment]), bestMatch.id],
    );
    const newCount = (updated.rows[0]?.occurrence_count as number) ?? bestMatch.occurrence_count + 1;
    const examples: BadMoment[] = [...bestMatch.all_examples, moment];

    // Auto-apply only if: threshold reached AND cooldown passed AND no other fix applied this cycle
    // Auto-apply disabled by product decision (2026-04-23): every suggestion
    // must be approved by the customer — the agent shouldn't be silently
    // edited, and the customer should get a chance to fill in domain-
    // specific info (parking, prices, handoff rules) in their own words
    // before anything lands in the prompt. The pending row stays; the
    // Behavior-tab banner handles approval with editable text.
    //
    // Left the threshold + A/B-test machinery in place in case we re-enable
    // a supervised variant later; just don't fire either branch.
    void autoApplyThreshold; void cooldownOk; void currentAvgScore; void ctx;
    void generateOptimizedFix; void AB_TEST_SCORE_THRESHOLD; void isAbTestRunning;
    void startAbTest; void currentPrompt; void setPrompt; void applyPromptAddition;
    void examples;
  } else {
    // New distinct issue — store with embedding
    const embeddingJson = momentEmbedding.length > 0 ? JSON.stringify(momentEmbedding) : null;
    await pool.query(
      `INSERT INTO prompt_suggestions
         (org_id, category, issue_summary, suggested_addition, occurrence_count, status, all_examples, embedding)
       VALUES ($1,$2,$3,$4,1,'pending',$5,$6)`,
      [orgId, moment.category, moment.issue, moment.prompt_fix, JSON.stringify([moment]), embeddingJson],
    );
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function registerInsights(app: FastifyInstance): Promise<void> {
  app.get('/insights', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });
    const orgId = (req.user as { orgId: string }).orgId;

    const [analysesRes, suggestionsRes, versionsRes, abTestsRes] = await Promise.all([
      pool.query(
        `SELECT call_id, score, bad_moments, overall_feedback, created_at
         FROM call_analyses WHERE org_id=$1 ORDER BY created_at DESC LIMIT 30`,
        [orgId],
      ),
      pool.query(
        `SELECT id, category, issue_summary, suggested_addition, occurrence_count,
                status, applied_at, effectiveness, created_at
         FROM prompt_suggestions WHERE org_id=$1 ORDER BY occurrence_count DESC, created_at DESC`,
        [orgId],
      ),
      pool.query(
        `SELECT id, reason, avg_score, call_count, created_at, LEFT(prompt,200) AS prompt_preview
         FROM prompt_versions WHERE org_id=$1 AND reason NOT LIKE '%checkpoint%'
         ORDER BY created_at DESC LIMIT 10`,
        [orgId],
      ),
      pool.query(
        `SELECT id, status, decision_reason, control_avg_score, calls_target,
                variant_calls, variant_scores, created_at, completed_at
         FROM ab_tests WHERE org_id=$1 ORDER BY created_at DESC LIMIT 10`,
        [orgId],
      ),
    ]);

    const scores = (analysesRes.rows as { score: number }[]).map(r => r.score);
    const avgScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null;

    // Linear regression trend (least-squares slope) — more robust than 5-vs-5 average split
    const trend = (() => {
      if (scores.length < 4) return null;
      // scores are newest-first → reverse for chronological order
      const xs = scores.slice().reverse();
      const n = xs.length;
      const meanX = (n - 1) / 2;
      const meanY = xs.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - meanX) * ((xs[i] ?? 0) - meanY);
        den += (i - meanX) ** 2;
      }
      const slope = den === 0 ? 0 : num / den; // score change per call
      const delta = Math.round(slope * n * 10) / 10; // total change over window
      const direction = slope > 0.05 ? 'up' : slope < -0.05 ? 'down' : 'stable';
      return { direction: direction as 'up' | 'down' | 'stable', delta };
    })();

    const dynamicThreshold = await getDynamicThreshold(orgId);

    // Enrich A/B test rows with computed variant avg
    const abTests = (abTestsRes.rows as {
      id: string; status: string; decision_reason: string | null;
      control_avg_score: number | null; calls_target: number;
      variant_calls: number; variant_scores: number[];
      created_at: string; completed_at: string | null;
    }[]).map(t => ({
      ...t,
      variant_avg_score: Array.isArray(t.variant_scores) && t.variant_scores.length > 0
        ? Math.round((t.variant_scores.reduce((a, b) => a + b, 0) / t.variant_scores.length) * 10) / 10
        : null,
    }));

    return {
      avg_score: avgScore,
      trend,
      auto_apply_threshold: dynamicThreshold,
      similarity_threshold: SIMILARITY_THRESHOLD,
      total_analyses: scores.length,
      analyses: analysesRes.rows,
      suggestions: suggestionsRes.rows,
      prompt_versions: versionsRes.rows,
      ab_tests: abTests,
    };
  });

  app.post('/insights/suggestions/:id/apply', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });
    const orgId = (req.user as { orgId: string }).orgId;
    const { id } = req.params as { id: string };
    // Optional customText — customer may edit the suggested addition in-place
    // before hitting Übernehmen (e.g. fill in actual parking info Chipy
    // couldn't know). Falls back to the stored suggestion when omitted.
    const body = (req.body ?? {}) as { customText?: unknown };
    let textToApply: string | null = null;
    if (typeof body.customText === 'string') {
      const t = body.customText.trim();
      if (t.length > 0 && t.length <= 4000) textToApply = t;
    }
    const res = await pool.query(
      `SELECT suggested_addition FROM prompt_suggestions WHERE id=$1 AND org_id=$2 AND status='pending'`,
      [id, orgId],
    );
    if (res.rows.length === 0) return reply.status(404).send({ error: 'Not found' });
    const finalText = textToApply ?? (res.rows[0].suggested_addition as string);
    await applyPromptAddition(orgId, finalText);
    // Persist the text that actually landed in the prompt (not the original
    // autogenerated suggestion) so the audit log reflects reality.
    await pool.query(
      `UPDATE prompt_suggestions SET status='applied', applied_at=now(), suggested_addition=$2 WHERE id=$1`,
      [id, finalText],
    );
    return { ok: true };
  });

  app.post('/insights/suggestions/:id/reject', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });
    const orgId = (req.user as { orgId: string }).orgId;
    const { id } = req.params as { id: string };
    await pool.query(`UPDATE prompt_suggestions SET status='rejected' WHERE id=$1 AND org_id=$2`, [id, orgId]);
    return { ok: true };
  });

  app.post('/insights/versions/:id/restore', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });
    const orgId = (req.user as { orgId: string }).orgId;
    const { id } = req.params as { id: string };
    const res = await pool.query(`SELECT prompt FROM prompt_versions WHERE id=$1 AND org_id=$2`, [id, orgId]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'Not found' });
    await setPrompt(orgId, res.rows[0].prompt as string, 'manual_restore');
    return { ok: true };
  });

  app.post('/insights/consolidate', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!pool) return reply.status(503).send({ error: 'Database not configured' });
    const orgId = (req.user as { orgId: string }).orgId;
    consolidatePrompt(orgId).catch(logBg('consolidatePrompt-manual', { orgId }));
    return { ok: true };
  });
}
