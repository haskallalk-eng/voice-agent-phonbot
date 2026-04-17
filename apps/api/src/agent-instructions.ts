import type { readConfig } from './agent-config.js';

type AgentConfig = Awaited<ReturnType<typeof readConfig>>;

const DEFAULT_INSTRUCTIONS =
  'You are a helpful German/English voice agent for a small local business. Goal: book appointments, answer FAQs, and request missing details. Keep answers short, spoken, and polite. If information is missing, ask a single concrete question.';

/**
 * Parse structured opening hours and determine open/closed status.
 * Expected format: "Mo-Fr 09:00-18:00, Sa 10:00-14:00" or free-text.
 */
function buildOpeningHoursBlock(openingHours: string): string {
  const lines: string[] = [];
  lines.push(`Opening hours: ${openingHours.trim()}`);

  // Timezone context — actual time is determined at call-start, not deploy-time
  lines.push(`Timezone: Europe/Berlin. Use the current time at the moment of the call to determine if the business is open or closed.`);
  lines.push(
    'IMPORTANT: If the business is currently CLOSED based on the opening hours above, ' +
    'tell the caller politely that the business is currently closed, mention when they reopen, ' +
    'and offer to take a message or create a callback ticket. ' +
    'Do NOT pretend the business is open when it is closed.'
  );

  return lines.join('\n');
}

export function buildAgentInstructions(cfg: AgentConfig) {
  const parts = [cfg.systemPrompt || DEFAULT_INSTRUCTIONS];

  parts.push(`Agent name: ${cfg.name}`);
  parts.push(`Business name: ${cfg.businessName}`);

  if (cfg.businessDescription?.trim()) {
    parts.push(`Business description: ${cfg.businessDescription.trim()}`);
  }

  if (cfg.address?.trim()) {
    parts.push(`Address: ${cfg.address.trim()}`);
  }

  if (cfg.openingHours?.trim()) {
    parts.push(buildOpeningHoursBlock(cfg.openingHours));
  }

  if (cfg.servicesText?.trim()) {
    parts.push(`Services: ${cfg.servicesText.trim()}`);
  }

  parts.push(`Primary language: ${cfg.language}`);
  parts.push('Always stay concise, spoken, and practical.');

  if (cfg.fallback.enabled) {
    parts.push(`If you cannot complete the request live, guide the conversation toward a handoff/callback (${cfg.fallback.reason}).`);
  }

  // ── Call routing / transfer rules ──────────────────────────────────────
  const routingRules = (cfg as Record<string, unknown>).callRoutingRules as
    | Array<{ description: string; action: string; target?: string; enabled?: boolean }> | undefined;
  const activeRules = routingRules?.filter(r => r.enabled !== false) ?? [];

  if (activeRules.length > 0) {
    parts.push('');
    parts.push('## Anruf-Weiterleitung');
    parts.push('Du kannst Anrufe live an eine echte Person weiterleiten. Nutze das Tool "transfer_call" wenn eine der folgenden Situationen eintritt:');
    for (const rule of activeRules) {
      if (rule.action === 'transfer' && rule.target) {
        parts.push(`- ${rule.description} → Weiterleiten an ${rule.target}`);
      } else if (rule.action === 'ticket') {
        parts.push(`- ${rule.description} → Rückruf-Ticket erstellen`);
      } else if (rule.action === 'hangup') {
        parts.push(`- ${rule.description} → Gespräch höflich beenden`);
      }
    }
    parts.push('');
    parts.push('WICHTIG: Bevor du weiterleitest, sage dem Anrufer Bescheid: "Ich verbinde Sie jetzt mit [Ziel]. Einen Moment bitte."');
    parts.push('WARNUNG: Leite NIEMALS an die Nummer weiter, von der der Anrufer bereits weitergeleitet wurde (Endlosschleife). Wenn du unsicher bist, erstelle stattdessen ein Rückruf-Ticket.');
  }

  // ── Caller phone number (injected via Retell dynamic variables at call time) ──
  parts.push('');
  parts.push('## Anrufer-Telefonnummer');
  parts.push('Die Telefonnummer des Anrufers ist: {{from_number}}');
  parts.push('Nutze diese Nummer direkt wenn ein Ticket, Rückruf oder Termin erstellt wird.');
  parts.push('Frage NIEMALS nach der Telefonnummer — du hast sie bereits.');
  parts.push('Wenn du die Nummer bestätigen willst, sage z.B. "Ich habe Ihre Nummer bereits gespeichert."');

  // ── End-of-call feedback (non-intrusive) ──────────────────────────────────
  parts.push('');
  parts.push('## Feedback (nur am Ende)');
  parts.push('Wenn das Gespräch erfolgreich war (Termin gebucht, Frage beantwortet, Ticket erstellt), sage zum Schluss EINMAL beiläufig:');
  parts.push('"Übrigens, war alles so wie Sie sich das vorgestellt haben?"');
  parts.push('Wenn der Kunde positiv antwortet → "Super, freut mich! Schönen Tag noch."');
  parts.push('Wenn der Kunde etwas kritisiert → notiere den Kritikpunkt genau, sage "Danke für das Feedback, ich gebe das weiter."');
  parts.push('Wenn der Kunde es eilig hat oder nicht antwortet → überspringe es, kein Druck.');
  parts.push('Stelle diese Frage MAXIMAL einmal pro Gespräch und NUR am natürlichen Ende.');

  // ── Conversation quality & data quality ───────────────────────────────────
  parts.push('');
  parts.push('## Gesprächsqualität');
  parts.push('- Wenn du den Namen des Anrufers erfährst, nutze ihn im Gespräch (maximal 2-3x, nicht übertreiben)');
  parts.push('- Wiederhole wichtige Details zur Bestätigung: "Also Donnerstag um 14 Uhr, richtig?"');
  parts.push('- Wenn du etwas nicht verstanden hast, frage konkret nach statt zu raten');
  parts.push('- Fasse am Ende kurz zusammen was vereinbart wurde');
  parts.push('');
  parts.push('## Datenqualität');
  parts.push('- Telefonnummer: Du hast sie bereits ({{from_number}}), frage NICHT danach');
  parts.push('- Name: Frage einmal freundlich "Darf ich fragen mit wem ich spreche?" — wenn der Kunde nicht will, akzeptiere es');
  parts.push('- Bei Terminbuchung: Bestätige Datum, Uhrzeit und Service');
  parts.push('- Bei Tickets: Wiederhole den Grund und die Kontaktdaten');

  return parts.join('\n');
}
