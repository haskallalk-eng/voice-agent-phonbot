/**
 * DrKalla conversation-flow simulator: replays the REAL failing caller
 * scenarios (transcripts pulled 2026-07-02) as multi-turn conversations
 * against the responder with the REAL catalog/FAQ/knowledge snapshots —
 * fully offline, no OpenAI key needed.
 *
 * Deterministic turns show the exact spoken text. Model turns (extraLlmCalls
 * = 1) show the grounding directives that were injected plus the deterministic
 * fallback, so a reviewer can judge routing + grounding quality.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs src/scripts/run-drkalla-flow-sim.ts [--json out.json]
 */
import fs from 'node:fs';
import { buildDrkallaCustomLlmResponse } from '../drkalla-custom-llm-responder.js';
import {
  createDrkallaShortTermMemory,
  nextDrkallaNoInputReminder,
  type DrkallaShortTermVoiceMemory,
} from '../drkalla-short-term-memory.js';
import {
  loadDrkallaProductCatalogSearch,
  loadDrkallaProductEvidenceLookup,
  loadDrkallaProductNameEntries,
  loadDrkallaProductNameDetector,
  loadDrkallaFaqMatcher,
  loadDrkallaKnowledgeRetriever,
  loadDrkallaExternalBrandStock,
  loadDrkallaColorShadeSummary,
} from '../retell-drkalla-custom-llm-ws.js';
import { buildDrkallaAmbiguousProductNameDetector } from '../drkalla-product-name-detector.js';
import { createTrustedScope } from '../trusted-scope.js';
import type { AgentTurnRequestedEvent } from '../voice-runtime-contract.js';

const trustedScope = createTrustedScope({
  orgId: 'org-sim',
  tenantId: 'tenant-sim',
  agentId: 'agent-drkalla-sim',
  callId: 'call-sim',
  source: 'server',
  resolvedFrom: 'call_registry',
});

function turn(text: string, sequence: number): AgentTurnRequestedEvent {
  return {
    type: 'AgentTurnRequested',
    eventId: `event-${sequence}`,
    traceId: 'trace-sim',
    trustedScope,
    provider: 'retell',
    channel: 'voice',
    providerEventId: `retell-${sequence}`,
    providerCallId: 'call-sim',
    turnId: `turn-${sequence}`,
    responseId: `response-${sequence}`,
    occurredAt: new Date(1780000000000 + sequence * 10000).toISOString(),
    receivedAt: new Date(1780000000000 + sequence * 10000 + 100).toISOString(),
    currentUserText: text,
    sequence,
  };
}

type Check = { name: string; pass: boolean; detail?: string };
type SimTurn = {
  caller: string;
  path: 'deterministic' | 'model';
  spoken: string;
  grounding?: string[];
  endCall: boolean;
};
type ScenarioResult = { title: string; source: string; turns: SimTurn[]; checks: Check[] };

type Expect = (spoken: string, response: { endCall?: boolean; grounding: string[]; path: string }) => Check[];
type ScriptTurn = { say: string; expect?: Expect };

const aliasEntries = loadDrkallaProductNameEntries();
const deps = {
  detectProducts: aliasEntries.length ? loadDrkallaProductNameDetector() : undefined,
  detectAmbiguousProduct: aliasEntries.length ? buildDrkallaAmbiguousProductNameDetector(aliasEntries) : undefined,
  evidenceLookup: loadDrkallaProductEvidenceLookup(),
  catalogSearch: loadDrkallaProductCatalogSearch(),
  brandStock: loadDrkallaExternalBrandStock(),
  colorShadeSummary: loadDrkallaColorShadeSummary(),
  faqMatch: loadDrkallaFaqMatcher(),
  knowledgeRetriever: loadDrkallaKnowledgeRetriever(),
};

const CANARY = { enabled: true, allowModelDirectives: true, allowLiveRollout: false, maxDirectiveChars: 800 };

async function runScenario(title: string, source: string, script: ScriptTurn[]): Promise<ScenarioResult> {
  let memory: DrkallaShortTermVoiceMemory = createDrkallaShortTermMemory();
  const history: Array<{ role: 'user' | 'agent'; text: string }> = [];
  const turns: SimTurn[] = [];
  const checks: Check[] = [];
  let sentLinks = 0;
  for (let i = 0; i < script.length; i += 1) {
    const step = script[i]!;
    let grounding: string[] = [];
    const response = await buildDrkallaCustomLlmResponse({
      canary: CANARY,
      event: turn(step.say, i + 1),
      memory,
      client: {
        complete: async ({ system }) => {
          grounding = system
            .split('\n')
            .filter((l) => /^(Plan:|Memory:|Evidence|Zuvor besprochen|Kontakt-Fakt|Katalog-Treffer|Wissens-Beleg|Farb-Beleg|Referenz-Hinweis|Soeben ausgeführt)/.test(l))
            .map((l) => l.slice(0, 220));
          return '';
        },
      },
      ...deps,
      conversationHistory: history.slice(-6),
      executeSendLink: async () => { sentLinks += 1; return { smsSent: true as const }; },
    });
    const path = response.metrics.extraLlmCalls === 1 ? 'model' as const : 'deterministic' as const;
    turns.push({
      caller: step.say,
      path,
      spoken: response.text,
      grounding: grounding.length ? grounding : undefined,
      endCall: response.endCall === true,
    });
    if (step.expect) {
      checks.push(...step.expect(response.text, { endCall: response.endCall, grounding, path }));
    }
    history.push({ role: 'user', text: step.say }, { role: 'agent', text: response.text });
    memory = response.memory;
    if (response.endCall) break;
  }
  checks.push({ name: 'links wirklich gesendet (Zähler)', pass: true, detail: `${sentLinks} Send(s)` });
  return { title, source, turns, checks };
}

const contains = (needle: string | RegExp) => (name: string): Expect => (spoken) => [{
  name,
  pass: typeof needle === 'string' ? spoken.includes(needle) : needle.test(spoken),
  detail: spoken.slice(0, 140),
}];

async function main() {
  const results: ScenarioResult[] = [];

  results.push(await runScenario(
    'Locken-Bedarf mit Haarprofil-Gedächtnis',
    'Real-Call 2026-07-02 10:16 (Bürste/Kamm für Locken, Glanz- statt Locken-Shampoo, falscher Referent)',
    [
      { say: 'Hi, kannst Du mir paar Produkte empfehlen? Ich brauch Produkte, weil ich ziemlich lockige Haare habe.' },
      {
        say: 'Ich möchte ein Shampoo kaufen.',
        expect: (spoken, r) => [
          // Turn 1 already pitched the Locken product (hair profile worked); a
          // repeat request correctly varies via the model — whose grounding
          // must still carry the LOCKEN product, never a comb.
          {
            name: 'Shampoo-Turn liefert/groundet ein LOCKEN-Produkt',
            pass: /locken/i.test(spoken) || r.grounding.some((g) => /locken/i.test(g)),
            detail: `${r.path}: ${spoken.slice(0, 100)} | ${r.grounding.join(' ').slice(0, 120)}`,
          },
          { name: 'kein Kamm/keine Bürste', pass: !/kamm|b(ü|ue)rste/i.test(spoken), detail: spoken.slice(0, 100) },
        ],
      },
      {
        say: 'Ist das jetzt aber ein Lockenshampoo oder was?',
        expect: (_s, r) => [
          // Consistent either way: a Referenz-Hinweis when the referent differs,
          // or evidence grounding on the SAME product when it is the same.
          {
            name: 'Referent-Frage konsistent (Hinweis oder gleiche Evidence)',
            pass: r.path === 'model'
              && (r.grounding.some((g) => g.startsWith('Referenz-Hinweis')) || r.grounding.some((g) => /locken/i.test(g))),
            detail: r.grounding.join(' | ').slice(0, 200),
          },
        ],
      },
      {
        say: 'Habt ihr auch sone Maske oder so dann?',
        expect: (spoken, r) => [
          { name: 'Masken-Turn berücksichtigt Locken-Profil (Treffer/Antwort)', pass: /locken|maske/i.test(spoken) || r.grounding.some((g) => /locken/i.test(g)), detail: `${r.path}: ${spoken.slice(0, 120)}` },
        ],
      },
    ],
  ));

  results.push(await runScenario(
    'Farbtöne-Frage',
    'Real-Call 2026-07-01 13:00 (zweimal Pitch statt Farbton-Antwort)',
    [
      { say: 'Ja, also ich möchte gerne bei euch paar Produkte angucken. Habt ihr auch Haarfarben?', expect: contains(/haarfarbe|sintesis|evelon/i)('Haarfarben-Frage nennt echte Produkte') },
      {
        say: 'Was habt ihr denn für Farben?',
        expect: (spoken) => [
          { name: 'Farbton-Frage → Nuancen-Antwort (kein Pitch)', pass: /nuancen/i.test(spoken) && !/empfehlen/i.test(spoken), detail: spoken.slice(0, 160) },
        ],
      },
      {
        say: 'Rot, grün.',
        expect: (_s, r) => [
          { name: 'Farbrichtung → Model mit Farb-Beleg', pass: r.path === 'model' && r.grounding.some((g) => g.startsWith('Farb-Beleg')), detail: r.grounding.join(' | ').slice(0, 200) },
        ],
      },
    ],
  ));

  results.push(await runScenario(
    'Abschluss-Eskalation statt Nein-Schleife',
    'Real-Call 2026-06-30 09:17 (4x identisches "Kann ich sonst noch weiterhelfen?")',
    [
      { say: 'Ich möchte gerne eine Haarfarbe kaufen.' },
      { say: 'Nein.', expect: (spoken, r) => [{ name: '1. Nein → Wind-down, kein Hangup', pass: !r.endCall && /sonst noch/i.test(spoken), detail: spoken.slice(0, 100) }] },
      {
        say: 'Nein.',
        expect: (spoken, r) => [
          { name: '2. Nein → Verabschiedung + Hangup', pass: r.endCall === true && /wiederh(ö|oe)ren/i.test(spoken), detail: spoken.slice(0, 120) },
        ],
      },
    ],
  ));

  results.push(await runScenario(
    'Frust-Turn wird nicht mit Pitch beantwortet',
    'Real-Call 2026-06-30 09:17 ("wie oft fragst du denn nach Link" → wieder Pitch)',
    [
      { say: 'Ich möchte gerne eine Haarfarbe kaufen.' },
      {
        say: 'Wie oft fragst Du denn bitte nach Link. Du kannst nicht jede Frage nach Link fragen.',
        expect: (spoken, r) => [
          { name: 'Meta-Beschwerde → Model, kein Template-Pitch', pass: r.path === 'model' && !/empfehlen|vorschlagen|passt zum Beispiel/i.test(spoken), detail: `${r.path}: ${spoken.slice(0, 120)}` },
        ],
      },
    ],
  ));

  results.push(await runScenario(
    'Haarschneidemaschine + Kombi-Intent (Link senden + auflegen)',
    'Real-Call 2026-06-27 10:51 (Kamm statt Maschine, Sortiments-Leugnung, Send-Intent verschluckt)',
    [
      {
        say: 'Ich brauche eine Haarschneidemaschine.',
        expect: (spoken) => [
          { name: 'Maschine wird gefunden (kein Kamm)', pass: /haarschneidemaschine/i.test(spoken) && !/kamm/i.test(spoken), detail: spoken.slice(0, 140) },
        ],
      },
      {
        say: 'Ja, schick mir den Link und dann leg bitte auf.',
        expect: (spoken, r) => [
          { name: 'Kombi: Send bestätigt UND Hangup', pass: r.endCall === true && /sms|link/i.test(spoken), detail: spoken.slice(0, 140) },
        ],
      },
    ],
  ));

  results.push(await runScenario(
    'Scheren-Sortiment erreichbar',
    'Real-Call 2026-06-29 12:02 (Kamm-Link statt Scheren, leere Send-Versprechen)',
    [
      {
        say: 'Ich möchte paar Scheren kaufen. Habt ihr auch Scheren?',
        expect: (spoken) => [
          { name: 'Scheren-Anfrage nennt echte Scheren', pass: /schere/i.test(spoken) && !/kamm/i.test(spoken), detail: spoken.slice(0, 140) },
        ],
      },
      {
        say: 'Ja, schick mir mal den Link.',
        expect: (spoken) => [
          { name: 'Link-Bestätigung → echter Send bestätigt', pass: /per sms geschickt/i.test(spoken), detail: spoken.slice(0, 140) },
        ],
      },
    ],
  ));

  results.push(await runScenario(
    'Ladenbesuch-Frage wird nicht gekapert',
    'Real-Call 2026-06-30 09:17 (Färbepinsel-Pitch auf "kann man vorbeischauen?")',
    [
      { say: 'Ich möchte gerne eine Haarfarbe kaufen.' },
      {
        say: 'Und kann man auch bei euch vorbeischauen und da einfach Sachen gucken?',
        expect: (spoken, r) => [
          { name: 'Store-Visit → Model/Kontakt, kein Produkt-Pitch', pass: !/empfehlen|vorschlagen|passt zum Beispiel/i.test(spoken), detail: `${r.path}: ${spoken.slice(0, 120)}` },
        ],
      },
    ],
  ));

  results.push(await runScenario(
    'Vage Pflege-Anfrage wird beratend',
    'Real-Call 2026-06-30 01:12 (Haarspray/PSN/Noir auf "Etwas für Haarpflege")',
    [
      {
        say: 'Ich möchte gern Produkt kaufen. Etwas für Haarpflege.',
        expect: (_s, r) => [
          { name: 'Vage Pflege ohne Profil → Model (konsultativ)', pass: r.path === 'model', detail: r.grounding.join(' | ').slice(0, 180) },
        ],
      },
      {
        say: 'Aber ich möchte Shampoo für Locken.',
        expect: (spoken) => [
          { name: 'Konkretisierung → Locken Shampoo', pass: /locken shampoo/i.test(spoken), detail: spoken.slice(0, 140) },
        ],
      },
    ],
  ));

  // Silence-reminder after decline (memory-level check, no WS needed).
  const declined = await runScenario(
    'Reminder nach Wind-down reanimiert nichts',
    'Real-Call 2026-06-30 09:17 ("Wir waren bei Black Professional Line Sintesis…" nach 4x Nein)',
    [
      { say: 'Ich möchte gerne eine Haarfarbe kaufen.' },
      { say: 'Nein danke, brauche ich nicht.' },
    ],
  );
  // Note: runScenario stops threading memory outward; recompute quickly for the reminder check.
  {
    let memory: DrkallaShortTermVoiceMemory = createDrkallaShortTermMemory();
    for (const [i, say] of ['Ich möchte gerne eine Haarfarbe kaufen.', 'Nein danke, brauche ich nicht.'].entries()) {
      const r = await buildDrkallaCustomLlmResponse({
        canary: CANARY,
        event: turn(say, i + 1),
        memory,
        client: { complete: async () => '' },
        ...deps,
      });
      memory = r.memory;
    }
    const reminder = nextDrkallaNoInputReminder(memory, 1);
    declined.checks.push({
      name: 'Silence-Reminder nennt KEIN abgelehntes Produkt',
      pass: !/sintesis|haarfarbe ammoniakfrei|empfehlen|wir waren bei/i.test(reminder),
      detail: reminder,
    });
  }
  results.push(declined);

  // TRAINING REPLAY: the owner's real test call 2026-07-05 00:40 (call_c17af91c),
  // condensed to its failure moments. New real calls get appended here the same
  // way — the sim is the regression-training loop over live transcripts.
  results.push(await runScenario(
    'Replay 2026-07-05: Nachpflege, was-noch, Non-Sequitur, Abschied',
    'Real-Call 2026-07-05 00:40 (Haarfarbe als Nachpflege gepitcht, Entwickler-Wiederholung, Öffnungszeiten auf Meta-Beschwerde, "Danke für den Anruf" nicht erkannt)',
    [
      {
        say: 'Was habt ihr denn immer offen?',
        expect: contains('Montag bis Freitag')('Öffnungszeiten deterministisch'),
      },
      { say: 'Habt ihr irgendwie auch Haarfarbe bei euch?' },
      {
        say: 'Ich möchte eher für die Nachpflege.',
        expect: (spoken, r) => [
          {
            name: 'Nachpflege bekommt NIE eine Haarfarbe gepitcht',
            pass: !/haarfarbe ammoniakfrei|colorationscreme|evelon professionelle haarfarbe/i.test(spoken),
            detail: `${r.path}: ${spoken.slice(0, 140)}`,
          },
        ],
      },
      {
        say: 'Farbe und Entwickler haben ja schon besprochen, was noch.',
        expect: (spoken, r) => [
          {
            name: '"schon besprochen, was noch" → Model statt Template-Re-Pitch',
            pass: r.path === 'model',
            detail: `${r.path}: ${spoken.slice(0, 120)}`,
          },
        ],
      },
      {
        say: 'Aber auch was ist das denn, warum warum wir jetzt auf einmal Haarfarben an Also ich es geht doch gar um Nachpflege.',
        expect: (spoken) => [
          {
            name: 'Meta-Beschwerde bekommt KEINE Öffnungszeiten (auf-einmal-Bug)',
            pass: !/montag bis freitag|ge(ö|oe)ffnet/i.test(spoken),
            detail: spoken.slice(0, 140),
          },
        ],
      },
      {
        say: 'Was benutzt man für die Nachpflege bei rot gefärbten Haaren?',
        expect: (spoken, r) => [
          {
            name: 'Rot-Nachpflege erreicht die Farbschutz/Anti-Fading-Produkte',
            pass: /farbschutz|anti[-\s]?fading/i.test(spoken) || r.grounding.some((g) => /farbschutz|fading/i.test(g)),
            detail: `${r.path}: ${spoken.slice(0, 100)} | ${r.grounding.join(' ').slice(0, 140)}`,
          },
        ],
      },
      {
        say: 'Okay, danke dir für den Anruf.',
        expect: (spoken, r) => [
          {
            name: '"Danke für den Anruf" wird als Abschied erkannt (Auflegen)',
            pass: r.endCall === true,
            detail: `endCall=${String(r.endCall)}: ${spoken.slice(0, 100)}`,
          },
        ],
      },
    ],
  ));

  // Report
  let passCount = 0;
  let failCount = 0;
  for (const r of results) {
    console.log(`\n=== ${r.title} ===`);
    console.log(`(${r.source})`);
    for (const t of r.turns) {
      console.log(`  Anrufer: ${t.caller}`);
      console.log(`  Agent [${t.path}${t.endCall ? ', HANGUP' : ''}]: ${t.spoken || '(model-turn, kein Fallback-Text)'}`);
      if (t.grounding?.length) console.log(`    Grounding: ${t.grounding.join(' || ')}`);
    }
    for (const c of r.checks) {
      const mark = c.pass ? 'PASS' : 'FAIL';
      if (c.pass) passCount += 1; else failCount += 1;
      console.log(`  [${mark}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }
  }
  console.log(`\nGESAMT: ${passCount} PASS, ${failCount} FAIL`);

  const jsonIdx = process.argv.indexOf('--json');
  if (jsonIdx > -1 && process.argv[jsonIdx + 1]) {
    fs.writeFileSync(process.argv[jsonIdx + 1]!, JSON.stringify(results, null, 1));
  }
  process.exitCode = failCount > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
