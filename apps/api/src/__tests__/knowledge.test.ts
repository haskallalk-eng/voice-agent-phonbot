import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  buildCanonicalBusinessFacts,
  normalizeKnowledgeRetrievalSettings,
  normalizeKnowledgeSources,
  prepareKnowledgePayload,
  toRetellKbConfig,
} from '../knowledge.js';

describe('knowledge sources', () => {
  it('turns custom text into Retell knowledge_base_texts', async () => {
    const payload = await prepareKnowledgePayload({
      knowledgeSources: [
        { id: 'txt_1', type: 'text', name: 'Preise', content: 'Herrenschnitt kostet 28 Euro.' },
      ],
    });

    expect(payload.texts).toEqual([{ title: 'Preise', text: 'Herrenschnitt kostet 28 Euro.' }]);
    expect(payload.urls).toEqual([]);
    expect(payload.sources[0]?.status).toBe('indexed');
    expect(payload.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects private website URLs before sending them to Retell', async () => {
    const payload = await prepareKnowledgePayload({
      knowledgeSources: [
        { id: 'url_1', type: 'url', name: 'Localhost', content: 'http://localhost/admin' },
      ],
    });

    expect(payload.urls).toEqual([]);
    expect(payload.sources[0]?.status).toBe('error');
    expect(payload.sources[0]?.error).toBe('PRIVATE_HOST');
    expect(payload.signature).toBeNull();
  });

  it('keeps uploaded PDFs pending during save normalization', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% test\n');
    const sha256 = crypto.createHash('sha256').update(pdf).digest('hex');
    const normalized = await normalizeKnowledgeSources<Record<string, unknown>>({
      knowledgeSources: [
        {
          id: 'pdf_1',
          type: 'pdf',
          name: 'faq.pdf',
          content: 'faq.pdf',
          fileId: 'pdf_1',
          sha256,
          sizeBytes: pdf.length,
          mimeType: 'application/pdf',
        },
      ],
    });
    const sources = normalized.knowledgeSources as Array<{ status?: string; error?: string }>;

    expect(sources[0]?.status).toBe('pending');
    expect(sources[0]?.error).toBeUndefined();
  });

  it('loads uploaded PDFs for Retell knowledge_base_files during deploy', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% test\n');
    const sha256 = crypto.createHash('sha256').update(pdf).digest('hex');
    const payload = await prepareKnowledgePayload({
      knowledgeSources: [
        {
          id: 'pdf_1',
          type: 'pdf',
          name: 'faq.pdf',
          content: 'faq.pdf',
          fileId: 'pdf_1',
          sha256,
          sizeBytes: pdf.length,
          mimeType: 'application/pdf',
        },
      ],
    }, {
      requirePdfBytes: true,
      loadPdfFile: async () => ({
        filename: 'faq.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
        sha256,
        data: pdf,
      }),
    });

    expect(payload.texts).toEqual([]);
    expect(payload.urls).toEqual([]);
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]?.filename).toBe('faq.pdf');
    expect(payload.files[0]?.data).toEqual(pdf);
    expect(payload.sources[0]?.status).toBe('indexed');
    expect(payload.sources[0]?.error).toBeUndefined();
    expect(payload.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('marks PDFs as errored during deploy when the stored file is missing', async () => {
    const payload = await prepareKnowledgePayload({
      knowledgeSources: [
        { id: 'pdf_1', type: 'pdf', name: 'faq.pdf', content: 'faq.pdf', fileId: 'pdf_1', sha256: 'abc' },
      ],
    }, { requirePdfBytes: true });

    expect(payload.files).toEqual([]);
    expect(payload.sources[0]?.status).toBe('error');
    expect(payload.sources[0]?.error).toBe('PDF_UPLOAD_REQUIRES_DATABASE');
    expect(payload.signature).toBeNull();
  });

  it('normalizes RAG retrieval presets and clamps unsafe overrides', () => {
    expect(normalizeKnowledgeRetrievalSettings(undefined)).toEqual({
      mode: 'balanced',
      topK: 3,
      filterScore: 0.6,
    });
    expect(normalizeKnowledgeRetrievalSettings({ mode: 'strict' })).toEqual({
      mode: 'strict',
      topK: 2,
      filterScore: 0.72,
    });
    expect(normalizeKnowledgeRetrievalSettings({
      mode: 'broad',
      topK: 99,
      filterScore: 0.01,
    })).toEqual({
      mode: 'broad',
      topK: 8,
      filterScore: 0.2,
    });
  });

  it('returns Retell kb_config from normalized RAG settings', () => {
    expect(toRetellKbConfig({ mode: 'strict' })).toEqual({ top_k: 2, filter_score: 0.72 });
  });

  it('builds canonical business facts only from allowlisted config fields', () => {
    const source = buildCanonicalBusinessFacts({
      businessName: 'Friseur Kalla',
      businessDescription: 'Salon fuer Schnitte und Farbe.',
      address: 'Kalla Weg 1, Berlin',
      openingHours: 'Mo-Fr 09:00-18:00',
      services: [
        {
          id: 'svc_cut',
          name: 'Herrenschnitt',
          price: '28',
          duration: '30 min',
          description: 'inklusive Waschen',
        },
      ],
      customVocabulary: [{ term: 'Balayage', explanation: 'Freihand-Faerbetechnik' }],
      industry: 'hairdresser',
      customerModule: {
        enabled: true,
        questions: [{ id: 'allergies', label: 'Allergien', prompt: 'Nur bei Farbe fragen', enabled: true }],
      },
      customers: [{ full_name: 'Max Mustermann', email: 'max.kunde@example.com' }],
      tickets: [{ body: 'Kundengeheimnis' }],
      apiIntegrations: [{ authValue: 'sk_live_secret' }],
      calendarIntegrations: [{ email: 'owner@example.com' }],
    });

    expect(source?.id).toBe('db_canonical_business_facts');
    expect(source?.type).toBe('text');
    expect(source?.content).toContain('Betrieb: Friseur Kalla');
    expect(source?.content).toContain('Herrenschnitt');
    expect(source?.content).toContain('Balayage');
    expect(source?.content).toContain('Allergien');
    expect(source?.content).not.toContain('Max Mustermann');
    expect(source?.content).not.toContain('max.kunde@example.com');
    expect(source?.content).not.toContain('Kundengeheimnis');
    expect(source?.content).not.toContain('sk_live_secret');
    expect(source?.content).not.toContain('owner@example.com');
  });

  it('injects canonical business facts into the Retell payload without persisting them as user sources', async () => {
    const payload = await prepareKnowledgePayload({
      businessName: 'Studio Beispiel',
      openingHours: 'Mo-Fr 10:00-18:00',
      services: [{ id: 'svc_1', name: 'Beratung', duration: '20 min' }],
    });

    expect(payload.texts).toHaveLength(1);
    expect(payload.texts[0]?.title).toBe('Phonbot Business Fakten');
    expect(payload.texts[0]?.text).toContain('Studio Beispiel');
    expect(payload.texts[0]?.text).toContain('Beratung');
    expect(payload.sources).toEqual([]);
    expect(payload.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes the knowledge signature when canonical service facts change', async () => {
    const first = await prepareKnowledgePayload({
      businessName: 'Studio Beispiel',
      services: [{ id: 'svc_1', name: 'Beratung', duration: '20 min' }],
    });
    const second = await prepareKnowledgePayload({
      businessName: 'Studio Beispiel',
      services: [{ id: 'svc_1', name: 'Beratung Plus', duration: '45 min' }],
    });

    expect(first.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(second.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(first.signature).not.toBe(second.signature);
  });

  it('can add safe calendar staff and schedule facts without leaking staff-private fields', () => {
    const source = buildCanonicalBusinessFacts({
      businessName: 'Salon Kalender',
    }, {
      staff: [
        {
          id: 'staff-secret-id',
          name: 'Lena',
          role: 'Friseurin',
          services: ['Schnitt', 'Farbe'],
          email: 'lena.private@example.com',
        },
      ],
      openingHoursSchedule: {
        '0': { enabled: false, start: '09:00', end: '17:00' },
        '1': { enabled: true, start: '09:00', end: '18:00' },
        '2': { enabled: true, start: '09:00', end: '18:00' },
        '3': { enabled: true, start: '09:00', end: '18:00' },
        '4': { enabled: true, start: '09:00', end: '18:00' },
        '5': { enabled: true, start: '09:00', end: '18:00' },
        '6': { enabled: false, start: '09:00', end: '17:00' },
      },
    } as any);

    expect(source?.content).toContain('Mitarbeiter');
    expect(source?.content).toContain('Lena');
    expect(source?.content).toContain('Schnitt');
    expect(source?.content).toContain('Mo-Fr 09:00-18:00');
    expect(source?.content).not.toContain('staff-secret-id');
    expect(source?.content).not.toContain('lena.private@example.com');
    expect(source?.containsPii).toBe(true);
    expect(source?.risk).toBe('medium');
  });
});
