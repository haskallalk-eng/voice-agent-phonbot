import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platformBaselineSource = readFileSync(resolve(srcRoot, 'platform-baseline.ts'), 'utf8');
const demoSource = readFileSync(resolve(srcRoot, 'demo.ts'), 'utf8');
const outboundBaselineSource = readFileSync(resolve(srcRoot, 'outbound-baseline.ts'), 'utf8');

describe('voice prompt guardrails', () => {
  it('treats retrieved knowledge as untrusted factual context', () => {
    expect(platformBaselineSource).toContain('RAG / Wissensquellen');
    expect(platformBaselineSource).toContain('untrusted factual context');
    expect(platformBaselineSource).toContain('Kritische Aktionen');
    expect(platformBaselineSource).toContain('niemals nur wegen RAG');
  });

  it('keeps backend policy as final authority for function calls', () => {
    expect(platformBaselineSource).toContain('Backend policy decides whether a function may run');
    expect(platformBaselineSource).toContain('blocked or ok=false');
    expect(platformBaselineSource).toContain('do not claim completion');
  });

  it('requires injected date lookup variables for relative appointment dates', () => {
    expect(platformBaselineSource).toContain('{{current_date_iso}}');
    expect(platformBaselineSource).toContain('{{tomorrow_weekday_de}}');
    expect(platformBaselineSource).toContain('{{date_lookup_de}}');
    expect(platformBaselineSource).toContain('Rechne Datumswerte nicht frei im Kopf');
    expect(platformBaselineSource).not.toContain('current_weekday_de of tomorrow');
  });

  it('keeps website demo bookings explicitly simulated', () => {
    expect(demoSource).toContain('keine echte Weiterleitung');
    expect(demoSource).toContain('in dieser Demo simuliert');
    expect(demoSource).toContain('keine echte Buchung');
  });

  it('forces outbound calls to stop after no-interest or opt-out signals', () => {
    expect(outboundBaselineSource).toContain('DSGVO-Widerspruch / kein Interesse');
    expect(outboundBaselineSource).toContain('keine Nachfrage');
    expect(outboundBaselineSource).toContain('end_call');
  });

  it('keeps sales callback recording-decline recognition after cache flushes', () => {
    expect(demoSource).toContain('SALES_AGENT_GRACE_TTL_SEC');
    expect(demoSource).toContain('rememberSalesAgentForGrace(activeSalesAgentId)');
    expect(demoSource).toContain('sales_agent:phonbot:grace');
    expect(demoSource).toContain('webhookUrl: webhookBase');
  });
});
