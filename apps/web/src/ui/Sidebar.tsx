import React, { useState } from 'react';
import type { Page } from './App.js';
import type { AuthUser, AuthOrg } from '../lib/auth.js';
import { PhonbotBrand } from './FoxLogo.js';
import {
  IconHome,
  IconCalls,
  IconTickets,
  IconCalendar,
  IconAgent,
  IconTest,
  IconPhone,
  IconBilling,
  IconLogout,
  IconInsights,
} from './PhonbotIcons.js';
import { deleteAccount } from '../lib/api.js';

type NavItem = { id: Page; label: string; Icon: React.FC<{ size?: number; className?: string }> };

const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { id: 'home', label: 'Dashboard', Icon: IconHome },
    ],
  },
  {
    label: 'ÜBERSICHT',
    items: [
      { id: 'logs', label: 'Anrufe', Icon: IconCalls },
      { id: 'tickets', label: 'Tickets', Icon: IconTickets },
      { id: 'calendar', label: 'Kalender', Icon: IconCalendar },
      { id: 'insights', label: 'KI-Insights', Icon: IconInsights },
    ],
  },
  {
    label: 'AGENT',
    items: [
      { id: 'agent', label: 'Agent Builder', Icon: IconAgent },
      { id: 'test', label: 'Testen', Icon: IconTest },
    ],
  },
  {
    label: 'EINSTELLUNGEN',
    items: [
      { id: 'phone', label: 'Telefon', Icon: IconPhone },
      { id: 'billing', label: 'Billing', Icon: IconBilling },
    ],
  },
];

type Props = {
  current: Page;
  onNavigate: (p: Page) => void;
  org: AuthOrg | null;
  user: AuthUser | null;
  onLogout: () => void;
};

function DeleteAccountModal({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (confirm !== 'LÖSCHEN') return;
    setLoading(true);
    setError(null);
    try {
      await deleteAccount();
      onLogout();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fehler beim Löschen');
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-sm bg-[#14141f] border border-red-500/20 rounded-2xl p-6 space-y-4" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
        <div>
          <h3 id="delete-account-title" className="text-base font-bold text-white">Account unwiderruflich löschen</h3>
          <p className="text-sm text-white/50 mt-1">
            Alle Daten — Agent, Anrufe, Tickets, Kalender — werden sofort und dauerhaft gelöscht. Dein Stripe-Abo wird gekündigt.
          </p>
        </div>
        <div>
          <label className="block text-xs text-white/40 mb-1.5">
            Tippe <span className="text-red-400 font-mono font-semibold">LÖSCHEN</span> zur Bestätigung
          </label>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="LÖSCHEN"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-red-500/40 font-mono"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-white/50 hover:text-white hover:border-white/20 transition-all"
          >
            Abbrechen
          </button>
          <button
            onClick={handleDelete}
            disabled={confirm !== 'LÖSCHEN' || loading}
            className="flex-1 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-sm font-medium hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {loading ? '…' : 'Löschen'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ current, onNavigate, org, user, onLogout }: Props) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  return (
    <aside className="w-56 shrink-0 bg-[#0F0F18] border-r border-white/5 text-white flex flex-col h-full min-h-0">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-white/5 shrink-0">
        <PhonbotBrand size="sm" />
        {org && <p className="text-xs text-white/40 mt-1 truncate">{org.name}</p>}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 overflow-y-auto" aria-label="Hauptnavigation">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
            {group.label && (
              <p className="px-5 mb-1 text-[10px] font-semibold tracking-widest text-white/25 uppercase select-none">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const active = current === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-all duration-150 relative',
                    active
                      ? 'bg-white/[0.08] text-white font-medium border-l-2 border-orange-500'
                      : 'text-white/45 hover:text-white/75 hover:bg-white/[0.04] border-l-2 border-transparent',
                  ].join(' ')}
                >
                  <item.Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User Footer */}
      <div className="px-4 py-4 border-t border-white/5 shrink-0">
        {(user || org) && (
          <div className="flex items-center gap-3 mb-3 min-w-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
            >
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              {org && (
                <p className="text-xs font-semibold text-white/80 truncate">{org.name}</p>
              )}
              {user && (
                <p className="text-xs text-white/40 truncate" title={user.email}>
                  {user.email}
                </p>
              )}
            </div>
          </div>
        )}
        <button
          onClick={onLogout}
          className="flex items-center gap-2 text-xs text-white/30 hover:text-white/70 transition-colors"
        >
          <IconLogout size={14} />
          Abmelden
        </button>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="mt-2 flex items-center gap-2 text-xs text-red-500/40 hover:text-red-400/70 transition-colors"
          aria-label="Account unwiderruflich löschen"
        >
          Account löschen
        </button>
      </div>
      {showDeleteModal && (
        <DeleteAccountModal
          onClose={() => setShowDeleteModal(false)}
          onLogout={onLogout}
        />
      )}
    </aside>
  );
}
