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

  it('keeps short-term memory across repair turns without calling the model', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({
      complete: async () => {
        modelCalls += 1;
        return 'Wie bitte? Ich habe dich gerade schlecht verstanden.';
      },
    });
    const ws = await connect(url);

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 'response-1',
      transcript: [{ role: 'user', content: '(inaudible speech)' }],
    }));
    const first = await receive(ws);

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 'response-2',
      transcript: [{ role: 'user', content: '(inaudible speech)' }],
    }));
    const second = await receive(ws);

    expect(modelCalls).toBe(0);
    expect(first).toMatchObject({
      response_type: 'response',
      response_id: 'response-1',
      end_call: false,
    });
    expect(JSON.stringify(first)).toContain('Wie bitte?');
    expect(second).toMatchObject({
      response_type: 'response',
      response_id: 'response-2',
      end_call: false,
    });
    expect(JSON.stringify(second)).toContain('Ich habe es akustisch nicht verstanden.');

    ws.close();
    await app.close();
  });

  it('streams sentence chunks before the final frame so TTS can start early', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    const fullText = 'Die Synthesis Color Cream kostet 9,99 Euro. Soll ich dir den Produktlink per SMS schicken?';
    const { app, url } = await testServer({
      complete: async () => fullText,
      completeStream: async ({ onDelta }) => {
        onDelta('Die Synthesis Color Cream kostet 9,99 Euro. ');
        onDelta('Soll ich dir den Produktlink per SMS schicken?');
        return 'Die Synthesis Color Cream kostet 9,99 Euro. Soll ich dir den Produktlink per SMS schicken?';
      },
    });
    const ws = await connect(url);
    const frames: Array<{ content: string; content_complete: boolean; response_id: unknown }> = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 7,
      transcript: [{ role: 'user', content: 'Was kostet die Synthesis Color Cream?' }],
    }));
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames.slice(0, -1).every((frame) => frame.content_complete === false)).toBe(true);
    expect(frames[frames.length - 1]?.content_complete).toBe(true);
    expect(frames.every((frame) => frame.response_id === 7)).toBe(true);
    expect(frames.map((frame) => frame.content).join('')).toBe(
      'Die Synthesis Color Cream kostet 9,99 Euro. Soll ich dir den Produktlink per SMS schicken?',
    );

    ws.close();
    await app.close();
  });

  it('suppresses a stale reply when a newer user turn arrives during a slow model call', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({
      complete: async ({ user }) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          // First turn is slow; the caller barges in before it resolves.
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return `Antwort auf: ${user}`;
      },
    });
    const ws = await connect(url);
    const received: unknown[] = [];
    ws.on('message', (data) => received.push(JSON.parse(data.toString())));

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 1,
      transcript: [{ role: 'user', content: 'Was kostet die alte Frage?' }],
    }));
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 2,
      transcript: [{ role: 'user', content: 'Stopp, ich meine den Kamm.' }],
    }));

    await new Promise((resolve) => setTimeout(resolve, 600));

    // The stale reply for response 1 is dropped; only the newest turn speaks.
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ response_type: 'response', response_id: 2 });

    ws.close();
    await app.close();
  });

  it('does not leak short-term memory across separate Retell websocket sessions', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({
      complete: async () => {
        modelCalls += 1;
        return 'Wie bitte? Ich habe dich gerade schlecht verstanden.';
      },
    });

    const first = await connect(url);
    first.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 'response-1',
      transcript: [{ role: 'user', content: '(inaudible speech)' }],
    }));
    const firstResponse = await receive(first);
    first.close();

    const second = await connect(url);
    second.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 'response-2',
      transcript: [{ role: 'user', content: '(inaudible speech)' }],
    }));
    const secondResponse = await receive(second);

    expect(modelCalls).toBe(0);
    expect(JSON.stringify(firstResponse)).toContain('Wie bitte?');
    expect(JSON.stringify(secondResponse)).toContain('Wie bitte?');
    expect(JSON.stringify(secondResponse)).not.toContain('Sag bitte nur ein Stichwort');

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
