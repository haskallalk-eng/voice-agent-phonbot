import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPhoneNumbers,
  getAgentConfigs,
  setupForwarding,
  provisionPhoneNumber,
  verifyPhoneNumber,
  type PhoneNumber,
  type AgentConfig,
} from '../lib/api.js';
import { SkeletonCard, EmptyState, Card, Button, StatusBadge, PageHeader, Spinner } from '../components/ui.js';
import { IconPhone, IconAgent } from './PhonbotIcons.js';

/* ── Helpers ──────────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-xs text-white/30 hover:text-orange-400 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
      aria-label="Nummer kopieren"
    >
      {copied ? '✓ Kopiert' : 'Kopieren'}
    </button>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      {description && <p className="text-sm text-white/50 mt-0.5">{description}</p>}
    </div>
  );
}

/* ── Device Tutorial Card ─────────────────────────────── */

const DEVICE_ICONS: Record<string, string> = {
  iphone: '📱',
  android: '📱',
  fritzbox: '🖥️',
};
const DEVICE_LABELS: Record<string, string> = {
  iphone: 'iPhone',
  android: 'Android',
  fritzbox: 'Fritzbox / Festnetz',
};

function DeviceTutorial({ device, instruction, forwardTo }: { device: string; instruction: string; forwardTo: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{DEVICE_ICONS[device] ?? '📞'}</span>
          <span className="font-medium text-white">{DEVICE_LABELS[device] ?? device}</span>
        </div>
        <svg className={`w-4 h-4 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3 border-t border-white/5 pt-4">
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/40 mb-0.5">Weiterleiten an:</p>
              <p className="text-sm font-mono font-bold text-orange-400">{forwardTo}</p>
            </div>
            <CopyButton text={forwardTo} />
          </div>
          <div className="text-sm text-white/60 leading-relaxed whitespace-pre-line">{instruction}</div>
        </div>
      )}
    </div>
  );
}

/* ── Number Card ──────────────────────────────────────── */

function NumberCard({
  num,
  agents,
  onVerify,
}: {
  num: PhoneNumber;
  agents: AgentConfig[];
  onVerify: (id: string) => void;
}) {
  const [verifying, setVerifying] = useState(false);
  const agentName = agents.find(a => a.retellAgentId)?.name ?? 'Agent';

  async function handleVerify() {
    setVerifying(true);
    try { await onVerify(num.id); } finally { setVerifying(false); }
  }

  return (
    <Card className="flex items-center justify-between gap-4">
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
            <span className="text-xs text-white/40">
              {num.method === 'forwarding' ? 'Rufumleitung' : 'Direktnummer'}
            </span>
            <span className="text-xs text-white/20">·</span>
            {num.verified ? (
              <StatusBadge status="success">Verifiziert</StatusBadge>
            ) : (
              <StatusBadge status="warning">Ausstehend</StatusBadge>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!num.verified && (
          <Button variant="primary" loading={verifying} onClick={handleVerify}>
            Überprüfen
          </Button>
        )}
        <CopyButton text={num.number} />
      </div>
    </Card>
  );
}

/* ── Main Component ───────────────────────────────────── */

export function PhoneManager() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['phone-manager'],
    queryFn: async () => {
      const [phones, agentRes] = await Promise.all([
        getPhoneNumbers(),
        getAgentConfigs(),
      ]);
      return { numbers: phones.items, agents: agentRes.items };
    },
  });

  const numbers = data?.numbers ?? [];
  const agents = data?.agents ?? [];

  // Provision form
  const [showProvision, setShowProvision] = useState(false);
  const [areaCode, setAreaCode] = useState('030');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionSuccess, setProvisionSuccess] = useState<string | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  // Forwarding form
  const [showForward, setShowForward] = useState(false);
  const [forwardNumber, setForwardNumber] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const [forwardResult, setForwardResult] = useState<{ forwardTo: string; instructions: Record<string, string> } | null>(null);
  const [forwardError, setForwardError] = useState<string | null>(null);

  async function handleProvision() {
    setProvisioning(true);
    setProvisionError(null);
    try {
      const res = await provisionPhoneNumber(areaCode);
      setProvisionSuccess(res.numberPretty || res.number);
      setShowProvision(false);
      queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
    } catch (e: unknown) {
      setProvisionError(e instanceof Error ? e.message : 'Fehler beim Aktivieren');
    } finally {
      setProvisioning(false);
    }
  }

  async function handleForward() {
    setForwarding(true);
    setForwardError(null);
    try {
      const res = await setupForwarding(forwardNumber);
      setForwardResult(res);
      queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
    } catch (e: unknown) {
      setForwardError(e instanceof Error ? e.message : 'Fehler bei Weiterleitung');
    } finally {
      setForwarding(false);
    }
  }

  async function handleVerify(phoneId: string) {
    await verifyPhoneNumber(phoneId);
    queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <PageHeader
        title="Telefon & Nummern"
        description="Verbinde eine Telefonnummer mit deinem Agent — per Direktnummer oder Rufumleitung."
      />

      {/* ── Success Messages ── */}
      {provisionSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-sm text-emerald-400 flex items-center justify-between">
          <span>Neue Nummer aktiviert: <strong>{provisionSuccess}</strong></span>
          <button onClick={() => setProvisionSuccess(null)} className="text-emerald-400/50 hover:text-emerald-400 ml-2" aria-label="Schließen">✕</button>
        </div>
      )}

      {/* ── Section 1: Active Numbers ── */}
      <section>
        <SectionHeader
          title="Aktive Nummern"
          description={numbers.length > 0 ? `${numbers.length} Nummer${numbers.length > 1 ? 'n' : ''} verbunden` : undefined}
        />

        {numbers.length === 0 ? (
          <EmptyState
            icon={<IconPhone size={48} className="text-white/20" />}
            title="Noch keine Nummer verbunden"
            description="Aktiviere eine neue Nummer oder richte eine Rufumleitung ein, damit dein Agent Anrufe entgegennehmen kann."
            action={
              <div className="flex gap-3">
                <Button variant="primary" onClick={() => setShowProvision(true)}>Neue Nummer</Button>
                <Button variant="secondary" onClick={() => setShowForward(true)}>Rufumleitung</Button>
              </div>
            }
          />
        ) : (
          <div className="space-y-3">
            {numbers.map(n => (
              <NumberCard key={n.id} num={n} agents={agents} onVerify={handleVerify} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Get a Number ── */}
      {numbers.length > 0 && !showProvision && !showForward && !forwardResult && (
        <button
          onClick={() => setShowProvision(true)}
          className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/40 rounded-2xl py-4 text-sm text-white/30 hover:text-orange-400 transition-all"
        >
          + Weitere Nummer hinzufügen
        </button>
      )}

      {(showProvision || showForward || numbers.length === 0) && !forwardResult && (
        <section>
          <SectionHeader title="Nummer verbinden" description="Wähle wie du eine Nummer mit deinem Agent verbinden möchtest." />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Option A: Neue Nummer */}
            <Card className={`space-y-4 cursor-pointer transition-all ${showProvision ? 'ring-2 ring-orange-500/50' : 'hover:border-white/20'}`}
              padding={showProvision ? 'lg' : 'md'}
            >
              <div onClick={() => { setShowProvision(true); setShowForward(false); }}>
                <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center mb-3">
                  <IconPhone size={20} className="text-orange-400" />
                </div>
                <h4 className="font-semibold text-white mb-1">Neue Nummer erhalten</h4>
                <p className="text-xs text-white/40">Deutsche Nummer erhalten und direkt mit deinem Agent verbinden.</p>
              </div>

              {showProvision && (
                <div className="space-y-3 pt-2 border-t border-white/5">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Vorwahl</label>
                    <input
                      type="text"
                      value={areaCode}
                      onChange={e => setAreaCode(e.target.value)}
                      placeholder="030"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                    />
                  </div>
                  {provisionError && <p className="text-xs text-red-400">{provisionError}</p>}
                  <Button variant="primary" loading={provisioning} onClick={handleProvision} className="w-full">
                    Nummer aktivieren
                  </Button>
                </div>
              )}
            </Card>

            {/* Option B: Rufumleitung */}
            <Card className={`space-y-4 cursor-pointer transition-all ${showForward ? 'ring-2 ring-orange-500/50' : 'hover:border-white/20'}`}
              padding={showForward ? 'lg' : 'md'}
            >
              <div onClick={() => { setShowForward(true); setShowProvision(false); }}>
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center mb-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-cyan-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 014-4h12" />
                  </svg>
                </div>
                <h4 className="font-semibold text-white mb-1">Eigene Nummer weiterleiten</h4>
                <p className="text-xs text-white/40">Behalte deine Nummer — leite Anrufe bei Besetzt an deinen Agent weiter.</p>
              </div>

              {showForward && (
                <div className="space-y-3 pt-2 border-t border-white/5">
                  <div>
                    <label className="block text-xs text-white/40 mb-1">Deine Telefonnummer</label>
                    <input
                      type="tel"
                      value={forwardNumber}
                      onChange={e => setForwardNumber(e.target.value)}
                      placeholder="+49 30 12345678"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                    />
                  </div>
                  {forwardError && <p className="text-xs text-red-400">{forwardError}</p>}
                  <Button variant="primary" loading={forwarding} onClick={handleForward} className="w-full" disabled={!forwardNumber.trim()}>
                    Weiterleitung einrichten
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </section>
      )}

      {/* ── Section 3: Forwarding Tutorial ── */}
      {forwardResult && (
        <section className="space-y-4">
          <SectionHeader
            title="Rufumleitung einrichten"
            description="Folge der Anleitung für dein Gerät. Leite Anrufe bei Besetzt oder Nichtannahme weiter."
          />

          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/40 mb-1">Leite Anrufe weiter an:</p>
              <p className="text-xl font-mono font-bold text-emerald-400">{forwardResult.forwardTo}</p>
            </div>
            <CopyButton text={forwardResult.forwardTo} />
          </div>

          <div className="space-y-2">
            {Object.entries(forwardResult.instructions).map(([device, instruction]) => (
              <DeviceTutorial
                key={device}
                device={device}
                instruction={instruction}
                forwardTo={forwardResult.forwardTo}
              />
            ))}
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-sm text-amber-300">
            <strong>Tipp:</strong> Wähle „Bei Besetzt" oder „Bei Nichtannahme" — so bleibt deine Nummer erreichbar und der Agent springt nur ein wenn du nicht abnimmst.
          </div>

          <Button
            variant="primary"
            className="w-full"
            onClick={() => { setForwardResult(null); setForwardNumber(''); setShowForward(false); }}
          >
            Fertig — Zurück zur Übersicht
          </Button>
        </section>
      )}
    </div>
  );
}
