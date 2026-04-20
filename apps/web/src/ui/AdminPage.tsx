import React, { useState, useEffect, useCallback } from 'react';
import {
  adminLogin,
  adminGetMetrics,
  adminGetLeads,
  adminUpdateLead,
  adminDeleteLead,
  adminGetUsers,
  adminGetOrgs,
  setAdminToken,
  getAdminToken,
  type AdminMetrics,
  type AdminLead,
  type AdminUser,
  type AdminOrg,
} from '../lib/api.js';

type Tab = 'overview' | 'leads' | 'users';

// ── Smart Search Input ───────────────────────────────────────────────────────

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative flex-1 max-w-sm">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search...'}
        className="w-full pl-9 pr-8 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-orange-500/50 transition-colors"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      )}
    </div>
  );
}

/** Case-insensitive multi-field substring match */
function matchesSearch(query: string, ...fields: (string | number | null | undefined | boolean)[]): boolean {
  if (!query) return true;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = fields.map(f => String(f ?? '')).join(' ').toLowerCase();
  return terms.every(t => haystack.includes(t));
}

// ── Login Gate ────────────────────────────────────────────────────────────────

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await adminLogin(password);
      // In-memory only — admin token never touches localStorage. Each tab
      // requires a fresh login, which is acceptable for a low-frequency flow
      // and closes the XSS-exfil surface (F-02).
      setAdminToken(token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error && err.message.includes('401') ? 'Falsches Passwort' : 'Verbindungsfehler — versuche es erneut');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F] px-4">
      <form onSubmit={handleSubmit} className="glass rounded-2xl p-8 w-full max-w-sm flex flex-col gap-5">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Phonbot Admin</h1>
          <p className="text-white/40 text-sm mt-1">Owner access only</p>
        </div>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 pr-12 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-orange-500/50 transition-colors"
            autoFocus
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors cursor-pointer">
            {showPassword ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            )}
          </button>
        </div>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full py-3 rounded-xl font-semibold text-white text-sm transition-all duration-200 hover:opacity-90 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #F97316, #EA580C)' }}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="glass rounded-2xl p-5 flex flex-col gap-2">
      <span className="text-white/50 text-sm">{label}</span>
      <p className="text-3xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-white/40">{sub}</p>}
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminGetMetrics()
      .then(setMetrics)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!metrics) return <p className="text-white/40 text-sm p-6">Failed to load metrics.</p>;

  const planEntries = Object.entries(metrics.planCounts);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={metrics.totalUsers} />
        <StatCard label="Total Orgs" value={metrics.totalOrgs} />
        <StatCard label="Total Calls" value={metrics.totalCalls} />
        <StatCard
          label="Est. Revenue"
          value={`${metrics.totalRevenue.toLocaleString('de-DE')} EUR/mo`}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Tickets" value={metrics.totalTickets} />
        <StatCard
          label="Phone Numbers"
          value={metrics.phoneTotal}
          sub={`${metrics.phoneAssigned} assigned`}
        />
        {planEntries.map(([plan, count]) => (
          <StatCard key={plan} label={`Plan: ${plan}`} value={count} />
        ))}
      </div>
    </div>
  );
}

// ── Leads Tab ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  contacted: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  converted: 'bg-green-500/20 text-green-400 border-green-500/30',
  lost: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const NEXT_STATUS: Record<string, string> = {
  new: 'contacted',
  contacted: 'converted',
  converted: 'converted',
  lost: 'lost',
};

function LeadsTab() {
  const [leads, setLeads] = useState<AdminLead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    adminGetLeads({ status: filter || undefined, limit: 100 })
      .then((res) => {
        setLeads(res.items);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function cycleStatus(lead: AdminLead) {
    const next = NEXT_STATUS[lead.status] ?? 'new';
    if (next === lead.status) return;
    await adminUpdateLead(lead.id, { status: next }).catch(() => {});
    load();
  }

  async function saveNotes(id: string) {
    await adminUpdateLead(id, { notes: notesValue }).catch(() => {});
    setEditingNotes(null);
    load();
  }

  async function deleteLead(id: string) {
    if (!confirm('Delete this lead?')) return;
    await adminDeleteLead(id).catch(() => {});
    load();
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const filtered = leads.filter(l => matchesSearch(search, l.name, l.email, l.phone, l.source, l.status, l.notes));

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Name, Email, Telefon, Quelle..." />
        <span className="text-white/50 text-sm">Filter:</span>
        {['', 'new', 'contacted', 'converted', 'lost'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              filter === s
                ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
        <span className="text-white/30 text-xs ml-auto">{search ? `${filtered.length} / ` : ''}{total} leads</span>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <p className="text-white/30 text-sm text-center py-12">{search ? 'Keine Treffer.' : 'No leads found.'}</p>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/40 text-left">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr key={lead.id} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 text-white/60 whitespace-nowrap">{formatDate(lead.created_at)}</td>
                    <td className="px-4 py-3 text-white">{lead.name || '-'}</td>
                    <td className="px-4 py-3 text-white/70">{lead.email}</td>
                    <td className="px-4 py-3 text-white/60">{lead.phone || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/50 text-xs">
                        {lead.source || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => cycleStatus(lead)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border cursor-pointer transition-opacity hover:opacity-80 ${STATUS_COLORS[lead.status] ?? ''}`}
                        title="Click to advance status"
                      >
                        {lead.status}
                      </button>
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      {editingNotes === lead.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            className="px-2 py-1 rounded bg-white/5 border border-white/10 text-white text-xs w-full focus:outline-none focus:border-orange-500/50"
                            value={notesValue}
                            onChange={(e) => setNotesValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveNotes(lead.id);
                              if (e.key === 'Escape') setEditingNotes(null);
                            }}
                            autoFocus
                          />
                          <button
                            onClick={() => saveNotes(lead.id)}
                            className="text-green-400 text-xs hover:text-green-300 shrink-0"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={() => {
                            setEditingNotes(lead.id);
                            setNotesValue(lead.notes || '');
                          }}
                          className="text-white/40 text-xs cursor-pointer hover:text-white/60 truncate block"
                          title="Click to edit"
                        >
                          {lead.notes || 'click to add notes...'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => deleteLead(lead.id)}
                        className="text-red-400/60 hover:text-red-400 text-xs transition-colors"
                        title="Delete lead"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'users' | 'orgs'>('users');
  const [search, setSearch] = useState('');

  useEffect(() => {
    Promise.all([adminGetUsers(), adminGetOrgs()])
      .then(([u, o]) => {
        setUsers(u.items);
        setOrgs(o.items);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
  }

  const filteredUsers = users.filter(u => matchesSearch(search, u.email, u.org_name, u.plan, u.role, u.is_active ? 'active' : 'inactive'));
  const filteredOrgs = orgs.filter(o => matchesSearch(search, o.name, o.slug, o.plan, o.plan_status, o.is_active ? 'active' : 'inactive'));

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Search + Sub-toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder={view === 'users' ? 'Email, Org, Plan, Rolle...' : 'Name, Plan, Status...'} />
        {(['users', 'orgs'] as const).map((v) => (
          <button
            key={v}
            onClick={() => { setView(v); setSearch(''); }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border ${
              view === v
                ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
            }`}
          >
            {v === 'users' ? `Users (${search ? `${filteredUsers.length}/` : ''}${users.length})` : `Orgs (${search ? `${filteredOrgs.length}/` : ''}${orgs.length})`}
          </button>
        ))}
      </div>

      {view === 'users' ? (
        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/40 text-left">
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Org</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 text-white">{u.email}</td>
                    <td className="px-4 py-3 text-white/60">{u.org_name || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/50 text-xs capitalize">
                        {u.plan || 'free'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/50 capitalize">{u.role}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs ${u.is_active ? 'text-green-400' : 'text-red-400'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/40">{formatDate(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/40 text-left">
                  <th className="px-4 py-3 font-medium">Org Name</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Plan Status</th>
                  <th className="px-4 py-3 font-medium">Users</th>
                  <th className="px-4 py-3 font-medium">Agents</th>
                  <th className="px-4 py-3 font-medium">Minutes</th>
                  <th className="px-4 py-3 font-medium">Active</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrgs.map((o) => (
                  <tr key={o.id} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 text-white">{o.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/50 text-xs capitalize">
                        {o.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/50 capitalize">{o.plan_status}</td>
                    <td className="px-4 py-3 text-white/60">{o.users_count}</td>
                    <td className="px-4 py-3 text-white/60">{o.agents_count}</td>
                    <td className="px-4 py-3 text-white/40">{o.minutes_used}/{o.minutes_limit}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs ${o.is_active ? 'text-green-400' : 'text-red-400'}`}>
                        {o.is_active ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/40">{formatDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Loading Spinner ───────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
    </div>
  );
}

// ── Main AdminPage ────────────────────────────────────────────────────────────

export function AdminPage() {
  const [isAuthed, setIsAuthed] = useState(!!getAdminToken());
  const [tab, setTab] = useState<Tab>('overview');

  function handleLogout() {
    setAdminToken(null);
    setIsAuthed(false);
  }

  if (!isAuthed) return <AdminLogin onLogin={() => setIsAuthed(true)} />;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">
            <span className="bg-gradient-to-r from-orange-400 to-cyan-400 bg-clip-text text-transparent">
              Phonbot Admin
            </span>
          </h1>
          <span className="text-white/20 text-xs">CRM Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="text-white/40 text-sm hover:text-white/60 transition-colors"
          >
            Back to App
          </a>
          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm hover:bg-white/10 transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-white/5 px-6">
        <div className="flex gap-1">
          {([
            ['overview', 'Overview'],
            ['leads', 'Leads'],
            ['users', 'Users'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === key
                  ? 'border-orange-500 text-white'
                  : 'border-transparent text-white/40 hover:text-white/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'leads' && <LeadsTab />}
        {tab === 'users' && <UsersTab />}
      </main>
    </div>
  );
}
