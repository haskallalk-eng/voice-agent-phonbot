import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerRetellWebhooks } from '../retell-webhooks.js';

describe('Retell tool authentication', () => {
  it('rejects body-only agent_id on mutating tool endpoints', async () => {
    const app = Fastify({ logger: false });
    await registerRetellWebhooks(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/retell/tools/calendar.book',
      payload: {
        agent_id: 'agent_known_to_attacker',
        args: {
          customerName: 'Test Kunde',
          customerPhone: '+4915111111111',
          preferredTime: 'Mo 10:00',
          service: 'Test',
        },
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
    await app.close();
  });
});
