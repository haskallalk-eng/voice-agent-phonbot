import { describe, expect, it } from 'vitest';
import {
  buildRetellDrkallaCustomLlmWsReply,
  parseRetellDrkallaCustomLlmMessage,
} from '../retell-drkalla-custom-llm-ws.js';

describe('Retell DrKalla custom LLM websocket handler', () => {
  it('parses Retell response_required messages into safe canonical input', () => {
    const parsed = parseRetellDrkallaCustomLlmMessage(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 'response-1',
      transcript: [
        { role: 'user', content: 'Was ist der Unterschied?' },
      ],
    }));

    expect(parsed?.interactionType).toBe('response_required');
    expect(parsed?.responseId).toBe('response-1');
    expect(parsed?.providerResponseId).toBe('response-1');
    expect(parsed?.currentUserText).toBe('Was ist der Unterschied?');
  });

  it('accepts numeric Retell response IDs from live custom-LLM calls', async () => {
    const parsed = parseRetellDrkallaCustomLlmMessage(JSON.stringify({
      interaction_type: 'response_required',
      response_id: 1,
      transcript: [{ role: 'user', content: 'Hallo.' }],
    }));
    const reply = await buildRetellDrkallaCustomLlmWsReply({
      enabled: true,
      secretAccepted: true,
      rawMessage: JSON.stringify({
        interaction_type: 'response_required',
        response_id: 1,
        transcript: [{ role: 'user', content: 'Hallo.' }],
      }),
      complete: async () => 'Hallo, wie kann ich helfen?',
    });

    expect(parsed?.responseId).toBe('1');
    expect(parsed?.providerResponseId).toBe(1);
    expect(reply).toEqual({
      response_type: 'response',
      response_id: 1,
      content: 'Hallo, wie kann ich helfen?',
      content_complete: true,
      end_call: false,
    });
  });

  it('fails closed on invalid non-string non-numeric response IDs', () => {
    const parsed = parseRetellDrkallaCustomLlmMessage(JSON.stringify({
      interaction_type: 'response_required',
      response_id: { unsafe: true },
      transcript: [{ role: 'user', content: 'Hallo.' }],
    }));

    expect(parsed).toBeNull();
  });

  it('ignores update_only messages without returning model output', async () => {
    const reply = await buildRetellDrkallaCustomLlmWsReply({
      enabled: true,
      secretAccepted: true,
      rawMessage: JSON.stringify({
        interaction_type: 'update_only',
        response_id: 'response-1',
        transcript: [{ role: 'user', content: 'nur partial' }],
      }),
      complete: async () => 'should not be used',
    });

    expect(reply).toBeNull();
  });

  it('returns a Retell response message only when gate and secret pass', async () => {
    const reply = await buildRetellDrkallaCustomLlmWsReply({
      enabled: true,
      secretAccepted: true,
      rawMessage: JSON.stringify({
        interaction_type: 'response_required',
        response_id: 'response-1',
        transcript: [{ role: 'user', content: 'Wie kaufe ich das?' }],
      }),
      complete: async () => 'Ich kann dir den Produktlink per SMS schicken. Soll ich das machen?',
    });

    expect(reply).toEqual({
      response_type: 'response',
      response_id: 'response-1',
      content: 'Ich kann dir den Produktlink per SMS schicken. Soll ich das machen?',
      content_complete: true,
      end_call: false,
    });
  });

  it('fails closed when the route gate or secret is missing', async () => {
    const gated = await buildRetellDrkallaCustomLlmWsReply({
      enabled: false,
      secretAccepted: true,
      rawMessage: JSON.stringify({ interaction_type: 'response_required', response_id: 'response-1' }),
      complete: async () => 'no',
    });
    const unauthorized = await buildRetellDrkallaCustomLlmWsReply({
      enabled: true,
      secretAccepted: false,
      rawMessage: JSON.stringify({ interaction_type: 'response_required', response_id: 'response-1' }),
      complete: async () => 'no',
    });

    // Internal blocker diagnostics must never be spoken to a caller; the
    // route answers with a safe German unavailability sentence instead.
    expect(gated).toEqual({
      response_type: 'response',
      response_id: 'response-1',
      content: 'Entschuldigung, ich kann gerade nicht weiterhelfen. Bitte versuchen Sie es später noch einmal oder schreiben Sie an kontakt at drkalla punkt com.',
      content_complete: true,
      end_call: false,
    });
    expect(unauthorized).toBeNull();
  });
});
