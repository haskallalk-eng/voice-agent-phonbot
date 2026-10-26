// @vitest-environment jsdom
import { forwardRef, useImperativeHandle } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OwlyDemoModal } from './OwlyDemoModal.js';
import { CallbackSection } from './landing/CallbackSection.js';
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('./TurnstileWidget.js', () => ({ TurnstileWidget: forwardRef((_props, ref) => {
  useImperativeHandle(ref, () => ({ execute })); return <div>Prüfung</div>;
}) }));
vi.mock('./landing/shared.js', async original => ({ ...await original<typeof import('./landing/shared.js')>(), useVisible: () => true }));
beforeEach(() => {
  execute.mockReset().mockResolvedValue('fresh-token');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fill(container: HTMLElement) {
  for (const input of Array.from(container.querySelectorAll<HTMLInputElement>('input'))) {
    if (input.type === 'checkbox') fireEvent.click(input);
    else fireEvent.change(input, { target: { value: input.type === 'email' ? 'synthetic@example.test' : input.type === 'tel' ? '+493012345678' : 'Test Person' } });
  }
}
for (const modal of [true, false]) {
  it(`${modal ? 'modal' : 'landing'} sends the token and refuses a failed challenge before HTTP`, async () => {
    const { container } = render(modal ? <OwlyDemoModal onClose={vi.fn()} /> : <CallbackSection />);
    if (modal) fireEvent.click(screen.getByRole('button', { name: 'Rückruf' }));
    fill(container);
    execute.mockRejectedValueOnce(new Error('Prüfung fehlgeschlagen'));
    fireEvent.submit(container.querySelector('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain('Prüfung fehlgeschlagen');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(modal ? '/api/demo/callback' : '/api/outbound/website-callback');
    expect(JSON.parse(options!.body as string)).toMatchObject({ turnstileToken: 'fresh-token', privacyConsent: true });
  });
}
