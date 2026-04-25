import React, { useRef, useState } from 'react';
import { uploadKnowledgePdf, type AgentConfig, type KnowledgeSource, type VocabularyTerm } from '../../lib/api.js';
import { SectionCard, Input, TextArea, Badge, IconKnowledge, IconGlobe, IconFileText, IconMessageSquare, IconBookOpen } from './shared.js';
import { AdaptiveTextarea } from '../../components/AdaptiveTextarea.js';

export interface KnowledgeTabProps {
  config: AgentConfig;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}

export function KnowledgeTab({ config, onUpdate }: KnowledgeTabProps) {
  const sources = config.knowledgeSources ?? [];
  const vocab = readVocabulary(config);

  return (
    <>
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

      <KnowledgeAdder tenantId={config.tenantId} onAdd={(src) => {
        onUpdate({ knowledgeSources: [...sources, src] });
      }} />
    </SectionCard>

    <SectionCard title="Spezielle Begriffe" icon={IconBookOpen}>
      <p className="text-sm text-white/50 mb-4">
        Begriffe die Chipy korrekt aussprechen und im Kontext verstehen soll —
        Produktnamen, Fachausdrücke, Fremdwörter. Optional kannst du erklären,
        was der Begriff bedeutet und wann/mit wem er typischerweise vorkommt;
        Chipy nutzt das, um den Begriff im richtigen Moment passend einzusetzen.
      </p>

      <VocabularyEditor
        items={vocab}
        onChange={(items) => onUpdate({ customVocabulary: items })}
      />
    </SectionCard>
    </>
  );
}

// ── Vocabulary helpers ─────────────────────────────────────────────────
// Old configs stored `customVocabulary` as `string[]`. We accept that shape
// transparently and surface every entry as a `VocabularyTerm` so the editor
// only ever has to deal with one type. Empty terms stay in the list so the
// user can click „+ Begriff hinzufügen" and immediately see the new card to
// type into. The backend (agent-instructions.ts) skips empty terms when
// emitting the prompt block.
function readVocabulary(cfg: AgentConfig): VocabularyTerm[] {
  const raw = cfg.customVocabulary;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? { term: item } : item))
    .filter((it): it is VocabularyTerm => !!it && typeof it.term === 'string');
}

function VocabularyEditor({
  items,
  onChange,
}: {
  items: VocabularyTerm[];
  onChange: (items: VocabularyTerm[]) => void;
}) {
  function patch(idx: number, p: Partial<VocabularyTerm>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...p } : it));
    onChange(next);
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...items, { term: '' }]);
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="text-sm text-white/30 italic">Noch keine Begriffe hinzugefügt.</p>
      )}

      {items.map((it, i) => (
        <div
          key={i}
          className="rounded-xl border border-white/[0.08] bg-white/[0.025] overflow-hidden"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
            <Input
              value={it.term}
              onChange={(e) => patch(i, { term: e.target.value })}
              placeholder="Begriff (z. B. Balayage, Keratin, Pony, HVAC)"
              className="flex-1 !bg-transparent !border-white/[0.06]"
              maxLength={120}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="shrink-0 text-white/30 hover:text-red-400 transition-colors p-1.5 cursor-pointer"
              aria-label="Begriff entfernen"
              title="Begriff entfernen"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="px-3 py-2 space-y-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">
                Was bedeutet das?
              </p>
              <AdaptiveTextarea
                value={it.explanation ?? ''}
                onChange={(e) => patch(i, { explanation: e.target.value })}
                placeholder={'Kurz erklärt — z. B. „Französische Färbetechnik mit fließenden Übergängen".'}
                minRows={1}
                maxLength={500}
                className="w-full bg-transparent text-xs text-white/80 leading-relaxed outline-none focus:ring-0 border-0 placeholder:text-white/25"
              />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">
                Wann / mit wem benutzt?
              </p>
              <AdaptiveTextarea
                value={it.context ?? ''}
                onChange={(e) => patch(i, { context: e.target.value })}
                placeholder={'Z. B. „Wenn Stammkundinnen 25+ nach modernen Strähnchen fragen — passt nicht zu Erstkundinnen unter 20".'}
                minRows={1}
                maxLength={500}
                className="w-full bg-transparent text-xs text-white/80 leading-relaxed outline-none focus:ring-0 border-0 placeholder:text-white/25"
              />
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="text-xs text-white/55 hover:text-white/85 transition-colors cursor-pointer rounded-full border border-white/10 hover:border-white/25 px-4 py-1.5"
      >
        + Begriff hinzufügen
      </button>
    </div>
  );
}

function KnowledgeAdder({ tenantId, onAdd }: { tenantId: string; onAdd: (src: KnowledgeSource) => void }) {
  const [mode, setMode] = useState<'url' | 'text' | null>(null);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [text, setText] = useState('');
  const [textName, setTextName] = useState('');
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function pdfErrorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.includes('PDF_TOO_LARGE')) return 'PDF ist zu gross. Maximal 50 MB.';
    if (raw.includes('PDF_INVALID')) return 'Diese Datei sieht nicht wie eine PDF aus.';
    if (raw.includes('PDF_ONLY')) return 'Bitte eine PDF-Datei hochladen.';
    if (raw.includes('Database not configured')) return 'PDF-Upload ist gerade nicht verfuegbar.';
    return 'PDF konnte nicht hochgeladen werden.';
  }

  async function addPdf(file: File | null | undefined) {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setPdfError('Bitte eine PDF-Datei hochladen.');
      return;
    }

    setPdfUploading(true);
    setPdfError('');
    try {
      const source = await uploadKnowledgePdf(tenantId, file);
      onAdd(source);
    } catch (err) {
      setPdfError(pdfErrorMessage(err));
    } finally {
      setPdfUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

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
      <div className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => void addPdf(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setMode('url')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/60 hover:border-orange-500/30 hover:text-white transition-all cursor-pointer">
            <IconGlobe size={13} className="text-white/40" /> Website-URL
          </button>
          <button onClick={() => setMode('text')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/60 hover:border-orange-500/30 hover:text-white transition-all cursor-pointer">
            <IconMessageSquare size={13} className="text-white/40" /> Eigener Text
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={pdfUploading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/[0.07] bg-white/[0.03] text-xs text-white/60 hover:border-orange-500/30 hover:text-white transition-all cursor-pointer disabled:cursor-wait disabled:text-white/35 disabled:bg-white/[0.02]"
          >
            <IconFileText size={13} className="text-white/40" /> {pdfUploading ? 'PDF laedt...' : 'PDF hochladen'}
          </button>
        </div>
        {pdfError && <p className="text-xs text-red-300/80">{pdfError}</p>}
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
