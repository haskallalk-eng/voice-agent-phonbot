import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPhoneNumbers,
  getAgentConfigs,
  setupForwarding,
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
    >
      {copied ? '✓ Kopiert' : 'Kopieren'}
    </button>
  );
}

/* ── Number Card (the main UI per number) ─────────────── */

function NumberCard({
  num, agents, onVerify, onDelete, onRefresh,
}: {
  num: PhoneNumber; agents: AgentConfig[];
  onVerify: (id: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showForwarding, setShowForwarding] = useState(false);
  const [forwardNumber, setForwardNumber] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const [forwardResult, setForwardResult] = useState<{ forwardTo: string; carrierCodes: { noAnswer: string; busy: string; always: string } } | null>(null);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<'success' | 'failed' | null>(null);
  const [forwardStep, setForwardStep] = useState(1);

  const agentName = agents.find(a => a.retellAgentId)?.name ?? 'Agent';

  async function handleDelete() {
    setDeleting(true);
    try { await onDelete(num.id); } finally { setDeleting(false); setConfirmDelete(false); }
  }

  async function handleForward() {
    setForwarding(true); setForwardError(null);
    try {
      const res = await setupForwarding(forwardNumber) as { forwardTo: string; carrierCodes: { noAnswer: string; busy: string; always: string } };
      setForwardResult(res);
      setForwardStep(2);
    } catch (e: unknown) {
      setForwardError(e instanceof Error ? e.message : 'Fehler');
    } finally { setForwarding(false); }
  }

  async function handleVerifyForwarding() {
    setVerifying(true); setVerifyResult(null);
    try {
      await onVerify(num.id);
      setVerifyResult('success');
      onRefresh();
    } catch {
      setVerifyResult('failed');
    } finally { setVerifying(false); }
  }

  return (
    <Card className="space-y-0">
      {/* ── Main Info ── */}
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
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-white/20 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-500/10"
            aria-label="Nummer entfernen"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>

      {/* ── Delete Confirm ── */}
      {confirmDelete && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
          <p className="text-xs text-red-400">Nummer wirklich entfernen?</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Abbrechen</Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>Entfernen</Button>
          </div>
        </div>
      )}

      {/* ── Actions Row ── */}
      {!confirmDelete && !showForwarding && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2">
          <button
            onClick={() => setShowForwarding(true)}
            className="text-xs text-white/40 hover:text-orange-400 transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 014-4h12" />
            </svg>
            Rufumleitung einrichten
          </button>
          <span className="text-xs text-white/15">·</span>
          <span className="text-[11px] text-white/25">
            Damit Anrufe auf deine bestehende Nummer an diesen Agent weitergeleitet werden.
          </span>
        </div>
      )}

      {/* ── Forwarding Flow ── */}
      {showForwarding && !forwardResult && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
          <div>
            <p className="text-sm font-medium text-white mb-1">Rufumleitung einrichten</p>
            <p className="text-xs text-white/40">Gib deine bestehende Nummer ein. Wir zeigen dir den Code zum Anrufen.</p>
          </div>
          <div className="flex gap-2">
            <input type="tel" value={forwardNumber} onChange={e => setForwardNumber(e.target.value)}
              placeholder="+49 170 1234567"
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />
            <Button variant="primary" loading={forwarding} onClick={handleForward} disabled={!forwardNumber.trim()}>
              Weiter
            </Button>
          </div>
          {forwardError && <p className="text-xs text-red-400">{forwardError}</p>}
          <button onClick={() => setShowForwarding(false)} className="text-xs text-white/30 hover:text-white/50">Abbrechen</button>
        </div>
      )}

      {/* ── Carrier Codes + Verify ── */}
      {forwardResult && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
          {forwardStep === 2 && (
            <>
              <p className="text-sm font-medium text-white">Rufe diesen Code an:</p>
              <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 text-center space-y-1">
                <p className="text-xs text-white/40">Bei Nichtannahme (empfohlen)</p>
                <p className="text-xl font-mono font-bold text-orange-400">{forwardResult.carrierCodes.noAnswer}</p>
                <CopyButton text={forwardResult.carrierCodes.noAnswer} />
              </div>
              <details className="text-xs text-white/30">
                <summary className="cursor-pointer hover:text-white/50">Andere Optionen</summary>
                <div className="mt-2 space-y-1.5 pl-2">
                  <div className="flex justify-between"><span>Bei Besetzt:</span><code className="text-white/50">{forwardResult.carrierCodes.busy}</code></div>
                  <div className="flex justify-between"><span>Immer:</span><code className="text-white/50">{forwardResult.carrierCodes.always}</code></div>
                  <div className="flex justify-between"><span>Deaktivieren:</span><code className="text-white/50">##61# / ##67# / ##21#</code></div>
                </div>
              </details>
              <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white/40 space-y-0.5">
                <p>1. Öffne die <strong className="text-white/60">Telefon-App</strong></p>
                <p>2. Tippe den Code ein oder kopiere ihn</p>
                <p>3. Drücke <strong className="text-white/60">Anrufen</strong> — Bestätigungston abwarten</p>
              </div>
              <Button variant="primary" className="w-full" onClick={() => setForwardStep(3)}>
                Code angerufen — jetzt überprüfen
              </Button>
            </>
          )}

          {forwardStep === 3 && (
            <>
              <p className="text-sm font-medium text-white">Überprüfung</p>
              <p className="text-xs text-white/40">Wir rufen deine Nummer an und prüfen ob die Weiterleitung funktioniert.</p>

              {verifyResult === null && (
                <Button variant="primary" className="w-full" loading={verifying} onClick={handleVerifyForwarding}>
                  Jetzt überprüfen
                </Button>
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
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center space-y-1">
                    <p className="text-sm font-medium text-red-400">Weiterleitung nicht erkannt</p>
                    <p className="text-xs text-white/40">Der Carrier-Code hat möglicherweise nicht funktioniert.</p>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5 text-xs text-amber-300 space-y-1">
                    <p className="font-medium">Alternative Möglichkeiten:</p>
                    <p>• <strong>iPhone:</strong> Einstellungen → Telefon → Rufumleitung</p>
                    <p>• <strong>Android:</strong> Telefon App → ⋮ → Einstellungen → Anrufweiterleitung</p>
                    <p>• <strong>Fritzbox:</strong> Telefonie → Rufumleitung → Neue Rufumleitung</p>
                    <p>• <strong>Telekom/Vodafone/O2:</strong> Kundenportal → Rufumleitung</p>
                  </div>
                  <p className="text-xs text-white/30">Ziel-Nummer: <code className="text-white/50">{forwardResult.forwardTo}</code> <CopyButton text={forwardResult.forwardTo} /></p>
                  <Button variant="secondary" className="w-full" onClick={() => { setVerifyResult(null); }}>
                    Erneut überprüfen
                  </Button>
                </div>
              )}

              {(verifyResult === 'success' || verifyResult === 'failed') && (
                <button
                  onClick={() => { setShowForwarding(false); setForwardResult(null); setForwardStep(1); setVerifyResult(null); setForwardNumber(''); }}
                  className="text-xs text-white/30 hover:text-white/50 w-full text-center"
                >
                  Schließen
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Agent Selector (when multiple agents) ────────────── */

function AgentSelector({ agents, onSelect }: { agents: AgentConfig[]; onSelect: (tenantId: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-white">Welcher Agent soll diese Nummer nutzen?</p>
      {agents.map(a => (
        <button
          key={a.tenantId}
          onClick={() => onSelect(a.tenantId)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:border-orange-500/40 hover:bg-white/8 transition-all text-left"
        >
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

  async function handleProvision(agentTenantId?: string) {
    setProvisioning(true); setProvisionError(null);
    try {
      await provisionPhoneNumber(agentTenantId ?? '');
      queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
      setShowAgentSelect(false);
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

      {/* Error */}
      {provisionError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center justify-between">
          <span>{provisionError}</span>
          <button onClick={() => setProvisionError(null)} className="text-red-400/50 hover:text-red-400 ml-2" aria-label="Schließen">✕</button>
        </div>
      )}

      {/* ── Numbers ── */}
      {numbers.length === 0 && !showAgentSelect ? (
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
      ) : (
        <section className="space-y-3">
          {numbers.map(n => (
            <NumberCard key={n.id} num={n} agents={agents} onVerify={handleVerify} onDelete={handleDelete} onRefresh={refresh} />
          ))}

          {/* Add more */}
          {!showAgentSelect && (
            <button
              onClick={handleActivateClick}
              disabled={provisioning}
              className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/40 rounded-2xl py-4 text-sm text-white/30 hover:text-orange-400 transition-all disabled:opacity-50"
            >
              {provisioning ? 'Wird aktiviert...' : '+ Weitere Nummer für einen Agent'}
            </button>
          )}
        </section>
      )}

      {/* ── Agent Selection ── */}
      {showAgentSelect && (
        <Card padding="lg" className="space-y-4">
          <AgentSelector agents={agents} onSelect={(id) => handleProvision(id)} />
          <button onClick={() => setShowAgentSelect(false)} className="text-xs text-white/30 hover:text-white/50">Abbrechen</button>
        </Card>
      )}

      {/* ── Info Box ── */}
      {numbers.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white/30 space-y-1">
          <p><strong className="text-white/50">Tipp:</strong> Dein Agent ist sofort über die Nummer erreichbar. Du kannst optional eine Rufumleitung einrichten, damit Anrufe auf deine bestehende Nummer bei Besetzt oder Nichtannahme an den Agent weitergeleitet werden.</p>
          <p>Carrier-Codes funktionieren bei Telekom, Vodafone, O2 und 1&1. Bei VoIP-Anlagen nutze die Einstellungen deines Anbieters.</p>
        </div>
      )}
    </div>
  );
}
