import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPhoneNumbers,
  getAgentConfigs,
  provisionPhoneNumber,
  verifyPhoneNumber,
  deletePhoneNumber,
  reassignPhoneAgent,
  verifyForwarding,
  createCheckoutSession,
  type PhoneNumber,
  type AgentConfig,
} from '../lib/api.js';
import { SkeletonCard, EmptyState, Card, Button, StatusBadge, PageHeader } from '../components/ui.js';
import { ForwardingHint } from './ForwardingHint.js';
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
  const [showAgentChange, setShowAgentChange] = useState(false);
  const [changingAgent, setChangingAgent] = useState(false);

  // Find the agent connected to THIS number (by agent_id matching retellAgentId)
  const connectedAgent = (num as PhoneNumber & { agent_id?: string }).agent_id;
  const agentName = (connectedAgent
    ? agents.find(a => a.retellAgentId === connectedAgent)?.name
    : agents.find(a => a.retellAgentId)?.name
  ) ?? 'Agent';

  async function handleChangeAgent(newAgentTenantId: string) {
    setChangingAgent(true);
    try {
      const agent = agents.find(a => a.tenantId === newAgentTenantId);
      const retellAgentId = agent?.retellAgentId;
      if (retellAgentId) {
        await reassignPhoneAgent(num.id, newAgentTenantId);
      }
      setShowAgentChange(false);
      onRefresh();
    } catch { /* ignore */ }
    finally { setChangingAgent(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try { await onDelete(num.id); } finally { setDeleting(false); setConfirmDelete(false); }
  }

  // Normalize German number: 0176... → +49176...
  function normalizeNumber(n: string): string {
    const cleaned = n.replace(/[\s\-()]/g, '');
    if (cleaned.startsWith('0') && !cleaned.startsWith('00')) return '+49' + cleaned.slice(1);
    if (cleaned.startsWith('00')) return '+' + cleaned.slice(2);
    return cleaned;
  }

  const normalizedTestNumber = normalizeNumber(testNumber);

  async function handleVerifyForwarding() {
    if (!testNumber.trim()) return;
    setVerifying(true); setVerifyResult(null);
    try {
      await verifyForwarding(normalizedTestNumber, num.id);
      setVerifyResult('success');
      onRefresh();
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
              <button onClick={() => agents.length > 1 && setShowAgentChange(!showAgentChange)}
                className={`text-xs flex items-center gap-1 ${agents.length > 1 ? 'text-white/40 hover:text-orange-400 cursor-pointer' : 'text-white/40'}`}>
                <IconAgent size={12} className="text-white/30" />
                {agentName}
                {agents.length > 1 && <span className="text-[10px] text-white/20">✎</span>}
              </button>
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

      {/* Agent Change */}
      {showAgentChange && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
          <p className="text-xs text-white/40">Agent wechseln:</p>
          {agents.filter(a => a.retellAgentId && a.retellAgentId !== connectedAgent).map(a => (
            <button key={a.tenantId} onClick={() => handleChangeAgent(a.tenantId)} disabled={changingAgent}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-left text-sm text-white/70 disabled:opacity-50">
              <IconAgent size={14} className="text-orange-400" />
              {a.name || 'Agent'}
            </button>
          ))}
          <button onClick={() => setShowAgentChange(false)} className="text-xs text-white/30 hover:text-white/50">Abbrechen</button>
        </div>
      )}

      {/* Forwarding Button */}
      {!confirmDelete && !showForwarding && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2">
          <button onClick={() => setShowForwarding(true)} data-forwarding-trigger
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

      {/* Forwarding Flow — Step 1: Enter customer number */}
      {showForwarding && forwardStep === 1 && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-white">Rufumleitung einrichten</p>
            <ForwardingHint />
          </div>
          <p className="text-xs text-white/40">Von welcher Nummer sollen Anrufe an deinen Agent weitergeleitet werden?</p>
          <input type="tel" value={testNumber} onChange={e => setTestNumber(e.target.value)}
            placeholder="Deine Nummer z.B. +49 170 1234567"
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowForwarding(false); setForwardStep(1); setTestNumber(''); }} className="flex-1">Abbrechen</Button>
            <Button variant="primary" onClick={() => setForwardStep(2)} className="flex-1" disabled={!testNumber.trim()}>Weiter</Button>
          </div>
        </div>
      )}

      {/* Forwarding Flow — Step 2: Carrier Codes + Verify */}
      {showForwarding && forwardStep >= 2 && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
          <p className="text-sm font-medium text-white">Carrier-Codes</p>
          <p className="text-xs text-white/40">Öffne die Telefon-App auf deinem Handy (<strong className="text-white/60">{testNumber}</strong>) und rufe einen der folgenden Codes an:</p>

          {/* All codes */}
          <div className="space-y-2">
            <p className="text-[11px] text-white/30 uppercase tracking-wide font-semibold">Aktivieren</p>
            {[
              { label: 'Bei Nichtannahme', code: `**61*${num.number}#`, desc: 'Agent übernimmt wenn du nicht rangehst', recommended: true },
              { label: 'Bei Besetzt', code: `**67*${num.number}#`, desc: 'Agent übernimmt wenn du im Gespräch bist' },
              { label: 'Immer', code: `**21*${num.number}#`, desc: 'Alle Anrufe gehen direkt zum Agent' },
            ].map(c => (
              <div key={c.label} className={`rounded-xl px-4 py-2.5 flex items-center justify-between gap-2 ${c.recommended ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-white/5 border border-white/10'}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-white/60">{c.label}</p>
                    {c.recommended && <span className="text-[9px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full font-semibold">Empfohlen</span>}
                  </div>
                  <p className="text-sm font-mono font-bold text-white">{c.code}</p>
                  <p className="text-[11px] text-white/30">{c.desc}</p>
                </div>
                <CopyButton text={c.code} />
              </div>
            ))}

            <p className="text-[11px] text-white/30 uppercase tracking-wide font-semibold pt-2">Deaktivieren</p>
            <div className="rounded-xl px-4 py-2 flex items-center justify-between gap-2 bg-white/5 border border-white/10">
              <div>
                <p className="text-xs text-white/40">Alle Umleitungen deaktivieren</p>
                <p className="text-sm font-mono text-white/60">##002#</p>
              </div>
              <CopyButton text="##002#" />
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white/40 space-y-0.5">
            <p>1. Öffne die <strong className="text-white/60">Telefon-App</strong></p>
            <p>2. Tippe den gewünschten Code ein oder kopiere ihn</p>
            <p>3. Drücke <strong className="text-white/60">Anrufen</strong> — Bestätigungston abwarten</p>
          </div>

          {/* Verify section */}
          <div className="pt-2 border-t border-white/5 space-y-2">
            <p className="text-xs font-medium text-white/50">Überprüfung</p>

            {verifyResult === null && (
              <Button variant="secondary" className="w-full" loading={verifying} onClick={handleVerifyForwarding}>
                Weiterleitung jetzt testen (wir rufen {testNumber} an)
              </Button>
            )}

            {verifyResult === 'success' && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center flex items-center justify-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-medium text-emerald-400">Rufumleitung funktioniert!</p>
              </div>
            )}

            {verifyResult === 'failed' && (
              <div className="space-y-2">
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
                  <p className="text-sm text-red-400">Weiterleitung nicht erkannt</p>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 text-xs text-amber-300 space-y-0.5">
                  <p className="font-medium">Alternative:</p>
                  <p>• iPhone: Einstellungen → Telefon → Rufumleitung → {num.number}</p>
                  <p>• Android: Telefon → ⋮ → Einstellungen → Anrufweiterleitung → {num.number}</p>
                  <p>• Fritzbox: Telefonie → Rufumleitung → {num.number}</p>
                </div>
                <Button variant="secondary" className="w-full" loading={verifying} onClick={handleVerifyForwarding}>Erneut testen</Button>
              </div>
            )}
          </div>

          <button onClick={() => { setShowForwarding(false); setForwardStep(1); setVerifyResult(null); setTestNumber(''); }}
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

export function PhoneManager({ onNavigate }: { onNavigate?: (page: string) => void } = {}) {
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
      await queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
      setShowAgentSelect(false);
      setNewNumber(res.numberPretty || res.number);
      setShowWelcome(true);
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
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-6 sm:space-y-8">
      <PageHeader
        title="Telefon & Nummern"
        description="Jeder Agent braucht eine eigene Nummer. Du kannst optional deine bestehende Nummer darauf umleiten."
      />

      {provisionError && (
        provisionError.includes('Starter') || provisionError.includes('upgrade') || provisionError.includes('Plan') ? (
          <div className="rounded-2xl p-6 text-center space-y-3" style={{ background: 'rgba(249,115,22,0.05)', backdropFilter: 'blur(24px)', border: '1px solid rgba(249,115,22,0.12)' }}>
            <div className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(6,182,212,0.1))' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="1.75" strokeLinecap="round"><path d="M12 2v4m0 12v4m-8-10H0m24 0h-4m-2.93-6.07l2.83-2.83M4.1 19.9l2.83-2.83M19.9 19.9l-2.83-2.83M4.1 4.1l2.83 2.83"/><circle cx="12" cy="12" r="4"/></svg>
            </div>
            <p className="text-sm font-semibold bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #F97316, #06B6D4)' }}>Eigene Telefonnummer ab 8,99€/Mo</p>
            <p className="text-xs text-white/35">Mit dem Nummer-Plan bekommst du eine eigene Telefonnummer + 70 Freiminuten. Dein Agent nimmt dann echte Anrufe entgegen.</p>
            <p className="text-[11px] text-cyan-400/50 mt-1">Tipp: Ab dem Starter-Plan (79€/Mo) ist eine Nummer bereits gratis inklusive.</p>
            <button onClick={async () => {
              try {
                const res = await createCheckoutSession('nummer', 'month');
                if (res.url) window.location.href = res.url;
              } catch { onNavigate?.('billing'); }
            }}
              className="rounded-lg px-5 py-2.5 text-xs font-semibold text-white transition-all hover:scale-[1.02] cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 4px 20px rgba(249,115,22,0.2)' }}>
              Nummer aktivieren — ab 8,99€/Mo
            </button>
            <button onClick={() => setProvisionError(null)} className="block mx-auto text-[11px] text-white/20 hover:text-white/40 transition-colors cursor-pointer mt-1">
              Schließen
            </button>
          </div>
        ) : (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center justify-between">
            <span>{provisionError}</span>
            <button onClick={() => setProvisionError(null)} className="text-red-400/50 hover:text-red-400 ml-2 cursor-pointer" aria-label="Schließen">✕</button>
          </div>
        )
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
            <Button variant="primary" onClick={() => { setShowWelcome(false); /* Find the newest number and open its forwarding */
              setTimeout(() => { const newest = document.querySelector('[data-forwarding-trigger]') as HTMLButtonElement; newest?.click(); }, 300);
            }} className="flex-1">Rufumleitung einrichten</Button>
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
