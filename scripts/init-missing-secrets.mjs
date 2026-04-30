#!/usr/bin/env node
/**
 * Generiert fehlende kryptographische Secrets in apps/api/.env, idempotent.
 * Bestehende Werte werden NICHT überschrieben.
 *
 * Generierte Werte werden NICHT geloggt — nur "✓ <VAR> generiert (X Zeichen)".
 */
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '..', 'apps', 'api', '.env');

if (!existsSync(ENV_PATH)) {
  mkdirSync(dirname(ENV_PATH), { recursive: true });
  writeFileSync(ENV_PATH, '', 'utf8');
}

// Secrets-Spec: Var-Name, Generator-Funktion, Min-Länge zum Verifizieren.
const SECRETS = {
  ENCRYPTION_KEY: () => crypto.randomBytes(32).toString('hex'),       // 64 hex-chars (256 bit)
  WEBHOOK_SIGNING_SECRET: () => crypto.randomBytes(32).toString('hex'),// 64 hex-chars
};

const original = readFileSync(ENV_PATH, 'utf8');
const lines = original.split(/\r?\n/);
const result = [...lines];
let changed = 0;

for (const [varName, gen] of Object.entries(SECRETS)) {
  const re = new RegExp(`^${varName}\\s*=\\s*\\S`);
  if (lines.some((l) => re.test(l))) {
    console.log(`· ${varName} ist schon gesetzt — übersprungen.`);
    continue;
  }
  const value = gen();
  // Stelle sicher, dass eine Trennzeile vor dem Append ist
  if (result.length && result[result.length - 1] !== '') result.push('');
  result.push(`${varName}=${value}`);
  console.log(`✓ ${varName} generiert (${value.length} Zeichen)`);
  changed++;
}

if (changed > 0) {
  writeFileSync(ENV_PATH, result.join('\n'), 'utf8');
  console.log(`\nGeschrieben in: ${ENV_PATH}`);
} else {
  console.log('\nAlle Secrets sind schon vorhanden, nichts zu tun.');
}
