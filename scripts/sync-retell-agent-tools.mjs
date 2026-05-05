#!/usr/bin/env node
import { execSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = resolve(repoRoot, 'apps/api');

function quoteArg(arg) {
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}

const suffix = args.length ? ` ${args.map(quoteArg).join(' ')}` : '';
execSync(`npm exec tsx -- src/scripts/sync-retell-active-configs.ts${suffix}`, {
  cwd: apiRoot,
  stdio: 'inherit',
});
