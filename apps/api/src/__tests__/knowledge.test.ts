import { describe, it, expect } from 'vitest';
import { prepareKnowledgePayload } from '../knowledge.js';

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

  it('keeps PDFs blocked until real file upload exists', async () => {
    const payload = await prepareKnowledgePayload({
      knowledgeSources: [
        { id: 'pdf_1', type: 'pdf', name: 'faq.pdf', content: 'faq.pdf' },
      ],
    });

    expect(payload.texts).toEqual([]);
    expect(payload.urls).toEqual([]);
    expect(payload.sources[0]?.status).toBe('error');
    expect(payload.sources[0]?.error).toBe('PDF_UPLOAD_NOT_IMPLEMENTED');
  });
});
