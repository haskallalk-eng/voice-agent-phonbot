import React, { useEffect, useRef, useState } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { createWebCall, getAgentConfig, type AgentConfig } from '../lib/api.js';
import { IconPhone, IconMicUpload } from './PhonbotIcons.js';
import { FoxLogo } from './FoxLogo.js';

type CallState = 'idle' | 'connecting' | 'active' | 'error';

type LogEntry = {
  time: number;
  type: 'system' | 'user' | 'agent' | 'error';
  text: string;
};

export function TestConsole() {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [agentTalking, setAgentTalking] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const clientRef = useRef<RetellWebClient | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getAgentConfig().then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    return () => { clientRef.current?.stopCall(); };
  }, []);

  function log(type: LogEntry['type'], text: string) {
    setLogs((l) => [...l, { time: Date.now(), type, text }]);
  }

  async function startCall() {
    if (!config?.retellAgentId) {
      log('error', 'Agent ist nicht deployed. Gehe zum Agent Builder und klicke "Deploy to Retell".');
      return;
    }

    setCallState('connecting');
    log('system', 'Verbinde mit Agent…');

    try {
      const res = await createWebCall();
      if (!res.ok) {
        if (res.error === 'USAGE_LIMIT_REACHED') {
          log('error', `Dein Minutenkontingent ist aufgebraucht (${res.minutesUsed}/${res.minutesLimit} Min). Upgrade deinen Plan.`);
        } else if (res.error === 'AGENT_NOT_DEPLOYED') {
          log('error', 'Agent ist nicht deployed. Gehe zum Agent Builder und klicke "Deploy to Retell".');
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
        log('system', 'Call gestartet – sprich jetzt!');
      });

      client.on('call_ended', () => {
        setCallState('idle');
        setAgentTalking(false);
        log('system', 'Call beendet.');
      });

      client.on('agent_start_talking', () => {
        setAgentTalking(true);
      });

      client.on('agent_stop_talking', () => {
        setAgentTalking(false);
      });

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
  }

  function clearLogs() {
    setLogs([]);
  }

  const isDeployed = !!config?.retellAgentId;

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#0F0F18]">
        <div>
          <h2 className="text-xl font-bold text-white">Test Console</h2>
          <p className="text-xs text-white/40 mt-0.5">
            {config ? `Agent: ${config.name}` : 'Lade…'}
            {config?.retellAgentId && (
              <span className="ml-2 text-orange-400">● Deployed</span>
            )}
            {config && !config.retellAgentId && (
              <span className="ml-2 text-red-400">● Nicht deployed</span>
            )}
          </p>
        </div>
        <button onClick={clearLogs} className="text-sm text-white/30 hover:text-white/60">
          Log leeren
        </button>
      </div>

      {/* Agent Info Card */}
      {config && (
        <div className="px-6 py-3 bg-white/5 border-b border-white/5">
          <div className="flex flex-wrap gap-4 text-xs text-white/40">
            <span><strong className="text-white/60">Name:</strong> {config.name}</span>
            <span><strong className="text-white/60">Stimme:</strong> {config.voice}</span>
            <span><strong className="text-white/60">Sprache:</strong> {config.language === 'de' ? '🇩🇪 Deutsch' : '🇬🇧 English'}</span>
            <span><strong className="text-white/60">Business:</strong> {config.businessName}</span>
            <span><strong className="text-white/60">Tools:</strong> {config.tools.join(', ') || 'keine'}</span>
          </div>
        </div>
      )}

      {/* Conversation Log */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {logs.length === 0 && (
          <div className="text-center text-white/30 mt-20">
            <IconMicUpload size={40} className="mx-auto mb-3 text-white/20" />
            <p className="text-sm">
              {isDeployed
                ? 'Starte einen Call um deinen Agent zu testen.'
                : 'Deploy deinen Agent zuerst im Agent Builder.'}
            </p>
          </div>
        )}
        {logs.map((entry, i) => (
          <LogBubble key={i} entry={entry} />
        ))}
        {callState === 'active' && agentTalking && (
          <div className="flex items-center gap-2 text-white/40 text-sm">
            <span className="inline-block w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            Agent spricht…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Call Controls */}
      <div className="border-t border-white/5 bg-[#0F0F18] px-6 py-5">
        <div className="flex justify-center">
          {callState === 'idle' && (
            <button
              onClick={startCall}
              disabled={!isDeployed}
              className="flex items-center gap-3 rounded-full px-8 py-4 text-white font-semibold
                shadow-lg transition-all hover:scale-105 active:scale-95
                disabled:opacity-50 disabled:hover:scale-100"
              style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 0 24px rgba(249,115,22,0.35)' }}
            >
              <IconPhone size={22} />
              Call starten
            </button>
          )}

          {callState === 'connecting' && (
            <div className="flex items-center gap-3 text-white/50">
              <span className="inline-block w-5 h-5 rounded-full bg-orange-400 animate-pulse" />
              <span className="text-sm font-medium">Verbinde…</span>
            </div>
          )}

          {callState === 'active' && (
            <div className="flex flex-col items-center gap-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all
                ${agentTalking ? 'scale-110' : ''}`}
                style={agentTalking
                  ? { background: 'linear-gradient(135deg, #F97316, #06B6D4)', boxShadow: '0 0 24px rgba(249,115,22,0.5)' }
                  : { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }
                }>
                <FoxLogo size={40} glow={agentTalking} />
              </div>
              <button
                onClick={stopCall}
                className="flex items-center gap-2 rounded-full bg-red-500/80 px-6 py-3 text-white font-semibold
                  shadow-lg hover:bg-red-500 transition-all"
              >
                <IconPhone size={18} className="opacity-80" /> Auflegen
              </button>
            </div>
          )}

          {callState === 'error' && (
            <button
              onClick={() => setCallState('idle')}
              className="text-sm text-orange-400 underline"
            >
              Erneut versuchen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LogBubble({ entry }: { entry: LogEntry }) {
  if (entry.type === 'system') {
    return (
      <div className="flex justify-center">
        <span className="text-xs text-white/40 bg-white/5 px-3 py-1 rounded-full">
          {entry.text}
        </span>
      </div>
    );
  }

  if (entry.type === 'error') {
    return (
      <div className="flex justify-center">
        <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg">
          {entry.text}
        </span>
      </div>
    );
  }

  const isUser = entry.type === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-gradient-to-r from-orange-500 to-cyan-500 text-white rounded-br-md'
            : 'bg-white/10 border border-white/10 text-white/80 rounded-bl-md'
        }`}
      >
        {entry.text}
      </div>
    </div>
  );
}
