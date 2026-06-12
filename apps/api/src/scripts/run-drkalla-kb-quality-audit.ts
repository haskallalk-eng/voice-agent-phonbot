import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runDrkallaKbQualityAudit } from '../drkalla-kb-quality-audit.js';
import type { DrkallaKnowledgeSnapshot } from '../drkalla-rag-agent.js';

function argValue(name: string, fallback: string): string {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const snapshotPath = path.resolve(process.cwd(), argValue('--snapshot', 'tmp/drkalla-rag/drkalla-products.json'));
const outPath = path.resolve(process.cwd(), argValue('--out', 'tmp/drkalla-rag/drkalla-kb-quality-audit.json'));
const cases = Number(argValue('--cases', '1000'));
const seed = argValue('--seed', 'drkalla-kb-quality-v1');

const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as DrkallaKnowledgeSnapshot;
const report = runDrkallaKbQualityAudit({ snapshot, cases, seed });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  outPath,
  totalCases: report.totalCases,
  passed: report.passed,
  warned: report.warned,
  failed: report.failed,
  scorePercent: report.scorePercent,
  blockers: report.blockers,
  warnings: report.warnings,
  productCount: report.catalog.productCount,
  productKindCount: report.catalog.productKindCount,
  externalBrands: report.catalog.externalBrands,
  imageCoveragePercent: report.catalog.imageCoveragePercent,
  imageAltCoveragePercent: report.catalog.imageAltCoveragePercent,
}, null, 2));

if (report.totalCases !== 1000 || report.failed > 0) {
  process.exitCode = 1;
}
