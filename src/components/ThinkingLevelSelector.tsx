import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevronUp, ChevronDown, Sparkles } from 'lucide-react';
import { ThinkingLevel } from '../types/index.ts';
import { THINKING_LEVEL_OPTIONS, getThinkingLevelOption } from '../utils/thinkingLevel.ts';

interface ThinkingLevelSelectorProps {
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void | Promise<void>;
  compact?: boolean;
  className?: string;
  dropUp?: boolean;
}

export const ThinkingLevelSelector: React.FC<ThinkingLevelSelectorProps> = ({
  value,
  onChange,
  compact = false,
  className = '',
  dropUp = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const currentOption = getThinkingLevelOption(value);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (level: ThinkingLevel) => {
    onChange(level);
    setIsOpen(false);
  };

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      {/* Trigger Button */}
      {compact ? (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition border ${
            isOpen
              ? 'bg-slate-200 dark:bg-[#2f3136] text-slate-900 dark:text-white border-amber-500/40 shadow-xs'
              : 'bg-slate-100 hover:bg-slate-200/80 dark:bg-[#25272a] dark:hover:bg-[#2f3136] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/60'
          }`}
          title={`Thinking level: ${currentOption.label} (${currentOption.description})`}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="font-semibold">{currentOption.label}</span>
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between gap-4 px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200/80 dark:bg-[#2a2b2e] dark:hover:bg-[#323338] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700/60 transition shadow-xs text-left"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <span className="text-[15px] font-medium tracking-tight">Thinking level</span>
          {isOpen ? (
            <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          )}
        </button>
      )}

      {/* Dropdown Menu - Matched 1:1 to Screenshot */}
      {isOpen && (
        <div
          role="listbox"
          aria-label="Thinking level options"
          className={`absolute z-50 w-72 max-w-[90vw] p-2 rounded-2xl bg-white dark:bg-[#1e1f22] border border-slate-200 dark:border-slate-800 shadow-2xl animate-in fade-in zoom-in-95 duration-150 ${
            dropUp ? 'bottom-full mb-2 left-0' : 'top-full mt-2 left-0'
          }`}
        >
          {/* Header inside menu when expanded (matching screenshot) */}
          {!compact && (
            <div className="flex items-center justify-between px-3 py-2.5 mb-1 text-slate-700 dark:text-slate-300 font-medium text-[15px] border-b border-slate-100 dark:border-slate-800/80">
              <span>Thinking level</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="space-y-1">
            {THINKING_LEVEL_OPTIONS.map((option) => {
              const isSelected = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(option.id)}
                  className={`w-full flex items-start gap-3.5 px-3 py-3 rounded-xl transition text-left group ${
                    isSelected
                      ? 'bg-slate-100 dark:bg-[#2b2d31]/80 text-slate-900 dark:text-white'
                      : 'hover:bg-slate-50 dark:hover:bg-[#2b2d31]/50 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {/* Left Checkmark Column */}
                  <div className="w-5 pt-0.5 flex justify-center shrink-0">
                    {isSelected ? (
                      <Check className="w-4 h-4 text-slate-800 dark:text-slate-100 stroke-[2.5]" />
                    ) : (
                      <span className="w-4 h-4" />
                    )}
                  </div>

                  {/* Text Content */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 leading-snug">
                      {option.label}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-[#9aa0a6] leading-snug mt-0.5">
                      {option.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
