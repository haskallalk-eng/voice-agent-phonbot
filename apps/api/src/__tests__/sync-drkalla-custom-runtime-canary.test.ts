import { describe, expect, it } from 'vitest';
import {
  buildDrkallaCustomRuntimeCanaryWsUrl,
  sanitizeDrkallaCustomRuntimeCanarySyncReport,
} from '../scripts/sync-drkalla-custom-runtime-canary.js';

describe('DrKalla custom runtime canary sync planning', () => {
  it('builds a Retell-compatible websocket endpoint that can receive Retell-appended call ids', () => {
    expect(buildDrkallaCustomRuntimeCanaryWsUrl({
      publicBaseUrl: 'https://phonbot.example',
      secret: 'secret-value',
    })).toBe('wss://phonbot.example/retell/custom-llm/drkalla/auth/secret-value');
  });

  it('rejects non-https public canary URLs for Retell execution', () => {
    expect(() => buildDrkallaCustomRuntimeCanaryWsUrl({
      publicBaseUrl: 'http://localhost:3000',
      secret: 'secret-value',
      requireSecure: true,
    })).toThrow('DRKALLA_CUSTOM_RUNTIME_REQUIRES_HTTPS_PUBLIC_BASE_URL');
  });

  it('does not expose the websocket secret in dry-run reports', () => {
    const report = sanitizeDrkallaCustomRuntimeCanarySyncReport({
      dryRun: true,
      agentName: 'DrKalla Custom Runtime Canary',
      existingAgentId: 'agent_custom_123456',
      websocketUrl: 'wss://phonbot.example/retell/custom-llm/drkalla/auth/secret-value',
      action: 'update',
    });

    expect(JSON.stringify(report)).not.toContain('secret-value');
    expect(report.websocketUrlMasked).toBe('wss://phonbot.example/retell/custom-llm/drkalla/auth/[secret]');
  });
});
