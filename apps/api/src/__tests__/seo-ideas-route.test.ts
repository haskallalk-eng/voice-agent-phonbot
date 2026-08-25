import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const { mockQuery, mockCompletion } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCompletion: vi.fn(),
}));

vi.mock('../db.js', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock('../logger.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: (...args: unknown[]) => mockCompletion(...args) } },
  })),
}));

vi.stubEnv('OPENAI_API_KEY', 'test-key');
vi.stubEnv('NODE_ENV', 'test');

const { registerSeoIdeas } = await import('../seo-ideas.js');

async function buildApp(orgId = '00000000-0000-4000-8000-000000000001') {
  const app = Fastify();
  app.decorate('authenticate', async (req: any) => {
    req.user = { orgId, userId: 'user-1', role: 'owner' };
  });
  await registerSeoIdeas(app);
  await app.ready();
  return app;
}

const ideaRow = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'KI-Terminbuchung am Telefon',
  summary: 'Kaufnahe Feature-Seite',
  primary_keyword: 'KI Terminbuchung Telefon',
  target_path: '/ki-terminbuchung-telefon/',
  page_type: 'Feature-Seite',
  funnel: 'Kaufnah',
  audience: 'Terminbasierte Betriebe',
  reason: 'Direkte Suchabsicht',
  implementation: 'Feature-Seite erstellen',
  impact: 10,
  confidence: 7,
  effort: 4,
  risk: 2,
  priority_score: 118,
  gates: ['Canonical'],
  outline: [],
  source: 'automation',
  status: 'active',
  generated_by_llm: false,
  created_at: '2026-08-25T00:00:00.000Z',
  updated_at: '2026-08-25T00:00:00.000Z',
};

describe('SEO ideas routes', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockCompletion.mockReset();
  });

  it('seeds and lists only the authenticated organisation ideas', async () => {
    const orgId = '00000000-0000-4000-8000-000000000123';
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 12 })
      .mockResolvedValueOnce({ rows: [ideaRow], rowCount: 1 });
    const app = await buildApp(orgId);

    const response = await app.inject({ method: 'GET', url: '/insights/seo-ideas' });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).items).toEqual([ideaRow]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0]?.[1]?.[0]).toBe(orgId);
    expect(mockQuery.mock.calls[1]?.[1]).toEqual([orgId]);
    await app.close();
  });

  it('updates status with both idea id and org id in the write query', async () => {
    const orgId = '00000000-0000-4000-8000-000000000123';
    mockQuery.mockResolvedValueOnce({ rows: [{ ...ideaRow, status: 'hidden' }], rowCount: 1 });
    const app = await buildApp(orgId);

    const response = await app.inject({
      method: 'PATCH',
      url: `/insights/seo-ideas/${ideaRow.id}`,
      payload: { status: 'hidden' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).item.status).toBe('hidden');
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([ideaRow.id, orgId, 'hidden']);
    await app.close();
  });

  it('rejects malformed manual ideas before touching the database', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/insights/seo-ideas',
      payload: { title: 'x', notes: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    await app.close();
  });

  it('stores a validated LLM expansion with a server-calculated priority', async () => {
    mockCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        title: 'KI-Telefonassistent für Hausärzte',
        summary: 'Eine hilfreiche Seite für die telefonische Praxisorganisation.',
        primary_keyword: 'KI Telefonassistent Hausarzt',
        target_path: '/hausarzt/',
        page_type: 'Branchenseite',
        funnel: 'Kaufnah',
        audience: 'Hausarztpraxen',
        reason: 'Praxen erhalten viele wiederkehrende organisatorische Anfragen.',
        implementation: 'Nur Termin- und Rückrufprozesse zeigen, keine medizinische Beratung.',
        impact: 9,
        confidence: 6,
        effort: 5,
        risk: 6,
        gates: ['Human Review', 'keine medizinische Beratung'],
        outline: ['Problem', 'Einsatzbereiche', 'Grenzen', 'Demo'],
      }) } }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ ...ideaRow, source: 'manual', generated_by_llm: true }], rowCount: 1 });
    const app = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/insights/seo-ideas/expand',
      payload: { title: 'Hausarzt Idee', notes: 'Nur Organisation, keine Diagnose' },
    });

    expect(response.statusCode).toBe(201);
    expect(mockCompletion).toHaveBeenCalledTimes(1);
    const insertValues = mockQuery.mock.calls[0]?.[1] as unknown[];
    expect(insertValues[14]).toBe(81);
    await app.close();
  });
});
