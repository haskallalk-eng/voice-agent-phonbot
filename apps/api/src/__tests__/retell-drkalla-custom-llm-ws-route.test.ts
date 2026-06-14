import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { registerRetellDrkallaCustomLlmWs } from '../retell-drkalla-custom-llm-ws.js';
import type { DrkallaCustomLlmClient } from '../drkalla-custom-llm-responder.js';
import { buildDrkallaProductNameDetector } from '../drkalla-product-name-detector.js';

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

    // Open-ended question that reaches the model (not a contact/product/
    // ambiguous deterministic path) so the streaming frames are exercised.
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 7,
      transcript: [{ role: 'user', content: 'Was empfehlen Sie mir denn?' }],
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

  it('answers silence reminders and escalates, then resets after the caller speaks', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({
      complete: async () => {
        modelCalls += 1;
        return 'Gern, womit kann ich helfen?';
      },
    });
    const ws = await connect(url);

    ws.send(JSON.stringify({ interaction_type: 'reminder_required', response_id: 1 }));
    const first = await receive(ws) as { content: string; end_call: boolean };
    ws.send(JSON.stringify({ interaction_type: 'reminder_required', response_id: 2 }));
    const second = await receive(ws) as { content: string };

    // First nudge re-engages; second escalates to the softer closing line.
    expect(first.content).toContain('noch in der Leitung');
    expect(first.end_call).toBe(false);
    expect(second.content).toContain('Melden Sie sich gern');

    // Caller speaks → real answer, model used, silence counter resets.
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 3,
      transcript: [{ role: 'user', content: 'Ich bin wieder da.' }],
    }));
    const third = await receive(ws) as { content: string };
    expect(third.content).toContain('helfen');

    // A later reminder starts again at the first (re-engagement) nudge.
    ws.send(JSON.stringify({ interaction_type: 'reminder_required', response_id: 4 }));
    const fourth = await receive(ws) as { content: string };
    expect(fourth.content).toContain('noch in der Leitung');

    expect(modelCalls).toBe(1); // only the real user turn called the model

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

  it('aborts the in-flight model call when a newer caller turn arrives (barge-in)', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let aborted = false;
    let modelCalls = 0;
    const { app, url } = await testServer({
      complete: async ({ user, signal }) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          // The first (superseded) turn waits on the barge-in signal rather
          // than a fixed timer, so the test proves the cancel actually
          // propagates into the model call. The safety valve only fires if the
          // abort never arrives (a regression) — then `aborted` stays false.
          await new Promise<void>((resolve) => {
            if (signal?.aborted) {
              aborted = true;
              resolve();
              return;
            }
            signal?.addEventListener('abort', () => {
              aborted = true;
              resolve();
            }, { once: true });
            setTimeout(resolve, 2000);
          });
          return '';
        }
        return `Antwort auf: ${user}`;
      },
    });
    const ws = await connect(url);
    const received: Array<{ response_type: string; response_id: unknown }> = [];
    ws.on('message', (data) => received.push(JSON.parse(data.toString())));

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 1,
      transcript: [{ role: 'user', content: 'Was kostet die erste Frage?' }],
    }));
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 2,
      transcript: [{ role: 'user', content: 'Stopp, neue Frage bitte.' }],
    }));

    await new Promise((resolve) => setTimeout(resolve, 300));

    // The stale model call is cancelled, the serialized chain advances, and
    // only the newest turn speaks — without waiting out the 2s safety valve.
    expect(aborted).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ response_type: 'response', response_id: 2 });
    expect(modelCalls).toBe(2);

    ws.close();
    await app.close();
  });

  it('does not commit a superseded turn\'s agent memory (barge-in)', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    const detectProducts = buildDrkallaProductNameDetector([
      {
        productId: 'scc',
        spokenName: 'Synthesis Color Cream',
        productKind: 'Haarfarbe/Farbcreme',
        url: 'https://drkalla.com/products/synthesis-color-cream',
        aliases: ['Synthesis Color Cream'],
      },
    ]);
    let modelCalls = 0;
    const client: DrkallaCustomLlmClient = {
      complete: async ({ user, signal }) => {
        modelCalls += 1;
        if (/synthesis|kostet/i.test(user)) {
          // Turn 1 is a price question whose interrupted fallback would, if
          // committed, leave a "Profi disclosure given + SMS offer pending"
          // state in memory.
          await new Promise<void>((resolve) => {
            if (signal?.aborted) return resolve();
            signal?.addEventListener('abort', () => resolve(), { once: true });
            setTimeout(resolve, 2000);
          });
          return '';
        }
        return 'Gern, womit kann ich Ihnen helfen?';
      },
    };
    const app = Fastify({ logger: false });
    await app.register(websocket);
    await registerRetellDrkallaCustomLlmWs(app, { client, detectProducts });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected local TCP address');
    const url = `ws://127.0.0.1:${address.port}/retell/custom-llm/drkalla/auth/${TEST_SECRET}/call-mem-smoke`;
    const ws = await connect(url);
    const received: Array<{ content: string; response_id: unknown }> = [];
    ws.on('message', (data) => received.push(JSON.parse(data.toString())));

    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 1,
      transcript: [{ role: 'user', content: 'Was kostet die Synthesis Color Cream?' }],
    }));
    ws.send(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 2,
      transcript: [{ role: 'user', content: 'ja' }],
    }));

    await new Promise((resolve) => setTimeout(resolve, 300));

    // The interrupted turn never spoke, so its agent memory is not committed:
    // the following "ja" is NOT treated as a confirmed SMS offer and reaches
    // the model instead of the deterministic link-confirm path.
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ response_id: 2 });
    expect(received[0]?.content).toBe('Gern, womit kann ich Ihnen helfen?');
    expect(modelCalls).toBe(2);

    ws.close();
    await app.close();
  });

  it('suppresses streamed frames mid-stream once a newer caller turn arrives', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let releaseTurn1: () => void = () => {};
    const turn1Gate = new Promise<void>((resolve) => { releaseTurn1 = resolve; });
    let markFirstTurn1Frame: () => void = () => {};
    const sawFirstTurn1Frame = new Promise<void>((resolve) => { markFirstTurn1Frame = resolve; });
    const { app, url } = await testServer({
      complete: async () => 'unused',
      completeStream: async ({ onDelta }) => {
        onDelta('Erster Teil der Antwort. '); // sent while turn 1 is still newest
        await turn1Gate;                        // hold the stream open mid-turn
        onDelta('Zweiter Teil der Antwort.');   // must be suppressed (turn 2 arrived)
        return 'Erster Teil der Antwort. Zweiter Teil der Antwort.';
      },
    });
    const ws = await connect(url);
    const frames: Array<{ response_id: unknown; content: string; content_complete: boolean }> = [];
    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      frames.push(frame);
      if (frame.response_id === 1 && frame.content_complete === false) markFirstTurn1Frame();
    });

    // Open-ended question reaches the model (streaming path).
    ws.send(JSON.stringify({
      interaction_type: 'response_required', response_id: 1,
      transcript: [{ role: 'user', content: 'Was empfehlen Sie mir denn?' }],
    }));
    await sawFirstTurn1Frame;          // turn 1 has streamed its first frame
    ws.send(JSON.stringify({           // barge-in before turn 1 finishes streaming
      interaction_type: 'response_required', response_id: 2,
      transcript: [{ role: 'user', content: 'Stopp, neue Frage bitte.' }],
    }));
    // Let the server read turn 2 and bump latestArrival before turn 1 resumes,
    // so turn 1's second frame is genuinely stale when it is emitted.
    await new Promise((resolve) => setTimeout(resolve, 80));
    releaseTurn1();                    // let turn 1 try to stream its second frame
    await new Promise((resolve) => setTimeout(resolve, 400));

    const t1 = frames.filter((f) => f.response_id === 1);
    const t2 = frames.filter((f) => f.response_id === 2);
    // Turn 1 only ever emitted its single pre-barge-in frame; nothing after,
    // and it never completes (final frame suppressed).
    expect(t1).toHaveLength(1);
    expect(t1.every((f) => f.content_complete === false)).toBe(true);
    // Turn 2 speaks: intermediate frames false, exactly one final true.
    expect(t2.length).toBeGreaterThanOrEqual(1);
    expect(t2[t2.length - 1]?.content_complete).toBe(true);
    expect(t2.slice(0, -1).every((f) => f.content_complete === false)).toBe(true);
    // No cross-turn response_id leakage.
    expect(frames.every((f) => f.response_id === 1 || f.response_id === 2)).toBe(true);

    ws.close();
    await app.close();
  });

  it('falls back to one full final frame when streamed text is not a prefix of the final answer', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    // The model streamed a partial chunk, but the resolved final text does not
    // start with it (e.g. a trim/rewrite). The transport must not stitch a
    // broken prefix — it sends the full correct answer as a single final frame.
    const { app, url } = await testServer({
      complete: async () => 'unused',
      completeStream: async ({ onDelta }) => {
        onDelta('Vorlaeufige Teilantwort. ');
        return 'Ganz andere finale Antwort ohne gemeinsamen Anfang.';
      },
    });
    const ws = await connect(url);
    const frames: Array<{ response_id: unknown; content: string; content_complete: boolean }> = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));

    ws.send(JSON.stringify({
      interaction_type: 'response_required', response_id: 5,
      transcript: [{ role: 'user', content: 'Was empfehlen Sie mir denn?' }],
    }));
    await new Promise((resolve) => setTimeout(resolve, 400));

    const final = frames[frames.length - 1];
    expect(final?.content_complete).toBe(true);
    expect(final?.content).toBe('Ganz andere finale Antwort ohne gemeinsamen Anfang.');
    expect(frames.some((f) => f.content_complete === false && f.content === 'Vorlaeufige Teilantwort. ')).toBe(true);
    expect(frames.every((f) => f.response_id === 5)).toBe(true);

    ws.close();
    await app.close();
  });

  it('hard hangs up (end_call:true) on a clear caller farewell, never on silence', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({ complete: async () => { modelCalls += 1; return 'Gern, was suchen Sie?'; } });
    const ws = await connect(url);

    ws.send(JSON.stringify({
      interaction_type: 'response_required', response_id: 1,
      transcript: [{ role: 'user', content: 'Tschüss, das war alles.' }],
    }));
    const bye = await receive(ws) as { end_call: boolean; content: string; content_complete: boolean };
    expect(bye.end_call).toBe(true);                 // hangs up
    expect(bye.content_complete).toBe(true);
    expect(bye.content).toMatch(/Wiederh[oö]ren|Tsch(ü|ue)ss|Danke/i); // says goodbye first
    expect(modelCalls).toBe(0);                       // deterministic, no model

    // A following silence reminder must NOT hang up.
    ws.send(JSON.stringify({ interaction_type: 'reminder_required', response_id: 2 }));
    const rem = await receive(ws) as { end_call: boolean };
    expect(rem.end_call).toBe(false);

    ws.close();
    await app.close();
  });

  it('greets in Sie on call open (empty first turn) without calling the model', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({ complete: async () => { modelCalls += 1; return 'unused'; } });
    const ws = await connect(url);

    // Real Retell may already include the caller's first words in the opening
    // turn; the greeting must still fire on the first response turn.
    ws.send(JSON.stringify({ interaction_type: 'response_required', response_id: 0, transcript: [{ role: 'user', content: 'Hallo' }] }));
    const first = await receive(ws);

    expect(modelCalls).toBe(0);
    expect(first).toMatchObject({ response_type: 'response', response_id: 0, content_complete: true, end_call: false });
    expect(JSON.stringify(first)).toContain('Wie kann ich Ihnen');
    expect(JSON.stringify(first)).not.toMatch(/\b(?:du|dich|dir|dein)\b/i);

    // A following real turn is handled normally (not greeted again).
    ws.send(JSON.stringify({
      interaction_type: 'response_required', response_id: 1,
      transcript: [{ role: 'user', content: 'Wie sind Ihre Öffnungszeiten?' }],
    }));
    const second = await receive(ws) as { content: string };
    expect(second.content).not.toContain('Wie kann ich Ihnen bei Friseurbedarf helfen');

    ws.close();
    await app.close();
  });

  it('echoes ping_pong keepalive frames and never enters the turn chain', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({ complete: async () => { modelCalls += 1; return 'unused'; } });
    const ws = await connect(url);
    const frames: Array<{ response_type?: string; timestamp?: number }> = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));

    // Retell sends a ping_pong with a timestamp; the server must echo the same
    // timestamp back so the socket is not judged dead — and call no model.
    ws.send(JSON.stringify({ interaction_type: 'ping_pong', timestamp: 1716250276547 }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ response_type: 'ping_pong', timestamp: 1716250276547 });
    expect(modelCalls).toBe(0);

    ws.close();
    await app.close();
  });

  it('ignores call_details and update_only frames (no reply, greeting still fires on the first real turn)', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({ complete: async () => { modelCalls += 1; return 'unused'; } });
    const ws = await connect(url);
    const frames: Array<{ response_id?: unknown; content?: string; content_complete?: boolean }> = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));

    // Real connect order: call_details first, then an update_only transcript
    // refresh. Neither requests a reply, so neither may produce a frame nor
    // consume the one-shot greeting slot.
    ws.send(JSON.stringify({ interaction_type: 'call_details', call: { call_id: 'call-x', from_number: '+490000000000' } }));
    ws.send(JSON.stringify({ interaction_type: 'update_only', transcript: [{ role: 'user', content: 'ähm' }] }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frames).toHaveLength(0);
    expect(modelCalls).toBe(0);

    // The first genuine response turn still greets deterministically.
    ws.send(JSON.stringify({ interaction_type: 'response_required', response_id: 1, transcript: [{ role: 'user', content: 'Hallo' }] }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ response_id: 1, content_complete: true });
    expect(frames[0]?.content).toContain('Wie kann ich Ihnen');
    expect(modelCalls).toBe(0);

    ws.close();
    await app.close();
  });

  it('a ping_pong during a slow model turn does not abort or supersede it', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let aborted = false;
    const { app, url } = await testServer({
      complete: async ({ user, signal }) => {
        // Slow turn; a keepalive arrives mid-flight and must not cancel it.
        await new Promise<void>((resolve) => {
          if (signal?.aborted) { aborted = true; resolve(); return; }
          signal?.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true });
          setTimeout(resolve, 150);
        });
        return `Antwort auf: ${user}`;
      },
    });
    const ws = await connect(url);
    const frames: Array<{ response_type?: string; response_id?: unknown; content?: string; content_complete?: boolean; timestamp?: number }> = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));

    // Open-ended question reaches the model; a keepalive lands mid-stream.
    ws.send(JSON.stringify({ interaction_type: 'response_required', response_id: 1, transcript: [{ role: 'user', content: 'Was empfehlen Sie mir denn?' }] }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    ws.send(JSON.stringify({ interaction_type: 'ping_pong', timestamp: 999 }));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(aborted).toBe(false); // keepalive did not cancel the in-flight model call
    expect(frames.find((f) => f.response_type === 'ping_pong')).toEqual({ response_type: 'ping_pong', timestamp: 999 });
    const reply = frames.find((f) => f.response_type === 'response');
    expect(reply).toMatchObject({ response_id: 1, content_complete: true });
    expect(reply?.content).toContain('Antwort auf:');

    ws.close();
    await app.close();
  });

  it('replays a realistic interleaved real-Retell frame sequence end to end', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({ complete: async ({ user }) => { modelCalls += 1; return `Modellantwort: ${user}`; } });
    const ws = await connect(url);
    const frames: Array<{ response_type?: string; response_id?: unknown; content?: string; content_complete?: boolean; end_call?: boolean; timestamp?: number }> = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));
    const send = (m: Record<string, unknown>) => ws.send(JSON.stringify(m));
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Mirrors a real call: connect metadata, opener, a transcript refresh, a
    // keepalive, a silence nudge, then a clear farewell — all interleaved.
    send({ interaction_type: 'call_details', call: { call_id: 'real', from_number: '+490000000000' } });
    send({ interaction_type: 'response_required', response_id: 1, transcript: [{ role: 'user', content: 'Hallo' }] });
    await delay(200);
    send({ interaction_type: 'update_only', transcript: [{ role: 'user', content: 'ähm' }] });
    send({ interaction_type: 'ping_pong', timestamp: 7 });
    await delay(150);
    send({ interaction_type: 'reminder_required', response_id: 2 });
    await delay(200);
    send({ interaction_type: 'response_required', response_id: 3, transcript: [{ role: 'user', content: 'Tschüss, das war alles.' }] });
    await delay(300);

    // Keepalive echoed; greeting on the first real turn; reminder re-engages
    // without hanging up; the farewell hangs up. call_details and update_only
    // produce no response frames, and nothing reached the model.
    expect(frames.find((f) => f.response_type === 'ping_pong')).toEqual({ response_type: 'ping_pong', timestamp: 7 });
    expect(frames.find((f) => f.response_id === 1)?.content).toContain('Wie kann ich Ihnen');
    expect(frames.find((f) => f.response_id === 2)?.end_call).toBe(false);
    const bye = frames.find((f) => f.response_id === 3 && f.content_complete === true);
    expect(bye?.end_call).toBe(true);
    const responseIds = frames.filter((f) => f.response_type === 'response').map((f) => f.response_id);
    expect(new Set(responseIds)).toEqual(new Set([1, 2, 3]));
    expect(modelCalls).toBe(0);

    ws.close();
    await app.close();
  });

  it('holds (says nothing) on an incomplete utterance, then answers when the caller finishes', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({ complete: async ({ user }) => { modelCalls += 1; return `Antwort: ${user}`; } });
    const ws = await connect(url);
    const frames: Array<{ response_id?: unknown; content_complete?: boolean }> = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));
    const resp = (id: number, content: string) => ws.send(JSON.stringify({ interaction_type: 'response_required', response_id: id, transcript: [{ role: 'user', content }] }));
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    resp(1, 'Hallo');                 // opener greeting
    await delay(150);
    const afterGreet = frames.length;
    expect(afterGreet).toBe(1);

    resp(2, 'Ich möchte eine Haarfarbe und'); // dangling 'und' -> held, no frame, no model
    await delay(200);
    expect(frames.length).toBe(afterGreet);   // nothing said
    expect(modelCalls).toBe(0);

    resp(3, 'Ich möchte eine Haarfarbe kaufen.'); // completed -> answers
    await delay(300);
    expect(frames.some((f) => f.response_id === 3 && f.content_complete === true)).toBe(true);

    ws.close();
    await app.close();
  });

  it('answers anyway after two consecutive holds (never silent forever)', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    const { app, url } = await testServer({ complete: async () => 'Womit kann ich helfen?' });
    const ws = await connect(url);
    const frames: Array<{ response_id?: unknown; content_complete?: boolean }> = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));
    const resp = (id: number, content: string) => ws.send(JSON.stringify({ interaction_type: 'response_required', response_id: id, transcript: [{ role: 'user', content }] }));
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    resp(1, 'Hallo');
    await delay(150);
    const afterGreet = frames.length;

    resp(2, 'Ich suche etwas und'); // hold 1
    await delay(150);
    resp(3, 'am besten');          // hold 2
    await delay(150);
    expect(frames.length).toBe(afterGreet); // both held, silent

    resp(4, 'oder');               // would be hold 3 -> cap reached, answers anyway
    await delay(300);
    expect(frames.some((f) => f.response_id === 4 && f.content_complete === true)).toBe(true);

    ws.close();
    await app.close();
  });

  it('greets on a repeated-greeting opener and hangs up on "leg einfach auf" (real-call regressions)', async () => {
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_ENABLED = 'true';
    process.env.DRKALLA_CUSTOM_RUNTIME_CANARY_SECRET = TEST_SECRET;
    let modelCalls = 0;
    const { app, url } = await testServer({ complete: async () => { modelCalls += 1; return 'Gern, was suchen Sie?'; } });
    const ws = await connect(url);
    const frames: Array<{ response_id?: unknown; content?: string; content_complete?: boolean; end_call?: boolean }> = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));

    // A real call opened with "Hallo? Hallo." and the single-token regex missed
    // it, so the greeting never fired. It must greet now (no model).
    ws.send(JSON.stringify({ interaction_type: 'response_required', response_id: 1, transcript: [{ role: 'user', content: 'Hallo? Hallo.' }] }));
    await new Promise((r) => setTimeout(r, 150));
    expect(frames.find((f) => f.response_id === 1)?.content).toContain('Wie kann ich Ihnen');

    // The caller repeatedly said "leg einfach auf" / "leg bitte auf" and the old
    // literal "leg auf" missed it, so the agent never hung up. It must now.
    ws.send(JSON.stringify({ interaction_type: 'response_required', response_id: 2, transcript: [{ role: 'user', content: 'Nein, leg einfach auf.' }] }));
    await new Promise((r) => setTimeout(r, 200));
    const bye = frames.find((f) => f.response_id === 2 && f.content_complete === true);
    expect(bye?.end_call).toBe(true);
    expect(modelCalls).toBe(0); // both paths deterministic

    ws.close();
    await app.close();
  });
});
