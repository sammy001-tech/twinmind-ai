import React from 'react';
import { Search, X, ChevronUp, ChevronDown, Filter } from 'lucide-react';

interface ChatSearchInputProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClear: () => void;
  matchCount: number;
  currentMatchIndex: number;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  filterOnlyMatches: boolean;
  onToggleFilterOnly: () => void;
  onClose: () => void;
}

export const ChatSearchInput: React.FC<ChatSearchInputProps> = ({
  query,
  onQueryChange,
  onClear,
  matchCount,
  currentMatchIndex,
  onNextMatch,
  onPrevMatch,
  filterOnlyMatches,
  onToggleFilterOnly,
  onClose,
}) => {
  return (
    <div className="bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-3.5 py-2 flex items-center gap-2 backdrop-blur-md sticky top-[57px] z-20 transition-all">
      <div className="relative flex-1 flex items-center min-w-0">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search in chat conversation..."
          autoFocus
          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700/80 rounded-xl pl-8 pr-16 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        {query && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white"
            title="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Match indicator and stepper controls */}
      {query.trim().length > 0 && (
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] font-mono text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800">
            {matchCount > 0 ? `${currentMatchIndex + 1}/${matchCount}` : '0 results'}
          </span>

          {matchCount > 0 && (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={onPrevMatch}
                disabled={matchCount <= 1}
                className="p-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-30 border border-slate-300 dark:border-slate-700"
                title="Previous match"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onNextMatch}
                disabled={matchCount <= 1}
                className="p-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-30 border border-slate-300 dark:border-slate-700"
                title="Next match"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Toggle filter-only vs highlight all */}
          <button
            type="button"
            onClick={onToggleFilterOnly}
            className={`px-2 py-1 rounded-lg text-[11px] font-medium transition flex items-center gap-1 ${
              filterOnlyMatches
                ? 'bg-amber-500 text-slate-950 font-bold'
                : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700'
            }`}
            title={filterOnlyMatches ? 'Showing only matching messages' : 'Highlighting within full thread'}
          >
            <Filter className="w-3 h-3" />
            <span className="hidden sm:inline">{filterOnlyMatches ? 'Filter' : 'All'}</span>
          </button>
        </div>
      )}

      {/* Close Search bar */}
      <button
        type="button"
        onClick={onClose}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0"
        title="Close search bar"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
