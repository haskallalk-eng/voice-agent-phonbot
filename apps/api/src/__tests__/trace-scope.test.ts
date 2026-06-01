import { describe, expect, it } from 'vitest';
import { appendTraceEvent, getTraceEvents, traceScopeFields, TraceEventSchema } from '../traces.js';
import { createTrustedScope } from '../trusted-scope.js';

describe('trace scope correctness', () => {
  it('maps TrustedScope into explicit org, tenant, agent, call, provider, and provenance fields', () => {
    const scope = createTrustedScope({
      orgId: 'org-1',
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      callId: 'call-1',
      source: 'server',
      resolvedFrom: 'call_registry',
    });

    const fields = traceScopeFields(scope, {
      provider: 'retell',
      turnId: 'turn-1',
      retrievalEventId: 'retrieval-1',
    });

    expect(fields).toEqual({
      tenantId: 'org-1',
      orgId: 'org-1',
      tenantScopeId: 'tenant-1',
      agentId: 'agent-1',
      callId: 'call-1',
      provider: 'retell',
      turnId: 'turn-1',
      retrievalEventId: 'retrieval-1',
      scopeSource: 'server',
      scopeResolvedFrom: 'call_registry',
    });
    expect(TraceEventSchema.parse({
      type: 'tool_result',
      sessionId: 'call-1',
      at: 1,
      ...fields,
    })).toMatchObject({
      orgId: 'org-1',
      tenantScopeId: 'tenant-1',
      retrievalEventId: 'retrieval-1',
    });
  });

  it('keeps trace session reads fail-closed across orgs even when tenant ids overlap', async () => {
    const sessionId = `trace-scope-${Date.now()}-${Math.random()}`;
    const scope = createTrustedScope({
      orgId: 'org-a',
      tenantId: 'shared-tenant-id',
      agentId: 'agent-a',
      callId: sessionId,
      source: 'server',
      resolvedFrom: 'call_registry',
    });

    await appendTraceEvent({
      type: 'tool_call',
      sessionId,
      ...traceScopeFields(scope, { provider: 'retell' }),
      at: 1,
    });

    const ownerEvents = await getTraceEvents(sessionId, 'org-a', 10);
    const otherOrgEvents = await getTraceEvents(sessionId, 'org-b', 10);

    expect(ownerEvents).toHaveLength(1);
    expect(ownerEvents[0]).toMatchObject({
      tenantId: 'org-a',
      orgId: 'org-a',
      tenantScopeId: 'shared-tenant-id',
    });
    expect(otherOrgEvents).toEqual([]);
  });
});
