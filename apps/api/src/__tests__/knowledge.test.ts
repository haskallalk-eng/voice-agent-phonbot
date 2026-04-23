import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { normalizeKnowledgeSources, prepareKnowledgePayload } from '../knowledge.js';

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
});
