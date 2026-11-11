import React from 'react';
import { KnowledgeItem } from '../types/index.ts';
import { History, GitPullRequest, Milestone, ChevronRight, Clock } from 'lucide-react';
import { renderFormattedMarkdown } from '../utils/markdown.tsx';

interface BeliefEvolutionTimelineProps {
  documents: KnowledgeItem[];
}

export const BeliefEvolutionTimeline: React.FC<BeliefEvolutionTimelineProps> = ({ documents }) => {
  // Extract evolutionary steps from documents
  const evolutions = documents
    .filter(doc => doc.content.includes('🔄 Strategic Evolution'))
    .map(doc => {
      const parts = doc.content.split('---');
      const baseContent = parts[0];
      const evolutionBlocks = parts.slice(1)
        .filter(p => p.includes('Strategic Evolution'))
        .map(p => {
          const dateMatch = p.match(/\((.*?)\)/);
          const date = dateMatch ? dateMatch[1] : 'Unknown Date';
          const contentMatch = p.match(/:\*\*\n>\s(.*)/s);
          const content = contentMatch ? contentMatch[1].trim() : p;
          return { date, content };
        });

      return {
        id: doc.id,
        title: doc.title,
        category: doc.category,
        baseContent,
        evolutionBlocks: evolutionBlocks.reverse() // Newest first for each doc
      };
    })
    .sort((a, b) => {
      // Sort by the date of the most recent evolution block
      const dateA = a.evolutionBlocks[0]?.date || '';
      const dateB = b.evolutionBlocks[0]?.date || '';
      return dateB.localeCompare(dateA);
    });

  if (evolutions.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center justify-center text-center space-y-3 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
        <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
          <Milestone className="w-6 h-6" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">No Strategic Evolutions Recorded</h4>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            When you pivot on a decision or update a core belief, use the "Evolve" action in the Belief Auditor to track your intellectual growth here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 relative before:absolute before:inset-y-0 before:left-4 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800 pl-2">
      {evolutions.map((evo) => (
        <div key={evo.id} className="relative pl-10 group">
          {/* Timeline Dot */}
          <div className="absolute left-[-5px] top-1 w-5 h-5 rounded-full bg-indigo-600 border-4 border-white dark:border-slate-900 z-10 group-hover:scale-110 transition-transform shadow-sm" />
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{evo.title}</h4>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 uppercase tracking-wider">
                  {evo.category.replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              {evo.evolutionBlocks.map((block, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 px-2.5 py-1 bg-indigo-600 text-white text-[9px] font-bold rounded-bl-lg flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {block.date}
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <GitPullRequest className="w-4 h-4 text-indigo-500" />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-tight flex items-center gap-1">
                        Strategic Pivot #{evo.evolutionBlocks.length - idx}
                      </div>
                      <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-medium">
                        {renderFormattedMarkdown(block.content)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Initial Stance */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-300 dark:border-slate-700 opacity-60 hover:opacity-100 transition-opacity">
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    <History className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Original Premises</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 italic">
                      {evo.baseContent.replace(/#+\s/g, '')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
