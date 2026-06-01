import crypto from 'node:crypto';

import type { KnowledgeSource } from './knowledge.js';
import {
  hashOwnKbAuthoringId,
  parseOwnKbAuthoringCsv,
  type OwnKbAuthoringRow,
} from './own-kb-authoring.js';
import { redactForEval } from './pii.js';
import { csvValue } from './test-transcript-benchmark-pack.js';
import { isTrustedScope, type TrustedScope } from './trusted-scope.js';

export type OwnKbExpertIntent =
  | 'opening_hours'
  | 'appointment_booking'
  | 'reservation_policy'
  | 'pricing'
  | 'services'
  | 'menu_or_products'
  | 'allergen_or_health'
  | 'caller_frustration'
  | 'simulation_request'
  | 'clarification_needed'
  | 'unknown';

const OWN_KB_EXPERT_INTENTS: readonly OwnKbExpertIntent[] = [
  'opening_hours',
  'appointment_booking',
  'reservation_policy',
  'pricing',
  'services',
  'menu_or_products',
  'allergen_or_health',
  'caller_frustration',
  'simulation_request',
  'clarification_needed',
  'unknown',
] as const;

export type OwnKbEvidenceNeed =
  | 'business_hours_source'
  | 'holiday_calendar'
  | 'special_hours_source'
  | 'booking_policy'
  | 'service_catalog'
  | 'price_list'
  | 'menu_or_product_catalog'
  | 'allergen_matrix'
  | 'staff_or_human_escalation_policy'
  | 'conversation_policy'
  | 'address_contact_source';

const OWN_KB_EVIDENCE_NEEDS: readonly OwnKbEvidenceNeed[] = [
  'business_hours_source',
  'holiday_calendar',
  'special_hours_source',
  'booking_policy',
  'service_catalog',
  'price_list',
  'menu_or_product_catalog',
  'allergen_matrix',
  'staff_or_human_escalation_policy',
  'conversation_policy',
  'address_contact_source',
] as const;

export type OwnKbSimulationSituation =
  | 'normal_everyday_call'
  | 'noisy_line'
  | 'fast_speaker'
  | 'asr_confusion'
  | 'relative_date'
  | 'caller_correction'
  | 'interruption'
  | 'frustrated_caller';

export type OwnKbExpertEnrichmentRow = {
  questionId: string;
  questionIdHash: string;
  redactedQuestion: string;
  intentHypothesis: OwnKbExpertIntent;
  riskHypothesis: 'low' | 'medium' | 'high';
  evidenceNeeded: OwnKbEvidenceNeed[];
  expertReviewFocus: string[];
  safeAnswerStrategy: string;
  forbiddenClaims: string[];
  simulationScenarioIds: string[];
  syntheticOnly: true;
  approvedForMilestone: 'DRAFT_ONLY';
  promotionEvidenceUsable: false;
};

export type OwnKbEverydaySimulation = {
  simulationId: string;
  baseQuestionIdHash: string;
  intent: OwnKbExpertIntent;
  situation: OwnKbSimulationSituation;
  syntheticCallerUtterance: string;
  expectedSafeBehavior: string;
  requiredEvidence: OwnKbEvidenceNeed[];
  forbiddenClaims: string[];
  syntheticOnly: true;
  approvedForMilestone: 'DRAFT_ONLY';
  promotionEvidenceUsable: false;
};

export type OwnKbSimulationEnrichmentReport = {
  kind: 'own_kb_simulation_enrichment_report';
  rows: number;
  enrichmentRows: number;
  simulationRows: number;
  sourceRequirementRows: number;
  intentCounts: Record<string, number>;
  riskCounts: Record<string, number>;
  evidenceNeedCounts: Record<string, number>;
  researchBasis: {
    source: string;
    url: string;
    finding: string;
  }[];
  containsCallerContent: false;
  exportsRedactedQuestions: false;
  enrichmentCsvExportsRedactedQuestions: true;
  sourceRequirementsExportRedactedQuestions: false;
  factIntakeTemplateExportsRedactedQuestions: false;
  syntheticOnly: true;
  approvedForMilestone: 'DRAFT_ONLY';
  promotionEvidenceUsable: false;
};

export type OwnKbSourceRequirement = {
  evidenceNeed: OwnKbEvidenceNeed;
  questionCount: number;
  questionIdHashes: string[];
  requiredForIntents: OwnKbExpertIntent[];
  highestRisk: 'low' | 'medium' | 'high';
  requiredSourceMetadata: string[];
  reviewerInstructions: string[];
  forbiddenSourceContent: string[];
  syntheticOnly: boolean;
  approvedForMilestone: 'DRAFT_ONLY' | 'SOURCE_REQUIREMENTS_REVIEWED';
  promotionEvidenceUsable: false;
};

export type OwnKbFactIntakeRow = {
  factTemplateId: string;
  evidenceNeed: string;
  sourceTitle: string;
  sourceReference: string;
  sourceVersionId: string;
  sourceVersionHash: string;
  sourceText: string;
  risk: string;
  allowedUse: string;
  reviewStatus: string;
  verifiedAt: string;
  expiresAt: string;
  reviewerHandle: string;
  notes: string;
  questionCount: string;
  requiredForIntents: string;
  syntheticOnly: string;
  approvedForMilestone: string;
  promotionEvidenceUsable: string;
};

export type OwnKbFactIntakeValidationIssue =
  | 'CSV_HEADER_REQUIRED'
  | 'CSV_MALFORMED_QUOTES'
  | 'CSV_DUPLICATE_COLUMNS'
  | 'CSV_REQUIRED_COLUMNS_MISSING'
  | 'CSV_UNKNOWN_COLUMNS'
  | 'CSV_ROW_COLUMN_COUNT_MISMATCH'
  | 'FACT_ROWS_REQUIRED'
  | 'FACT_TEMPLATE_ID_REQUIRED'
  | 'EVIDENCE_NEED_NOT_ALLOWED'
  | 'SOURCE_TITLE_REQUIRED'
  | 'SOURCE_REFERENCE_REQUIRED'
  | 'SOURCE_VERSION_ID_REQUIRED'
  | 'SOURCE_VERSION_HASH_REQUIRED'
  | 'SOURCE_TEXT_REQUIRED'
  | 'SOURCE_TEXT_TOO_SHORT'
  | 'RISK_NOT_ALLOWED'
  | 'ALLOWED_USE_NOT_ALLOWED'
  | 'REVIEW_STATUS_NOT_APPROVED'
  | 'VERIFIED_AT_INVALID'
  | 'EXPIRES_AT_INVALID'
  | 'EXPIRES_AT_NOT_AFTER_VERIFIED_AT'
  | 'EXPIRES_AT_NOT_FUTURE'
  | 'REVIEWER_HANDLE_INVALID'
  | 'PLACEHOLDER_CONTENT'
  | 'PII_DETECTED'
  | 'PROMPT_INJECTION_DETECTED'
  | 'SECRET_OR_OPERATIONAL_DETAIL_DETECTED'
  | 'CSV_FORMULA_INJECTION_DETECTED'
  | 'DRAFT_MARKER_NOT_CLEARED'
  | 'SOURCE_REQUIREMENT_MISSING'
  | 'SOURCE_REQUIREMENT_EXTRA'
  | 'SOURCE_REQUIREMENT_DUPLICATE'
  | 'SOURCE_REQUIREMENTS_REQUIRED'
  | 'SOURCE_REQUIREMENTS_HEADER_INVALID'
  | 'SOURCE_REQUIREMENTS_TOO_SMALL'
  | 'SOURCE_REQUIREMENTS_ROW_INVALID'
  | 'SOURCE_REQUIREMENTS_METADATA_INCOMPLETE'
  | 'SOURCE_REQUIREMENTS_INVALID'
  | 'SOURCE_VERSION_HASH_MISMATCH'
  | 'SOURCE_APPROVAL_MANIFEST_REQUIRED'
  | 'SOURCE_APPROVAL_MANIFEST_INVALID'
  | 'SOURCE_APPROVAL_MANIFEST_NOT_APPROVED'
  | 'SOURCE_APPROVAL_MANIFEST_ENTRY_MISSING'
  | 'SOURCE_APPROVAL_MANIFEST_ENTRY_EXTRA'
  | 'SOURCE_APPROVAL_MANIFEST_ENTRY_DUPLICATE'
  | 'SOURCE_APPROVAL_MANIFEST_ENTRY_MISMATCH'
  | 'SOURCE_APPROVAL_MANIFEST_INPUT_HASH_MISMATCH'
  | 'SOURCE_GENERATION_TRUSTED_SCOPE_REQUIRED'
  | 'SOURCE_APPROVAL_MANIFEST_SCOPE_MISMATCH'
  | 'SOURCE_APPROVAL_MANIFEST_SIGNATURE_REQUIRED'
  | 'SOURCE_APPROVAL_MANIFEST_SIGNATURE_INVALID'
  | 'SOURCE_APPROVAL_SECRET_WEAK'
  | 'SOURCE_APPROVAL_REVIEWER_NOT_SEPARATE';

export type OwnKbFactIntakeValidationReport = {
  kind: 'own_kb_fact_intake_validation';
  rows: number;
  validRows: number;
  invalidRows: number;
  issueCounts: Record<string, number>;
  requiredEvidenceNeeds?: string[];
  coveredEvidenceNeeds?: string[];
  missingEvidenceNeeds?: string[];
  extraEvidenceNeeds?: string[];
  duplicateEvidenceNeeds?: string[];
  sourceRequirementsProvided: boolean;
  sourceRequirementRows: number;
  sourceApprovalManifestProvided: boolean;
  sourceApprovalManifestEntries: number;
  sourceGenerationReady: boolean;
  sourceGenerationBlockers: OwnKbFactIntakeValidationIssue[];
  sourcesWritten: boolean;
  createsBusinessFacts: false;
  promotionEvidenceUsable: false;
};

export type OwnKbFactIntakeBuildResult = {
  report: OwnKbFactIntakeValidationReport;
  sources: KnowledgeSource[];
};

export type OwnKbFactIntakeApprovalManifestEntry = {
  factTemplateId: string;
  evidenceNeed: string;
  sourceReference: string;
  sourceVersionId: string;
  sourceVersionHash: string;
  reviewerHandle: string;
};

export type OwnKbFactIntakeApprovalManifest = {
  kind: 'own_kb_fact_intake_approval_manifest';
  manifestId: string;
  approvedBy: string;
  approvedAt: string;
  orgId: string;
  tenantId: string;
  factIntakeSha256: string;
  sourceRequirementsSha256: string;
  sourceCount: number;
  syntheticOnly: false;
  approvedForMilestone: 'SOURCE_GENERATION';
  promotionEvidenceUsable: false;
  entries: OwnKbFactIntakeApprovalManifestEntry[];
  approvalSignature?: string;
};

export type OwnKbFactIntakeSourceGenerationOptions = {
  trustedScope?: TrustedScope;
  approvalSecret?: string;
};

export const OWN_KB_FACT_INTAKE_REQUIRED_COLUMNS = [
  'factTemplateId',
  'evidenceNeed',
  'sourceTitle',
  'sourceReference',
  'sourceVersionId',
  'sourceVersionHash',
  'sourceText',
  'risk',
  'allowedUse',
  'reviewStatus',
  'verifiedAt',
  'expiresAt',
  'reviewerHandle',
  'notes',
  'questionCount',
  'requiredForIntents',
  'syntheticOnly',
  'approvedForMilestone',
  'promotionEvidenceUsable',
] as const;

const FACT_INTAKE_ALLOWED_RISKS = new Set(['low', 'medium', 'high']);
const FACT_INTAKE_ALLOWED_USES = new Set([
  'voice_agent',
  'agent_facts',
  'customer_faq',
  'public_faq',
  'human_review_required',
]);
const FACT_INTAKE_ALLOWED_REVIEW_STATUSES = new Set(['approved']);
const MIN_FACT_INTAKE_SOURCE_REQUIREMENT_ROWS = 5;
const MIN_FACT_INTAKE_APPROVAL_SECRET_LENGTH = 32;
const MIN_FACT_INTAKE_APPROVAL_SECRET_UNIQUE_CHARS = 8;
const OWN_KB_SOURCE_REQUIREMENTS_REQUIRED_COLUMNS = [
  'evidenceNeed',
  'questionCount',
  'highestRisk',
  'requiredForIntents',
  'questionIdHashes',
  'requiredSourceMetadata',
  'reviewerInstructions',
  'forbiddenSourceContent',
  'syntheticOnly',
  'approvedForMilestone',
  'promotionEvidenceUsable',
] as const;
const FACT_INTAKE_PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?previous\s+instructions\b/i,
  /\bdisregard\s+(?:all\s+)?previous\s+instructions\b/i,
  /\bforget\s+(?:all\s+)?(?:prior|previous)\s+(?:rules|instructions)\b/i,
  /\byou\s+are\s+now\s+(?:system|developer|admin)\b/i,
  /\bsystem\s+prompt\b/i,
  /\bdeveloper\s+message\b/i,
  /\btool\s*policy\s*override\b/i,
  /\boverride\s+(?:the\s+)?tool\s*policy\b/i,
  /\bcross[-\s]?tenant\b/i,
  /\banother\s+tenant\b/i,
  /<[^>]*(?:hidden|display\s*:\s*none|visibility\s*:\s*hidden)[^>]*>/i,
  /```\s*(?:system|developer|tool)/i,
  /^#{1,6}\s*(?:system|developer|tool)\s+(?:instructions|message|policy)/im,
  /\bignoriere\s+(?:alle\s+)?(?:vorherigen|bisherigen)\s+anweisungen\b/i,
  /\bvergiss\s+(?:alle\s+)?(?:vorherigen|bisherigen)\s+anweisungen\b/i,
  /\bignora\s+(?:le\s+)?istruzioni\s+precedenti\b/i,
];
const FACT_INTAKE_SECRET_OR_OPERATIONAL_PATTERNS = [
  /\b(?:ssh|scp|rsync)\s+/i,
  /\b(?:server\s*ip|deploy(?:ment)?\s*target|production\s+command)\b/i,
  /\b(?:api[_-]?key|secret|token|password|private\s+key)\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
const FACT_INTAKE_PLACEHOLDER_PATTERNS = [
  /\b(todo|tbd|placeholder|fill from approved|fill me|noch ausfuellen|noch ausfÃ¼llen|bitte ausfuellen|bitte ausfÃ¼llen)\b/i,
  /^\s*(n\/a|na|none|null|-|â€”)\s*$/i,
];
const FACT_INTAKE_REDACTION_TOKEN_PATTERN = /\[(?:PHONE|EMAIL|IBAN|CC|ADDRESS|DOB|REDACTED|PII)\]/i;

export const OWN_KB_EXPERT_RESEARCH_BASIS = [
  {
    source: 'European Commission food information legislation',
    url: 'https://food.ec.europa.eu/food-safety/labelling-and-nutrition/food-information-consumers-legislation/mandatory-food-information_en',
    finding: 'Non-prepacked food such as restaurant/catering food requires allergen/intolerance information; the voice agent must not invent allergen answers.',
  },
  {
    source: 'EFSA food allergens',
    url: 'https://www.efsa.europa.eu/en/safe2eat/food-allergens',
    finding: 'EU food allergen handling centers on a defined set of allergen categories; food/allergen calls need source-backed information or escalation.',
  },
  {
    source: 'European Commission labelling overview',
    url: 'https://food.ec.europa.eu/food-safety/campaign-2026/labelling_en',
    finding: 'Unpackaged foods in restaurants/cafes still need clear allergen information, orally or in writing upon request.',
  },
] as const;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/Ã¤|ä/g, 'ae')
    .replace(/Ã¶|ö/g, 'oe')
    .replace(/Ã¼|ü/g, 'ue')
    .replace(/Ã„|ä/g, 'ae')
    .replace(/Ã–|ö/g, 'oe')
    .replace(/Ãœ|ü/g, 'ue')
    .replace(/ÃŸ|ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function classifyOwnKbExpertIntent(question: string): OwnKbExpertIntent {
  const normalized = normalize(question);
  if (hasAny(normalized, [/\ballerg/, /\bgluten\b/, /\bnuss/, /\bmilch\b/, /\bei\b/, /\bsoja\b/])) {
    return 'allergen_or_health';
  }
  if (hasAny(normalized, [/\boffen\b/, /offen/, /\boeffnet/, /ge\S{0,4}ffnet/, /\boeffnungs/, /\bauf\b/, /\bimmer offen\b/])) {
    return 'opening_hours';
  }
  if (hasAny(normalized, [/\breservierung\b/, /\breservieren\b/, /\bohne reservierung\b/])) {
    return 'reservation_policy';
  }
  if (hasAny(normalized, [/\btermin\b/, /\bdienstag\b/, /\bmorgen\b/, /\bso bald\b/, /\bsobald\b/])) {
    return 'appointment_booking';
  }
  if (hasAny(normalized, [/\bpreis/, /\bkosten\b/, /\bkostet\b/, /\bpreisstruktur/])) {
    return 'pricing';
  }
  if (hasAny(normalized, [/\bservice/, /\bhaare\b/, /\bhaarschnitt\b/, /\bfriseur\b/, /\bsalon\b/, /\bschneidet/])) {
    return 'services';
  }
  if (hasAny(normalized, [/\bgericht/, /\bgerichte\b/, /\bmenu\b/, /\bspeise/, /\bessen\b/])) {
    return 'menu_or_products';
  }
  if (hasAny(normalized, [/\btausendmal\b/, /\bmerkst\b/, /\bdigger\b/, /\bdigga\b/, /\bwas\?\b/])) {
    return 'caller_frustration';
  }
  if (hasAny(normalized, [/\bsimulier/, /\bso tun\b/, /\bsituation\b/])) {
    return 'simulation_request';
  }
  if (hasAny(normalized, [/\bwas meinst\b/, /\bhallo\b/, /\bwas habt\b/, /\bdanach\b/])) {
    return 'clarification_needed';
  }
  return 'unknown';
}

function riskForIntent(intent: OwnKbExpertIntent): 'low' | 'medium' | 'high' {
  if (intent === 'allergen_or_health') return 'high';
  if (intent === 'pricing' || intent === 'appointment_booking' || intent === 'reservation_policy') return 'medium';
  if (intent === 'caller_frustration') return 'medium';
  return 'low';
}

function evidenceForIntent(intent: OwnKbExpertIntent): OwnKbEvidenceNeed[] {
  switch (intent) {
    case 'opening_hours':
      return ['business_hours_source', 'holiday_calendar', 'special_hours_source'];
    case 'appointment_booking':
      return ['booking_policy', 'service_catalog', 'staff_or_human_escalation_policy'];
    case 'reservation_policy':
      return ['booking_policy', 'staff_or_human_escalation_policy'];
    case 'pricing':
      return ['price_list', 'service_catalog'];
    case 'services':
      return ['service_catalog'];
    case 'menu_or_products':
      return ['menu_or_product_catalog'];
    case 'allergen_or_health':
      return ['allergen_matrix', 'menu_or_product_catalog', 'staff_or_human_escalation_policy'];
    case 'caller_frustration':
      return ['conversation_policy', 'staff_or_human_escalation_policy'];
    case 'simulation_request':
      return ['conversation_policy'];
    case 'clarification_needed':
      return ['conversation_policy'];
    case 'unknown':
      return ['conversation_policy', 'staff_or_human_escalation_policy'];
  }
}

function forbiddenClaimsForIntent(intent: OwnKbExpertIntent): string[] {
  const common = [
    'Do not invent business facts, prices, opening hours, availability, addresses, or staff names.',
    'Do not turn synthetic simulations into promotion evidence.',
  ];
  switch (intent) {
    case 'allergen_or_health':
      return [
        ...common,
        'Do not guarantee allergen-free food or medical safety without approved allergen evidence.',
        'Do not answer high-risk food/allergen questions from Retell-KB alone unless Own-KB evidence or an approved exception exists.',
      ];
    case 'pricing':
      return [...common, 'Do not quote a price without a current approved price list.'];
    case 'opening_hours':
      return [...common, 'Do not answer changing opening hours without current source_version and expires_at.'];
    case 'appointment_booking':
    case 'reservation_policy':
      return [...common, 'Do not claim a booking/reservation is possible or completed without policy/tool confirmation.'];
    default:
      return common;
  }
}

function reviewFocusForIntent(intent: OwnKbExpertIntent): string[] {
  switch (intent) {
    case 'opening_hours':
      return ['Check weekday ranges, holidays, special hours, Betriebsferien, and Europe/Berlin timezone handling.'];
    case 'appointment_booking':
      return ['Check required fields, confirmation wording, idempotency, and tool eligibility before mutation.'];
    case 'reservation_policy':
      return ['Check whether walk-ins/reservations are allowed and whether a booking tool or human handoff is required.'];
    case 'pricing':
      return ['Check current price list, service variants, from-prices, and stale/expired source handling.'];
    case 'services':
      return ['Check approved service catalog, synonyms, ASR variants, and concise voice answer wording.'];
    case 'menu_or_products':
      return ['Check current menu/product catalog and avoid implying availability without source freshness.'];
    case 'allergen_or_health':
      return ['Check allergen matrix, cross-contact policy, and safe escalation for allergy/health risk.'];
    case 'caller_frustration':
      return ['Check frustration recognition, apology/repair wording, and human-escalation threshold.'];
    case 'simulation_request':
      return ['Check demo/simulation boundary so simulated calls cannot be confused with production evidence.'];
    case 'clarification_needed':
      return ['Check targeted clarification wording and avoid asking multiple questions at once.'];
    case 'unknown':
      return ['Check whether this should be out-of-scope, clarification, or KB expansion.'];
  }
}

function strategyForIntent(intent: OwnKbExpertIntent): string {
  switch (intent) {
    case 'opening_hours':
      return 'Answer only from current opening-hours resolver evidence; otherwise give a short clarification or abstain.';
    case 'appointment_booking':
      return 'Collect required fields, speak a short summary, wait for confirmation, then use the approved booking path.';
    case 'reservation_policy':
      return 'Answer reservation/walk-in rules only from approved policy; offer booking or handoff when unclear.';
    case 'pricing':
      return 'Quote prices only from a current approved price source; otherwise offer to connect or clarify service variant.';
    case 'services':
      return 'Give a short service-catalog answer and ask one targeted follow-up if the requested service is ambiguous.';
    case 'menu_or_products':
      return 'Answer menu/product availability only from current catalog evidence; mention uncertainty briefly when missing.';
    case 'allergen_or_health':
      return 'Use approved allergen evidence or escalate; never improvise health/allergen safety.';
    case 'caller_frustration':
      return 'Acknowledge briefly, repair state, and escalate when the caller asks for a human or repeats frustration.';
    case 'simulation_request':
      return 'Keep simulation clearly labeled as demo/test behavior and do not persist it as production evidence.';
    case 'clarification_needed':
      return 'Ask one concise clarification question tied to the likely task.';
    case 'unknown':
      return 'Treat as KB expansion or handoff candidate until an approved playbook exists.';
  }
}

function situationsForIntent(intent: OwnKbExpertIntent): OwnKbSimulationSituation[] {
  switch (intent) {
    case 'opening_hours':
      return ['normal_everyday_call', 'relative_date', 'asr_confusion'];
    case 'appointment_booking':
      return ['normal_everyday_call', 'relative_date', 'caller_correction', 'interruption'];
    case 'reservation_policy':
      return ['normal_everyday_call', 'noisy_line'];
    case 'pricing':
      return ['normal_everyday_call', 'fast_speaker'];
    case 'services':
      return ['normal_everyday_call', 'asr_confusion'];
    case 'menu_or_products':
      return ['normal_everyday_call', 'asr_confusion'];
    case 'allergen_or_health':
      return ['normal_everyday_call', 'caller_correction'];
    case 'caller_frustration':
      return ['frustrated_caller', 'interruption'];
    case 'simulation_request':
      return ['normal_everyday_call'];
    case 'clarification_needed':
      return ['noisy_line', 'fast_speaker'];
    case 'unknown':
      return ['normal_everyday_call'];
  }
}

function syntheticUtterance(intent: OwnKbExpertIntent, situation: OwnKbSimulationSituation): string {
  const byIntent: Record<OwnKbExpertIntent, string> = {
    opening_hours: 'Wann habt ihr heute offen?',
    appointment_booking: 'Ich brauche so schnell wie moeglich einen Termin.',
    reservation_policy: 'Kann ich auch ohne Reservierung vorbeikommen?',
    pricing: 'Was kostet das ungefaehr?',
    services: 'Welche Services bietet ihr an?',
    menu_or_products: 'Was habt ihr fuer Gerichte oder Produkte?',
    allergen_or_health: 'Ist das fuer jemanden mit Allergie sicher?',
    caller_frustration: 'Ich habe das schon gesagt, warum merkst du dir das nicht?',
    simulation_request: 'Lass uns den Anruf einmal simulieren.',
    clarification_needed: 'Hallo, was meinst du genau?',
    unknown: 'Ich habe eine kurze Frage.',
  };
  const base = byIntent[intent];
  switch (situation) {
    case 'noisy_line':
      return `${base} Ich bin gerade draussen und die Verbindung ist schlecht.`;
    case 'fast_speaker':
      return `${base} Bitte schnell, ich habe nicht viel Zeit.`;
    case 'asr_confusion':
      return `${base} Falls du mich falsch verstanden hast, ich meine wirklich diese Frage.`;
    case 'relative_date':
      return `${base} Es geht um morgen oder Dienstag.`;
    case 'caller_correction':
      return `${base} Nein, warte, ich korrigiere das nochmal.`;
    case 'interruption':
      return `${base} Stopp, ich wollte noch etwas aendern.`;
    case 'frustrated_caller':
      return `${base} Das klappt gerade nicht, ich will eine klare Antwort.`;
    case 'normal_everyday_call':
      return base;
  }
}

function expectedSafeBehavior(intent: OwnKbExpertIntent): string {
  switch (intent) {
    case 'allergen_or_health':
      return 'Use approved allergen evidence or escalate; do not improvise safety claims.';
    case 'appointment_booking':
      return 'Collect fields and require confirmed summary before any mutation.';
    case 'opening_hours':
      return 'Use current hours/holiday evidence or ask a concise clarification.';
    case 'pricing':
      return 'Use current price evidence or abstain/offer handoff.';
    case 'caller_frustration':
      return 'Acknowledge frustration, repair state, and offer human escalation when needed.';
    default:
      return 'Give a short voice-native answer only when approved evidence supports it; otherwise clarify or abstain.';
  }
}

export function buildOwnKbExpertEnrichmentRows(rows: OwnKbAuthoringRow[]): OwnKbExpertEnrichmentRow[] {
  return rows.map((row) => {
    const intent = classifyOwnKbExpertIntent(row.redactedQuestion);
    const questionIdHash = hashOwnKbAuthoringId(row.questionId);
    const simulationScenarioIds = situationsForIntent(intent).map((situation) => (
      `sim_${questionIdHash}_${situation}`
    ));
    return {
      questionId: row.questionId,
      questionIdHash,
      redactedQuestion: row.redactedQuestion,
      intentHypothesis: intent,
      riskHypothesis: riskForIntent(intent),
      evidenceNeeded: evidenceForIntent(intent),
      expertReviewFocus: reviewFocusForIntent(intent),
      safeAnswerStrategy: strategyForIntent(intent),
      forbiddenClaims: forbiddenClaimsForIntent(intent),
      simulationScenarioIds,
      syntheticOnly: true,
      approvedForMilestone: 'DRAFT_ONLY',
      promotionEvidenceUsable: false,
    };
  });
}

export function buildOwnKbEverydaySimulations(enrichmentRows: OwnKbExpertEnrichmentRow[]): OwnKbEverydaySimulation[] {
  return enrichmentRows.flatMap((row) => situationsForIntent(row.intentHypothesis).map((situation) => ({
    simulationId: `sim_${row.questionIdHash}_${situation}`,
    baseQuestionIdHash: row.questionIdHash,
    intent: row.intentHypothesis,
    situation,
    syntheticCallerUtterance: syntheticUtterance(row.intentHypothesis, situation),
    expectedSafeBehavior: expectedSafeBehavior(row.intentHypothesis),
    requiredEvidence: row.evidenceNeeded,
    forbiddenClaims: row.forbiddenClaims,
    syntheticOnly: true,
    approvedForMilestone: 'DRAFT_ONLY' as const,
    promotionEvidenceUsable: false as const,
  })));
}

function countValues(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values)).sort();
}

function maxRisk(risks: ('low' | 'medium' | 'high')[]): 'low' | 'medium' | 'high' {
  if (risks.includes('high')) return 'high';
  if (risks.includes('medium')) return 'medium';
  return 'low';
}

function metadataForEvidenceNeed(evidenceNeed: OwnKbEvidenceNeed): string[] {
  const common = [
    'own_source_id',
    'source_version_id',
    'source_version_hash',
    'source_title',
    'review_status',
    'verified_at',
    'expires_at',
    'risk',
    'allowed_use',
  ];
  switch (evidenceNeed) {
    case 'business_hours_source':
    case 'holiday_calendar':
    case 'special_hours_source':
      return [...common, 'timezone_europe_berlin', 'special_hours_or_holiday_scope'];
    case 'price_list':
      return [...common, 'currency', 'service_variant_scope'];
    case 'booking_policy':
      return [...common, 'required_fields', 'confirmation_policy'];
    case 'allergen_matrix':
      return [...common, 'menu_item_scope', 'allergen_categories', 'cross_contact_policy'];
    case 'service_catalog':
    case 'menu_or_product_catalog':
      return [...common, 'catalog_item_scope'];
    case 'staff_or_human_escalation_policy':
      return [...common, 'handoff_conditions', 'human_queue_or_contact_policy'];
    case 'conversation_policy':
      return [...common, 'voice_behavior_rule_scope'];
    case 'address_contact_source':
      return [...common, 'public_contact_scope'];
  }
}

function reviewerInstructionsForEvidenceNeed(evidenceNeed: OwnKbEvidenceNeed): string[] {
  switch (evidenceNeed) {
    case 'business_hours_source':
      return ['Provide current regular opening hours with weekday ranges and Europe/Berlin timezone.'];
    case 'holiday_calendar':
      return ['Provide the holiday calendar source used by the business-hours resolver.'];
    case 'special_hours_source':
      return ['Provide special opening hours, closures, and Betriebsferien with expiry.'];
    case 'booking_policy':
      return ['Provide reservation/appointment rules, required fields, confirmation requirement, and escalation criteria.'];
    case 'service_catalog':
      return ['Provide approved service names, variants, synonyms, and availability boundaries.'];
    case 'price_list':
      return ['Provide current prices with service variants, from-price wording, currency, and expiry.'];
    case 'menu_or_product_catalog':
      return ['Provide current menu/product items and availability boundaries.'];
    case 'allergen_matrix':
      return ['Provide approved allergen information and cross-contact policy; do not infer from ingredient names alone.'];
    case 'staff_or_human_escalation_policy':
      return ['Provide when to hand off to a human and what the voice agent may say before escalation.'];
    case 'conversation_policy':
      return ['Provide voice behavior rules for clarifications, frustration, simulation boundaries, and unsupported requests.'];
    case 'address_contact_source':
      return ['Provide approved public address/contact facts with freshness metadata.'];
  }
}

function forbiddenSourceContentForEvidenceNeed(evidenceNeed: OwnKbEvidenceNeed): string[] {
  const common = [
    'No raw caller transcript content.',
    'No secrets, internal infrastructure, SSH paths, server IPs, deployment commands, or coordination notes.',
    'No model instructions, prompt-injection text, or tool-policy override text.',
    'No unapproved or expired facts.',
  ];
  if (evidenceNeed === 'allergen_matrix') {
    return [
      ...common,
      'No unsourced allergen-free guarantees.',
      'No medical advice.',
    ];
  }
  if (evidenceNeed === 'price_list') {
    return [...common, 'No stale or approximate prices without explicit approved wording.'];
  }
  return common;
}

export function buildOwnKbSourceRequirements(
  enrichmentRows: OwnKbExpertEnrichmentRow[],
): OwnKbSourceRequirement[] {
  const groups = new Map<OwnKbEvidenceNeed, OwnKbExpertEnrichmentRow[]>();
  for (const row of enrichmentRows) {
    for (const evidenceNeed of row.evidenceNeeded) {
      const group = groups.get(evidenceNeed) ?? [];
      group.push(row);
      groups.set(evidenceNeed, group);
    }
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([evidenceNeed, rows]) => ({
      evidenceNeed,
      questionCount: new Set(rows.map((row) => row.questionIdHash)).size,
      questionIdHashes: uniqueSorted(rows.map((row) => row.questionIdHash)),
      requiredForIntents: uniqueSorted(rows.map((row) => row.intentHypothesis)),
      highestRisk: maxRisk(rows.map((row) => row.riskHypothesis)),
      requiredSourceMetadata: metadataForEvidenceNeed(evidenceNeed),
      reviewerInstructions: reviewerInstructionsForEvidenceNeed(evidenceNeed),
      forbiddenSourceContent: forbiddenSourceContentForEvidenceNeed(evidenceNeed),
      syntheticOnly: true,
      approvedForMilestone: 'DRAFT_ONLY' as const,
      promotionEvidenceUsable: false as const,
    }));
}

export function buildOwnKbSimulationEnrichmentFromAuthoringCsv(csv: string): {
  report: OwnKbSimulationEnrichmentReport;
  enrichmentRows: OwnKbExpertEnrichmentRow[];
  simulations: OwnKbEverydaySimulation[];
  sourceRequirements: OwnKbSourceRequirement[];
} {
  const rows = parseOwnKbAuthoringCsv(csv);
  const enrichmentRows = buildOwnKbExpertEnrichmentRows(rows);
  const simulations = buildOwnKbEverydaySimulations(enrichmentRows);
  const sourceRequirements = buildOwnKbSourceRequirements(enrichmentRows);
  const report: OwnKbSimulationEnrichmentReport = {
    kind: 'own_kb_simulation_enrichment_report',
    rows: rows.length,
    enrichmentRows: enrichmentRows.length,
    simulationRows: simulations.length,
    sourceRequirementRows: sourceRequirements.length,
    intentCounts: countValues(enrichmentRows.map((row) => row.intentHypothesis)),
    riskCounts: countValues(enrichmentRows.map((row) => row.riskHypothesis)),
    evidenceNeedCounts: countValues(enrichmentRows.flatMap((row) => row.evidenceNeeded)),
    researchBasis: [...OWN_KB_EXPERT_RESEARCH_BASIS],
    containsCallerContent: false,
    exportsRedactedQuestions: false,
    enrichmentCsvExportsRedactedQuestions: true,
    sourceRequirementsExportRedactedQuestions: false,
    factIntakeTemplateExportsRedactedQuestions: false,
    syntheticOnly: true,
    approvedForMilestone: 'DRAFT_ONLY',
    promotionEvidenceUsable: false,
  };
  return { report, enrichmentRows, simulations, sourceRequirements };
}

export function buildOwnKbExpertEnrichmentCsv(rows: OwnKbExpertEnrichmentRow[]): string {
  return [
    [
      'questionId',
      'redactedQuestion',
      'questionIdHash',
      'intentHypothesis',
      'riskHypothesis',
      'evidenceNeeded',
      'expertReviewFocus',
      'safeAnswerStrategy',
      'forbiddenClaims',
      'simulationScenarioIds',
      'syntheticOnly',
      'approvedForMilestone',
      'promotionEvidenceUsable',
    ].map(csvValue).join(','),
    ...rows.map((row) => [
      row.questionId,
      row.redactedQuestion,
      row.questionIdHash,
      row.intentHypothesis,
      row.riskHypothesis,
      row.evidenceNeeded.join('|'),
      row.expertReviewFocus.join('|'),
      row.safeAnswerStrategy,
      row.forbiddenClaims.join('|'),
      row.simulationScenarioIds.join('|'),
      String(row.syntheticOnly),
      row.approvedForMilestone,
      String(row.promotionEvidenceUsable),
    ].map(csvValue).join(',')),
  ].join('\n') + '\n';
}

export function buildOwnKbSourceRequirementsCsv(rows: OwnKbSourceRequirement[]): string {
  return [
    [
      'evidenceNeed',
      'questionCount',
      'highestRisk',
      'requiredForIntents',
      'questionIdHashes',
      'requiredSourceMetadata',
      'reviewerInstructions',
      'forbiddenSourceContent',
      'syntheticOnly',
      'approvedForMilestone',
      'promotionEvidenceUsable',
    ].map(csvValue).join(','),
    ...rows.map((row) => [
      row.evidenceNeed,
      String(row.questionCount),
      row.highestRisk,
      row.requiredForIntents.join('|'),
      row.questionIdHashes.join('|'),
      row.requiredSourceMetadata.join('|'),
      row.reviewerInstructions.join('|'),
      row.forbiddenSourceContent.join('|'),
      String(row.syntheticOnly),
      row.approvedForMilestone,
      String(row.promotionEvidenceUsable),
    ].map(csvValue).join(',')),
  ].join('\n') + '\n';
}

export function parseOwnKbSourceRequirementsCsv(csv: string): OwnKbSourceRequirement[] {
  const [headerRow, ...dataRows] = parseCsvWithStatus(csv).rows;
  if (!headerRow) return [];
  const headers = headerRow.map((cell) => cell.trim());
  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = compactCsvCell(row[index] ?? '');
    });
    return {
      evidenceNeed: record.evidenceNeed as OwnKbEvidenceNeed,
      questionCount: Number.parseInt(record.questionCount ?? '0', 10) || 0,
      highestRisk: (record.highestRisk || 'low') as 'low' | 'medium' | 'high',
      requiredForIntents: compactCsvCell(record.requiredForIntents).split('|').filter(Boolean) as OwnKbExpertIntent[],
      questionIdHashes: compactCsvCell(record.questionIdHashes).split('|').filter(Boolean),
      requiredSourceMetadata: compactCsvCell(record.requiredSourceMetadata).split('|').filter(Boolean),
      reviewerInstructions: compactCsvCell(record.reviewerInstructions).split('|').filter(Boolean),
      forbiddenSourceContent: compactCsvCell(record.forbiddenSourceContent).split('|').filter(Boolean),
      syntheticOnly: compactCsvCell(record.syntheticOnly) === 'true',
      approvedForMilestone: compactCsvCell(record.approvedForMilestone) === 'SOURCE_REQUIREMENTS_REVIEWED'
        ? 'SOURCE_REQUIREMENTS_REVIEWED'
        : 'DRAFT_ONLY',
      promotionEvidenceUsable: false,
    };
  });
}

function validateOwnKbSourceRequirementsCsv(csv: string): {
  rows: OwnKbSourceRequirement[];
  issues: OwnKbFactIntakeValidationIssue[];
} {
  const parsed = parseCsvWithStatus(csv);
  const [headerRow, ...dataRows] = parsed.rows;
  const issues: OwnKbFactIntakeValidationIssue[] = [];
  if (parsed.malformedQuotes || !headerRow) {
    issues.push('SOURCE_REQUIREMENTS_HEADER_INVALID');
  } else {
    const headers = headerRow.map((cell) => cell.trim());
    const duplicateColumns = headers.some((header, index) => headers.indexOf(header) !== index);
    const missing = OWN_KB_SOURCE_REQUIREMENTS_REQUIRED_COLUMNS.some((column) => !headers.includes(column));
    const unknown = headers.some((header) => !OWN_KB_SOURCE_REQUIREMENTS_REQUIRED_COLUMNS.includes(header as typeof OWN_KB_SOURCE_REQUIREMENTS_REQUIRED_COLUMNS[number]));
    if (duplicateColumns || missing || unknown) issues.push('SOURCE_REQUIREMENTS_HEADER_INVALID');
  }

  const rows = parseOwnKbSourceRequirementsCsv(csv);
  if (rows.length < MIN_FACT_INTAKE_SOURCE_REQUIREMENT_ROWS) issues.push('SOURCE_REQUIREMENTS_TOO_SMALL');

  const rawRows = dataRows.map((row) => {
    const record: Record<string, string> = {};
    const headers = headerRow?.map((cell) => cell.trim()) ?? [];
    headers.forEach((header, index) => {
      record[header] = compactCsvCell(row[index] ?? '');
    });
    return record;
  });

  rows.forEach((row, index) => {
    const raw = rawRows[index] ?? {};
    const validEvidenceNeed = OWN_KB_EVIDENCE_NEEDS.includes(row.evidenceNeed);
    const validIntents = row.requiredForIntents.length > 0
      && row.requiredForIntents.every((intent) => OWN_KB_EXPERT_INTENTS.includes(intent));
    const validMetadata = validEvidenceNeed
      && metadataForEvidenceNeed(row.evidenceNeed).every((metadata) => row.requiredSourceMetadata.includes(metadata));
    if (
      !validEvidenceNeed
      || row.questionCount <= 0
      || row.questionIdHashes.length !== row.questionCount
      || !['low', 'medium', 'high'].includes(row.highestRisk)
      || !validIntents
      || row.reviewerInstructions.length === 0
      || row.forbiddenSourceContent.length === 0
      || raw.syntheticOnly !== 'false'
      || raw.approvedForMilestone !== 'SOURCE_REQUIREMENTS_REVIEWED'
      || raw.promotionEvidenceUsable !== 'false'
    ) {
      issues.push('SOURCE_REQUIREMENTS_ROW_INVALID');
    }
    if (!validMetadata) issues.push('SOURCE_REQUIREMENTS_METADATA_INCOMPLETE');
  });

  if (duplicateValues(rows.map((row) => row.evidenceNeed)).length > 0) {
    issues.push('SOURCE_REQUIREMENT_DUPLICATE');
  }

  return { rows, issues };
}

export function buildOwnKbFactIntakeTemplateCsv(rows: OwnKbSourceRequirement[]): string {
  return [
    [
      'factTemplateId',
      'evidenceNeed',
      'sourceTitle',
      'sourceReference',
      'sourceVersionId',
      'sourceVersionHash',
      'sourceText',
      'risk',
      'allowedUse',
      'reviewStatus',
      'verifiedAt',
      'expiresAt',
      'reviewerHandle',
      'notes',
      'questionCount',
      'requiredForIntents',
      'syntheticOnly',
      'approvedForMilestone',
      'promotionEvidenceUsable',
    ].map(csvValue).join(','),
    ...rows.map((row, index) => [
      `fact_template_${String(index + 1).padStart(2, '0')}_${row.evidenceNeed}`,
      row.evidenceNeed,
      '',
      '',
      '',
      '',
      '',
      row.highestRisk,
      row.highestRisk === 'high' ? 'human_review_required' : 'voice_agent',
      'draft',
      '',
      '',
      '',
      'Fill from approved/current business source. Do not include raw caller content or secrets.',
      String(row.questionCount),
      row.requiredForIntents.join('|'),
      'true',
      'DRAFT_ONLY',
      'false',
    ].map(csvValue).join(',')),
  ].join('\n') + '\n';
}

function parseCsvWithStatus(csv: string): { rows: string[][]; malformedQuotes: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { rows: rows.filter((entry) => entry.some((cellValue) => cellValue.trim())), malformedQuotes: inQuotes };
}

function compactCsvCell(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function validUtcIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value ? null : date;
}

function hasSpreadsheetFormula(value: string): boolean {
  return /^[=+\-@]/.test(value.trim());
}

function hasPlaceholder(value: string): boolean {
  return FACT_INTAKE_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function hasPromptInjection(value: string): boolean {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
  if (FACT_INTAKE_PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  const encodedCandidates = normalized.match(/\b[A-Za-z0-9+/]{24,}={0,2}\b/g) ?? [];
  return encodedCandidates.some((candidate) => {
    try {
      const decoded = Buffer.from(candidate, 'base64').toString('utf8');
      if (!decoded || decoded === candidate || /[\u0000-\u0008\u000E-\u001F]/.test(decoded)) return false;
      const decodedNormalized = decoded
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
      return FACT_INTAKE_PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(decodedNormalized));
    } catch {
      return false;
    }
  });
}

function hasSecretOrOperationalDetail(value: string): boolean {
  return FACT_INTAKE_SECRET_OR_OPERATIONAL_PATTERNS.some((pattern) => pattern.test(value));
}

function hasPiiOrRedactionToken(value: string): boolean {
  return Boolean(value) && (redactForEval(value) !== value || FACT_INTAKE_REDACTION_TOKEN_PATTERN.test(value));
}

function neutralReviewerHandle(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value) && !value.includes('@') && !/[\\/]/.test(value);
}

function countIssues(issues: OwnKbFactIntakeValidationIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) counts[issue] = (counts[issue] ?? 0) + 1;
  return counts;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacSha256(secret: string, value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function weakFactIntakeApprovalSecret(secret: string | undefined): boolean {
  const normalized = secret?.trim() ?? '';
  if (normalized.length < MIN_FACT_INTAKE_APPROVAL_SECRET_LENGTH) return true;
  if (new Set([...normalized]).size < MIN_FACT_INTAKE_APPROVAL_SECRET_UNIQUE_CHARS) return true;
  if (!/[A-Za-z]/.test(normalized) || !/[^A-Za-z]/.test(normalized)) return true;
  if (/^(.+?)\1+$/u.test(normalized)) return true;
  return false;
}

function safeScopeId(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,128}$/.test(value);
}

function duplicateValues(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function manifestKey(value: Pick<OwnKbFactIntakeApprovalManifestEntry, 'factTemplateId' | 'evidenceNeed'>): string {
  return `${value.factTemplateId}::${value.evidenceNeed}`;
}

function parseOwnKbFactIntakeApprovalManifest(manifestJson?: string): OwnKbFactIntakeApprovalManifest | null {
  if (!manifestJson?.trim()) return null;
  try {
    const value = JSON.parse(manifestJson) as unknown;
    if (!isObject(value) || !Array.isArray(value.entries)) return null;
    return {
      kind: value.kind as OwnKbFactIntakeApprovalManifest['kind'],
      manifestId: compactCsvCell(value.manifestId),
      approvedBy: compactCsvCell(value.approvedBy),
      approvedAt: compactCsvCell(value.approvedAt),
      orgId: compactCsvCell(value.orgId),
      tenantId: compactCsvCell(value.tenantId),
      factIntakeSha256: compactCsvCell(value.factIntakeSha256),
      sourceRequirementsSha256: compactCsvCell(value.sourceRequirementsSha256),
      sourceCount: Number.isInteger(value.sourceCount) ? value.sourceCount as number : -1,
      syntheticOnly: value.syntheticOnly as false,
      approvedForMilestone: value.approvedForMilestone as 'SOURCE_GENERATION',
      promotionEvidenceUsable: value.promotionEvidenceUsable as false,
      entries: value.entries.map((entry: unknown) => {
        const record = isObject(entry) ? entry : {};
        return {
          factTemplateId: compactCsvCell(record.factTemplateId),
          evidenceNeed: compactCsvCell(record.evidenceNeed),
          sourceReference: compactCsvCell(record.sourceReference),
          sourceVersionId: compactCsvCell(record.sourceVersionId),
          sourceVersionHash: compactCsvCell(record.sourceVersionHash),
          reviewerHandle: compactCsvCell(record.reviewerHandle),
        };
      }),
      approvalSignature: compactCsvCell(value.approvalSignature),
    };
  } catch {
    return null;
  }
}

function approvalManifestSignaturePayload(
  manifest: Omit<OwnKbFactIntakeApprovalManifest, 'approvalSignature'>,
): string {
  return JSON.stringify({
    kind: manifest.kind,
    manifestId: manifest.manifestId,
    approvedBy: manifest.approvedBy,
    approvedAt: manifest.approvedAt,
    orgId: manifest.orgId,
    tenantId: manifest.tenantId,
    factIntakeSha256: manifest.factIntakeSha256,
    sourceRequirementsSha256: manifest.sourceRequirementsSha256,
    sourceCount: manifest.sourceCount,
    syntheticOnly: manifest.syntheticOnly,
    approvedForMilestone: manifest.approvedForMilestone,
    promotionEvidenceUsable: manifest.promotionEvidenceUsable,
    entries: [...manifest.entries].sort((a, b) => manifestKey(a).localeCompare(manifestKey(b))),
  });
}

export function createOwnKbFactIntakeApprovalSignature(
  manifest: Omit<OwnKbFactIntakeApprovalManifest, 'approvalSignature'>,
  approvalSecret: string,
): string {
  return hmacSha256(approvalSecret, approvalManifestSignaturePayload(manifest));
}

function validateOwnKbFactIntakeApprovalManifest(
  rows: OwnKbFactIntakeRow[],
  factIntakeCsv: string,
  sourceRequirementsCsv: string | undefined,
  manifestJson: string | undefined,
  now: Date,
  options: OwnKbFactIntakeSourceGenerationOptions = {},
): {
  manifest: OwnKbFactIntakeApprovalManifest | null;
  issues: OwnKbFactIntakeValidationIssue[];
} {
  if (!manifestJson?.trim()) {
    return { manifest: null, issues: ['SOURCE_APPROVAL_MANIFEST_REQUIRED'] };
  }
  const manifest = parseOwnKbFactIntakeApprovalManifest(manifestJson);
  if (!manifest) {
    return { manifest: null, issues: ['SOURCE_APPROVAL_MANIFEST_INVALID'] };
  }

  const issues: OwnKbFactIntakeValidationIssue[] = [];
  const trustedScope = isTrustedScope(options.trustedScope) ? options.trustedScope : null;
  if (!trustedScope) issues.push('SOURCE_GENERATION_TRUSTED_SCOPE_REQUIRED');
  if (
    manifest.kind !== 'own_kb_fact_intake_approval_manifest'
    || !manifest.manifestId
    || !neutralReviewerHandle(manifest.approvedBy)
    || !validUtcIso(manifest.approvedAt)
    || (validUtcIso(manifest.approvedAt) && validUtcIso(manifest.approvedAt)! > now)
    || !safeScopeId(manifest.orgId)
    || !safeScopeId(manifest.tenantId)
    || !manifest.factIntakeSha256
    || !manifest.sourceRequirementsSha256
    || manifest.sourceCount !== manifest.entries.length
  ) {
    issues.push('SOURCE_APPROVAL_MANIFEST_INVALID');
  }
  if (
    trustedScope
    && (manifest.orgId !== trustedScope.orgId || manifest.tenantId !== trustedScope.tenantId)
  ) {
    issues.push('SOURCE_APPROVAL_MANIFEST_SCOPE_MISMATCH');
  }
  if (!manifest.approvalSignature) {
    issues.push('SOURCE_APPROVAL_MANIFEST_SIGNATURE_REQUIRED');
  } else if (!options.approvalSecret) {
    issues.push('SOURCE_APPROVAL_MANIFEST_SIGNATURE_INVALID');
  } else {
    if (weakFactIntakeApprovalSecret(options.approvalSecret)) {
      issues.push('SOURCE_APPROVAL_SECRET_WEAK');
    }
    const expected = createOwnKbFactIntakeApprovalSignature(
      {
        kind: manifest.kind,
        manifestId: manifest.manifestId,
        approvedBy: manifest.approvedBy,
        approvedAt: manifest.approvedAt,
        orgId: manifest.orgId,
        tenantId: manifest.tenantId,
        factIntakeSha256: manifest.factIntakeSha256,
        sourceRequirementsSha256: manifest.sourceRequirementsSha256,
        sourceCount: manifest.sourceCount,
        syntheticOnly: manifest.syntheticOnly,
        approvedForMilestone: manifest.approvedForMilestone,
        promotionEvidenceUsable: manifest.promotionEvidenceUsable,
        entries: manifest.entries,
      },
      options.approvalSecret,
    );
    if (manifest.approvalSignature !== expected) issues.push('SOURCE_APPROVAL_MANIFEST_SIGNATURE_INVALID');
  }
  if (
    manifest.factIntakeSha256 !== sha256(factIntakeCsv)
    || !sourceRequirementsCsv
    || manifest.sourceRequirementsSha256 !== sha256(sourceRequirementsCsv)
  ) {
    issues.push('SOURCE_APPROVAL_MANIFEST_INPUT_HASH_MISMATCH');
  }
  if (
    manifest.syntheticOnly !== false
    || manifest.approvedForMilestone !== 'SOURCE_GENERATION'
    || manifest.promotionEvidenceUsable !== false
  ) {
    issues.push('SOURCE_APPROVAL_MANIFEST_NOT_APPROVED');
  }

  const rowKeys = rows.map(manifestKey);
  const entryKeys = manifest.entries.map(manifestKey);
  const duplicateEntryKeys = duplicateValues(entryKeys);
  if (duplicateEntryKeys.length > 0) issues.push('SOURCE_APPROVAL_MANIFEST_ENTRY_DUPLICATE');
  if (rowKeys.some((key) => !entryKeys.includes(key))) issues.push('SOURCE_APPROVAL_MANIFEST_ENTRY_MISSING');
  if (entryKeys.some((key) => !rowKeys.includes(key))) issues.push('SOURCE_APPROVAL_MANIFEST_ENTRY_EXTRA');

  const entriesByKey = new Map(manifest.entries.map((entry) => [manifestKey(entry), entry]));
  if (manifest.entries.some((entry) => entry.reviewerHandle.toLowerCase() === manifest.approvedBy.toLowerCase())) {
    issues.push('SOURCE_APPROVAL_REVIEWER_NOT_SEPARATE');
  }
  for (const row of rows) {
    const entry = entriesByKey.get(manifestKey(row));
    if (!entry) continue;
    if (
      entry.sourceReference !== row.sourceReference
      || entry.sourceVersionId !== row.sourceVersionId
      || entry.sourceVersionHash !== row.sourceVersionHash
      || entry.reviewerHandle !== row.reviewerHandle
    ) {
      issues.push('SOURCE_APPROVAL_MANIFEST_ENTRY_MISMATCH');
      break;
    }
  }

  return { manifest, issues };
}

export function parseOwnKbFactIntakeCsv(csv: string): OwnKbFactIntakeRow[] {
  const [headerRow, ...dataRows] = parseCsvWithStatus(csv).rows;
  if (!headerRow) return [];
  const headers = headerRow.map((cell) => cell.trim());
  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = compactCsvCell(row[index] ?? '');
    });
    return {
      factTemplateId: record.factTemplateId ?? '',
      evidenceNeed: record.evidenceNeed ?? '',
      sourceTitle: record.sourceTitle ?? '',
      sourceReference: record.sourceReference ?? '',
      sourceVersionId: record.sourceVersionId ?? '',
      sourceVersionHash: record.sourceVersionHash ?? '',
      sourceText: record.sourceText ?? '',
      risk: record.risk ?? '',
      allowedUse: record.allowedUse ?? '',
      reviewStatus: record.reviewStatus ?? '',
      verifiedAt: record.verifiedAt ?? '',
      expiresAt: record.expiresAt ?? '',
      reviewerHandle: record.reviewerHandle ?? '',
      notes: record.notes ?? '',
      questionCount: record.questionCount ?? '',
      requiredForIntents: record.requiredForIntents ?? '',
      syntheticOnly: record.syntheticOnly ?? '',
      approvedForMilestone: record.approvedForMilestone ?? '',
      promotionEvidenceUsable: record.promotionEvidenceUsable ?? '',
    };
  });
}

export function validateOwnKbFactIntakeCsvHeaders(csv: string): OwnKbFactIntakeValidationIssue[] {
  const parsed = parseCsvWithStatus(csv);
  if (parsed.malformedQuotes) return ['CSV_MALFORMED_QUOTES'];
  const [headerRow] = parsed.rows;
  if (!headerRow) return ['CSV_HEADER_REQUIRED'];
  const headers = headerRow.map((cell) => cell.trim());
  const duplicateColumns = headers.some((header, index) => headers.indexOf(header) !== index);
  const missing = OWN_KB_FACT_INTAKE_REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  const unknown = headers.filter((header) => !OWN_KB_FACT_INTAKE_REQUIRED_COLUMNS.includes(header as typeof OWN_KB_FACT_INTAKE_REQUIRED_COLUMNS[number]));
  return [
    ...(duplicateColumns ? ['CSV_DUPLICATE_COLUMNS' as const] : []),
    ...(missing.length > 0 ? ['CSV_REQUIRED_COLUMNS_MISSING' as const] : []),
    ...(unknown.length > 0 ? ['CSV_UNKNOWN_COLUMNS' as const] : []),
  ];
}

export function validateOwnKbFactIntakeRow(
  row: OwnKbFactIntakeRow,
  now = new Date(),
): OwnKbFactIntakeValidationIssue[] {
  const issues: OwnKbFactIntakeValidationIssue[] = [];
  const checkedText = [
    row.factTemplateId,
    row.sourceTitle,
    row.sourceReference,
    row.sourceVersionId,
    row.sourceVersionHash,
    row.sourceText,
    row.notes,
  ].join('\n');

  if (!row.factTemplateId) issues.push('FACT_TEMPLATE_ID_REQUIRED');
  if (!OWN_KB_EVIDENCE_NEEDS.includes(row.evidenceNeed as OwnKbEvidenceNeed)) issues.push('EVIDENCE_NEED_NOT_ALLOWED');
  if (!row.sourceTitle) issues.push('SOURCE_TITLE_REQUIRED');
  if (!row.sourceReference) issues.push('SOURCE_REFERENCE_REQUIRED');
  if (!row.sourceVersionId) issues.push('SOURCE_VERSION_ID_REQUIRED');
  if (!row.sourceVersionHash) issues.push('SOURCE_VERSION_HASH_REQUIRED');
  if (!row.sourceText) issues.push('SOURCE_TEXT_REQUIRED');
  if (row.sourceText && row.sourceText.length < 24) issues.push('SOURCE_TEXT_TOO_SHORT');
  if (row.sourceText && row.sourceVersionHash && row.sourceVersionHash !== sha256(row.sourceText)) {
    issues.push('SOURCE_VERSION_HASH_MISMATCH');
  }
  if (!FACT_INTAKE_ALLOWED_RISKS.has(row.risk)) issues.push('RISK_NOT_ALLOWED');
  if (!FACT_INTAKE_ALLOWED_USES.has(row.allowedUse)) issues.push('ALLOWED_USE_NOT_ALLOWED');
  if (!FACT_INTAKE_ALLOWED_REVIEW_STATUSES.has(row.reviewStatus)) issues.push('REVIEW_STATUS_NOT_APPROVED');

  const verifiedAt = validUtcIso(row.verifiedAt);
  const expiresAt = validUtcIso(row.expiresAt);
  if (!verifiedAt) issues.push('VERIFIED_AT_INVALID');
  if (!expiresAt) issues.push('EXPIRES_AT_INVALID');
  if (verifiedAt && expiresAt && expiresAt <= verifiedAt) issues.push('EXPIRES_AT_NOT_AFTER_VERIFIED_AT');
  if (expiresAt && expiresAt <= now) issues.push('EXPIRES_AT_NOT_FUTURE');
  if (!neutralReviewerHandle(row.reviewerHandle)) issues.push('REVIEWER_HANDLE_INVALID');
  if (hasPlaceholder(checkedText)) issues.push('PLACEHOLDER_CONTENT');
  if (hasPiiOrRedactionToken(checkedText)) issues.push('PII_DETECTED');
  if (hasPromptInjection(checkedText)) issues.push('PROMPT_INJECTION_DETECTED');
  if (hasSecretOrOperationalDetail(checkedText)) issues.push('SECRET_OR_OPERATIONAL_DETAIL_DETECTED');
  if ([
    row.factTemplateId,
    row.evidenceNeed,
    row.sourceTitle,
    row.sourceReference,
    row.sourceVersionId,
    row.sourceVersionHash,
    row.sourceText,
    row.notes,
  ].some(hasSpreadsheetFormula)) {
    issues.push('CSV_FORMULA_INJECTION_DETECTED');
  }
  if (
    row.syntheticOnly !== 'false'
    || row.approvedForMilestone !== 'SOURCE_REVIEWED'
    || row.promotionEvidenceUsable !== 'false'
  ) {
    issues.push('DRAFT_MARKER_NOT_CLEARED');
  }

  return issues;
}

export function validateOwnKbFactIntakeCsv(
  csv: string,
  now = new Date(),
  sourceRequirementsCsv?: string,
  sourceApprovalManifestJson?: string,
  options: OwnKbFactIntakeSourceGenerationOptions = {},
): OwnKbFactIntakeValidationReport {
  const headerIssues = validateOwnKbFactIntakeCsvHeaders(csv);
  const rows = parseOwnKbFactIntakeCsv(csv);
  const parsed = parseCsvWithStatus(csv).rows;
  const headerWidth = parsed[0]?.length ?? 0;
  const rowColumnIssues = parsed.slice(1).some((row) => row.length !== headerWidth)
    ? ['CSV_ROW_COLUMN_COUNT_MISMATCH' as const]
    : [];
  const rowIssueSets = rows.map((row) => validateOwnKbFactIntakeRow(row, now));
  const sourceRequirementValidation = sourceRequirementsCsv
    ? validateOwnKbSourceRequirementsCsv(sourceRequirementsCsv)
    : undefined;
  const requiredEvidenceNeeds = sourceRequirementValidation
    ? sourceRequirementValidation.rows.map((row) => row.evidenceNeed).filter((value) => OWN_KB_EVIDENCE_NEEDS.includes(value))
    : undefined;
  const coveredEvidenceNeeds = uniqueSorted(rows.map((row) => row.evidenceNeed).filter((value) => OWN_KB_EVIDENCE_NEEDS.includes(value as OwnKbEvidenceNeed)));
  const duplicateEvidenceNeeds = duplicateValues(rows.map((row) => row.evidenceNeed).filter((value) => OWN_KB_EVIDENCE_NEEDS.includes(value as OwnKbEvidenceNeed)));
  const missingEvidenceNeeds = requiredEvidenceNeeds
    ? requiredEvidenceNeeds.filter((need) => !coveredEvidenceNeeds.includes(need))
    : [];
  const extraEvidenceNeeds = requiredEvidenceNeeds
    ? coveredEvidenceNeeds.filter((need) => !requiredEvidenceNeeds.includes(need as OwnKbEvidenceNeed))
    : [];
  const coverageIssues: OwnKbFactIntakeValidationIssue[] = [
    ...(sourceRequirementValidation?.issues ?? []),
    ...(sourceRequirementsCsv && requiredEvidenceNeeds?.length === 0 ? ['SOURCE_REQUIREMENTS_INVALID' as const] : []),
    ...missingEvidenceNeeds.map(() => 'SOURCE_REQUIREMENT_MISSING' as const),
    ...extraEvidenceNeeds.map(() => 'SOURCE_REQUIREMENT_EXTRA' as const),
    ...duplicateEvidenceNeeds.map(() => 'SOURCE_REQUIREMENT_DUPLICATE' as const),
  ];
  const approvalManifestValidation = validateOwnKbFactIntakeApprovalManifest(
    rows,
    csv,
    sourceRequirementsCsv,
    sourceApprovalManifestJson,
    now,
    options,
  );
  const allIssues = [
    ...headerIssues,
    ...rowColumnIssues,
    ...(rows.length === 0 ? ['FACT_ROWS_REQUIRED' as const] : []),
    ...rowIssueSets.flat(),
    ...coverageIssues,
    ...approvalManifestValidation.issues,
  ];
  const invalidRows = rowIssueSets.filter((issues) => issues.length > 0).length;
  const sourceRequirementsProvided = Boolean(sourceRequirementsCsv?.trim());
  const sourceApprovalManifestProvided = Boolean(sourceApprovalManifestJson?.trim());
  const sourceGenerationBlockers = uniqueSorted([
    ...(!sourceRequirementsProvided ? ['SOURCE_REQUIREMENTS_REQUIRED' as const] : []),
    ...approvalManifestValidation.issues,
    ...allIssues,
  ]);
  const sourceGenerationReady = sourceRequirementsProvided
    && sourceGenerationBlockers.length === 0
    && rows.length > 0
    && invalidRows === 0
    && headerIssues.length === 0
    && rowColumnIssues.length === 0
    && sourceApprovalManifestProvided;
  return {
    kind: 'own_kb_fact_intake_validation',
    rows: rows.length,
    validRows: rows.length - invalidRows,
    invalidRows: invalidRows + (headerIssues.length > 0 || rowColumnIssues.length > 0 || rows.length === 0 || coverageIssues.length > 0 ? 1 : 0),
    issueCounts: countIssues(allIssues),
    requiredEvidenceNeeds: requiredEvidenceNeeds ? uniqueSorted(requiredEvidenceNeeds) : undefined,
    coveredEvidenceNeeds,
    missingEvidenceNeeds,
    extraEvidenceNeeds,
    duplicateEvidenceNeeds,
    sourceRequirementsProvided,
    sourceRequirementRows: sourceRequirementValidation?.rows.length ?? 0,
    sourceApprovalManifestProvided,
    sourceApprovalManifestEntries: approvalManifestValidation.manifest?.entries.length ?? 0,
    sourceGenerationReady,
    sourceGenerationBlockers,
    sourcesWritten: false,
    createsBusinessFacts: false,
    promotionEvidenceUsable: false,
  };
}

export function buildOwnKbSourcesFromFactIntakeCsv(
  csv: string,
  now = new Date(),
  sourceRequirementsCsv?: string,
  sourceApprovalManifestJson?: string,
  options: OwnKbFactIntakeSourceGenerationOptions = {},
): OwnKbFactIntakeBuildResult {
  const report = validateOwnKbFactIntakeCsv(csv, now, sourceRequirementsCsv, sourceApprovalManifestJson, options);
  if (!sourceRequirementsCsv) {
    return {
      report: {
        ...report,
        invalidRows: report.invalidRows + 1,
        issueCounts: {
          ...report.issueCounts,
          SOURCE_REQUIREMENTS_REQUIRED: (report.issueCounts.SOURCE_REQUIREMENTS_REQUIRED ?? 0) + 1,
        },
      },
      sources: [],
    };
  }
  if (!report.sourceGenerationReady) return { report, sources: [] };
  const trustedScope = isTrustedScope(options.trustedScope) ? options.trustedScope : null;
  if (!trustedScope) return { report, sources: [] };
  return {
    report,
    sources: parseOwnKbFactIntakeCsv(csv).map((row) => {
      const contentHash = sha256(row.sourceText);
      return {
        id: `fact_intake_${hashOwnKbAuthoringId(`${row.evidenceNeed}:${row.sourceVersionId}:${row.sourceVersionHash}`)}`,
        orgId: trustedScope.orgId,
        tenantId: trustedScope.tenantId,
        type: 'text',
        name: row.sourceTitle,
        content: row.sourceText,
        sha256: contentHash,
        contentHash,
        category: `fact_intake_${row.evidenceNeed}`,
        allowedUse: row.allowedUse,
        sourceOfTruth: 'human_reviewed_fact_intake',
        owner: row.reviewerHandle,
        verifiedAt: new Date(row.verifiedAt).toISOString(),
        expiresAt: new Date(row.expiresAt).toISOString(),
        containsPii: false,
        reviewStatus: row.reviewStatus,
        risk: row.risk,
        autoRefresh: false,
      };
    }),
  };
}
