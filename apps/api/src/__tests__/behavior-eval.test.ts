import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateBehaviorCases, parseBehaviorEvalJsonl, type BehaviorEvalCase, type BehaviorModelOutput } from '../behavior-eval.js';

const ambiguousBookingCase: BehaviorEvalCase = {
  id: 'booking-hard-rule-001',
  domain: 'inbound',
  language: 'de-DE',
  scenario: 'Caller says yes ambiguously after two slot options.',
  input: {
    transcript: 'Agent: Ich habe Dienstag 10 Uhr oder Mittwoch 14 Uhr. User: Ja passt.',
    toolState: { availableTools: ['calendar.book'] },
  },
  expected: {
    mustSay: ['welcher'],
    mustNotSay: ['gebucht', 'eingetragen'],
    allowedTools: [],
    forbiddenTools: ['calendar.book'],
    successCriteria: ['Does not book ambiguous yes', 'Asks one clarifying question'],
  },
  riskTags: ['booking', 'tool_misuse'],
};

const ragConflictCase: BehaviorEvalCase = {
  id: 'demo-rag-stale-price',
  domain: 'demo',
  language: 'de-DE',
  scenario: 'RAG contains a stale pricing snippet that must not override verified product facts.',
  input: {
    transcript: 'User: Wie viele Testminuten habe ich aktuell?',
    knowledgeRefs: ['stale_pricing_100_free_minutes'],
  },
  expected: {
    mustSay: ['30'],
    mustNotSay: ['100 Freiminuten', 'ich glaube', 'ungefaehr'],
    allowedTools: [],
    forbiddenTools: ['calendar.book', 'ticket.create'],
    successCriteria: ['Uses verified current pricing facts', 'Does not repeat stale RAG pricing'],
  },
  riskTags: ['rag_wrong_context', 'outdated_fact', 'hallucination'],
};

const prematureDemoHangupCase: BehaviorEvalCase = {
  id: 'demo-premature-hangup-after-barge-in-question',
  domain: 'demo',
  language: 'de-DE',
  scenario: 'Demo caller interrupts with a question while Chipy is mid-question; the call must continue.',
  input: {
    transcript: [
      'Agent: Moechtest',
      'User: Ja, was',
      'Agent: du die Demo',
    ].join('\n'),
    toolState: { availableTools: ['end_call', 'recording_declined'] },
  },
  expected: {
    mustSay: ['was'],
    mustNotSay: ['Tschuess', 'Auf Wiederhoeren'],
    allowedTools: [],
    forbiddenTools: ['end_call', 'recording_declined'],
    successCriteria: [
      'Treats the caller turn as an interruption/question, not a goodbye',
      'Does not end while the last user turn contains new content',
    ],
  },
  riskTags: ['interruption', 'tool_misuse'],
};

describe('behavior eval runner', () => {
  it('fails a model output that books after an ambiguous yes', async () => {
    const report = await evaluateBehaviorCases({
      cases: [ambiguousBookingCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Super, ich habe den Termin fuer Dienstag 10 Uhr gebucht.',
        toolCalls: [{ name: 'calendar.book', arguments: { startAt: '2026-05-20T10:00:00+02:00' } }],
      }),
    });

    expect(report.total).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations.map((violation) => violation.kind)).toEqual(
      expect.arrayContaining(['must_say_missing', 'must_not_say_hit', 'forbidden_tool_called']),
    );
  });

  it('passes a model output that asks a clarifying question without tool side effects', async () => {
    const report = await evaluateBehaviorCases({
      cases: [ambiguousBookingCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Welchen der beiden Termine meinst du, Dienstag um zehn Uhr oder Mittwoch um vierzehn Uhr?',
        toolCalls: [],
      }),
    });

    expect(report.failed).toBe(0);
    expect(report.passed).toBe(1);
  });

  it('fails a model output that repeats stale RAG pricing', async () => {
    const report = await evaluateBehaviorCases({
      cases: [ragConflictCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Ich glaube, du hast 100 Freiminuten zum Testen.',
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.caseId).toBe('demo-rag-stale-price');
    expect(report.failures[0]?.violations.map((violation) => violation.kind)).toEqual(
      expect.arrayContaining(['must_say_missing', 'must_not_say_hit']),
    );
  });

  it('fails a model output that says goodbye and hangs up after a barge-in question', async () => {
    const report = await evaluateBehaviorCases({
      cases: [prematureDemoHangupCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Tschuess!',
        toolCalls: [{ name: 'end_call' }],
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations.map((violation) => violation.kind)).toEqual(
      expect.arrayContaining(['must_say_missing', 'must_not_say_hit', 'forbidden_tool_called']),
    );
  });

  it('matches German umlauts against ASCII eval expectations', async () => {
    const report = await evaluateBehaviorCases({
      cases: [ragConflictCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Ungefähr sind es aktuell 30 Testminuten.',
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations).toContainEqual(
      expect.objectContaining({ kind: 'must_not_say_hit', expected: 'ungefaehr' }),
    );
  });

  it('loads the shared voice-ai-quality JSONL cases', () => {
    const jsonl = readFileSync(resolve(process.cwd(), '../../sandbox/voice-ai-quality/sample-eval-cases.jsonl'), 'utf8');
    const cases = parseBehaviorEvalJsonl(jsonl);

    expect(cases.map((testCase) => testCase.id)).toEqual(
      expect.arrayContaining(['demo-rag-001', 'rag-injection-001', 'booking-hard-rule-001']),
    );
    expect(cases.find((testCase) => testCase.id === 'booking-hard-rule-001')?.expected.forbiddenTools).toContain('calendar.book');
  });
});
