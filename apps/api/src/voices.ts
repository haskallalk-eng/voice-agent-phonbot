/**
 * Voice routes — list available voices and clone a voice via Retell AI.
 *
 * GET  /voices       — List all voices (built-in + cloned). Requires auth.
 * POST /voices/clone — Upload audio file and clone a voice via Retell. Requires auth.
 */

import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { listVoices, createVoice, type RetellVoice } from './retell.js';
import { VOICE_CATALOG, getDefaultVoiceForLanguage, getVoicesForLanguage, getVoiceSurcharge, isPremiumProvider, PREMIUM_VOICE_SURCHARGE_PER_MINUTE, getNativeStatus } from './voice-catalog.js';

/**
 * Annotate a Retell voice with the per-minute Phonbot surcharge. Cloned
 * voices always carry the premium price when the underlying provider is
 * ElevenLabs (the recommended clone provider). Built-in IDs fall through
 * to getVoiceSurcharge() which understands the catalog + provider prefix.
 */
function annotateSurcharge(v: RetellVoice): RetellVoice & { surchargePerMinute: number } {
  const id = v.voice_id;
  const provider = (v.provider ?? '').toLowerCase();
  // Cloned voice on a premium provider → fixed premium surcharge.
  if (v.voice_type === 'cloned' && isPremiumProvider(provider)) {
    return { ...v, surchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE };
  }
  return { ...v, surchargePerMinute: getVoiceSurcharge(id) };
}

// Max upload: 50 MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export async function registerVoices(app: FastifyInstance) {
  // Register multipart only once (idempotent check via hasPlugin)
  if (!app.hasPlugin('@fastify/multipart')) {
    await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } });
  }

  /* ── GET /voices ── all voices (unfiltered, for admin/power-users) */
  app.get(
    '/voices',
    { onRequest: [app.authenticate] },
    async (_req, reply) => {
      try {
        const voices = await listVoices();
        return reply.send({ voices: voices.map(annotateSurcharge) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to list voices';
        return reply.status(502).send({ error: msg });
      }
    },
  );

  /* ── GET /voices/recommended?language=de ── curated, language-optimized voices */
  app.get(
    '/voices/recommended',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const parsed = z.object({ language: z.string().min(2).max(5).default('de') }).safeParse(req.query);
      const language = parsed.success ? parsed.data.language : 'de';
      const voices = getVoicesForLanguage(language);
      const defaultVoiceId = getDefaultVoiceForLanguage(language);
      return reply.send({
        language,
        defaultVoiceId,
        nativeStatus: getNativeStatus(language),
        premiumSurchargePerMinute: PREMIUM_VOICE_SURCHARGE_PER_MINUTE,
        voices,
        allLanguages: Object.keys(VOICE_CATALOG),
      });
    },
  );

  // Voice-clone provider whitelist — keep in sync with Retell's supported set.
  // Provider influences Retell-billing cost: cartesia ($0.015/min) vs elevenlabs ($0.040/min).
  const ALLOWED_PROVIDERS = ['cartesia', 'elevenlabs', 'minimax', 'fish_audio', 'platform'] as const;
  type AllowedProvider = (typeof ALLOWED_PROVIDERS)[number];

  /* ── POST /voices/clone — rate-limited to prevent abuse (per-org Retell cost leak) ── */
  app.post(
    '/voices/clone',
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const data = await req.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      // Read name + provider from fields
      const fields = data.fields as Record<string, { value: string } | undefined>;
      const name = (fields['name']?.value ?? '').trim();
      const providerRaw = (fields['provider']?.value ?? 'cartesia').trim();

      if (!name) {
        return reply.status(400).send({ error: 'Voice name is required' });
      }

      // Sanitize name (avoid prompt-injection + header issues when Retell echoes it)
      if (!/^[\p{L}\p{N}\s_'-]{1,50}$/u.test(name)) {
        return reply.status(400).send({ error: 'Voice name: max 50 chars, letters/digits/space only' });
      }

      if (!ALLOWED_PROVIDERS.includes(providerRaw as AllowedProvider)) {
        return reply.status(400).send({ error: `Provider must be one of: ${ALLOWED_PROVIDERS.join(', ')}` });
      }
      const provider = providerRaw as AllowedProvider;

      // Accept mp3, wav, webm, ogg (frontend converts to wav, but be lenient here)
      const mime = data.mimetype;
      const mimeToFormat: Record<string, { ext: string; mime: string }> = {
        'audio/mpeg':  { ext: 'mp3',  mime: 'audio/mpeg' },
        'audio/mp3':   { ext: 'mp3',  mime: 'audio/mpeg' },
        'audio/wav':   { ext: 'wav',  mime: 'audio/wav' },
        'audio/wave':  { ext: 'wav',  mime: 'audio/wav' },
        'audio/x-wav': { ext: 'wav',  mime: 'audio/wav' },
        'audio/webm':  { ext: 'webm', mime: 'audio/webm' },
        'audio/ogg':   { ext: 'ogg',  mime: 'audio/ogg' },
      };
      const format = mimeToFormat[mime];
      if (!format) {
        return reply.status(400).send({ error: `Unsupported file type: ${mime}. Use mp3 or wav.` });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);

      if (audioBuffer.length === 0) {
        return reply.status(400).send({ error: 'Uploaded file is empty' });
      }

      let voice: RetellVoice;
      try {
        voice = await createVoice(name, audioBuffer, provider, format.mime, format.ext);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Voice cloning failed';
        return reply.status(502).send({ error: msg });
      }

      return reply.status(201).send(voice);
    },
  );
}
