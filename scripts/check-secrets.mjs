import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately report locations and rule names only, never matching values.
const tokenRules = [
  ['Stripe secret', /\b(?:sk_live_|sk_test_|rk_live_|rk_test_)[A-Za-z0-9]{16,}\b/],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{24,}\b/],
  ['GitHub token', /\b(?:ghp_|gho_)[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{35}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Resend API key', /\bre_[A-Za-z0-9]{20,}\b/],
  ['Retell API key', /\bkey_[A-Za-z0-9]{40,}\b/],
  ['OpenAI API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED |)PRIVATE KEY-----/],
  ['Signed JWT', /\beyJ[A-Za-z0-9_-]{16,}\.eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/],
];

export function scanText(path, text) {
  const findings = [];
  if (/(^|\/)\.env(?:\..*)?$/.test(path) && !path.endsWith('.env.example')) {
    findings.push({ path, line: 1, rule: 'Tracked environment file' });
  }
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [rule, pattern] of tokenRules) {
      if (pattern.test(line)) findings.push({ path, line: index + 1, rule });
    }
    const urls = line.matchAll(/\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|rediss?|mysql):\/\/(?:\$\{[^}]+\}|[^\s/:])+:(\$\{[^}]+\}|[^\s@/]+)@/g);
    for (const match of urls) {
      // Explicit template placeholders are allowed, including Compose env references.
      const password = match[1];
      if (/^(?:\$\{[A-Z_][A-Z0-9_]*(?::-postgres)?\}|<PASSWORD>|PASSWORD|YOUR_PASSWORD|REPLACE_ME)$/i.test(password)) continue;
      findings.push({ path, line: index + 1, rule: 'Database URL with inline password' });
    }
  });
  return findings;
}

export function checkRepository({ cwd = process.cwd(), staged = false } = {}) {
  const git = (args, encoding = 'utf8') => execFileSync('git', args, { cwd, encoding, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const root = git(['rev-parse', '--show-toplevel']).trim();
  cwd = root;
  const paths = git(staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
    : ['ls-files', '-z']).split('\0').filter(Boolean);
  const findings = [];
  for (const path of paths) {
    let data;
    if (staged) {
      data = git(['show', `:${path}`], 'buffer');
    } else {
      const fullPath = resolve(root, path);
      // Do not follow symlinks outside the repository.
      if (!lstatSync(fullPath).isFile()) continue;
      data = readFileSync(fullPath);
    }
    if (data.includes(0)) continue;
    findings.push(...scanText(path, data.toString('utf8')));
  }
  return { checkedFiles: paths.length, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--staged')) {
    console.error('Usage: node scripts/check-secrets.mjs [--staged]');
    process.exitCode = 2;
  } else {
    try {
      const { checkedFiles, findings } = checkRepository({ staged: process.argv.includes('--staged') });
      for (const finding of findings) console.error(`${JSON.stringify(finding.path)}:${finding.line}: ${finding.rule} [value redacted]`);
      if (findings.length) {
        console.error(`Secret check blocked: ${findings.length} finding(s). Remove secrets from Git; revoke any exposed credentials at their provider.`);
        process.exitCode = 1;
      } else {
        console.log(`Secret check passed (${checkedFiles} tracked paths checked; known patterns only).`);
      }
    } catch {
      console.error('Secret check could not complete. Check repository and file access; no credentials were printed.');
      process.exitCode = 2;
    }
  }
}
