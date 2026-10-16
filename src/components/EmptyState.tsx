import React from 'react';
import { Brain, RefreshCw, Sparkles, AlertTriangle } from 'lucide-react';
import type { PromptTemplate } from '../types/index.ts';

interface EmptyStateProps {
  promptTemplates: PromptTemplate[];
  promptStatus: 'loading' | 'ready' | 'unavailable';
  promptError?: string | null;
  onSelectPrompt: (promptText: string) => void;
  onRefreshPrompts: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  promptTemplates,
  promptStatus,
  promptError,
  onSelectPrompt,
  onRefreshPrompts,
}) => (
  <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 text-center my-auto">
    <div className="relative mb-5">
      <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-amber-500/20 via-amber-400/30 to-amber-600/20 blur-xl" />
      <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white dark:bg-slate-900 border border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-400 shadow-xl ring-1 ring-amber-500/20">
        <Brain className="w-8 h-8 sm:w-10 sm:h-10" aria-hidden="true" />
      </div>
    </div>

    <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">
      Start a conversation
    </h2>
    <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
      Context-grounded suggestions appear here only when the live prompt service returns usable results.
    </p>

    {promptStatus === 'loading' && (
      <div role="status" className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
        <span>Loading suggestions from the configured service…</span>
      </div>
    )}

    {promptStatus === 'unavailable' && (
      <div role="alert" className="w-full max-w-lg rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-left">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Dynamic suggestions are unavailable
            </p>
            <p className="mt-1 break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {promptError || 'The live service did not return a usable status. No sample prompts were substituted.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefreshPrompts}
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-300"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry live suggestions
        </button>
      </div>
    )}

    {promptStatus === 'ready' && promptTemplates.length > 0 && (
      <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        {promptTemplates.map((item, index) => (
          <button
            key={`${item.title}-${index}`}
            type="button"
            onClick={() => onSelectPrompt(item.prompt)}
            className="group flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-amber-500/50 hover:bg-slate-50 active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900/80 dark:hover:bg-slate-800/90"
          >
            {item.category && (
              <span className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                {item.category}
              </span>
            )}
            <span className="text-sm font-semibold text-slate-900 group-hover:text-amber-700 dark:text-slate-100 dark:group-hover:text-amber-300">
              {item.title}
            </span>
            {(item.description || item.desc) && (
              <span className="mt-1 line-clamp-3 break-words text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {item.description || item.desc}
              </span>
            )}
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Use suggestion
            </span>
          </button>
        ))}
      </div>
    )}
  </div>
);
