import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildOwnKbSourceImportReadiness,
  type OwnKbSourceImportSafetyGates,
} from '../own-kb-source-import-contract.js';
import type { KnowledgeSource } from '../knowledge.js';

type CliIo = {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
};

type CliArgs = {
  input: string | null;
  safetyGates: string | null;
  output: string | null;
  now: string | null;
  orgId: string | null;
  tenantId: string | null;
  agentId: string | null;
  callId: string | null;
};

const failClosedSafetyGates: OwnKbSourceImportSafetyGates = {
  trustedScopePassed: false,
  dbRlsReadinessPassed: false,
  piiRedactionPassed: false,
  sourceApprovalManifestVerified: false,
  sourceRequirementsReviewed: false,
  serviceRoleScopedRepositoryOnly: false,
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    input: null,
    safetyGates: null,
    output: null,
    now: null,
    orgId: null,
    tenantId: null,
    agentId: null,
    callId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1] ?? null;
    if (arg === '--input') {
      args.input = next;
      index += 1;
    } else if (arg === '--safety-gates') {
      args.safetyGates = next;
      index += 1;
    } else if (arg === '--output') {
      args.output = next;
      index += 1;
    } else if (arg === '--now') {
      args.now = next;
      index += 1;
    } else if (arg === '--org-id') {
      args.orgId = next;
      index += 1;
    } else if (arg === '--tenant-id') {
      args.tenantId = next;
      index += 1;
    } else if (arg === '--agent-id') {
      args.agentId = next;
      index += 1;
    } else if (arg === '--call-id') {
      args.callId = next;
      index += 1;
    }
  }
  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function parseSafetyGates(value: unknown): OwnKbSourceImportSafetyGates {
  if (!isRecord(value)) return failClosedSafetyGates;
  return {
    trustedScopePassed: readBoolean(value.trustedScopePassed),
    dbRlsReadinessPassed: readBoolean(value.dbRlsReadinessPassed),
    piiRedactionPassed: readBoolean(value.piiRedactionPassed),
    sourceApprovalManifestVerified: readBoolean(value.sourceApprovalManifestVerified),
    sourceRequirementsReviewed: readBoolean(value.sourceRequirementsReviewed),
    serviceRoleScopedRepositoryOnly: readBoolean(value.serviceRoleScopedRepositoryOnly),
  };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const contents = await readFile(path.resolve(filePath), 'utf8');
  return JSON.parse(contents.replace(/^\uFEFF/, '')) as unknown;
}

function parseSources(value: unknown): KnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord) as KnowledgeSource[];
}

function sanitizedReport(
  result: ReturnType<typeof buildOwnKbSourceImportReadiness>,
  sourceCount: number,
) {
  return {
    kind: 'own_kb_source_import_readiness_report',
    readyToImport: result.readyToImport,
    promotionEvidenceUsable: result.promotionEvidenceUsable,
    sourceCount,
    acceptedSources: result.acceptedSources,
    rejectedSources: result.rejectedSources,
    blockers: result.blockers,
    notes: result.notes,
    sourcesIncluded: false,
  };
}

export async function runOwnKbSourceImportReadinessCli(
  argv = process.argv.slice(2),
  io: CliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  try {
    const args = parseArgs(argv);
    if (args.orgId || args.tenantId || args.agentId || args.callId) {
      stderr('SOURCE_IMPORT_TRUSTED_SCOPE_CANNOT_BE_SUPPLIED_BY_CLI\n');
      return 1;
    }
    if (!args.input) {
      stderr('SOURCE_IMPORT_INPUT_REQUIRED\n');
      return 1;
    }
    if (args.output && path.resolve(args.output) === path.resolve(args.input)) {
      stderr('SOURCE_IMPORT_OUTPUT_PATH_CONFLICT\n');
      return 1;
    }

    const sources = parseSources(await readJsonFile(args.input));
    const safetyGates = args.safetyGates
      ? parseSafetyGates(await readJsonFile(args.safetyGates))
      : failClosedSafetyGates;
    const result = buildOwnKbSourceImportReadiness({
      trustedScope: undefined,
      sources,
      safetyGates,
      now: args.now ?? undefined,
    });
    const report = sanitizedReport(result, sources.length);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (args.output) await writeFile(path.resolve(args.output), json, 'utf8');
    stdout(json);
    return result.readyToImport ? 0 : 2;
  } catch (error: unknown) {
    stderr(`${error instanceof Error ? error.message : 'SOURCE_IMPORT_READINESS_UNKNOWN_ERROR'}\n`);
    return 1;
  }
}

export function isDirectCliInvocation(moduleUrl: string, argvEntry: string | undefined): boolean {
  if (!argvEntry) return false;
  return path.resolve(fileURLToPath(moduleUrl)) === path.resolve(argvEntry);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  runOwnKbSourceImportReadinessCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
