import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FoxLogo } from '../ui/FoxLogo.js';
import { sendCopilotMessage, type CopilotMessage } from '../lib/api.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2.5 mb-4">
      <div className="shrink-0 w-8 h-8">
        <FoxLogo size={32} />
      </div>
      <div
        className="px-4 py-3 rounded-2xl rounded-bl-md"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex gap-1.5 items-center h-4">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block rounded-full"
              style={{
                width: 6, height: 6,
                background: 'linear-gradient(135deg, #F97316, #FB923C)',
                animation: 'chippy-dot-bounce 1.4s ease-in-out infinite',
                animationDelay: `${i * 0.18}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div
          className="max-w-[82%] px-4 py-2.5 rounded-2xl rounded-br-md text-sm text-white leading-relaxed"
          style={{ background: 'linear-gradient(135deg, #F97316, #EA580C)' }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2.5 mb-4">
      <div className="shrink-0 w-8 h-8">
        <FoxLogo size={32} />
      </div>
      <div
        className="max-w-[82%] px-4 py-2.5 rounded-2xl rounded-bl-md text-sm text-white/90 leading-relaxed whitespace-pre-wrap"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {message.content}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChipyCopilot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hey! Ich bin Chipy 👋\nDein Phonbot-Assistent. Frag mich alles zum Dashboard, deinem Agent oder den Features!',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError(null);

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const history: CopilotMessage[] = messages
      .filter((m) => m.id !== 'welcome')
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await sendCopilotMessage(text, history);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: res.reply,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      const errText = err instanceof Error ? err.message : '';
      if (errText.includes('401')) {
        setError('Bitte melde dich erneut an.');
      } else if (errText.includes('429')) {
        setError('Zu viele Anfragen — kurz warten.');
      } else {
        setError('Konnte nicht antworten. Versuch es nochmal.');
      }
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      <style>{`
        @keyframes chippy-dot-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes chippy-fab-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.35), 0 4px 24px rgba(0,0,0,0.4); }
          50% { box-shadow: 0 0 0 10px rgba(249,115,22,0), 0 4px 24px rgba(0,0,0,0.4); }
        }
        @keyframes chippy-window-in {
          from { opacity: 0; transform: translateY(16px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* ── FAB Button ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Chipy Copilot öffnen"
          className="fixed bottom-5 right-5 z-50 flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
          style={{
            width: 60, height: 60,
            borderRadius: '50%',
            background: 'linear-gradient(145deg, #1a1a2e 0%, #0f0f1a 100%)',
            border: '2px solid rgba(249,115,22,0.35)',
            animation: 'chippy-fab-glow 3s ease-in-out infinite',
          }}
        >
          <FoxLogo size={40} animate />
        </button>
      )}

      {/* ── Chat Window ── */}
      {open && (
        <div
          className="fixed bottom-5 right-5 z-50 flex flex-col overflow-hidden"
          style={{
            width: 'min(400px, calc(100vw - 24px))',
            height: 'min(540px, calc(100vh - 100px))',
            borderRadius: 20,
            background: 'linear-gradient(180deg, rgba(15,15,26,0.97) 0%, rgba(10,10,18,0.98) 100%)',
            border: '1px solid rgba(249,115,22,0.15)',
            boxShadow: '0 0 60px rgba(249,115,22,0.08), 0 8px 40px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            animation: 'chippy-window-in 0.25s ease-out',
          }}
        >
          {/* ── Header ── */}
          <div
            className="flex items-center gap-3 px-4 py-3 shrink-0"
            style={{
              borderBottom: '1px solid rgba(249,115,22,0.12)',
              background: 'linear-gradient(135deg, rgba(249,115,22,0.08) 0%, rgba(234,88,12,0.04) 100%)',
            }}
          >
            <FoxLogo size={36} glow />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white text-sm leading-tight tracking-tight">
                Chipy Copilot
              </p>
              <p className="text-xs" style={{ color: 'rgba(249,115,22,0.6)' }}>
                Dein Phonbot-Assistent
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Schließen"
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/30 hover:text-white hover:bg-white/5 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── Messages ── */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {loading && <TypingIndicator />}
            {error && (
              <div
                className="text-xs rounded-xl px-3 py-2 mb-3"
                style={{
                  color: '#FB923C',
                  background: 'rgba(249,115,22,0.08)',
                  border: '1px solid rgba(249,115,22,0.15)',
                }}
              >
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* ── Input ── */}
          <div
            className="px-4 pb-4 pt-2.5 shrink-0"
            style={{ borderTop: '1px solid rgba(249,115,22,0.08)' }}
          >
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Frag Chipy was…"
                rows={1}
                disabled={loading}
                className="flex-1 resize-none rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none transition-colors disabled:opacity-40"
                style={{
                  maxHeight: 96,
                  lineHeight: '1.5',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(249,115,22,0.3)';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 96) + 'px';
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                aria-label="Senden"
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white transition-all disabled:opacity-20 disabled:cursor-not-allowed hover:scale-105 active:scale-95 shrink-0"
                style={{
                  background: !input.trim() || loading
                    ? 'rgba(255,255,255,0.05)'
                    : 'linear-gradient(135deg, #F97316, #EA580C)',
                }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <p className="text-[10px] text-white/15 mt-1.5 text-center">
              Enter senden · Shift+Enter neue Zeile
            </p>
          </div>
        </div>
      )}
    </>
  );
}
