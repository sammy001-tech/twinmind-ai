import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Trash2, RefreshCw, Sparkles, ArrowRight, X, ShieldCheck } from 'lucide-react';
import { BeliefConflict } from '../types/index.ts';

interface BeliefConflictCardProps {
  conflict: BeliefConflict;
  onResolved?: (conflictId: string, action: 'update' | 'retire' | 'evolve', message: string) => void;
  onDismiss?: (conflictId: string) => void;
  className?: string;
}

export const BeliefConflictCard: React.FC<BeliefConflictCardProps> = ({
  conflict,
  onResolved,
  onDismiss,
  className = '',
}) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [resolutionStatus, setResolutionStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAction = async (action: 'update' | 'retire' | 'evolve') => {
    setIsExecuting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/knowledge/conflicts/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conflictId: conflict.id,
          docId: conflict.existingDocId,
          action,
          newStatement: conflict.userStatement,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Failed to resolve belief conflict');
      }

      setResolutionStatus(data.message || `Conflict resolved via ${action}`);
      onResolved?.(conflict.id, action, data.message);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsExecuting(false);
    }
  };

  if (resolutionStatus) {
    return (
      <div className={`p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 flex items-center gap-2.5 text-xs ${className}`}>
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="font-medium">{resolutionStatus}</span>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-2xl bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/30 shadow-lg text-slate-800 dark:text-slate-200 space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/30">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-[11px] font-black text-amber-800 dark:text-amber-200 uppercase tracking-tighter flex items-center gap-1.5">
              <span>Intellectual Integrity Auditor</span>
              <span className="px-1.5 py-0.5 rounded-full bg-amber-600 text-white font-mono text-[9px]">
                {conflict.conflictType.replace('_', ' ')}
              </span>
            </h4>
            <div className="text-[10px] font-bold text-amber-700/70 dark:text-amber-400/70">
              PREMISE TENSION DETECTED
            </div>
          </div>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(conflict.id)}
            className="p-1 rounded-lg text-amber-400 hover:text-amber-600 dark:hover:text-amber-200 transition"
            title="Dismiss tension banner"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Explanation */}
      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-normal">
        {conflict.explanation}
      </p>

      {/* Contrast Box */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        {/* Left: Stored Premise */}
        <div className="p-2.5 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 space-y-1">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1">
            <History className="w-3 h-3 text-slate-400" />
            <span>Stored Record #{conflict.existingDocId}</span>
          </div>
          <div className="font-semibold text-slate-900 dark:text-white line-clamp-1">
            {conflict.existingTitle}
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-[10px] italic line-clamp-2">
            "{conflict.existingExcerpt}"
          </p>
        </div>

        {/* Right: User's New Statement */}
        <div className="p-2.5 rounded-xl bg-amber-500/15 dark:bg-amber-950/50 border border-amber-500/30 space-y-1">
          <div className="text-[10px] uppercase font-bold tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-500" />
            <span>Your Current Statement</span>
          </div>
          <p className="font-medium text-slate-900 dark:text-amber-100 line-clamp-2">
            "{conflict.userStatement}"
          </p>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-[11px]">
          {errorMessage}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-amber-500/20">
        <button
          type="button"
          disabled={isExecuting}
          onClick={() => handleAction('evolve')}
          className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
          title="Keep historical record intact while adding a timestamped strategic evolution note"
        >
          <History className="w-3.5 h-3.5" />
          <span>Mark as Strategic Evolution</span>
        </button>

        <button
          type="button"
          disabled={isExecuting}
          onClick={() => handleAction('update')}
          className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
          title="Rewrite the stored memory with your new statement"
        >
          <RefreshCw className="w-3 h-3 text-slate-600 dark:text-slate-300" />
          <span>Update Stored Memory</span>
        </button>

        <button
          type="button"
          disabled={isExecuting}
          onClick={() => handleAction('retire')}
          className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition flex items-center gap-1.5 ml-auto disabled:opacity-50"
          title="Permanently remove the outdated record from your vault"
        >
          <Trash2 className="w-3 h-3" />
          <span>Retire Old Belief</span>
        </button>
      </div>
    </div>
  );
};
