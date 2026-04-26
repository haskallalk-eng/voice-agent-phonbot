import { describe, expect, it } from 'vitest';
import { deriveTechnicalRuntimeSettings, formatCallDuration } from './technical.js';

describe('deriveTechnicalRuntimeSettings', () => {
  it('maps the natural preset to responsive interruption defaults', () => {
    const runtime = deriveTechnicalRuntimeSettings({ interruptionMode: 'allow' });
    expect(runtime.interruptionMode).toBe('allow');
    expect(runtime.interruptionModeLabel).toBe('Natuerlich');
    expect(runtime.interruptionSensitivity).toBe(1);
    expect(runtime.responsiveness).toBe(0.85);
    expect(runtime.enableBackchannel).toBe(true);
    expect(runtime.allowUserDtmf).toBe(false);
  });

  it('respects explicit fine-tuning and clamps invalid values', () => {
    const runtime = deriveTechnicalRuntimeSettings({
      speakingSpeed: 5,
      temperature: -1,
      maxCallDuration: 15,
      interruptionMode: 'block',
      interruptionSensitivity: 0.42,
      responsiveness: 1.2,
      enableBackchannel: true,
      enableDtmf: true,
    });

    expect(runtime.voiceSpeed).toBe(2);
    expect(runtime.modelTemperature).toBe(0);
    expect(runtime.maxCallDurationSeconds).toBe(60);
    expect(runtime.maxCallDurationMs).toBe(60000);
    expect(runtime.interruptionSensitivity).toBe(0.42);
    expect(runtime.responsiveness).toBe(1);
    expect(runtime.enableBackchannel).toBe(true);
    expect(runtime.allowUserDtmf).toBe(true);
  });
});

describe('formatCallDuration', () => {
  it('formats full minutes cleanly', () => {
    expect(formatCallDuration(300)).toBe('5:00 Min');
  });
});
