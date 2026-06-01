import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildOwnKbExpertEnrichmentCsv,
  buildOwnKbFactIntakeTemplateCsv,
  buildOwnKbSimulationEnrichmentFromAuthoringCsv,
  buildOwnKbSourceRequirementsCsv,
} from '../own-kb-simulation-enrichment.js';

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1]?.trim() || null;
  return null;
}

async function main(): Promise<void> {
  const input = argValue('--input')
    ?? 'scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-source-authoring.csv';
  const enrichmentOutput = argValue('--enrichment-output')
    ?? 'scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-expert-enrichment.csv';
  const simulationOutput = argValue('--simulation-output')
    ?? 'scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-simulation-pack.json';
  const sourceRequirementsOutput = argValue('--source-requirements-output')
    ?? 'scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-source-requirements.csv';
  const factIntakeOutput = argValue('--fact-intake-output')
    ?? 'scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-fact-intake-template.csv';
  const reportOutput = argValue('--report-output')
    ?? 'scratch/own-kb-benchmark/test-transcripts/test-transcript-own-kb-simulation-enrichment-report.json';

  const result = buildOwnKbSimulationEnrichmentFromAuthoringCsv(
    await readFile(path.resolve(input), 'utf8'),
  );

  await writeFile(path.resolve(enrichmentOutput), buildOwnKbExpertEnrichmentCsv(result.enrichmentRows), 'utf8');
  await writeFile(path.resolve(simulationOutput), `${JSON.stringify({
    kind: 'own_kb_everyday_simulation_pack',
    syntheticOnly: true,
    approvedForMilestone: 'DRAFT_ONLY',
    promotionEvidenceUsable: false,
    simulations: result.simulations,
  }, null, 2)}\n`, 'utf8');
  await writeFile(
    path.resolve(sourceRequirementsOutput),
    buildOwnKbSourceRequirementsCsv(result.sourceRequirements),
    'utf8',
  );
  await writeFile(
    path.resolve(factIntakeOutput),
    buildOwnKbFactIntakeTemplateCsv(result.sourceRequirements),
    'utf8',
  );
  await writeFile(path.resolve(reportOutput), `${JSON.stringify(result.report, null, 2)}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({
    kind: result.report.kind,
    rows: result.report.rows,
    enrichmentRows: result.report.enrichmentRows,
    simulationRows: result.report.simulationRows,
    sourceRequirementRows: result.report.sourceRequirementRows,
    intentCounts: result.report.intentCounts,
    riskCounts: result.report.riskCounts,
    evidenceNeedCounts: result.report.evidenceNeedCounts,
    containsCallerContent: result.report.containsCallerContent,
    exportsRedactedQuestions: result.report.exportsRedactedQuestions,
    enrichmentCsvExportsRedactedQuestions: result.report.enrichmentCsvExportsRedactedQuestions,
    sourceRequirementsExportRedactedQuestions: result.report.sourceRequirementsExportRedactedQuestions,
    factIntakeTemplateExportsRedactedQuestions: result.report.factIntakeTemplateExportsRedactedQuestions,
    syntheticOnly: result.report.syntheticOnly,
    approvedForMilestone: result.report.approvedForMilestone,
    promotionEvidenceUsable: result.report.promotionEvidenceUsable,
    enrichmentWritten: true,
    simulationPackWritten: true,
    sourceRequirementsWritten: true,
    factIntakeTemplateWritten: true,
    reportWritten: true,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unknown Own-KB simulation enrichment error'}\n`);
  process.exitCode = 1;
});
