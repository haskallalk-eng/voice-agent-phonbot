import { describe, expect, it } from 'vitest';
import {
  buildContextContract,
  type ContextContractInput,
} from '../context-contract.js';
import { createTrustedScope } from '../trusted-scope.js';

function input(overrides: Partial<ContextContractInput> = {}): ContextContractInput {
  return {
    scope: createTrustedScope({
      orgId: 'org-1',
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      callId: 'call-1',
      source: 'server',
      resolvedFrom: 'call_registry',
    }),
    callState: {
      turnId: 'turn-1',
      responseId: 'response-1',
      channel: 'voice',
      locale: 'de-DE',
      summary: 'Caller asks about opening hours.',
    },
    currentUserUtterance: 'Habt ihr heute offen?',
    recentTurns: [
      { speaker: 'user', text: 'Meine Nummer ist 0176 12345678 und ich frage wegen morgen.' },
      { speaker: 'agent', text: 'Ich helfe kurz weiter.' },
      { speaker: 'user', text: 'FULL_TRANSCRIPT_SENTINEL should not survive.' },
    ],
    taskState: {
      intent: 'opening_hours',
      status: 'answering',
      requiredFields: [],
    },
    allowedTools: ['knowledge.search'],
    retrieval: {
      answerability: 'answerable',
      confidence: 0.91,
      evidence: [
        {
          id: 'ev-current',
          sourceVersionId: 'sv-current',
          risk: 'low',
          status: 'approved_current',
          freshness: 'current',
          text: 'Heute geoeffnet von 09:00 bis 18:00.',
        },
        {
          id: 'ev-stale-price',
          sourceVersionId: 'sv-stale',
          risk: 'pricing',
          status: 'approved_current',
          freshness: 'stale',
          text: 'Alter Preis 10 Euro. FULL_KB_DUMP_SENTINEL.',
        },
        {
          id: 'ev-unapproved',
          sourceVersionId: 'sv-draft',
          risk: 'policy',
          status: 'draft',
          freshness: 'current',
          text: 'Unapproved policy content.',
        },
      ],
    },
    policy: {
      allowedActions: ['answer'],
      deniedActions: [],
      pendingConfirmation: null,
    },
    latencyBudgetMs: {
      total: 800,
      retrieval: 100,
      policy: 80,
      compose: 200,
    },
    outputMode: 'voice',
    untrustedModelArgs: {
      orgId: 'evil-org',
      tenantId: 'evil-tenant',
      authorization: 'Bearer secret-token',
      customerIdentity: 'Max Muster',
    },
    ...overrides,
  };
}

describe('ContextContract', () => {
  it('builds a stable compact context snapshot with trusted scope and approved evidence only', () => {
    const context = buildContextContract(input());

    expect(context).toMatchInlineSnapshot(`
      {
        "allowedTools": [
          "knowledge.search",
        ],
        "callState": {
          "channel": "voice",
          "locale": "de-DE",
          "responseId": "response-1",
          "summary": "Caller asks about opening hours.",
          "turnId": "turn-1",
        },
        "currentUserUtterance": "Habt ihr heute offen?",
        "excludedEvidenceSummary": [
          {
            "id": "ev-stale-price",
            "reason": "stale_high_risk",
            "risk": "pricing",
            "sourceVersionId": "sv-stale",
          },
          {
            "id": "ev-unapproved",
            "reason": "unapproved",
            "risk": "policy",
            "sourceVersionId": "sv-draft",
          },
        ],
        "latencyBudgetMs": {
          "compose": 200,
          "policy": 80,
          "retrieval": 100,
          "total": 800,
        },
        "outputMode": "voice",
        "policy": {
          "allowedActions": [
            "answer",
          ],
          "deniedActions": [],
          "pendingConfirmation": null,
        },
        "recentTurns": [
          {
            "speaker": "user",
            "text": "Meine Nummer ist [phone] und ich frage wegen morgen.",
          },
          {
            "speaker": "agent",
            "text": "Ich helfe kurz weiter.",
          },
          {
            "speaker": "user",
            "text": "[redacted-transcript-marker] should not survive.",
          },
        ],
        "retrieval": {
          "answerability": "answerable",
          "confidence": 0.91,
          "evidence": [
            {
              "id": "ev-current",
              "risk": "low",
              "sourceVersionId": "sv-current",
              "text": "Heute geoeffnet von 09:00 bis 18:00.",
            },
          ],
        },
        "scope": {
          "agentId": "agent-1",
          "callId": "call-1",
          "orgId": "org-1",
          "resolvedFrom": "call_registry",
          "source": "server",
          "tenantId": "tenant-1",
        },
        "taskState": {
          "intent": "opening_hours",
          "requiredFields": [],
          "status": "answering",
        },
      }
    `);
  });

  it('excludes model-supplied scope, raw PII, full transcript markers, and full KB dump content', () => {
    const serialized = JSON.stringify(buildContextContract(input()));

    expect(serialized).not.toContain('evil-org');
    expect(serialized).not.toContain('evil-tenant');
    expect(serialized).not.toContain('Bearer secret-token');
    expect(serialized).not.toContain('Max Muster');
    expect(serialized).not.toContain('0176 12345678');
    expect(serialized).not.toContain('FULL_TRANSCRIPT_SENTINEL');
    expect(serialized).not.toContain('FULL_KB_DUMP_SENTINEL');
    expect(serialized).not.toContain('Alter Preis 10 Euro');
    expect(serialized).not.toContain('Unapproved policy content');
  });

  it('distinguishes no evidence found from only excluded evidence found', () => {
    const nothingFound = buildContextContract(input({
      retrieval: {
        answerability: 'nothing_found',
        confidence: 0,
        evidence: [],
      },
    }));

    const onlyExcluded = buildContextContract(input({
      retrieval: {
        answerability: 'answerable',
        confidence: 0.4,
        evidence: [
          {
            id: 'ev-only-stale',
            sourceVersionId: 'sv-only-stale',
            risk: 'legal',
            status: 'approved_current',
            freshness: 'stale',
            text: 'Old legal text.',
          },
        ],
      },
    }));

    expect(nothingFound.retrieval.answerability).toBe('nothing_found');
    expect(nothingFound.excludedEvidenceSummary).toEqual([]);
    expect(onlyExcluded.retrieval.answerability).toBe('only_excluded_evidence');
    expect(onlyExcluded.excludedEvidenceSummary).toEqual([
      {
        id: 'ev-only-stale',
        sourceVersionId: 'sv-only-stale',
        risk: 'legal',
        reason: 'stale_high_risk',
      },
    ]);
  });

  it('fails closed when scope is not a branded TrustedScope', () => {
    expect(() => buildContextContract(input({
      scope: {
        orgId: 'org-1',
        tenantId: 'tenant-1',
        agentId: 'agent-1',
        source: 'server',
        resolvedFrom: 'call_registry',
      } as never,
    }))).toThrow('ContextContract requires TrustedScope');
  });
});
