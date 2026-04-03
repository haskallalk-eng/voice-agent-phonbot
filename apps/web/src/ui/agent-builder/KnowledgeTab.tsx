import React, { useState, useRef } from 'react';
import type { AgentConfig, KnowledgeSource } from '../../lib/api.js';
import { SectionCard, Input, TextArea, Badge, IconBrain, IconGlobe, IconFileText, IconMessageSquare } from './shared.js';

export interface KnowledgeTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function KnowledgeTab({ config, onUpdate }: KnowledgeTabProps) {
  return (
    <SectionCard title="Wissensquellen" icon={IconBrain}>
      <p className="text-sm text-white/50 mb-4">
        Gib deinem Agent Zugang zu Informationen — er kann Inhalte von Webseiten lesen, PDFs verarbeiten oder eigene Texte nutzen.
      </p>

      {/* Existing sources */}
      {(config.knowledgeSources ?? []).length > 0 && (
        <div className="space-y-2 mb-4">
          {(config.knowledgeSources ?? []).map((src, i) => (
            <div key={src.id} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
              <span className="text-white/40 shrink-0">
                {src.type === 'url' ? <IconGlobe size={16} /> : src.type === 'pdf' ? <IconFileText size={16} /> : <IconMessageSquare size={16} />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{src.name}</p>
                <p className="text-xs text-white/40 truncate">{src.content}</p>
              </div>
              <Badge color={src.status === 'indexed' ? 'green' : src.status === 'error' ? 'red' : 'orange'}>
                {src.status === 'indexed' ? 'Indexiert' : src.status === 'error' ? 'Fehler' : 'Warte\…'}
              </Badge>
              <button onClick={() => {
                const next = [...(config.knowledgeSources ?? [])];
                next.splice(i, 1);
                onUpdate({ knowledgeSources: next });
              }} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer" aria-label="Entfernen">
                <IconFileText size={13} className="rotate-45" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new source */}
      <KnowledgeAdder onAdd={(src) => {
        onUpdate({ knowledgeSources: [...(config.knowledgeSources ?? []), src] });
      }} />
    </SectionCard>
  );
}

/* ── KnowledgeAdder (private to this module) ── */

function KnowledgeAdder({ onAdd }: { onAdd: (src: KnowledgeSource) => void }) {
  const [mode, setMode] = useState<'url' | 'pdf' | 'text' | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [textName, setTextName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function addUrl() {
    if (!url.trim()) return;
    onAdd({
      id: crypto.randomUUID(),
      type: 'url',
      name: new URL(url).hostname,
      content: url.trim(),
      status: 'pending',
    });
    setUrl('');
    setMode(null);
  }

  function addPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onAdd({
      id: crypto.randomUUID(),
      type: 'pdf',
      name: file.name,
      content: file.name,
      status: 'pending',
    });
    setMode(null);
  }

  function addText() {
    if (!text.trim()) return;
    onAdd({
      id: crypto.randomUUID(),
      type: 'text',
      name: textName || 'Eigener Text',
      content: text.trim(),
      status: 'pending',
    });
    setText('');
    setTextName('');
    setMode(null);
  }

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setMode('url')}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/60 hover:border-orange-500/30 hover:text-white transition-all cursor-pointer">
          <IconGlobe size={13} className="text-white/40" /> Website-URL
        </button>
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/60 hover:border-orange-500/30 hover:text-white transition-all cursor-pointer">
          <IconFileText size={13} className="text-white/40" /> PDF hochladen
        </button>
        <button onClick={() => setMode('text')}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/60 hover:border-orange-500/30 hover:text-white transition-all cursor-pointer">
          <IconMessageSquare size={13} className="text-white/40" /> Eigener Text
        </button>
        <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={addPdf} />
      </div>
    );
  }

  if (mode === 'url') {
    return (
      <div className="flex gap-3">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meineseite.de/preise"
          className="flex-1" onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
        <button onClick={addUrl}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
          Hinzuf\ügen
        </button>
        <button onClick={() => setMode(null)} className="text-white/40 hover:text-white/70 text-sm">Abbrechen</button>
      </div>
    );
  }

  if (mode === 'text') {
    return (
      <div className="space-y-3">
        <Input value={textName} onChange={(e) => setTextName(e.target.value)} placeholder="Name (z.B. Preisliste)" />
        <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dein Text hier\…" />
        <div className="flex gap-3">
          <button onClick={addText}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
            Hinzuf\ügen
          </button>
          <button onClick={() => setMode(null)} className="text-white/40 hover:text-white/70 text-sm">Abbrechen</button>
        </div>
      </div>
    );
  }

  return null;
}
