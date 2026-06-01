import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = join(__dirname, '..');

function readSource(relativePath: string): string {
  return readFileSync(join(srcRoot, relativePath), 'utf8');
}

describe('knowledge.search TrustedScope boundaries', () => {
  it('keeps runtime knowledgeSearch entrypoints behind TrustedScope creation or validation', () => {
    const agentTools = readSource('agent-tools.ts');
    const agentRuntime = readSource('agent-runtime.ts');
    const retellWebhooks = readSource('retell-webhooks.ts');
    const traces = readSource('traces.ts');
    const agentConfig = readSource('agent-config.ts');
    const ownKb = readSource('own-kb.ts');
    const ownKbShadow = readSource('own-kb-shadow.ts');
    const ownKbEval = readSource('own-kb-eval.ts');

    const knowledgeSearchInputStart = ownKb.indexOf('export type KnowledgeSearchInput = {');
    const knowledgeSearchInputEnd = ownKb.indexOf('export type KnowledgeSearchSnippet = {');
    const knowledgeSearchInputSource = ownKb.slice(knowledgeSearchInputStart, knowledgeSearchInputEnd);
    expect(knowledgeSearchInputSource).toContain('trustedScope: TrustedScope;');
    expect(knowledgeSearchInputSource).not.toContain('orgId: string;');
    expect(knowledgeSearchInputSource).not.toContain('tenantId: string;');
    expect(ownKb).toContain('if (!isTrustedScope(input.trustedScope))');
    expect(ownKb).toContain("reason: 'TRUSTED_SCOPE_REQUIRED'");
    expect(ownKbShadow).toContain('trustedScope: createTrustedScope({');
    expect(ownKbEval).toContain('trustedScope: createTrustedScope({');

    expect(agentTools).toContain('const trustedScope = isTrustedScope(input.trustedScope)');
    expect(agentTools.indexOf('const trustedScope = isTrustedScope(input.trustedScope)'))
      .toBeLessThan(agentTools.indexOf('const result = await knowledgeSearch({'));
    expect(agentTools).toContain("error: 'TRUSTED_SCOPE_REQUIRED'");
    expect(agentTools).toContain("const policyArgs = normalizedToolName === 'knowledge.search' ? stripScopeLikeToolArgs(rawArgs) : rawArgs;");
    expect(agentTools).toContain('args: policyArgs');

    expect(agentRuntime).toContain('function serverAgentScopeId(');
    expect(agentRuntime).toContain('web_chat:${configTenantId || orgId}');
    expect(agentRuntime).not.toContain('agentId: cfg.retellAgentId ?? cfg.tenantId ?? input.tenantId');
    expect(agentRuntime).toContain('safeTraceInput(toolArgs, { omitFields: knowledgeSearchTrustedScopeArgFields })');
    expect(agentRuntime).toContain('traceScopeFields(trustedScope');

    expect(retellWebhooks).toContain('const trustedScope = createTrustedScope({');
    expect(retellWebhooks.indexOf('const trustedScope = createTrustedScope({'))
      .toBeLessThan(retellWebhooks.indexOf('const result = await knowledgeSearch({'));
    expect(retellWebhooks).toContain("resolvedFrom: 'call_registry'");
    expect(retellWebhooks).toContain("event: 'untrusted_scope_arg_seen'");
    expect(retellWebhooks).toContain('safeTraceInput(args, { omitFields: knowledgeSearchTrustedScopeArgFields })');
    expect(retellWebhooks).toContain('traceScopeFields(trustedScope');
    expect(retellWebhooks).toContain('function retellTraceFields(');
    expect(retellWebhooks).toContain('tenantScopeId: ctx.tenantId ?? undefined');

    expect(traces).toContain('tenantScopeId: z.string().optional()');
    expect(traces).toContain('export function traceScopeFields(');
    expect(traces).toContain('tenantId: trustedScope.orgId');
    expect(traces).toContain('orgId: trustedScope.orgId');
    expect(traces).toContain('tenantScopeId: trustedScope.tenantId');

    const knowledgeSearchToolStart = agentConfig.indexOf("name: 'knowledge_search'");
    const knowledgeSearchToolEnd = agentConfig.indexOf("name: 'customer_lookup'");
    const knowledgeSearchToolSource = agentConfig.slice(knowledgeSearchToolStart, knowledgeSearchToolEnd);
    expect(knowledgeSearchToolSource).toContain('additionalProperties: false');
    for (const field of ['orgId', 'tenantId', 'agentId', 'callId', 'sessionId', 'source', 'resolvedFrom', 'customerId', 'customerIdentity', 'authorization', 'authContext']) {
      expect(knowledgeSearchToolSource).not.toContain(`${field}:`);
    }
  });
});
