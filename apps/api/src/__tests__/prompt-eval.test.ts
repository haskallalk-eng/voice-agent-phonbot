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

const { buildPromptConversationFlowScenarios, buildPromptEvalCases, buildPromptLiveCallScenarios, buildPromptQaReport } = await import('../prompt-eval.js');
const { DEMO_END_INSTRUCTIONS, DEMO_SAFETY_OVERLAY, DEFAULT_SALES_PROMPT, ensurePhonbotProductFacts } = await import('../demo.js');
const { OUTBOUND_BASELINE_PROMPT, ensureOutboundSafetyKernel } = await import('../outbound-baseline.js');
const { ensurePlatformSafetyKernel } = await import('../platform-baseline.js');
const { TEMPLATES } = await import('../templates.js');

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
    expect(buildPromptConversationFlowScenarios().length).toBeGreaterThanOrEqual(1000);
    expect(report.liveCallDryRun.totalRuns).toBeGreaterThanOrEqual(10000);
    expect(report.conversationFlowDryRun.totalRuns).toBeGreaterThanOrEqual(1000);
    expect(report.liveCallDryRun.actualCallsPlaced).toBe(0);
    expect(report.dryRunOnly).toBe(true);
    expect(report.liveModelSimulation).toBe('not_run');
    expect(report.adversarialLoop.targetConfidencePercent).toBe(98);
    expect(report.adversarialLoop.releaseRecommendation).toBe('red');
    expect(report.adversarialLoop.criticalGates.find((gate) => gate.id === 'real_livecall_gap')).toMatchObject({
      status: 'red',
      redIfMissing: true,
    });
    expect(report.adversarialLoop.confidenceMeaning).toContain('Unabhaengige echte Behavior-/Live-Runs: 0');
    expect(report.adversarialLoop.criticalGates.map((gate) => gate.id)).toEqual(expect.arrayContaining([
      'privacy_p0_coverage',
      'emergency_p0_coverage',
      'consent_p0_coverage',
      'tool_side_effect_p0_coverage',
      'identity_boundary_p0_coverage',
      'barge_in_p0_coverage',
      'memory_integrity_p0_coverage',
    ]));
    expect(report.simulationAgents.map((agent) => agent.name)).toEqual(
      expect.arrayContaining([
        'Prompt-Architekt',
        'Latenz-Optimierer',
        'STT-Tester',
        'TTS-Tester',
        'Tool- und E2E-Tester',
        'Privacy-Tester',
        'Loesungs-Orchestrator',
        'Gespraechsfluss-Reviewer',
        'QA-Loop-Optimizer',
        'Criticality-Auditor',
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
    expect(DEMO_END_INSTRUCTIONS).toContain('Hi, mein Name ist Chipy. Mit wem spreche ich?');
    expect(DEMO_END_INSTRUCTIONS).toContain('Dieses Gespraech wird zur Qualitaetssicherung gespeichert');
    expect(DEMO_END_INSTRUCTIONS).toContain('Ein Geschaeft, das um 18 Uhr schliesst, kann keinen Termin um 18 Uhr starten');
    expect(DEMO_END_INSTRUCTIONS).toContain('Demo-Terminbestaetigung');
    expect(DEMO_END_INSTRUCTIONS).toContain('Vermische diese beiden Preiswelten nie');
    expect(failures.some((failure) => failure.ruleId === 'demo-layered-entry')).toBe(false);
    expect(failures.some((failure) => failure.ruleId === 'phonbot-questions-answer-all')).toBe(false);
    expect(failures.some((failure) => failure.ruleId === 'past-date-block')).toBe(false);
    expect(failures.some((failure) => failure.ruleId === 'demo-simulation-labels')).toBe(false);
    expect(DEMO_END_INSTRUCTIONS).toContain('recording_declined');
    expect(DEMO_SAFETY_OVERLAY).toContain('simuliere die Weiterleitung');
  });

  it('keeps curated demo templates supplied with safe demo standard prices', () => {
    const pricedTemplates = ['hairdresser', 'tradesperson', 'cleaning', 'restaurant', 'auto', 'solo'];

    for (const id of pricedTemplates) {
      const template = TEMPLATES.find((item) => item.id === id);
      expect(template?.prompt).toContain('Demo-Standardpreise');
      expect(template?.prompt).toMatch(/Euro/i);
    }
  });

  it('keeps the sales callback prompt on current test-minutes and verified link delivery', () => {
    expect(DEFAULT_SALES_PROMPT).toContain('30 Testminuten');
    expect(DEFAULT_SALES_PROMPT).toContain('Starter: 89 Euro pro Monat, 300 Minuten');
    expect(DEFAULT_SALES_PROMPT).toContain('Professional: 179 Euro pro Monat, 900 Minuten');
    expect(DEFAULT_SALES_PROMPT).toContain('Agency: 349 Euro pro Monat, 2.000 Minuten');
    expect(DEFAULT_SALES_PROMPT).toContain('signup_email_sent');
    expect(DEFAULT_SALES_PROMPT).toContain('Niemals "100 Freiminuten"');
  });

  it('evaluates sales callback as outbound baseline plus sales prompt', () => {
    const outboundPrompt = ensureOutboundSafetyKernel(OUTBOUND_BASELINE_PROMPT);
    const salesPrompt = `${outboundPrompt}\n\n${ensurePhonbotProductFacts(DEFAULT_SALES_PROMPT)}`;
    const report = buildPromptQaReport({
      sources: [{ id: 'sales-callback', label: 'Sales callback', kind: 'sales', prompt: salesPrompt }],
      model: 'gpt-4o-mini',
    });
    const result = report.sources[0];

    expect(result?.score).toBe(100);
    expect(result?.criticalFailures).toBe(0);
    expect(result?.failures.some((failure) => failure.ruleId === 'spoken-time-normalization')).toBe(false);
    expect(result?.failures.some((failure) => failure.ruleId === 'customer-lookup-identity')).toBe(false);
  });

  it('surfaces latency optimizer advice even when latency is size-based', () => {
    const report = buildPromptQaReport({
      sources: [{ id: 'oversized', label: 'Oversized prompt', kind: 'platform', prompt: 'x'.repeat(36_500) }],
      model: 'gpt-4o-mini',
    });
    const result = report.sources[0];

    expect(result?.latencyRisk).toBe('high');
    expect(result?.promptOptimizations.some((item) => item.includes('Latenz-Optimierer'))).toBe(true);
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
    expect(hardened).toContain('Gespraechsfluss und Kontext');
    expect(hardened).toContain('Memory und Zustimmung');
    expect(hardened).toContain('09:00 -> "neun Uhr"');
    expect(hardened).toContain('10:05 -> "zehn Uhr null fuenf"');
    expect(hardened).toContain('Mo-Fr -> "Montag bis Freitag"');
    expect(hardened).toContain('Di-Sa -> "Dienstag bis Samstag"');
    expect(hardened).toContain('customer lookup');
    expect(hardened).toContain('Identitaetsmerkmale');
    expect(hardened).toContain('aehnlichen/ungefaehren/fuzzy');

    const report = buildPromptQaReport({
      sources: [{ id: 'platform', label: 'Platform', kind: 'platform', prompt: hardened }],
      model: 'gpt-4o-mini',
    });
    expect(report.sources[0]?.failures.some((failure) => failure.ruleId === 'spoken-weekday-normalization')).toBe(false);
  });

  it('rehardens marker-bearing platform overrides when newer identity rules are missing', () => {
    const staleMarkedOverride = [
      '## HARD SAFETY KERNEL',
      '13. Gespraechsfluss und Kontext: alter Text.',
      '18. Memory und Zustimmung muessen belegt sein: alter Text.',
      '',
      'Alter Admin-Override ohne Kundensuche-Regel.',
    ].join('\n');
    const hardened = ensurePlatformSafetyKernel(staleMarkedOverride);

    expect(hardened.indexOf('Kundensuche / customer lookup')).toBeLessThan(hardened.indexOf('Alter Admin-Override'));
    expect(hardened).toContain('Identitaetsmerkmale');
    expect(hardened).toContain('aehnlichen/ungefaehren/fuzzy');
  });

  it('prepends the outbound flow kernel to stale outbound admin overrides', () => {
    const staleOutboundOverride = '# Outbound-Mindeststandard\n\nNur alter Outbound-Text.';
    const hardened = ensureOutboundSafetyKernel(staleOutboundOverride);

    expect(hardened).toContain('## Outbound-Gespraechsfluss-Kernel');
    expect(hardened).toContain('Zielwechsel');
    expect(hardened).toContain('unklare Zustimmung');
    expect(hardened).toContain('Memory und Zustimmung');
    expect(hardened).toContain('09:00 -> "neun Uhr"');
    expect(hardened).toContain('10:05 -> "zehn Uhr null fuenf"');
  });

  it('rehardens marker-bearing outbound overrides when newer tool/time rules are missing', () => {
    const staleMarkedOutbound = [
      '## Outbound-Gespraechsfluss-Kernel',
      '- Memory und Zustimmung muessen belegt sein.',
      '',
      'Alter Outbound-Override ohne neue Tool- und Uhrzeitregeln.',
    ].join('\n');
    const hardened = ensureOutboundSafetyKernel(staleMarkedOutbound);

    expect(hardened.indexOf('Uhrzeiten und Datum sprechsicher')).toBeLessThan(hardened.indexOf('Alter Outbound-Override'));
    expect(hardened).toContain('Tool-Fehler, Timeout');
    expect(hardened).toContain('Prompt-Injection');
  });
});
