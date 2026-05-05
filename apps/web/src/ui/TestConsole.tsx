import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { createWebCall, getAgentConfigs, type AgentConfig } from '../lib/api.js';
import { useWebCallCleanup } from '../lib/use-web-call-cleanup.js';
import { IconPhone, IconMicUpload } from './PhonbotIcons.js';
import { FoxLogo } from './FoxLogo.js';

type CallState = 'idle' | 'connecting' | 'active' | 'error';

type LogEntry = {
  time: number;
  type: 'system' | 'user' | 'agent' | 'error';
  text: string;
};

type Page = 'home' | 'agent' | 'test' | 'tickets' | 'customers' | 'logs' | 'billing' | 'phone' | 'calendar' | 'insights';

export function TestConsole({ onNavigate }: { onNavigate?: (page: Page) => void } = {}) {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [allAgents, setAllAgents] = useState<AgentConfig[]>([]);
  const [callState, setCallState] = useState<CallState>('idle');
  const [agentTalking, setAgentTalking] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const clientRef = useRef<RetellWebClient | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useWebCallCleanup(clientRef);

  useEffect(() => {
    void getAgentConfigs().then(res => {
      setAllAgents(res.items);
      const deployed = res.items.find(a => a.retellAgentId);
      if (deployed) setConfig(deployed);
      else if (res.items[0]) setConfig(res.items[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    return () => {
      clientRef.current?.stopCall();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function log(type: LogEntry['type'], text: string) {
    setLogs((l) => [...l, { time: Date.now(), type, text }]);
  }

  function fmtTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  async function startCall() {
    if (!config?.retellAgentId) {
      log('error', 'Agent ist nicht deployed. Gehe zum Agent Builder und klicke "Deploy".');
      return;
    }

    setCallState('connecting');
    setSeconds(0);
    log('system', `Verbinde mit ${config.name}…`);

    try {
      const res = await createWebCall(config.tenantId);
      if (!res.ok) {
        if (res.error === 'USAGE_LIMIT_REACHED') {
          log('error', `Minutenkontingent aufgebraucht (${res.minutesUsed}/${res.minutesLimit} Min). Bitte upgraden.`);
        } else if (res.error === 'AGENT_NOT_DEPLOYED') {
          log('error', 'Agent ist nicht deployed.');
        } else {
          log('error', res.message ?? res.error ?? 'Unbekannter Fehler');
        }
        setCallState('error');
        return;
      }
      if (!res.access_token) {
        throw new Error(res.message ?? 'Kein access_token erhalten');
      }

      const client = new RetellWebClient();
      clientRef.current = client;

      client.on('call_started', () => {
        setCallState('active');
        timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
        log('system', 'Verbunden — sprich jetzt!');
      });

      client.on('call_ended', () => {
        setCallState('idle');
        setAgentTalking(false);
        setSeconds(0);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        log('system', 'Call beendet.');
      });

      client.on('agent_start_talking', () => setAgentTalking(true));
      client.on('agent_stop_talking', () => setAgentTalking(false));

      client.on('update', (update: { transcript?: { role: string; content?: string }[] }) => {
        if (update?.transcript) {
          const entries: LogEntry[] = [];
          for (const t of update.transcript) {
            if (t.role === 'agent' && t.content) {
              entries.push({ time: Date.now(), type: 'agent', text: t.content });
            } else if (t.role === 'user' && t.content) {
              entries.push({ time: Date.now(), type: 'user', text: t.content });
            }
          }
          if (entries.length > 0) {
            setLogs((prev) => {
              const nonTranscript = prev.filter((l) => l.type === 'system' || l.type === 'error');
              return [...nonTranscript, ...entries];
            });
          }
        }
      });

      client.on('error', (err: unknown) => {
        log('error', String(err));
        setCallState('error');
        setAgentTalking(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      });

      await client.startCall({ accessToken: res.access_token });
    } catch (e: unknown) {
      log('error', (e instanceof Error ? e.message : null) ?? 'Verbindung fehlgeschlagen');
      setCallState('error');
    }
  }

  function stopCall() {
    clientRef.current?.stopCall();
    clientRef.current = null;
    setCallState('idle');
    setAgentTalking(false);
    setSeconds(0);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  const isDeployed = !!config?.retellAgentId;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/3 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.06) 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 right-1/4 w-[250px] sm:w-[400px] h-[250px] sm:h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.04) 0%, transparent 65%)' }} />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Test Console</h1>
            <p className="text-sm text-white/40 mt-1">Teste deinen Agent mit einem Live-Anruf</p>
          </div>
          {logs.length > 0 && (
            <button onClick={() => setLogs([])}
              className="text-xs text-white/30 hover:text-white/60 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5">
              Log leeren
            </button>
          )}
        </div>

        {/* Agent Selector */}
        <div className="mb-6">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {allAgents.map(a => (
                <button
                  key={a.tenantId}
                  onClick={() => setConfig(a)}
                  className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all shrink-0 cursor-pointer ${
                    a.tenantId === config?.tenantId
                      ? 'bg-white/[0.06] border-orange-500/30 shadow-[0_0_12px_rgba(249,115,22,0.08)]'
                      : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    a.tenantId === config?.tenantId
                      ? 'bg-gradient-to-br from-orange-500/20 to-cyan-500/20'
                      : 'bg-white/5'
                  }`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
                      className={a.tenantId === config?.tenantId ? 'text-orange-400' : 'text-white/30'}>
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                  <div className="text-left min-w-0">
                    <p className={`text-sm font-medium truncate ${a.tenantId === config?.tenantId ? 'text-white' : 'text-white/60'}`}>
                      {a.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {a.retellAgentId ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                          <span className="text-[10px] text-green-400/80">Live</span>
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                          <span className="text-[10px] text-white/25">Draft</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            {/* Deploy Agent + button — always visible */}
            <button
              onClick={() => onNavigate?.('agent')}
              className="flex flex-col items-center justify-center gap-1.5 px-6 py-3 rounded-xl border-2 border-dashed border-white/10 hover:border-orange-500/25 transition-all shrink-0 cursor-pointer min-w-[100px]"
            >
              <span className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-white/20 text-base">+</span>
              <span className="text-[10px] text-white/25">Agent erstellen</span>
            </button>
          </div>
        </div>

        {/* Call Card */}
        <div className="rounded-2xl border border-white/[0.07] overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
          {/* Call visualization area */}
          <div className="flex flex-col items-center justify-center py-12 px-6 min-h-[280px]">
            {callState === 'idle' && (
              <>
                <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <FoxLogo size={48} glow={false} />
                </div>
                {isDeployed ? (
                  <>
                    <p className="text-sm text-white/50 mb-6">Bereit zum Testen</p>
                    <button
                      onClick={startCall}
                      className="flex items-center gap-3 rounded-full px-8 py-3.5 text-sm font-semibold text-white transition-all hover:scale-105 active:scale-95 cursor-pointer"
                      style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 0 20px rgba(249,115,22,0.25)' }}
                    >
                      <IconPhone size={18} />
                      Anruf starten
                    </button>
                  </>
                ) : (
                  <div className="text-center">
                    <p className="text-sm text-white/40 mb-1">Agent nicht deployed</p>
                    <p className="text-xs text-white/25">Deploye deinen Agent zuerst im Agent Builder.</p>
                  </div>
                )}
              </>
            )}

            {callState === 'connecting' && (
              <>
                <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6 animate-pulse"
                  style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(6,182,212,0.15))', border: '1px solid rgba(249,115,22,0.2)' }}>
                  <FoxLogo size={48} glow />
                </div>
                <p className="text-sm text-white/50">Verbinde…</p>
              </>
            )}

            {callState === 'active' && (
              <>
                {/* Animated avatar */}
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 transition-all duration-300 ${agentTalking ? 'scale-110' : 'scale-100'}`}
                  style={agentTalking
                    ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 0 40px rgba(249,115,22,0.4)' }
                    : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }
                  }>
                  <FoxLogo size={56} glow={agentTalking} />
                </div>

                {/* Waveform */}
                <div className="flex items-end justify-center gap-[3px] h-8 mb-3">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-[3px] rounded-full transition-all duration-75"
                      style={{
                        height: agentTalking ? `${Math.max(4, Math.round(6 + Math.random() * 22))}px` : '4px',
                        backgroundColor: agentTalking ? '#f97316' : 'rgba(255,255,255,0.1)',
                      }}
                    />
                  ))}
                </div>

                <p className="text-xs text-white/30 mb-1">
                  {agentTalking ? `${config?.name ?? 'Agent'} spricht…` : 'Hört zu…'}
                </p>
                <p className="text-xs text-white/20 font-mono mb-6">{fmtTime(seconds)}</p>

                <button
                  onClick={stopCall}
                  className="flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-red-500 cursor-pointer"
                  style={{ background: 'rgba(239,68,68,0.7)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                  Auflegen
                </button>
              </>
            )}

            {callState === 'error' && (
              <div className="text-center">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-500/10 border border-red-500/20">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-red-400">
                    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                </div>
                <p className="text-sm text-red-400 mb-4">Verbindung fehlgeschlagen</p>
                <button
                  onClick={() => setCallState('idle')}
                  className="text-xs text-orange-400 hover:text-orange-300 transition-colors cursor-pointer"
                >
                  Erneut versuchen
                </button>
              </div>
            )}
          </div>

          {/* Transcript */}
          {logs.length > 0 && (
            <div className="border-t border-white/[0.05]">
              <div className="px-5 py-3 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-white/25 uppercase tracking-widest">Transkript</span>
              </div>
              <div className="px-5 pb-5 space-y-2.5 max-h-[300px] overflow-y-auto">
                {logs.map((entry, i) => (
                  <LogBubble key={i} entry={entry} />
                ))}
                <div ref={endRef} />
              </div>
            </div>
          )}
        </div>

        {/* Agent details (collapsed) */}
        {config && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/20 px-1">
            <span>{config.name}</span>
            <span>Stimme: {config.voice}</span>
            <span>{config.language === 'de' ? 'Deutsch' : config.language}</span>
            {config.tools.length > 0 && <span>Tools: {config.tools.join(', ')}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function LogBubble({ entry }: { entry: LogEntry }) {
  if (entry.type === 'system') {
    return (
      <div className="flex justify-center">
        <span className="text-[10px] text-white/30 bg-white/[0.03] px-3 py-1 rounded-full">
          {entry.text}
        </span>
      </div>
    );
  }

  if (entry.type === 'error') {
    return (
      <div className="flex justify-center">
        <span className="text-xs text-red-400/80 bg-red-500/8 border border-red-500/15 px-3 py-1.5 rounded-xl">
          {entry.text}
        </span>
      </div>
    );
  }

  const isUser = entry.type === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-orange-500/15 text-white/90 rounded-br-md'
            : 'bg-white/[0.04] border border-white/[0.06] text-white/70 rounded-bl-md'
        }`}
      >
        {entry.text}
      </div>
    </div>
  );
}
