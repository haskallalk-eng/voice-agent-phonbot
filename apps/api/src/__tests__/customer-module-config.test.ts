import { describe, expect, it } from 'vitest';
import { buildAgentInstructions } from '../agent-instructions.js';
import { normalizeCustomerModuleConfig, normalizeSpokenEmail } from '../customers.js';

type ConfigArg = Parameters<typeof buildAgentInstructions>[0];

function baseCfg(overrides: Partial<ConfigArg> = {}): ConfigArg {
  return {
    tenantId: 'test-tenant',
    name: 'Chipy',
    language: 'de',
    voice: 'voice-x',
    businessName: 'Salon Test',
    businessDescription: 'Friseur in Berlin.',
    address: '',
    openingHours: '',
    servicesText: '',
    services: [],
    systemPrompt: 'Du bist eine freundliche Assistenz.',
    selectedRoles: [],
    customPromptAddition: '',
    roleBlockOverrides: {},
    sectionTextOverrides: {},
    tools: [],
    fallback: { enabled: true, reason: 'handoff' },
    ...overrides,
  } as unknown as ConfigArg;
}

describe('customer module question config', () => {
  it('keeps default conditions for legacy builtin question entries', () => {
    const config = normalizeCustomerModuleConfig({
      enabled: true,
      questions: [
        {
          id: 'hairHistory',
          label: 'Vorbehandlung',
          prompt: 'Bei Farbe oder Chemie: fruehere Farbe, Blondierung, Glaettung, Dauerwelle oder andere chemische Behandlung',
          condition: 'bei Farbe/Chemie',
          enabled: true,
          builtin: true,
        },
      ],
    });

    const hairHistory = config.questions?.find((q) => q.id === 'hairHistory');
    expect(hairHistory?.condition).toBe('nur bei Farbe/Chemie');
    expect(hairHistory?.prompt).toBe('Fruehere Farbe, Blondierung, Glaettung, Dauerwelle oder andere chemische Behandlung');
  });

  it('injects saved question hints and conditions into the agent prompt', () => {
    const out = buildAgentInstructions(baseCfg({
      industry: 'hairdresser',
      customerModule: {
        enabled: true,
        questions: [
          {
            id: 'hairHistory',
            label: 'Vorbehandlung',
            prompt: 'Frage gezielt nach alter Farbe oder Blondierung.',
            condition: 'wenn Farbe, Blondierung oder Dauerwelle relevant ist',
            enabled: true,
            builtin: true,
          },
        ],
      },
    } as Partial<ConfigArg>));

    expect(out).toContain('Vorbehandlung (wenn Farbe, Blondierung oder Dauerwelle relevant ist): Frage gezielt nach alter Farbe oder Blondierung.');
  });

  it('normalizes common spoken German email forms before validation', () => {
    expect(normalizeSpokenEmail('Max Punkt Mueller at gmail punkt com')).toBe('max.mueller@gmail.com');
    expect(normalizeSpokenEmail('info at-zeichen salon bindestrich test punkt de')).toBe('info@salon-test.de');
    expect(normalizeSpokenEmail('kontakt bei beispiel punkt de')).toBe('kontaktbeibeispiel.de');
  });
});
