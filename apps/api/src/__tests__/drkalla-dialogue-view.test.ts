import { describe, expect, it } from 'vitest';
import {
  buildDrkallaDialogueResponsePlan,
  buildDrkallaDialogueView,
} from '../drkalla-dialogue-view.js';
import {
  createDrkallaShortTermMemory,
  reduceDrkallaShortTermMemory,
} from '../drkalla-short-term-memory.js';

function twoProductMemory() {
  const first = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
    type: 'agent_spoke',
    turnIndex: 1,
    text: 'Das Serum pflegt die Spitzen.',
    lastProduct: {
      spokenName: 'Luxe-Oel Serum',
      productId: 'luxe-oel-serum',
      productKind: 'Serum',
    },
    factsMentioned: [
      { key: 'product.luxe-oel-serum.description', label: 'Beschreibung' },
      { key: 'product.luxe-oel-serum.price', label: 'Preis' },
    ],
  });
  return reduceDrkallaShortTermMemory(first, {
    type: 'agent_spoke',
    turnIndex: 2,
    text: 'Das Leave-in bleibt im Haar.',
    lastProduct: {
      spokenName: 'Luxe-Oel Leave-in',
      productId: 'luxe-oel-leave-in',
      productKind: 'Leave-in',
    },
    factsMentioned: [
      { key: 'product.luxe-oel-leave-in.description', label: 'Beschreibung' },
    ],
  });
}

describe('DrKalla dialogue view', () => {
  it('looks at "was ist der Unterschied" from the comparison level, not category level', () => {
    const view = buildDrkallaDialogueView(twoProductMemory(), 'Was ist der Unterschied?');

    expect(view.level).toBe('product_comparison');
    expect(view.nextAction).toBe('compare_recent_products');
    expect(view.activeProducts.map((product) => product.spokenName)).toEqual([
      'Luxe-Oel Serum',
      'Luxe-Oel Leave-in',
    ]);
    expect(view.forbiddenMoves).toEqual(expect.arrayContaining([
      'category_reset',
      'repeat_known_product_facts',
    ]));
    expect(view.isEvidence).toBe(false);
  });

  it('looks at purchase follow-ups from the active product funnel', () => {
    const view = buildDrkallaDialogueView(twoProductMemory(), 'Wie kaufe ich das?');

    expect(view.level).toBe('active_product');
    expect(view.nextAction).toBe('offer_product_link');
    expect(view.forbiddenMoves).toContain('category_reset');
    expect(view.forbiddenMoves).toContain('contact_loop');
  });

  it('uses active product type for brand or selection questions instead of global brand lists', () => {
    const memory = reduceDrkallaShortTermMemory(createDrkallaShortTermMemory(), {
      type: 'agent_spoke',
      turnIndex: 1,
      text: 'Wir sprechen ueber Haarfarben.',
      lastProduct: {
        spokenName: 'Synthesis Color Cream',
        productId: 'synthesis-color-cream',
        productKind: 'Haarfarbe/Farbcreme',
      },
    });
    const view = buildDrkallaDialogueView(memory, 'Welche Marken habt ihr?');

    expect(view.level).toBe('active_product_type');
    expect(view.activeProductType).toBe('Haarfarbe/Farbcreme');
    expect(view.nextAction).toBe('list_active_product_type_selection');
    expect(view.forbiddenMoves).toContain('ask_for_category_when_type_known');
  });

  it('starts at discovery level only when no product or product type is active', () => {
    const view = buildDrkallaDialogueView(createDrkallaShortTermMemory(), 'Ich suche eine Haarfarbe.');

    expect(view.level).toBe('discovery');
    expect(view.nextAction).toBe('ask_goal_or_product_type');
    expect(view.activeProducts).toEqual([]);
  });

  it('turns comparison view into a short response plan without category reset', () => {
    const view = buildDrkallaDialogueView(twoProductMemory(), 'Was ist der Unterschied?');
    const plan = buildDrkallaDialogueResponsePlan(view);

    expect(plan.plan).toBe('compare_recent_products');
    expect(plan.mustDo).toEqual(expect.arrayContaining([
      'compare_only_recent_active_products',
      'keep_answer_to_two_short_sentences',
    ]));
    expect(plan.mustNotDo).toEqual(expect.arrayContaining([
      'offer_product_category',
      'repeat_known_product_facts_unless_asked',
    ]));
    expect(plan.suggestedClosingMove).toBe('ask_product_link_or_selection_next');
    expect(plan.isEvidence).toBe(false);
  });

  it('turns active-product purchase view into link or availability next step', () => {
    const view = buildDrkallaDialogueView(twoProductMemory(), 'Wie kaufe ich das?');
    const plan = buildDrkallaDialogueResponsePlan(view);

    expect(plan.plan).toBe('offer_product_link');
    expect(plan.mustDo).toContain('offer_specific_product_link_or_availability');
    expect(plan.mustNotDo).toContain('offer_product_category');
    expect(plan.suggestedClosingMove).toBe('ask_send_product_link');
  });
});
