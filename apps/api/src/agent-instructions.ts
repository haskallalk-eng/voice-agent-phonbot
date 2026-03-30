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

  // Inject current time context so the LLM can reason about open/closed
  const now = new Date();
  const berlinTime = now.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', hour: '2-digit', minute: '2-digit' });
  lines.push(`Current time (Europe/Berlin): ${berlinTime}`);
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

  return parts.join('\n');
}
