import React, { useState, useRef, useEffect } from 'react';
import { ChannelType } from '../types/index.ts';
import { ThemeMode } from '../hooks/useTheme.ts';
import {
  MessageSquare,
  Plus,
  Search,
  Sun,
  Moon,
  Monitor,
  Menu,
  ChevronDown,
  Brain,
  Cpu,
  Sparkles,
  SquarePen,
  User,
  Check,
  MoreVertical,
  Download,
  LogOut,
  Trash2,
  Settings,
  Mic,
} from 'lucide-react';
import { NavigationTab } from './BottomNav.tsx';
import { useAuthSession } from '../contexts/AuthSessionContext.tsx';

interface HeaderProps {
  brandName?: string;
  channel: ChannelType;
  onChannelChange: (channel: ChannelType) => void;
  userName: string;
  nickname: string;
  activeProvider: string;
  activeModel?: string;
  onOpenNicknameModal: () => void;
  onOpenSettingsModal: () => void;
  onClearChat: () => void;
  onExportChat: () => void;
  messageCount: number;
  activeTab?: NavigationTab;
  onOpenThreadDrawer?: () => void;
  onNewThread?: () => void;
  activeThreadTitle?: string;
  onToggleSearch?: () => void;
  isSearchOpen?: boolean;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  onProviderChange?: (provider: string) => void;
  onOpenVoiceModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  brandName = 'TwinMind AI',
  channel,
  onChannelChange,
  userName,
  nickname,
  activeProvider,
  activeModel,
  onOpenNicknameModal,
  onOpenSettingsModal,
  onClearChat,
  onExportChat,
  messageCount,
  activeTab = 'home',
  onOpenThreadDrawer,
  onNewThread,
  activeThreadTitle,
  onToggleSearch,
  isSearchOpen = false,
  themeMode,
  onThemeModeChange,
  onProviderChange,
  onOpenVoiceModal,
}) => {
  const displayName = nickname.trim() || userName.trim();
  const authSession = useAuthSession();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const cycleTheme = () => {
    if (themeMode === 'dark') onThemeModeChange('light');
    else if (themeMode === 'light') onThemeModeChange('system');
    else onThemeModeChange('dark');
  };

  const getThemeIcon = () => {
    if (themeMode === 'dark') return <Moon className="w-3.5 h-3.5 text-indigo-400" />;
    if (themeMode === 'light') return <Sun className="w-3.5 h-3.5 text-amber-500" />;
    return <Monitor className="w-3.5 h-3.5 text-emerald-500" />;
  };

  return (
    <header className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md sticky top-0 z-30 transition-colors">
      <div className="max-w-4xl mx-auto px-3.5 sm:px-4 py-2 flex items-center justify-between gap-2">
        
        {/* Left Side: Circular Menu Button (☰) matching ChatGPT style */}
        <div className="flex items-center gap-2">
          {onOpenThreadDrawer && (
            <button
              type="button"
              onClick={onOpenThreadDrawer}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-900/90 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-800/80 transition-all flex items-center justify-center shadow-xs active:scale-95 lg:hidden"
              title="Open conversation history drawer"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}

          {/* Model / Persona Dropdown Selector */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-900/80 transition text-left"
            >
              <span className="font-extrabold text-slate-900 dark:text-white text-sm tracking-tight">
                {brandName || 'TwinMind AI'}
              </span>
              <span className="text-[10px] text-slate-400">▾</span>
            </button>

            {/* Model & Persona Selection Menu Dropdown */}
            {isDropdownOpen && (
              <div className="absolute top-10 left-0 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in duration-150">
                <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 px-2.5 py-1 uppercase tracking-wider">
                  Active Thinking Model
                </div>
                
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (onProviderChange) onProviderChange('gemini');
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-xl text-xs flex items-center justify-between transition ${
                      activeProvider === 'gemini'
                        ? 'bg-amber-500/10 text-amber-500 dark:text-amber-300 font-semibold border border-amber-500/30'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>Google Gemini</span>
                    </div>
                    {activeProvider === 'gemini' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (onProviderChange) onProviderChange('groq');
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-xl text-xs flex items-center justify-between transition ${
                      activeProvider === 'groq'
                        ? 'bg-amber-500/10 text-amber-500 dark:text-amber-300 font-semibold border border-amber-500/30'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Groq LPUs</span>
                    </div>
                    {activeProvider === 'groq' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (onProviderChange) onProviderChange('mistral');
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-xl text-xs flex items-center justify-between transition ${
                      activeProvider === 'mistral'
                        ? 'bg-amber-500/10 text-amber-500 dark:text-amber-300 font-semibold border border-amber-500/30'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Brain className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Mistral AI</span>
                    </div>
                    {activeProvider === 'mistral' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                  </button>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 my-1 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsDropdownOpen(false);
                      onOpenNicknameModal();
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-2 transition"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Identity: {displayName || 'Set Name'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: ChatGPT-style Rounded Pill Badge [ Compose (📝) | Options (⋮) ] */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800/80 rounded-full px-2 py-1 shadow-xs">
            
            {/* New Chat Button */}
            {onNewThread && (
              <button
                type="button"
                onClick={onNewThread}
                className="p-1.5 rounded-full text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition active:scale-95"
                title="Start new conversation"
              >
                <SquarePen className="w-4 h-4" />
              </button>
            )}

            {/* Voice Memo & Executive Summary Recorder Button */}
            {onOpenVoiceModal && (
              <button
                type="button"
                onClick={onOpenVoiceModal}
                className="p-1.5 rounded-full text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition active:scale-95"
                title="Record Voice Memo & Generate Executive PDF/Excel"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}

            {/* Vertical Divider */}
            <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-800 my-auto" />

            {/* More Options Overflow Button (⋮) */}
            <div className="relative" ref={moreMenuRef}>
              <button
                type="button"
                onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                className="p-1.5 rounded-full text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition active:scale-95"
                title="More options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {/* Overflow Options Popover Menu */}
              {isMoreMenuOpen && (
                <div className="absolute top-9 right-0 w-48 max-h-[min(80dvh,32rem)] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in duration-150">
                  {onToggleSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleSearch();
                        setIsMoreMenuOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 transition"
                    >
                      <Search className="w-3.5 h-3.5 text-amber-400" />
                      <span>Search Messages</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      onExportChat();
                      setIsMoreMenuOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 transition"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Export Session</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      cycleTheme();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 transition"
                  >
                    {getThemeIcon()}
                    <span className="capitalize">Theme: {themeMode}</span>
                  </button>

                  {/* Channel/Theme Selector Section */}
                  <div className="border-t border-slate-200 dark:border-slate-800 my-1 pt-1">
                    <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 px-2.5 py-1 uppercase tracking-wider">
                      Messaging Theme
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onChannelChange('web');
                        setIsMoreMenuOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition ${
                        channel === 'web'
                          ? 'bg-amber-500/10 text-amber-500 dark:text-amber-300 font-semibold'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>🌐</span>
                        <span>Web Canvas</span>
                      </span>
                      {channel === 'web' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onChannelChange('telegram');
                        setIsMoreMenuOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition ${
                        channel === 'telegram'
                          ? 'bg-sky-500/10 text-sky-500 dark:text-sky-300 font-semibold'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>✈️</span>
                        <span>Telegram Theme</span>
                      </span>
                      {channel === 'telegram' && <Check className="w-3.5 h-3.5 text-sky-400" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onChannelChange('whatsapp');
                        setIsMoreMenuOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition ${
                        channel === 'whatsapp'
                          ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-300 font-semibold'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>💬</span>
                        <span>WhatsApp Theme</span>
                      </span>
                      {channel === 'whatsapp' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </button>
                  </div>

                  <div className="border-t border-slate-200 dark:border-slate-800 my-1 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        onOpenSettingsModal();
                        setIsMoreMenuOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 transition"
                    >
                      <Settings className="w-3.5 h-3.5 text-slate-400" />
                      <span>Settings</span>
                    </button>
                  </div>

                  {messageCount > 0 && (
                    <div className="border-t border-slate-200 dark:border-slate-800 my-1 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          onClearChat();
                          setIsMoreMenuOpen(false);
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-red-500 hover:bg-red-500/10 flex items-center gap-2.5 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Clear Session</span>
                      </button>
                    </div>
                  )}
                  {authSession && (
                    <div className="border-t border-slate-200 dark:border-slate-800 my-1 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          void authSession.signOut();
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-red-500 hover:bg-red-500/10 flex items-center gap-2.5 transition"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
