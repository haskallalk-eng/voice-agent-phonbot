export type KbRedTeamFixtureClass =
  | 'html_hidden_text'
  | 'pdf_metadata'
  | 'markdown_instruction_block'
  | 'base64_unicode_smuggling'
  | 'tool_policy_override'
  | 'cross_tenant_bait'
  | 'multilingual_injection';

export const REQUIRED_KB_REDTEAM_CLASSES: KbRedTeamFixtureClass[] = [
  'html_hidden_text',
  'pdf_metadata',
  'markdown_instruction_block',
  'base64_unicode_smuggling',
  'tool_policy_override',
  'cross_tenant_bait',
  'multilingual_injection',
];

export type KbRedTeamLanguageClass = 'de' | 'en' | 'tr' | 'ar' | 'mixed';

export const REQUIRED_KB_REDTEAM_LANGUAGE_CLASSES: KbRedTeamLanguageClass[] = [
  'de',
  'en',
  'tr',
  'ar',
  'mixed',
];

export type KbRedTeamSourceKind = 'html' | 'pdf' | 'markdown' | 'text' | 'metadata';

export type KbRedTeamDisposition =
  | 'safe_fact'
  | 'excluded_injection'
  | 'needs_human_review'
  | 'reject_source';

export type KbIngestionRedTeamFixture = {
  id: string;
  fixtureClass: KbRedTeamFixtureClass;
  languageClass: KbRedTeamLanguageClass;
  sourceKind: KbRedTeamSourceKind;
  content: string;
  expectedDisposition: KbRedTeamDisposition;
  expectedSafeFactUsable: boolean;
  mustLogInjectionAttempt: boolean;
  mustExcludeFromPromptInstructions: boolean;
  mustPreserveExcludedEvidenceSummary: boolean;
  mustNotAuthorizeMutation: boolean;
  mustNotChangeScope: boolean;
  mustNotChangeProviderConfig: boolean;
  mustNotRequestSecrets: boolean;
};

export type KbIngestionRedTeamBlocker =
  | 'KB_REDTEAM_FIXTURE_CLASS_MISSING'
  | 'KB_REDTEAM_LANGUAGE_CLASS_MISSING'
  | 'KB_REDTEAM_FIXTURE_REQUIRED_FIELD_MISSING'
  | 'KB_INJECTION_ATTEMPT_NOT_LOGGED'
  | 'KB_INJECTION_CAN_ENTER_PROMPT_INSTRUCTIONS'
  | 'KB_EXCLUDED_EVIDENCE_SUMMARY_MISSING'
  | 'KB_INJECTION_CAN_AUTHORIZE_MUTATION'
  | 'KB_INJECTION_CAN_CHANGE_SCOPE'
  | 'KB_INJECTION_CAN_CHANGE_PROVIDER_CONFIG'
  | 'KB_INJECTION_CAN_REQUEST_SECRETS'
  | 'CROSS_TENANT_BAIT_NOT_REJECTED'
  | 'SAFE_FACT_ADJACENT_INJECTION_CASE_MISSING';

export type KbIngestionRedTeamCoverage = {
  fixtureCount: number;
  missingFixtureClasses: KbRedTeamFixtureClass[];
  missingLanguageClasses: KbRedTeamLanguageClass[];
  hasSafeFactAdjacentInjection: boolean;
};

export type KbIngestionRedTeamReport = {
  ready: boolean;
  blockers: KbIngestionRedTeamBlocker[];
  coverage: KbIngestionRedTeamCoverage;
};

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function add(blockers: KbIngestionRedTeamBlocker[], condition: boolean, blocker: KbIngestionRedTeamBlocker): void {
  if (condition && !blockers.includes(blocker)) blockers.push(blocker);
}

function dispositionRejectsOrExcludes(disposition: KbRedTeamDisposition): boolean {
  return disposition === 'excluded_injection' ||
    disposition === 'needs_human_review' ||
    disposition === 'reject_source';
}

function looksLikeAdjacentSafeFact(fixture: KbIngestionRedTeamFixture): boolean {
  return fixture.expectedDisposition === 'safe_fact' &&
    fixture.expectedSafeFactUsable === true &&
    /fakt|fact|quelle|source/i.test(fixture.content) &&
    /ignore|ignoriere|system|developer|regel|instruction|anweisung/i.test(fixture.content);
}

export function validateKbIngestionRedTeamSuite(
  fixtures: KbIngestionRedTeamFixture[],
): KbIngestionRedTeamReport {
  const blockers: KbIngestionRedTeamBlocker[] = [];
  const fixtureClasses = new Set(fixtures.map((fixture) => fixture.fixtureClass));
  const languageClasses = new Set(fixtures.map((fixture) => fixture.languageClass));
  const missingFixtureClasses = REQUIRED_KB_REDTEAM_CLASSES.filter((fixtureClass) => !fixtureClasses.has(fixtureClass));
  const missingLanguageClasses = REQUIRED_KB_REDTEAM_LANGUAGE_CLASSES.filter((languageClass) => !languageClasses.has(languageClass));
  const hasSafeFactAdjacentInjection = fixtures.some(looksLikeAdjacentSafeFact);

  add(blockers, missingFixtureClasses.length > 0, 'KB_REDTEAM_FIXTURE_CLASS_MISSING');
  add(blockers, missingLanguageClasses.length > 0, 'KB_REDTEAM_LANGUAGE_CLASS_MISSING');
  add(blockers, !hasSafeFactAdjacentInjection, 'SAFE_FACT_ADJACENT_INJECTION_CASE_MISSING');

  for (const fixture of fixtures) {
    add(
      blockers,
      !hasText(fixture.id) ||
        !hasText(fixture.content) ||
        !hasText(fixture.sourceKind) ||
        !hasText(fixture.expectedDisposition),
      'KB_REDTEAM_FIXTURE_REQUIRED_FIELD_MISSING',
    );

    if (fixture.expectedDisposition !== 'safe_fact') {
      add(blockers, fixture.mustLogInjectionAttempt !== true, 'KB_INJECTION_ATTEMPT_NOT_LOGGED');
      add(blockers, fixture.mustExcludeFromPromptInstructions !== true, 'KB_INJECTION_CAN_ENTER_PROMPT_INSTRUCTIONS');
      add(blockers, fixture.mustPreserveExcludedEvidenceSummary !== true, 'KB_EXCLUDED_EVIDENCE_SUMMARY_MISSING');
    }

    add(blockers, fixture.mustNotAuthorizeMutation !== true, 'KB_INJECTION_CAN_AUTHORIZE_MUTATION');
    add(blockers, fixture.mustNotChangeScope !== true, 'KB_INJECTION_CAN_CHANGE_SCOPE');
    add(blockers, fixture.mustNotChangeProviderConfig !== true, 'KB_INJECTION_CAN_CHANGE_PROVIDER_CONFIG');
    add(blockers, fixture.mustNotRequestSecrets !== true, 'KB_INJECTION_CAN_REQUEST_SECRETS');

    add(
      blockers,
      fixture.fixtureClass === 'cross_tenant_bait' &&
        (!dispositionRejectsOrExcludes(fixture.expectedDisposition) ||
          fixture.expectedSafeFactUsable ||
          fixture.mustNotChangeScope !== true),
      'CROSS_TENANT_BAIT_NOT_REJECTED',
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
    coverage: {
      fixtureCount: fixtures.length,
      missingFixtureClasses,
      missingLanguageClasses,
      hasSafeFactAdjacentInjection,
    },
  };
}
