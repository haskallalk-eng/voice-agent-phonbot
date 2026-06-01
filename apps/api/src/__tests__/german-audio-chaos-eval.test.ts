import { describe, expect, it } from 'vitest';
import {
  REQUIRED_AUDIO_CHAOS_CLASSES,
  validateGermanAudioChaosEvalSuite,
  type GermanAudioChaosEvalCase,
} from '../german-audio-chaos-eval.js';

function chaosCase(
  chaosClass: GermanAudioChaosEvalCase['chaosClass'],
  overrides: Partial<GermanAudioChaosEvalCase> = {},
): GermanAudioChaosEvalCase {
  return {
    id: `${chaosClass}-case`,
    chaosClass,
    languageRegion: 'DE',
    expectedTextCorrect: true,
    expectedAsrSuccess: true,
    expectedTtsSuccess: true,
    expectedRuntimeSuccess: true,
    textCorrectnessLabelRequired: true,
    asrSuccessLabelRequired: true,
    ttsSuccessLabelRequired: true,
    runtimeSuccessLabelRequired: true,
    latencyUnderChaosMs: 650,
    examplesForLabeling: [`Example for ${chaosClass}`],
    ...overrides,
  };
}

function completeSuite(): GermanAudioChaosEvalCase[] {
  const cases = REQUIRED_AUDIO_CHAOS_CLASSES.map((chaosClass) => chaosCase(chaosClass, chaosClass === 'number_time_email_correction'
    ? {
      examplesForLabeling: [
        'Caller corrects phone number, time, email, and address: 0176..., neun Uhr, max@example.de, Hauptstrasse 4.',
      ],
    }
    : {}));
  cases.push(
    chaosCase('dialect_colloquial_german', {
      id: 'austrian-phrase',
      languageRegion: 'AT',
      examplesForLabeling: ['Passt des morgen um hoibe zehn?'],
    }),
    chaosCase('dialect_colloquial_german', {
      id: 'swiss-phrase',
      languageRegion: 'CH',
      examplesForLabeling: ['Händ Sie morn am nüni offen?'],
    }),
    chaosCase('background_noise', {
      id: 'text-correct-asr-fails',
      expectedTextCorrect: true,
      expectedAsrSuccess: false,
      expectedTtsSuccess: true,
      expectedRuntimeSuccess: true,
      examplesForLabeling: ['Answer text is right, but ASR misunderstood the caller number.'],
    }),
  );
  return cases;
}

describe('German audio chaos eval suite contract', () => {
  it('accepts a complete suite with separate text, ASR, TTS, and runtime labels', () => {
    const report = validateGermanAudioChaosEvalSuite(completeSuite());

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.coverage.missingChaosClasses).toEqual([]);
    expect(report.coverage.hasGermanAustrianSwissCoverage).toBe(true);
    expect(report.coverage.hasTextCorrectButVoiceFailedCase).toBe(true);
  });

  it('requires every planned chaos class and DACH region coverage', () => {
    const report = validateGermanAudioChaosEvalSuite([
      chaosCase('dach_telephone_quality', { languageRegion: 'DE' }),
    ]);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('AUDIO_CHAOS_CLASS_MISSING');
    expect(report.blockers).toContain('DACH_REGION_COVERAGE_MISSING');
  });

  it('requires labels that distinguish text correctness from ASR, TTS, and runtime success', () => {
    const broken = completeSuite();
    broken[0] = {
      ...broken[0]!,
      textCorrectnessLabelRequired: false,
      asrSuccessLabelRequired: false,
      ttsSuccessLabelRequired: false,
      runtimeSuccessLabelRequired: false,
    };

    const report = validateGermanAudioChaosEvalSuite(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TEXT_CORRECTNESS_LABEL_MISSING');
    expect(report.blockers).toContain('ASR_SUCCESS_LABEL_MISSING');
    expect(report.blockers).toContain('TTS_SUCCESS_LABEL_MISSING');
    expect(report.blockers).toContain('RUNTIME_SUCCESS_LABEL_MISSING');
  });

  it('requires at least one case where text is correct but voice pipeline fails', () => {
    const noSplitFailure = completeSuite().filter((item) => item.id !== 'text-correct-asr-fails');

    const report = validateGermanAudioChaosEvalSuite(noSplitFailure);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('TEXT_CORRECT_VOICE_FAILED_CASE_MISSING');
  });

  it('requires number, time, email, and address correction examples', () => {
    const broken = completeSuite().map((item) => item.chaosClass === 'number_time_email_correction'
      ? {
        ...item,
        examplesForLabeling: ['Der Nutzer korrigiert nur die Uhrzeit.'],
      }
      : item);

    const report = validateGermanAudioChaosEvalSuite(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('NUMBER_TIME_EMAIL_ADDRESS_CORRECTION_COVERAGE_MISSING');
  });

  it('requires latency under chaos to be finite and reported', () => {
    const broken = completeSuite();
    broken[0] = {
      ...broken[0]!,
      latencyUnderChaosMs: null,
    };

    const report = validateGermanAudioChaosEvalSuite(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('AUDIO_CHAOS_LATENCY_MISSING');
  });
});
