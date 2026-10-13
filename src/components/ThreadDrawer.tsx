import React, { useState, useMemo } from 'react';
import { ChatThread } from '../types/index.ts';
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Search,
  Sparkles,
  Settings,
  User,
  Clock,
  Brain,
} from 'lucide-react';

interface ThreadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onRenameThread: (threadId: string, newTitle: string) => Promise<void>;
  onDeleteThread: (threadId: string) => Promise<void>;
  userName?: string;
  nickname?: string;
  onOpenSettings?: () => void;
}

export const ThreadDrawer: React.FC<ThreadDrawerProps> = ({
  isOpen,
  onClose,
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onRenameThread,
  onDeleteThread,
  userName = '',
  nickname = '',
  onOpenSettings,
}) => {
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const displayName = nickname.trim() || userName.trim() || 'User';
  const initials = displayName
    ? displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U';

  // Group threads by time period (Today, Yesterday, 7 Days, Older)
  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    return threads.filter((t) =>
      t.title.toLowerCase().includes(searchQuery.toLowerCase().trim())
    );
  }, [threads, searchQuery]);

  const groupedThreads = useMemo(() => {
    const today: ChatThread[] = [];
    const yesterday: ChatThread[] = [];
    const past7Days: ChatThread[] = [];
    const older: ChatThread[] = [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = todayStart - 7 * 24 * 60 * 60 * 1000;

    filteredThreads.forEach((t) => {
      const time = t.updated_at
        ? new Date(t.updated_at).getTime()
        : t.created_at
        ? new Date(t.created_at).getTime()
        : Date.now();

      if (time >= todayStart) {
        today.push(t);
      } else if (time >= yesterdayStart) {
        yesterday.push(t);
      } else if (time >= sevenDaysAgo) {
        past7Days.push(t);
      } else {
        older.push(t);
      }
    });

    return { today, yesterday, past7Days, older };
  }, [filteredThreads]);

  if (!isOpen) return null;

  const handleStartRename = (e: React.MouseEvent, thread: ChatThread) => {
    e.stopPropagation();
    setEditingThreadId(thread.id);
    setEditTitle(thread.title);
  };

  const handleSaveRename = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    if (!editTitle.trim()) return;
    await onRenameThread(threadId, editTitle.trim());
    setEditingThreadId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingThreadId(null);
  };

  const handleConfirmDelete = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    await onDeleteThread(threadId);
    setDeletingThreadId(null);
  };

  const renderThreadItem = (thread: ChatThread) => {
    const isActive = thread.id === activeThreadId;
    const isEditing = editingThreadId === thread.id;
    const isDeleting = deletingThreadId === thread.id;

    return (
      <div
        key={thread.id}
        onClick={() => {
          if (!isEditing && !isDeleting) {
            onSelectThread(thread.id);
            onClose();
          }
        }}
        className={`group relative rounded-xl px-3 py-2.5 transition flex items-center justify-between gap-2 cursor-pointer border ${
          isActive
            ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 font-semibold border-l-4 border-l-amber-400 shadow-xs'
            : 'bg-slate-900/40 hover:bg-slate-800/60 border-slate-800/60 text-slate-300 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <MessageSquare
            className={`w-3.5 h-3.5 shrink-0 ${
              isActive ? 'text-amber-400' : 'text-slate-500 group-hover:text-slate-400'
            }`}
          />
          {isEditing ? (
            <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename(e as any, thread.id);
                  if (e.key === 'Escape') handleCancelRename(e as any);
                }}
                autoFocus
                className="w-full bg-slate-950 border border-amber-500/80 rounded px-2 py-0.5 text-xs text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={(e) => handleSaveRename(e, thread.id)}
                className="p-1 rounded text-emerald-400 hover:bg-slate-800 shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleCancelRename}
                className="p-1 rounded text-slate-400 hover:bg-slate-800 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : isDeleting ? (
            <div className="flex items-center gap-2 py-0.5" onClick={(e) => e.stopPropagation()}>
              <span className="text-xs text-red-400 font-medium">Delete thread?</span>
              <button
                type="button"
                onClick={(e) => handleConfirmDelete(e, thread.id)}
                className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingThreadId(null);
                }}
                className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <span className="text-xs truncate leading-snug">{thread.title}</span>
          )}
        </div>

        {!isEditing && !isDeleting && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
            <button
              type="button"
              onClick={(e) => handleStartRename(e, thread)}
              className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition"
              title="Rename thread"
            >
              <Edit2 className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeletingThreadId(thread.id);
              }}
              className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
              title="Delete thread"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative w-full max-w-xs sm:max-w-sm bg-slate-950/95 border-r border-slate-800/80 flex flex-col h-full shadow-2xl animate-in slide-in-from-left duration-200 text-slate-100 z-10 backdrop-blur-xl">
        {/* Brand Drawer Header */}
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-slate-950 shadow-sm font-bold">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-white text-sm tracking-tight leading-none">
                TwinMind AI
              </h2>
              <span className="text-[10px] text-slate-400 font-medium">
                Thinking Partner & Context
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition"
            title="Close menu"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Primary Action Button: New Chat */}
        <div className="p-3 border-b border-slate-800/80 space-y-2 bg-slate-950/60">
          <button
            type="button"
            onClick={() => {
              onNewThread();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-110 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/10 active:scale-[0.99] transition-all"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>New Chat</span>
          </button>

          {/* Search Threads Filter */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversation threads..."
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl pl-8 pr-8 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Categorized Threads Scroll Area */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {filteredThreads.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-2 text-slate-500">
              <MessageSquare className="w-8 h-8 mx-auto text-slate-700 stroke-[1.5]" />
              <p className="text-xs font-medium text-slate-400">
                {searchQuery ? 'No matching threads found.' : 'No conversations yet.'}
              </p>
              <p className="text-[11px] text-slate-600">
                Start a new chat session to begin exploring decisions and context.
              </p>
            </div>
          ) : (
            <>
              {groupedThreads.today.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Today
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {groupedThreads.today.length}
                    </span>
                  </div>
                  <div className="space-y-1">{groupedThreads.today.map(renderThreadItem)}</div>
                </div>
              )}

              {groupedThreads.yesterday.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Yesterday
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {groupedThreads.yesterday.length}
                    </span>
                  </div>
                  <div className="space-y-1">{groupedThreads.yesterday.map(renderThreadItem)}</div>
                </div>
              )}

              {groupedThreads.past7Days.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Previous 7 Days
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {groupedThreads.past7Days.length}
                    </span>
                  </div>
                  <div className="space-y-1">{groupedThreads.past7Days.map(renderThreadItem)}</div>
                </div>
              )}

              {groupedThreads.older.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Older
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {groupedThreads.older.length}
                    </span>
                  </div>
                  <div className="space-y-1">{groupedThreads.older.map(renderThreadItem)}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* User Identity & Settings Footer Card */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-900/40 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center justify-center shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-200 truncate">
                {displayName} <span className="text-slate-500 font-normal">(You)</span>
              </p>
              <p className="text-[10px] text-slate-500 truncate">TwinMind Context Grounded</p>
            </div>
          </div>

          {onOpenSettings && (
            <button
              type="button"
              onClick={() => {
                onOpenSettings();
                onClose();
              }}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0"
              title="Open Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
