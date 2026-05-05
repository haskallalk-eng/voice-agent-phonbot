import { describe, expect, it } from 'vitest';
import { MemoryTraceSink, VoiceSessionBase, type TraceEvent, type VoiceInputFrame } from './index.js';

class TestSession extends VoiceSessionBase {
  sendAudio(_frame: VoiceInputFrame): void {
    this.emit({ type: 'user_transcript_partial', sessionId: this.id, text: 'audio', at: 1 });
  }

  sendText(text: string): void {
    this.emit({ type: 'agent_text', sessionId: this.id, text, at: 2 });
  }

  interrupt(): void {
    this.emit({ type: 'error', sessionId: this.id, error: 'INTERRUPTED', at: 3 });
  }

  close(reason?: string): void {
    this.emit({ type: 'session_ended', sessionId: this.id, at: 4, reason });
  }
}

describe('voice-core primitives', () => {
  it('keeps MemoryTraceSink bounded with newest events first', () => {
    const sink = new MemoryTraceSink(2);
    sink.emit({ type: 'session_started', sessionId: 's1', at: 1 });
    sink.emit({ type: 'agent_text', sessionId: 's1', text: 'first', at: 2 });
    sink.emit({ type: 'agent_text', sessionId: 's1', text: 'second', at: 3 });

    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]).toMatchObject({ type: 'agent_text', text: 'second' });
    expect(sink.events[1]).toMatchObject({ type: 'agent_text', text: 'first' });
  });

  it('emits to trace sink and removable event handlers', () => {
    const sink = new MemoryTraceSink();
    const session = new TestSession('voice-test', sink);
    const seen: TraceEvent[] = [];

    const off = session.onEvent((event) => seen.push(event));
    session.sendText('hallo');
    off();
    session.close('done');

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'agent_text', text: 'hallo' });
    expect(sink.events[0]).toMatchObject({ type: 'session_ended', reason: 'done' });
    expect(sink.events[1]).toMatchObject({ type: 'agent_text', text: 'hallo' });
  });
});
