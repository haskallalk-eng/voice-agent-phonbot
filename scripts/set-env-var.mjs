#!/usr/bin/env node
/**
 * Helper-Skript: setzt einen einzelnen Wert in apps/api/.env idempotent,
 * ohne den Wert in der Shell-History oder den Skript-Logs zu hinterlassen.
 *
 * Usage:
 *   node scripts/set-env-var.mjs DATABASE_URL
 *   node scripts/set-env-var.mjs SUPABASE_SERVICE_ROLE_KEY
 *   node scripts/set-env-var.mjs RETELL_API_KEY
 *
 * Das Skript liest den Wert per Terminal-Prompt mit verstecktem Echo
 * (wie ein Passwort-Prompt). Der Wert taucht nicht in `bash_history`,
 * nicht in dieser Skript-Datei, nicht in Logs auf.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '..', 'apps', 'api', '.env');

const varName = process.argv[2];
if (!varName || !/^[A-Z][A-Z0-9_]*$/.test(varName)) {
  console.error('Usage: node scripts/set-env-var.mjs <ENV_VAR_NAME>');
  console.error('Example: node scripts/set-env-var.mjs DATABASE_URL');
  process.exit(1);
}

// stdin nicht echoen — wie passwort-Prompt
process.stdout.write(`Wert für ${varName} eingeben (Eingabe wird NICHT angezeigt): `);
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

let value = '';
const finish = (val) => {
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
  process.stdout.write('\n');
  return applyValue(val);
};

process.stdin.on('data', (chunk) => {
  for (const ch of chunk) {
    if (ch === '\n' || ch === '\r' || ch === '') {
      return finish(value);
    }
    if (ch === '') {
      // Ctrl-C
      process.stdout.write('\nAbgebrochen.\n');
      process.exit(130);
    }
    if (ch === '' || ch === '\b') {
      // Backspace
      value = value.slice(0, -1);
      continue;
    }
    value += ch;
  }
});

function applyValue(raw) {
  const val = raw.trim();
  if (!val) {
    console.error('Leerer Wert — Abbruch.');
    process.exit(1);
  }

  if (!existsSync(ENV_PATH)) {
    mkdirSync(dirname(ENV_PATH), { recursive: true });
    writeFileSync(ENV_PATH, '', 'utf8');
  }

  const original = readFileSync(ENV_PATH, 'utf8');
  const lines = original.split(/\r?\n/);
  const lineRe = new RegExp(`^${varName}\\s*=`);

  let replaced = false;
  const next = lines.map((ln) => {
    if (lineRe.test(ln)) {
      replaced = true;
      // Wert quoten falls Whitespace/# enthalten
      const needsQuote = /[\s#]/.test(val) && !/^"/.test(val);
      return `${varName}=${needsQuote ? `"${val.replace(/"/g, '\\"')}"` : val}`;
    }
    return ln;
  });
  if (!replaced) {
    // Nicht vorhanden — am Ende anhängen, vorher Trennzeile sicherstellen
    if (next.length && next[next.length - 1] !== '') next.push('');
    next.push(`${varName}=${val}`);
  }

  writeFileSync(ENV_PATH, next.join('\n'), 'utf8');
  console.log(`✓ ${varName} ${replaced ? 'aktualisiert' : 'hinzugefügt'} in ${ENV_PATH}`);
  console.log('  (Wert wurde nicht protokolliert.)');
  process.exit(0);
}
