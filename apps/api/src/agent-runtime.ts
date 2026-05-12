import { readConfig } from './agent-config.js';
import { appendTraceEvent } from './traces.js';
import { executeKnownTool, getOpenAITools } from './agent-tools.js';
import { buildAgentInstructions } from './agent-instructions.js';
import { loadPlatformBaseline } from './platform-baseline.js';
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
    '- Use calendar_find_slots before proposing specific appointment times.',
    '- For appointment options, use spokenOptionsText or slotOptions[].spokenLabel from calendar_find_slots. Never speak technical time strings; say 09:00 as "neun Uhr" and 10:05 as "zehn Uhr null fuenf".',
    '- Use calendar_book only after the user explicitly confirms the exact future date/time, service, and customer name in the latest turn. If multiple options were offered, a vague "yes", "okay", or "passt" is not enough; ask which option.',
    '- Use calendar_find_bookings before canceling or rescheduling an existing appointment.',
    '- Use calendar_cancel/calendar_reschedule only with changeToken from calendar_find_bookings and only after the exact existing appointment and requested change were explicitly confirmed.',
    '- If user wants a callback or handoff, use ticket_create only after a verified from_number exists or the user provided and confirmed one contact channel.',
    '- Do not claim a booking unless calendar_book succeeded.',
    '- Mention SMS confirmation only when the tool result contains smsSent=true.',
  ].join('\n');
}

function safeTraceInput(args: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(args).filter((key) => !key.startsWith('_')).sort();
  return {
    argKeys: keys,
    confirmed: typeof args.confirmed === 'boolean' ? args.confirmed : undefined,
    hasCustomerName: typeof args.customerName === 'string' && args.customerName.trim().length > 0,
    hasCustomerPhone: typeof args.customerPhone === 'string' && args.customerPhone.trim().length > 0,
    hasEmail: typeof args.email === 'string' && args.email.trim().length > 0,
    hasChangeToken: typeof args.changeToken === 'string' && args.changeToken.trim().length > 0,
    hasNotes: typeof args.notes === 'string' && args.notes.trim().length > 0,
  };
}

function safeTraceOutput(result: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: typeof result.ok === 'boolean' ? result.ok : undefined,
    status: typeof result.status === 'string' ? result.status : undefined,
    error: typeof result.error === 'string' ? result.error.slice(0, 80).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]').replace(/\+?\d[\d\s()./-]{6,}\d/g, '[phone]') : undefined,
    fallback: typeof result.fallback === 'boolean' ? result.fallback : undefined,
    partial: typeof result.partial === 'boolean' ? result.partial : undefined,
    reused: typeof result.reused === 'boolean' ? result.reused : undefined,
    smsSent: typeof result.smsSent === 'boolean' ? result.smsSent : undefined,
    matchCount: Array.isArray(result.matches) ? result.matches.length : undefined,
    externalResultCount: Array.isArray(result.externalResults) ? result.externalResults.length : undefined,
  };
}

function sanitizeToolOutputForModel(result: Record<string, unknown>): Record<string, unknown> {
  const cleanString = (value: unknown, max = 500): string | undefined => {
    if (typeof value !== 'string') return undefined;
    return value
      .slice(0, max)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/\+?\d[\d\s()./-]{6,}\d/g, '[phone]');
  };
  const out: Record<string, unknown> = {};
  for (const key of ['ok', 'partial', 'fallback', 'reused', 'smsSent', 'callbackScheduled']) {
    if (typeof result[key] === 'boolean') out[key] = result[key];
  }
  for (const key of ['status', 'error', 'message', 'instruction', 'deliveryInstruction', 'source', 'service', 'preferredTime', 'preferredStylist']) {
    const value = cleanString(result[key], key === 'instruction' || key === 'message' ? 800 : 220);
    if (value) out[key] = value;
  }
  if (Array.isArray(result.externalResults)) out.externalResultCount = result.externalResults.length;
  if (typeof result.externalResultCount === 'number') out.externalResultCount = result.externalResultCount;
  if (typeof result.candidateCount === 'number') out.candidateCount = result.candidateCount;
  if (typeof result.allSlotsCount === 'number') out.allSlotsCount = result.allSlotsCount;
  if (typeof result.moreCount === 'number') out.moreCount = result.moreCount;
  if (Array.isArray(result.slots)) out.slots = result.slots.filter((slot): slot is string => typeof slot === 'string').slice(0, 6);
  if (Array.isArray(result.slotOptions)) {
    out.slotOptions = result.slotOptions.slice(0, 6).map((item) => {
      const option = item as Record<string, unknown>;
      return {
        slot: cleanString(option.slot, 80),
        spokenLabel: cleanString(option.spokenLabel, 120),
      };
    });
  }
  const spokenOptionsText = cleanString(result.spokenOptionsText, 500);
  if (spokenOptionsText) out.spokenOptionsText = spokenOptionsText;
  if (Array.isArray(result.matches)) {
    out.matches = result.matches.slice(0, 3).map((item) => {
      const match = item as Record<string, unknown>;
      return {
        changeToken: cleanString(match.changeToken, 1000),
        service: cleanString(match.service, 160),
        startAt: cleanString(match.startAt, 80),
        label: cleanString(match.label, 160),
        spokenLabel: cleanString(match.spokenLabel, 160),
        staffName: cleanString(match.staffName, 160),
      };
    });
    out.matchCount = result.matches.length;
  }
  return out;
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
  const platformBaseline = await loadPlatformBaseline();
  const instructions = [platformBaseline, buildAgentInstructions(cfg), toolGuidance()].join('\n\n');
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
          tool: toolName, input: safeTraceInput(toolArgs), at: now(),
        } as Parameters<typeof appendTraceEvent>[0]);

        const result = await executeKnownTool({
          name: toolName,
          args: toolArgs,
          tenantId: input.tenantId,
          sessionId: input.sessionId,
          source: input.source,
          cfg,
        });

        const modelResult = sanitizeToolOutputForModel(result as Record<string, unknown>);

        await appendTraceEvent({
          type: 'tool_result', sessionId: input.sessionId, tenantId: input.tenantId,
          tool: toolName, output: safeTraceOutput(modelResult), at: now(),
        } as Parameters<typeof appendTraceEvent>[0]);

        // Add the function call + result to input for next round
        apiInput.push(call as OpenAIInputItem);
        apiInput.push({
          type: 'function_call_output',
          call_id: call?.call_id ?? call?.id,
          output: JSON.stringify(modelResult),
        });

        // Also persist tool interaction in session store
        await pushMessage(input.sessionId, input.tenantId, {
          role: 'tool', name: toolName, content: JSON.stringify(modelResult),
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
