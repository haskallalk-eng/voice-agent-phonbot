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
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import WS from 'ws';
import twilio from 'twilio';
import { pool } from './db.js';
import { redis } from './redis.js';
import { tryReserveMinutes, bindMinutesReservation, releaseMinutesReservation, reconcileMinutes } from './usage.js';

// Twilio signs every webhook with HMAC-SHA1(authToken, fullUrl + sortedBodyParams).
// Without validation, anyone who guesses our webhook URL can POST fake CallStatus
// updates, e.g. mark a still-ringing call as "completed" or burn outbound minutes
// against another org. We validate on every Twilio HTTP entrypoint.
function makeTwilioAuthenticator(app: FastifyInstance) {
  return async function authenticateTwilio(req: FastifyRequest, reply: FastifyReply) {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      // Fail-closed in prod: no token means we can't verify — reject.
      if (process.env.NODE_ENV === 'production') {
        app.log.error({ route: req.url }, 'TWILIO_AUTH_TOKEN missing — rejecting webhook');
        return reply.code(500).send('server misconfigured');
      }
      app.log.warn({ route: req.url }, 'TWILIO_AUTH_TOKEN missing — skipping signature check (dev only)');
      return;
    }

    const signature = req.headers['x-twilio-signature'];
    if (typeof signature !== 'string') {
      app.log.warn({ route: req.url, ip: req.ip }, 'Twilio webhook without signature header');
      return reply.code(403).send('missing signature');
    }

    // Reconstruct the public URL Twilio hit. Behind a reverse proxy (Caddy),
    // req.protocol is 'http' and req.hostname drops the port — use X-Forwarded-*
    // or fall back to WEBHOOK_BASE_URL which is the canonical public base.
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? req.hostname;
    const base = process.env.WEBHOOK_BASE_URL ?? `${proto}://${host}`;
    const fullUrl = new URL(req.url, base).toString();

    const params = (req.body ?? {}) as Record<string, string>;
    const valid = twilio.validateRequest(authToken, signature, fullUrl, params);

    if (!valid) {
      app.log.warn({ route: req.url, ip: req.ip }, 'Twilio signature validation failed');
      return reply.code(403).send('invalid signature');
    }
  };
}

// OpenAI Realtime model chain with fallback.
//
// Preview-dated models get sunsetted (typically 6-12 months after release).
// When the primary 404s, we fall back through a chain of known-working models
// so a single OpenAI deprecation doesn't brick every inbound/outbound call.
//
// Chain order:
//   1. OPENAI_REALTIME_MODEL env — operator-pinned (e.g. a specific dated version)
//   2. 'gpt-4o-realtime-preview'   — auto-updating alias (always latest stable)
//   3. 'gpt-4o-mini-realtime-preview' — cheaper / lighter, last-resort
//
// Dedupe keeps the chain tidy if operator pins the auto-alias directly.
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? 'gpt-4o-realtime-preview-2024-12-17';
const OPENAI_REALTIME_FALLBACK_CHAIN: readonly string[] = Array.from(
  new Set([
    OPENAI_REALTIME_MODEL,
    'gpt-4o-realtime-preview',
    'gpt-4o-mini-realtime-preview',
  ]),
);

/**
 * Open an OpenAI Realtime WebSocket, trying each model in the fallback chain
 * until one connects successfully or all are exhausted.
 *
 * Returns the live WS + the model it connected with, or null if every model
 * failed (then the caller should close the Twilio side too — call is dead).
 *
 * Probe-only handlers are registered during the attempt and removed before
 * return, so the caller can attach its own open/message/close/error handlers
 * without interference.
 */
async function openRealtimeWithFallback(
  apiKey: string,
  log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
  sessionId: string,
): Promise<{ ws: WS; model: string } | null> {
  for (const model of OPENAI_REALTIME_FALLBACK_CHAIN) {
    const ws = new WS(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, 'OpenAI-Beta': 'realtime=v1' } },
    );
    // `settled` guards against the rare case where two probe events fire
    // near-simultaneously (e.g. 'open' followed by 'error' during a flaky
    // handshake). Only the first outcome wins; subsequent emissions are
    // dropped so we don't resolve the Promise twice (no-op in strict mode
    // but still worth being explicit).
    let settled = false;
    const outcome = await new Promise<'open' | 'unavailable' | 'error'>((resolve) => {
      const finish = (result: 'open' | 'unavailable' | 'error') => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const onOpen = () => finish('open');
      const onUnexpected = (_req: unknown, res: { statusCode?: number }) => {
        log.warn({ sessionId, model, statusCode: res.statusCode }, 'OpenAI Realtime model unavailable');
        finish('unavailable');
      };
      const onError = (err: Error) => {
        log.warn({ sessionId, model, err: err.message }, 'OpenAI Realtime connection error');
        finish('error');
      };
      const cleanup = () => {
        ws.off('open', onOpen);
        ws.off('unexpected-response', onUnexpected);
        ws.off('error', onError);
      };
      ws.once('open', onOpen);
      ws.once('unexpected-response', onUnexpected);
      ws.once('error', onError);
    });

    if (outcome === 'open') {
      log.info({ sessionId, model }, 'OpenAI Realtime connected');
      return { ws, model };
    }
    // Failed: close the half-open WS explicitly so we don't leak a dangling
    // socket if the library didn't tear it down on unexpected-response.
    try { ws.terminate(); } catch { /* already closed */ }
  }
  return null;
}

// ── Sales prompt for website callback ─────────────────────────────────────────

const CALLBACK_PROMPT = `Du bist Chipy, der freundliche KI-Assistent von Phonbot. Du rufst gerade jemanden an, der sich auf der Phonbot-Website einen kostenlosen Demo-Anruf gewünscht hat.

DEIN ZIEL: Zeige live wie ein KI-Telefonagent klingt und funktioniert. Sei warm, direkt und authentisch — nicht aufdringlich.

GESPRÄCHSABLAUF:
1. Begrüße den Anrufer: "Hallo! Hier ist Chipy von Phonbot — du hattest gerade auf unserer Website einen Rückruf angefordert. Ich bin ein KI-Telefonassistent; dieser Demo-Anruf wird zur Qualitätssicherung aufgezeichnet. Ich zeige dir gerade live was ich kann. Cool oder?"
2. Frage kurz: "Was für ein Business hast du? Ich bin neugierig!"
3. Basierend auf der Antwort erkläre konkret wie Phonbot helfen kann. Beispiele:
   - Friseur: "Ich würde einfach deine Terminanfragen annehmen während du schneidest."
   - Handwerker: "Du bist auf der Baustelle — ich nehme den Anruf an und erstelle ein sauberes Ticket für dich."
   - Kosmetikstudio: "Ich nehme Terminanfragen an, während du in der Behandlung bist, und trage sie sauber in deinen Kalender ein."
4. "Wie viele Anrufe verpasst du ungefähr pro Tag?"
5. Wenn sie antworten: "Das sind im Monat ca. X verpasste Chancen. Phonbot geht bei jedem einzelnen ran — kostenlos mit 30 Testminuten ausprobierbar."
6. Abschluss: "Registriere dich einfach auf phonbot.de — kostenlos, keine Kreditkarte. Soll ich dir noch etwas erklären?"

REGELN:
- Wenn der Anrufer der Aufzeichnung widerspricht, entschuldige dich kurz und beende den Demo-Anruf freundlich.
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
  orgId?: string;
  usageReservationId?: string;
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
  orgId: string;
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
  if (!pool) return { ok: false, sessionId, error: 'DB_NOT_CONFIGURED' };
  if (!params.orgId || !params.twilioSid || !params.twilioToken || !params.toNumber || !params.fromNumber) {
    return { ok: false, sessionId, error: 'INVALID_CALL_CONFIGURATION' };
  }
  // Validate URL and durable ownership before holding quota or contacting Twilio.
  const callbackUrl = new URL(`/outbound/status/${sessionId}`, params.webhookBase);
  const twimlUrl = new URL(`/outbound/twiml/${sessionId}`, params.webhookBase).toString();
  let recordId = params.outboundRecordId;
  if (recordId) {
    const owned = await pool.query(`SELECT id FROM outbound_calls WHERE id = $1 AND org_id = $2`, [recordId, params.orgId]);
    if (!owned.rows[0]) return { ok: false, sessionId, error: 'NOT_YOUR_OUTBOUND_CALL' };
  } else {
    const record = await pool.query(
      `INSERT INTO outbound_calls (org_id, to_number, contact_name, campaign, status)
       VALUES ($1, $2, $3, 'customer-callback', 'initiated') RETURNING id`,
      [params.orgId, params.toNumber, params.name ?? null],
    );
    recordId = record.rows[0]?.id as string | undefined;
    if (!recordId) return { ok: false, sessionId, error: 'DB_ERROR' };
  }
  const markLocalFailure = () => pool!.query(
    `UPDATE outbound_calls SET status = 'failed' WHERE id = $1 AND org_id = $2 AND call_id IS NULL AND status = 'initiated'`,
    [recordId, params.orgId],
  );
  const reserve = await tryReserveMinutes(params.orgId).catch(async (err: unknown) => {
    // The provider has not been contacted, even if the ledger rejected activation
    // or its reservation outcome is uncertain. Preserve any hold for reconciliation.
    await markLocalFailure();
    throw err;
  });
  if (!reserve.allowed || !reserve.reservationId) {
    await markLocalFailure();
    return { ok: false, sessionId, error: 'USAGE_LIMIT_REACHED' };
  }
  const reservationId = reserve.reservationId;
  let requestStarted = false;
  try {
    await createSession(sessionId, { phone: params.toNumber, name: params.name, prompt: params.prompt,
      createdAt: Date.now(), outboundRecordId: recordId, orgId: params.orgId, usageReservationId: reservationId });
    callbackUrl.searchParams.set('outbound_record_id', recordId);
    callbackUrl.searchParams.set('usage_reservation_id', reservationId);
    const urlParams = new URLSearchParams({ To: params.toNumber, From: params.fromNumber, Url: twimlUrl,
      Method: 'POST', StatusCallback: callbackUrl.toString(), StatusCallbackEvent: 'completed' });
    requestStarted = true;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${params.twilioSid}/Calls.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${params.twilioSid}:${params.twilioToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded' },
      body: urlParams, signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if ([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(res.status)) {
        await releaseMinutesReservation(params.orgId, reservationId);
        await markLocalFailure();
        // Session cleanup cannot keep a definitively rejected call pending.
        await deleteSession(sessionId).catch(() => {});
        return { ok: false, sessionId, error: 'CALL_REJECTED' };
      }
      // A timeout, conflict or server failure can occur after a call was created.
      // Hold quota until a signed callback or explicit operator reconciliation.
      return { ok: false, sessionId, error: 'CALL_CREATION_UNCONFIRMED' };
    }
    const data = await res.json() as { sid?: string };
    if (typeof data.sid !== 'string' || !/^CA[0-9a-f]{32}$/i.test(data.sid)) throw new Error('CALL_CREATION_UNCONFIRMED');
    await bindMinutesReservation(params.orgId, reservationId, data.sid);
    await pool.query(
      `UPDATE outbound_calls SET call_id = COALESCE(call_id, $1),
         status = CASE WHEN status = 'initiated' THEN 'calling' ELSE status END
       WHERE id = $2 AND org_id = $3 AND (call_id IS NULL OR call_id = $1)`,
      [data.sid, recordId, params.orgId],
    );
    return { ok: true, sessionId, twilioCallSid: data.sid };
  } catch (err) {
    if (!requestStarted) {
      await releaseMinutesReservation(params.orgId, reservationId);
      await markLocalFailure();
    }
    // Do not release an ambiguous creation or a call that failed only during binding.
    throw err;
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export async function registerTwilioBridge(app: FastifyInstance) {
  const verifyTwilio = makeTwilioAuthenticator(app);

  // POST /outbound/twiml/:sessionId
  // Twilio fetches this when the user picks up the outbound call.
  // Returns TwiML that connects Twilio's audio stream to our WebSocket bridge.
  app.post('/outbound/twiml/:sessionId', { preHandler: verifyTwilio }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const webhookBase = process.env.WEBHOOK_BASE_URL ?? (
      process.env.NODE_ENV === 'production'
        ? (() => { throw new Error('WEBHOOK_BASE_URL is required in production'); })()
        : 'http://localhost:3001'
    );
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
  app.post('/outbound/status/:sessionId', { preHandler: verifyTwilio }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = (req.body ?? {}) as Record<string, string>;
    const callStatus = body.CallStatus ?? 'unknown';
    // Twilio statuses: queued, ringing, in-progress, completed, busy, failed, no-answer, canceled
    const terminal = ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus);

    // Ignore late nonterminal statuses; they must not overwrite a settled call.
    if (!terminal) return reply.code(200).send('');
    if (!process.env.TWILIO_AUTH_TOKEN || !pool) return reply.code(503).send('billing unavailable');
    const query = req.query as Record<string, unknown>;
    const recordId = query.outbound_record_id;
    const reservationId = query.usage_reservation_id;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof recordId !== 'string' || !uuid.test(recordId) || typeof reservationId !== 'string' || !uuid.test(reservationId)) {
      // Old bridge callbacks lack durable billing correlation. Do not guess from
      // an expiring Redis session or silently debit an unrelated organization.
      return reply.code(400).send('missing billing correlation');
    }
    const callId = body.CallSid;
    if (typeof callId !== 'string' || !/^CA[0-9a-f]{32}$/i.test(callId) ||
        typeof body.CallDuration !== 'string' || !/^\d+$/.test(body.CallDuration)) {
      return reply.code(400).send('missing call identity or duration');
    }
    const seconds = Number(body.CallDuration);
    if (!Number.isSafeInteger(seconds) || seconds < 0) return reply.code(400).send('invalid duration');
    const record = await pool.query(`SELECT org_id, call_id FROM outbound_calls WHERE id = $1`, [recordId]);
    const row = record.rows[0] as { org_id?: string; call_id?: string | null } | undefined;
    if (!row?.org_id) return reply.code(404).send('unknown outbound call');
    if (row.call_id && row.call_id !== callId) return reply.code(409).send('call identity mismatch');
    // Ledger validates reservation→org/call ownership and atomically settles once.
    // It also handles a callback arriving before the create response was bound.
    // The record may predate ledger activation; the verified reservation's own
    // creation time is the billing proof, not the earlier outbound draft record.
    await reconcileMinutes(row.org_id, Math.round(seconds / 60 * 100) / 100, { callId, reservationId });
    const mappedStatus = callStatus === 'no-answer' ? 'no_answer' : callStatus;
    await pool.query(
      `UPDATE outbound_calls SET call_id = COALESCE(call_id, $1), duration_s = $2, status = $3
       WHERE id = $4 AND org_id = $5 AND (call_id IS NULL OR call_id = $1)
         AND status NOT IN ('completed', 'busy', 'no_answer', 'canceled', 'failed')`,
      [callId, seconds, mappedStatus, recordId, row.org_id],
    );
    await deleteSession(sessionId).catch(() => {});
    return reply.code(200).send('');
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

    app.log.info({ sessionId, caller: session?.name, primaryModel: OPENAI_REALTIME_MODEL }, 'Twilio audio stream connected — opening OpenAI bridge');

    // Try each model in the fallback chain until one connects. If all fail,
    // the call is dead — close Twilio side and bail.
    const connected = await openRealtimeWithFallback(openaiKey, app.log, sessionId);
    if (!connected) {
      app.log.error({ sessionId, chain: OPENAI_REALTIME_FALLBACK_CHAIN }, 'OpenAI Realtime: every model in fallback chain failed');
      socket.close();
      return;
    }
    const openai = connected.ws;
    const activeModel = connected.model;

    let streamSid: string | null = null;
    const transcriptParts: string[] = [];
    let openaiReady = false;
    const pendingAudio: string[] = []; // buffer until session.update is ACKed

    // ── OpenAI → Twilio ───────────────────────────────────────────────────────

    // The probe in openRealtimeWithFallback already saw 'open' — the socket is
    // live. Run the configure/flush/greet sequence immediately.
    {
      openaiReady = true;
      app.log.info({ sessionId, model: activeModel }, 'OpenAI Realtime session ready');

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
    }

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
              `UPDATE outbound_calls SET transcript = $1 WHERE id = $2`,
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
