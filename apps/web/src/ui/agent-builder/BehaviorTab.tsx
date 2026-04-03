import React from 'react';
import type { AgentConfig } from '../../lib/api.js';
import {
  SectionCard, TextArea, Input, Toggle,
  PROMPT_TEMPLATES, PROMPT_SECTIONS, KNOWN_TOOLS,
  IconTemplate, IconMessageSquare,
} from './shared.js';

export interface BehaviorTabProps {
  config: AgentConfig;
  activePromptSections: Set<string>;
  onUpdate: (patch: Partial<AgentConfig>) => void;
  onTogglePromptSection: (sectionId: string) => void;
  onSetActivePromptSections: (sections: Set<string>) => void;
}

export function BehaviorTab({
  config,
  activePromptSections,
  onUpdate,
  onTogglePromptSection,
  onSetActivePromptSections,
}: BehaviorTabProps) {
  return (
    <>
      {/* Base Role */}
      <SectionCard title="Grundrolle" icon={IconTemplate} collapsible>
        <p className="text-xs text-white/40 mb-3">Legt fest wof\ür der Agent haupts\ächlich eingesetzt wird — setzt den Prompt zur\ück.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {PROMPT_TEMPLATES.map((tpl) => (
            <button key={tpl.id} onClick={() => {
              const prompt = tpl.prompt.replace('{businessName}', config.businessName || 'deinem Unternehmen');
              onUpdate({ systemPrompt: prompt });
              onSetActivePromptSections(new Set());
            }}
              className="group flex flex-col items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-orange-500/30 hover:bg-white/[0.06] transition-all text-center cursor-pointer">
              <tpl.Icon size={18} className={tpl.accent} />
              <span className="text-xs font-medium text-white/65 group-hover:text-white/90 transition-colors leading-tight">{tpl.name}</span>
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Section Blocks */}
      <SectionCard title="Verhaltens-Abschnitte" icon={IconMessageSquare}>
        <p className="text-xs text-white/40 mb-3">Aktiviere Abschnitte — jeder f\ügt einen Textblock zum Prompt hinzu. Nochmal klicken entfernt ihn.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-5">
          {PROMPT_SECTIONS.map((sec) => {
            const isActive = activePromptSections.has(sec.id);
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => onTogglePromptSection(sec.id)}
                className={`group flex items-start gap-2.5 p-3 rounded-xl border transition-all text-left cursor-pointer ${
                  isActive
                    ? 'border-orange-500/35 bg-orange-500/[0.07]'
                    : 'border-white/[0.07] bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.06]'
                }`}
              >
                <sec.Icon
                  size={13}
                  className={`shrink-0 mt-0.5 transition-colors ${isActive ? sec.accent : 'text-white/25 group-hover:text-white/45'}`}
                />
                <div className="min-w-0">
                  <p className={`text-xs font-semibold leading-tight transition-colors ${isActive ? 'text-white' : 'text-white/55 group-hover:text-white/80'}`}>
                    {sec.label}
                  </p>
                  <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{sec.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Assembled Prompt */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Prompt</span>
            {activePromptSections.size > 0 && (
              <span className="text-[10px] text-orange-400/70 bg-orange-500/10 border border-orange-500/15 px-2 py-0.5 rounded-full">
                {activePromptSections.size} Abschnitt{activePromptSections.size !== 1 ? 'e' : ''} aktiv
              </span>
            )}
          </div>
          <TextArea
            rows={10}
            value={config.systemPrompt}
            onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
            placeholder="Aktiviere Abschnitte oben oder schreibe deinen Prompt direkt hier\…"
          />
        </div>

        <div className="mt-4">
          <span className="text-xs font-medium text-white/40 uppercase tracking-wider block mb-2">Aktive Tools</span>
          <div className="flex flex-wrap gap-2">
            {KNOWN_TOOLS.map((tool) => (
              <label key={tool} className="flex items-center gap-2 text-xs cursor-pointer select-none text-white/55">
                <input type="checkbox" checked={config.tools.includes(tool)}
                  onChange={(e) => {
                    const next = new Set(config.tools);
                    e.target.checked ? next.add(tool) : next.delete(tool);
                    onUpdate({ tools: Array.from(next) });
                  }}
                  className="rounded border-white/20 bg-white/5 text-orange-500 focus:ring-orange-500/50" />
                <code className="text-[11px] bg-white/[0.07] text-white/50 px-2 py-0.5 rounded">{tool}</code>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <Toggle checked={config.fallback.enabled}
            onChange={(v) => onUpdate({ fallback: { ...config.fallback, enabled: v } })}
            label="Fallback / Handoff aktiv" />
          {config.fallback.enabled && (
            <Input value={config.fallback.reason}
              onChange={(e) => onUpdate({ fallback: { ...config.fallback, reason: e.target.value } })}
              placeholder="Grund" className="!w-48" />
          )}
        </div>
      </SectionCard>
    </>
  );
}
