export type VoiceComplianceRequiredAction = 'proceed' | 'block' | 'abstain' | 'escalate';

export type VoiceComplianceMechanism = 'policy_state' | 'prompt_only';

export type VoiceComplianceBlocker =
  | 'POLICY_SOURCE_MISSING'
  | 'AI_DISCLOSURE_REQUIRED_NOT_SHOWN'
  | 'RECORDING_CONSENT_REQUIRED_MISSING'
  | 'RECORDING_CONSENT_DENIED'
  | 'RETENTION_POLICY_MISSING'
  | 'DELETION_WORKFLOW_MISSING'
  | 'CUSTOMER_DATA_MINIMIZATION_NOT_PROVEN'
  | 'AUDIT_EVENTS_MISSING'
  | 'PROMPT_ONLY_COMPLIANCE_NOT_ALLOWED';

export type VoiceCompliancePolicySource = {
  sourceRef: string;
  owner: string;
  version?: string;
  verifiedAt?: string;
};

export type VoiceRetentionClass =
  | 'raw_audio'
  | 'transcript'
  | 'redacted_transcript'
  | 'trace'
  | 'eval'
  | 'shadow'
  | 'tool_audit';

export type VoiceDeletionScope =
  | 'call_artifacts'
  | 'kb_personal_data'
  | 'traces'
  | 'evals'
  | 'shadow';

export type VoiceComplianceAuditEventType =
  | 'ai_disclosure_shown'
  | 'recording_consent_status'
  | 'recording_state'
  | 'retention_decision'
  | 'deletion_requested'
  | 'deletion_completed'
  | 'policy_exception';

export type VoiceCompliancePolicy = {
  requiresAiDisclosure: boolean;
  requiresRecordingConsent: boolean;
  recordCalls: boolean;
  complianceMechanism: VoiceComplianceMechanism;
  policySource?: VoiceCompliancePolicySource | null;
  retentionDaysByClass: Partial<Record<VoiceRetentionClass, number>>;
  deletionWorkflowByScope: Partial<Record<VoiceDeletionScope, boolean>>;
  minimizationProven: {
    prompts: boolean;
    traces: boolean;
    evals: boolean;
    shadow: boolean;
    toolPayloads: boolean;
  };
  auditEventsAvailable: VoiceComplianceAuditEventType[];
};

export type VoiceComplianceCallState = {
  aiDisclosureState: 'not_required' | 'shown' | 'missing';
  recordingConsentState: 'not_required' | 'granted' | 'missing' | 'denied' | 'withdrawn';
  recordingState: 'disabled' | 'enabled' | 'paused' | 'stopped';
};

export type VoiceComplianceEvaluation = {
  canProceed: boolean;
  requiredAction: VoiceComplianceRequiredAction;
  blockers: VoiceComplianceBlocker[];
  missingRetentionClasses: VoiceRetentionClass[];
  missingDeletionScopes: VoiceDeletionScope[];
  missingAuditEvents: VoiceComplianceAuditEventType[];
};

export const REQUIRED_VOICE_RETENTION_CLASSES: VoiceRetentionClass[] = [
  'raw_audio',
  'transcript',
  'redacted_transcript',
  'trace',
  'eval',
  'shadow',
  'tool_audit',
];

export const REQUIRED_VOICE_DELETION_SCOPES: VoiceDeletionScope[] = [
  'call_artifacts',
  'kb_personal_data',
  'traces',
  'evals',
  'shadow',
];

export const REQUIRED_VOICE_COMPLIANCE_AUDIT_EVENTS: VoiceComplianceAuditEventType[] = [
  'ai_disclosure_shown',
  'recording_consent_status',
  'recording_state',
  'retention_decision',
  'deletion_requested',
  'deletion_completed',
  'policy_exception',
];

function hasPolicySource(source: VoiceCompliancePolicySource | null | undefined): boolean {
  return Boolean(source?.sourceRef?.trim() && source.owner?.trim());
}

function missingRetentionClasses(policy: VoiceCompliancePolicy): VoiceRetentionClass[] {
  return REQUIRED_VOICE_RETENTION_CLASSES.filter((item) => {
    const days = policy.retentionDaysByClass[item];
    return typeof days !== 'number' || !Number.isFinite(days) || days < 0;
  });
}

function missingDeletionScopes(policy: VoiceCompliancePolicy): VoiceDeletionScope[] {
  return REQUIRED_VOICE_DELETION_SCOPES.filter((item) => policy.deletionWorkflowByScope[item] !== true);
}

function missingAuditEvents(policy: VoiceCompliancePolicy): VoiceComplianceAuditEventType[] {
  const available = new Set(policy.auditEventsAvailable);
  return REQUIRED_VOICE_COMPLIANCE_AUDIT_EVENTS.filter((item) => !available.has(item));
}

function minimizationProven(policy: VoiceCompliancePolicy): boolean {
  return policy.minimizationProven.prompts
    && policy.minimizationProven.traces
    && policy.minimizationProven.evals
    && policy.minimizationProven.shadow
    && policy.minimizationProven.toolPayloads;
}

export function evaluateVoiceCompliance(input: {
  policy: VoiceCompliancePolicy;
  callState: VoiceComplianceCallState;
}): VoiceComplianceEvaluation {
  const blockers = new Set<VoiceComplianceBlocker>();
  if (!hasPolicySource(input.policy.policySource)) blockers.add('POLICY_SOURCE_MISSING');
  if (input.policy.complianceMechanism === 'prompt_only') blockers.add('PROMPT_ONLY_COMPLIANCE_NOT_ALLOWED');

  if (input.policy.requiresAiDisclosure && input.callState.aiDisclosureState !== 'shown') {
    blockers.add('AI_DISCLOSURE_REQUIRED_NOT_SHOWN');
  }

  if (input.policy.requiresRecordingConsent && input.policy.recordCalls) {
    if (input.callState.recordingConsentState === 'missing') blockers.add('RECORDING_CONSENT_REQUIRED_MISSING');
    if (input.callState.recordingConsentState === 'denied' || input.callState.recordingConsentState === 'withdrawn') {
      blockers.add('RECORDING_CONSENT_DENIED');
    }
  }

  const retention = missingRetentionClasses(input.policy);
  const deletion = missingDeletionScopes(input.policy);
  const audit = missingAuditEvents(input.policy);
  if (retention.length > 0) blockers.add('RETENTION_POLICY_MISSING');
  if (deletion.length > 0) blockers.add('DELETION_WORKFLOW_MISSING');
  if (audit.length > 0) blockers.add('AUDIT_EVENTS_MISSING');
  if (!minimizationProven(input.policy)) blockers.add('CUSTOMER_DATA_MINIMIZATION_NOT_PROVEN');

  const blockerList = [...blockers];
  const requiredAction: VoiceComplianceRequiredAction = blockerList.length === 0
    ? 'proceed'
    : blockerList.includes('RECORDING_CONSENT_DENIED')
      ? 'escalate'
      : blockerList.includes('AI_DISCLOSURE_REQUIRED_NOT_SHOWN') || blockerList.includes('RECORDING_CONSENT_REQUIRED_MISSING')
        ? 'block'
        : 'abstain';

  return {
    canProceed: blockerList.length === 0,
    requiredAction,
    blockers: blockerList,
    missingRetentionClasses: retention,
    missingDeletionScopes: deletion,
    missingAuditEvents: audit,
  };
}
