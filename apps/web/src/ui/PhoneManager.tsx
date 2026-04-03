import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPhoneNumbers,
  getAgentConfigs,
  setupForwarding,
  verifyPhoneNumber,
  deletePhoneNumber,
  submitPhoneBundle,
  getPhoneBundleStatus,
  uploadPhoneDocument,
  type PhoneNumber,
  type AgentConfig,
} from '../lib/api.js';
import { SkeletonCard, EmptyState, Card, Button, StatusBadge, PageHeader, Spinner } from '../components/ui.js';
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
                <StatusBadge status="success">Verifiziert</StatusBadge>
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

/* ── Carrier Code Forwarding Section ──────────────────── */

type CarrierCodes = {
  busy: string; noAnswer: string; always: string;
  cancelBusy: string; cancelNoAnswer: string; cancelAlways: string;
};

function ForwardingTutorial({ forwardTo, carrierCodes, onDone }: {
  forwardTo: string;
  carrierCodes: CarrierCodes;
  onDone: () => void;
}) {
  const [step, setStep] = useState(1);

  return (
    <section className="space-y-5">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step === s ? 'bg-orange-500 text-white' : step > s ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-white/30'
            }`}>
              {step > s ? '✓' : s}
            </div>
            {s < 3 && <div className={`w-8 h-0.5 ${step > s ? 'bg-emerald-500/30' : 'bg-white/10'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Choose method */}
      {step === 1 && (
        <Card padding="lg" className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Schritt 1: Methode wählen</h3>
            <p className="text-sm text-white/50">Wähle wann Anrufe an deinen Agent weitergeleitet werden sollen.</p>
          </div>

          <div className="space-y-2">
            <CodeRow
              label="Bei Nichtannahme"
              code={carrierCodes.noAnswer}
              description="Agent übernimmt wenn du nach 15 Sek. nicht rangehst"
              recommended
            />
            <CodeRow
              label="Bei Besetzt"
              code={carrierCodes.busy}
              description="Agent übernimmt wenn du in einem anderen Gespräch bist"
            />
            <CodeRow
              label="Immer weiterleiten"
              code={carrierCodes.always}
              description="Alle Anrufe gehen direkt zum Agent"
            />
          </div>

          <Button variant="primary" className="w-full" onClick={() => setStep(2)}>
            Weiter — Code anrufen
          </Button>
        </Card>
      )}

      {/* Step 2: Dial the code */}
      {step === 2 && (
        <Card padding="lg" className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Schritt 2: Code anrufen</h3>
            <p className="text-sm text-white/50">Öffne die Telefon-App auf deinem Handy und rufe einen der Codes an. Du hörst einen Bestätigungston.</p>
          </div>

          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-5 text-center space-y-2">
            <p className="text-xs text-white/40">Empfohlen: Bei Nichtannahme</p>
            <p className="text-2xl font-mono font-bold text-orange-400">{carrierCodes.noAnswer}</p>
            <CopyButton text={carrierCodes.noAnswer} label="Code kopieren" />
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white/40 space-y-1">
            <p>1. Öffne die <strong className="text-white/60">Telefon-App</strong> auf deinem Handy</p>
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

      {/* Step 3: Verify */}
      {step === 3 && (
        <Card padding="lg" className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Schritt 3: Testen</h3>
            <p className="text-sm text-white/50">Rufe jetzt deine eigene Nummer von einem anderen Telefon an und lass es klingeln. Dein Agent sollte abnehmen.</p>
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5 text-center space-y-2">
            <svg className="mx-auto w-12 h-12 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-emerald-400">Weiterleitung eingerichtet!</p>
            <p className="text-xs text-white/40">Teste es, indem du deine Nummer von einem anderen Telefon anrufst.</p>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-300 space-y-1">
            <p><strong>Zum Deaktivieren:</strong> Einfach diesen Code anrufen:</p>
            <div className="flex gap-2 mt-1">
              <code className="bg-white/5 px-2 py-1 rounded text-amber-400">{carrierCodes.cancelNoAnswer}</code>
              <code className="bg-white/5 px-2 py-1 rounded text-amber-400">{carrierCodes.cancelBusy}</code>
              <code className="bg-white/5 px-2 py-1 rounded text-amber-400">{carrierCodes.cancelAlways}</code>
            </div>
          </div>

          <Button variant="primary" className="w-full" onClick={onDone}>
            Fertig — Zurück zur Übersicht
          </Button>
        </Card>
      )}
    </section>
  );
}

/* ── Compliance Status Banner ─────────────────────────── */

function ComplianceBanner({ status, onRequestNumber }: {
  status: string;
  onRequestNumber: () => void;
}) {
  if (status === 'none') {
    return (
      <Card className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
            <IconPhone size={20} className="text-orange-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Noch keine Telefonnummer</p>
            <p className="text-xs text-white/40">Registriere dein Gewerbe, um eine deutsche Nummer zu erhalten.</p>
          </div>
        </div>
        <Button variant="primary" onClick={onRequestNumber}>Nummer beantragen</Button>
      </Card>
    );
  }

  if (status === 'pending-review' || status === 'in-review') {
    return (
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl px-6 py-4 flex items-center gap-4">
        <Spinner size="sm" />
        <div>
          <p className="text-sm font-semibold text-amber-400">Deine Unterlagen werden geprüft</p>
          <p className="text-xs text-white/40">Dies dauert in der Regel 1-3 Werktage. Du wirst benachrichtigt, sobald deine Nummer aktiv ist.</p>
        </div>
      </div>
    );
  }

  if (status === 'twilio-approved') {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-6 py-4 flex items-center gap-4">
        <svg className="w-6 h-6 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-emerald-400">Verifiziert! Deine Nummer ist aktiv.</p>
          <p className="text-xs text-white/40">Dein Gewerbe wurde erfolgreich verifiziert. Deine Telefonnummer ist bereit.</p>
        </div>
      </div>
    );
  }

  if (status === 'twilio-rejected') {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-6 py-4 flex items-center gap-4">
        <svg className="w-6 h-6 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-red-400">Unterlagen abgelehnt</p>
          <p className="text-xs text-white/40">Deine Unterlagen wurden leider abgelehnt. Bitte reiche sie erneut ein.</p>
        </div>
      </div>
    );
  }

  return null;
}

/* ── Business Registration Form ───────────────────────── */

type BusinessFormData = {
  companyName: string;
  contactPerson: string;
  email: string;
  website: string;
  registrationNumber: string; // HRB, USt-ID, or Steuernummer
  street: string;
  postalCode: string;
  city: string;
};

const emptyFormData: BusinessFormData = {
  companyName: '',
  contactPerson: '',
  email: '',
  website: '',
  registrationNumber: '',
  street: '',
  postalCode: '',
  city: '',
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function FormInput({ label, value, onChange, type = 'text', placeholder, required, error }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-white/50 mb-1.5">
        {label}{required && <span className="text-orange-400 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl bg-white/5 border px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-colors ${
          error ? 'border-red-500/50' : 'border-white/10'
        }`}
      />
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function BusinessRegistrationForm({ onSubmitSuccess }: { onSubmitSuccess: () => void }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<BusinessFormData>(emptyFormData);
  const [errors, setErrors] = useState<Partial<Record<keyof BusinessFormData | 'file', string>>>({});
  const [uploadedFile, setUploadedFile] = useState<{ name: string; base64: string; type: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalSteps = 4;

  function updateField(field: keyof BusinessFormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function validateStep1(): boolean {
    const errs: Partial<Record<keyof BusinessFormData, string>> = {};
    if (!form.companyName.trim()) errs.companyName = 'Firmenname ist erforderlich';
    if (!form.contactPerson.trim()) errs.contactPerson = 'Ansprechpartner ist erforderlich';
    if (!form.email.trim()) errs.email = 'E-Mail ist erforderlich';
    else if (!isValidEmail(form.email)) errs.email = 'Ungültige E-Mail-Adresse';
    if (!form.registrationNumber.trim()) errs.registrationNumber = 'Registrierungsnummer ist erforderlich';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep2(): boolean {
    const errs: Partial<Record<keyof BusinessFormData, string>> = {};
    if (!form.street.trim()) errs.street = 'Straße ist erforderlich';
    if (!form.postalCode.trim()) errs.postalCode = 'PLZ ist erforderlich';
    if (!form.city.trim()) errs.city = 'Stadt ist erforderlich';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep3(): boolean {
    if (!uploadedFile) {
      setErrors({ file: 'Bitte lade ein Dokument hoch' });
      return false;
    }
    setErrors({});
    return true;
  }

  function handleNext() {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) setStep(3);
    else if (step === 3 && validateStep3()) setStep(4);
  }

  function handleBack() {
    setErrors({});
    setStep(prev => Math.max(1, prev - 1));
  }

  const processFile = useCallback((file: File) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setErrors({ file: 'Nur PDF, JPG oder PNG erlaubt' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrors({ file: 'Datei darf max. 10 MB groß sein' });
      return;
    }

    setUploading(true);
    setErrors({});
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1] ?? '';
      try {
        await uploadPhoneDocument(file.name, base64, file.type);
        setUploadedFile({ name: file.name, base64, type: file.type });
      } catch (e: unknown) {
        setErrors({ file: e instanceof Error ? e.message : 'Upload fehlgeschlagen' });
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setErrors({ file: 'Datei konnte nicht gelesen werden' });
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitPhoneBundle({
        customerName: form.companyName,
        representativeName: form.contactPerson,
        email: form.email,
        website: form.website,
        registrationNumber: form.registrationNumber,
        street: form.street,
        postalCode: form.postalCode,
        city: form.city,
        documentUrl: uploadedFile?.name ?? '',
      });
      onSubmitSuccess();
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Absenden fehlgeschlagen. Bitte versuche es erneut.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1">Gewerbe registrieren</h3>
        <p className="text-sm text-white/40">Um eine deutsche Telefonnummer zu erhalten, benötigen wir deine Geschäftsdaten und einen Gewerbenachweis.</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              step === s ? 'bg-orange-500 text-white' : step > s ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-white/30'
            }`}>
              {step > s ? '✓' : s}
            </div>
            {s < totalSteps && <div className={`w-6 h-0.5 ${step > s ? 'bg-emerald-500/30' : 'bg-white/10'}`} />}
          </div>
        ))}
        <span className="text-xs text-white/30 ml-2">
          {step === 1 && 'Geschäftsdaten'}
          {step === 2 && 'Adresse'}
          {step === 3 && 'Gewerbenachweis'}
          {step === 4 && 'Zusammenfassung'}
        </span>
      </div>

      {/* Step 1: Business details */}
      {step === 1 && (
        <Card padding="lg" className="space-y-4">
          <div>
            <h4 className="text-base font-semibold text-white mb-1">Geschäftsdaten</h4>
            <p className="text-xs text-white/40">Angaben zu deinem Unternehmen und Ansprechpartner.</p>
          </div>
          <div className="space-y-3">
            <FormInput
              label="Firmenname"
              value={form.companyName}
              onChange={v => updateField('companyName', v)}
              placeholder="Meine Firma GmbH"
              required
              error={errors.companyName}
            />
            <FormInput
              label="Ansprechpartner"
              value={form.contactPerson}
              onChange={v => updateField('contactPerson', v)}
              placeholder="Max Mustermann"
              required
              error={errors.contactPerson}
            />
            <FormInput
              label="E-Mail"
              value={form.email}
              onChange={v => updateField('email', v)}
              type="email"
              placeholder="kontakt@firma.de"
              required
              error={errors.email}
            />
            <FormInput
              label="Website oder Social Media"
              value={form.website}
              onChange={v => updateField('website', v)}
              placeholder="https://www.firma.de oder @firma"
            />
            <div>
              <FormInput
                label="Registrierungsnummer"
                value={form.registrationNumber}
                onChange={v => updateField('registrationNumber', v)}
                placeholder="z.B. HRB 12345, DE123456789, 21/815/12345"
                required
                error={errors.registrationNumber}
              />
              <p className="text-[11px] text-white/30 mt-1">HRB-Nummer, Umsatzsteuer-ID (USt-ID) oder Steuernummer — eins davon reicht.</p>
            </div>
          </div>
          <Button variant="primary" className="w-full" onClick={handleNext}>
            Weiter — Adresse
          </Button>
        </Card>
      )}

      {/* Step 2: Address */}
      {step === 2 && (
        <Card padding="lg" className="space-y-4">
          <div>
            <h4 className="text-base font-semibold text-white mb-1">Adresse</h4>
            <p className="text-xs text-white/40">Die Geschäftsadresse muss mit deinem Gewerbenachweis übereinstimmen.</p>
          </div>
          <div className="space-y-3">
            <FormInput
              label="Straße + Hausnummer"
              value={form.street}
              onChange={v => updateField('street', v)}
              placeholder="Musterstraße 42"
              required
              error={errors.street}
            />
            <div className="grid grid-cols-3 gap-3">
              <FormInput
                label="PLZ"
                value={form.postalCode}
                onChange={v => updateField('postalCode', v)}
                placeholder="10115"
                required
                error={errors.postalCode}
              />
              <div className="col-span-2">
                <FormInput
                  label="Stadt"
                  value={form.city}
                  onChange={v => updateField('city', v)}
                  placeholder="Berlin"
                  required
                  error={errors.city}
                />
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleBack} className="flex-1">Zurück</Button>
            <Button variant="primary" onClick={handleNext} className="flex-1">Weiter — Dokument</Button>
          </div>
        </Card>
      )}

      {/* Step 3: Document upload */}
      {step === 3 && (
        <Card padding="lg" className="space-y-4">
          <div>
            <h4 className="text-base font-semibold text-white mb-1">Gewerbenachweis</h4>
            <p className="text-xs text-white/40">Lade ein Dokument hoch, das dein Gewerbe bestätigt: Gewerbeanmeldung, Steuerbescheid oder Handelsregisterauszug.</p>
          </div>

          {!uploadedFile ? (
            <div
              className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-colors cursor-pointer ${
                dragActive
                  ? 'border-orange-500/60 bg-orange-500/5'
                  : errors.file
                    ? 'border-red-500/40 bg-red-500/5'
                    : 'border-white/15 hover:border-orange-500/30 hover:bg-white/[0.02]'
              }`}
              onDragOver={e => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileSelect}
                className="hidden"
              />
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  <Spinner size="md" />
                  <p className="text-sm text-white/50">Wird hochgeladen...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <svg className="w-10 h-10 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <div>
                    <p className="text-sm text-white/60">Datei hierher ziehen oder <span className="text-orange-400 font-medium">durchsuchen</span></p>
                    <p className="text-xs text-white/30 mt-1">PDF, JPG oder PNG — max. 10 MB</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-emerald-400 truncate">{uploadedFile.name}</p>
              </div>
              <button
                onClick={() => { setUploadedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                className="text-xs text-white/30 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-white/5 shrink-0"
              >
                Entfernen
              </button>
            </div>
          )}

          {errors.file && <p className="text-xs text-red-400">{errors.file}</p>}

          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleBack} className="flex-1">Zurück</Button>
            <Button variant="primary" onClick={handleNext} className="flex-1">Weiter — Zusammenfassung</Button>
          </div>
        </Card>
      )}

      {/* Step 4: Summary & Submit */}
      {step === 4 && (
        <Card padding="lg" className="space-y-5">
          <div>
            <h4 className="text-base font-semibold text-white mb-1">Zusammenfassung</h4>
            <p className="text-xs text-white/40">Prüfe deine Angaben und sende den Antrag ab.</p>
          </div>

          <div className="space-y-3">
            <SummarySection title="Geschäftsdaten">
              <SummaryRow label="Firmenname" value={form.companyName} />
              <SummaryRow label="Ansprechpartner" value={form.contactPerson} />
              <SummaryRow label="E-Mail" value={form.email} />
              <SummaryRow label="Registrierungsnr." value={form.registrationNumber} />
              {form.website && <SummaryRow label="Website / Social" value={form.website} />}
            </SummarySection>

            <SummarySection title="Adresse">
              <SummaryRow label="Straße" value={form.street} />
              <SummaryRow label="PLZ / Stadt" value={`${form.postalCode} ${form.city}`} />
            </SummarySection>

            <SummarySection title="Dokument">
              <SummaryRow label="Datei" value={uploadedFile?.name ?? '—'} />
            </SummarySection>
          </div>

          {submitError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
              {submitError}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="ghost" onClick={handleBack} className="flex-1">Zurück</Button>
            <Button variant="primary" loading={submitting} onClick={handleSubmit} className="flex-1">
              Absenden
            </Button>
          </div>
        </Card>
      )}
    </section>
  );
}

/* ── Summary Helpers ──────────────────────────────────── */

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
      <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-sm text-white font-medium text-right">{value}</span>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────── */

export function PhoneManager() {
  const queryClient = useQueryClient();

  /* ── Phone numbers + agents ── */
  const { data, isLoading } = useQuery({
    queryKey: ['phone-manager'],
    queryFn: async () => {
      const [phones, agentRes] = await Promise.all([getPhoneNumbers(), getAgentConfigs()]);
      return { numbers: phones.items, agents: agentRes.items };
    },
  });

  const numbers = data?.numbers ?? [];
  const agents = data?.agents ?? [];

  /* ── Bundle / compliance status ── */
  const { data: bundleData } = useQuery({
    queryKey: ['phone-bundle-status'],
    queryFn: () => getPhoneBundleStatus(),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll every 30s while bundle is being reviewed
      return (status === 'pending-review' || status === 'in-review') ? 30_000 : false;
    },
  });

  const bundleStatus = bundleData?.status ?? 'none';

  /* ── Local UI state ── */
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);

  // Forwarding
  const [showForward, setShowForward] = useState(false);
  const [forwardNumber, setForwardNumber] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const [forwardResult, setForwardResult] = useState<{ forwardTo: string; carrierCodes: CarrierCodes } | null>(null);
  const [forwardError, setForwardError] = useState<string | null>(null);

  // Provision
  const [provisionSuccess, setProvisionSuccess] = useState<string | null>(null);

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

  function handleBundleSubmitted() {
    setShowRegistrationForm(false);
    queryClient.invalidateQueries({ queryKey: ['phone-bundle-status'] });
  }

  if (isLoading) return (
    <div className="p-6 max-w-3xl mx-auto space-y-6"><SkeletonCard /><SkeletonCard /></div>
  );

  const showForm = showRegistrationForm || bundleStatus === 'twilio-rejected';
  const hasActiveNumbers = numbers.length > 0;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <PageHeader
        title="Telefon & Nummern"
        description="Verbinde eine Telefonnummer mit deinem Agent — per Direktnummer oder Rufumleitung."
      />

      {/* Success banner after provisioning */}
      {provisionSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-sm text-emerald-400 flex items-center justify-between">
          <span>Neue Nummer aktiviert: <strong>{provisionSuccess}</strong></span>
          <button onClick={() => setProvisionSuccess(null)} className="text-emerald-400/50 hover:text-emerald-400 ml-2" aria-label="Schließen">✕</button>
        </div>
      )}

      {/* ── Section 1: Active Numbers ── */}
      {!forwardResult && (
        <section>
          <h3 className="text-lg font-semibold text-white mb-4">
            {hasActiveNumbers ? `Aktive Nummern (${numbers.length})` : 'Aktive Nummern'}
          </h3>

          {hasActiveNumbers ? (
            <div className="space-y-3">
              {numbers.map(n => (
                <NumberCard key={n.id} num={n} agents={agents} onVerify={handleVerify} onDelete={handleDelete} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<IconPhone size={48} className="text-white/20" />}
              title="Noch keine Nummer verbunden"
              description="Registriere dein Gewerbe, um eine deutsche Nummer zu erhalten, oder richte eine Rufumleitung ein."
            />
          )}
        </section>
      )}

      {/* ── Section 2: Compliance Status Banner ── */}
      {!forwardResult && !showForm && (
        <ComplianceBanner
          status={bundleStatus}
          onRequestNumber={() => setShowRegistrationForm(true)}
        />
      )}

      {/* ── Section 3: Business Registration Form ── */}
      {!forwardResult && showForm && (bundleStatus === 'none' || bundleStatus === 'twilio-rejected') && (
        <BusinessRegistrationForm onSubmitSuccess={handleBundleSubmitted} />
      )}

      {/* ── Add Forwarding (only when number is active) ── */}
      {!forwardResult && hasActiveNumbers && bundleStatus === 'twilio-approved' && !showForward && (
        <button onClick={() => setShowForward(true)}
          className="w-full border-2 border-dashed border-white/10 hover:border-cyan-500/40 rounded-2xl py-4 text-sm text-white/30 hover:text-cyan-400 transition-all">
          + Rufumleitung einrichten
        </button>
      )}

      {/* ── Section 4: Forwarding Setup ── */}
      {!forwardResult && showForward && (
        <section>
          <Card padding="lg" className="space-y-4">
            <div>
              <h4 className="text-base font-semibold text-white mb-1">Rufumleitung einrichten</h4>
              <p className="text-xs text-white/40">Leite Anrufe per Carrier-Code an deinen Agent weiter.</p>
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Deine Telefonnummer</label>
              <input type="tel" value={forwardNumber} onChange={e => setForwardNumber(e.target.value)}
                placeholder="+49 170 1234567"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              />
            </div>
            {forwardError && <p className="text-xs text-red-400">{forwardError}</p>}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => { setShowForward(false); setForwardNumber(''); setForwardError(null); }} className="flex-1">
                Abbrechen
              </Button>
              <Button variant="primary" loading={forwarding} onClick={handleForward} className="flex-1" disabled={!forwardNumber.trim()}>
                Weiter — Anleitung anzeigen
              </Button>
            </div>
          </Card>
        </section>
      )}

      {/* ── Forwarding Tutorial with Carrier Codes ── */}
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
