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
import { pool } from './db.js';
import { redis } from './redis.js';

// Pin OpenAI Realtime model via env var (avoids silent breakage when "preview" alias changes)
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? 'gpt-4o-realtime-preview-2024-12-17';

// ── Sales prompt for website callback ─────────────────────────────────────────

const CALLBACK_PROMPT = `Du bist Chipy, der freundliche KI-Assistent von Phonbot. Du rufst gerade jemanden an, der sich auf der Phonbot-Website einen kostenlosen Demo-Anruf gewünscht hat.

DEIN ZIEL: Zeige live wie ein KI-Telefonagent klingt und funktioniert. Sei warm, direkt und authentisch — nicht aufdringlich.

GESPRÄCHSABLAUF:
1. Begrüße den Anrufer: "Hallo! Hier ist Chipy von Phonbot — du hattest gerade auf unserer Website einen Rückruf angefordert. Ich bin ein KI-Telefonassistent und zeige dir gerade live was ich kann. Cool oder?"
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

// ── Session store (Redis with in-memory fallback for dev) ─────────────────────
//
// Why Redis: bridge sessions must survive across horizontally-scaled API containers.
// A call started on container A might be routed by Twilio to container B on reconnect.

interface CallSession {
  name?: string;
  phone: string;
  prompt?: string;
  createdAt: number;
  outboundRecordId?: string;
}

const SESSION_PREFIX = 'bridge_session:';
const SESSION_TTL_SEC = 600; // 10 min
const inMemSessions = new Map<string, CallSession>();

export async function createSession(sessionId: string, data: CallSession): Promise<void> {
  if (redis?.isOpen) {
    await redis.set(SESSION_PREFIX + sessionId, JSON.stringify(data), { EX: SESSION_TTL_SEC });
  } else {
    inMemSessions.set(sessionId, data);
    setTimeout(() => inMemSessions.delete(sessionId), SESSION_TTL_SEC * 1000);
  }
}

async function getSession(sessionId: string): Promise<CallSession | null> {
  if (redis?.isOpen) {
    const raw = await redis.get(SESSION_PREFIX + sessionId);
    if (!raw) return null;
    try { return JSON.parse(raw) as CallSession; } catch { return null; }
  }
  return inMemSessions.get(sessionId) ?? null;
}

async function deleteSession(sessionId: string): Promise<void> {
  if (redis?.isOpen) {
    await redis.del(SESSION_PREFIX + sessionId);
  } else {
    inMemSessions.delete(sessionId);
  }
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
  outboundRecordId?: string;
}): Promise<{ ok: boolean; sessionId: string; twilioCallSid?: string; error?: string }> {
  const sessionId = crypto.randomUUID();
  await createSession(sessionId, { phone: params.toNumber, name: params.name, prompt: params.prompt, createdAt: Date.now(), outboundRecordId: params.outboundRecordId });

  const twimlUrl = `${params.webhookBase}/outbound/twiml/${sessionId}`;
  const statusCallback = params.outboundRecordId ? `${params.webhookBase}/outbound/status/${sessionId}` : undefined;

  const urlParams: Record<string, string> = { To: params.toNumber, From: params.fromNumber, Url: twimlUrl, Method: 'POST' };
  if (statusCallback) {
    urlParams.StatusCallback = statusCallback;
    urlParams.StatusCallbackEvent = 'completed';
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${params.twilioSid}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${params.twilioSid}:${params.twilioToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(urlParams),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    await deleteSession(sessionId);
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

  // POST /outbound/status/:sessionId — Twilio StatusCallback (application/x-www-form-urlencoded)
  // Updates outbound_calls.status to the final disposition (completed/failed/no-answer/busy/canceled).
  // Without this, calls that never connect (VoiceMail, busy, network) remain status='calling' forever.
  app.post('/outbound/status/:sessionId', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = (req.body ?? {}) as Record<string, string>;
    const callStatus = body.CallStatus ?? 'unknown';
    // Twilio statuses: queued, ringing, in-progress, completed, busy, failed, no-answer, canceled
    const terminal = ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus);

    const session = await getSession(sessionId);
    if (pool && session?.outboundRecordId) {
      const mappedStatus = callStatus === 'completed' ? 'completed'
        : callStatus === 'busy' ? 'busy'
        : callStatus === 'no-answer' ? 'no_answer'
        : callStatus === 'canceled' ? 'canceled'
        : callStatus === 'failed' ? 'failed'
        : callStatus;
      await pool.query(
        `UPDATE outbound_calls SET status = $1 WHERE id = $2`,
        [mappedStatus, session.outboundRecordId],
      ).catch((err: Error) => app.log.warn({ err: err.message, sessionId }, 'status update failed'));
    }

    if (terminal) {
      await deleteSession(sessionId).catch(() => {});
    }

    reply.code(200).send('');
  });

  // WS /outbound/ws/:sessionId
  // Twilio connects here with a bidirectional audio stream (mulaw 8kHz).
  // We forward it to OpenAI Realtime API.
  app.get('/outbound/ws/:sessionId', { websocket: true }, async (socket, req) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = await getSession(sessionId);
    const openaiKey = process.env.OPENAI_API_KEY;

    // Require a valid, server-created session. Without this, anyone with a guessable
    // sessionId could open a WS → pipe audio to OpenAI on our dime and exfiltrate TTS.
    // Twilio Media Streams don't send an Origin header, so we can't use origin checks;
    // rely on the UUID session secret + existence-in-Redis as the authenticator.
    if (!session) {
      app.log.warn({ sessionId, ip: req.ip }, 'Rejecting outbound WS — session not found or expired');
      socket.close();
      return;
    }

    if (!openaiKey) {
      app.log.warn('OPENAI_API_KEY not set — closing bridge WebSocket');
      socket.close();
      return;
    }

    app.log.info({ sessionId, caller: session?.name, model: OPENAI_REALTIME_MODEL }, 'Twilio audio stream connected — opening OpenAI bridge');

    // Open OpenAI Realtime WebSocket (uses ws for custom headers support)
    const openai = new WS(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(OPENAI_REALTIME_MODEL)}`,
      {
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      },
    );

    let streamSid: string | null = null;
    const transcriptParts: string[] = [];
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
          input_audio_transcription: { model: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1' },
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

        // Collect transcript pieces
        if (msg.type === 'response.audio_transcript.done' && typeof msg.transcript === 'string') {
          transcriptParts.push(`Agent: ${msg.transcript}`);
        }
        if (msg.type === 'conversation.item.input_audio_transcription.completed' && typeof msg.transcript === 'string') {
          transcriptParts.push(`User: ${msg.transcript}`);
        }

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

      // Save transcript to outbound_calls if this was an outbound call.
      // Errors here are loud (not swallowed) — losing a transcript silently means
      // no audit trail, no billing cross-check, no learning, and a stuck row at
      // status='calling' until StatusCallback rescues it. Run as IIFE so the
      // socket close handler doesn't await; any rejection is logged.
      const transcript = transcriptParts.join('\n');
      const recordId = session?.outboundRecordId;
      if (recordId && transcript && pool) {
        const localPool = pool;
        (async () => {
          try {
            await localPool.query(
              `UPDATE outbound_calls SET transcript = $1, status = 'completed' WHERE id = $2`,
              [transcript, recordId],
            );
            const { analyzeOutboundCall } = await import('./outbound-insights.js');
            const orgRes = await localPool.query(
              `SELECT org_id FROM outbound_calls WHERE id = $1`,
              [recordId],
            );
            const orgId = orgRes.rows[0]?.org_id as string | undefined;
            if (orgId) {
              await analyzeOutboundCall(orgId, recordId, transcript);
            } else {
              app.log.warn({ sessionId, recordId }, 'transcript persisted but no org_id — analysis skipped');
            }
          } catch (err) {
            app.log.error(
              { sessionId, recordId, err: err instanceof Error ? err.message : String(err) },
              'transcript persist or analysis failed',
            );
          }
        })();
      }

      deleteSession(sessionId).catch((err: Error) =>
        app.log.warn({ sessionId, err: err.message }, 'session delete failed'),
      );
    });

    socket.on('error', (err) => {
      app.log.warn({ err: (err as Error).message, sessionId }, 'Twilio WebSocket error');
    });
  });
}
