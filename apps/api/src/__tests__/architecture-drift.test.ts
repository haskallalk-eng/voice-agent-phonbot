import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = join(__dirname, '..');
const repoRoot = join(srcRoot, '..', '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(srcRoot, relativePath), 'utf8');
}

function readRepoSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function sourceSlice(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const coreAndGovernanceFiles = [
  'agent-runtime.ts',
  'agent-tools.ts',
  'context-builder.ts',
  'policy-layer.ts',
  'action-contracts.ts',
  'own-kb.ts',
  'own-kb-readiness.ts',
  'own-kb-rollout.ts',
  'own-kb-source-import-contract.ts',
  'own-kb-retell-sync-contract.ts',
  'own-kb-shadow.ts',
  'own-kb-eval.ts',
  'voice-output-normalization.ts',
];

const providerAdapterFiles = readdirSync(join(srcRoot, 'provider-adapters'))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => `provider-adapters/${file}`);

const forbiddenScopeSchemaFields = [
  'orgId',
  'tenantId',
  'agentId',
  'callId',
  'customerId',
  'customerIdentity',
  'authorization',
  'authContext',
];

describe('architecture drift guardrails', () => {
  it('keeps provider adapter modules out of core, policy, context, and Own-KB governance files', () => {
    const forbiddenImport = /from\s+['"]\.\/(?:retell|retell-webhooks|twilio-openai-bridge|.*openai.*|.*realtime.*)\.js['"]/;

    for (const file of coreAndGovernanceFiles) {
      expect(readSource(file), file).not.toMatch(forbiddenImport);
    }
  });

  it('keeps Milestone 2 fixture provider adapters test-only until explicit live wiring work', () => {
    const fixtureAdapterImport = /from\s+['"](?:\.\/|\.\.\/)provider-adapters\/(?:retell-adapter|openai-realtime-adapter)\.js['"]/;

    for (const file of [
      'agent-config.ts',
      'agent-runtime.ts',
      'agent-tools.ts',
      'context-builder.ts',
      'retell-webhooks.ts',
      'retell.ts',
      'own-kb.ts',
      'own-kb-shadow.ts',
      'own-kb-eval.ts',
    ]) {
      expect(readSource(file), file).not.toMatch(fixtureAdapterImport);
    }
  });

  it('keeps provider fixture adapters thin and away from policy, tool, Own-KB, or provider SDK imports', () => {
    const forbiddenImport = /from\s+['"](?:openai|retell|@retell|retell-sdk|\.{1,2}\/(?:policy-layer|action-contracts|agent-tools|agent-runtime|own-kb|own-kb-shadow|own-kb-eval)\.js)['"]/;

    for (const file of providerAdapterFiles) {
      const source = readSource(file);
      expect(source, file).not.toMatch(forbiddenImport);
      expect(source, file).toContain("from '../voice-runtime-contract.js'");
      expect(source, file).toContain("from '../trusted-scope.js'");
    }
  });

  it('keeps raw provider runtime event names out of core and context files', () => {
    const rawProviderEvent = /\b(response_required|reminder_required|update_only|response\.output_audio|response\.output_text|input_audio_buffer|conversation\.item|transcript_with_tool_calls)\b/;

    for (const file of ['agent-runtime.ts', 'agent-tools.ts', 'context-builder.ts', 'own-kb.ts']) {
      expect(readSource(file), file).not.toMatch(rawProviderEvent);
    }
  });

  it('keeps trusted scope fields out of OpenAI/Web knowledge.search schema', () => {
    const agentTools = readSource('agent-tools.ts');
    const knowledgeSearchSchema = sourceSlice(
      agentTools,
      "name: sanitizeToolName('knowledge.search')",
      "if (enabled.has('calendar.findSlots'))",
    );

    expect(knowledgeSearchSchema).toContain('additionalProperties: false');
    for (const field of forbiddenScopeSchemaFields) {
      expect(knowledgeSearchSchema).not.toContain(`${field}:`);
    }
  });

  it('keeps trusted scope fields out of Retell knowledge_search schema', () => {
    const agentConfig = readSource('agent-config.ts');
    const knowledgeSearchSchema = sourceSlice(
      agentConfig,
      "name: 'knowledge_search'",
      "if (customerModuleActiveForAgentConfig(config))",
    );

    expect(knowledgeSearchSchema).toContain('additionalProperties: false');
    for (const field of forbiddenScopeSchemaFields) {
      expect(knowledgeSearchSchema).not.toContain(`${field}:`);
    }
  });

  it('preserves knowledge.search fail-closed TrustedScope and read-only semantics', () => {
    const agentTools = readSource('agent-tools.ts');
    const retellWebhooks = readSource('retell-webhooks.ts');
    const ownKb = readSource('own-kb.ts');

    expect(agentTools).toContain('const trustedScope = isTrustedScope(input.trustedScope)');
    expect(agentTools).toContain("error: 'TRUSTED_SCOPE_REQUIRED'");
    expect(agentTools).toContain('policy: { ...result.policy, mayMutate: false }');
    expect(agentTools).toContain("const policyArgs = normalizedToolName === 'knowledge.search' ? stripScopeLikeToolArgs(rawArgs) : rawArgs;");

    expect(ownKb).toContain('if (!isTrustedScope(input.trustedScope))');
    expect(ownKb).toContain("reason: 'TRUSTED_SCOPE_REQUIRED'");

    expect(retellWebhooks).toContain('const trustedScope = createTrustedScope({');
    expect(retellWebhooks).toContain("event: 'untrusted_scope_arg_seen'");
    expect(retellWebhooks).toContain('policy: { ...result.policy, mayMutate: false }');
  });

  it('does not place full provider transcripts into core context snapshots', () => {
    const fullTranscriptPattern = /\b(fullTranscript|full_transcript|live_transcript|transcript_with_tool_calls|response_required_transcript)\b/;

    for (const file of ['agent-runtime.ts', 'context-builder.ts', 'own-kb.ts', 'own-kb-benchmark.ts']) {
      expect(readSource(file), file).not.toMatch(fullTranscriptPattern);
    }
  });

  it('keeps the approved 0.5B promotion evidence override inside the artifact validator path', () => {
    const artifactWrapper = readSource('own-kb-benchmark-artifact.ts');
    expect(artifactWrapper).toContain('approvedPromotionArtifact: true');

    for (const file of [
      'agent-config.ts',
      'agent-runtime.ts',
      'agent-tools.ts',
      'own-kb.ts',
      'own-kb-benchmark.ts',
      'own-kb-rollout.ts',
      'own-kb-shadow.ts',
      'own-kb-eval.ts',
    ]) {
      expect(readSource(file), file).not.toContain('approvedPromotionArtifact: true');
    }
  });

  it('keeps Own-KB source import readiness additive, DB-free, and non-promotional', () => {
    const sourceImportContract = readSource('own-kb-source-import-contract.ts');
    expect(sourceImportContract).toContain("from './trusted-scope.js'");
    expect(sourceImportContract).toContain('promotionEvidenceUsable: false');
    expect(sourceImportContract).toContain('SOURCE_IMPORT_SYNTHETIC_MARKER_PRESENT');
    expect(sourceImportContract).toContain('SOURCE_IMPORT_DRAFT_MARKER_PRESENT');
    expect(sourceImportContract).toContain('SOURCE_IMPORT_PROMOTION_EVIDENCE_MARKER_PRESENT');
  });

  it('keeps Own-KB source import plans sanitized, readiness-gated, and non-promotional', () => {
    const sourceImportPlan = readSource('own-kb-source-import-plan.ts');
    expect(sourceImportPlan).toContain('buildOwnKbSourceImportReadiness');
    expect(sourceImportPlan).toContain('isTrustedScope');
    expect(sourceImportPlan).toContain('promotionEvidenceUsable: false');
    expect(sourceImportPlan).toContain('sourceIdHash');
    expect(sourceImportPlan).not.toContain('sourceId: compact(source.id)');
    expect(sourceImportPlan).not.toContain('name: source.name');
    expect(sourceImportPlan).not.toContain('content: source.content');
  });

  it('keeps source-authoring, fact-intake, and source-import surfaces away from DB writes and promotion shortcuts', () => {
    const sourceJsonPreparationFiles = [
      'own-kb-authoring.ts',
      'own-kb-simulation-enrichment.ts',
      'own-kb-source-import-contract.ts',
      'own-kb-source-import-plan.ts',
      'scripts/validate-own-kb-authoring.ts',
      'scripts/validate-own-kb-fact-intake.ts',
      'scripts/report-own-kb-source-import-readiness.ts',
    ];
    const forbiddenDbOrIngestionPatterns: RegExp[] = [
      /from\s+['"](?:pg|@supabase\/supabase-js|\.{1,2}\/(?:db|own-kb|own-kb-readiness|own-kb-rollout|own-kb-benchmark|own-kb-benchmark-artifact)\.js)['"]/,
      /\b(?:pool|client|db)\.query\b/,
      /\b(?:insert\s+into|update|delete\s+from)\s+kb_/i,
      /\bsql\s*`[^`]*(?:insert\s+into|update|delete\s+from)\s+kb_/i,
      /\.from\(\s*['"]kb_/,
      /\.from\(\s*['"]kb_[^'"()]+['"]\s*\)[\s\S]{0,160}\.(?:insert|upsert|update|delete)\s*\(/,
      /\b(?:execute|run|query)\s*\(\s*(?:['"`][^'"`]*(?:insert\s+into|update|delete\s+from)\s+kb_)/i,
      /\b(?:backfillOwnKnowledgeBaseFromAgentConfig|writePreparedOwnKbItem|recordIngestionJob)\b/,
    ];
    const forbiddenPromotionPatterns: RegExp[] = [
      /approvedPromotionArtifact:\s*true/,
      /promotionEvidenceUsable:\s*true/,
      /approvedForMilestone:\s*['"]0\.5B['"]/,
    ];

    for (const file of sourceJsonPreparationFiles) {
      const source = readSource(file);
      for (const pattern of forbiddenDbOrIngestionPatterns) {
        expect(source, `${file} should not contain DB write pattern ${pattern}`).not.toMatch(pattern);
      }
      for (const pattern of forbiddenPromotionPatterns) {
        expect(source, `${file} should not contain promotion shortcut ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('keeps provider-specific voice-core code isolated to explicit provider reference sections', () => {
    const voiceCore = readRepoSource('packages/voice-core/src/index.ts');
    const providerMarker = '// OpenAI Realtime provider (Node.js). Optional: use when OPENAI_API_KEY is set.';
    const markerIndex = voiceCore.indexOf(providerMarker);
    expect(markerIndex).toBeGreaterThanOrEqual(0);

    const genericVoiceCore = voiceCore.slice(0, markerIndex);
    const providerReference = voiceCore.slice(markerIndex);

    expect(genericVoiceCore).not.toMatch(/\b(response\.audio\.delta|conversation\.item|input_audio_buffer|OpenAI-Beta|realtime=v1)\b/);
    expect(providerReference).toMatch(/\bOpenAIRealtimeProvider\b/);
    expect(providerReference).toMatch(/\binput_audio_buffer\b/);
  });
});
