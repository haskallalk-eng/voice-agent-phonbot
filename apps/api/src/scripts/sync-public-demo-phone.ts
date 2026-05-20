import { pool } from '../db.js';
import {
  createAgent,
  createLLM,
  DEFAULT_VOICE_ID,
  getDefaultRetellLlmHighPriority,
  getDefaultRetellLlmModel,
  getLLM,
  listAgents,
  updateAgent,
  updateLLM,
  updatePhoneNumber,
  type RetellTool,
} from '../retell.js';
import { DEMO_POST_CALL_FIELDS, PHONBOT_PRODUCT_FACTS, demoRecordingDeclinedToolSignature } from '../demo.js';
import { DEMO_END_CALL_TOOL_DESCRIPTION } from '../end-call-policy.js';

const DEFAULT_PUBLIC_DEMO_PHONE_NUMBER = '+493075937286';
const AGENT_NAME = 'Phonbot Public Phone Demo';
const TEMPLATE_ID = 'phone-demo';

const PUBLIC_PHONE_DEMO_PROMPT = `# Phonbot Public Phone Demo

Du bist Chipy, der KI-Telefonassistent von Phonbot. Du sprichst mit Website-Besuchern, die die oeffentliche Telefon-Demo anrufen.

## Identitaet
- Dein Name ist Chipy.
- Du bist ausschliesslich von Phonbot.
- Nenne keine andere Marke, kein anderes Unternehmen und keinen Kundennamen als Absender.
- Wenn jemand fragt, wer dich gebaut hat: "Phonbot ist ein Produkt von Hassieb Kalla." Danach wieder zu Phonbot zurueck.

## Start
Starte kurz und immer sinngemaess:
"Hi, hier ist Chipy von Phonbot, ein KI-Telefonassistent. Dieser Demo-Anruf wird zur Qualitaetssicherung aufgezeichnet. Bist du damit einverstanden?"

Wenn der Anrufer klar zustimmt, frage:
"Super. Moechtest du eine kurze Demo-Simulation hoeren oder hast du Fragen zu Phonbot?"

Wenn der Anrufer nicht zustimmt oder Aufzeichnung/Speicherung ablehnt:
1. Rufe intern recording_declined auf.
2. Sage kurz: "Kein Problem, dann beende ich die Demo. Auf phonbot.de findest du alle Infos auch ohne Anruf."
3. Rufe intern end_call auf.

## Zwei Modi
1. Phonbot-Fragen: Beantworte kurz Fragen zu Preisen, Einrichtung, Telefonnummer, Kalender, Datenschutz, Stimmen, SMS, E-Mail, Testlink und menschlichem Beratungstermin.
2. Demo-Simulation: Spiele einen Branchen-Agenten realistisch, aber nur simuliert. Du kannst Beispiele fuer Friseur, Handwerk, Reinigung, Restaurant, Werkstatt oder Selbststaendige anbieten.

Der Anrufer darf jederzeit wechseln. Wenn er mitten in der Simulation nach Phonbot fragt, beantworte die Frage kurz und frage danach: "Willst du mit der Simulation weitermachen oder bei Phonbot bleiben?"

## Demo-Wahrheit
- Diese Telefon-Demo hat kein echtes Kalender-, SMS-, E-Mail- oder Weiterleitungs-Tool.
- Termine, Reservierungen, Tickets und Weiterleitungen sind immer Simulation.
- Sage niemals "gebucht", "eingetragen", "gesendet" oder "weitergeleitet", ohne direkt "in dieser Demo simuliert" zu sagen.
- Korrekt: "Ich habe deinen Terminwunsch fuer diese Demo simuliert aufgenommen."
- Falsch: "Der Termin ist fest gebucht."

## Voice-Regeln
- Antworte kurz: meistens 1 bis 2 Saetze.
- Stelle immer nur eine Frage auf einmal.
- Wenn der Anrufer "stopp", "stop", "halt", "warte", "nein", "nee", "falsch", "moment", "sekunde" oder "nochmal" sagt: sofort stoppen und sagen: "Alles klar, ich stoppe." Danach zuhoeren oder kurz fragen, ab welcher Stelle korrigiert werden soll.
- E-Mail-Adressen nur in kurzen Teilen klaeren. Nach zwei Korrekturen oder Frust auf SMS/Telefon ausweichen.
- Telefonnummern in Zweier- oder Dreierbloecken wiederholen.
- Sprich nie interne Tool-Namen, API-Begriffe, JSON, Unterstriche oder Funktionsnamen aus.

## Simulationsbeispiele
Friseur: Service, Wunschzeit, optional Wunschmitarbeiter, Name und Kontaktweg aufnehmen. Beispielpreise nur als Demo nennen: Herrenschnitt ab 28 Euro, Damenhaarschnitt ab 48 Euro, Balayage ab 140 Euro.
Handwerk: Problem, Dringlichkeit, Adresse grob, Name und Rueckrufweg aufnehmen. Bei Notfall keine falsche Sicherheit geben, sondern menschliche Ruecksprache anbieten.
Restaurant: Personenzahl, Datum, Uhrzeit, Name und Sonderwunsch aufnehmen. Immer als simulierte Reservierungsaufnahme markieren.
Allgemeine Phonbot-Demo: Zeige, dass du Anrufe verstehst, Daten strukturiert sammelst, bei Unsicherheit nachfragst und keine Aktionen erfindest.

## Menschlicher Beratungstermin
Wenn der Anrufer mit einem Menschen von Phonbot sprechen will, sammle Name, sicheren Kontaktweg und Wunschzeitfenster. Sage: "Ich nehme den Gespraechswunsch fuer unser Team auf. Wir melden uns mit einem konkreten Termin." Nicht behaupten, der Termin sei gebucht.

${PHONBOT_PRODUCT_FACTS}

## Abschluss
Nicht zu frueh auflegen. Erst fragen: "Kann ich noch etwas fuer dich tun?"
Wenn der Anrufer fertig ist, biete einmal den kostenlosen Testlink per SMS oder E-Mail an. Nur bei klarem Ja und sicherem Kontaktweg als Wunsch aufnehmen. Danach kurz verabschieden und intern end_call aufrufen.`;

function publicDemoPhoneNumber(): string {
  return process.env.PUBLIC_DEMO_PHONE_NUMBER?.trim()
    || process.env.RETELL_PUBLIC_DEMO_PHONE_NUMBER?.trim()
    || DEFAULT_PUBLIC_DEMO_PHONE_NUMBER;
}

function webhookBaseUrl(): string {
  const value = process.env.WEBHOOK_BASE_URL?.replace(/\/$/, '');
  if (!value) throw new Error('WEBHOOK_BASE_URL is required for public demo phone sync');
  return value;
}

function publicDemoTools(): RetellTool[] {
  const webhookBase = webhookBaseUrl();
  return [
    {
      type: 'end_call',
      name: 'end_call',
      description: DEMO_END_CALL_TOOL_DESCRIPTION,
    },
    {
      type: 'custom',
      name: 'recording_declined',
      description: 'Use once if the public demo caller declines recording or storage. Then politely end the demo. Never mention this tool name.',
      url: `${webhookBase}/retell/tools/demo.recording_declined?demo_sig=${demoRecordingDeclinedToolSignature()}`,
      execution_message_description: 'Markiere Demo-Aufzeichnung fuer Loeschung.',
      parameters: { type: 'object', properties: {} },
    },
  ];
}

function dbPool() {
  if (!pool) throw new Error('DATABASE_URL is required for public demo phone sync');
  return pool;
}

async function rememberDemoAgent(agentId: string): Promise<void> {
  await dbPool().query(
    `INSERT INTO demo_agent_templates (agent_id, template_id)
     VALUES ($1, $2)
     ON CONFLICT (agent_id) DO UPDATE SET template_id = EXCLUDED.template_id`,
    [agentId, TEMPLATE_ID],
  );
}

async function syncPublicDemoPhone(execute: boolean): Promise<void> {
  const phoneNumber = publicDemoPhoneNumber();
  const model = getDefaultRetellLlmModel();
  const modelHighPriority = getDefaultRetellLlmHighPriority();
  const tools = publicDemoTools();

  const agents = await listAgents();
  const existing = agents.find((agent) => agent.agent_name === AGENT_NAME);

  if (!execute) {
    console.log(JSON.stringify({
      dryRun: true,
      phoneNumber,
      agentName: AGENT_NAME,
      existingAgentId: existing?.agent_id ?? null,
      existingLlmId: existing?.response_engine?.llm_id ?? null,
      promptLength: PUBLIC_PHONE_DEMO_PROMPT.length,
      model,
      modelHighPriority,
      responsiveness: 0.95,
      knowledgeBaseIds: [],
    }, null, 2));
    return;
  }

  let agentId = existing?.agent_id ?? null;
  let llmId = existing?.response_engine?.llm_id ?? null;

  if (agentId && llmId) {
    await updateLLM(llmId, {
      generalPrompt: PUBLIC_PHONE_DEMO_PROMPT,
      tools,
      model,
      modelHighPriority,
      modelTemperature: 0.25,
      knowledgeBaseIds: [],
      kbConfig: undefined,
    });
    await updateAgent(agentId, {
      name: AGENT_NAME,
      llmId,
      voiceId: DEFAULT_VOICE_ID,
      language: 'de-DE',
      voiceSpeed: 1.1,
      responsiveness: 0.95,
      interruptionSensitivity: 0.8,
      enableBackchannel: false,
      webhookUrl: `${webhookBaseUrl()}/retell/webhook`,
      postCallAnalysisData: DEMO_POST_CALL_FIELDS,
      dataStorageSetting: 'everything',
      dataStorageRetentionDays: 90,
    });
  } else {
    const llm = await createLLM({
      generalPrompt: PUBLIC_PHONE_DEMO_PROMPT,
      tools,
      model,
      modelHighPriority,
      modelTemperature: 0.25,
      knowledgeBaseIds: [],
    });
    llmId = llm.llm_id;
    const agent = await createAgent({
      name: AGENT_NAME,
      llmId,
      voiceId: DEFAULT_VOICE_ID,
      language: 'de-DE',
      voiceSpeed: 1.1,
      responsiveness: 0.95,
      interruptionSensitivity: 0.8,
      enableBackchannel: false,
      webhookUrl: `${webhookBaseUrl()}/retell/webhook`,
      postCallAnalysisData: DEMO_POST_CALL_FIELDS,
      dataStorageSetting: 'everything',
      dataStorageRetentionDays: 90,
    });
    agentId = agent.agent_id;
  }

  if (!agentId || !llmId) throw new Error('Public demo phone sync did not resolve agent/LLM id');
  await updatePhoneNumber(phoneNumber, { inboundAgentId: agentId });
  await dbPool().query(`UPDATE phone_numbers SET agent_id = $1, updated_at = now() WHERE number = $2 AND org_id IS NULL`, [agentId, phoneNumber]);
  await rememberDemoAgent(agentId);

  const syncedLlm = await getLLM(llmId);
  console.log(JSON.stringify({
    ok: true,
    phoneNumber,
    agentId,
    llmId,
    model: syncedLlm.model,
    modelHighPriority: syncedLlm.model_high_priority,
    promptLength: syncedLlm.general_prompt?.length ?? 0,
    toolCount: syncedLlm.general_tools?.length ?? 0,
    knowledgeBaseIds: syncedLlm.knowledge_base_ids ?? [],
  }, null, 2));
}

syncPublicDemoPhone(process.argv.includes('--execute'))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end().catch(() => {});
  });
