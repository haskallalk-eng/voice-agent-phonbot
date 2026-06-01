import { describe, expect, it } from 'vitest';
import {
  applyToolConfirmationEvent,
  canExecuteMutatingTool,
  createToolConfirmationSession,
  type ToolConfirmationSession,
} from '../tool-confirmation-state.js';

function readySession(): ToolConfirmationSession {
  let session = createToolConfirmationSession({
    action: 'calendar_book',
    target: 'appointment',
    mode: 'voice',
  });
  session = applyToolConfirmationEvent(session, {
    type: 'fields_collected',
    fields: { callerName: 'Max', service: 'Beratung', startAt: '2026-06-01T09:00:00+02:00' },
  }).session;
  session = applyToolConfirmationEvent(session, {
    type: 'summary_spoken',
    spokenSummary: 'Ich buche Beratung fuer Max am ersten Juni um neun Uhr.',
    summaryHash: 'summary-1',
  }).session;
  session = applyToolConfirmationEvent(session, { type: 'user_confirmed', summaryHash: 'summary-1' }).session;
  session = applyToolConfirmationEvent(session, { type: 'policy_approved', approvalId: 'policy-1' }).session;
  return session;
}

describe('tool confirmation state machine', () => {
  it('allows the happy path only in the required order', () => {
    let session = createToolConfirmationSession({
      action: 'calendar_book',
      target: 'appointment',
      mode: 'voice',
    });

    expect(canExecuteMutatingTool(session).allowed).toBe(false);

    session = applyToolConfirmationEvent(session, {
      type: 'fields_collected',
      fields: { callerName: 'Max', service: 'Beratung', startAt: '2026-06-01T09:00:00+02:00' },
    }).session;
    session = applyToolConfirmationEvent(session, {
      type: 'summary_spoken',
      spokenSummary: 'Ich buche Beratung fuer Max am ersten Juni um neun Uhr.',
      summaryHash: 'summary-1',
    }).session;
    session = applyToolConfirmationEvent(session, { type: 'user_confirmed', summaryHash: 'summary-1' }).session;
    session = applyToolConfirmationEvent(session, { type: 'policy_approved', approvalId: 'policy-1' }).session;

    expect(canExecuteMutatingTool(session)).toEqual({
      allowed: false,
      reason: 'IDEMPOTENCY_KEY_REQUIRED',
    });

    session = applyToolConfirmationEvent(session, {
      type: 'idempotency_key_created',
      idempotencyKey: 'idem-1',
    }).session;

    expect(canExecuteMutatingTool(session)).toEqual({ allowed: true });

    session = applyToolConfirmationEvent(session, {
      type: 'tool_executed',
      toolCallId: 'tool-call-1',
      status: 'success',
      resultSummary: 'Der Termin wurde gebucht.',
    }).session;
    session = applyToolConfirmationEvent(session, {
      type: 'result_spoken',
      spokenResult: 'Der Termin wurde gebucht.',
    }).session;

    expect(session.state).toBe('result_spoken');
  });

  it('blocks tool execution before confirmed summary, policy approval, and idempotency key', () => {
    let session = createToolConfirmationSession({
      action: 'calendar_book',
      target: 'appointment',
      mode: 'voice',
    });

    expect(applyToolConfirmationEvent(session, {
      type: 'tool_executed',
      toolCallId: 'early',
      status: 'success',
      resultSummary: 'Should not happen.',
    })).toMatchObject({ accepted: false, reason: 'SPOKEN_SUMMARY_REQUIRED' });

    session = applyToolConfirmationEvent(session, {
      type: 'fields_collected',
      fields: { callerName: 'Max', service: 'Beratung', startAt: '2026-06-01T09:00:00+02:00' },
    }).session;
    session = applyToolConfirmationEvent(session, {
      type: 'summary_spoken',
      spokenSummary: 'Ich buche Beratung fuer Max am ersten Juni um neun Uhr.',
      summaryHash: 'summary-1',
    }).session;

    expect(applyToolConfirmationEvent(session, {
      type: 'tool_executed',
      toolCallId: 'unconfirmed',
      status: 'success',
      resultSummary: 'Should not happen.',
    })).toMatchObject({ accepted: false, reason: 'CONFIRMED_SUMMARY_REQUIRED' });

    session = readySession();
    expect(applyToolConfirmationEvent(session, {
      type: 'tool_executed',
      toolCallId: 'no-idem',
      status: 'success',
      resultSummary: 'Should not happen.',
    })).toMatchObject({ accepted: false, reason: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('reopens confirmation after interruption or user correction and invalidates prior confirmation', () => {
    let session = readySession();

    session = applyToolConfirmationEvent(session, { type: 'interrupted' }).session;
    expect(session.state).toBe('fields_collected');
    expect(session.confirmedSummaryHash).toBeNull();
    expect(canExecuteMutatingTool(session).allowed).toBe(false);

    session = applyToolConfirmationEvent(session, {
      type: 'summary_spoken',
      spokenSummary: 'Ich buche Beratung fuer Max am zweiten Juni um zehn Uhr.',
      summaryHash: 'summary-2',
    }).session;
    session = applyToolConfirmationEvent(session, { type: 'user_confirmed', summaryHash: 'summary-2' }).session;
    session = applyToolConfirmationEvent(session, { type: 'user_correction', fields: { startAt: '2026-06-03T11:00:00+02:00' } }).session;

    expect(session.state).toBe('fields_collected');
    expect(session.fields.startAt).toBe('2026-06-03T11:00:00+02:00');
    expect(session.confirmedSummaryHash).toBeNull();
    expect(session.policyApprovalId).toBeNull();
  });

  it('keeps repeated confirmation and idempotent retry from duplicating execution', () => {
    let session = readySession();
    session = applyToolConfirmationEvent(session, { type: 'user_confirmed', summaryHash: 'summary-1' }).session;
    session = applyToolConfirmationEvent(session, { type: 'idempotency_key_created', idempotencyKey: 'idem-1' }).session;
    session = applyToolConfirmationEvent(session, {
      type: 'tool_executed',
      toolCallId: 'tool-call-1',
      status: 'success',
      resultSummary: 'Der Termin wurde gebucht.',
    }).session;

    const duplicate = applyToolConfirmationEvent(session, {
      type: 'tool_executed',
      toolCallId: 'tool-call-2',
      status: 'success',
      resultSummary: 'Der Termin wurde noch einmal gebucht.',
    });

    expect(duplicate.accepted).toBe(true);
    expect(duplicate.idempotentReplay).toBe(true);
    expect(duplicate.session.toolExecution?.toolCallId).toBe('tool-call-1');
    expect(duplicate.session.idempotencyKey).toBe('idem-1');
  });

  it('does not reopen confirmation after a tool was already executed', () => {
    let session = readySession();
    session = applyToolConfirmationEvent(session, { type: 'idempotency_key_created', idempotencyKey: 'idem-1' }).session;
    session = applyToolConfirmationEvent(session, {
      type: 'tool_executed',
      toolCallId: 'tool-call-1',
      status: 'success',
      resultSummary: 'Der Termin wurde gebucht.',
    }).session;

    expect(applyToolConfirmationEvent(session, { type: 'user_correction', fields: { startAt: '2026-06-04T12:00:00+02:00' } }))
      .toMatchObject({ accepted: false, reason: 'TOOL_ALREADY_EXECUTED' });
    expect(applyToolConfirmationEvent(session, { type: 'fields_collected', fields: { startAt: '2026-06-04T12:00:00+02:00' } }))
      .toMatchObject({ accepted: false, reason: 'TOOL_ALREADY_EXECUTED' });
  });

  it('records policy denial and tool failure without claiming success', () => {
    const denied = applyToolConfirmationEvent(readySession(), {
      type: 'policy_denied',
      reason: 'Caller identity could not be verified.',
    });

    expect(denied.session.state).toBe('policy_denied');
    expect(canExecuteMutatingTool(denied.session)).toEqual({
      allowed: false,
      reason: 'POLICY_APPROVAL_REQUIRED',
    });

    let failed = applyToolConfirmationEvent(readySession(), {
      type: 'idempotency_key_created',
      idempotencyKey: 'idem-fail',
    }).session;
    failed = applyToolConfirmationEvent(failed, {
      type: 'tool_executed',
      toolCallId: 'tool-call-fail',
      status: 'failed',
      resultSummary: 'Der Termin wurde nicht gebucht.',
    }).session;

    const spoken = applyToolConfirmationEvent(failed, {
      type: 'result_spoken',
      spokenResult: 'Der Termin wurde nicht gebucht.',
    }).session;

    expect(spoken.state).toBe('result_spoken');
    expect(spoken.toolExecution?.status).toBe('failed');
    expect(spoken.spokenResult).toBe('Der Termin wurde nicht gebucht.');

    const falseSuccess = applyToolConfirmationEvent(failed, {
      type: 'result_spoken',
      spokenResult: 'Der Termin wurde gebucht.',
    });
    expect(falseSuccess).toMatchObject({
      accepted: false,
      reason: 'RESULT_MUST_NOT_CLAIM_SUCCESS_ON_FAILURE',
    });
  });
});
