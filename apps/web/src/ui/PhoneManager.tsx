import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPhoneNumbers,
  getAgentConfigs,
  provisionPhoneNumber,
  verifyPhoneNumber,
  deletePhoneNumber,
  type PhoneNumber,
  type AgentConfig,
} from '../lib/api.js';
import { SkeletonCard, EmptyState, Card, Button, StatusBadge, PageHeader } from '../components/ui.js';
import { IconPhone, IconAgent } from './PhonbotIcons.js';

/* ── Copy Button ──────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-xs text-white/30 hover:text-orange-400 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
      aria-label="Kopieren"
    >{copied ? '✓ Kopiert' : 'Kopieren'}</button>
  );
}

/* ── Number Card ──────────────────────────────────────── */

function NumberCard({ num, agents, onVerify, onDelete, onRefresh }: {
  num: PhoneNumber; agents: AgentConfig[];
  onVerify: (id: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showForwarding, setShowForwarding] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<'success' | 'failed' | null>(null);
  const [forwardStep, setForwardStep] = useState(1);
  const [testNumber, setTestNumber] = useState('');

  const agentName = agents.find(a => a.retellAgentId)?.name ?? 'Agent';

  async function handleDelete() {
    setDeleting(true);
    try { await onDelete(num.id); } finally { setDeleting(false); setConfirmDelete(false); }
  }

  async function handleVerifyForwarding() {
    if (!testNumber.trim()) return;
    setVerifying(true); setVerifyResult(null);
    try {
      // Call the customer's number — if forwarding works, the agent picks up
      const res = await fetch('/api/phone/verify-forwarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${localStorage.getItem('vas_token')}` },
        body: JSON.stringify({ customerNumber: testNumber, phonbotNumberId: num.id }),
      });
      if (res.ok) {
        setVerifyResult('success');
        onRefresh();
      } else {
        setVerifyResult('failed');
      }
    } catch {
      setVerifyResult('failed');
    } finally { setVerifying(false); }
  }

  return (
    <Card className="space-y-0">
      {/* Main Info */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
            <IconPhone size={22} className="text-orange-400" />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-white tracking-wide">{num.number_pretty ?? num.number}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-white/40 flex items-center gap-1">
                <IconAgent size={12} className="text-white/30" />
                {agentName}
              </span>
              <span className="text-xs text-white/20">·</span>
              {num.verified ? (
                <StatusBadge status="success">Aktiv</StatusBadge>
              ) : (
                <StatusBadge status="info">Bereit</StatusBadge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <CopyButton text={num.number} />
          <button onClick={() => setConfirmDelete(true)}
            className="text-xs text-white/20 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-500/10"
            aria-label="Nummer entfernen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>

      {/* Delete Confirm */}
      {confirmDelete && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
          <p className="text-xs text-red-400">Nummer wirklich entfernen?</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Abbrechen</Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>Entfernen</Button>
          </div>
        </div>
      )}

      {/* Forwarding Button */}
      {!confirmDelete && !showForwarding && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2">
          <button onClick={() => setShowForwarding(true)}
            className="text-xs text-white/40 hover:text-orange-400 transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 014-4h12" />
            </svg>
            Rufumleitung einrichten
          </button>
          <span className="text-[11px] text-white/25">
            — Anrufe auf deine bestehende Nummer an diesen Agent weiterleiten
          </span>
        </div>
      )}

      {/* Forwarding Flow — Step 1: Carrier Codes */}
      {showForwarding && forwardStep === 1 && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
          <p className="text-sm font-medium text-white">Rufumleitung einrichten</p>
          <p className="text-xs text-white/40">Öffne die Telefon-App und rufe einen dieser Codes an:</p>

          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 text-center space-y-1">
            <p className="text-xs text-white/40">Bei Nichtannahme (empfohlen)</p>
            <p className="text-xl font-mono font-bold text-orange-400">**61*{num.number}#</p>
            <CopyButton text={`**61*${num.number}#`} />
          </div>

          <details className="text-xs text-white/30">
            <summary className="cursor-pointer hover:text-white/50">Andere Optionen</summary>
            <div className="mt-2 space-y-1.5 pl-2">
              <div className="flex justify-between"><span>Bei Besetzt:</span><code className="text-white/50">**67*{num.number}#</code></div>
              <div className="flex justify-between"><span>Immer:</span><code className="text-white/50">**21*{num.number}#</code></div>
              <div className="flex justify-between"><span>Deaktivieren:</span><code className="text-white/50">##61# / ##67# / ##21#</code></div>
            </div>
          </details>

          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white/40 space-y-0.5">
            <p>1. Öffne die <strong className="text-white/60">Telefon-App</strong></p>
            <p>2. Tippe den Code ein oder kopiere ihn</p>
            <p>3. Drücke <strong className="text-white/60">Anrufen</strong> — Bestätigungston abwarten</p>
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowForwarding(false); setForwardStep(1); }} className="flex-1">Abbrechen</Button>
            <Button variant="primary" onClick={() => setForwardStep(2)} className="flex-1">Code angerufen — überprüfen</Button>
          </div>
        </div>
      )}

      {/* Forwarding Flow — Step 2: Verify */}
      {showForwarding && forwardStep === 2 && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
          <p className="text-sm font-medium text-white">Überprüfung</p>
          <p className="text-xs text-white/40">Gib deine Nummer ein — wir rufen sie an und prüfen ob die Weiterleitung zum Agent funktioniert.</p>

          {verifyResult === null && (
            <div className="space-y-2">
              <input type="tel" value={testNumber} onChange={e => setTestNumber(e.target.value)}
                placeholder="Deine Nummer z.B. +49 170 1234567"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
              <Button variant="primary" className="w-full" loading={verifying} onClick={handleVerifyForwarding} disabled={!testNumber.trim()}>
                Jetzt anrufen und prüfen
              </Button>
            </div>
          )}

          {verifyResult === 'success' && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center space-y-1">
              <svg className="mx-auto w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-emerald-400">Rufumleitung funktioniert!</p>
            </div>
          )}

          {verifyResult === 'failed' && (
            <div className="space-y-3">
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
                <p className="text-sm font-medium text-red-400">Weiterleitung nicht erkannt</p>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5 text-xs text-amber-300 space-y-1">
                <p className="font-medium">Alternative:</p>
                <p>• <strong>iPhone:</strong> Einstellungen → Telefon → Rufumleitung</p>
                <p>• <strong>Android:</strong> Telefon → ⋮ → Einstellungen → Anrufweiterleitung</p>
                <p>• <strong>Fritzbox:</strong> Telefonie → Rufumleitung</p>
              </div>
              <p className="text-xs text-white/30">Ziel: <code className="text-white/50">{num.number}</code></p>
              <Button variant="secondary" className="w-full" onClick={() => setVerifyResult(null)}>Erneut überprüfen</Button>
            </div>
          )}

          <button onClick={() => { setShowForwarding(false); setForwardStep(1); setVerifyResult(null); }}
            className="text-xs text-white/30 hover:text-white/50 w-full text-center">Schließen</button>
        </div>
      )}
    </Card>
  );
}

/* ── Agent Selector ───────────────────────────────────── */

function AgentSelector({ agents, onSelect, disabled }: { agents: AgentConfig[]; onSelect: (tenantId: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-white">Welcher Agent soll diese Nummer nutzen?</p>
      {agents.map(a => (
        <button key={a.tenantId} onClick={() => !disabled && onSelect(a.tenantId)} disabled={disabled}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:border-orange-500/40 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
            <IconAgent size={18} className="text-orange-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">{a.name || 'Unbenannter Agent'}</p>
            <p className="text-xs text-white/40">{a.businessName || a.tenantId}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Main Component ───────────────────────────────────── */

export function PhoneManager() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['phone-manager'],
    queryFn: async () => {
      const [phones, agentRes] = await Promise.all([getPhoneNumbers(), getAgentConfigs()]);
      return { numbers: phones.items, agents: agentRes.items };
    },
  });

  const numbers = data?.numbers ?? [];
  const agents = data?.agents ?? [];

  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [showAgentSelect, setShowAgentSelect] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [newNumber, setNewNumber] = useState<string | null>(null);

  async function handleProvision(agentTenantId?: string) {
    if (provisioning) return;
    setProvisioning(true); setProvisionError(null);
    try {
      const res = await provisionPhoneNumber(agentTenantId || undefined);
      queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
      setShowAgentSelect(false);
      if (numbers.length === 0) {
        setNewNumber(res.numberPretty || res.number);
        setShowWelcome(true);
      }
    } catch (e: unknown) {
      setProvisionError(e instanceof Error ? e.message : 'Fehler beim Aktivieren');
    } finally { setProvisioning(false); }
  }

  function handleActivateClick() {
    if (agents.length > 1) {
      setShowAgentSelect(true);
    } else {
      handleProvision();
    }
  }

  async function handleDelete(phoneId: string) {
    await deletePhoneNumber(phoneId);
    queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
  }

  async function handleVerify(phoneId: string) {
    await verifyPhoneNumber(phoneId);
    queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
  }

  if (isLoading) return (
    <div className="p-6 max-w-3xl mx-auto space-y-6"><SkeletonCard /><SkeletonCard /></div>
  );

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <PageHeader
        title="Telefon & Nummern"
        description="Jeder Agent braucht eine eigene Nummer. Du kannst optional deine bestehende Nummer darauf umleiten."
      />

      {provisionError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center justify-between">
          <span>{provisionError}</span>
          <button onClick={() => setProvisionError(null)} className="text-red-400/50 hover:text-red-400 ml-2" aria-label="Schließen">✕</button>
        </div>
      )}

      {/* Welcome Popup */}
      {showWelcome && newNumber && (
        <div className="bg-white/5 backdrop-blur-xl border border-orange-500/20 rounded-2xl p-8 space-y-4" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.08), rgba(6,182,212,0.05))' }}>
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-white">Deine Nummer ist aktiv!</h3>
            <p className="text-2xl font-mono font-bold text-orange-400">{newNumber}</p>
            <p className="text-sm text-white/50">Dein Agent ist ab sofort unter dieser Nummer erreichbar.</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
            <p className="text-sm font-medium text-white">Möchtest du deine bestehende Nummer umleiten?</p>
            <p className="text-xs text-white/40">Damit Anrufe auf deine bisherige Nummer bei Besetzt oder Nichtannahme an deinen Agent gehen.</p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowWelcome(false)} className="flex-1">Überspringen</Button>
            <Button variant="primary" onClick={() => setShowWelcome(false)} className="flex-1">Rufumleitung einrichten</Button>
          </div>
        </div>
      )}

      {/* Numbers */}
      {numbers.length === 0 && !showAgentSelect && !showWelcome ? (
        <EmptyState
          icon={<IconPhone size={48} className="text-white/20" />}
          title="Noch keine Nummer"
          description="Aktiviere eine Nummer für deinen Agent. Ab dem Starter-Plan ist eine Nummer inklusive."
          action={
            <Button variant="primary" loading={provisioning} onClick={handleActivateClick}>
              Nummer aktivieren
            </Button>
          }
        />
      ) : !showWelcome && (
        <section className="space-y-3">
          {numbers.map(n => (
            <NumberCard key={n.id} num={n} agents={agents} onVerify={handleVerify} onDelete={handleDelete} onRefresh={refresh} />
          ))}
          {!showAgentSelect && (
            <button onClick={handleActivateClick} disabled={provisioning}
              className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/40 rounded-2xl py-4 text-sm text-white/30 hover:text-orange-400 transition-all disabled:opacity-50">
              {provisioning ? 'Wird aktiviert...' : '+ Weitere Nummer für einen Agent'}
            </button>
          )}
        </section>
      )}

      {/* Agent Selection */}
      {showAgentSelect && (
        <Card padding="lg" className="space-y-4">
          <AgentSelector agents={agents} onSelect={(id) => handleProvision(id)} disabled={provisioning} />
          <button onClick={() => setShowAgentSelect(false)} className="text-xs text-white/30 hover:text-white/50">Abbrechen</button>
        </Card>
      )}

      {/* Info */}
      {numbers.length > 0 && !showWelcome && (
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white/30">
          <strong className="text-white/50">Tipp:</strong> Dein Agent ist sofort über die Nummer erreichbar. Klicke auf "Rufumleitung einrichten" um Anrufe auf deine bestehende Nummer weiterzuleiten. Carrier-Codes funktionieren bei Telekom, Vodafone, O2 und 1&1.
        </div>
      )}
    </div>
  );
}
