import React, { useState, useRef } from 'react';
import { cloneVoice, type Voice } from '../../lib/api.js';
import { IconMicUpload, IconRefresh } from './shared.js';

const VOICE_PROVIDERS = [
  { value: 'cartesia', label: 'Cartesia (empfohlen)' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'fish_audio', label: 'Fish Audio' },
] as const;

export interface VoiceClonePanelProps {
  onVoiceCloned: (voice: Voice) => void;
}

export function VoiceClonePanel({ onVoiceCloned }: VoiceClonePanelProps) {
  const [mode, setMode] = useState<'idle' | 'upload' | 'record'>('idle');
  const [provider, setProvider] = useState('cartesia');

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Record state
  const [recordName, setRecordName] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Convert any audio blob (webm, ogg, etc.) -> WAV (PCM 16-bit mono)
  async function blobToWavFile(blob: Blob, filename = 'recording.wav'): Promise<File> {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    await audioCtx.close();

    const numChannels = 1; // mono
    const sampleRate = audioBuffer.sampleRate;
    const samples = audioBuffer.getChannelData(0);
    const dataLen = samples.length * 2;
    const buf = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buf);

    function writeStr(offset: number, str: string) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataLen, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byteRate
    view.setUint16(32, 2, true); // blockAlign
    view.setUint16(34, 16, true); // bitsPerSample
    writeStr(36, 'data');
    view.setUint32(40, dataLen, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }

    return new File([buf], filename, { type: 'audio/wav' });
  }

  function stopLevelMonitor() {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    analyserRef.current = null;
  }

  function startLevelMonitor(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      function tick() {
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        setLevel(Math.min(1, avg / 60));
        animFrameRef.current = requestAnimationFrame(tick);
      }
      tick();
    } catch {
      // AudioContext not available -- ignore
    }
  }

  async function startRecording() {
    setRecordError(null);
    setRecordedBlob(null);
    setRecordSeconds(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startLevelMonitor(stream);
      // Pick the best supported mimeType (prefer webm, fall back to ogg/mp4)
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4']
        .find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setRecordedBlob(blob);
        stopLevelMonitor();
        setLevel(0);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      mr.start();
      setRecording(true);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      setRecordError('Mikrofon konnte nicht geöffnet werden. Bitte Berechtigungen prüfen.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function handleUploadClone() {
    if (!uploadFile || !uploadName.trim()) return;
    setUploading(true);
    setUploadError(null);
    try {
      const voice = await cloneVoice(uploadName.trim(), uploadFile, provider);
      onVoiceCloned(voice);
      setUploadFile(null);
      setUploadName('');
      setMode('idle');
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

  async function handleRecordClone() {
    if (!recordedBlob || !recordName.trim()) return;
    setUploading(true);
    setRecordError(null);
    try {
      const file = await blobToWavFile(recordedBlob, 'recording.wav');
      const voice = await cloneVoice(recordName.trim(), file, provider);
      onVoiceCloned(voice);
      setRecordedBlob(null);
      setRecordName('');
      setRecordSeconds(0);
      setMode('idle');
    } catch (e) {
      setRecordError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  }

  function fmtTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return (
    <section className="glass rounded-2xl p-6 mb-6">
      <div className="flex items-center gap-3 mb-1">
        <IconMicUpload size={20} className="text-cyan-400" />
        <h3 className="text-lg font-semibold text-white">Eigene Stimme klonen</h3>
      </div>
      <p className="text-sm text-white/50 mb-4">
        Lade eine Aufnahme hoch oder nimm direkt auf — Phonbot klont deine Stimme via Retell Voice Cloning.
        Mindestlänge: 30 Sekunden.
      </p>

      {/* Provider selector -- always visible when not idle */}
      {mode !== 'idle' && (
        <div className="mb-3">
          <label className="block text-xs text-white/40 mb-1.5">Voice Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            {VOICE_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className="text-xs text-white/30 mt-1">ElevenLabs unterstützt bis zu 25 Audiodateien \· Cartesia & MiniMax nur 1 Datei</p>
        </div>
      )}

      {mode === 'idle' && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setMode('upload')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 hover:border-cyan-500/40 hover:text-white transition-all"
          >
            <IconMicUpload size={16} className="text-cyan-400" />
            Datei hochladen
          </button>
          <button
            type="button"
            onClick={() => setMode('record')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 hover:border-orange-500/40 hover:text-white transition-all"
          >
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
            Stimme aufnehmen
          </button>
        </div>
      )}

      {mode === 'upload' && (
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            className="hidden"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
          />
          {/* Drag & Drop Zone */}
          {!uploadFile ? (
            <div
              className="relative rounded-2xl border-2 border-dashed border-white/10 hover:border-orange-500/25 transition-all cursor-pointer py-10 px-6 text-center"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-orange-500/40', 'bg-orange-500/5'); }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-orange-500/40', 'bg-orange-500/5'); }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('border-orange-500/40', 'bg-orange-500/5');
                const file = e.dataTransfer.files[0];
                if (file && (file.type.includes('audio') || file.name.match(/\.(mp3|wav|m4a|ogg|webm)$/i))) {
                  setUploadFile(file);
                } else {
                  setUploadError('Bitte eine Audio-Datei (MP3, WAV) verwenden');
                }
              }}
            >
              <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(6,182,212,0.08))' }}>
                <IconMicUpload size={20} className="text-orange-400" />
              </div>
              <p className="text-sm text-white/50 mb-1">Audio-Datei hierher ziehen</p>
              <p className="text-[11px] text-white/25">oder klicken zum Auswählen · MP3, WAV · Min. 30 Sek.</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(6,182,212,0.1))' }}>
                <IconMicUpload size={14} className="text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{uploadFile.name}</p>
                <p className="text-[10px] text-white/30">{(uploadFile.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
              <button onClick={() => setUploadFile(null)} className="text-white/20 hover:text-red-400 transition-colors cursor-pointer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          )}
          <div>
            <label className="text-sm text-white/60 block mb-1">Name der Stimme</label>
            <input
              type="text"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="z.B. Meine Stimme"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
            />
          </div>
          {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleUploadClone}
              disabled={!uploadFile || !uploadName.trim() || uploading}
              className="rounded-lg bg-gradient-to-r from-cyan-500 to-orange-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {uploading ? 'Wird hochgeladen…' : 'Stimme klonen'}
            </button>
            <button type="button" onClick={() => { setMode('idle'); setUploadFile(null); setUploadError(null); }}
              className="text-sm text-white/40 hover:text-white/70">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {mode === 'record' && (
        <div className="space-y-3">
          {/* Waveform / level indicator */}
          <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
            <div className="flex items-end gap-0.5 h-8">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-sm transition-all duration-75"
                  style={{
                    height: recording
                      ? `${Math.max(4, Math.round(level * 32 * (0.5 + Math.random() * 0.5)))}px`
                      : '4px',
                    backgroundColor: recording ? '#22d3ee' : '#ffffff20',
                  }}
                />
              ))}
            </div>
            <span className="text-sm font-mono text-white/60">{fmtTime(recordSeconds)}</span>
            {recordedBlob && !recording && (
              <span className="text-xs text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full">
                Aufnahme bereit
              </span>
            )}
          </div>

          <div className="flex gap-3">
            {!recording && !recordedBlob && (
              <button
                type="button"
                onClick={startRecording}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300 hover:bg-red-500/30 transition-all"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                Aufnahme starten
              </button>
            )}
            {recording && (
              <button
                type="button"
                onClick={stopRecording}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/30 border border-red-500/50 text-sm text-red-200 hover:bg-red-500/40 transition-all animate-pulse"
              >
                <span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />
                Aufnahme stoppen
              </button>
            )}
            {recordedBlob && !recording && (
              <button
                type="button"
                onClick={() => { setRecordedBlob(null); setRecordSeconds(0); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white/50 hover:text-white transition-all"
              >
                <IconRefresh size={14} />
                Neu aufnehmen
              </button>
            )}
          </div>

          {recordedBlob && !recording && (
            <>
              <div>
                <label className="text-sm text-white/60 block mb-1">Name der Stimme</label>
                <input
                  type="text"
                  value={recordName}
                  onChange={(e) => setRecordName(e.target.value)}
                  placeholder="z.B. Meine Stimme"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-orange-500/50 outline-none"
                />
              </div>
              {recordError && <p className="text-xs text-red-400">{recordError}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleRecordClone}
                  disabled={!recordName.trim() || uploading}
                  className="rounded-lg bg-gradient-to-r from-cyan-500 to-orange-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {uploading ? 'Wird hochgeladen…' : 'Stimme klonen'}
                </button>
                <button type="button" onClick={() => { setMode('idle'); setRecordedBlob(null); setRecordError(null); setRecordSeconds(0); }}
                  className="text-sm text-white/40 hover:text-white/70">
                  Abbrechen
                </button>
              </div>
            </>
          )}

          {!recordedBlob && !recording && (
            <button type="button" onClick={() => setMode('idle')}
              className="text-sm text-white/40 hover:text-white/70">
              Abbrechen
            </button>
          )}
        </div>
      )}
    </section>
  );
}
