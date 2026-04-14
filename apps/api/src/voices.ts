/**
 * Voice routes — list available voices and clone a voice via Retell AI.
 *
 * GET  /voices       — List all voices (built-in + cloned). Requires auth.
 * POST /voices/clone — Upload audio file and clone a voice via Retell. Requires auth.
 */

import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { listVoices, createVoice, type RetellVoice } from './retell.js';

// Max upload: 50 MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export async function registerVoices(app: FastifyInstance) {
  // Register multipart only once (idempotent check via hasPlugin)
  if (!app.hasPlugin('@fastify/multipart')) {
    await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } });
  }

  /* ── GET /voices ── */
  app.get(
    '/voices',
    { onRequest: [app.authenticate] },
    async (_req, reply) => {
      try {
        const voices = await listVoices();
        return reply.send({ voices });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to list voices';
        return reply.status(502).send({ error: msg });
      }
    },
  );

  /* ── POST /voices/clone ── */
  app.post(
    '/voices/clone',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const data = await req.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      // Read name + provider from fields
      const fields = data.fields as Record<string, { value: string } | undefined>;
      const name = (fields['name']?.value ?? '').trim();
      const provider = (fields['provider']?.value ?? 'cartesia').trim();

      if (!name) {
        return reply.status(400).send({ error: 'Voice name is required' });
      }

      // Accept mp3, wav, webm, ogg (frontend converts to wav, but be lenient here)
      const mime = data.mimetype;
      const allowed = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/webm', 'audio/ogg'];
      if (!allowed.includes(mime)) {
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
        voice = await createVoice(name, audioBuffer, provider);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Voice cloning failed';
        return reply.status(502).send({ error: msg });
      }

      return reply.status(201).send(voice);
    },
  );
}
