import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  pool: null,
}));

vi.mock('../redis.js', () => ({
  redis: null,
}));

vi.mock('../logger.js', () => {
  const noop = () => {};
  return {
    log: { info: noop, warn: noop, error: noop, debug: noop },
    logBg: () => noop,
  };
});

const { buildPromptEvalCases, buildPromptLiveCallScenarios, buildPromptQaReport } = await import('../prompt-eval.js');
const { DEMO_END_INSTRUCTIONS, DEMO_SAFETY_OVERLAY, DEFAULT_SALES_PROMPT, ensurePhonbotProductFacts } = await import('../demo.js');
const { ensurePlatformSafetyKernel } = await import('../platform-baseline.js');

describe('prompt eval dry-run harness', () => {
  it('builds at least 1000 dry-run prompt/function cases with specialized simulation agents', () => {
    const cases = buildPromptEvalCases();
    const report = buildPromptQaReport({
      sources: [
        {
          id: 'demo-test',
          label: 'Demo test',
          kind: 'demo',
          prompt: `${DEMO_END_INSTRUCTIONS}${DEMO_SAFETY_OVERLAY}`,
        },
      ],
      model: 'gpt-4o-mini',
    });

    expect(cases.length).toBeGreaterThanOrEqual(1000);
    expect(report.caseBank.totalCases).toBe(cases.length);
    expect(buildPromptLiveCallScenarios().length).toBeGreaterThanOrEqual(10000);
    expect(report.liveCallDryRun.totalRuns).toBeGreaterThanOrEqual(10000);
    expect(report.liveCallDryRun.actualCallsPlaced).toBe(0);
    expect(report.dryRunOnly).toBe(true);
    expect(report.liveModelSimulation).toBe('not_run');
    expect(report.simulationAgents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining([
        'Prompt-Architekt',
        'Latenz-Optimierer',
        'STT-Tester',
        'TTS-Tester',
        'Tool- und E2E-Tester',
        'Privacy-Tester',
        'Loesungs-Orchestrator',
      ]),
    );
  });

  it('keeps the website demo layered between demo simulation and Phonbot questions', () => {
    const report = buildPromptQaReport({
      sources: [
        {
          id: 'demo-test',
          label: 'Demo test',
          kind: 'demo',
          prompt: `${DEMO_END_INSTRUCTIONS}${DEMO_SAFETY_OVERLAY}`,
        },
      ],
      model: 'gpt-4o-mini',
    });
    const failures = report.sources[0]?.failures ?? [];

    expect(DEMO_END_INSTRUCTIONS).toContain('Demo simulieren');
    expect(DEMO_END_INSTRUCTIONS).toContain('Fragen zu Phonbot beantworten');
    expect(failures.some((failure) => failure.ruleId === 'demo-layered-entry')).toBe(false);
    expect(failures.some((failure) => failure.ruleId === 'phonbot-questions-answer-all')).toBe(false);
    expect(failures.some((failure) => failure.ruleId === 'past-date-block')).toBe(false);
    expect(failures.some((failure) => failure.ruleId === 'demo-simulation-labels')).toBe(false);
    expect(DEMO_END_INSTRUCTIONS).toContain('recording_declined');
    expect(DEMO_SAFETY_OVERLAY).toContain('simuliere die Weiterleitung');
  });

  it('keeps the sales callback prompt on current test-minutes and verified link delivery', () => {
    expect(DEFAULT_SALES_PROMPT).toContain('30 Testminuten');
    expect(DEFAULT_SALES_PROMPT).toContain('Starter: 89 Euro pro Monat, 300 Minuten');
    expect(DEFAULT_SALES_PROMPT).toContain('Professional: 179 Euro pro Monat, 900 Minuten');
    expect(DEFAULT_SALES_PROMPT).toContain('Agency: 349 Euro pro Monat, 2.000 Minuten');
    expect(DEFAULT_SALES_PROMPT).toContain('signup_email_sent');
    expect(DEFAULT_SALES_PROMPT).toContain('Niemals "100 Freiminuten"');
  });

  it('hardens stale admin demo and sales overrides with current Phonbot numbers', () => {
    const stale = 'Alter Prompt: Sage 100 Freiminuten und dann weiter.';
    const hardened = ensurePhonbotProductFacts(stale);

    expect(hardened).toContain('30 einmalige Testminuten');
    expect(hardened).toContain('Nummer: 8,99 Euro pro Monat, 70 Minuten');
    expect(hardened).toContain('Starter: 89 Euro pro Monat, 300 Minuten');
    expect(hardened).toContain('Professional: 179 Euro pro Monat, 900 Minuten');
    expect(hardened).toContain('Agency: 349 Euro pro Monat, 2.000 Minuten');
    expect(hardened).toContain('Niemals "100 Freiminuten"');
  });

  it('prepends the hard safety kernel to stale admin platform overrides', () => {
    const staleAdminOverride = '# Plattform-Mindeststandard\n\nNur alter Admin-Text.';
    const hardened = ensurePlatformSafetyKernel(staleAdminOverride);

    expect(hardened).toContain('## HARD SAFETY KERNEL');
    expect(hardened.indexOf('## HARD SAFETY KERNEL')).toBeLessThan(hardened.indexOf('Nur alter Admin-Text'));
    expect(hardened).toContain('confirmed=true');
    expect(hardened).toContain('Nie vergangene Termine');
  });
});
