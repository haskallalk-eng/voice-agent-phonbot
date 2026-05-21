import { describe, expect, it } from 'vitest';
import { intentFromTool, intentFromUtterance } from '../intent-layer.js';

describe('intent layer', () => {
  it('maps calendar tools to appointment intents', () => {
    expect(intentFromTool('calendar_book')).toBe('book_appointment');
    expect(intentFromTool('calendar_cancel')).toBe('cancel_appointment');
    expect(intentFromTool('calendar_reschedule')).toBe('reschedule_appointment');
  });

  it('recognizes German cancellation and reschedule utterances', () => {
    expect(intentFromUtterance('Ich will meinen Termin absagen')).toBe('cancel_appointment');
    expect(intentFromUtterance('Kann ich den Termin verschieben?')).toBe('reschedule_appointment');
  });

  it('recognizes privacy decline', () => {
    expect(intentFromUtterance('Ich will die Aufzeichnung nicht')).toBe('privacy_decline');
  });
});

