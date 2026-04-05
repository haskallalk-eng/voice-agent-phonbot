import React, { useEffect, useRef, useState } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { createWebCall } from '../lib/api.js';

type CallState = 'idle' | 'connecting' | 'active' | 'error';

export function WebCallWidget({ agentTenantId }: { agentTenantId?: string } = {}) {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [agentTalking, setAgentTalking] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const clientRef = useRef<RetellWebClient | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      clientRef.current?.stopCall();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function startCall() {
    setState('connecting');
    setError(null);
    setSeconds(0);
    try {
      const res = await createWebCall(agentTenantId);
      if (!res.access_token) throw new Error(res.message ?? 'Kein access_token erhalten');
      const client = new RetellWebClient();
      clientRef.current = client;
      client.on('call_started', () => {
        setState('active');
        timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      });
      client.on('call_ended', () => {
        setState('idle');
        setAgentTalking(false);
        setSeconds(0);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      });
      client.on('agent_start_talking', () => setAgentTalking(true));
      client.on('agent_stop_talking', () => setAgentTalking(false));
      client.on('error', (err: unknown) => {
        setError(String(err));
        setState('error');
        setAgentTalking(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      });
      await client.startCall({ accessToken: res.access_token });
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : null) ?? 'Unbekannter Fehler');
      setState('error');
    }
  }

  function stopCall() {
    clientRef.current?.stopCall();
    clientRef.current = null;
    setState('idle');
    setAgentTalking(false);
    setSeconds(0);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  function fmtTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  if (state === 'idle') {
    return (
      <button
        onClick={startCall}
        className="w-full flex items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-orange-500/30 py-4 transition-all duration-200 group cursor-pointer"
      >
        {/* Mic icon */}
        <span className="w-8 h-8 rounded-lg bg-orange-500/15 border border-orange-500/20 flex items-center justify-center group-hover:bg-orange-500/20 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400">
            <rect x="9" y="2" width="6" height="11" rx="3"/>
            <path d="M5 10a7 7 0 0014 0"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
          </svg>
        </span>
        <span className="text-sm font-medium text-white/60 group-hover:text-white/80 transition-colors">Gespräch starten</span>
      </button>
    );
  }

  if (state === 'connecting') {
    return (
      <div className="flex items-center justify-center gap-3 py-4 text-white/40 text-sm">
        <span className="w-3 h-3 rounded-full bg-orange-500/60 animate-pulse" />
        Verbinde…
      </div>
    );
  }

  if (state === 'active') {
    return (
      <div className="space-y-3">
        {/* Status row */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400 font-medium">Verbunden</span>
          </div>
          <span className="text-xs text-white/30 font-mono">{fmtTime(seconds)}</span>
        </div>

        {/* Waveform bars */}
        <div className="flex items-end justify-center gap-0.5 h-10 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="w-1 rounded-sm transition-all duration-75"
              style={{
                height: agentTalking
                  ? `${Math.max(4, Math.round(8 + Math.random() * 24))}px`
                  : '4px',
                backgroundColor: agentTalking ? '#f97316' : 'rgba(255,255,255,0.1)',
              }}
            />
          ))}
        </div>

        <p className="text-center text-xs text-white/30">
          {agentTalking ? 'Agent spricht…' : 'Warte auf dich…'}
        </p>

        {/* Hang up */}
        <button
          onClick={stopCall}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/8 hover:bg-red-500/15 hover:border-red-500/35 py-2.5 text-xs font-medium text-red-400 transition-all cursor-pointer"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-2.6-3.41"/>
            <path d="M6.24 6.24A19.79 19.79 0 002.07 14.9a2 2 0 002 2.11h.09A16.84 16.84 0 006.97 16"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
          Auflegen
        </button>
      </div>
    );
  }

  // error
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-xs text-red-400">{error}</div>
      <button
        onClick={() => setState('idle')}
        className="text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer"
      >
        Zurück
      </button>
    </div>
  );
}
