/**
 * Twilio ↔ OpenAI Realtime Audio Bridge
 *
 * Flow:
 * 1. Backend creates outbound Twilio call with TwiML URL pointing to /outbound/twiml/:sessionId
 * 2. When user picks up, Twilio fetches TwiML and opens WebSocket to /outbound/ws/:sessionId
 * 3. This module bridges Twilio's mulaw audio stream to OpenAI Realtime API
 * 4. OpenAI acts as the AI voice agent
 */

import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import WS from 'ws';

// ── Sales prompt for website callback ─────────────────────────────────────────

const CALLBACK_PROMPT = `Du bist Chippy, der freundliche KI-Assistent von Phonbot. Du rufst gerade jemanden an, der sich auf der Phonbot-Website einen kostenlosen Demo-Anruf gewünscht hat.

DEIN ZIEL: Zeige live wie ein KI-Telefonagent klingt und funktioniert. Sei warm, direkt und authentisch — nicht aufdringlich.

GESPRÄCHSABLAUF:
1. Begrüße den Anrufer: "Hallo! Hier ist Chippy von Phonbot — du hattest gerade auf unserer Website einen Rückruf angefordert. Ich bin ein KI-Telefonassistent und zeige dir gerade live was ich kann. Cool oder?"
2. Frage kurz: "Was für ein Business hast du? Ich bin neugierig!"
3. Basierend auf der Antwort erkläre konkret wie Phonbot helfen kann. Beispiele:
   - Friseur: "Ich würde einfach deine Terminanfragen annehmen während du schneidest."
   - Handwerker: "Du bist auf der Baustelle — ich nehme den Anruf an und erstelle ein sauberes Ticket für dich."
   - Arzt: "Dein Team ist beschäftigt — ich buche Termine direkt in deinen Kalender."
4. "Wie viele Anrufe verpasst du ungefähr pro Tag?"
5. Wenn sie antworten: "Das sind im Monat ca. X verpasste Chancen. Phonbot geht bei jedem einzelnen ran — kostenlos testbar mit 100 Freiminuten."
6. Abschluss: "Registriere dich einfach auf phonbot.de — kostenlos, keine Kreditkarte. Soll ich dir noch etwas erklären?"

REGELN:
- Sprich natürlich Deutsch, locker und freundlich
- Maximal 2-3 kurze Sätze pro Antwort
- Lass den Gesprächspartner reden
- Sei ehrlich: wenn Phonbot nicht passt, sag das
- Halte das Gespräch unter 3 Minuten`;

// ── In-memory session store ───────────────────────────────────────────────────

interface CallSession {
  name?: string;
  phone: string;
  prompt?: string;
  createdAt: number;
}

const sessions = new Map<string, CallSession>();
const SESSION_TTL = 1000 * 60 * 10; // 10 min

export function createSession(sessionId: string, data: CallSession) {
  sessions.set(sessionId, data);
  // Auto-cleanup
  setTimeout(() => sessions.delete(sessionId), SESSION_TTL);
}

/**
 * Create an outbound Twilio call and set up an OpenAI bridge session.
 * Returns the Twilio call SID to use as a tracking ID.
 */
export async function triggerBridgeCall(params: {
  toNumber: string;
  fromNumber: string;
  prompt: string;
  name?: string;
  webhookBase: string;
  twilioSid: string;
  twilioToken: string;
}): Promise<{ ok: boolean; sessionId: string; twilioCallSid?: string; error?: string }> {
  const sessionId = crypto.randomUUID();
  createSession(sessionId, { phone: params.toNumber, name: params.name, prompt: params.prompt, createdAt: Date.now() });

  const twimlUrl = `${params.webhookBase}/outbound/twiml/${sessionId}`;

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${params.twilioSid}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${params.twilioSid}:${params.twilioToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: params.toNumber, From: params.fromNumber, Url: twimlUrl, Method: 'POST' }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    sessions.delete(sessionId);
    return { ok: false, sessionId, error: body };
  }

  const data = await res.json() as { sid?: string };
  return { ok: true, sessionId, twilioCallSid: data.sid };
}

// ── Route registration ────────────────────────────────────────────────────────

export async function registerTwilioBridge(app: FastifyInstance) {
  // POST /outbound/twiml/:sessionId
  // Twilio fetches this when the user picks up the outbound call.
  // Returns TwiML that connects Twilio's audio stream to our WebSocket bridge.
  app.post('/outbound/twiml/:sessionId', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const webhookBase = process.env.WEBHOOK_BASE_URL ?? 'http://localhost:3001';
    const wsBase = webhookBase.replace(/^https?/, 'wss').replace(/^http:/, 'ws:');
    const wsUrl = `${wsBase}/outbound/ws/${sessionId}`;

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Response>',
      '  <Connect>',
      `    <Stream url="${wsUrl}"/>`,
      '  </Connect>',
      '</Response>',
    ].join('\n');

    reply.header('Content-Type', 'text/xml; charset=utf-8').send(xml);
  });

  // WS /outbound/ws/:sessionId
  // Twilio connects here with a bidirectional audio stream (mulaw 8kHz).
  // We forward it to OpenAI Realtime API.
  app.get('/outbound/ws/:sessionId', { websocket: true }, (socket, req) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = sessions.get(sessionId);
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      app.log.warn('OPENAI_API_KEY not set — closing bridge WebSocket');
      socket.close();
      return;
    }

    app.log.info({ sessionId, caller: session?.name }, 'Twilio audio stream connected — opening OpenAI bridge');

    // Open OpenAI Realtime WebSocket (uses ws for custom headers support)
    const openai = new WS(
      'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',
      {
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      },
    );

    let streamSid: string | null = null;
    let openaiReady = false;
    const pendingAudio: string[] = []; // buffer until OpenAI is ready

    // ── OpenAI → Twilio ───────────────────────────────────────────────────────

    openai.on('open', () => {
      app.log.info({ sessionId }, 'OpenAI Realtime connected');
      openaiReady = true;

      // Configure session: use g711 mulaw (same as Twilio — no conversion needed)
      openai.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          instructions: session?.prompt ?? CALLBACK_PROMPT,
          voice: 'alloy',
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
          },
        },
      }));

      // Flush buffered audio
      for (const payload of pendingAudio) {
        openai.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: payload }));
      }
      pendingAudio.length = 0;

      // Trigger initial greeting
      openai.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio', 'text'] } }));
    });

    openai.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;

        if (msg.type === 'response.audio.delta' && typeof msg.delta === 'string') {
          // Send audio back to Twilio
          if (streamSid) {
            socket.send(JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: msg.delta },
            }));
          }
        }

        if (msg.type === 'response.audio_buffer.speech_started') {
          // User started speaking — interrupt current TTS playback
          if (streamSid) {
            socket.send(JSON.stringify({ event: 'clear', streamSid }));
          }
        }
      } catch {
        // ignore parse errors
      }
    });

    openai.on('error', (err) => {
      app.log.warn({ err: err.message, sessionId }, 'OpenAI Realtime error');
    });

    openai.on('close', () => {
      app.log.info({ sessionId }, 'OpenAI Realtime connection closed');
      if (socket.readyState === WS.OPEN) socket.close();
    });

    // ── Twilio → OpenAI ───────────────────────────────────────────────────────

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;

        if (msg.event === 'start') {
          const start = msg.start as { streamSid?: string } | undefined;
          streamSid = start?.streamSid ?? null;
          app.log.info({ sessionId, streamSid }, 'Twilio stream started');
        }

        if (msg.event === 'media') {
          const media = msg.media as { payload?: string } | undefined;
          if (!media?.payload) return;

          if (openaiReady && openai.readyState === WS.OPEN) {
            openai.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: media.payload }));
          } else {
            pendingAudio.push(media.payload);
          }
        }

        if (msg.event === 'stop') {
          app.log.info({ sessionId }, 'Twilio stream stopped — closing OpenAI connection');
          if (openai.readyState === WS.OPEN) openai.close();
        }
      } catch {
        // ignore parse errors
      }
    });

    socket.on('close', () => {
      app.log.info({ sessionId }, 'Twilio WebSocket closed');
      if (openai.readyState === WS.OPEN) openai.close();
      sessions.delete(sessionId);
    });

    socket.on('error', (err) => {
      app.log.warn({ err: (err as Error).message, sessionId }, 'Twilio WebSocket error');
    });
  });
}
