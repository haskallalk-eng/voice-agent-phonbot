// @vitest-environment jsdom
import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UsersTab } from './AdminPage.js';
import { adminGetUsers, adminGetOrgs, type AdminUser } from '../lib/api.js';
vi.mock('../lib/api.js', async original => ({
  ...await original<typeof import('../lib/api.js')>(), adminGetUsers: vi.fn(), adminGetOrgs: vi.fn(),
}));
const user = (email: string): AdminUser => ({ id: email, email, role: 'owner', created_at: '2026-10-26', is_active: true, org_id: null, org_name: null, plan: null, plan_status: null });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminGetUsers).mockResolvedValue({ items: [user('page-one@example.test')], hasMore: true });
  vi.mocked(adminGetOrgs).mockResolvedValue({ items: [], hasMore: false });
});
afterEach(cleanup);
it('loads the next page, searches across pages and resets offset for organizations', async () => {
  render(<UsersTab />);
  await screen.findByText('page-one@example.test');
  vi.mocked(adminGetUsers).mockResolvedValueOnce({ items: [user('page-two@example.test')], hasMore: false });
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
  await screen.findByText('page-two@example.test');
  expect(adminGetUsers).toHaveBeenLastCalledWith({ limit: 50, offset: 50, search: '' });
  expect((screen.getByRole('button', { name: 'Weiter' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText('Email, Org, Plan, Rolle...'), { target: { value: 'needle' } });
  await waitFor(() => expect(adminGetUsers).toHaveBeenLastCalledWith({ limit: 50, offset: 0, search: 'needle' }));
  fireEvent.click(screen.getByRole('button', { name: 'Unternehmen' }));
  await screen.findByText('Keine Einträge gefunden.');
  expect(adminGetOrgs).toHaveBeenLastCalledWith({ limit: 50, offset: 0, search: '' });
});
it('shows request failures and supports retry', async () => {
  vi.mocked(adminGetUsers).mockRejectedValueOnce(new Error('offline'));
  render(<UsersTab />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  await screen.findByText('page-one@example.test');
  expect(screen.queryByRole('alert')).toBeNull();
});
it('ignores a stale response after changing the view', async () => {
  let resolve!: (value: { items: AdminUser[]; hasMore: boolean }) => void;
  vi.mocked(adminGetUsers).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<UsersTab />);
  fireEvent.click(screen.getByRole('button', { name: 'Unternehmen' }));
  await screen.findByText('Keine Einträge gefunden.');
  await act(async () => resolve({ items: [user('stale@example.test')], hasMore: true }));
  expect(screen.queryByText('stale@example.test')).toBeNull();
  expect((screen.getByRole('button', { name: 'Weiter' }) as HTMLButtonElement).disabled).toBe(true);
});
