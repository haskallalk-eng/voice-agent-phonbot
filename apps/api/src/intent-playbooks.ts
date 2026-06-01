export type IntentRiskClass = 'low' | 'medium' | 'high' | 'pricing' | 'legal' | 'policy';

export type IntentKind =
  | 'low_risk_faq'
  | 'high_risk_pricing_legal_policy'
  | 'booking_mutation'
  | 'escalation'
  | 'out_of_scope';

export type IntentConfirmationRequirement =
  | 'none'
  | 'confirmed_summary_before_tool'
  | 'policy_confirmation_before_answer'
  | 'human_handoff_required';

export type GermanAsrVariantKind =
  | 'colloquial'
  | 'misspelling'
  | 'compound_word'
  | 'umlaut_confusion'
  | 'number_time'
  | 'service_name';

export type GermanAsrVariant = {
  kind: GermanAsrVariantKind;
  value: string;
};

export type IntentPlaybookTool =
  | 'none'
  | 'knowledge.search'
  | 'calendar_find_slots'
  | 'calendar_book'
  | 'calendar_find_bookings'
  | 'calendar_cancel'
  | 'calendar_reschedule'
  | 'customer_lookup'
  | 'customer_upsert'
  | 'customer_delete'
  | 'ticket_create'
  | 'end_call'
  | 'transfer_call';

export type IntentPlaybook = {
  intentId: string;
  version: string;
  riskClass: IntentRiskClass;
  intentKind: IntentKind;
  goal: string;
  successCriteria: string[];
  requiredFields: string[];
  allowedQuestions: string[];
  allowedTools: IntentPlaybookTool[];
  confirmationRequirement: IntentConfirmationRequirement;
  escalationCriteria: string[];
  forbiddenClaims: string[];
  goldStandardVoiceAnswers: string[];
  germanAsrVariants: GermanAsrVariant[];
};

export type IntentPlaybookBlocker =
  | 'INSUFFICIENT_TOP_INTENT_PLAYBOOKS'
  | 'INSUFFICIENT_UNIQUE_INTENTS'
  | 'MISSING_LOW_RISK_FAQ_PLAYBOOK'
  | 'MISSING_HIGH_RISK_PLAYBOOK'
  | 'MISSING_PRICING_RISK_PLAYBOOK'
  | 'MISSING_LEGAL_RISK_PLAYBOOK'
  | 'MISSING_POLICY_RISK_PLAYBOOK'
  | 'MISSING_BOOKING_MUTATION_PLAYBOOK'
  | 'MISSING_ESCALATION_PLAYBOOK'
  | 'MISSING_OUT_OF_SCOPE_PLAYBOOK'
  | 'PLAYBOOK_REQUIRED_FIELD_MISSING'
  | 'PLAYBOOK_REQUIRED_FIELDS_MISSING'
  | 'PLAYBOOK_ALLOWED_TOOLS_MISSING'
  | 'PLAYBOOK_ALLOWED_TOOL_UNKNOWN'
  | 'PLAYBOOK_NONE_TOOL_MIXED_WITH_REAL_TOOLS'
  | 'GERMAN_ASR_VARIANTS_MISSING'
  | 'GERMAN_ASR_VARIANT_CLASS_COVERAGE_MISSING'
  | 'MUTATION_PLAYBOOK_REQUIRES_CONFIRMATION'
  | 'GOLD_VOICE_ANSWER_COUNT_INVALID'
  | 'GOLD_VOICE_ANSWER_TOO_LONG'
  | 'GOLD_VOICE_ANSWER_WRITTEN_STYLE'
  | 'PLAYBOOK_SYNTHETIC_MARKER_PRESENT'
  | 'PLAYBOOK_DRAFT_MARKER_PRESENT'
  | 'PLAYBOOK_PROMOTION_MARKER_PRESENT'
  | 'PLAYBOOK_PLACEHOLDER_CONTENT';

export type IntentPlaybookCoverage = {
  playbookCount: number;
  uniqueIntentCount: number;
  hasLowRiskFaq: boolean;
  hasHighRiskPricingLegalPolicy: boolean;
  hasPricingRisk: boolean;
  hasLegalRisk: boolean;
  hasPolicyRisk: boolean;
  hasBookingMutation: boolean;
  hasEscalation: boolean;
  hasOutOfScope: boolean;
};

export type IntentPlaybookValidationReport = {
  ready: boolean;
  blockers: IntentPlaybookBlocker[];
  coverage: IntentPlaybookCoverage;
};

const TOOL_REGISTRY = {
  none: { mutates: false },
  'knowledge.search': { mutates: false },
  calendar_find_slots: { mutates: false },
  calendar_book: { mutates: true },
  calendar_find_bookings: { mutates: false },
  calendar_cancel: { mutates: true },
  calendar_reschedule: { mutates: true },
  customer_lookup: { mutates: false },
  customer_upsert: { mutates: true },
  customer_delete: { mutates: true },
  ticket_create: { mutates: true },
  end_call: { mutates: false },
  transfer_call: { mutates: false },
} satisfies Record<IntentPlaybookTool, { mutates: boolean }>;
const REQUIRED_ASR_VARIANT_KINDS = new Set<GermanAsrVariantKind>([
  'colloquial',
  'misspelling',
  'compound_word',
  'umlaut_confusion',
  'number_time',
  'service_name',
]);

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasItems(values: string[]): boolean {
  return Array.isArray(values) && values.some(hasText);
}

function hasAsrVariants(values: GermanAsrVariant[]): boolean {
  return Array.isArray(values) && values.some((item) => hasText(item.value));
}

function hasRequiredAsrVariantKinds(values: GermanAsrVariant[]): boolean {
  if (!Array.isArray(values)) return false;
  const present = new Set(
    values
      .filter((item) => REQUIRED_ASR_VARIANT_KINDS.has(item.kind) && hasText(item.value))
      .map((item) => item.kind),
  );
  return [...REQUIRED_ASR_VARIANT_KINDS].every((kind) => present.has(kind));
}

function add(blockers: IntentPlaybookBlocker[], condition: boolean, blocker: IntentPlaybookBlocker): void {
  if (condition && !blockers.includes(blocker)) blockers.push(blocker);
}

function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
}

function voiceAnswerTooLong(answer: string): boolean {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  return words.length > 22 || sentenceCount(answer) > 2;
}

function writtenStyleAnswer(answer: string): boolean {
  return /https?:\/\/|www\.|quelle:|citation|siehe oben|\[[0-9]+\]/i.test(answer);
}

function placeholderText(value: string): boolean {
  const normalized = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\./g, ' ')
    .toLowerCase();
  return /\b(todo|tbd|platzhalter|placeholder|template|draft|synthetic|promotion evidence usable|fill this|dummy|example invalid)\b/i
    .test(normalized);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function containsDraftMarker(playbook: IntentPlaybook): boolean {
  return asRecord(playbook).approvedForMilestone === 'DRAFT_ONLY';
}

function containsSyntheticMarker(playbook: IntentPlaybook): boolean {
  return asRecord(playbook).syntheticOnly === true;
}

function containsPromotionMarker(playbook: IntentPlaybook): boolean {
  return asRecord(playbook).promotionEvidenceUsable === true;
}

function playbookContainsPlaceholder(playbook: IntentPlaybook): boolean {
  return [
    playbook.intentId,
    playbook.version,
    playbook.goal,
    ...playbook.successCriteria,
    ...playbook.requiredFields,
    ...playbook.allowedQuestions,
    ...playbook.escalationCriteria,
    ...playbook.forbiddenClaims,
    ...playbook.goldStandardVoiceAnswers,
    ...playbook.germanAsrVariants.map((item) => item.value),
  ].some(placeholderText);
}

function playbookHasMutatingTool(playbook: IntentPlaybook): boolean {
  return playbook.intentKind === 'booking_mutation' ||
    playbook.allowedTools.some((tool) => TOOL_REGISTRY[tool]?.mutates === true);
}

function hasUnknownAllowedTool(playbook: IntentPlaybook): boolean {
  return playbook.allowedTools.some((tool) => !(tool in TOOL_REGISTRY));
}

function hasAmbiguousNoneTool(playbook: IntentPlaybook): boolean {
  return playbook.allowedTools.includes('none') && playbook.allowedTools.length > 1;
}

export function validateIntentPlaybookPack(playbooks: IntentPlaybook[]): IntentPlaybookValidationReport {
  const blockers: IntentPlaybookBlocker[] = [];
  const uniqueIntentIds = new Set(playbooks.map((item) => item.intentId.trim()).filter(Boolean));
  const intentKinds = new Set(playbooks.map((item) => item.intentKind));
  const riskClasses = new Set(playbooks.map((item) => item.riskClass));
  const coverage: IntentPlaybookCoverage = {
    playbookCount: playbooks.length,
    uniqueIntentCount: uniqueIntentIds.size,
    hasLowRiskFaq: intentKinds.has('low_risk_faq'),
    hasHighRiskPricingLegalPolicy: intentKinds.has('high_risk_pricing_legal_policy'),
    hasPricingRisk: riskClasses.has('pricing'),
    hasLegalRisk: riskClasses.has('legal'),
    hasPolicyRisk: riskClasses.has('policy'),
    hasBookingMutation: intentKinds.has('booking_mutation'),
    hasEscalation: intentKinds.has('escalation'),
    hasOutOfScope: intentKinds.has('out_of_scope'),
  };

  add(blockers, coverage.playbookCount < 30, 'INSUFFICIENT_TOP_INTENT_PLAYBOOKS');
  add(blockers, coverage.uniqueIntentCount < 30, 'INSUFFICIENT_UNIQUE_INTENTS');
  add(blockers, !coverage.hasLowRiskFaq, 'MISSING_LOW_RISK_FAQ_PLAYBOOK');
  add(blockers, !coverage.hasHighRiskPricingLegalPolicy, 'MISSING_HIGH_RISK_PLAYBOOK');
  add(blockers, !coverage.hasPricingRisk, 'MISSING_PRICING_RISK_PLAYBOOK');
  add(blockers, !coverage.hasLegalRisk, 'MISSING_LEGAL_RISK_PLAYBOOK');
  add(blockers, !coverage.hasPolicyRisk, 'MISSING_POLICY_RISK_PLAYBOOK');
  add(blockers, !coverage.hasBookingMutation, 'MISSING_BOOKING_MUTATION_PLAYBOOK');
  add(blockers, !coverage.hasEscalation, 'MISSING_ESCALATION_PLAYBOOK');
  add(blockers, !coverage.hasOutOfScope, 'MISSING_OUT_OF_SCOPE_PLAYBOOK');

  for (const playbook of playbooks) {
    add(blockers, containsSyntheticMarker(playbook), 'PLAYBOOK_SYNTHETIC_MARKER_PRESENT');
    add(blockers, containsDraftMarker(playbook), 'PLAYBOOK_DRAFT_MARKER_PRESENT');
    add(blockers, containsPromotionMarker(playbook), 'PLAYBOOK_PROMOTION_MARKER_PRESENT');
    add(blockers, playbookContainsPlaceholder(playbook), 'PLAYBOOK_PLACEHOLDER_CONTENT');
    add(
      blockers,
      !hasText(playbook.intentId) ||
        !hasText(playbook.version) ||
        !hasText(playbook.goal) ||
        !hasItems(playbook.successCriteria) ||
        !hasItems(playbook.allowedQuestions) ||
        !hasItems(playbook.escalationCriteria) ||
        !hasItems(playbook.forbiddenClaims),
      'PLAYBOOK_REQUIRED_FIELD_MISSING',
    );
    add(blockers, !hasItems(playbook.requiredFields), 'PLAYBOOK_REQUIRED_FIELDS_MISSING');
    add(blockers, !hasItems(playbook.allowedTools), 'PLAYBOOK_ALLOWED_TOOLS_MISSING');
    add(blockers, hasUnknownAllowedTool(playbook), 'PLAYBOOK_ALLOWED_TOOL_UNKNOWN');
    add(blockers, hasAmbiguousNoneTool(playbook), 'PLAYBOOK_NONE_TOOL_MIXED_WITH_REAL_TOOLS');
    add(blockers, !hasAsrVariants(playbook.germanAsrVariants), 'GERMAN_ASR_VARIANTS_MISSING');
    add(blockers, hasAsrVariants(playbook.germanAsrVariants) && !hasRequiredAsrVariantKinds(playbook.germanAsrVariants), 'GERMAN_ASR_VARIANT_CLASS_COVERAGE_MISSING');
    add(
      blockers,
      playbookHasMutatingTool(playbook) && playbook.confirmationRequirement !== 'confirmed_summary_before_tool',
      'MUTATION_PLAYBOOK_REQUIRES_CONFIRMATION',
    );
    add(
      blockers,
      playbook.goldStandardVoiceAnswers.length < 2 || playbook.goldStandardVoiceAnswers.length > 3,
      'GOLD_VOICE_ANSWER_COUNT_INVALID',
    );
    add(
      blockers,
      playbook.goldStandardVoiceAnswers.some((answer) => !hasText(answer) || voiceAnswerTooLong(answer)),
      'GOLD_VOICE_ANSWER_TOO_LONG',
    );
    add(
      blockers,
      playbook.goldStandardVoiceAnswers.some(writtenStyleAnswer),
      'GOLD_VOICE_ANSWER_WRITTEN_STYLE',
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
    coverage,
  };
}
