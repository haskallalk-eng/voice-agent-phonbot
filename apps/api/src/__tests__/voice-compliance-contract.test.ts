import { describe, expect, it } from 'vitest';
import {
  REQUIRED_VOICE_COMPLIANCE_AUDIT_EVENTS,
  REQUIRED_VOICE_DELETION_SCOPES,
  REQUIRED_VOICE_RETENTION_CLASSES,
  evaluateVoiceCompliance,
  type VoiceComplianceCallState,
  type VoiceCompliancePolicy,
} from '../voice-compliance-contract.js';

function policy(overrides: Partial<VoiceCompliancePolicy> = {}): VoiceCompliancePolicy {
  return {
    requiresAiDisclosure: true,
    requiresRecordingConsent: true,
    recordCalls: true,
    complianceMechanism: 'policy_state',
    policySource: {
      sourceRef: 'tenant_policy:voice:2026-05-29',
      owner: 'privacy-owner@example.test',
      version: '2026-05-29',
      verifiedAt: '2026-05-29T00:00:00.000Z',
    },
    retentionDaysByClass: Object.fromEntries(REQUIRED_VOICE_RETENTION_CLASSES.map((item) => [item, 30])),
    deletionWorkflowByScope: Object.fromEntries(REQUIRED_VOICE_DELETION_SCOPES.map((item) => [item, true])),
    minimizationProven: {
      prompts: true,
      traces: true,
      evals: true,
      shadow: true,
      toolPayloads: true,
    },
    auditEventsAvailable: [...REQUIRED_VOICE_COMPLIANCE_AUDIT_EVENTS],
    ...overrides,
  };
}

function callState(overrides: Partial<VoiceComplianceCallState> = {}): VoiceComplianceCallState {
  return {
    aiDisclosureState: 'shown',
    recordingConsentState: 'granted',
    recordingState: 'enabled',
    ...overrides,
  };
}

describe('voice compliance and disclosure contract', () => {
  it('allows normal handling only when policy-source, disclosure, consent, retention, deletion, minimization, and audit gates pass', () => {
    const result = evaluateVoiceCompliance({
      policy: policy(),
      callState: callState(),
    });

    expect(result).toMatchObject({
      canProceed: true,
      requiredAction: 'proceed',
      blockers: [],
      missingRetentionClasses: [],
      missingDeletionScopes: [],
      missingAuditEvents: [],
    });
  });

  it('blocks when required AI disclosure has not been shown', () => {
    const result = evaluateVoiceCompliance({
      policy: policy(),
      callState: callState({ aiDisclosureState: 'missing' }),
    });

    expect(result.canProceed).toBe(false);
    expect(result.requiredAction).toBe('block');
    expect(result.blockers).toContain('AI_DISCLOSURE_REQUIRED_NOT_SHOWN');
  });

  it('blocks or escalates recording flows when consent is missing or denied', () => {
    const missing = evaluateVoiceCompliance({
      policy: policy(),
      callState: callState({ recordingConsentState: 'missing' }),
    });
    const denied = evaluateVoiceCompliance({
      policy: policy(),
      callState: callState({ recordingConsentState: 'denied', recordingState: 'stopped' }),
    });

    expect(missing.requiredAction).toBe('block');
    expect(missing.blockers).toContain('RECORDING_CONSENT_REQUIRED_MISSING');
    expect(denied.requiredAction).toBe('escalate');
    expect(denied.blockers).toContain('RECORDING_CONSENT_DENIED');
  });

  it('fails readiness when retention or deletion coverage is incomplete', () => {
    const result = evaluateVoiceCompliance({
      policy: policy({
        retentionDaysByClass: {
          raw_audio: 0,
          transcript: 30,
        },
        deletionWorkflowByScope: {
          call_artifacts: true,
          traces: true,
        },
      }),
      callState: callState(),
    });

    expect(result.canProceed).toBe(false);
    expect(result.blockers).toContain('RETENTION_POLICY_MISSING');
    expect(result.blockers).toContain('DELETION_WORKFLOW_MISSING');
    expect(result.missingRetentionClasses).toEqual([
      'redacted_transcript',
      'trace',
      'eval',
      'shadow',
      'tool_audit',
    ]);
    expect(result.missingDeletionScopes).toEqual(['kb_personal_data', 'evals', 'shadow']);
  });

  it('does not allow prompt-only compliance to replace policy state and audit events', () => {
    const result = evaluateVoiceCompliance({
      policy: policy({
        complianceMechanism: 'prompt_only',
        auditEventsAvailable: ['ai_disclosure_shown'],
      }),
      callState: callState(),
    });

    expect(result.canProceed).toBe(false);
    expect(result.blockers).toContain('PROMPT_ONLY_COMPLIANCE_NOT_ALLOWED');
    expect(result.blockers).toContain('AUDIT_EVENTS_MISSING');
    expect(result.missingAuditEvents).toEqual([
      'recording_consent_status',
      'recording_state',
      'retention_decision',
      'deletion_requested',
      'deletion_completed',
      'policy_exception',
    ]);
  });

  it('requires policy source ownership and customer-data minimization proof', () => {
    const result = evaluateVoiceCompliance({
      policy: policy({
        policySource: { sourceRef: '', owner: '' },
        minimizationProven: {
          prompts: true,
          traces: false,
          evals: true,
          shadow: false,
          toolPayloads: true,
        },
      }),
      callState: callState(),
    });

    expect(result.canProceed).toBe(false);
    expect(result.blockers).toContain('POLICY_SOURCE_MISSING');
    expect(result.blockers).toContain('CUSTOMER_DATA_MINIMIZATION_NOT_PROVEN');
  });
});
