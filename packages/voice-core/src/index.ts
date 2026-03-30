import WebSocket, { type RawData } from 'ws';
import { randomUUID } from 'crypto';

export type VoiceSessionId = string;

export type AudioEncoding = 'pcm16' | 'mulaw';

export type VoiceInputFrame = {
  data: Uint8Array;
  encoding: AudioEncoding;
  sampleRate: number;
  channels?: number;
  at?: number;
  endOfSegment?: boolean; // caller indicates end of user turn
};

export type VoiceOutputFrame = {
  data: Uint8Array;
  encoding: AudioEncoding;
  sampleRate: number;
  channels?: number;
  at?: number;
};

export type TraceEvent =
  | { type: 'session_started'; sessionId: VoiceSessionId; at: number }
  | { type: 'session_ended'; sessionId: VoiceSessionId; at: number; reason?: string }
  | { type: 'user_transcript_partial'; sessionId: VoiceSessionId; text: string; at: number }
  | { type: 'user_transcript_final'; sessionId: VoiceSessionId; text: string; at: number }
  | { type: 'agent_text'; sessionId: VoiceSessionId; text: string; at: number }
  | { type: 'agent_audio'; sessionId: VoiceSessionId; frame: VoiceOutputFrame; at: number }
  | { type: 'tool_call'; sessionId: VoiceSessionId; tool: string; input: unknown; at: number }
  | { type: 'tool_result'; sessionId: VoiceSessionId; tool: string; output: unknown; at: number }
  | { type: 'handoff_transfer'; sessionId: VoiceSessionId; toNumber: string; at: number }
  | { type: 'handoff_ticket'; sessionId: VoiceSessionId; reason: string; at: number }
  | { type: 'error'; sessionId: VoiceSessionId; error: string; at: number; detail?: unknown };

export interface TraceSink {
  emit(event: TraceEvent): void;
}

export type VoiceSessionOptions = {
  sessionId?: VoiceSessionId;
  language?: string;
  inputFormat?: AudioEncoding;
  outputFormat?: AudioEncoding;
  trace?: TraceSink;
};

export type VoiceSessionEventHandler = (event: TraceEvent) => void;

export interface VoiceSession {
  id: VoiceSessionId;
  sendAudio(frame: VoiceInputFrame): void;
  sendText(text: string): void;
  interrupt(): void;
  close(reason?: string): void;
  onEvent(handler: VoiceSessionEventHandler): () => void;
}

export interface VoiceProvider {
  createSession(options?: VoiceSessionOptions): VoiceSession;
}

export abstract class VoiceSessionBase implements VoiceSession {
  public readonly id: VoiceSessionId;
  protected readonly trace?: TraceSink;
  private handlers = new Set<VoiceSessionEventHandler>();

  constructor(id: VoiceSessionId, trace?: TraceSink) {
    this.id = id;
    this.trace = trace;
  }

  onEvent(handler: VoiceSessionEventHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  protected emit(event: TraceEvent) {
    this.trace?.emit(event);
    for (const h of this.handlers) h(event);
  }

  abstract sendAudio(frame: VoiceInputFrame): void;
  abstract sendText(text: string): void;
  abstract interrupt(): void;
  abstract close(reason?: string): void;
}

export class MemoryTraceSink implements TraceSink {
  public readonly events: TraceEvent[] = [];
  constructor(private max = 500) {}

  emit(event: TraceEvent) {
    this.events.unshift(event);
    if (this.events.length > this.max) this.events.length = this.max;
  }
}

// OpenAI Realtime provider (Node.js). Optional: use when OPENAI_API_KEY is set.
// This is intentionally minimal to keep the surface small and pluggable.

export type OpenAIRealtimeConfig = {
  apiKey: string;
  model?: string;
  baseUrl?: string; // default: wss://api.openai.com/v1/realtime
  voice?: string; // e.g. 'alloy'
  instructions?: string;
  inputFormat?: AudioEncoding; // default: pcm16
  outputFormat?: AudioEncoding; // default: pcm16
  sampleRate?: number; // default: 16000
  turnDetection?: { type: 'server_vad'; threshold?: number; silence_duration_ms?: number };
};

export class OpenAIRealtimeProvider implements VoiceProvider {
  constructor(private cfg: OpenAIRealtimeConfig) {}

  createSession(options?: VoiceSessionOptions): VoiceSession {
    const sessionId = options?.sessionId ?? randomUUID();
    return new OpenAIRealtimeSession(sessionId, this.cfg, options?.trace);
  }
}

class OpenAIRealtimeSession extends VoiceSessionBase {
  private socket?: WebSocket;
  private textBuffer = '';
  private commitTimer?: NodeJS.Timeout;

  constructor(id: VoiceSessionId, private cfg: OpenAIRealtimeConfig, trace?: TraceSink) {
    super(id, trace);
    this.connect();
  }

  private connect() {
    const model = this.cfg.model ?? 'gpt-4o-realtime-preview';
    const base = this.cfg.baseUrl ?? 'wss://api.openai.com/v1/realtime';
    const url = `${base}?model=${encodeURIComponent(model)}`;

    this.socket = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    this.socket.on('open', () => {
      this.emit({ type: 'session_started', sessionId: this.id, at: Date.now() });
      this.socket?.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: this.cfg.instructions,
            voice: this.cfg.voice ?? 'alloy',
            input_audio_format: this.cfg.inputFormat ?? 'pcm16',
            output_audio_format: this.cfg.outputFormat ?? 'pcm16',
            input_audio_transcription: { model: 'gpt-4o-transcribe' },
            turn_detection: this.cfg.turnDetection ?? { type: 'server_vad' },
          },
        })
      );
    });

    this.socket.on('message', (raw: RawData) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Text deltas
        if (msg?.type === 'response.text.delta' && typeof msg?.delta === 'string') {
          this.textBuffer += msg.delta;
          this.emit({ type: 'agent_text', sessionId: this.id, text: this.textBuffer, at: Date.now() });
          return;
        }
        if (msg?.type === 'response.text.done') {
          this.textBuffer = '';
          return;
        }

        // Audio deltas (base64 pcm16)
        if (msg?.type === 'response.audio.delta' && typeof msg?.delta === 'string') {
          const buf = Buffer.from(msg.delta, 'base64');
          const frame: VoiceOutputFrame = {
            data: new Uint8Array(buf),
            encoding: this.cfg.outputFormat ?? 'pcm16',
            sampleRate: this.cfg.sampleRate ?? 16000,
          };
          this.emit({ type: 'agent_audio', sessionId: this.id, frame, at: Date.now() });
          return;
        }

        // Final user transcript (various event names across versions)
        if (msg?.type === 'conversation.item.input_audio_transcription.completed' && msg?.transcript) {
          this.emit({ type: 'user_transcript_final', sessionId: this.id, text: String(msg.transcript), at: Date.now() });
          return;
        }
        if (msg?.type === 'input_audio_transcription.delta' && msg?.delta) {
          this.emit({ type: 'user_transcript_partial', sessionId: this.id, text: String(msg.delta), at: Date.now() });
          return;
        }

        // Ignore other events for now.
      } catch (e) {
        this.emit({ type: 'error', sessionId: this.id, error: 'WS_MESSAGE_PARSE_FAILED', at: Date.now(), detail: e });
      }
    });

    this.socket.on('close', () => this.emit({ type: 'session_ended', sessionId: this.id, at: Date.now(), reason: 'ws_closed' }));
    this.socket.on('error', (err: unknown) => this.emit({ type: 'error', sessionId: this.id, error: 'WS_ERROR', at: Date.now(), detail: err }));
  }

  private commitAndRespond() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    this.socket.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text', 'audio'] } }));
  }

  sendAudio(frame: VoiceInputFrame): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const payload = Buffer.from(frame.data).toString('base64');
    this.socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: payload }));

    // If caller marks end-of-turn, commit + create response immediately.
    if (frame.endOfSegment) {
      this.commitAndRespond();
      return;
    }

    // Otherwise, auto-commit after short silence (debounce).
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.commitAndRespond(), 600);
  }

  sendText(text: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      })
    );
    this.socket.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text', 'audio'] } }));
  }

  interrupt(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.textBuffer = '';
    this.socket.send(JSON.stringify({ type: 'response.cancel' }));
  }

  close(reason?: string): void {
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.socket?.close();
    this.emit({ type: 'session_ended', sessionId: this.id, at: Date.now(), reason: reason ?? 'closed' });
  }
}
