/**
 * drkalla:faq-propose — turn logged FAQ candidates into a review report.
 *
 * The live agent logs every general question the MODEL had to answer as
 * {event:'faq_candidate', question, answer}. This offline tool clusters those
 * candidates by content, counts frequency, and proposes a curated FAQ entry for
 * the frequent ones — written as a human-readable Markdown report PLUS a JSON
 * draft (enabled:false). The owner reviews, approves/edits, and the approved
 * entries are merged into data/drkalla-rag/drkalla-faq.json. The agent never
 * auto-adds anything.
 *
 * Input: a file of lines. Each line may be a pino log line (JSON with
 *   event:'faq_candidate') or a bare {"question","answer"} JSON object.
 * Produce it from the server, e.g.:
 *   ssh phonbot "cd /opt/phonbot && docker compose logs --no-color api \
 *     | grep faq_candidate" > tmp/drkalla-rag/faq-candidates.jsonl
 *
 * Usage: tsx src/scripts/run-drkalla-faq-propose.ts [--in <file>] [--min <n>] [--out <md>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeDrkallaFaqText } from '../drkalla-faq-match.js';
import { speakDrkallaText } from '../drkalla-speakable.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : fallback;
}

const inPath = arg('--in', path.join('tmp', 'drkalla-rag', 'faq-candidates.jsonl'));
const outPath = arg('--out', path.join('tmp', 'drkalla-rag', 'drkalla-faq-proposals.md'));
const minFreq = Math.max(1, Number(arg('--min', '2')));

const STOPWORDS = new Set([
  'ich', 'sie', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'und', 'oder', 'mit',
  'fuer', 'von', 'auf', 'aus', 'bei', 'habt', 'haben', 'hat', 'ist', 'sind', 'wie', 'was', 'wo',
  'wann', 'kann', 'koennen', 'man', 'mir', 'mich', 'uns', 'euch', 'bitte', 'mal', 'noch', 'auch',
  'gibt', 'gibts', 'eure', 'euer', 'ihr', 'denn', 'eigentlich', 'wirklich', 'mein', 'meine',
]);

function contentTokens(q: string): string[] {
  return normalizeDrkallaFaqText(q).split(' ').filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

type Candidate = { question: string; answer: string };

function readCandidates(file: string): Candidate[] {
  if (!fs.existsSync(file)) {
    console.error(`No candidates file at ${file}.\nProduce it with:\n  ssh phonbot "cd /opt/phonbot && docker compose logs --no-color api | grep faq_candidate" > ${file}`);
    process.exit(1);
  }
  const out: Candidate[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const start = trimmed.indexOf('{');
    if (start < 0) continue;
    try {
      const obj = JSON.parse(trimmed.slice(start));
      const question = typeof obj.question === 'string' ? obj.question.trim() : '';
      const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
      if (question) out.push({ question, answer });
    } catch {
      // skip non-JSON lines
    }
  }
  return out;
}

// Cluster by content-token signature: questions sharing the same set of >=4-char
// content tokens land together. Crude but deterministic; the owner reviews.
function cluster(cands: Candidate[]): Array<{ signature: string; questions: string[]; answers: string[] }> {
  const map = new Map<string, { questions: string[]; answers: string[] }>();
  for (const c of cands) {
    const toks = [...new Set(contentTokens(c.question))].sort();
    if (!toks.length) continue;
    const sig = toks.join(' ');
    const entry = map.get(sig) ?? { questions: [], answers: [] };
    entry.questions.push(c.question);
    if (c.answer) entry.answers.push(c.answer);
    map.set(sig, entry);
  }
  return [...map.entries()].map(([signature, v]) => ({ signature, ...v }));
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = ''; let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

function proposeId(signature: string, index: number): string {
  const slug = signature.split(' ').slice(0, 3).join('-').replace(/[^a-z0-9-]/g, '');
  return `proposed-${slug || 'faq'}-${index + 1}`;
}

function main(): void {
  const cands = readCandidates(inPath);
  const clusters = cluster(cands)
    .filter((c) => c.questions.length >= minFreq)
    .sort((a, b) => b.questions.length - a.questions.length);

  const lines: string[] = [];
  lines.push('# DrKalla FAQ-Vorschläge (Review)');
  lines.push('');
  lines.push(`Quelle: ${inPath} · ${cands.length} Kandidaten · ${clusters.length} Cluster (ab ${minFreq}x)`);
  lines.push('');
  lines.push('Prüfe jeden Vorschlag. Was du übernehmen willst, sag mir (oder übernimm den JSON-Block, setze enabled:true und passe die Antwort/Trigger an) in data/drkalla-rag/drkalla-faq.json.');
  lines.push('');

  clusters.forEach((c, i) => {
    const triggers = c.signature.split(' ').slice(0, 6);
    const proposedAnswer = speakDrkallaText(mostCommon(c.answers) || '');
    const entry = {
      id: proposeId(c.signature, i),
      triggers,
      answer: proposedAnswer,
      tags: ['vorschlag'],
      enabled: false,
    };
    lines.push(`## ${i + 1}. ${c.questions[0]}`);
    lines.push(`- Häufigkeit: **${c.questions.length}x**`);
    if (c.questions.length > 1) {
      lines.push(`- Varianten: ${[...new Set(c.questions)].slice(0, 5).map((q) => `„${q}"`).join(', ')}`);
    }
    lines.push(`- Vorgeschlagene Antwort (aus Modell-Antwort, TTS-bereinigt): ${proposedAnswer || '_(keine Modell-Antwort geloggt — bitte selbst formulieren)_'}`);
    lines.push('- JSON-Entwurf (enabled:false):');
    lines.push('```json');
    lines.push(JSON.stringify(entry, null, 2));
    lines.push('```');
    lines.push('');
  });

  if (!clusters.length) {
    lines.push('_Keine Cluster über der Häufigkeitsschwelle. Senke --min oder sammle mehr echte Anrufe._');
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ candidates: cands.length, clusters: clusters.length, minFreq, outPath }, null, 2));
}

main();
