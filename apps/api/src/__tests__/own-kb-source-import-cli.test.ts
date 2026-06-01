import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isDirectCliInvocation,
  runOwnKbSourceImportReadinessCli,
} from '../scripts/report-own-kb-source-import-readiness.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'own-kb-source-import-cli-'));
}

describe('Own-KB source import readiness CLI', () => {
  it('fails closed and emits a sanitized readiness report without server TrustedScope', async () => {
    const dir = await tempDir();
    const sourcePath = path.join(dir, 'sources.json');
    const outputPath = path.join(dir, 'readiness.json');
    await writeFile(sourcePath, JSON.stringify([{
      id: 'source_1',
      orgId: 'org_1',
      tenantId: 'tenant_1',
      type: 'text',
      name: 'Source one',
      content: 'Approved current source content.',
      sha256: 'wrong_hash',
      contentHash: 'wrong_hash',
      sourceOfTruth: 'human_reviewed_fact_intake',
      allowedUse: 'voice_agent',
      reviewStatus: 'approved',
      verifiedAt: '2026-05-30T10:00:00.000Z',
      expiresAt: '2026-06-30T10:00:00.000Z',
      containsPii: false,
      risk: 'low',
      autoRefresh: false,
    }]), 'utf8');

    const writes: string[] = [];
    const exitCode = await runOwnKbSourceImportReadinessCli([
      '--input',
      sourcePath,
      '--output',
      outputPath,
      '--now',
      '2026-05-30T12:00:00.000Z',
    ], {
      stdout: (text) => writes.push(text),
      stderr: (text) => writes.push(text),
    });

    const output = JSON.parse(await readFile(outputPath, 'utf8')) as {
      readyToImport: boolean;
      promotionEvidenceUsable: boolean;
      blockers: string[];
      sourceCount: number;
      acceptedSources: number;
      rejectedSources: number;
      sourcesIncluded: boolean;
    };
    expect(exitCode).toBe(2);
    expect(output).toMatchObject({
      readyToImport: false,
      promotionEvidenceUsable: false,
      sourceCount: 1,
      acceptedSources: 0,
      rejectedSources: 1,
      sourcesIncluded: false,
    });
    expect(output.blockers).toEqual(expect.arrayContaining([
      'SOURCE_IMPORT_TRUSTED_SCOPE_REQUIRED',
      'SOURCE_IMPORT_HASH_MISMATCH',
    ]));
    expect(writes.join('\n')).toContain('SOURCE_IMPORT_TRUSTED_SCOPE_REQUIRED');
    expect(writes.join('\n')).not.toContain('Approved current source content');
  });

  it('rejects CLI-supplied scope fields instead of treating them as trusted', async () => {
    const dir = await tempDir();
    const sourcePath = path.join(dir, 'sources.json');
    await writeFile(sourcePath, '[]\n', 'utf8');

    const exitCode = await runOwnKbSourceImportReadinessCli([
      '--input',
      sourcePath,
      '--org-id',
      'org_1',
      '--tenant-id',
      'tenant_1',
    ], {
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(exitCode).toBe(1);
  });

  it('detects direct tsx invocation from a file URL on Windows-style paths', () => {
    expect(isDirectCliInvocation(
      'file:///C:/repo/apps/api/src/scripts/report-own-kb-source-import-readiness.ts',
      'C:\\repo\\apps\\api\\src\\scripts\\report-own-kb-source-import-readiness.ts',
    )).toBe(true);
  });
});
