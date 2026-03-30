import React, { useEffect, useState } from 'react';
import {
  getPhoneNumbers,
  provisionPhoneNumber,
  setupForwarding,
  type PhoneNumber,
} from '../lib/api.js';

type Tab = 'my-numbers' | 'provision' | 'forward';

export function PhoneManager() {
  const [tab, setTab] = useState<Tab>('my-numbers');
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Provision form
  const [areaCode, setAreaCode] = useState('030');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState<{ number: string; numberPretty: string } | null>(null);

  // Forwarding form
  const [forwardNumber, setForwardNumber] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const [forwardResult, setForwardResult] = useState<{ forwardTo: string; instructions: Record<string, string> } | null>(null);

  async function loadNumbers() {
    try {
      setLoading(true);
      const res = await getPhoneNumbers();
      setNumbers(res.items);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadNumbers(); }, []);

  async function handleProvision() {
    setProvisioning(true);
    setError(null);
    setProvisionResult(null);
    try {
      const res = await provisionPhoneNumber(areaCode);
      setProvisionResult(res);
      await loadNumbers();
      setTab('my-numbers');
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Provision fehlgeschlagen');
    } finally {
      setProvisioning(false);
    }
  }

  async function handleForward() {
    setForwarding(true);
    setError(null);
    setForwardResult(null);
    try {
      const res = await setupForwarding(forwardNumber);
      setForwardResult(res);
      await loadNumbers();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Fehler bei Weiterleitung');
    } finally {
      setForwarding(false);
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'my-numbers', label: '📋 Meine Nummern' },
    { id: 'provision', label: '🆕 Neue Nummer' },
    { id: 'forward', label: '↪️ Rufumleitung' },
  ];

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-white mb-1">📞 Telefonnummer</h1>
      <p className="text-sm text-white/50 mb-4">
        Verbinde eine Nummer mit deinem Agent — per Direktzuweisung oder Rufumleitung.
      </p>
      <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3 text-sm text-orange-300 mb-6 flex items-center gap-2">
        🎁 <span><strong>Starter-Plan und höher:</strong> Eine lokale Telefonnummer ist in deinem Plan inklusive!</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 mb-6 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.id
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          ⚠️ {error}
        </div>
      )}

      {/* My Numbers */}
      {tab === 'my-numbers' && (
        <div>
          {loading ? (
            <p className="text-white/40 text-sm">Lade…</p>
          ) : numbers.length === 0 ? (
            <div className="text-center py-12 text-white/30">
              <div className="text-4xl mb-3">📭</div>
              <p className="text-sm">Noch keine Nummer verbunden.</p>
              <div className="flex gap-3 justify-center mt-4">
                <button
                  onClick={() => setTab('provision')}
                  className="bg-gradient-to-r from-orange-500 to-cyan-500 hover:opacity-90 text-white text-sm font-medium rounded-xl px-4 py-2 transition-opacity"
                >
                  Neue Nummer aktivieren
                </button>
                <button
                  onClick={() => setTab('forward')}
                  className="border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 text-sm font-medium rounded-xl px-4 py-2 transition-colors"
                >
                  Rufumleitung einrichten
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {provisionResult && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-sm text-green-400 flex items-center gap-2">
                  ✅ Neue Nummer aktiviert: <strong>{provisionResult.numberPretty || provisionResult.number}</strong>
                </div>
              )}
              {numbers.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center justify-between glass rounded-2xl px-5 py-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-xl">
                      📞
                    </div>
                    <div>
                      <p className="font-semibold text-white">{n.number_pretty ?? n.number}</p>
                      <p className="text-xs text-white/40 mt-0.5">
                        {n.method === 'forwarding' ? 'Rufumleitung' : 'Direkte Nummer'}
                        {' · '}
                        {n.verified ? (
                          <span className="text-green-400">✓ Verifiziert</span>
                        ) : (
                          <span className="text-yellow-400">⏳ Nicht verifiziert</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(n.number)}
                    className="text-xs text-white/30 hover:text-orange-400 transition-colors"
                    title="Kopieren"
                  >
                    📋
                  </button>
                </div>
              ))}
              <button
                onClick={() => setTab('provision')}
                className="w-full border-2 border-dashed border-white/10 hover:border-orange-500/40 rounded-2xl py-3 text-sm text-white/30 hover:text-orange-400 transition-all"
              >
                + Weitere Nummer hinzufügen
              </button>
            </div>
          )}
        </div>
      )}

      {/* Provision */}
      {tab === 'provision' && (
        <div className="glass rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="font-semibold text-white mb-1">Neue Nummer erhalten</h2>
            <p className="text-sm text-white/50">
              Wir kaufen eine lokale Telefonnummer für dich. Anrufe werden direkt von deinem Agent beantwortet.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">
              Vorwahl (Area Code)
            </label>
            <div className="flex gap-3">
              <select
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-[#0F0F18] text-white px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              >
                <option value="030">030 – Berlin</option>
                <option value="040">040 – Hamburg</option>
                <option value="089">089 – München</option>
                <option value="0221">0221 – Köln</option>
                <option value="069">069 – Frankfurt</option>
                <option value="0711">0711 – Stuttgart</option>
                <option value="0211">0211 – Düsseldorf</option>
              </select>
              <button
                onClick={handleProvision}
                disabled={provisioning}
                className="bg-gradient-to-r from-orange-500 to-cyan-500 hover:opacity-90 disabled:opacity-50 text-white font-medium rounded-xl px-5 py-2 text-sm transition-opacity"
              >
                {provisioning ? 'Aktiviere…' : 'Nummer aktivieren →'}
              </button>
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 text-xs text-blue-400">
            💡 Die Nummer wird sofort deinem Agent zugewiesen. Anrufer können sie direkt anrufen — kein Weiterleitungs-Setup nötig.
          </div>
        </div>
      )}

      {/* Forward */}
      {tab === 'forward' && (
        <div className="space-y-5">
          {!forwardResult ? (
            <div className="glass rounded-2xl p-6 space-y-5">
              <div>
                <h2 className="font-semibold text-white mb-1">Bestehende Nummer weiterleiten</h2>
                <p className="text-sm text-white/50">
                  Behalte deine bisherige Nummer. Wir zeigen dir, wie du Anrufe bei Besetzt an deinen Agent weiterleitest.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">
                  Deine bestehende Telefonnummer
                </label>
                <div className="flex gap-3">
                  <input
                    type="tel"
                    value={forwardNumber}
                    onChange={(e) => setForwardNumber(e.target.value)}
                    placeholder="+49 30 12345678"
                    className="flex-1 rounded-xl border border-white/10 bg-white/5 text-white px-3 py-2 text-sm
                      placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                  <button
                    onClick={handleForward}
                    disabled={forwarding || !forwardNumber.trim()}
                    className="bg-gradient-to-r from-orange-500 to-cyan-500 hover:opacity-90 disabled:opacity-50 text-white font-medium rounded-xl px-5 py-2 text-sm transition-opacity"
                  >
                    {forwarding ? 'Speichere…' : 'Weiter →'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-sm text-green-400">
                ✅ Gespeichert! Richte jetzt die Weiterleitung auf{' '}
                <strong
                  className="cursor-pointer underline"
                  onClick={() => navigator.clipboard.writeText(forwardResult.forwardTo)}
                >
                  {forwardResult.forwardTo}
                </strong>{' '}
                ein:
              </div>

              {Object.entries(forwardResult.instructions).map(([device, instruction]) => (
                <div key={device} className="glass rounded-2xl p-5">
                  <h3 className="font-medium text-white mb-2 capitalize">
                    {device === 'iphone' ? '📱 iPhone' : device === 'android' ? '🤖 Android' : '🏠 Fritzbox'}
                  </h3>
                  <p className="text-sm text-white/60">{instruction}</p>
                </div>
              ))}

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-sm text-yellow-400">
                ⚠️ Tipp: Wähle „Bei Besetzt" oder „Bei Nichtannahme" — so bleibt deine Nummer erreichbar und der Agent springt nur ein wenn du nicht abnimmst.
              </div>

              <button
                onClick={() => { setForwardResult(null); setForwardNumber(''); setTab('my-numbers'); }}
                className="w-full bg-gradient-to-r from-orange-500 to-cyan-500 hover:opacity-90 text-white font-medium rounded-2xl py-3 text-sm transition-opacity"
              >
                Eingerichtet ✓ → Meine Nummern
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
