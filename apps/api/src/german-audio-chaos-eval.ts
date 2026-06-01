export type GermanAudioChaosClass =
  | 'dach_telephone_quality'
  | 'background_noise'
  | 'bluetooth_mic'
  | 'fast_speaker'
  | 'dialect_colloquial_german'
  | 'umlaut_asr_confusion'
  | 'interruption_during_confirmation'
  | 'number_time_email_correction'
  | 'caller_frustration';

export const REQUIRED_AUDIO_CHAOS_CLASSES: GermanAudioChaosClass[] = [
  'dach_telephone_quality',
  'background_noise',
  'bluetooth_mic',
  'fast_speaker',
  'dialect_colloquial_german',
  'umlaut_asr_confusion',
  'interruption_during_confirmation',
  'number_time_email_correction',
  'caller_frustration',
];

export type DachLanguageRegion = 'DE' | 'AT' | 'CH';

export type GermanAudioChaosEvalCase = {
  id: string;
  chaosClass: GermanAudioChaosClass;
  languageRegion: DachLanguageRegion;
  expectedTextCorrect: boolean;
  expectedAsrSuccess: boolean;
  expectedTtsSuccess: boolean;
  expectedRuntimeSuccess: boolean;
  textCorrectnessLabelRequired: boolean;
  asrSuccessLabelRequired: boolean;
  ttsSuccessLabelRequired: boolean;
  runtimeSuccessLabelRequired: boolean;
  latencyUnderChaosMs: number | null;
  examplesForLabeling: string[];
};

export type GermanAudioChaosEvalBlocker =
  | 'AUDIO_CHAOS_CLASS_MISSING'
  | 'DACH_REGION_COVERAGE_MISSING'
  | 'TEXT_CORRECTNESS_LABEL_MISSING'
  | 'ASR_SUCCESS_LABEL_MISSING'
  | 'TTS_SUCCESS_LABEL_MISSING'
  | 'RUNTIME_SUCCESS_LABEL_MISSING'
  | 'TEXT_CORRECT_VOICE_FAILED_CASE_MISSING'
  | 'NUMBER_TIME_EMAIL_ADDRESS_CORRECTION_COVERAGE_MISSING'
  | 'AUDIO_CHAOS_LATENCY_MISSING'
  | 'AUDIO_CHAOS_LABELING_EXAMPLES_MISSING';

export type GermanAudioChaosEvalCoverage = {
  caseCount: number;
  missingChaosClasses: GermanAudioChaosClass[];
  hasGermanAustrianSwissCoverage: boolean;
  hasTextCorrectButVoiceFailedCase: boolean;
};

export type GermanAudioChaosEvalReport = {
  ready: boolean;
  blockers: GermanAudioChaosEvalBlocker[];
  coverage: GermanAudioChaosEvalCoverage;
};

function add(blockers: GermanAudioChaosEvalBlocker[], condition: boolean, blocker: GermanAudioChaosEvalBlocker): void {
  if (condition && !blockers.includes(blocker)) blockers.push(blocker);
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function examplesContainCorrectionCoverage(examples: string[]): boolean {
  const joined = examples.join('\n').toLowerCase();
  return /zahl|nummer|telefon|phone/.test(joined) &&
    /zeit|uhr|time/.test(joined) &&
    /email|e-mail|mail/.test(joined) &&
    /adresse|address|strasse|straße/.test(joined);
}

export function validateGermanAudioChaosEvalSuite(
  cases: GermanAudioChaosEvalCase[],
): GermanAudioChaosEvalReport {
  const blockers: GermanAudioChaosEvalBlocker[] = [];
  const chaosClasses = new Set(cases.map((item) => item.chaosClass));
  const regions = new Set(cases.map((item) => item.languageRegion));
  const missingChaosClasses = REQUIRED_AUDIO_CHAOS_CLASSES.filter((chaosClass) => !chaosClasses.has(chaosClass));
  const hasGermanAustrianSwissCoverage = regions.has('DE') && regions.has('AT') && regions.has('CH');
  const hasTextCorrectButVoiceFailedCase = cases.some((item) =>
    item.expectedTextCorrect === true &&
    (item.expectedAsrSuccess === false || item.expectedTtsSuccess === false || item.expectedRuntimeSuccess === false));
  const correctionCase = cases.find((item) => item.chaosClass === 'number_time_email_correction');

  add(blockers, missingChaosClasses.length > 0, 'AUDIO_CHAOS_CLASS_MISSING');
  add(blockers, !hasGermanAustrianSwissCoverage, 'DACH_REGION_COVERAGE_MISSING');
  add(blockers, !hasTextCorrectButVoiceFailedCase, 'TEXT_CORRECT_VOICE_FAILED_CASE_MISSING');
  add(
    blockers,
    !correctionCase || !examplesContainCorrectionCoverage(correctionCase.examplesForLabeling),
    'NUMBER_TIME_EMAIL_ADDRESS_CORRECTION_COVERAGE_MISSING',
  );

  for (const item of cases) {
    add(blockers, item.textCorrectnessLabelRequired !== true, 'TEXT_CORRECTNESS_LABEL_MISSING');
    add(blockers, item.asrSuccessLabelRequired !== true, 'ASR_SUCCESS_LABEL_MISSING');
    add(blockers, item.ttsSuccessLabelRequired !== true, 'TTS_SUCCESS_LABEL_MISSING');
    add(blockers, item.runtimeSuccessLabelRequired !== true, 'RUNTIME_SUCCESS_LABEL_MISSING');
    add(
      blockers,
      item.latencyUnderChaosMs == null || !Number.isFinite(item.latencyUnderChaosMs) || item.latencyUnderChaosMs < 0,
      'AUDIO_CHAOS_LATENCY_MISSING',
    );
    add(blockers, !Array.isArray(item.examplesForLabeling) || !item.examplesForLabeling.some(hasText), 'AUDIO_CHAOS_LABELING_EXAMPLES_MISSING');
  }

  return {
    ready: blockers.length === 0,
    blockers,
    coverage: {
      caseCount: cases.length,
      missingChaosClasses,
      hasGermanAustrianSwissCoverage,
      hasTextCorrectButVoiceFailedCase,
    },
  };
}
