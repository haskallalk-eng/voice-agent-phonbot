import React, { useState } from 'react';
import type { AgentConfig, KnowledgeSource } from '../../lib/api.js';
import { SectionCard, Input, TextArea, Badge, IconKnowledge, IconGlobe, IconFileText, IconMessageSquare } from './shared.js';

export interface KnowledgeTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function KnowledgeTab({ config, onUpdate }: KnowledgeTabProps) {
  const sources = config.knowledgeSources ?? [];

  return (
    <SectionCard title="Wissensquellen" icon={IconKnowledge}>
      <p className="text-sm text-white/50 mb-4">
        Eigene Texte und Website-URLs werden beim Speichern/Deploy als Retell Knowledge Base mit dem Agenten verbunden.
      </p>

      {sources.length > 0 && (
        <div className="space-y-2 mb-4">
          {sources.map((src, i) => (
            <div key={src.id} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
              <span className="text-white/40 shrink-0">
                {src.type === 'url' ? <IconGlobe size={16} /> : src.type === 'pdf' ? <IconFileText size={16} /> : <IconMessageSquare size={16} />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{src.name}</p>
                <p className="text-xs text-white/40 truncate">{src.type === 'url' ? (src.url ?? src.content) : src.content}</p>
                {src.error && <p className="text-[10px] text-red-300/75 truncate">{src.error}</p>}
              </div>
              <Badge color={src.status === 'indexed' ? 'green' : src.status === 'error' ? 'red' : 'orange'}>
                {src.status === 'indexed' ? 'Bereit' : src.status === 'error' ? 'Fehler' : 'Wartet'}
              </Badge>
              <button onClick={() => {
                const next = [...sources];
                next.splice(i, 1);
                onUpdate({ knowledgeSources: next });
              }} className="text-white/30 hover:text-red-400 transition-colors cursor-pointer" aria-label="Entfernen">
                <IconFileText size={13} className="rotate-45" />
              </button>
            </div>
          ))}
        </div>
      )}

      <KnowledgeAdder onAdd={(src) => {
        onUpdate({ knowledgeSources: [...sources, src] });
      }} />
    </SectionCard>
  );
}

function KnowledgeAdder({ onAdd }: { onAdd: (src: KnowledgeSource) => void }) {
  const [mode, setMode] = useState<'url' | 'text' | null>(null);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [text, setText] = useState('');
  const [textName, setTextName] = useState('');

  function addUrl() {
    const raw = url.trim();
    if (!raw) return;

    let parsed: URL;
    try {
      parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      setUrlError('Bitte eine gueltige URL eingeben.');
      return;
    }

    onAdd({
      id: crypto.randomUUID(),
      type: 'url',
      name: parsed.hostname,
      url: parsed.toString(),
      content: parsed.toString(),
      status: 'pending',
    });
    setUrl('');
    setUrlError('');
    setMode(null);
  }

  function addText() {
    const body = text.trim();
    if (!body) return;
    onAdd({
      id: crypto.randomUUID(),
      type: 'text',
      name: textName.trim() || 'Eigener Text',
      content: body,
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
        <button onClick={() => setMode('text')}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/60 hover:border-orange-500/30 hover:text-white transition-all cursor-pointer">
          <IconMessageSquare size={13} className="text-white/40" /> Eigener Text
        </button>
        <button disabled title="PDF-Verarbeitung folgt"
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.02] text-xs text-white/30 cursor-not-allowed">
          <IconFileText size={13} className="text-white/25" /> PDF folgt
        </button>
      </div>
    );
  }

  if (mode === 'url') {
    return (
      <div className="space-y-2">
        <div className="flex gap-3">
          <Input value={url} onChange={(e) => { setUrl(e.target.value); setUrlError(''); }} placeholder="https://meineseite.de/preise"
            className="flex-1" onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
          <button onClick={addUrl}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
            Hinzufuegen
          </button>
          <button onClick={() => { setMode(null); setUrlError(''); }} className="text-white/40 hover:text-white/70 text-sm">Abbrechen</button>
        </div>
        {urlError && <p className="text-xs text-red-300/80">{urlError}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Input value={textName} onChange={(e) => setTextName(e.target.value)} placeholder="Name (z.B. Preisliste)" />
      <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dein Text hier..." />
      <div className="flex gap-3">
        <button onClick={addText}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
          Hinzufuegen
        </button>
        <button onClick={() => setMode(null)} className="text-white/40 hover:text-white/70 text-sm">Abbrechen</button>
      </div>
    </div>
  );
}
