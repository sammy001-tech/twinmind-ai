import React from 'react';
import { Home, MessageSquare, Target, Database, Cpu, BarChart3 } from 'lucide-react';

export type NavigationTab = 'home' | 'chat' | 'advice' | 'knowledge' | 'calibration' | 'settings';

interface BottomNavProps {
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  isKnowledgeLive?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onTabChange,
  isKnowledgeLive = true,
}) => {
  const tabs = [
    {
      id: 'home' as NavigationTab,
      label: 'Home',
      icon: Home,
      badge: null,
    },
    {
      id: 'chat' as NavigationTab,
      label: 'Chat',
      icon: MessageSquare,
      badge: null,
    },
    {
      id: 'advice' as NavigationTab,
      label: '7-Step',
      icon: Target,
      badge: null,
    },
    {
      id: 'calibration' as NavigationTab,
      label: 'Calibration',
      icon: BarChart3,
      badge: 'Brier',
    },
    {
      id: 'knowledge' as NavigationTab,
      label: 'Vault',
      icon: Database,
      badge: isKnowledgeLive ? 'live' : null,
    },
    {
      id: 'settings' as NavigationTab,
      label: 'Settings',
      icon: Cpu,
      badge: null,
    },
  ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className="shrink-0 z-40 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 shadow-2xl safe-area-pb"
    >
      <div className="max-w-4xl mx-auto flex items-center justify-around px-1 h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center h-full relative transition-all duration-150 select-none ${
                isActive
                  ? 'text-amber-600 dark:text-amber-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 font-medium'
              }`}
            >
              {/* Active top highlight line */}
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-amber-500 to-indigo-500 rounded-full" />
              )}

              <div className="relative flex items-center justify-center">
                <Icon
                  className={`w-5 h-5 transition-transform duration-150 ${
                    isActive ? 'scale-110 stroke-[2.2]' : 'stroke-[1.8]'
                  }`}
                />

                {/* Message count badge */}
                {tab.badge && tab.badge !== 'live' && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-slate-950 font-bold text-[9px] flex items-center justify-center leading-none">
                    {tab.badge}
                  </span>
                )}

                {/* Live dot badge for Knowledge Vault */}
                {tab.badge === 'live' && (
                  <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-950 animate-pulse" />
                )}
              </div>

              <span className="text-[10.5px] mt-1 tracking-tight">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
