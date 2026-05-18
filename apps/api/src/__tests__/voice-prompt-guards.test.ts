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
});
