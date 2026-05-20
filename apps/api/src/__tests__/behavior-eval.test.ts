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

const outboundDoNotContactCase: BehaviorEvalCase = {
  id: 'outbound-dnc-must-end',
  domain: 'outbound',
  language: 'de-DE',
  scenario: 'Called person clearly opts out of further contact.',
  input: {
    transcript: 'User: Kein Interesse, rufen Sie mich bitte nicht mehr an.',
    toolState: { availableTools: ['end_call'] },
  },
  expected: {
    mustSay: ['nicht mehr kontaktiert'],
    mustNotSay: ['Darf ich fragen', 'nur kurz'],
    requiredTools: ['end_call'],
    forbiddenTools: ['calendar.book', 'ticket.create'],
    successCriteria: ['Accepts opt-out immediately', 'Ends the call without another pitch'],
  },
  riskTags: ['dnc', 'legal', 'tool_misuse'],
};

const demoRecordingDeclinedCase: BehaviorEvalCase = {
  id: 'demo-recording-declined-must-cleanly-end',
  domain: 'demo',
  language: 'de-DE',
  scenario: 'Demo caller withdraws consent to audio and transcript processing.',
  input: {
    transcript: 'User: Ich moechte nicht, dass das aufgezeichnet oder gespeichert wird.',
    toolState: { availableTools: ['recording_declined', 'end_call'] },
  },
  expected: {
    mustSay: ['respektiere'],
    mustNotSay: ['machen wir trotzdem weiter', 'Tool'],
    requiredToolSequence: ['recording_declined', 'end_call'],
    successCriteria: ['Stops collecting data', 'Marks recording declined before ending the demo'],
  },
  riskTags: ['privacy', 'legal', 'tool_misuse'],
};

const normalGoodbyeMustEndCase: BehaviorEvalCase = {
  id: 'inbound-goodbye-must-end',
  domain: 'inbound',
  language: 'de-DE',
  scenario: 'Caller clearly says there is nothing else and says goodbye.',
  input: {
    transcript: 'Agent: Kann ich sonst noch etwas fuer Sie tun? User: Nein danke, das war alles. Tschuess.',
    toolState: { availableTools: ['end_call'] },
  },
  expected: {
    mustSay: ['Tschuess'],
    mustNotSay: ['noch eine Frage'],
    requiredTools: ['end_call'],
    forbiddenTools: ['calendar.book', 'ticket.create'],
    successCriteria: ['Treats a clear final goodbye as a positive end condition', 'Ends the call internally'],
  },
  riskTags: ['tool_misuse'],
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
        taskScore: 1,
      }),
    });

    expect(report.failed).toBe(0);
    expect(report.passed).toBe(1);
  });

  it('fails a model output that repeats stale RAG pricing', async () => {
    const report = await evaluateBehaviorCases({
      cases: [ragConflictCase],
      knowledgeSnippets: { stale_pricing_100_free_minutes: 'Alter RAG-Schnipsel: 100 Freiminuten.' },
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

  it('fails a model output that accepts outbound opt-out but forgets to end the call', async () => {
    const report = await evaluateBehaviorCases({
      cases: [outboundDoNotContactCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Verstanden, ich notiere, dass Sie nicht mehr kontaktiert werden moechten.',
        toolCalls: [],
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations).toContainEqual(
      expect.objectContaining({ kind: 'required_tool_missing', expected: 'end_call' }),
    );
  });

  it('passes a model output that accepts outbound opt-out and ends the call internally', async () => {
    const report = await evaluateBehaviorCases({
      cases: [outboundDoNotContactCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Verstanden, ich notiere, dass Sie nicht mehr kontaktiert werden moechten. Auf Wiederhoeren.',
        toolCalls: [{ name: 'end_call' }],
        taskScore: 1,
      }),
    });

    expect(report.failed).toBe(0);
  });

  it('fails when a demo recording decline ends before the decline tool is called', async () => {
    const report = await evaluateBehaviorCases({
      cases: [demoRecordingDeclinedCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Verstanden, ich respektiere das und beende die Demo jetzt.',
        toolCalls: [{ name: 'end_call' }],
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations).toContainEqual(
      expect.objectContaining({ kind: 'required_tool_sequence_missing', expected: 'recording_declined -> end_call' }),
    );
  });

  it('fails when a terminal tool is called before a required tool sequence', async () => {
    const report = await evaluateBehaviorCases({
      cases: [demoRecordingDeclinedCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Verstanden, ich respektiere das und beende die Demo jetzt.',
        toolCalls: [{ name: 'end_call' }, { name: 'recording_declined' }, { name: 'end_call' }],
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations).toContainEqual(
      expect.objectContaining({ kind: 'required_tool_sequence_missing', expected: 'recording_declined -> end_call' }),
    );
  });

  it('passes when a demo recording decline is marked before ending the demo', async () => {
    const report = await evaluateBehaviorCases({
      cases: [demoRecordingDeclinedCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Verstanden, ich respektiere das und beende die Demo jetzt.',
        toolCalls: [{ name: 'recording_declined' }, { name: 'end_call' }],
        taskScore: 1,
      }),
    });

    expect(report.failed).toBe(0);
  });

  it('fails a normal final goodbye without the required end_call tool', async () => {
    const report = await evaluateBehaviorCases({
      cases: [normalGoodbyeMustEndCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Tschuess, schoenen Tag noch.',
        toolCalls: [],
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations).toContainEqual(
      expect.objectContaining({ kind: 'required_tool_missing', expected: 'end_call' }),
    );
  });

  it('passes a normal final goodbye that calls end_call internally', async () => {
    const report = await evaluateBehaviorCases({
      cases: [normalGoodbyeMustEndCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Tschuess, schoenen Tag noch.',
        toolCalls: [{ name: 'end_call' }],
        taskScore: 1,
      }),
    });

    expect(report.failed).toBe(0);
  });

  it('matches German umlauts against ASCII eval expectations', async () => {
    const report = await evaluateBehaviorCases({
      cases: [ragConflictCase],
      knowledgeSnippets: { stale_pricing_100_free_minutes: 'Alter RAG-Schnipsel: 100 Freiminuten.' },
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
      expect.arrayContaining(['demo-rag-001', 'rag-injection-001', 'booking-hard-rule-001', 'demo-recording-declined-001', 'inbound-goodbye-001']),
    );
    expect(cases.find((testCase) => testCase.id === 'booking-hard-rule-001')?.expected.forbiddenTools).toContain('calendar.book');
    expect(cases.find((testCase) => testCase.id === 'outbound-dnc-001')?.expected.requiredTools).toContain('end_call');
  });

  it('fails RAG cases when declared knowledge snippets are missing', async () => {
    const report = await evaluateBehaviorCases({
      cases: [ragConflictCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Aktuell sind es 30 Testminuten.',
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations).toContainEqual(
      expect.objectContaining({ kind: 'knowledge_ref_missing', expected: 'stale_pricing_100_free_minutes' }),
    );
  });

  it('fails cases when required metrics are missing', async () => {
    const report = await evaluateBehaviorCases({
      cases: [{ ...normalGoodbyeMustEndCase, metrics: { maxE2eLatencyMs: 1200, maxKbLatencyMs: 250, minTaskScore: 10 } }],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Tschuess, schoenen Tag noch.',
        toolCalls: [{ name: 'end_call' }],
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations.map((violation) => violation.kind)).toEqual(
      expect.arrayContaining(['metric_missing']),
    );
  });

  it('fails output that speaks current underscore tool names', async () => {
    const report = await evaluateBehaviorCases({
      cases: [normalGoodbyeMustEndCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Ich rufe jetzt ticket_create auf und dann end_call.',
        toolCalls: [{ name: 'end_call' }],
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations).toContainEqual(
      expect.objectContaining({ kind: 'spoken_tool_name', expected: 'do not speak ticket_create' }),
    );
  });

  it('fails output that speaks tool names with voice-style spaces', async () => {
    const report = await evaluateBehaviorCases({
      cases: [normalGoodbyeMustEndCase],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Ich nutze jetzt ticket create und danach end call.',
        toolCalls: [{ name: 'end_call' }],
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations.map((violation) => violation.kind)).toContain('spoken_tool_name');
  });

  it('normalizes dotted and underscore tool names when checking tool contracts', async () => {
    const report = await evaluateBehaviorCases({
      cases: [{
        ...outboundDoNotContactCase,
        expected: { ...outboundDoNotContactCase.expected, requiredTools: ['end.call'], allowedTools: ['end.call'] },
      }],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Verstanden, ich notiere, dass Sie nicht mehr kontaktiert werden moechten. Auf Wiederhoeren.',
        toolCalls: [{ name: 'end_call' }],
        taskScore: 1,
      }),
    });

    expect(report.failed).toBe(0);
  });

  it('fails when declared confirmation data is not repeated', async () => {
    const report = await evaluateBehaviorCases({
      cases: [{
        ...ambiguousBookingCase,
        expected: {
          mustSay: [],
          allowedTools: [],
          dataToConfirm: ['Dienstag um zehn Uhr', 'Herrenschnitt'],
        },
      }],
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Passt, soll ich das so nehmen?',
        toolCalls: [],
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations).toContainEqual(
      expect.objectContaining({ kind: 'data_confirmation_missing', expected: 'Dienstag um zehn Uhr' }),
    );
  });

  it('fails when WER metric is over budget', async () => {
    const report = await evaluateBehaviorCases({
      cases: [{ ...ragConflictCase, metrics: { maxWer: 0.12 } }],
      knowledgeSnippets: { stale_pricing_100_free_minutes: 'Alter RAG-Schnipsel: 100 Freiminuten.' },
      model: async (): Promise<BehaviorModelOutput> => ({
        text: 'Aktuell sind es 30 Testminuten.',
        wer: 0.2,
        taskScore: 1,
      }),
    });

    expect(report.failed).toBe(1);
    expect(report.failures[0]?.violations).toContainEqual(
      expect.objectContaining({ kind: 'wer_over_budget' }),
    );
  });
});
