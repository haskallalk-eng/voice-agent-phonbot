import {
  getDrkallaProductConversationState,
  nextDrkallaProductFunnelAction,
  type DrkallaProductFunnelAction,
  type DrkallaShortTermVoiceMemory,
} from './drkalla-short-term-memory.js';

export type DrkallaDialogueLevel =
  | 'discovery'
  | 'active_product_type'
  | 'active_product'
  | 'product_comparison';

export type DrkallaForbiddenDialogueMove =
  | 'category_reset'
  | 'contact_loop'
  | 'repeat_known_product_facts'
  | 'ask_for_category_when_type_known';

export type DrkallaDialogueView = {
  level: DrkallaDialogueLevel;
  isEvidence: false;
  nextAction: DrkallaProductFunnelAction;
  activeProductType: string | null;
  activeProducts: Array<{
    spokenName: string;
    productKind: string | null;
    knownFacts: string[];
  }>;
  forbiddenMoves: DrkallaForbiddenDialogueMove[];
};

export type DrkallaDialogueResponsePlan = {
  plan: DrkallaProductFunnelAction;
  isEvidence: false;
  mustDo: string[];
  mustNotDo: string[];
  suggestedClosingMove:
    | 'ask_goal_or_product_type'
    | 'ask_product_link_or_selection_next'
    | 'ask_send_product_link'
    | 'ask_product_variant_or_need'
    | 'ask_product_or_profi_link';
};

function uniqueForbiddenMoves(moves: DrkallaForbiddenDialogueMove[]): DrkallaForbiddenDialogueMove[] {
  return [...new Set(moves)];
}

function activeProducts(memory: DrkallaShortTermVoiceMemory): DrkallaDialogueView['activeProducts'] {
  return memory.recentProducts.map((product) => {
    const state = getDrkallaProductConversationState(memory, product.spokenName);
    return {
      spokenName: product.spokenName,
      productKind: product.productKind,
      knownFacts: Object.entries(state?.facts ?? {})
        .filter(([, known]) => known === true)
        .map(([fact]) => fact)
        .sort(),
    };
  });
}

export function buildDrkallaDialogueView(
  memory: DrkallaShortTermVoiceMemory,
  userText: string,
): DrkallaDialogueView {
  const nextAction = nextDrkallaProductFunnelAction(memory, userText);
  const hasComparisonIntent = nextAction === 'compare_recent_products';
  const hasActiveProduct = Boolean(memory.lastMentionedProduct);
  const hasActiveProductType = Boolean(memory.activeProductType);

  const level: DrkallaDialogueLevel = hasComparisonIntent
    ? 'product_comparison'
    : hasActiveProduct && nextAction !== 'list_active_product_type_selection'
      ? 'active_product'
      : hasActiveProductType
        ? 'active_product_type'
        : 'discovery';

  const forbiddenMoves: DrkallaForbiddenDialogueMove[] = [];
  if (level !== 'discovery') forbiddenMoves.push('category_reset');
  if (level === 'active_product' || level === 'product_comparison') {
    forbiddenMoves.push('contact_loop', 'repeat_known_product_facts');
  }
  if (level === 'active_product_type') forbiddenMoves.push('ask_for_category_when_type_known');

  return {
    level,
    isEvidence: false,
    nextAction,
    activeProductType: memory.activeProductType?.label ?? null,
    activeProducts: activeProducts(memory),
    forbiddenMoves: uniqueForbiddenMoves(forbiddenMoves),
  };
}

export function buildDrkallaDialogueResponsePlan(view: DrkallaDialogueView): DrkallaDialogueResponsePlan {
  const mustDo = ['keep_answer_to_two_short_sentences'];
  const mustNotDo = [];

  if (view.forbiddenMoves.includes('category_reset')) mustNotDo.push('offer_product_category');
  if (view.forbiddenMoves.includes('contact_loop')) mustNotDo.push('repeat_contact_option_loop');
  if (view.forbiddenMoves.includes('repeat_known_product_facts')) mustNotDo.push('repeat_known_product_facts_unless_asked');
  if (view.forbiddenMoves.includes('ask_for_category_when_type_known')) mustNotDo.push('ask_for_category_when_type_known');

  switch (view.nextAction) {
    case 'compare_recent_products':
      mustDo.push('compare_only_recent_active_products');
      return {
        plan: view.nextAction,
        isEvidence: false,
        mustDo,
        mustNotDo,
        suggestedClosingMove: 'ask_product_link_or_selection_next',
      };
    case 'offer_product_link':
      mustDo.push('offer_specific_product_link_or_availability');
      return {
        plan: view.nextAction,
        isEvidence: false,
        mustDo,
        mustNotDo,
        suggestedClosingMove: 'ask_send_product_link',
      };
    case 'offer_product_or_profi_link':
      mustDo.push('state_normal_buyer_price_context_once', 'offer_product_or_profi_link_choice');
      return {
        plan: view.nextAction,
        isEvidence: false,
        mustDo,
        mustNotDo,
        suggestedClosingMove: 'ask_product_or_profi_link',
      };
    case 'list_active_product_type_selection':
      mustDo.push('answer_with_active_product_type_selection_only');
      return {
        plan: view.nextAction,
        isEvidence: false,
        mustDo,
        mustNotDo,
        suggestedClosingMove: 'ask_product_variant_or_need',
      };
    case 'clarify_variant':
      mustDo.push('ask_one_targeted_variant_question');
      return {
        plan: view.nextAction,
        isEvidence: false,
        mustDo,
        mustNotDo,
        suggestedClosingMove: 'ask_product_variant_or_need',
      };
    case 'ask_goal_or_product_type':
      mustDo.push('ask_one_discovery_question');
      return {
        plan: view.nextAction,
        isEvidence: false,
        mustDo,
        mustNotDo,
        suggestedClosingMove: 'ask_goal_or_product_type',
      };
  }
}
