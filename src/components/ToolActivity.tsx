import React, { useState } from 'react';
import { Cpu, Search, Database, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { SwarmSessionState } from '../types/index.ts';
import { getReportedSpecialists } from '../utils/toolActivity.ts';

interface ToolActivityProps {
  useSwarm?: boolean;
  swarmState?: SwarmSessionState;
  knowledgeSources?: string[];
  searchCitations?: { title: string; url: string }[];
  latencyMs?: number;
}

export const ToolActivity: React.FC<ToolActivityProps> = ({
  useSwarm,
  swarmState,
  knowledgeSources,
  searchCitations,
  latencyMs,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!useSwarm && (!knowledgeSources || knowledgeSources.length === 0) && (!searchCitations || searchCitations.length === 0)) {
    return null;
  }

  const contributingModels = getReportedSpecialists(swarmState?.specialists);

  return (
    <div className="my-2.5 rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden text-xs text-slate-300">
      {/* Activity Disclosure Header Bar */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between bg-slate-900/90 hover:bg-slate-800/80 transition text-left select-none"
      >
        <div className="flex items-center gap-2 truncate">
          <div className="w-5 h-5 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            {useSwarm ? <Cpu className="w-3 h-3" /> : <Search className="w-3 h-3" />}
          </div>
          <span className="font-semibold text-slate-200 truncate">
            {useSwarm
              ? contributingModels.length > 0
                ? `Swarm Consensus (${contributingModels.length} reported specialists)`
                : 'Swarm activity details'
              : knowledgeSources?.length
              ? `Knowledge Vault Context (${knowledgeSources.length} sources)`
              : 'Tool Activity & Provenance'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {latencyMs != null && (
            <span className="text-[10px] text-slate-400 font-mono">
              {latencyMs > 1000 ? `${(latencyMs / 1000).toFixed(1)}s` : `${latencyMs}ms`}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          )}
        </div>
      </button>

      {/* Expanded Provenance Details */}
      {isExpanded && (
        <div className="p-3 border-t border-slate-800/80 space-y-2.5 bg-slate-950/40">
          {useSwarm && (
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">
                Runtime-reported specialists:
              </span>
              {contributingModels.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {contributingModels.map((model) => (
                    <span
                      key={model}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-800/90 px-2 py-0.5 font-mono text-[11px] text-slate-300"
                    >
                      <Cpu className="h-3 w-3 text-amber-400" />
                      {model}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-slate-400">
                  The runtime did not report specialist details for this run.
                </p>
              )}
            </div>
          )}

          {knowledgeSources && knowledgeSources.length > 0 && (
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block mb-1">
                Knowledge Memory Vault Sources:
              </span>
              <ul className="space-y-1 text-slate-300">
                {knowledgeSources.map((src, idx) => (
                  <li key={idx} className="flex items-center gap-1.5 text-[11px]">
                    <Database className="w-3 h-3 text-indigo-400 shrink-0" />
                    <span className="truncate">{src}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {searchCitations && searchCitations.length > 0 && (
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block mb-1">
                Web Search Grounding Citations:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {searchCitations.map((cite, idx) => (
                  <a
                    key={idx}
                    href={cite.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 rounded bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-[11px] text-slate-300 hover:text-amber-300 transition flex items-center gap-1 truncate max-w-[200px]"
                  >
                    <span className="truncate">{cite.title}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
