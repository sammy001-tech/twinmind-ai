import React, { useState } from 'react';
import { AutonomousMemoryEvent } from '../types/index.ts';
import { BookOpen, ChevronRight, Shield, X } from 'lucide-react';

interface AutonomousMemoryBadgeProps {
  memoryEvent: AutonomousMemoryEvent;
  onOpenVault?: (docId?: string | number) => void;
}

export const AutonomousMemoryBadge: React.FC<AutonomousMemoryBadgeProps> = ({
  memoryEvent,
  onOpenVault,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isRuleEvent = memoryEvent.target === 'rule';

  const handleClick = () => {
    if (onOpenVault) {
      onOpenVault(memoryEvent.docId);
      return;
    }
    setIsExpanded((prev) => !prev);
  };

  return (
    <div className="mb-2 select-none animate-in fade-in duration-150">
      {/* Subtle inline indicator matching clean conversational UI */}
      <button
        type="button"
        onClick={handleClick}
        title={
          isRuleEvent
            ? `Open Active Rules${memoryEvent.ruleId ? ` (#${memoryEvent.ruleId})` : ''}`
            : memoryEvent.docTitle
              ? `Open "${memoryEvent.docTitle}" in Memory Vault`
              : 'Open Memory Vault'
        }
        className="group/mem inline-flex items-center gap-1.5 py-0.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors cursor-pointer"
      >
        {isRuleEvent ? (
          <Shield className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
        ) : (
          <BookOpen className="w-3.5 h-3.5 shrink-0" />
        )}
        <span>{isRuleEvent ? 'Active rule updated' : 'Memory updated'}</span>
        <ChevronRight className="w-3 h-3 opacity-0 group-hover/mem:opacity-70 transition-opacity" />
      </button>

      {/* Fallback inspection popover when rendered without navigation callback */}
      {isExpanded && !onOpenVault && (
        <div className="mt-1.5 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg max-w-md space-y-2 text-xs text-slate-700 dark:text-slate-300">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <BookOpen className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
              <span className="font-semibold text-slate-900 dark:text-white truncate">
                {memoryEvent.docTitle}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Close memory details"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            {memoryEvent.userStatementSnippet}
          </p>
        </div>
      )}
    </div>
  );
};
