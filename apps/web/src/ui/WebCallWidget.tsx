import React, { useEffect, useRef, useState } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { createWebCall } from '../lib/api.js';

type CallState = 'idle' | 'connecting' | 'active' | 'error';

export function WebCallWidget() {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [agentTalking, setAgentTalking] = useState(false);
  const clientRef = useRef<RetellWebClient | null>(null);

  useEffect(() => {
    return () => {
      clientRef.current?.stopCall();
    };
  }, []);

  async function startCall() {
    setState('connecting');
    setError(null);

    try {
      const res = await createWebCall();
      if (!res.access_token) {
        throw new Error(res.message ?? 'Kein access_token erhalten');
      }

      const client = new RetellWebClient();
      clientRef.current = client;

      client.on('call_started', () => setState('active'));
      client.on('call_ended', () => {
        setState('idle');
        setAgentTalking(false);
      });
      client.on('agent_start_talking', () => setAgentTalking(true));
      client.on('agent_stop_talking', () => setAgentTalking(false));
      client.on('error', (err: unknown) => {
        setError(String(err));
        setState('error');
        setAgentTalking(false);
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
  }

  return (
    <div className="flex flex-col items-center gap-4 py-6">
      {state === 'idle' && (
        <button
          onClick={startCall}
          className="flex items-center gap-2 rounded-full bg-green-600 px-8 py-4 text-white font-semibold
            shadow-lg hover:bg-green-700 transition-all hover:scale-105 active:scale-95"
        >
          <span className="text-2xl">📞</span>
          Test Call starten
        </button>
      )}

      {state === 'connecting' && (
        <div className="flex items-center gap-3 text-gray-500">
          <span className="inline-block w-4 h-4 rounded-full bg-orange-400 animate-pulse" />
          Verbinde…
        </div>
      )}

      {state === 'active' && (
        <div className="flex flex-col items-center gap-4">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl shadow-lg transition-all
            ${agentTalking
              ? 'bg-green-500 animate-pulse scale-110'
              : 'bg-gray-200'
            }`}>
            🤖
          </div>
          <p className="text-sm text-gray-500">
            {agentTalking ? 'Agent spricht…' : 'Warte auf dich…'}
          </p>
          <button
            onClick={stopCall}
            className="flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 text-white font-semibold
              shadow-lg hover:bg-red-600 transition-all"
          >
            <span>📵</span>
            Auflegen
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</p>
          <button
            onClick={() => setState('idle')}
            className="text-sm text-gray-500 underline"
          >
            Zurück
          </button>
        </div>
      )}
    </div>
  );
}
