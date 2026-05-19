import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ocrPdfWithOpenAI } from '../knowledge-ocr.js';

describe('knowledge OCR', () => {
  const oldEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...oldEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = oldEnv;
    global.fetch = originalFetch;
  });

  it('stays closed when OpenAI OCR is not configured', async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await ocrPdfWithOpenAI({
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 13,
      data: Buffer.from('%PDF-1.4\n'),
    });

    expect(result).toEqual({ error: 'OCR_NOT_CONFIGURED' });
  });

  it('sends PDF bytes to OpenAI Responses and extracts OCR text', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.KNOWLEDGE_OCR_MODEL = 'gpt-4o-mini';
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'Starter kostet 89 Euro.\nTermine Montag bis Freitag.' },
          ],
        },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await ocrPdfWithOpenAI({
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 13,
      data: Buffer.from('%PDF-1.4\n'),
    });

    expect(result).toEqual({
      text: 'Starter kostet 89 Euro.\nTermine Montag bis Freitag.',
      engine: 'openai:gpt-4o-mini',
    });
    expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-openai-key' }),
    }));
    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body));
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.input[1].content[0]).toMatchObject({
      type: 'input_file',
      filename: 'scan.pdf',
      file_data: Buffer.from('%PDF-1.4\n').toString('base64'),
    });
  });
});
