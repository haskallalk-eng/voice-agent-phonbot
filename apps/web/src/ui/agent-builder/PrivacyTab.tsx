import { useEffect, useState } from 'react';
import type { AgentConfig } from '../../lib/api.js';
import { getLearningConsent, setLearningConsent } from '../../lib/api.js';
import { SectionCard, Field, Select, Toggle, IconPrivacy } from './shared.js';

export interface PrivacyTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function PrivacyTab({ config, onUpdate }: PrivacyTabProps) {
  const [sharePatterns, setSharePatterns] = useState<boolean | null>(null);
  const [consentedAt, setConsentedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLearningConsent()
      .then((c) => {
        if (cancelled) return;
        setSharePatterns(c.share_patterns);
        setConsentedAt(c.consented_at);
      })
      .catch(() => {
        if (cancelled) return;
        setSharePatterns(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function toggleSharePatterns(v: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await setLearningConsent(v);
      setSharePatterns(res.share_patterns);
      setConsentedAt(v ? new Date().toISOString() : null);
    } catch {
      setError('Speichern fehlgeschlagen — versuche es erneut.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Aufzeichnung & Datenschutz" icon={IconPrivacy}>
      <div className="space-y-6">
        <Toggle checked={config.recordCalls ?? false}
          onChange={(v) => onUpdate({ recordCalls: v })}
          label="Anrufe aufzeichnen" />
        {config.recordCalls && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-sm text-yellow-300 ml-14">
            Stelle sicher, dass Anrufer zu Beginn über die Aufzeichnung informiert werden (DSGVO).
          </div>
        )}

        <Field label="Gesprächsdaten aufbewahren">
          <Select value={String(config.dataRetentionDays ?? 30)}
            onChange={(e) => onUpdate({ dataRetentionDays: parseInt(e.target.value) })}>
            <option value="0">Nicht speichern (sofort löschen)</option>
            <option value="7">7 Tage</option>
            <option value="30">30 Tage</option>
            <option value="90">90 Tage</option>
            <option value="365">1 Jahr</option>
          </Select>
        </Field>

        {/* Cross-org pattern sharing — opt-in */}
        <div className="border-t border-white/10 pt-6">
          <Toggle
            checked={sharePatterns ?? false}
            onChange={toggleSharePatterns}
            label="Anonymisierte Gesprächsmuster mit Phonbot teilen"
          />
          <div className="ml-14 mt-2 text-xs text-white/50 leading-relaxed space-y-2">
            <p>
              Hilf anderen Phonbot-Kunden in deiner Branche: Wenn aktiv, werden aus deinen
              erfolgreichsten Anrufen <strong>anonymisierte Gesprächsmuster</strong>
              {' '}(z. B. „Wie Chipy einen Termin abschließt") extrahiert und in unseren
              branchenweiten Pattern-Pool aufgenommen. Personenbezogene Daten (Namen,
              Telefonnummern, Adressen, IBAN, E-Mails) werden vorher automatisch entfernt.
            </p>
            <p>
              Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung). Du kannst diese
              jederzeit hier widerrufen — bereits anonymisierte Patterns lassen sich
              technisch nicht zurückführen.
            </p>
            {consentedAt && (
              <p className="text-white/40">
                Eingewilligt am: {new Date(consentedAt).toLocaleString('de-DE')}
              </p>
            )}
            {error && <p className="text-red-300">{error}</p>}
            {saving && <p className="text-white/40">Speichere…</p>}
          </div>
        </div>

        <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
          Alle Daten werden verschlüsselt gespeichert und nach Ablauf automatisch gelöscht. DSGVO-konform.
        </div>
      </div>
    </SectionCard>
  );
}
