import {
  runDrkallaMemoryAbSimulation,
  sanitizeDrkallaMemoryAbReport,
} from '../drkalla-memory-ab-simulation.js';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const cases = Number(argValue('--cases', '1000'));
const seed = argValue('--seed', 'drkalla-memory-v1');
const report = runDrkallaMemoryAbSimulation({ cases, seed });
const sanitized = sanitizeDrkallaMemoryAbReport(report);

console.log(JSON.stringify(sanitized, null, 2));

if (
  report.totalCases !== 1000
  || report.bFailed !== 0
  || report.memoryP95Ms > 20
  || report.extraLlmCalls !== 0
  || report.extraKbCalls !== 0
  || report.liveSyncAllowed
) {
  process.exitCode = 1;
}
