import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Target,
  Database,
  Cpu,
  Send,
  Edit3,
  ArrowRight,
  Sparkles,
  ExternalLink,
  Plus,
  Users,
  RefreshCw,
  Compass,
  Bell,
  Play,
  Trash2,
  Clock,
  CheckCircle2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { NavigationTab } from './BottomNav.tsx';
import { ChatThread, LearningJourney, PromptTemplate, ScheduledCheckin } from '../types/index.ts';

interface HomeViewProps {
  brandName?: string;
  displayName: string;
  userName: string;
  nickname: string;
  onOpenNicknameModal: () => void;
  activeProvider: string;
  activeModel: string;
  providerModels: { gemini: string; groq: string; mistral: string };
  onProviderChange: (provider: string) => void;
  onNavigateTab: (tab: NavigationTab) => void;
  onSelectPrompt: (promptText: string) => void;
  messageCount: number;
  threads?: ChatThread[];
  onSelectThread?: (threadId: string) => void;
  onStartJourneyThread?: (journeyId: number, journeyTitle: string) => void | Promise<void>;
  onOpenThreadDrawer?: () => void;
  onOpenTelegramModal?: () => void;
  customPrompts?: PromptTemplate[];
  dynamicPrompts?: PromptTemplate[];
  onRefreshDynamicPrompts?: () => void;
  onOpenCustomPromptModal?: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  brandName = 'TwinMind AI',
  displayName,
  onOpenNicknameModal,
  activeProvider,
  activeModel,
  providerModels,
  onProviderChange,
  onNavigateTab,
  onSelectPrompt,
  messageCount = 0,
  threads = [],
  onSelectThread,
  onStartJourneyThread,
  onOpenThreadDrawer,
  onOpenTelegramModal,
  customPrompts = [],
  dynamicPrompts = [],
  onRefreshDynamicPrompts,
  onOpenCustomPromptModal,
}) => {
  const [knowledgeStats, setKnowledgeStats] = useState<{
    totalDocuments: number;
    neonConnected: boolean;
    pgvectorActive: boolean;
  } | null>(null);

  const [telegramStatus, setTelegramStatus] = useState<{
    isRunning: boolean;
    isPaired: boolean;
    botUsername: string | null;
    botFirstName: string | null;
  } | null>(null);

  // Learning Journeys state
  const [journeys, setJourneys] = useState<LearningJourney[]>([]);
  const [journeysError, setJourneysError] = useState<string | null>(null);
  const [showNewJourneyForm, setShowNewJourneyForm] = useState(false);
  const [journeyTitle, setJourneyTitle] = useState('');
  const [journeyNextStep, setJourneyNextStep] = useState('');
  const [journeyDescription, setJourneyDescription] = useState('');
  const [isSavingJourney, setIsSavingJourney] = useState(false);
  const [editingJourneyId, setEditingJourneyId] = useState<number | null>(null);
  const [editJourneyNextStep, setEditJourneyNextStep] = useState('');
  const [editJourneyStatus, setEditJourneyStatus] = useState<'active' | 'paused' | 'completed'>('active');

  // Scheduled Check-Ins state
  const [checkins, setCheckins] = useState<ScheduledCheckin[]>([]);
  const [checkinsError, setCheckinsError] = useState<string | null>(null);
  const [showNewCheckinForm, setShowNewCheckinForm] = useState(false);
  const [checkinTitle, setCheckinTitle] = useState('');
  const [checkinPrompt, setCheckinPrompt] = useState('');
  const [checkinChannel, setCheckinChannel] = useState<'telegram' | 'whatsapp'>('telegram');
  const [checkinDelayMinutes, setCheckinDelayMinutes] = useState('60');
  const [isSavingCheckin, setIsSavingCheckin] = useState(false);
  const [triggeringCheckinId, setTriggeringCheckinId] = useState<number | null>(null);
  const [checkinActionNotice, setCheckinActionNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchJourneys = useCallback(async () => {
    try {
      const res = await fetch('/api/journeys');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setJourneysError(data?.error || `Learning Journeys unavailable (HTTP ${res.status}).`);
        return;
      }
      setJourneys(Array.isArray(data.journeys) ? data.journeys : []);
      setJourneysError(null);
    } catch (err: unknown) {
      setJourneysError(err instanceof Error ? err.message : 'Unable to reach Learning Journeys API.');
    }
  }, []);

  const fetchCheckins = useCallback(async () => {
    try {
      const res = await fetch('/api/checkins');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setCheckinsError(data?.error || `Scheduled Check-Ins unavailable (HTTP ${res.status}).`);
        return;
      }
      setCheckins(Array.isArray(data.checkins) ? data.checkins : []);
      setCheckinsError(null);
    } catch (err: unknown) {
      setCheckinsError(err instanceof Error ? err.message : 'Unable to reach Scheduled Check-Ins API.');
    }
  }, []);

  useEffect(() => {
    fetch('/api/knowledge/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setKnowledgeStats({
            totalDocuments: data.totalDocuments || 0,
            neonConnected: Boolean(data.neonConnected),
            pgvectorActive: Boolean(data.pgvectorActive),
          });
        }
      })
      .catch((err) => console.warn('Could not fetch knowledge status:', err));

    fetch('/api/telegram/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setTelegramStatus({
            isRunning: Boolean(data.isRunning),
            isPaired: Boolean(data.isPaired),
            botUsername: data.botUsername || null,
            botFirstName: data.botFirstName || null,
          });
        }
      })
      .catch((err) => console.warn('Could not fetch telegram status:', err));

    void fetchJourneys();
    void fetchCheckins();
  }, [fetchJourneys, fetchCheckins]);

  const handleCreateJourney = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!journeyTitle.trim()) return;
    setIsSavingJourney(true);
    setJourneysError(null);
    try {
      const res = await fetch('/api/journeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: journeyTitle.trim(),
          next_step: journeyNextStep.trim(),
          description: journeyDescription.trim(),
          status: 'active',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to create Learning Journey.');
      }
      setJourneyTitle('');
      setJourneyNextStep('');
      setJourneyDescription('');
      setShowNewJourneyForm(false);
      await fetchJourneys();
    } catch (err: unknown) {
      setJourneysError(err instanceof Error ? err.message : 'Failed to create Learning Journey.');
    } finally {
      setIsSavingJourney(false);
    }
  };

  const handleSaveJourneyEdit = async (id: number) => {
    try {
      const res = await fetch(`/api/journeys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          next_step: editJourneyNextStep.trim(),
          status: editJourneyStatus,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to update Learning Journey.');
      }
      setEditingJourneyId(null);
      await fetchJourneys();
    } catch (err: unknown) {
      setJourneysError(err instanceof Error ? err.message : 'Failed to update Learning Journey.');
    }
  };

  const handleDeleteJourney = async (id: number) => {
    try {
      const res = await fetch(`/api/journeys/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setJourneys((prev) => prev.filter((j) => j.id !== id));
      }
    } catch (err: unknown) {
      setJourneysError(err instanceof Error ? err.message : 'Failed to delete Learning Journey.');
    }
  };

  const handleCreateCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkinTitle.trim() || !checkinPrompt.trim()) return;
    setIsSavingCheckin(true);
    setCheckinsError(null);
    setCheckinActionNotice(null);
    try {
      const res = await fetch('/api/checkins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: checkinTitle.trim(),
          prompt: checkinPrompt.trim(),
          channel: checkinChannel,
          delayMinutes: Number(checkinDelayMinutes),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to schedule check-in.');
      }
      setCheckinTitle('');
      setCheckinPrompt('');
      setCheckinDelayMinutes('60');
      setShowNewCheckinForm(false);
      await fetchCheckins();
    } catch (err: unknown) {
      setCheckinsError(err instanceof Error ? err.message : 'Failed to schedule check-in.');
    } finally {
      setIsSavingCheckin(false);
    }
  };

  const handleTriggerCheckin = async (id: number) => {
    setTriggeringCheckinId(id);
    setCheckinActionNotice(null);
    try {
      const res = await fetch(`/api/checkins/${id}/trigger`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setCheckinActionNotice({
          type: 'error',
          text: data?.error || `Check-in delivery failed (HTTP ${res.status}).`,
        });
      } else {
        setCheckinActionNotice({
          type: 'success',
          text: `Check-in delivered via ${data.checkin?.channel || 'channel'}.`,
        });
      }
      await fetchCheckins();
    } catch (err: unknown) {
      setCheckinActionNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Trigger failed.',
      });
    } finally {
      setTriggeringCheckinId(null);
    }
  };

  const handleCancelOrDeleteCheckin = async (c: ScheduledCheckin) => {
    try {
      if (c.status === 'pending') {
        const res = await fetch(`/api/checkins/${c.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled' }),
        });
        if (res.ok) await fetchCheckins();
      } else {
        const res = await fetch(`/api/checkins/${c.id}`, { method: 'DELETE' });
        if (res.ok) setCheckins((prev) => prev.filter((item) => item.id !== c.id));
      }
    } catch (err: unknown) {
      setCheckinsError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const avatarLetter =
    brandName?.toLowerCase().includes('twin')
      ? 'TM'
      : (brandName.trim() || 'TM').slice(0, 2).toUpperCase();

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 max-w-3xl mx-auto space-y-6 pb-24 text-slate-900 dark:text-slate-100">
      {/* Hero Welcome Card */}
      <div className="relative rounded-2xl bg-white dark:bg-gradient-to-b dark:from-slate-900 dark:to-slate-950 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="relative">
              <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-tr from-amber-500 via-indigo-600 to-indigo-500 flex items-center justify-center text-white font-black text-xl sm:text-2xl shadow-lg ring-2 ring-amber-500/20">
                {avatarLetter}
              </div>
              <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-white dark:border-slate-950 rounded-full" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                  Welcome back{displayName ? `, ${displayName}` : ''}
                </h1>
                <button
                  type="button"
                  onClick={onOpenNicknameModal}
                  className="p-1 rounded-md text-slate-400 hover:text-amber-500 dark:hover:text-amber-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title="Edit nickname or name"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse shrink-0" />
                <span className="font-bold text-amber-600 dark:text-amber-400 tracking-wide">
                  {(brandName || 'TwinMind AI').toUpperCase()}
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="text-slate-600 dark:text-slate-300 font-medium">Thinking Partner &amp; Digital Twin</span>
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-3.5 leading-relaxed">
          Calibrated to your thinking, analytical approach, cost-consciousness, and practical decision-making. I evaluate ideas candidly, question weak assumptions, and help you determine the single most sensible next step.
        </p>

        {/* Primary Action Button */}
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateTab('chat')}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs sm:text-sm shadow-md transition"
          >
            <MessageSquare className="w-4 h-4" />
            <span>{messageCount > 0 ? 'Resume Chat' : 'Open Chat Workspace'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab('advice')}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700/80 font-medium text-xs sm:text-sm transition"
          >
            <Target className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            <span>7-Step Decision</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab('advice')}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 font-medium text-xs sm:text-sm transition"
          >
            <Users className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
            <span>Multi-Agent Debate</span>
          </button>
        </div>
      </div>

      {/* Learning Journeys & Continuity Workspaces */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/85 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-md space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
            <h2 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">
              Learning Journeys &amp; Continuity
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowNewJourneyForm((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showNewJourneyForm ? 'Close' : 'New Journey'}</span>
          </button>
        </div>

        {journeysError && (
          <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-300">
            {journeysError}
          </div>
        )}

        {showNewJourneyForm && (
          <form onSubmit={handleCreateJourney} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
            <input
              type="text"
              value={journeyTitle}
              onChange={(e) => setJourneyTitle(e.target.value)}
              placeholder="Journey title (e.g., Forex Price Action & Risk Mastery)"
              className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
              required
            />
            <input
              type="text"
              value={journeyNextStep}
              onChange={(e) => setJourneyNextStep(e.target.value)}
              placeholder="Where you left off / Next lesson or step..."
              className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
            />
            <textarea
              value={journeyDescription}
              onChange={(e) => setJourneyDescription(e.target.value)}
              rows={2}
              placeholder="Optional goal or syllabus notes..."
              className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewJourneyForm(false)}
                className="px-2.5 py-1 rounded-lg text-xs text-slate-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingJourney || !journeyTitle.trim()}
                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                {isSavingJourney ? 'Saving...' : 'Create Journey'}
              </button>
            </div>
          </form>
        )}

        {journeys.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No learning journeys created yet. Group related study or project threads together with a tracked next step.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {journeys.map((journey) => (
              <div
                key={journey.id}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2 flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                      {journey.title}
                    </h3>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase shrink-0 border ${
                        journey.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                          : journey.status === 'paused'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25'
                            : 'bg-slate-500/10 text-slate-500 border-slate-500/25'
                      }`}
                    >
                      {journey.status}
                    </span>
                  </div>

                  {editingJourneyId === journey.id ? (
                    <div className="space-y-1.5 pt-1">
                      <input
                        type="text"
                        value={editJourneyNextStep}
                        onChange={(e) => setEditJourneyNextStep(e.target.value)}
                        placeholder="Next step..."
                        className="w-full px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-[11px]"
                      />
                      <div className="flex items-center gap-1.5">
                        <select
                          value={editJourneyStatus}
                          onChange={(e) => setEditJourneyStatus(e.target.value as any)}
                          className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-[11px]"
                        >
                          <option value="active">active</option>
                          <option value="paused">paused</option>
                          <option value="completed">completed</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => { void handleSaveJourneyEdit(journey.id); }}
                          className="px-2 py-1 rounded bg-indigo-600 text-white text-[11px] font-semibold"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingJourneyId(null)}
                          className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-[11px]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {journey.next_step && (
                        <p className="text-[11px] text-indigo-700 dark:text-indigo-300 font-medium">
                          Next: {journey.next_step}
                        </p>
                      )}
                      {journey.last_message_preview && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                          Last turn: {journey.last_message_preview}
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-800/70">
                  <span className="text-[10px] text-slate-400 font-mono">
                    {journey.thread_count} thread(s)
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingJourneyId(journey.id);
                        setEditJourneyNextStep(journey.next_step || '');
                        setEditJourneyStatus(journey.status);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-indigo-500"
                      title="Edit next step or status"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleDeleteJourney(journey.id); }}
                      className="p-1 rounded text-slate-400 hover:text-red-500"
                      title="Delete journey"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (journey.latest_thread_id && onSelectThread) {
                          onSelectThread(journey.latest_thread_id);
                        } else if (onStartJourneyThread) {
                          void onStartJourneyThread(journey.id, journey.title);
                        } else {
                          onNavigateTab('chat');
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition"
                    >
                      <span>{journey.latest_thread_id ? 'Continue' : 'Start Thread'}</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Proactive Scheduled Check-Ins (Telegram / WhatsApp) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/85 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-md space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            <h2 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">
              Scheduled Follow-Ups &amp; Check-Ins
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowNewCheckinForm((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[11px] font-semibold transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showNewCheckinForm ? 'Close' : 'Schedule Check-In'}</span>
          </button>
        </div>

        {checkinsError && (
          <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-300">
            {checkinsError}
          </div>
        )}

        {checkinActionNotice && (
          <div
            className={`p-2.5 rounded-xl text-xs border flex items-center justify-between gap-2 ${
              checkinActionNotice.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {checkinActionNotice.type === 'success'
                ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{checkinActionNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setCheckinActionNotice(null)}
              className="p-0.5 rounded hover:bg-black/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {showNewCheckinForm && (
          <form onSubmit={handleCreateCheckin} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={checkinTitle}
                onChange={(e) => setCheckinTitle(e.target.value)}
                placeholder="Reminder title..."
                className="sm:col-span-2 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
                required
              />
              <select
                value={checkinChannel}
                onChange={(e) => setCheckinChannel(e.target.value as 'telegram' | 'whatsapp')}
                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
              >
                <option value="telegram">Telegram</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>
            <textarea
              value={checkinPrompt}
              onChange={(e) => setCheckinPrompt(e.target.value)}
              rows={2}
              placeholder="Check-in message or question to deliver..."
              className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs"
              required
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Send in (minutes):</span>
                <input
                  type="number"
                  min={1}
                  max={43200}
                  value={checkinDelayMinutes}
                  onChange={(e) => setCheckinDelayMinutes(e.target.value)}
                  className="w-20 px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                />
              </label>
              <button
                type="submit"
                disabled={isSavingCheckin || !checkinTitle.trim() || !checkinPrompt.trim()}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold disabled:opacity-50"
              >
                {isSavingCheckin ? 'Scheduling...' : 'Save Check-In'}
              </button>
            </div>
          </form>
        )}

        {checkins.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No scheduled check-ins. Schedule reminders here or ask TwinMind in chat to follow up with you on Telegram or WhatsApp.
          </p>
        ) : (
          <div className="space-y-2">
            {checkins.slice(0, 6).map((c) => (
              <div
                key={c.id}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">{c.title}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase font-semibold">
                      {c.channel}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded font-semibold uppercase ${
                        c.status === 'sent'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : c.status === 'failed'
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            : c.status === 'cancelled'
                              ? 'bg-slate-500/15 text-slate-500'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {c.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">{c.prompt}</p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    Due: {new Date(c.due_at).toLocaleString()}
                    {c.sent_at ? ` · Sent: ${new Date(c.sent_at).toLocaleString()}` : ''}
                  </p>
                  {c.last_error && (
                    <p className="text-[10px] text-rose-600 dark:text-rose-400 break-words">
                      Error: {c.last_error}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {(c.status === 'pending' || c.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => { void handleTriggerCheckin(c.id); }}
                      disabled={triggeringCheckinId === c.id}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-medium transition disabled:opacity-50"
                      title="Send now via configured channel"
                    >
                      <Play className="w-3 h-3" />
                      <span>{triggeringCheckinId === c.id ? 'Sending...' : 'Send Now'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { void handleCancelOrDeleteCheckin(c); }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500"
                    title={c.status === 'pending' ? 'Cancel check-in' : 'Delete check-in'}
                  >
                    {c.status === 'pending' ? <X className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Multi-Model Brain Engine Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-md space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            <h2 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">Active Reasoning Brain</h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('settings')}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-medium transition"
          >
            Configure Models →
          </button>
        </div>

        {/* Current Active Model Banner */}
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">
                {activeProvider} Provider
              </div>
              <div className="text-xs sm:text-sm font-mono font-bold text-amber-600 dark:text-amber-300 truncate max-w-[200px] sm:max-w-xs">
                {activeModel || providerModels[activeProvider as keyof typeof providerModels] || 'Live Model'}
              </div>
            </div>
          </div>

          <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-mono">
            ● Live API
          </span>
        </div>

        {/* Quick Provider Switcher Buttons */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <button
            type="button"
            onClick={() => onProviderChange('gemini')}
            className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
              activeProvider === 'gemini'
                ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-300 dark:border-indigo-500/80 text-indigo-900 dark:text-indigo-200 ring-1 ring-indigo-500/30'
                : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span>🧠 Gemini</span>
              {activeProvider === 'gemini' && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400" />}
            </div>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-300 truncate mt-1">
              {providerModels.gemini}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onProviderChange('groq')}
            className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
              activeProvider === 'groq'
                ? 'bg-emerald-50 dark:bg-emerald-600/20 border-emerald-300 dark:border-emerald-500/80 text-emerald-900 dark:text-emerald-200 ring-1 ring-emerald-500/30'
                : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span>⚡ Groq</span>
              {activeProvider === 'groq' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />}
            </div>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-300 truncate mt-1">
              {providerModels.groq}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onProviderChange('mistral')}
            className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
              activeProvider === 'mistral'
                ? 'bg-amber-50 dark:bg-amber-600/20 border-amber-300 dark:border-amber-500/80 text-amber-900 dark:text-amber-200 ring-1 ring-amber-500/30'
                : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span>🔬 Mistral</span>
              {activeProvider === 'mistral' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />}
            </div>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-300 truncate mt-1">
              {providerModels.mistral}
            </span>
          </button>
        </div>
      </div>

      {/* Recent Conversations / Multi-Thread Quick Access */}
      {threads && threads.length > 0 && (
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                Recent Conversations ({threads.length})
              </h3>
            </div>
            {onOpenThreadDrawer && (
              <button
                type="button"
                onClick={onOpenThreadDrawer}
                className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-medium transition flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {threads.slice(0, 4).map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => {
                  if (onSelectThread) onSelectThread(thread.id);
                  else onNavigateTab('chat');
                }}
                className="p-3 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-950/70 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800/80 hover:border-amber-500/40 text-left transition group"
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-amber-600 dark:group-hover:text-amber-300 truncate">
                    {thread.title}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono shrink-0">
                    {thread.message_count || 0} msgs
                  </span>
                </div>
                {thread.last_message && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate line-clamp-1">
                    {thread.last_message}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Sparring Prompt Starters */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            <h2 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">Quick Sparring Starters</h2>
          </div>
          <div className="flex items-center gap-2">
            {onRefreshDynamicPrompts && (
              <button
                type="button"
                onClick={onRefreshDynamicPrompts}
                className="text-[11px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-semibold flex items-center gap-1 transition p-1 rounded-md hover:bg-amber-500/10"
                title="Refresh dynamic AI prompts"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            )}
            {onOpenCustomPromptModal && (
              <button
                type="button"
                onClick={onOpenCustomPromptModal}
                className="text-[11px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-semibold flex items-center gap-1 transition"
                title="Create custom sparring prompt template"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Custom Prompt</span>
              </button>
            )}
            <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline">Tap to start</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Custom user prompt templates */}
          {customPrompts.map((cp, idx) => (
            <button
              key={`custom-${idx}`}
              type="button"
              onClick={() => onSelectPrompt(cp.prompt)}
              className="p-3.5 rounded-xl bg-amber-50/50 hover:bg-amber-100/50 dark:bg-amber-950/20 dark:hover:bg-amber-950/30 border border-amber-300 dark:border-amber-600/50 hover:border-amber-500 text-left transition space-y-1.5 group shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between text-[10.5px] text-amber-700 dark:text-amber-400 font-semibold mb-1">
                  <span className="px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30">
                    {cp.category || 'Custom Template'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-amber-600 dark:group-hover:text-amber-400 group-hover:translate-x-0.5 transition" />
                </div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white">{cp.title}</h3>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed mt-1 line-clamp-2">
                  {cp.desc || cp.prompt}
                </p>
              </div>
            </button>
          ))}

          {/* Dynamic AI generated starters */}
          {dynamicPrompts.map((item, idx) => (
            <button
              key={`dynamic-${idx}`}
              type="button"
              onClick={() => onSelectPrompt(item.prompt)}
              className="p-3.5 rounded-xl bg-white hover:bg-slate-50 dark:bg-slate-900/80 dark:hover:bg-slate-800/90 border border-slate-200 dark:border-slate-800/80 hover:border-amber-500/40 text-left transition space-y-1.5 group shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between text-[10.5px] text-amber-600 dark:text-amber-400 font-semibold mb-1">
                  <span>{item.badge || item.category || 'Live Dynamic Prompt'}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover:text-amber-600 dark:group-hover:text-amber-400 group-hover:translate-x-0.5 transition" />
                </div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-200">{item.title}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1 line-clamp-2">
                  {item.desc || item.description || item.prompt}
                </p>
              </div>
            </button>
          ))}

          {customPrompts.length === 0 && dynamicPrompts.length === 0 && (
            <div className="col-span-1 sm:col-span-2 p-6 text-center space-y-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-xs text-slate-500">
              <p>No active prompt starters yet.</p>
              {onRefreshDynamicPrompts && (
                <button
                  type="button"
                  onClick={onRefreshDynamicPrompts}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold hover:bg-amber-500/20 transition inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Generate Live Suggestions</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Knowledge Vault & Telegram Integration Status Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Neon pgvector Knowledge Vault card */}
        <div className="rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 flex flex-col justify-between space-y-2.5 shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white">Knowledge Vault</h3>
              </div>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                Neon pgvector
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {knowledgeStats
                ? `${knowledgeStats.totalDocuments} document(s) stored · 768-dim semantic search`
                : 'Semantic vector notes & decision frameworks'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('knowledge')}
            className="w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-800 dark:text-slate-200 text-xs font-medium transition text-center"
          >
            Manage Knowledge Vault →
          </button>
        </div>

        {/* Telegram Bot Card */}
        <div className="rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 flex flex-col justify-between space-y-2.5 shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-[#2AABEE]" />
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white">Telegram Bot</h3>
              </div>
              {telegramStatus?.botUsername ? (
                <a
                  href={`https://t.me/${telegramStatus.botUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[#2AABEE]/10 text-[#2AABEE] border border-[#2AABEE]/20 font-medium hover:bg-[#2AABEE]/20 transition flex items-center gap-1"
                  title={`Open @${telegramStatus.botUsername} in Telegram`}
                >
                  <span>@{telegramStatus.botUsername}</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 font-mono">
                  {telegramStatus?.isRunning ? 'Bot Online' : 'Not Configured'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {telegramStatus?.isRunning
                ? telegramStatus.isPaired
                  ? '🟢 Paired with your phone · Real-time notifications'
                  : '🟡 Bot online · Ready to pair with /start'
                : 'Connect and chat directly via Telegram app'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              if (onOpenTelegramModal) {
                onOpenTelegramModal();
              } else {
                onNavigateTab('settings');
              }
            }}
            className="w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-800 dark:text-slate-200 text-xs font-medium transition text-center"
          >
            Configure Bot &amp; Pairing →
          </button>
        </div>
      </div>

      {/* Core Operating Principles / Pillars */}
      <div className="pt-2 text-center space-y-2">
        <div className="text-[10.5px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
          Core Operating Creed
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            Truth over appearance
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            Substance over hype
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            Cost &amp; trade-offs
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            Next practical step
          </span>
        </div>
      </div>
    </div>
  );
};
