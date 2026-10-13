import React from 'react';
import { Brain, Scale, Lightbulb, FolderKanban, Users2 } from 'lucide-react';

interface EmptyStateProps {
  displayName?: string;
  onSelectStarter: (promptText: string, enableSwarm?: boolean) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  displayName,
  onSelectStarter,
}) => {
  // Determine time of day greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const starterCards = [
    {
      icon: <Scale className="w-5 h-5 text-amber-400" />,
      title: 'Analyze a decision',
      subtitle: 'Compare trade-offs',
      prompt: 'Help me analyze a complex decision. Let’s weigh the pros, cons, long-term trade-offs, and critical risks.',
      enableSwarm: false,
    },
    {
      icon: <Lightbulb className="w-5 h-5 text-amber-400" />,
      title: 'Challenge my thinking',
      subtitle: 'Test assumptions',
      prompt: 'Challenge my current assumptions and blind spots on this topic. Play devil’s advocate and expose potential flaws.',
      enableSwarm: false,
    },
    {
      icon: <FolderKanban className="w-5 h-5 text-amber-400" />,
      title: 'Explore a project',
      subtitle: 'Use relevant context',
      prompt: 'Help me plan and structure my project strategy using my saved context and personal knowledge vault.',
      enableSwarm: false,
    },
    {
      icon: <Users2 className="w-5 h-5 text-amber-400" />,
      title: 'Run a debate',
      subtitle: 'Compare AI perspectives',
      prompt: 'Synthesize a multi-model consensus debate comparing analytical, conservative, and creative perspectives.',
      enableSwarm: true,
    },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 text-center select-none my-auto">
      {/* Brand Hero Badge */}
      <div className="relative mb-5 group">
        <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-amber-500/20 via-amber-400/30 to-amber-600/20 blur-xl opacity-75 group-hover:opacity-100 transition duration-1000" />
        <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white dark:bg-slate-900 border border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-400 shadow-xl ring-1 ring-amber-500/20">
          <Brain className="w-8 h-8 sm:w-10 sm:h-10 text-amber-500 dark:text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]" />
        </div>
      </div>

      {/* Personalized Greeting Kicker */}
      {displayName && (
        <span className="text-xs sm:text-sm font-semibold text-amber-600 dark:text-amber-400 tracking-wide mb-1.5">
          {getGreeting()}, {displayName}
        </span>
      )}

      {/* Headline & Subtitle */}
      <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">
        Think it through.
      </h2>
      <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-md mx-auto mb-8 font-normal leading-relaxed">
        Your thinking partner, grounded in your context.
      </p>

      {/* 2x2 Starter Grid Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl w-full">
        {starterCards.map((card, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectStarter(card.prompt, card.enableSwarm)}
            className="group relative flex flex-col text-left p-4 rounded-xl bg-white hover:bg-slate-50 dark:bg-slate-900/80 dark:hover:bg-slate-800/90 border border-slate-200 dark:border-slate-800 hover:border-amber-500/40 transition-all duration-200 shadow-xs hover:shadow-amber-500/5 active:scale-[0.99]"
          >
            <div className="flex items-center gap-3 mb-1.5">
              <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 group-hover:bg-amber-500/20 transition">
                {card.icon}
              </div>
              <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm group-hover:text-amber-600 dark:group-hover:text-amber-300 transition">
                {card.title}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-normal pl-9">
              {card.subtitle}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};
