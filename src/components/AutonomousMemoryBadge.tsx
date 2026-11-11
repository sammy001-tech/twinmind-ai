import React, { useState } from 'react';
import { AutonomousMemoryEvent } from '../types/index.ts';
import {
  Brain,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  X,
  BookOpen,
} from 'lucide-react';
import { renderFormattedMarkdown } from '../utils/markdown.tsx';

interface AutonomousMemoryBadgeProps {
  memoryEvent: AutonomousMemoryEvent;
  onOpenVault?: () => void;
}

export const AutonomousMemoryBadge: React.FC<AutonomousMemoryBadgeProps> = ({
  memoryEvent,
  onOpenVault,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const isUpdate = memoryEvent.action === 'update_existing';

  return (
    <div className="my-2 select-none animate-in fade-in duration-200">
      {/* Micro Badge Trigger */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition shadow-xs border ${
          isUpdate
            ? 'bg-purple-500/10 hover:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30'
            : 'bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
        }`}
      >
        <div className="flex items-center gap-1.5">
          {isUpdate ? (
            <RefreshCw className="w-3.5 h-3.5 text-purple-500 animate-spin-slow" />
          ) : (
            <Brain className="w-3.5 h-3.5 text-emerald-500" />
          )}
          <span>
            {isUpdate ? 'Vault Stance Updated' : 'Saved to Memory Vault'}
          </span>
          <span className="opacity-40">•</span>
          <span className="font-bold truncate max-w-[200px] sm:max-w-[280px]">
            "{memoryEvent.docTitle}"
          </span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono bg-white/60 dark:bg-slate-900/60 border border-slate-300/40 dark:border-slate-700/40">
            {memoryEvent.confidenceScore}% Confidence
          </span>
        </div>
        <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
      </div>

      {/* Expanded Micro Drawer */}
      {isExpanded && (
        <div className="mt-2 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-w-lg space-y-2.5 text-xs text-slate-700 dark:text-slate-300">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className={`w-4 h-4 ${isUpdate ? 'text-purple-500' : 'text-emerald-500'}`} />
              <span className="font-bold text-slate-900 dark:text-white">
                {isUpdate ? 'In-Place Evolutionary Vault Update' : 'New Memory Document Created'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-400 block text-[10px]">Classification Tier</span>
              <strong className="text-slate-900 dark:text-white capitalize">{memoryEvent.tier} Stance</strong>
            </div>
            <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-400 block text-[10px]">Category</span>
              <strong className="text-slate-900 dark:text-white capitalize">{memoryEvent.category.replace(/_/g, ' ')}</strong>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-500">Extracted User Turn:</span>
            <blockquote className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 italic text-[11px]">
              "{memoryEvent.userStatementSnippet}"
            </blockquote>
          </div>

          {memoryEvent.updatedContent && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-slate-500">
                {isUpdate ? 'Updated Document Content (with Dated Evolution Log):' : 'Stored Content:'}
              </span>
              <div className="p-2.5 rounded-lg bg-slate-950 text-slate-200 max-h-40 overflow-y-auto text-[11px] leading-relaxed font-mono">
                {renderFormattedMarkdown(memoryEvent.updatedContent)}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-slate-400">
              Vector Indexed (768-dim) • Neon PostgreSQL
            </span>

            {onOpenVault && (
              <button
                type="button"
                onClick={onOpenVault}
                className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-[11px] transition flex items-center gap-1 shadow-xs"
              >
                <BookOpen className="w-3 h-3" />
                <span>Inspect in Vault</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
