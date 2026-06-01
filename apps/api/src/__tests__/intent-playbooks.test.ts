import { describe, expect, it } from 'vitest';
import {
  validateIntentPlaybookPack,
  type IntentPlaybook,
} from '../intent-playbooks.js';

function playbook(index: number, overrides: Partial<IntentPlaybook> = {}): IntentPlaybook {
  return {
    intentId: `intent_${index}`,
    version: '2026-05-30',
    riskClass: 'low',
    intentKind: 'low_risk_faq',
    goal: 'Answer a common caller question safely and briefly.',
    successCriteria: ['caller received a sourced short answer'],
    requiredFields: ['none'],
    allowedQuestions: ['Meinen Sie die normale Oeffnungszeit?'],
    allowedTools: ['knowledge.search'],
    confirmationRequirement: 'none',
    escalationCriteria: ['caller asks for a human'],
    forbiddenClaims: ['Do not invent prices, legal promises, or availability.'],
    goldStandardVoiceAnswers: [
      'Ja, das kann ich kurz beantworten.',
      'Dazu gebe ich dir eine kurze, gepruefte Antwort.',
    ],
    germanAsrVariants: [
      { kind: 'colloquial', value: 'wann habt ihr auf' },
      { kind: 'misspelling', value: 'offnungs zeiten' },
      { kind: 'compound_word', value: 'oeffnungszeiten' },
      { kind: 'umlaut_confusion', value: 'offnungszeiten' },
      { kind: 'number_time', value: 'neun bis achtzehn' },
      { kind: 'service_name', value: 'termin oeffnung' },
    ],
    ...overrides,
  };
}

function validPack(): IntentPlaybook[] {
  const items = Array.from({ length: 30 }, (_, index) => playbook(index + 1));
  items[0] = playbook(1, {
    intentId: 'pricing',
    riskClass: 'pricing',
    intentKind: 'high_risk_pricing_legal_policy',
    confirmationRequirement: 'none',
    forbiddenClaims: ['Do not quote stale or unapproved prices.'],
    goldStandardVoiceAnswers: [
      'Ich pruefe dafuer die aktuelle freigegebene Quelle.',
      'Ohne aktuelle Quelle nenne ich keinen Preis.',
    ],
  });
  items[1] = playbook(2, {
    intentId: 'legal_policy',
    riskClass: 'legal',
    intentKind: 'high_risk_pricing_legal_policy',
    forbiddenClaims: ['Do not give legal advice or policy promises without approved evidence.'],
  });
  items[2] = playbook(3, {
    intentId: 'policy',
    riskClass: 'policy',
    intentKind: 'high_risk_pricing_legal_policy',
    forbiddenClaims: ['Do not promise policy exceptions without approved evidence.'],
  });
  items[3] = playbook(4, {
    intentId: 'booking',
    riskClass: 'medium',
    intentKind: 'booking_mutation',
    requiredFields: ['date', 'time', 'caller_name'],
    allowedQuestions: ['Fuer welchen Tag und welche Uhrzeit soll ich schauen?'],
    allowedTools: ['calendar_find_slots', 'calendar_book'],
    confirmationRequirement: 'confirmed_summary_before_tool',
    forbiddenClaims: ['Do not book before a confirmed summary.'],
    goldStandardVoiceAnswers: [
      'Ich fasse kurz zusammen und buche erst nach deiner Bestaetigung.',
      'Ich habe Tag, Uhrzeit und Namen; soll ich das so buchen?',
    ],
    germanAsrVariants: [
      { kind: 'colloquial', value: 'nen slot' },
      { kind: 'misspelling', value: 'termi buchen' },
      { kind: 'compound_word', value: 'terminbuchung' },
      { kind: 'umlaut_confusion', value: 'fuenf uhr' },
      { kind: 'number_time', value: 'fuenfzehn dreissig' },
      { kind: 'service_name', value: 'beratungstermin' },
    ],
  });
  items[4] = playbook(5, {
    intentId: 'human_escalation',
    riskClass: 'medium',
    intentKind: 'escalation',
    allowedTools: ['ticket_create'],
    confirmationRequirement: 'confirmed_summary_before_tool',
    escalationCriteria: ['caller asks for a human', 'caller is frustrated'],
    forbiddenClaims: ['Do not promise an exact callback time without a tool result.'],
  });
  items[5] = playbook(6, {
    intentId: 'unsupported',
    riskClass: 'low',
    intentKind: 'out_of_scope',
    allowedTools: ['none'],
    confirmationRequirement: 'none',
    escalationCriteria: ['request is outside supported business scope'],
    goldStandardVoiceAnswers: [
      'Das kann ich hier nicht sicher beantworten.',
      'Ich gebe das lieber an das Team weiter, bevor ich etwas Falsches sage.',
    ],
  });
  return items;
}

function itemAt(items: IntentPlaybook[], index: number): IntentPlaybook {
  const item = items[index];
  if (!item) throw new Error(`Missing test playbook at index ${index}`);
  return item;
}

describe('intent playbook contract', () => {
  it('accepts a complete top-intent playbook pack', () => {
    const report = validateIntentPlaybookPack(validPack());

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.coverage).toMatchObject({
      playbookCount: 30,
      uniqueIntentCount: 30,
      hasLowRiskFaq: true,
      hasHighRiskPricingLegalPolicy: true,
      hasPricingRisk: true,
      hasLegalRisk: true,
      hasPolicyRisk: true,
      hasBookingMutation: true,
      hasEscalation: true,
      hasOutOfScope: true,
    });
  });

  it('blocks canary readiness when top-intent coverage is too small or risk categories are missing', () => {
    const report = validateIntentPlaybookPack(validPack().slice(0, 12).map((item) => ({
      ...item,
      intentKind: 'low_risk_faq',
      riskClass: 'low',
    })));

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('INSUFFICIENT_TOP_INTENT_PLAYBOOKS');
    expect(report.blockers).toContain('MISSING_HIGH_RISK_PLAYBOOK');
    expect(report.blockers).toContain('MISSING_PRICING_RISK_PLAYBOOK');
    expect(report.blockers).toContain('MISSING_LEGAL_RISK_PLAYBOOK');
    expect(report.blockers).toContain('MISSING_POLICY_RISK_PLAYBOOK');
    expect(report.blockers).toContain('MISSING_BOOKING_MUTATION_PLAYBOOK');
    expect(report.blockers).toContain('MISSING_ESCALATION_PLAYBOOK');
    expect(report.blockers).toContain('MISSING_OUT_OF_SCOPE_PLAYBOOK');
  });

  it('requires every playbook to include the required conversation contract fields', () => {
    const broken = validPack();
    broken[0] = {
      ...itemAt(broken, 0),
      goal: '',
      successCriteria: [],
      requiredFields: [],
      allowedQuestions: [],
      allowedTools: [],
      forbiddenClaims: [],
      germanAsrVariants: [],
    };

    const report = validateIntentPlaybookPack(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PLAYBOOK_REQUIRED_FIELD_MISSING');
    expect(report.blockers).toContain('PLAYBOOK_REQUIRED_FIELDS_MISSING');
    expect(report.blockers).toContain('PLAYBOOK_ALLOWED_TOOLS_MISSING');
    expect(report.blockers).toContain('GERMAN_ASR_VARIANTS_MISSING');
  });

  it('rejects mutation playbooks that can execute tools before confirmed spoken summary', () => {
    const broken = validPack();
    broken[3] = {
      ...itemAt(broken, 3),
      confirmationRequirement: 'policy_confirmation_before_answer',
    };

    const report = validateIntentPlaybookPack(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('MUTATION_PLAYBOOK_REQUIRES_CONFIRMATION');
  });

  it('rejects unknown tools and treats every registry-mutating tool as confirmation-gated', () => {
    const broken = validPack();
    broken[0] = {
      ...itemAt(broken, 0),
      allowedTools: ['calendar_delete_all' as never],
    };
    broken[3] = {
      ...itemAt(broken, 3),
      allowedTools: ['customer_delete'],
      confirmationRequirement: 'human_handoff_required',
    };

    const report = validateIntentPlaybookPack(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PLAYBOOK_ALLOWED_TOOL_UNKNOWN');
    expect(report.blockers).toContain('MUTATION_PLAYBOOK_REQUIRES_CONFIRMATION');
  });

  it('rejects ambiguous none tool declarations mixed with real tools', () => {
    const broken = validPack();
    broken[0] = {
      ...itemAt(broken, 0),
      allowedTools: ['none', 'knowledge.search'],
    };

    const report = validateIntentPlaybookPack(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PLAYBOOK_NONE_TOOL_MIXED_WITH_REAL_TOOLS');
  });

  it('requires German ASR variants to cover the planned voice reality classes', () => {
    const broken = validPack();
    broken[0] = {
      ...itemAt(broken, 0),
      germanAsrVariants: [
        { kind: 'colloquial', value: 'wann habt ihr auf' },
      ],
    };

    const report = validateIntentPlaybookPack(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('GERMAN_ASR_VARIANT_CLASS_COVERAGE_MISSING');
  });

  it('rejects long, written-style, or under-specified gold voice answers', () => {
    const broken = validPack();
    broken[0] = {
      ...itemAt(broken, 0),
      goldStandardVoiceAnswers: [
        'Hier ist eine sehr lange Antwort mit vielen Details, mehreren Nebensaetzen, Quellenhinweisen, Einschraenkungen und einer zweiten Satzhaelfte, die fuer einen Telefonturn viel zu lang waere.',
        'Mehr findest du unter https://example.invalid/details.',
      ],
    };

    const report = validateIntentPlaybookPack(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('GOLD_VOICE_ANSWER_TOO_LONG');
    expect(report.blockers).toContain('GOLD_VOICE_ANSWER_WRITTEN_STYLE');
  });

  it('rejects draft, synthetic, promotion-marked, or placeholder playbooks', () => {
    const broken = validPack();
    broken[0] = {
      ...itemAt(broken, 0),
      intentId: 'template_booking',
      syntheticOnly: true,
    } as IntentPlaybook;
    broken[1] = {
      ...itemAt(broken, 1),
      goal: 'DRAFT_ONLY content must be replaced.',
      approvedForMilestone: 'DRAFT_ONLY',
    } as IntentPlaybook;
    broken[2] = {
      ...itemAt(broken, 2),
      forbiddenClaims: ['Do not accept syntheticOnly marker content.'],
      promotionEvidenceUsable: true,
    } as IntentPlaybook;
    broken[3] = {
      ...itemAt(broken, 3),
      goal: 'todo_item playbook marker.',
      goldStandardVoiceAnswers: [
        'placeholder_answer eins.',
        'draft_only Antwort zwei.',
      ],
    };

    const report = validateIntentPlaybookPack(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      'PLAYBOOK_SYNTHETIC_MARKER_PRESENT',
      'PLAYBOOK_DRAFT_MARKER_PRESENT',
      'PLAYBOOK_PROMOTION_MARKER_PRESENT',
      'PLAYBOOK_PLACEHOLDER_CONTENT',
    ]));
  });

  it('rejects template marker text even without explicit marker properties', () => {
    const broken = validPack();
    broken[0] = {
      ...itemAt(broken, 0),
      intentId: 'template_booking',
    };
    broken[1] = {
      ...itemAt(broken, 1),
      goal: 'DRAFT_ONLY content must be replaced.',
    };
    broken[2] = {
      ...itemAt(broken, 2),
      forbiddenClaims: ['Do not accept syntheticOnly marker content.'],
    };
    broken[3] = {
      ...itemAt(broken, 3),
      goal: 'todo_item: fill this playbook from real tenant calls.',
      goldStandardVoiceAnswers: [
        'placeholder_answer eins.',
        'draft_only Antwort zwei.',
      ],
    };

    const report = validateIntentPlaybookPack(broken);

    expect(report.ready).toBe(false);
    expect(report.blockers).toContain('PLAYBOOK_PLACEHOLDER_CONTENT');
  });
});
