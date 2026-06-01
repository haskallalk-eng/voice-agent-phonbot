import { isTrustedScope, type TrustedScope, type UntrustedToolArgs } from './trusted-scope.js';

export type ContextOutputMode = 'voice' | 'web';
export type ContextChannel = 'voice' | 'web' | 'internal_test';
export type ContextTurnSpeaker = 'user' | 'agent' | 'tool';
export type ContextRisk = 'low' | 'medium' | 'high' | 'pricing' | 'legal' | 'policy';
export type ContextEvidenceStatus = 'approved_current' | 'draft' | 'rejected' | 'archived';
export type ContextEvidenceFreshness = 'current' | 'stale' | 'expired';
export type ContextAnswerability = 'answerable' | 'nothing_found' | 'only_excluded_evidence';
export type ContextExcludedEvidenceReason = 'unapproved' | 'stale_high_risk' | 'expired';

export type ContextEvidenceInput = {
  id: string;
  sourceVersionId: string;
  risk: ContextRisk;
  status: ContextEvidenceStatus;
  freshness: ContextEvidenceFreshness;
  text: string;
};

export type ContextContractInput = {
  scope: TrustedScope;
  callState: {
    turnId: string;
    responseId?: string;
    channel: ContextChannel;
    locale: string;
    summary: string;
  };
  currentUserUtterance: string;
  recentTurns: Array<{
    speaker: ContextTurnSpeaker;
    text: string;
  }>;
  taskState: {
    intent: string;
    status: string;
    requiredFields: string[];
  };
  allowedTools: string[];
  retrieval: {
    answerability: ContextAnswerability;
    confidence: number;
    evidence: ContextEvidenceInput[];
  };
  policy: {
    allowedActions: string[];
    deniedActions: string[];
    pendingConfirmation: string | null;
  };
  latencyBudgetMs: {
    total: number;
    retrieval: number;
    policy: number;
    compose: number;
  };
  outputMode: ContextOutputMode;
  untrustedModelArgs?: UntrustedToolArgs;
};

export type ContextEvidence = {
  id: string;
  sourceVersionId: string;
  risk: ContextRisk;
  text: string;
};

export type ContextExcludedEvidenceSummary = {
  id: string;
  sourceVersionId: string;
  risk: ContextRisk;
  reason: ContextExcludedEvidenceReason;
};

export type ContextContract = {
  scope: {
    orgId: string;
    tenantId: string;
    agentId: string;
    callId?: string;
    sessionId?: string;
    source: 'server';
    resolvedFrom: TrustedScope['resolvedFrom'];
  };
  callState: ContextContractInput['callState'];
  currentUserUtterance: string;
  recentTurns: ContextContractInput['recentTurns'];
  taskState: ContextContractInput['taskState'];
  allowedTools: string[];
  retrieval: {
    answerability: ContextAnswerability;
    confidence: number;
    evidence: ContextEvidence[];
  };
  excludedEvidenceSummary: ContextExcludedEvidenceSummary[];
  policy: ContextContractInput['policy'];
  latencyBudgetMs: ContextContractInput['latencyBudgetMs'];
  outputMode: ContextOutputMode;
};

const HIGH_RISK = new Set<ContextRisk>(['high', 'pricing', 'legal', 'policy']);

function sanitizeText(text: string): string {
  return text
    .replace(/\b(?:\+49|0)[1-9](?:[0-9\-\/ ]{5,}[0-9])\b/g, '[phone]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, '[authorization]')
    .replace(/FULL_TRANSCRIPT_SENTINEL/g, '[redacted-transcript-marker]')
    .replace(/FULL_KB_DUMP_SENTINEL/g, '[redacted-kb-marker]')
    .trim();
}

function evidenceExclusionReason(evidence: ContextEvidenceInput): ContextExcludedEvidenceReason | null {
  if (evidence.status !== 'approved_current') return 'unapproved';
  if (evidence.freshness === 'expired') return 'expired';
  if (evidence.freshness === 'stale' && HIGH_RISK.has(evidence.risk)) return 'stale_high_risk';
  return null;
}

function scopeForContext(scope: TrustedScope): ContextContract['scope'] {
  return {
    orgId: scope.orgId,
    tenantId: scope.tenantId,
    agentId: scope.agentId,
    ...(scope.callId ? { callId: scope.callId } : {}),
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
    source: 'server',
    resolvedFrom: scope.resolvedFrom,
  };
}

export function buildContextContract(input: ContextContractInput): ContextContract {
  if (!isTrustedScope(input.scope)) {
    throw new Error('ContextContract requires TrustedScope');
  }

  const evidence: ContextEvidence[] = [];
  const excludedEvidenceSummary: ContextExcludedEvidenceSummary[] = [];

  for (const item of input.retrieval.evidence) {
    const reason = evidenceExclusionReason(item);
    if (reason) {
      excludedEvidenceSummary.push({
        id: item.id,
        sourceVersionId: item.sourceVersionId,
        risk: item.risk,
        reason,
      });
      continue;
    }
    evidence.push({
      id: item.id,
      sourceVersionId: item.sourceVersionId,
      risk: item.risk,
      text: sanitizeText(item.text),
    });
  }

  const answerability = evidence.length === 0 && excludedEvidenceSummary.length > 0
    ? 'only_excluded_evidence'
    : input.retrieval.answerability;

  return {
    scope: scopeForContext(input.scope),
    callState: {
      turnId: input.callState.turnId,
      ...(input.callState.responseId ? { responseId: input.callState.responseId } : {}),
      channel: input.callState.channel,
      locale: input.callState.locale,
      summary: sanitizeText(input.callState.summary),
    },
    currentUserUtterance: sanitizeText(input.currentUserUtterance),
    recentTurns: input.recentTurns.slice(-3).map((turn) => ({
      speaker: turn.speaker,
      text: sanitizeText(turn.text),
    })),
    taskState: {
      intent: input.taskState.intent,
      status: input.taskState.status,
      requiredFields: [...input.taskState.requiredFields],
    },
    allowedTools: [...input.allowedTools],
    retrieval: {
      answerability,
      confidence: input.retrieval.confidence,
      evidence,
    },
    excludedEvidenceSummary,
    policy: {
      allowedActions: [...input.policy.allowedActions],
      deniedActions: [...input.policy.deniedActions],
      pendingConfirmation: input.policy.pendingConfirmation ? sanitizeText(input.policy.pendingConfirmation) : null,
    },
    latencyBudgetMs: { ...input.latencyBudgetMs },
    outputMode: input.outputMode,
  };
}
