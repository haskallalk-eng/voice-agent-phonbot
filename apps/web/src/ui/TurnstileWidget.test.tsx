// @vitest-environment jsdom
import { createRef, act } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TurnstileHandle } from './TurnstileWidget.js';
let callbacks: Record<string, unknown>;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'synthetic-site-key');
  window.turnstile = {
    render: vi.fn((_container, options) => { callbacks = options; return 'widget'; }),
    execute: vi.fn(), reset: vi.fn(), remove: vi.fn(),
  };
});
afterEach(() => { cleanup(); delete window.turnstile; vi.unstubAllEnvs(); });
it('resets for every attempt and settles failures without blocking retries', async () => {
  const { TurnstileWidget } = await import('./TurnstileWidget.js');
  const ref = createRef<TurnstileHandle>();
  const { container } = render(<TurnstileWidget ref={ref} mode="execute" />);
  await waitFor(() => expect(window.turnstile!.render).toHaveBeenCalled());
  expect(container.firstElementChild?.getAttribute('style')).not.toContain('hidden');
  const first = ref.current!.execute();
  (callbacks.callback as (token: string) => void)('first-token');
  await expect(first).resolves.toBe('first-token');
  const failure = ref.current!.execute();
  const assertion = expect(failure).rejects.toThrow('Sicherheitsprüfung');
  (callbacks['error-callback'] as () => void)();
  await assertion;
  const retry = ref.current!.execute();
  (callbacks.callback as (token: string) => void)('second-token');
  await expect(retry).resolves.toBe('second-token');
  expect(window.turnstile!.reset).toHaveBeenCalledTimes(3);
});
it('rejects a pending check on unmount and removes its widget', async () => {
  const { TurnstileWidget } = await import('./TurnstileWidget.js');
  const ref = createRef<TurnstileHandle>();
  const { unmount } = render(<TurnstileWidget ref={ref} mode="execute" />);
  await waitFor(() => expect(window.turnstile!.render).toHaveBeenCalled());
  const pending = ref.current!.execute();
  const assertion = expect(pending).rejects.toThrow();
  act(unmount);
  await assertion;
  expect(window.turnstile!.remove).toHaveBeenCalledWith('widget');
});
