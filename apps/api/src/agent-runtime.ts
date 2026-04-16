import { readConfig } from './agent-config.js';
import { appendTraceEvent } from './traces.js';
import { executeKnownTool, getOpenAITools } from './agent-tools.js';
import { buildAgentInstructions } from './agent-instructions.js';
import { pushMessage, getMessages } from './session-store.js';

function now() {
  return Date.now();
}

/** Narrowed shape of an OpenAI Responses API output item. */
interface OpenAIOutputItem {
  type?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  id?: string;
  content?: Array<{ text?: string }>;
  output_text?: string;
}

/** Narrowed shape of the OpenAI Responses API response. */
interface OpenAIResponse {
  output?: OpenAIOutputItem[];
  output_text?: string;
}

/** Narrowed shape of an OpenAI input item fed back after tool results. */
interface OpenAIInputItem {
  role?: string;
  type?: string;
  name?: string;
  content?: string | Array<{ text?: string }>;
  call_id?: string;
  id?: string;
  arguments?: string;
  output?: string;
}

function normalizeText(data: OpenAIResponse): string {
  return (
    data?.output_text ??
    data?.output
      ?.map((o) =>
        o?.content
          ?.map((c) => c?.text)
          .filter(Boolean)
          .join(''),
      )
      .filter(Boolean)
      .join('\n') ??
    ''
  )
    .toString()
    .trim();
}

function toolGuidance() {
  return [
    'Tool usage rules:',
    '- Use calendar.findSlots before proposing specific appointment times.',
    '- Use calendar.book only after the user confirms a slot + service.',
    '- If user wants a callback or handoff, use ticket.create and confirm the phone number.',
    '- Do not claim a booking unless calendar.book succeeded.',
  ].join('\n');
}

const OPENAI_API = 'https://api.openai.com/v1/responses';

export async function runAgentTurn(input: {
  tenantId: string;
  sessionId: string;
  text: string;
  source: 'web' | 'phone' | 'system';
}) {
  // INVARIANT: this function has exactly one caller (chat.ts) and that caller
  // MUST pass tenantId = JWT.orgId. We rely on this so readConfig's ownership
  // check (second arg = orgId) actually enforces something. If you add a new
  // caller (Retell webhook, queue worker, CLI), DO NOT pass a body-supplied
  // tenant — derive it from a verified server-side source or redesign this API
  // to take tenantId + orgId separately.
  const cfg = await readConfig(input.tenantId, input.tenantId);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const reply = 'Der Voice-Agent ist gerade nicht konfiguriert. Bitte API-Key hinterlegen.';
    await appendTraceEvent({ type: 'agent_text', sessionId: input.sessionId, tenantId: input.tenantId, text: reply, at: now() } as Parameters<typeof appendTraceEvent>[0]);
    return { text: reply };
  }

  const tools = getOpenAITools(cfg);
  const instructions = [buildAgentInstructions(cfg), toolGuidance()].join('\n\n');
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  // 1) Store user message
  await pushMessage(input.sessionId, input.tenantId, { role: 'user', content: input.text });

  // 2) Build input array: system + full conversation history
  const history = await getMessages(input.sessionId, input.tenantId);
  const apiInput: OpenAIInputItem[] = [
    { role: 'system', content: instructions },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  // 3) Call OpenAI with tool loop (max 6 rounds to prevent infinite loops)
  for (let round = 0; round < 6; round++) {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: apiInput,
        tools: tools.length ? tools : undefined,
      }),
      // Per-round 30s timeout — prevents an OpenAI hang from stalling a /chat
      // Fastify worker indefinitely (cascading pool saturation on outage).
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as OpenAIResponse;
    const output: OpenAIOutputItem[] = data?.output ?? [];

    // Check for function calls
    const functionCalls = output.filter((item) => item?.type === 'function_call');

    if (functionCalls.length > 0) {
      // Process each tool call and feed results back
      for (const call of functionCalls) {
        const toolName: string = call?.name ?? 'unknown';
        let toolArgs: Record<string, unknown> = {};
        if (call?.arguments) {
          try {
            toolArgs = JSON.parse(call.arguments) as Record<string, unknown>;
          } catch {
            toolArgs = { _parseError: true, _raw: String(call.arguments).slice(0, 200) };
          }
        }

        await appendTraceEvent({
          type: 'tool_call', sessionId: input.sessionId, tenantId: input.tenantId,
          tool: toolName, input: toolArgs, at: now(),
        } as Parameters<typeof appendTraceEvent>[0]);

        const result = await executeKnownTool({
          name: toolName,
          args: toolArgs,
          tenantId: input.tenantId,
          sessionId: input.sessionId,
          source: input.source,
          cfg,
        });

        await appendTraceEvent({
          type: 'tool_result', sessionId: input.sessionId, tenantId: input.tenantId,
          tool: toolName, output: result, at: now(),
        } as Parameters<typeof appendTraceEvent>[0]);

        // Add the function call + result to input for next round
        apiInput.push(call as OpenAIInputItem);
        apiInput.push({
          type: 'function_call_output',
          call_id: call?.call_id ?? call?.id,
          output: JSON.stringify(result),
        });

        // Also persist tool interaction in session store
        await pushMessage(input.sessionId, input.tenantId, {
          role: 'tool', name: toolName, content: JSON.stringify(result),
        });
      }

      // Continue the loop so the model can respond with text after seeing tool results
      continue;
    }

    // No function calls → extract text response
    const textOut = normalizeText(data);
    if (textOut) {
      await pushMessage(input.sessionId, input.tenantId, { role: 'assistant', content: textOut });
      return { text: textOut };
    }
  }

  // Fallback if loop exhausted
  const fallback = 'Entschuldigung, ich konnte die Anfrage nicht verarbeiten. Kann ich dir anders weiterhelfen?';
  await pushMessage(input.sessionId, input.tenantId, { role: 'assistant', content: fallback });
  return { text: fallback };
}
