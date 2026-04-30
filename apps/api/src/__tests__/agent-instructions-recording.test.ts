/**
 * buildAgentInstructions(recordCalls) tests — Audit-Round-14.
 *
 * Verifies the recording-disclosure block (§ 201 StGB / Art. 6 DSGVO) is
 * conditional on cfg.recordCalls. Three states:
 *  - recordCalls: true   → full disclosure (KI + recording + decline-tool path)
 *  - recordCalls: false  → KI-only disclosure (no recording line)
 *  - recordCalls: undef. → legacy-on, full disclosure (back-compat)
 */

import { describe, it, expect } from 'vitest';
import { buildAgentInstructions } from '../agent-instructions.js';

type ConfigArg = Parameters<typeof buildAgentInstructions>[0];

function baseCfg(overrides: Partial<ConfigArg> = {}): ConfigArg {
  return {
    tenantId: 'test-tenant',
    name: 'Chipy',
    language: 'de',
    voice: 'voice-x',
    businessName: 'Test GmbH',
    businessDescription: 'Test description.',
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

describe('buildAgentInstructions: recording disclosure', () => {
  it('recordCalls=true → includes Aufzeichnungshinweis + recording_declined tool path', () => {
    const out = buildAgentInstructions(baseCfg({ recordCalls: true }));
    expect(out).toContain('Aufzeichnungshinweis');
    expect(out).toContain('aufgezeichnet');
    expect(out).toContain('recording_declined');
  });

  it('recordCalls=false → drops recording line, keeps KI-Hinweis only', () => {
    const out = buildAgentInstructions(baseCfg({ recordCalls: false }));
    expect(out).toContain('KI-Hinweis');
    expect(out).not.toContain('Aufzeichnungshinweis');
    expect(out).not.toContain('recording_declined');
    // Codex Round-11 LOW wording fix: explicit "nicht gespeichert" line.
    expect(out).toContain('NICHT gespeichert');
  });

  it('recordCalls=undefined (legacy) → treated as on, includes recording disclosure', () => {
    const out = buildAgentInstructions(baseCfg({ recordCalls: undefined }));
    expect(out).toContain('Aufzeichnungshinweis');
    expect(out).toContain('recording_declined');
  });

  it('disclosure block uses agent name + business name', () => {
    const out = buildAgentInstructions(
      baseCfg({ name: 'Maxi', businessName: 'Beispiel AG', recordCalls: true }),
    );
    expect(out).toContain('Maxi');
    expect(out).toContain('Beispiel AG');
  });
});
