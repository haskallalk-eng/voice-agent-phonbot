export type ToolConfirmationMode = 'voice' | 'web';

export type ToolConfirmationStateName =
  | 'intent_detected'
  | 'fields_collected'
  | 'summary_spoken'
  | 'user_confirmed'
  | 'policy_approved'
  | 'policy_denied'
  | 'idempotency_key_created'
  | 'tool_executed'
  | 'result_spoken';

export type ToolExecutionStatus = 'success' | 'failed' | 'blocked';

export type ToolConfirmationSession = {
  state: ToolConfirmationStateName;
  action: string;
  target: string;
  mode: ToolConfirmationMode;
  fields: Record<string, string>;
  spokenSummary: string | null;
  summaryHash: string | null;
  confirmedSummaryHash: string | null;
  policyApprovalId: string | null;
  policyDenialReason: string | null;
  idempotencyKey: string | null;
  toolExecution: {
    toolCallId: string;
    status: ToolExecutionStatus;
    resultSummary: string;
  } | null;
  spokenResult: string | null;
  version: number;
};

export type CreateToolConfirmationSessionInput = {
  action: string;
  target: string;
  mode: ToolConfirmationMode;
};

export type ToolConfirmationBlockReason =
  | 'FIELDS_REQUIRED'
  | 'SPOKEN_SUMMARY_REQUIRED'
  | 'CONFIRMED_SUMMARY_REQUIRED'
  | 'POLICY_APPROVAL_REQUIRED'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'TOOL_ALREADY_EXECUTED'
  | 'TOOL_EXECUTION_REQUIRED'
  | 'SUMMARY_HASH_MISMATCH'
  | 'RESULT_MUST_NOT_CLAIM_SUCCESS_ON_FAILURE'
  | 'INVALID_TRANSITION';

export type ToolConfirmationEvent =
  | { type: 'fields_collected'; fields: Record<string, string> }
  | { type: 'summary_spoken'; spokenSummary: string; summaryHash: string }
  | { type: 'user_confirmed'; summaryHash: string }
  | { type: 'policy_approved'; approvalId: string }
  | { type: 'policy_denied'; reason: string }
  | { type: 'idempotency_key_created'; idempotencyKey: string }
  | { type: 'tool_executed'; toolCallId: string; status: ToolExecutionStatus; resultSummary: string }
  | { type: 'result_spoken'; spokenResult: string }
  | { type: 'interrupted' }
  | { type: 'user_correction'; fields: Record<string, string> };

export type ToolConfirmationTransition = {
  accepted: boolean;
  session: ToolConfirmationSession;
  reason?: ToolConfirmationBlockReason;
  idempotentReplay?: boolean;
};

export type ToolExecutionGate =
  | { allowed: true }
  | { allowed: false; reason: ToolConfirmationBlockReason };

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function next(session: ToolConfirmationSession, patch: Partial<ToolConfirmationSession>): ToolConfirmationSession {
  return {
    ...session,
    ...patch,
    version: session.version + 1,
  };
}

function reject(session: ToolConfirmationSession, reason: ToolConfirmationBlockReason): ToolConfirmationTransition {
  return { accepted: false, session, reason };
}

function accept(session: ToolConfirmationSession, patch: Partial<ToolConfirmationSession>): ToolConfirmationTransition {
  return { accepted: true, session: next(session, patch) };
}

function resetConfirmation(patch: Partial<ToolConfirmationSession> = {}): Partial<ToolConfirmationSession> {
  return {
    spokenSummary: null,
    summaryHash: null,
    confirmedSummaryHash: null,
    policyApprovalId: null,
    policyDenialReason: null,
    idempotencyKey: null,
    toolExecution: null,
    spokenResult: null,
    ...patch,
  };
}

function speaksSuccess(spokenResult: string): boolean {
  const text = spokenResult.toLowerCase();
  if (/\b(nicht|keine|kein|konnte nicht|wurde nicht)\b.{0,24}\b(gebucht|erfolgreich|storniert|geaendert|erstellt|gespeichert)\b/i.test(text)) {
    return false;
  }
  return /\b(gebucht|erfolgreich|storniert|geaendert|erstellt|gespeichert)\b/i.test(text);
}

export function createToolConfirmationSession(
  input: CreateToolConfirmationSessionInput,
): ToolConfirmationSession {
  return {
    state: 'intent_detected',
    action: input.action,
    target: input.target,
    mode: input.mode,
    fields: {},
    spokenSummary: null,
    summaryHash: null,
    confirmedSummaryHash: null,
    policyApprovalId: null,
    policyDenialReason: null,
    idempotencyKey: null,
    toolExecution: null,
    spokenResult: null,
    version: 1,
  };
}

export function canExecuteMutatingTool(session: ToolConfirmationSession): ToolExecutionGate {
  if (!hasText(session.spokenSummary) || !hasText(session.summaryHash)) {
    return { allowed: false, reason: 'SPOKEN_SUMMARY_REQUIRED' };
  }
  if (!hasText(session.confirmedSummaryHash) || session.confirmedSummaryHash !== session.summaryHash) {
    return { allowed: false, reason: 'CONFIRMED_SUMMARY_REQUIRED' };
  }
  if (!hasText(session.policyApprovalId) || session.state === 'policy_denied') {
    return { allowed: false, reason: 'POLICY_APPROVAL_REQUIRED' };
  }
  if (!hasText(session.idempotencyKey)) {
    return { allowed: false, reason: 'IDEMPOTENCY_KEY_REQUIRED' };
  }
  if (session.toolExecution) {
    return { allowed: false, reason: 'TOOL_ALREADY_EXECUTED' };
  }
  return { allowed: true };
}

export function applyToolConfirmationEvent(
  session: ToolConfirmationSession,
  event: ToolConfirmationEvent,
): ToolConfirmationTransition {
  switch (event.type) {
    case 'fields_collected':
      if (session.toolExecution) return reject(session, 'TOOL_ALREADY_EXECUTED');
      return accept(session, {
        ...resetConfirmation(),
        fields: { ...event.fields },
        state: 'fields_collected',
      });

    case 'summary_spoken':
      if (session.state !== 'fields_collected') return reject(session, 'FIELDS_REQUIRED');
      if (!hasText(event.spokenSummary) || !hasText(event.summaryHash)) return reject(session, 'SPOKEN_SUMMARY_REQUIRED');
      return accept(session, {
        spokenSummary: event.spokenSummary,
        summaryHash: event.summaryHash,
        confirmedSummaryHash: null,
        policyApprovalId: null,
        policyDenialReason: null,
        idempotencyKey: null,
        toolExecution: null,
        spokenResult: null,
        state: 'summary_spoken',
      });

    case 'user_confirmed':
      if (session.confirmedSummaryHash === event.summaryHash && session.summaryHash === event.summaryHash) {
        return { accepted: true, session, idempotentReplay: true };
      }
      if (session.state !== 'summary_spoken') return reject(session, 'SPOKEN_SUMMARY_REQUIRED');
      if (!hasText(event.summaryHash) || event.summaryHash !== session.summaryHash) {
        return reject(session, 'SUMMARY_HASH_MISMATCH');
      }
      return accept(session, {
        confirmedSummaryHash: event.summaryHash,
        policyApprovalId: null,
        policyDenialReason: null,
        idempotencyKey: null,
        toolExecution: null,
        spokenResult: null,
        state: 'user_confirmed',
      });

    case 'policy_approved':
      if (session.state !== 'user_confirmed') return reject(session, 'CONFIRMED_SUMMARY_REQUIRED');
      if (!hasText(event.approvalId)) return reject(session, 'POLICY_APPROVAL_REQUIRED');
      return accept(session, {
        policyApprovalId: event.approvalId,
        policyDenialReason: null,
        idempotencyKey: null,
        toolExecution: null,
        spokenResult: null,
        state: 'policy_approved',
      });

    case 'policy_denied':
      return accept(session, {
        policyApprovalId: null,
        policyDenialReason: event.reason,
        idempotencyKey: null,
        toolExecution: null,
        spokenResult: null,
        state: 'policy_denied',
      });

    case 'idempotency_key_created':
      if (session.state !== 'policy_approved') return reject(session, 'POLICY_APPROVAL_REQUIRED');
      if (!hasText(event.idempotencyKey)) return reject(session, 'IDEMPOTENCY_KEY_REQUIRED');
      return accept(session, {
        idempotencyKey: event.idempotencyKey,
        toolExecution: null,
        spokenResult: null,
        state: 'idempotency_key_created',
      });

    case 'tool_executed': {
      if (session.toolExecution) return { accepted: true, session, idempotentReplay: true };
      const gate = canExecuteMutatingTool(session);
      if (!gate.allowed) return reject(session, gate.reason);
      return accept(session, {
        toolExecution: {
          toolCallId: event.toolCallId,
          status: event.status,
          resultSummary: event.resultSummary,
        },
        spokenResult: null,
        state: 'tool_executed',
      });
    }

    case 'result_spoken':
      if (session.state !== 'tool_executed' || !session.toolExecution) return reject(session, 'TOOL_EXECUTION_REQUIRED');
      if (session.toolExecution.status !== 'success' && speaksSuccess(event.spokenResult)) {
        return reject(session, 'RESULT_MUST_NOT_CLAIM_SUCCESS_ON_FAILURE');
      }
      return accept(session, {
        spokenResult: event.spokenResult,
        state: 'result_spoken',
      });

    case 'interrupted':
      if (session.state === 'summary_spoken' || session.state === 'user_confirmed' || session.state === 'policy_approved') {
        return accept(session, {
          ...resetConfirmation({ fields: { ...session.fields } }),
          state: 'fields_collected',
        });
      }
      return { accepted: true, session, idempotentReplay: true };

    case 'user_correction':
      if (session.toolExecution) return reject(session, 'TOOL_ALREADY_EXECUTED');
      return accept(session, {
        ...resetConfirmation(),
        fields: { ...session.fields, ...event.fields },
        state: 'fields_collected',
      });

    default:
      return reject(session, 'INVALID_TRANSITION');
  }
}
