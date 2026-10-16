import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Search,
  Calculator,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Cpu,
  Copy,
  Check,
  ShieldAlert,
} from 'lucide-react';
import { SwarmSessionState, SwarmSpecialistProgress, SwarmToolCall } from '../types';

interface SwarmTraceFeedProps {
  trace: SwarmSessionState;
}

export const SwarmTraceFeed: React.FC<SwarmTraceFeedProps> = ({ trace }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [expandedToolIndex, setExpandedToolIndex] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isRunning = trace.status === 'running';
  const totalDuration = trace.totalDurationMs
    ? `${(trace.totalDurationMs / 1000).toFixed(1)}s`
    : undefined;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const getSpecialistMeta = (specialist: string) => {
    if (specialist === 'DeepResearcher') {
      return {
        name: 'Deep Researcher',
        icon: Search,
        accentText: 'text-cyan-400',
        accentBg: 'bg-cyan-500/10',
        accentBorder: 'border-cyan-500/20',
      };
    }
    if (specialist === 'DataAnalyst') {
      return {
        name: 'Data Analyst',
        icon: Calculator,
        accentText: 'text-indigo-400',
        accentBg: 'bg-indigo-500/10',
        accentBorder: 'border-indigo-500/20',
      };
    }
    if (specialist === 'CodeAuditor') {
      return {
        name: 'Code & Security Auditor',
        icon: ShieldAlert,
        accentText: 'text-amber-400',
        accentBg: 'bg-amber-500/10',
        accentBorder: 'border-amber-500/20',
      };
    }
    return {
      name: specialist,
      icon: Cpu,
      accentText: 'text-emerald-400',
      accentBg: 'bg-emerald-500/10',
      accentBorder: 'border-emerald-500/20',
    };
  };

  return (
    <div className="w-full my-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white/90 dark:bg-slate-900/40 text-slate-800 dark:text-slate-200 overflow-hidden text-xs shadow-xs transition-all">
      {/* Collapsible Header Banner */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700/40 text-left transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 text-cyan-500 dark:text-cyan-400 animate-spin" />
          ) : trace.status === 'error' ? (
            <AlertCircle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
          )}
          <span className="font-semibold text-slate-900 dark:text-slate-200 tracking-wide flex items-center gap-1.5">
            Specialist Swarm Deliberation
            {isRunning && (
              <span className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400/90 font-normal">
                (collaborating...)
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {totalDuration && (
            <span className="font-mono tabular-nums text-[10px] text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800/70 border border-slate-300 dark:border-slate-700/50">
              {totalDuration}
            </span>
          )}
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
            {trace.specialists.length} specialists
          </span>
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          )}
        </div>
      </button>

      {/* Expanded Specialist Timeline */}
      {isExpanded && (
        <div className="p-3 space-y-3 divide-y divide-slate-800/60">
          {trace.specialistProgress.map((sp: SwarmSpecialistProgress) => {
            const meta = getSpecialistMeta(sp.specialist);
            const SpecialistIcon = meta.icon;
            const isSpecRunning = sp.status === 'active';

            return (
              <div key={sp.specialist} className="pt-2.5 first:pt-0 space-y-2">
                {/* Specialist Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`p-1 rounded ${meta.accentBg} ${meta.accentBorder} ${meta.accentText} border`}
                    >
                      <SpecialistIcon className="w-3 h-3" />
                    </span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-200">{meta.name}</span>
                        <span className="text-[10px] text-slate-400">({sp.role})</span>
                      </div>
                      {sp.taskDescription && (
                        <p className="text-[11px] text-slate-400 truncate max-w-sm">
                          {sp.taskDescription}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
                    {isSpecRunning ? (
                      <span className="flex items-center gap-1 text-cyan-400">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        active
                      </span>
                    ) : sp.status === 'error' ? (
                      <span className="text-rose-400">failed</span>
                    ) : (
                      <span className="text-emerald-400">completed</span>
                    )}
                    {sp.durationMs !== undefined && (
                      <span className="tabular-nums">({sp.durationMs}ms)</span>
                    )}
                  </div>
                </div>

                {/* Tool Invocations */}
                {sp.tools.length > 0 && (
                  <div className="space-y-1.5 pl-6 border-l border-slate-800 ml-2">
                    {sp.tools.map((tool: SwarmToolCall, tIdx: number) => {
                      const toolKey = `${sp.specialist}-${tIdx}`;
                      const isToolExpanded = expandedToolIndex === toolKey;
                      const hasResult = tool.result !== undefined && tool.result !== null;

                      return (
                        <div
                          key={toolKey}
                          className="rounded border border-slate-800/80 bg-slate-950/40 p-2 text-[11px]"
                        >
                          <div
                            className="flex items-center justify-between cursor-pointer select-none"
                            onClick={() => setExpandedToolIndex(isToolExpanded ? null : toolKey)}
                          >
                            <div className="flex items-center gap-2">
                              {tool.status === 'pending' ? (
                                <Loader2 className="w-2.5 h-2.5 text-cyan-400 animate-spin" />
                              ) : tool.status === 'error' ? (
                                <AlertCircle className="w-2.5 h-2.5 text-rose-400" />
                              ) : (
                                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                              )}
                              <span className="font-mono text-slate-300 font-semibold">
                                {tool.toolName}
                              </span>
                              {tool.outputSummary && (
                                <span className="text-slate-400 text-[10px] truncate max-w-xs">
                                  {tool.outputSummary}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5">
                              {tool.durationMs !== undefined && (
                                <span className="font-mono tabular-nums text-[10px] text-slate-400">
                                  {tool.durationMs}ms
                                </span>
                              )}
                              <span className="text-[10px] text-cyan-400 hover:underline">
                                {isToolExpanded ? 'Hide' : 'Inspect'}
                              </span>
                            </div>
                          </div>

                          {/* Raw Inspected Tool Arguments & Payload */}
                          {isToolExpanded && (
                            <div className="mt-2 pt-2 border-t border-slate-800/80 space-y-2">
                              {tool.input && (
                                <div>
                                  <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-0.5">
                                    Input Arguments:
                                  </div>
                                  <pre className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono text-[10px] whitespace-pre-wrap break-all">
                                    {JSON.stringify(tool.input, null, 2)}
                                  </pre>
                                </div>
                              )}

                              {hasResult && (
                                <div>
                                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-0.5">
                                    <span>Verified Result:</span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCopy(JSON.stringify(tool.result, null, 2), toolKey);
                                      }}
                                      className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 cursor-pointer"
                                    >
                                      {copiedKey === toolKey ? (
                                        <>
                                          <Check className="w-2.5 h-2.5 text-emerald-400" />
                                          <span>Copied</span>
                                        </>
                                      ) : (
                                        <>
                                          <Copy className="w-2.5 h-2.5" />
                                          <span>Copy JSON</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                  <pre className="p-1.5 rounded bg-slate-900 border border-slate-800 text-emerald-300 font-mono text-[10px] max-h-40 whitespace-pre-wrap break-all">
                                    {JSON.stringify(tool.result, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Specialist Summary Preview */}
                {sp.summaryPreview && (
                  <div className="pl-6 text-[11px] text-slate-300 italic">
                    "{sp.summaryPreview}"
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
