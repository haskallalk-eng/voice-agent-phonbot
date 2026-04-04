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

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-xs text-white/30 hover:text-orange-400 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
      aria-label={label ?? 'Kopieren'}
    >
      {copied ? '✓ Kopiert' : 'Kopieren'}
    </button>
  );
}

/* ── Copyable Code Row ────────────────────────────────── */

function CodeRow({ label, code, description, recommended }: { label: string; code: string; description: string; recommended?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 ${recommended ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-white/5 border border-white/10'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-xs font-medium text-white/60">{label}</p>
          {recommended && <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full font-semibold">Empfohlen</span>}
        </div>
        <p className="text-sm font-mono font-bold text-white truncate">{code}</p>
        <p className="text-[11px] text-white/30 mt-0.5">{description}</p>
      </div>
      <CopyButton text={code} label={`${label} kopieren`} />
    </div>
  );
}

/* ── Number Card ──────────────────────────────────────── */

function NumberCard({
  num, agents, onVerify, onDelete,
}: {
  num: PhoneNumber; agents: AgentConfig[];
  onVerify: (id: string) => void; onDelete: (id: string) => void;
}) {
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const agentName = agents.find(a => a.retellAgentId)?.name ?? 'Agent';

  async function handleVerify() {
    setVerifying(true);
    try { await onVerify(num.id); } finally { setVerifying(false); }
  }
  async function handleDelete() {
    setDeleting(true);
    try { await onDelete(num.id); } finally { setDeleting(false); setConfirmDelete(false); }
  }

  return (
    <Card className="space-y-0">
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
              <span className="text-xs text-white/40">
                {num.method === 'forwarding' ? 'Rufumleitung' : 'Direktnummer'}
              </span>
              <span className="text-xs text-white/20">·</span>
              {num.verified ? (
                <StatusBadge status="success">Aktiv</StatusBadge>
              ) : (
                <StatusBadge status="warning">Ausstehend</StatusBadge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!num.verified && (
            <Button variant="primary" loading={verifying} onClick={handleVerify}>Überprüfen</Button>
          )}
          <CopyButton text={num.number} />
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-white/20 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10"
            aria-label="Nummer entfernen"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        </div>
      </div>
      {confirmDelete && (
        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
          <p className="text-xs text-red-400">Nummer wirklich entfernen?</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Abbrechen</Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>Entfernen</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ── Carrier Code Forwarding Tutorial ─────────────────── */

type CarrierCodes = {
  busy: string; noAnswer: string; always: string;
  cancelBusy: string; cancelNoAnswer: string; cancelAlways: string;
};

function ForwardingTutorial({ forwardTo, carrierCodes, onDone }: {
  forwardTo: string; carrierCodes: CarrierCodes; onDone: () => void;
}) {
  const [step, setStep] = useState(1);

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step === s ? 'bg-orange-500 text-white' : step > s ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-white/30'
            }`}>{step > s ? '✓' : s}</div>
            {s < 3 && <div className={`w-8 h-0.5 ${step > s ? 'bg-emerald-500/30' : 'bg-white/10'}`} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <Card padding="lg" className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Schritt 1: Methode wählen</h3>
            <p className="text-sm text-white/50">Wähle wann Anrufe an deinen Agent weitergeleitet werden sollen.</p>
          </div>
          <div className="space-y-2">
            <CodeRow label="Bei Nichtannahme" code={carrierCodes.noAnswer} description="Agent übernimmt wenn du nach 15 Sek. nicht rangehst" recommended />
            <CodeRow label="Bei Besetzt" code={carrierCodes.busy} description="Agent übernimmt wenn du in einem anderen Gespräch bist" />
            <CodeRow label="Immer weiterleiten" code={carrierCodes.always} description="Alle Anrufe gehen direkt zum Agent" />
          </div>
          <Button variant="primary" className="w-full" onClick={() => setStep(2)}>Weiter — Code anrufen</Button>
        </Card>
      )}

      {step === 2 && (
        <Card padding="lg" className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Schritt 2: Code anrufen</h3>
            <p className="text-sm text-white/50">Öffne die Telefon-App auf deinem Handy und rufe den Code an.</p>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-5 text-center space-y-2">
            <p className="text-xs text-white/40">Empfohlen: Bei Nichtannahme</p>
            <p className="text-2xl font-mono font-bold text-orange-400">{carrierCodes.noAnswer}</p>
            <CopyButton text={carrierCodes.noAnswer} label="Code kopieren" />
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white/40 space-y-1">
            <p>1. Öffne die <strong className="text-white/60">Telefon-App</strong></p>
            <p>2. Tippe den Code ein (oder kopiere ihn)</p>
            <p>3. Drücke <strong className="text-white/60">Anrufen</strong></p>
            <p>4. Du hörst einen Bestätigungston — fertig!</p>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(1)} className="flex-1">Zurück</Button>
            <Button variant="primary" onClick={() => setStep(3)} className="flex-1">Code angerufen ✓</Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card padding="lg" className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Schritt 3: Testen</h3>
            <p className="text-sm text-white/50">Rufe deine eigene Nummer von einem anderen Telefon an und lass es klingeln.</p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5 text-center space-y-2">
            <svg className="mx-auto w-12 h-12 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-emerald-400">Weiterleitung eingerichtet!</p>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-300 space-y-1">
            <p><strong>Zum Deaktivieren:</strong></p>
            <div className="flex gap-2 mt-1 flex-wrap">
              <code className="bg-white/5 px-2 py-1 rounded text-amber-400">{carrierCodes.cancelNoAnswer}</code>
              <code className="bg-white/5 px-2 py-1 rounded text-amber-400">{carrierCodes.cancelBusy}</code>
              <code className="bg-white/5 px-2 py-1 rounded text-amber-400">{carrierCodes.cancelAlways}</code>
            </div>
          </div>
          <Button variant="primary" className="w-full" onClick={onDone}>Fertig — Zurück zur Übersicht</Button>
        </Card>
      )}
    </section>
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

  // Provision
  const [provisioning, setProvisioning] = useState(false);
  const [provisionSuccess, setProvisionSuccess] = useState<string | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  // Forwarding
  const [showForward, setShowForward] = useState(false);
  const [forwardNumber, setForwardNumber] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const [forwardResult, setForwardResult] = useState<{ forwardTo: string; carrierCodes: CarrierCodes } | null>(null);
  const [forwardError, setForwardError] = useState<string | null>(null);

  async function handleProvision() {
    setProvisioning(true); setProvisionError(null);
    try {
      const res = await provisionPhoneNumber('');
      setProvisionSuccess(res.numberPretty || res.number);
      queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
    } catch (e: unknown) {
      setProvisionError(e instanceof Error ? e.message : 'Fehler beim Aktivieren');
    } finally { setProvisioning(false); }
  }

  async function handleForward() {
    setForwarding(true); setForwardError(null);
    try {
      const res = await setupForwarding(forwardNumber) as { forwardTo: string; carrierCodes: CarrierCodes };
      setForwardResult(res);
      queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
    } catch (e: unknown) {
      setForwardError(e instanceof Error ? e.message : 'Fehler bei Weiterleitung');
    } finally { setForwarding(false); }
  }

  async function handleDelete(phoneId: string) {
    await deletePhoneNumber(phoneId);
    queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
  }

  async function handleVerify(phoneId: string) {
    await verifyPhoneNumber(phoneId);
    queryClient.invalidateQueries({ queryKey: ['phone-manager'] });
  }

  if (isLoading) return (
    <div className="p-6 max-w-3xl mx-auto space-y-6"><SkeletonCard /><SkeletonCard /></div>
  );

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <PageHeader
        title="Telefon & Nummern"
        description="Verbinde eine Telefonnummer mit deinem Agent — per Direktnummer oder Rufumleitung deiner bestehenden Nummer."
      />

      {/* Success */}
      {provisionSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-sm text-emerald-400 flex items-center justify-between">
          <span>Neue Nummer aktiviert: <strong>{provisionSuccess}</strong></span>
          <button onClick={() => setProvisionSuccess(null)} className="text-emerald-400/50 hover:text-emerald-400 ml-2" aria-label="Schließen">✕</button>
        </div>
      )}

      {/* Error */}
      {provisionError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center justify-between">
          <span>{provisionError}</span>
          <button onClick={() => setProvisionError(null)} className="text-red-400/50 hover:text-red-400 ml-2" aria-label="Schließen">✕</button>
        </div>
      )}

      {/* ── Active Numbers ── */}
      {!forwardResult && (
        <section>
          <h3 className="text-lg font-semibold text-white mb-4">
            {numbers.length > 0 ? `Aktive Nummern (${numbers.length})` : 'Aktive Nummern'}
          </h3>

          {numbers.length === 0 ? (
            <EmptyState
              icon={<IconPhone size={48} className="text-white/20" />}
              title="Noch keine Nummer verbunden"
              description="Aktiviere eine Nummer für deinen Agent. Anschließend kannst du optional eine Rufumleitung von deiner bestehenden Nummer einrichten."
              action={
                <Button variant="primary" loading={provisioning} onClick={handleProvision}>
                  Nummer aktivieren
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {numbers.map(n => (
                <NumberCard key={n.id} num={n} agents={agents} onVerify={handleVerify} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Actions ── */}
      {!forwardResult && numbers.length > 0 && !showForward && (
        <div className="grid grid-cols-2 gap-3">
          <button onClick={handleProvision} disabled={provisioning}
            className="border-2 border-dashed border-white/10 hover:border-orange-500/40 rounded-2xl py-4 text-sm text-white/30 hover:text-orange-400 transition-all disabled:opacity-50">
            {provisioning ? 'Wird aktiviert...' : '+ Weitere Nummer'}
          </button>
          <button onClick={() => setShowForward(true)}
            className="border-2 border-dashed border-white/10 hover:border-cyan-500/40 rounded-2xl py-4 text-sm text-white/30 hover:text-cyan-400 transition-all">
            + Rufumleitung einrichten
          </button>
        </div>
      )}

      {/* ── Forwarding Setup ── */}
      {!forwardResult && showForward && (
        <Card padding="lg" className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-white mb-1">Rufumleitung einrichten</h3>
            <p className="text-xs text-white/40">Leite Anrufe von deiner bestehenden Nummer bei Besetzt oder Nichtannahme an deinen Agent weiter.</p>
          </div>
          <div>
            <label className="block text-xs text-white/40 mb-1">Deine bestehende Telefonnummer</label>
            <input type="tel" value={forwardNumber} onChange={e => setForwardNumber(e.target.value)}
              placeholder="+49 170 1234567"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />
          </div>
          {forwardError && <p className="text-xs text-red-400">{forwardError}</p>}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setShowForward(false)} className="flex-1">Abbrechen</Button>
            <Button variant="primary" loading={forwarding} onClick={handleForward} className="flex-1" disabled={!forwardNumber.trim()}>
              Weiter — Anleitung
            </Button>
          </div>
        </Card>
      )}

      {/* ── Forwarding Tutorial ── */}
      {forwardResult && (
        <ForwardingTutorial
          forwardTo={forwardResult.forwardTo}
          carrierCodes={forwardResult.carrierCodes}
          onDone={() => { setForwardResult(null); setForwardNumber(''); setShowForward(false); }}
        />
      )}
    </div>
  );
}
