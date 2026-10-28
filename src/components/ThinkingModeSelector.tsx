import React, { useState, useRef, useEffect } from 'react';
import { SoulTuningConfig } from '../types/index.ts';
import {
  THINKING_PRESETS,
  resolveActiveThinkingPreset,
  formatThinkingModeBadge,
  ThinkingPreset,
} from '../utils/thinkingModes.ts';
import { Check, ChevronDown, Sliders, Sparkles, Loader2, AlertCircle, Info } from 'lucide-react';

interface ThinkingModeSelectorProps {
  soulTuning: SoulTuningConfig;
  onSelectPreset: (tuning: SoulTuningConfig) => Promise<void> | void;
  onOpenSettings?: () => void;
  className?: string;
}

export const ThinkingModeSelector: React.FC<ThinkingModeSelectorProps> = ({
  soulTuning,
  onSelectPreset,
  onOpenSettings,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const activeBadge = formatThinkingModeBadge(soulTuning);
  const activePreset = resolveActiveThinkingPreset(soulTuning);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
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

  const handleApplyPreset = async (preset: ThinkingPreset) => {
    setIsApplying(true);
    setErrorMsg(null);
    try {
      await onSelectPreset(preset.weights);
      setIsOpen(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to apply thinking preset');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className={`relative inline-block ${className}`} ref={popoverRef}>
      {/* Visual Trigger Chip with Dynamic Preset Theme & Pulsing Status Indicator */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setErrorMsg(null);
        }}
        className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs border ${
          isOpen
            ? `${activeBadge.colors.bg} ${activeBadge.colors.border} ${activeBadge.colors.text} ring-2 ring-amber-500/25`
            : `${activeBadge.colors.bg} ${activeBadge.colors.border} ${activeBadge.colors.text} hover:opacity-95`
        }`}
        title={`Active Thinking Mode: ${activeBadge.label}\n\nEffect on twin's posture:\n${activeBadge.effect}\n\nClick to quick-switch thinking mode.`}
        aria-label={`Active Thinking Mode: ${activeBadge.label}`}
      >
        <span className="text-sm leading-none">{activeBadge.icon}</span>
        <span className="inline font-semibold tracking-tight">{activeBadge.label}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${activeBadge.colors.dot} animate-pulse`} />
        <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Mobile Backdrop Overlay & Centered Dropdown Card */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed left-3 right-3 top-16 sm:absolute sm:inset-auto sm:top-10 sm:right-0 sm:w-84 max-h-[calc(100dvh-5rem)] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Thinking Mode</span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Calibrate twin's reasoning posture &amp; analytical lens
              </p>
            </div>
            {isApplying && (
              <span className="text-[10px] text-amber-500 flex items-center gap-1 font-medium">
                <Loader2 className="w-3 h-3 animate-spin" /> Saving...
              </span>
            )}
          </div>

          {errorMsg && (
            <div className="p-2 mb-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-[11px] flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Preset Buttons with Detailed Tooltips & Effect Badges */}
          <div className="space-y-1.5">
            {THINKING_PRESETS.map((preset) => {
              const isSelected = activePreset?.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={isApplying}
                  onClick={() => handleApplyPreset(preset)}
                  title={`Effect: ${preset.effect}`}
                  className={`w-full text-left p-2.5 rounded-xl transition-all border flex flex-col gap-1.5 relative group ${
                    isSelected
                      ? `${preset.colors.bg} ${preset.colors.border} text-slate-900 dark:text-white shadow-xs font-bold`
                      : 'border-transparent hover:border-slate-200 dark:hover:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="flex items-start gap-2.5 w-full">
                    <span className="text-lg shrink-0 mt-0.5">{preset.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                          {preset.label}
                        </span>
                        {isSelected ? (
                          <span className="text-[10px] text-amber-500 font-mono font-bold flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> ACTIVE
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
                        {preset.tagline}
                      </p>
                    </div>
                  </div>

                  {/* Non-intrusive Posture Effect Tooltip Banner */}
                  <div className="w-full px-2 py-1 rounded-lg bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/50 dark:border-slate-700/50 text-[10px] text-slate-600 dark:text-slate-300 flex items-start gap-1.5 leading-snug">
                    <Info className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                    <span>{preset.effect}</span>
                  </div>

                  <div className="text-[9px] font-mono text-slate-400 dark:text-slate-500 flex items-center gap-2 pl-0.5">
                    <span>Tone: {preset.weights.tone}</span>
                    <span>•</span>
                    <span>Direct: {preset.weights.directness}</span>
                    <span>•</span>
                    <span>Persp: {preset.weights.perspective}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Custom Calibration Footer */}
          <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
            {!activePreset ? (
              <span className="text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1">
                <span>🎛️</span> Custom: {soulTuning.tone}/{soulTuning.directness}/{soulTuning.perspective}
              </span>
            ) : (
              <span className="text-slate-400">Want custom weights?</span>
            )}

            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenSettings();
                }}
                className="text-amber-600 dark:text-amber-400 hover:underline font-semibold flex items-center gap-1"
              >
                <Sliders className="w-3 h-3" />
                <span>Fine-Tune Sliders</span>
              </button>
            )}
          </div>
        </div>
      </>
    )}
    </div>
  );
};
