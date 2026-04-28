/**
 * Outbound Sales Learning System
 *
 * Analyzes each sales call transcript and scores it across 5 conversion dimensions:
 *   1. Rapport (did the prospect stay engaged?)
 *   2. Pain identified (did we find a real problem?)
 *   3. Value delivered (was the value proposition clear and relevant?)
 *   4. Objections handled (were objections addressed well?)
 *   5. Next step secured (concrete follow-up agreed?)
 *
 * After every 5 analyzed calls, consolidates patterns and generates
 * prompt improvement suggestions with estimated conversion lift.
 *
 * Auto-applies suggestions when avg score drops or pattern is strong enough.
 */

import OpenAI from 'openai';
import { pool } from './db.js';
import { log } from './logger.js';
import { BASE_OUTBOUND_PROMPT } from './outbound-agent.js';
import { updateLLM } from './retell.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' });

const ANALYSIS_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const MIN_CALLS_FOR_LEARNING = 5;      // Analyze patterns after N calls
const AUTO_APPLY_CONV_SCORE = 5.5;     // Auto-apply suggestions if avg score below this
const MIN_OCCURRENCE_TO_APPLY = 3;     // Pattern must appear in 3+ calls to auto-apply

// ── Call Analysis ─────────────────────────────────────────────────────────────

interface ConvScoreBreakdown {
  rapport: number;
  pain_identified: number;
  value_delivered: number;
  objections_handled: number;
  next_step_secured: number;
  overall: number;
  weak_points: string[];
  strong_points: string[];
  specific_improvements: string[];
}

export async function analyzeOutboundCall(
  orgId: string,
  callId: string,
  transcript: string,
  durationSeconds?: number,
): Promise<void> {
  if (!pool || !transcript || transcript.length < 100) return;

  // Don't re-analyze
  const existing = await pool.query(
    `SELECT id FROM outbound_calls WHERE call_id = $1 AND conv_score IS NOT NULL`,
    [callId],
  );
  if (existing.rowCount && existing.rowCount > 0) return;

  try {
    const raw = await openai.chat.completions.create({
      model: ANALYSIS_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Du bist ein Vertriebscoach der Verkaufsgespräche analysiert.
Analysiere das Transkript eines Outbound-Verkaufsgesprächs und bewerte es.

Gib JSON zurück:
{
  "rapport": <1-10>,
  "pain_identified": <1-10>,
  "value_delivered": <1-10>,
  "objections_handled": <1-10>,
  "next_step_secured": <1-10>,
  "overall": <1-10 Gesamtscore>,
  "outcome_detected": "<converted|interested|callback|not_interested|no_answer|voicemail>",
  "weak_points": ["<konkreter Schwachpunkt>", ...],
  "strong_points": ["<was gut funktioniert hat>", ...],
  "specific_improvements": ["<konkrete Formulierungsverbesserung>", ...]
}

Bewertungskriterien:
- rapport: Hat der Interessent das Gespräch fortgesetzt? Gab es echten Dialog?
- pain_identified: Wurde ein konkretes Problem/Bedürfnis herausgearbeitet?
- value_delivered: War der Nutzen klar, relevant und konkret (mit Zahlen)?
- objections_handled: Wurden Einwände ruhig, präzise und überzeugend behandelt?
- next_step_secured: Gibt es eine konkrete Vereinbarung für den nächsten Schritt?`,
        },
        {
          role: 'user',
          content: `Transkript:\n${transcript.slice(0, 6000)}`,
        },
      ],
    });

    const text = (raw.choices[0]?.message?.content ?? '{}')
      .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const analysis = JSON.parse(text) as ConvScoreBreakdown & { outcome_detected?: string };

    const fallback = (
      (Number(analysis.rapport) + Number(analysis.pain_identified) + Number(analysis.value_delivered) +
       Number(analysis.objections_handled) + Number(analysis.next_step_secured)) / 5
    );
    const score = Number(analysis.overall) || (Number.isFinite(fallback) ? fallback : 5);

    await pool.query(
      `UPDATE outbound_calls
       SET conv_score = $1, score_breakdown = $2, outcome = COALESCE(outcome, $3),
           duration_s = COALESCE(duration_s, $4), status = 'analyzed'
       WHERE call_id = $5 AND org_id = $6`,
      [
        score.toFixed(2),
        JSON.stringify(analysis),
        analysis.outcome_detected ?? null,
        durationSeconds ?? null,
        callId,
        orgId,
      ],
    );

    // Process improvement suggestions from this call
    for (const improvement of (analysis.specific_improvements ?? [])) {
      await upsertSuggestion(orgId, 'formulation', improvement, score);
    }
    for (const weak of (analysis.weak_points ?? [])) {
      await upsertSuggestion(orgId, 'weakness', weak, score);
    }

    // Store outbound transcript enriched with analysis results (fire-and-forget)
    // Audit-Round-7 Codex LOW-A defense-in-depth: scope the UPDATE by org_id
    // even though call_transcripts.call_id is UNIQUE today. If a future schema
    // change relaxes that or two orgs ever observe the same call_id (shouldn't
    // happen but defensive), this prevents cross-tenant overwrite.
    pool.query(
      `UPDATE call_transcripts SET
         score = $1, conv_score = $2, outcome = $3
       WHERE call_id = $4 AND org_id = $5`,
      [
        score.toFixed(2),
        score.toFixed(2),
        analysis.outcome_detected ?? null,
        callId,
        orgId,
      ],
    ).catch((err: unknown) => {
      log.warn({ err: err instanceof Error ? err.message : String(err), orgId, callId }, 'outbound-insights: conv_score update failed');
    });

    // Trigger batch learning after enough calls
    const { rowCount } = await pool.query(
      `SELECT id FROM outbound_calls WHERE org_id = $1 AND conv_score IS NOT NULL AND status = 'analyzed'`,
      [orgId],
    );
    // Audit-Round-10 MEDIUM: guard against `0 % N === 0` triggering on a
    // cold-start org that has never had a successful analysis. Without the
    // `> 0` check the very first row (count=0) would invoke consolidate,
    // which then no-ops via its own MIN_CALLS_FOR_LEARNING-guard but still
    // burns one unnecessary DB query and OpenAI-call setup.
    if ((rowCount ?? 0) > 0 && (rowCount ?? 0) % MIN_CALLS_FOR_LEARNING === 0) {
      consolidateAndLearn(orgId).catch((e) => {
        log.warn({ err: e instanceof Error ? e.message : String(e), orgId }, 'outbound-insights: consolidate failed');
      });
    }
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e), orgId, callId }, 'outbound-insights: analyzeOutboundCall failed');
  }
}

async function upsertSuggestion(orgId: string, category: string, text: string, _callScore: number) {
  if (!pool) return;
  // Single-statement upsert — was a SELECT-then-INSERT/UPDATE which races under
  // concurrent /webhook calls (two parallel analyzeOutboundCall executions for
  // the same orgId+text would both miss the row and INSERT twice, splitting
  // the occurrence_count). Requires a partial UNIQUE index for the conflict
  // target; created once in db.ts migration. If the index doesn't exist yet
  // this falls back to the prior race-prone path on the first deploy only.
  const summary = text.slice(0, 300);
  const change = text.slice(0, 400);
  await pool.query(
    `INSERT INTO outbound_suggestions (org_id, category, issue_summary, suggested_change, occurrence_count)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (org_id, issue_summary) WHERE status = 'pending'
     DO UPDATE SET occurrence_count = outbound_suggestions.occurrence_count + 1`,
    [orgId, category, summary, change],
  );
}

// ── Batch Learning & Consolidation ───────────────────────────────────────────

async function consolidateAndLearn(orgId: string): Promise<void> {
  if (!pool) return;

  // Get recent analyzed calls
  const { rows: calls } = await pool.query(
    `SELECT transcript, conv_score, score_breakdown, outcome
     FROM outbound_calls
     WHERE org_id = $1 AND conv_score IS NOT NULL AND transcript IS NOT NULL
     ORDER BY created_at DESC LIMIT 20`,
    [orgId],
  );
  if (calls.length < MIN_CALLS_FOR_LEARNING) return;

  const avgScore = calls.reduce((s, c) => s + parseFloat(c.conv_score), 0) / calls.length;

  // Get high-performing vs low-performing transcripts
  const sorted = [...calls].sort((a, b) => parseFloat(b.conv_score) - parseFloat(a.conv_score));
  const topCalls = sorted.slice(0, Math.ceil(calls.length * 0.3)).map(c => c.transcript?.slice(0, 1000)).filter(Boolean);
  const lowCalls = sorted.slice(-Math.ceil(calls.length * 0.3)).map(c => c.transcript?.slice(0, 1000)).filter(Boolean);

  // Get current prompt
  const { prompt: currentPrompt, version } = await getOutboundPromptForOrg(orgId);

  // Get high-occurrence suggestions
  const { rows: suggestions } = await pool.query(
    `SELECT issue_summary, occurrence_count, category FROM outbound_suggestions
     WHERE org_id = $1 AND status = 'pending' AND occurrence_count >= $2
     ORDER BY occurrence_count DESC LIMIT 10`,
    [orgId, MIN_OCCURRENCE_TO_APPLY],
  );

  if (suggestions.length === 0 && avgScore >= AUTO_APPLY_CONV_SCORE) return;

  try {
    const raw = await openai.chat.completions.create({
      model: ANALYSIS_MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Du bist ein Vertriebsoptimierungs-Experte. Analysiere Gesprächsmuster und verbessere einen Verkäufer-Prompt.

Gib JSON zurück:
{
  "improvements": [
    {
      "section": "<welcher Bereich des Prompts>",
      "current_issue": "<was nicht funktioniert>",
      "new_formulation": "<exakter neuer Text/Formulierung>",
      "estimated_lift": <0.1-2.0 erwartete Score-Verbesserung>
    }
  ],
  "new_prompt_additions": "<neue Abschnitte die zum Prompt hinzugefügt werden sollen>",
  "summary": "<kurze Erklärung der wichtigsten Änderungen>"
}`,
        },
        {
          role: 'user',
          content: `Aktueller durchschnittlicher Conversion Score: ${avgScore.toFixed(2)}/10

Wiederkehrende Schwachstellen:
${suggestions.map(s => `- [${s.occurrence_count}x] ${s.issue_summary}`).join('\n')}

Beispiele erfolgreicher Gespräche (hoher Score):
${topCalls.slice(0, 2).map((t, i) => `[TOP ${i + 1}]: ${t}`).join('\n\n')}

Beispiele schwacher Gespräche (niedriger Score):
${lowCalls.slice(0, 2).map((t, i) => `[SCHWACH ${i + 1}]: ${t}`).join('\n\n')}

Aktueller Prompt (Ausschnitt):
${currentPrompt.slice(0, 2000)}

Erstelle präzise Verbesserungen. Fokus auf: konkretere Formulierungen, bessere Einwandbehandlung, stärkere Öffner.`,
        },
      ],
    });

    const text = (raw.choices[0]?.message?.content ?? '{}')
      .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const result = JSON.parse(text) as {
      improvements?: Array<{ section: string; current_issue: string; new_formulation: string; estimated_lift: number }>;
      new_prompt_additions?: string;
      summary?: string;
    };

    if (!result.improvements?.length && !result.new_prompt_additions) return;

    // Build improved prompt
    let newPrompt = currentPrompt;
    for (const imp of (result.improvements ?? [])) {
      if (imp.new_formulation && imp.new_formulation.length > 20) {
        // Update suggestion with GPT-generated lift estimate.
        // Audit-Round-7 Codex MEDIUM-6: escape LIKE meta-chars in the GPT-
        // generated current_issue so a stray `%` or `_` can't broaden the
        // ILIKE match and overwrite the wrong suggestion's conv_lift_est.
        const safeNeedle = imp.current_issue
          .slice(0, 50)
          .replace(/\\/g, '\\\\')
          .replace(/[%_]/g, '\\$&');
        await pool.query(
          `UPDATE outbound_suggestions SET conv_lift_est = $1
           WHERE org_id = $2 AND status = 'pending' AND issue_summary ILIKE $3 ESCAPE '\\'`,
          [imp.estimated_lift, orgId, `%${safeNeedle}%`],
        );
      }
    }

    if (result.new_prompt_additions) {
      newPrompt = currentPrompt + '\n\n## Gelernte Verbesserungen (Auto-Update)\n' + result.new_prompt_additions;
    }

    // Apply only if auto-apply is explicitly enabled AND the prompt actually changed
    // AND the quality threshold/new-content condition is met.
    // OUTBOUND_AUTO_APPLY=true opts in to live LLM-generated prompt rewrites. Default OFF
    // because GPT can hallucinate on PII-redacted or prompt-injected transcripts; we don't
    // want an attacker-controlled caller to indirectly rewrite the live agent's prompt.
    const autoApplyEnabled = process.env.OUTBOUND_AUTO_APPLY === 'true';
    if (autoApplyEnabled && newPrompt !== currentPrompt && (avgScore < AUTO_APPLY_CONV_SCORE || result.new_prompt_additions)) {
      const reason = result.summary ?? `Batch learning: avg score ${avgScore.toFixed(2)}, ${suggestions.length} patterns`;
      await analyzeAndImproveOutboundPrompt(orgId, newPrompt, reason, version, avgScore);

      // Mark applied suggestions as applied
      if (suggestions.length > 0) {
        const issueTexts = suggestions.map(s => s.issue_summary);
        await pool.query(
          `UPDATE outbound_suggestions SET status = 'auto_applied', applied_at = now()
           WHERE org_id = $1 AND issue_summary = ANY($2::text[])`,
          [orgId, issueTexts],
        );
      }
    }
  } catch (err) {
    // Audit-Round-7: was silent (`Non-critical`) — GPT/JSON/DB failures invisible.
    log.warn({ err: err instanceof Error ? err.message : String(err), orgId }, 'outbound-insights: consolidateAndLearn failed');
  }
}

// ── Prompt Versioning ─────────────────────────────────────────────────────────

async function getOutboundPromptForOrg(orgId: string): Promise<{ prompt: string; version: number }> {
  if (!pool) return { prompt: BASE_OUTBOUND_PROMPT, version: 1 };
  const res = await pool.query(
    `SELECT outbound_prompt, outbound_prompt_v FROM orgs WHERE id = $1`,
    [orgId],
  );
  return {
    prompt: res.rows[0]?.outbound_prompt ?? BASE_OUTBOUND_PROMPT,
    version: res.rows[0]?.outbound_prompt_v ?? 1,
  };
}

export async function analyzeAndImproveOutboundPrompt(
  orgId: string,
  newPromptOrAddition: string,
  reason: string,
  currentVersion?: number,
  avgScore?: number,
): Promise<void> {
  if (!pool) return;

  const { prompt: current, version } = await getOutboundPromptForOrg(orgId);
  const v = currentVersion ?? version;
  const nextVersion = v + 1;

  // If the input is a small addition, append it; if it's a full prompt, replace
  const newPrompt = newPromptOrAddition.length > current.length * 0.5
    ? newPromptOrAddition
    : current + '\n\n' + newPromptOrAddition;

  // Save version history
  await pool.query(
    `INSERT INTO outbound_prompt_versions (org_id, version, prompt, reason, avg_conv_score, call_count)
     VALUES ($1, $2, $3, $4, $5, (SELECT COUNT(*) FROM outbound_calls WHERE org_id = $1 AND conv_score IS NOT NULL))`,
    [orgId, nextVersion, newPrompt, reason, avgScore ?? null],
  );

  // Update org's prompt and version
  await pool.query(
    `UPDATE orgs SET outbound_prompt = $1, outbound_prompt_v = $2 WHERE id = $3`,
    [newPrompt, nextVersion, orgId],
  );

  // Push updated prompt to Retell LLM
  const orgRes = await pool.query(`SELECT outbound_llm_id FROM orgs WHERE id = $1`, [orgId]);
  const llmId = orgRes.rows[0]?.outbound_llm_id;
  if (llmId) {
    try {
      // Customer-Outbound-Agent → Outbound-Baseline (NOT inbound-platform).
      // The auto-relearn pipeline must preserve the same baseline that
      // deployToCallbackRetell/deployToOutboundRetell originally prepended.
      const { loadOutboundBaseline } = await import('./outbound-baseline.js');
      const baseline = await loadOutboundBaseline();
      await updateLLM(llmId, { generalPrompt: `${baseline}\n\n${newPrompt}` });
    } catch (err) {
      // Audit-Round-7: was silent — Retell stays on the old prompt while DB
      // claims the new one is live. Surface so Ops can see + manually re-deploy.
      log.warn({ err: err instanceof Error ? err.message : String(err), orgId, llmId }, 'outbound-insights: Retell prompt-sync failed (DB updated, Retell not)');
    }
  }
}
