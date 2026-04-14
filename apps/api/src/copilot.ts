import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import type { JwtPayload } from './auth.js';

// ── Types ─────────────────────────────────────────────────────────────────────

// Role restricted to user/assistant — clients MUST NOT inject 'system' or 'tool' roles
// (would override our SYSTEM_PROMPT and turn the copilot into generic ChatGPT on our bill).
const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(2000),
});

const MAX_HISTORY_TOTAL_CHARS = 8000; // hard cap across all history messages

const CopilotChatBody = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(ChatMessageSchema).max(20).optional(),
}).refine(
  (data) => {
    const total = (data.history ?? []).reduce((sum, m) => sum + m.content.length, 0);
    return total <= MAX_HISTORY_TOTAL_CHARS;
  },
  { message: `History too long (max ${MAX_HISTORY_TOTAL_CHARS} chars total)` },
);

type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ── OpenAI tool definitions ───────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_agent_config',
      description: 'Liest die Agent-Konfiguration der Organisation des Nutzers aus der Datenbank.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_tickets_summary',
      description: 'Gibt eine Zusammenfassung der Tickets zurück: Anzahl offener und geschlossener Tickets.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_usage',
      description: 'Gibt die Nutzungsstatistiken zurück: genutzte Minuten, Limit und aktueller Plan.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_calendar_status',
      description: 'Prüft, ob ein Kalender verbunden ist, und gibt den Verbindungsstatus zurück.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_phone_numbers',
      description: 'Listet alle konfigurierten Telefonnummern der Organisation auf.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleToolCall(name: string, orgId: string): Promise<string> {
  if (!pool) return JSON.stringify({ error: 'Datenbank nicht verfügbar' });

  try {
    switch (name) {
      case 'get_agent_config': {
        const result = await pool.query(
          `SELECT data FROM agent_configs WHERE org_id = $1 ORDER BY updated_at DESC LIMIT 1`,
          [orgId],
        );
        if (!result.rowCount || result.rowCount === 0) {
          return JSON.stringify({ configured: false, message: 'Noch kein Agent konfiguriert' });
        }
        const data = result.rows[0].data as Record<string, unknown>;
        // Return a safe subset — no secrets
        return JSON.stringify({
          configured: true,
          name: data.name,
          businessName: data.businessName,
          language: data.language,
          voice: data.voice,
          deployed: !!(data.retellAgentId),
          toolsEnabled: Array.isArray(data.tools) ? data.tools : [],
          fallbackEnabled: (data.fallback as { enabled?: boolean } | undefined)?.enabled ?? false,
        });
      }

      case 'get_tickets_summary': {
        const result = await pool.query(
          `SELECT status, COUNT(*) as count
           FROM tickets
           WHERE org_id = $1
           GROUP BY status`,
          [orgId],
        );
        const counts: Record<string, number> = { open: 0, assigned: 0, done: 0 };
        for (const row of result.rows) {
          counts[row.status as string] = parseInt(row.count as string, 10);
        }
        return JSON.stringify({
          open: counts['open'] ?? 0,
          assigned: counts['assigned'] ?? 0,
          done: counts['done'] ?? 0,
          total: Object.values(counts).reduce((a, b) => a + b, 0),
        });
      }

      case 'get_usage': {
        const result = await pool.query(
          `SELECT plan, minutes_used, minutes_limit FROM orgs WHERE id = $1`,
          [orgId],
        );
        if (!result.rowCount || result.rowCount === 0) {
          return JSON.stringify({ error: 'Organisation nicht gefunden' });
        }
        const row = result.rows[0] as { plan: string; minutes_used: number; minutes_limit: number };
        return JSON.stringify({
          plan: row.plan ?? 'free',
          minutes_used: row.minutes_used ?? 0,
          minutes_limit: row.minutes_limit ?? 60,
          minutes_remaining: Math.max(0, (row.minutes_limit ?? 60) - (row.minutes_used ?? 0)),
        });
      }

      case 'get_calendar_status': {
        const result = await pool.query(
          `SELECT provider, email, connected_at FROM calendar_connections WHERE org_id = $1 LIMIT 1`,
          [orgId],
        );
        if (!result.rowCount || result.rowCount === 0) {
          return JSON.stringify({ connected: false });
        }
        const row = result.rows[0] as { provider: string; email: string | null; connected_at: string };
        return JSON.stringify({
          connected: true,
          provider: row.provider,
          email: row.email,
          connectedSince: row.connected_at,
        });
      }

      case 'get_phone_numbers': {
        const result = await pool.query(
          `SELECT number, number_pretty, verified, method FROM phone_numbers WHERE org_id = $1`,
          [orgId],
        );
        return JSON.stringify({
          count: result.rowCount ?? 0,
          numbers: result.rows.map((r: Record<string, unknown>) => ({
            number: r['number'],
            display: r['number_pretty'] ?? r['number'],
            verified: r['verified'],
            method: r['method'],
          })),
        });
      }

      default:
        return JSON.stringify({ error: `Unbekanntes Tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: `Fehler beim Abrufen der Daten: ${(err as Error).message}` });
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du bist Chipy, das Phonbot-Maskottchen — ein freundlicher goldener Hamster der alles über die Phonbot-Software weiß.

## Was ist Phonbot?
Phonbot ist ein KI-Telefonassistent für Unternehmen. Der Agent beantwortet eingehende Anrufe automatisch, berät Kunden, bucht Termine, erstellt Tickets und kann sogar ausgehende Sales-Anrufe führen.

## Dein Stil
- Casual, freundlich, wie ein hilfsbereiter Kumpel — du bist Chipy, kein Corporate-Bot
- Immer Deutsch (außer der Nutzer schreibt Englisch)
- Konkrete Antworten mit genauen Schritt-für-Schritt-Anleitungen
- Kurz und übersichtlich — kein Gelaber
- Wenn du was nicht weißt, sag es ehrlich

## Du kannst auf folgende Nutzerdaten zugreifen (read-only)
Nutze deine Tools aktiv um Fragen zu beantworten! Wenn jemand nach seinem Status fragt, schau nach.

---

## DASHBOARD-NAVIGATION (Sidebar links)
Die Sidebar hat folgende Bereiche. Erkläre dem Nutzer immer genau wo er hinklicken muss.

### 📊 Dashboard (Startseite)
- Übersicht: Anrufstatistiken, Minutenverbrauch, letzte Tickets
- Zeigt den aktuellen Plan und verbleibende Minuten
- Quick-Actions zum Testen des Agents

### 📞 Anrufe
- Liste aller ein- und ausgehenden Anrufe
- Zeigt: Datum, Dauer, Telefonnummer, Status
- Anrufdetails mit Transkript (wenn verfügbar)
- Aufnahmen können angehört werden

### 🎫 Tickets
- Alle Rückrufwünsche und Anfragen die der Agent erstellt hat
- Status: Offen / In Bearbeitung / Erledigt
- Jedes Ticket zeigt: Kundenname, Telefon, Grund, Wunschzeit, Service
- Tickets können bearbeitet und geschlossen werden
- "Rückruf starten" Button — startet einen KI-Rückruf zum Kunden

### 📅 Kalender
- **Chipy Kalender** (eingebaut): Öffnungszeiten pro Wochentag konfigurieren, Buchungen verwalten, Tage blockieren
- **Google Calendar** verbinden: Sidebar → Kalender → "Google Calendar verbinden" Button → Google Login → fertig
- **Microsoft Outlook** verbinden: Kalender → "Microsoft verbinden" → Azure Login
- **Cal.com** verbinden: Kalender → "Cal.com" Tab → API Key eingeben
- Der Agent nutzt den verbundenen Kalender automatisch für Terminbuchungen

**Chipy Kalender einrichten:**
1. Gehe zu Kalender in der Sidebar
2. Öffnungszeiten für jeden Wochentag einstellen (z.B. Mo-Fr 9:00-17:00)
3. Optional: Einzelne Tage blockieren (Urlaub etc.)
4. Buchungen erscheinen automatisch wenn Kunden über den Agent buchen

### 🧠 KI-Insights
- Automatische Analyse jedes Anrufs (Score 1-10)
- Zeigt Schwachstellen und Verbesserungsvorschläge für den Agent-Prompt
- Prompt-Versionen mit Rollback-Möglichkeit
- A/B-Tests: Automatisches Testen von Prompt-Varianten
- "Vorschlag anwenden" → Chipy verbessert den Prompt automatisch
- "Prompt konsolidieren" → fasst angesammelte Regeln zusammen

### 🤖 Agent Builder
**So richtest du deinen Agent ein:**
1. Sidebar → Agent Builder
2. **Template wählen** (beim ersten Mal): Friseur, Handwerker, Arzt, Reinigung, Restaurant, KFZ-Werkstatt oder Custom
3. **Grundeinstellungen:**
   - Name des Agents (z.B. "Lisa")
   - Name des Unternehmens
   - Sprache (Deutsch/Englisch/etc.)
   - Stimme auswählen (aus der Stimmen-Liste oder eigene klonen)
4. **Systemanweisung:** Der Hauptprompt — beschreibt wie der Agent sich verhalten soll
   - Template gibt eine Basis vor, die du anpassen kannst
   - Öffnungszeiten, Services, spezielle Regeln hier eintragen
5. **Wissensquellen** (optional): URLs, PDFs oder Text hinzufügen als Kontext
6. **Tools konfigurieren:**
   - Terminbuchung (braucht verbundenen Kalender)
   - Ticket erstellen (Standard: an)
   - Rückruf auslösen
7. **"Agent aktivieren"** Button → deployed den Agent bei Retell AI
8. Nach dem Deployen: Agent testen auf der Test-Seite

**Stimme ändern:**
- Im Agent Builder → Stimme-Dropdown
- Zeigt alle verfügbaren Stimmen (Retell + eigene geklonte)
- Voice Cloning: Audio-Datei (MP3/WAV) hochladen → eigene Stimme erstellen

### 🧪 Testen
- **Web-Call Test:** Startet einen Testanruf direkt im Browser
  - Klick auf "Testanruf starten"
  - Mikrofon erlauben
  - Du sprichst direkt mit deinem Agent
- **Vorschau:** Zeigt den aktuellen Agent-Status und Konfiguration

### 📱 Telefon
- **Nummer provisionieren:** Sidebar → Telefon → "Neue Nummer" → Vorwahl wählen (z.B. 30 für Berlin) → Deutsche Nummer wird automatisch eingerichtet
- **Eigene Nummer importieren:** Twilio-Nummer importieren (braucht Twilio Account)
- **Rufumleitung:** Eigene Geschäftsnummer weiterleiten an die Phonbot-Nummer
  - Anleitung für iPhone, Android und FritzBox wird angezeigt
- **Verifizieren:** Testet ob die Weiterleitung funktioniert

### 💳 Billing
- **Pläne:**
  - Free: 100 Minuten/Monat, 1 Agent
  - Starter: 500 Minuten, Priority Support
  - Pro: 2000 Minuten, Custom Voice, API Access
  - Agency: 10.000 Minuten, Multi-Tenant, White Label
- **Plan wechseln:** Billing → gewünschten Plan klicken → Stripe Checkout
- **Minutenverbrauch:** Zeigt genutzte/verfügbare Minuten
- **Rechnungen & Portal:** "Kundenportal" Button → Stripe Portal für Rechnungen, Zahlungsmethode ändern, kündigen

---

## ONBOARDING (für neue Nutzer)
Wenn ein Nutzer neu ist und fragt wie er anfangen soll:
1. **Registrieren** → E-Mail + Passwort + Firmenname
2. **Template wählen** → passend zur Branche
3. **Agent konfigurieren** → Name, Stimme, Prompt anpassen
4. **Agent aktivieren** → "Agent aktivieren" Button im Agent Builder
5. **Testen** → Sidebar → Testen → "Testanruf starten"
6. **Telefonnummer** → Sidebar → Telefon → Nummer einrichten
7. **Kalender verbinden** (optional) → für automatische Terminbuchung
8. **Live gehen!** → Rufumleitung aktivieren oder provisionierte Nummer nutzen

## OUTBOUND CALLS (Ausgehende Anrufe)
- Sidebar → Outbound (wenn aktiviert)
- KI-gesteuerte Verkaufsanrufe
- Konfigurierbar: Prompt, Zielgruppe, Kampagne
- Scores und Analyse nach jedem Call
- Automatische Prompt-Optimierung basierend auf Conversion-Rate

## HÄUFIGE PROBLEME & LÖSUNGEN

**"Agent aktivieren funktioniert nicht"**
→ Prüfe ob alle Pflichtfelder ausgefüllt sind (Name, Unternehmensname, Systemanweisung)

**"Testanruf geht nicht"**
→ Mikrofon-Berechtigung im Browser erlauben → Seite refreshen → nochmal versuchen

**"Anrufe kommen nicht an"**
→ Telefon-Seite prüfen: Ist eine Nummer eingerichtet? Ist die Rufumleitung aktiv?

**"Kalender synchronisiert nicht"**
→ Kalender-Seite: Verbindung prüfen → ggf. neu verbinden (Token abgelaufen?)

**"Minuten aufgebraucht"**
→ Billing → Plan upgraden oder nächsten Monat abwarten (Reset am Monatsanfang)

**"Stimme klingt nicht gut"**
→ Agent Builder → andere Stimme auswählen. Für beste Qualität: eigene Stimme mit mind. 30s klarem Audio klonen

**"Wie ändere ich was der Agent sagt?"**
→ Agent Builder → Systemanweisung bearbeiten → "Agent aktualisieren" klicken

**Account löschen**
→ Sidebar ganz unten → Nutzername klicken → "Account löschen" → "LÖSCHEN" eintippen → bestätigen (DSGVO-konform, löscht alle Daten)

## WICHTIG
- Antworte IMMER mit konkreten Schritten ("Gehe zu X → Klicke auf Y → ...")
- Nutze deine Tools um den aktuellen Status des Nutzers zu prüfen bevor du rätst
- Wenn der Nutzer ein Problem beschreibt, frag nach Details statt zu raten`;

// ── Route registration ────────────────────────────────────────────────────────

export async function registerCopilot(app: FastifyInstance) {
  // POST /copilot/chat — authenticated, rate limited to 20 req/min
  app.post(
    '/copilot/chat',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req: FastifyRequest, reply) => {
      const parsed = CopilotChatBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
      }

      const { message, history = [] } = parsed.data;
      const { orgId } = req.user as JwtPayload;

      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return reply.status(503).send({ error: 'OpenAI nicht konfiguriert' });
      }

      // Build messages array
      const messages: Array<{ role: string; content: string; tool_call_id?: string; name?: string }> = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map((m: ChatMessage) => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ];

      // Agentic loop — max 5 iterations to prevent runaway tool calls
      let iterations = 0;
      const MAX_ITER = 5;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (iterations >= MAX_ITER) break;
        iterations++;

        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages,
            tools: TOOLS,
            tool_choice: 'auto',
            max_tokens: 1024,
            temperature: 0.7,
          }),
        });

        if (!openaiRes.ok) {
          const errText = await openaiRes.text();
          app.log.error({ status: openaiRes.status, body: errText }, 'OpenAI API error');
          return reply.status(502).send({ error: 'KI-Antwort konnte nicht generiert werden' });
        }

        type OpenAIResponse = {
          choices: Array<{
            message: {
              role: string;
              content: string | null;
              tool_calls?: Array<{
                id: string;
                type: string;
                function: { name: string; arguments: string };
              }>;
            };
            finish_reason: string;
          }>;
        };

        const data = (await openaiRes.json()) as OpenAIResponse;
        const choice = data.choices[0];

        if (!choice) {
          return reply.status(502).send({ error: 'Keine Antwort von der KI' });
        }

        const assistantMessage = choice.message;

        // If no tool calls — we're done, return the text response
        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
          return reply.send({
            ok: true,
            reply: assistantMessage.content ?? '',
          });
        }

        // Process tool calls
        messages.push({
          role: 'assistant',
          content: assistantMessage.content ?? '',
          // @ts-expect-error — tool_calls are part of the OpenAI API shape
          tool_calls: assistantMessage.tool_calls,
        });

        for (const toolCall of assistantMessage.tool_calls) {
          const toolResult = await handleToolCall(toolCall.function.name, orgId);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: toolResult,
          });
        }
      }

      return reply.status(500).send({ error: 'Maximale Iterations-Tiefe erreicht' });
    },
  );
}
