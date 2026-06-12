import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { registerRetellDrkallaCustomLlmWs } from '../retell-drkalla-custom-llm-ws.js';
import type { DrkallaCustomLlmClient } from '../drkalla-custom-llm-responder.js';

const originalEnabled = process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED;
const originalSecret = process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET;
const TEST_SECRET = 'test-secret-123456';

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED;
  else process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = originalEnabled;
  if (originalSecret === undefined) delete process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET;
  else process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = originalSecret;
});

async function testServer(client: DrkallaCustomLlmClient = {
  complete: async () => 'Ich kann dir den Produktlink per SMS schicken. Soll ich das machen?',
}) {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await registerRetellDrkallaCustomLlmWs(app, { client });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local TCP address');
  return {
    app,
    url: `ws://127.0.0.1:${address.port}/retell/custom-llm/drkalla/auth/${TEST_SECRET}/call-local-smoke`,
  };
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function receive(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    ws.once('error', reject);
  });
}

describe('Retell DrKalla custom LLM websocket route smoke', () => {
  it('round-trips a response_required message through the local websocket route', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    const { app, url } = await testServer();
    const ws = await connect(url);

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 'response-1',
      transcript: [{ role: 'user', content: 'Kannst du mir den Link schicken?' }],
    }));

    await expect(receive(ws)).resolves.toEqual({
      response_type: 'response',
      response_id: 'response-1',
      content: 'Ich kann dir den Produktlink per SMS schicken. Soll ich das machen?',
      content_complete: true,
      end_call: false,
    });

    ws.close();
    await app.close();
  });

  it('closes unauthorized websocket connections before processing messages', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    const { app, url } = await testServer();
    const unauthorizedUrl = url.replace(`/auth/${TEST_SECRET}/`, '/auth/wrong-secret-123456/');
    const ws = await connect(unauthorizedUrl);

    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
    });
    expect(ws.readyState).toBe(WebSocket.CLOSED);

    await app.close();
  });

  it('keeps short-term memory across turns within the same Retell websocket session', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    const systemPrompts: string[] = [];
    const { app, url } = await testServer({
      complete: async (input) => {
        systemPrompts.push(input.system);
        return 'Wie bitte? Ich habe dich gerade schlecht verstanden.';
      },
    });
    const ws = await connect(url);

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 'response-1',
      transcript: [{ role: 'user', content: '(inaudible speech)' }],
    }));
    await receive(ws);

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 'response-2',
      transcript: [{ role: 'user', content: '(inaudible speech)' }],
    }));
    await receive(ws);

    expect(systemPrompts).toHaveLength(2);
    expect(systemPrompts[0]).toContain('inaudible_streak=1');
    expect(systemPrompts[1]).toContain('inaudible_streak=2');

    ws.close();
    await app.close();
  });

  it('does not leak short-term memory across separate Retell websocket sessions', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    const systemPrompts: string[] = [];
    const { app, url } = await testServer({
      complete: async (input) => {
        systemPrompts.push(input.system);
        return 'Wie bitte? Ich habe dich gerade schlecht verstanden.';
      },
    });

    const first = await connect(url);
    first.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 'response-1',
      transcript: [{ role: 'user', content: '(inaudible speech)' }],
    }));
    await receive(first);
    first.close();

    const second = await connect(url);
    second.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 'response-2',
      transcript: [{ role: 'user', content: '(inaudible speech)' }],
    }));
    await receive(second);

    expect(systemPrompts).toHaveLength(2);
    expect(systemPrompts[0]).toContain('inaudible_streak=1');
    expect(systemPrompts[1]).toContain('inaudible_streak=1');
    expect(systemPrompts[1]).not.toContain('inaudible_streak=2');

    second.close();
    await app.close();
  });

  it('fails closed when the configured websocket secret is too short', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = 'short';
    const { app, url } = await testServer();
    const ws = await connect(url.replace(TEST_SECRET, 'short'));

    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
    });
    expect(ws.readyState).toBe(WebSocket.CLOSED);

    await app.close();
  });
});
