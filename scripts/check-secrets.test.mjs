import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from './check-secrets.mjs';

const script = fileURLToPath(new URL('./check-secrets.mjs', import.meta.url));
const fakeToken = 'ghp_' + 'A'.repeat(36);

test('detects credential classes without returning values', () => {
  const samples = [
    fakeToken,
    'sk-proj-' + 'B'.repeat(40),
    'sk_test_' + 'C'.repeat(24),
    'postgres' + '://user:secret-value@db.invalid/db',
    '-----BEGIN ' + 'PRIVATE KEY-----',
  ];
  for (const value of samples) {
    const findings = scanText('sample.txt', value);
    assert.ok(findings.length > 0);
    assert.ok(!JSON.stringify(findings).includes(value));
  }
});

test('template placeholders and ordinary identifiers are allowed', () => {
  for (const password of ['PASSWORD', '<PASSWORD>', '${DB_PASSWORD}']) {
    assert.deepEqual(scanText('apps/api/.env.example', 'postgres' + `://user:${password}@db.invalid/db`), []);
  }
  assert.deepEqual(scanText('code.ts', 'const picture_' + 'a'.repeat(25) + ' = true;'), []);
  assert.deepEqual(scanText('compose.yml', 'postgres' + '://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@postgres:5432/db'), []);
  assert.ok(scanText('compose.yml', 'postgres' + '://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-not-a-placeholder}@postgres:5432/db').length);
  assert.equal(scanText('apps/api/.env.production', 'PORT=3002')[0].rule, 'Tracked environment file');
});

test('staged check reads the index, blocks secrets, and redacts CLI output', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'phonbot-secret-check-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git(['init', '-q']);
  writeFileSync(join(cwd, 'sample.txt'), fakeToken);
  git(['add', 'sample.txt']);
  // A cleaned working copy must not hide a credential still in the index.
  writeFileSync(join(cwd, 'sample.txt'), 'safe');
  const blocked = spawnSync(process.execPath, [script, '--staged'], { cwd, encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /sample\.txt/);
  assert.ok(!(blocked.stdout + blocked.stderr).includes(fakeToken));
  git(['add', 'sample.txt']);
  assert.equal(spawnSync(process.execPath, [script, '--staged'], { cwd }).status, 0);
});

test('full repository check catches tracked files outside the staged diff', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'phonbot-secret-check-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd });
  writeFileSync(join(cwd, 'sample.txt'), 'safe');
  execFileSync('git', ['add', 'sample.txt'], { cwd });
  writeFileSync(join(cwd, 'sample.txt'), fakeToken);
  const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(!result.stderr.includes(fakeToken));
});
