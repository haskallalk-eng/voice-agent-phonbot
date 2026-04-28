/**
 * Cross-Org Template Learning Pipeline
 *
 * After every call analysis, extracts learnings that could benefit ALL orgs
 * in the same industry. When ≥3 different orgs encounter the same category of
 * issue, a template_learnings entry is created.
 *
 * High-scoring calls (≥9) have their successful patterns extracted and stored
 * in conversation_patterns for reuse across templates.
 */

import OpenAI from 'openai';
import { pool } from './db.js';
import { redactPII } from './pii.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' });
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

// Minimum number of distinct orgs reporting the same issue category before
// a template_learning entry is created.
const MIN_ORG_CONSENSUS = 3;

// Minimum score to trigger pattern extraction.
const HIGH_SCORE_THRESHOLD = 9;

interface BadMoment {
  quote?: string;
  issue?: string;
  category: string;
  prompt_fix?: string;
}

interface AnalysisResult {
  score: number;
  bad_moments: BadMoment[];
  overall_feedback?: string;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Fire-and-forget: called from analyzeCall() after analysis is stored.
 * Errors are swallowed — never blocks webhooks.
 */
export async function processTemplateLearning(
  orgId: string,
  callId: string,
  analysis: AnalysisResult,
): Promise<void> {
  if (!pool) return;
  if (!process.env.OPENAI_API_KEY) return;

  // GDPR opt-in gate. Cross-org learning takes one tenant's call data and
  // turns it into shared patterns or aggregated learnings consumed by other
  // tenants. Without explicit consent (orgs.share_patterns), do nothing.
  try {
    const consentRes = await pool.query(
      `SELECT share_patterns FROM orgs WHERE id = $1 LIMIT 1`,
      [orgId],
    );
    if (!consentRes.rows[0]?.share_patterns) return;
  } catch {
    return; // fail closed — never extract without verified consent
  }

  try {
    // Run both paths concurrently
    await Promise.allSettled([
      extractCrossOrgLearnings(orgId, callId, analysis),
      analysis.score >= HIGH_SCORE_THRESHOLD
        ? extractConversationPattern(orgId, callId, analysis)
        : Promise.resolve(),
    ]);
  } catch {
    // Non-critical — silent
  }
}

// ── Cross-org issue aggregation ───────────────────────────────────────────────

async function extractCrossOrgLearnings(
  orgId: string,
  _callId: string,
  analysis: AnalysisResult,
): Promise<void> {
  if (!pool) return;
  if (!analysis.bad_moments?.length) return;

  // Get the org's industry from agent_configs.
  //
  // Round-12 (Pattern-Pool fix): industry is now a first-class schema field
  // that the OnboardingWizard sets to the source-template id. Pre-fix, every
  // agent_config had `industry` null because the field never existed in the
  // schema, so this early-return killed cross-org-learning for ALL orgs.
  //
  // Round-12 Codex code-review caught: an earlier draft had a
  // `data->>'templateId'` whitelist-fallback for legacy configs — but
  // templateId is NEVER persisted into agent_configs.data anywhere in the
  // write-path (verified across the repo). The fallback was dead code.
  // Removed. Legacy orgs without industry stay unclustered until their
  // owner explicitly picks a template (re-runs onboarding) or a backfill
  // script tags them. Whichever comes first.
  const configRes = await pool.query(
    `SELECT data->>'industry' AS industry
     FROM agent_configs WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [orgId],
  );
  const industry: string | null = configRes.rows[0]?.industry ?? null;
  // templateId reserved for legacy compatibility with existing
  // checkAndCreateTemplateLearning() signature; pass null until/if the field
  // gets persisted in a future round.
  const templateId: string | null = null;

  if (!industry) return; // Can't do cross-org learning without industry tag

  // Find all unique categories in this call's bad moments
  const categories = [...new Set(analysis.bad_moments.map((m) => m.category).filter(Boolean))];
  if (!categories.length) return;

  // Find peer orgs in the same industry
  const peerRes = await pool.query(
    `SELECT DISTINCT org_id FROM call_transcripts
     WHERE industry = $1 AND org_id != $2`,
    [industry, orgId],
  );
  const peerOrgIds: string[] = peerRes.rows.map((r: { org_id: string }) => r.org_id);

  if (peerOrgIds.length < MIN_ORG_CONSENSUS - 1) return; // Not enough peers yet

  for (const category of categories) {
    await checkAndCreateTemplateLearning(orgId, category, industry, templateId, peerOrgIds, analysis);
  }
}

async function checkAndCreateTemplateLearning(
  currentOrgId: string,
  category: string,
  industry: string,
  templateId: string | null,
  peerOrgIds: string[],
  analysis: AnalysisResult,
): Promise<void> {
  if (!pool) return;

  // Check how many DISTINCT orgs (including current) have this category in their bad_moments
  const peerCheckRes = await pool.query(
    `SELECT COUNT(DISTINCT org_id) AS cnt
     FROM call_analyses
     WHERE org_id = ANY($1::uuid[])
       AND bad_moments @> $2`,
    [peerOrgIds, JSON.stringify([{ category }])],
  );
  const peerCount = Number(peerCheckRes.rows[0]?.cnt ?? 0);

  // Include current org in total
  const totalOrgsWithIssue = peerCount + 1;
  if (totalOrgsWithIssue < MIN_ORG_CONSENSUS) return;

  // Check if we already have a recent learning for this template+category combo
  const existing = await pool.query(
    `SELECT id FROM template_learnings
     WHERE template_id = $1
       AND content ILIKE $2
       AND created_at > now() - interval '30 days'
     LIMIT 1`,
    [templateId ?? industry, `%${category}%`],
  );
  if (existing.rows.length > 0) return; // Already captured

  // Collect prompt_fix suggestions from this call for the category.
  // prompt_fix is GPT-generated but can echo customer quotes/names from
  // bad_moments. Redact before persisting to a cross-org table — other orgs
  // in the same industry read these entries. Belt: redact+sanitize to remove
  // organisation-identifying phrasing too (company names, specific dates).
  const fixes = analysis.bad_moments
    .filter((m) => m.category === category && m.prompt_fix)
    .map((m) => redactPII(m.prompt_fix ?? ''))
    .filter(Boolean);

  const content = fixes.length > 0
    ? `[${category}] ${fixes[0]}`
    : `[${category}] Recurring issue across multiple organisations in ${industry} industry`;

  await pool.query(
    `INSERT INTO template_learnings
       (template_id, learning_type, content, source_count, confidence, status)
     VALUES ($1, 'prompt_rule', $2, $3, $4, 'pending')`,
    [
      templateId ?? industry,
      content.slice(0, 1000),
      totalOrgsWithIssue,
      Math.min(1.0, totalOrgsWithIssue / 10).toFixed(2),
    ],
  );
}

// ── Pattern extraction from high-score calls ─────────────────────────────────

async function extractConversationPattern(
  orgId: string,
  callId: string,
  _analysis: AnalysisResult,
): Promise<void> {
  if (!pool) return;

  // Get the transcript text + industry. Round-12 cleanup (Codex code-review):
  // earlier draft did a LEFT JOIN to agent_configs to fall back through
  // cfg_industry / cfg_templateId, but (a) the LEFT JOIN was ambiguous for
  // multi-agent orgs (Pro/Agency: matches arbitrary agent), (b) cfg_templateId
  // is dead code (never persisted), (c) call_transcripts.industry is itself
  // populated from agent_configs.industry by analyzeCall (insights.ts:1098),
  // so the cfg_industry fallback was redundant — when an org had industry
  // set on its config, every transcript already inherited it. Reverting to
  // the simple read.
  const transcriptRes = await pool.query(
    `SELECT transcript, industry
     FROM call_transcripts
     WHERE call_id = $1 AND org_id = $2
     LIMIT 1`,
    [callId, orgId],
  );
  if (!transcriptRes.rows.length) return;

  const transcript: string = transcriptRes.rows[0]?.transcript ?? '';
  const industry: string | null = transcriptRes.rows[0]?.industry ?? null;

  if (!transcript || transcript.length < 100) return;

  // Cross-org pattern extraction leaves the originating org. Strip caller PII
  // (name, phone, email, address, IBAN, DOB) BEFORE sending to OpenAI so the
  // resulting pattern stored in conversation_patterns can't expose one tenant's
  // customer data to another tenant via reused prompt fragments.
  const safeTranscript = redactPII(transcript).slice(0, 4000);

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Du analysierst erfolgreiche Telefongespräche. Extrahiere das wiederverwendbare Muster. Antworte ausschließlich mit JSON.',
        },
        {
          role: 'user',
          content: `Transkript eines sehr erfolgreichen Gesprächs (Score ≥9):
${safeTranscript}

Extrahiere das wiederverwendbare Gesprächsmuster als JSON:
{
  "pattern_type": "<opener|objection_handle|close|booking|escalation|rapport|other>",
  "situation": "<wann passt dieses Muster, 1-2 Sätze>",
  "agent_response": "<was der Agent sagt, direkt zitierbar, max 300 Zeichen>"
}`,
        },
      ],
    });

    const raw = (resp.choices[0]?.message?.content ?? '{}')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    const pattern = JSON.parse(raw) as {
      pattern_type?: string;
      situation?: string;
      agent_response?: string;
    };

    if (!pattern.situation || !pattern.agent_response) return;

    // Belt-and-suspenders: even though the input was redacted, OpenAI sometimes
    // hallucinates plausible-looking PII (fake phone numbers, names). Re-redact
    // the output before persisting to a cross-org table.
    const safeSituation = redactPII(pattern.situation).slice(0, 500);
    const safeResponse = redactPII(pattern.agent_response).slice(0, 500);

    await pool.query(
      `INSERT INTO conversation_patterns
         (direction, industry, pattern_type, situation, agent_response, effectiveness, source_calls)
       VALUES ('inbound', $1, $2, $3, $4, $5, 1)`,
      [
        industry,
        (pattern.pattern_type ?? 'other').slice(0, 50),
        safeSituation,
        safeResponse,
        _analysis.score,
      ],
    );
  } catch {
    // Non-critical — swallow OpenAI errors
  }
}
