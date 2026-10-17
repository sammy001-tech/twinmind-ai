import React, { useState, useRef, useEffect } from 'react';
import { ChannelType, ChatMessage, PromptTemplate, AppSettings, ChatThread, SwarmSessionState } from './types/index.ts';
import { Header } from './components/Header.tsx';
import { ChatMessageItem, GroupedChatMessageList } from './components/ChatMessage.tsx';
import { ArtifactStorageNotice } from './components/ArtifactStorageNotice.tsx';
import { ChatInput } from './components/ChatInput.tsx';
import { DecisionAnalyzerModal } from './components/DecisionAnalyzerModal.tsx';
import { DecisionCalibrationDashboard } from './components/DecisionCalibrationDashboard.tsx';
import { ProfileModal } from './components/ProfileModal.tsx';
import { NicknameModal } from './components/NicknameModal.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { TelegramModal } from './components/TelegramModal.tsx';
import { KnowledgeModal } from './components/KnowledgeModal.tsx';
import { BottomNav, NavigationTab } from './components/BottomNav.tsx';
import { HomeView } from './components/HomeView.tsx';
import { ThreadDrawer } from './components/ThreadDrawer.tsx';
import { ChatExportModal } from './components/ChatExportModal.tsx';
import { ChatSearchInput } from './components/ChatSearchInput.tsx';
import { CustomPromptModal } from './components/CustomPromptModal.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { VoiceRecorderModal } from './components/VoiceRecorderModal.tsx';
import { useTheme, ThemeMode } from './hooks/useTheme.ts';
import {
  Sparkles,
  Target,
  Brain,
  Globe,
  Send,
  MessageSquare,
  Loader2,
  AlertTriangle,
  ArrowRight,
  ArrowDown,
  Edit3,
  Plus,
} from 'lucide-react';
import { getChatScrollState } from './utils/chatScroll.ts';
import { normalizeDynamicPromptTemplates } from './utils/dynamicPrompts.ts';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavigationTab>('home');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [channel, setChannel] = useState<ChannelType>('web');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [promptTemplatesStatus, setPromptTemplatesStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [promptTemplatesError, setPromptTemplatesError] = useState<string | null>(null);
  const promptRequestIdRef = useRef(0);

  const fetchPrompts = async (refresh = false) => {
    const requestId = ++promptRequestIdRef.current;
    setPromptTemplatesStatus('loading');
    setPromptTemplatesError(null);

    try {
      const url = refresh ? `/api/suggested-prompts?refresh=${Date.now()}` : '/api/suggested-prompts';
      const res = await fetch(url);
      const data: unknown = await res.json().catch(() => null);
      const payload = data && typeof data === 'object' && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;

      if (!res.ok || !payload || payload.success !== true) {
        const message = typeof payload?.error === 'string' && payload.error.trim()
          ? payload.error
          : `Dynamic prompt service returned HTTP ${res.status} without a usable explanation.`;
        throw new Error(message);
      }

      const normalizedPrompts = normalizeDynamicPromptTemplates(payload.prompts);
      if (normalizedPrompts.length === 0) {
        throw new Error(
          'The dynamic prompt service returned no usable prompts. No substitute prompts were generated.',
        );
      }

      if (requestId !== promptRequestIdRef.current) return;
      setPromptTemplates(normalizedPrompts);
      setPromptTemplatesStatus('ready');
      setPromptTemplatesError(null);
    } catch (err) {
      if (requestId !== promptRequestIdRef.current) return;
      setPromptTemplates([]);
      setPromptTemplatesStatus('unavailable');
      setPromptTemplatesError(
        err instanceof Error ? err.message : 'Dynamic prompt generation is unavailable.',
      );
      console.warn('Dynamic suggested prompts are unavailable:', err);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, [messages.length]);

  // Multi-Thread Conversations State (Database Persisted)
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isThreadDrawerOpen, setIsThreadDrawerOpen] = useState(false);

  // App Brand Name & User Identity (Dynamically loaded directly from database)
  const [brandName, setBrandName] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [nickname, setNickname] = useState<string>('');

  // Multi-Model Brain: Per-provider Model Selection (Dynamically loaded from database)
  const [activeProvider, setActiveProvider] = useState<string>('');

  const [providerModels, setProviderModels] = useState<{
    gemini: string;
    groq: string;
    mistral: string;
  }>({
    gemini: '',
    groq: '',
    mistral: '',
  });

  const activeModel = providerModels[activeProvider as keyof typeof providerModels] || '';

  const [voice, setVoice] = useState<string>('');
  const [customGeminiKey, setCustomGeminiKey] = useState<string>('');
  const [customGroqKey, setCustomGroqKey] = useState<string>('');
  const [customMistralKey, setCustomMistralKey] = useState<string>('');
  const [customTavilyKey, setCustomTavilyKey] = useState<string>('');

  // Theme hook (Dark, Light, System)
  const { themeMode, setThemeMode, isDark } = useTheme();

  // Modals & Feature State
  const [isDecisionModalOpen, setIsDecisionModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isNicknameModalOpen, setIsNicknameModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [isKnowledgeModalOpen, setIsKnowledgeModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isCustomPromptModalOpen, setIsCustomPromptModalOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);

  // In-Chat Search & Filtering State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [filterOnlyMatches, setFilterOnlyMatches] = useState(false);

  // Voice Note Playback Preferences
  const [autoPlayVoice, setAutoPlayVoice] = useState<boolean>(false);
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1);

  const handleAutoPlayVoiceChange = (val: boolean) => {
    setAutoPlayVoice(val);
    syncSettingsToServer({ autoPlayVoice: val });
  };

  const handleVoiceSpeedChange = (speed: number) => {
    setVoiceSpeed(speed);
    syncSettingsToServer({ voiceSpeed: speed });
  };

  // Custom Prompt Templates (Vault & Home) - Saved to Database
  const [customPrompts, setCustomPrompts] = useState<PromptTemplate[]>([]);

  const handleSaveCustomPrompt = (template: PromptTemplate) => {
    const updated = [template, ...customPrompts.filter((p) => p.title !== template.title)];
    setCustomPrompts(updated);
    syncSettingsToServer({ customPrompts: updated });
  };

  const handleDeleteCustomPrompt = (title: string) => {
    const updated = customPrompts.filter((p) => p.title !== title);
    setCustomPrompts(updated);
    syncSettingsToServer({ customPrompts: updated });
  };

  const handleSaveBrandName = (newBrand: string) => {
    setBrandName(newBrand);
    syncSettingsToServer({ brandName: newBrand });
  };

  const [telegramStatus, setTelegramStatus] = useState<{
    isRunning: boolean;
    hasToken: boolean;
    isPaired: boolean;
  }>({ isRunning: false, hasToken: false, isPaired: false });

  // Synchronize any setting change directly to Neon PostgreSQL database via /api/settings
  const syncSettingsToServer = async (patch: Partial<AppSettings>) => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      console.warn('Failed to sync settings to database:', err);
    }
  };

  const handleThemeModeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    syncSettingsToServer({ themeMode: mode });
  };

  // Load server-persisted unified settings dynamically from Database on mount (no stale local storage)
  useEffect(() => {
    // Proactively purge any legacy stale local storage
    try {
      localStorage.removeItem('twin_cached_settings');
      localStorage.removeItem('twinmind_key_test_statuses_v2');
      localStorage.removeItem('twin_voice_speed');
      localStorage.removeItem('twin_theme');
    } catch {}

    const loadSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.settings) {
            const s: AppSettings = data.settings;
            if (s.brandName) setBrandName(s.brandName);
            if (s.userName !== undefined) setUserName(s.userName);
            if (s.nickname !== undefined) setNickname(s.nickname);
            if (s.activeProvider) setActiveProvider(s.activeProvider);
            if (s.providerModels) setProviderModels(s.providerModels);
            if (s.voice) setVoice(s.voice);
            if (s.customGeminiKey !== undefined) setCustomGeminiKey(s.customGeminiKey);
            if (s.customGroqKey !== undefined) setCustomGroqKey(s.customGroqKey);
            if (s.customMistralKey !== undefined) setCustomMistralKey(s.customMistralKey);
            if (s.customTavilyKey !== undefined) setCustomTavilyKey(s.customTavilyKey);
            if (s.autoPlayVoice !== undefined) setAutoPlayVoice(Boolean(s.autoPlayVoice));
            if (s.voiceSpeed !== undefined) setVoiceSpeed(Number(s.voiceSpeed));
            if (s.customPrompts && Array.isArray(s.customPrompts)) setCustomPrompts(s.customPrompts);
            if (s.activeThreadId) setActiveThreadId(s.activeThreadId);
            if (s.themeMode) setThemeMode(s.themeMode);
          }
        }
      } catch (err) {
        console.warn('Could not dynamically load unified settings from database:', err);
      }
    };

    loadSettings();
    loadThreads();
  }, []);

  // Load conversation threads from Database
  const loadThreads = async () => {
    try {
      const res = await fetch('/api/threads');
      if (res.ok) {
        const data = await res.json();
        if (data.threads && Array.isArray(data.threads)) {
          setThreads(data.threads);

          // Restore or select active thread
          let targetId = activeThreadId;
          if (!targetId || !data.threads.some((t: ChatThread) => t.id === targetId)) {
            if (data.threads.length > 0) {
              targetId = data.threads[0].id;
            }
          }

          if (targetId) {
            setActiveThreadId(targetId);
            syncSettingsToServer({ activeThreadId: targetId });
            await loadThreadMessages(targetId);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to load threads from server:', err);
    }
  };

  // Load messages for a specific conversation thread from Neon DB
  const loadThreadMessages = async (threadId: string) => {
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages && Array.isArray(data.messages)) {
          const loaded: ChatMessage[] = data.messages.map((m: any) => ({
            id: String(m.id || `msg-${Date.now()}`),
            dbId: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.created_at
              ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '',
            createdAt: m.created_at ? new Date(m.created_at).getTime() : undefined,
            channel: m.channel,
            modelInfo: typeof m.provider === 'string' && m.provider ? { provider: m.provider, model: typeof m.model === 'string' ? m.model : '' } : undefined,
            artifacts: m.metadata?.artifacts || [],
          }));
          pendingThreadRestoreRef.current = threadId;
          setMessages(loaded);
          setActiveThreadId(threadId);
          syncSettingsToServer({ activeThreadId: threadId });
        }
      }
    } catch (err) {
      console.warn('Failed to load thread messages:', err);
    }
  };

  const handleSelectThread = async (threadId: string) => {
    await loadThreadMessages(threadId);
    setActiveTab('chat');
  };

  const handleNewThread = () => {
    const newId = `thread-${Date.now()}`;
    pendingThreadRestoreRef.current = newId;
    isFollowingLatestRef.current = true;
    jumpToLatestInProgressRef.current = false;
    setShowScrollToLatest(false);
    setActiveThreadId(newId);
    syncSettingsToServer({ activeThreadId: newId });
    setMessages([]);
    setActiveTab('chat');
  };

  const handleRenameThread = async (threadId: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/threads/${threadId}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, title: newTitle } : t))
        );
      }
    } catch (err) {
      console.error('Failed to rename thread:', err);
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    try {
      const res = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
      if (res.ok) {
        const remaining = threads.filter((t) => t.id !== threadId);
        setThreads(remaining);
        if (activeThreadId === threadId) {
          if (remaining.length > 0) {
            await handleSelectThread(remaining[0].id);
          } else {
            handleNewThread();
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete thread:', err);
    }
  };

  const handleClearAllThreads = async () => {
    try {
      const res = await fetch('/api/threads', { method: 'DELETE' });
      if (res.ok) {
        setThreads([]);
        setMessages([]);
        handleNewThread();
      }
    } catch (err) {
      console.error('Failed to clear all threads:', err);
    }
  };

  const handleEditMessage = async (messageId: string, newContent: string) => {
    const targetMsg = messages.find((m) => m.id === messageId);
    if (!targetMsg) return;

    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, content: newContent } : m))
    );

    try {
      const dbIdentifier = targetMsg.dbId || messageId;
      await fetch(`/api/messages/${dbIdentifier}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newContent,
          threadId: activeThreadId,
        }),
      });
    } catch (err) {
      console.warn('Failed to update message in database:', err);
    }
  };

  const handleEditAndRegenerate = async (messageId: string, newContent: string) => {
    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const truncated = messages.slice(0, msgIndex);
    setMessages(truncated);

    const targetMsg = messages[msgIndex];
    if (targetMsg?.dbId) {
      fetch(`/api/messages/${targetMsg.dbId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent, threadId: activeThreadId }),
      }).catch(() => {});
    }

    await handleSendMessage(newContent, false, undefined, truncated);
  };

  const handleDeleteMessage = async (messageId: string) => {
    const targetMsg = messages.find((m) => m.id === messageId);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));

    try {
      const dbIdentifier = targetMsg?.dbId || messageId;
      await fetch(`/api/messages/${dbIdentifier}?threadId=${encodeURIComponent(activeThreadId || '')}`, {
        method: 'DELETE',
      });
      if (activeThreadId) {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === activeThreadId
              ? { ...t, message_count: Math.max(0, (t.message_count || 1) - 1) }
              : t
          )
        );
      }
    } catch (err) {
      console.warn('Failed to delete message from database:', err);
    }
  };



  // Monitor Telegram service connection status (without overwriting user settings)
  useEffect(() => {
    const checkTelegram = async () => {
      try {
        const res = await fetch('/api/telegram/status');
        if (res.ok) {
          const data = await res.json();
          setTelegramStatus({
            isRunning: Boolean(data.isRunning),
            hasToken: Boolean(data.hasToken),
            isPaired: Boolean(data.isPaired),
          });
        }
      } catch (err) {
        console.warn('Failed to query telegram status:', err);
      }
    };

    checkTelegram();
    const interval = setInterval(checkTelegram, 8000);
    return () => clearInterval(interval);
  }, []);

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesContentRef = useRef<HTMLDivElement | null>(null);
  const isFollowingLatestRef = useRef(true);
  const jumpToLatestInProgressRef = useRef(false);
  const pendingThreadRestoreRef = useRef<string | null>(null);
  const threadScrollPositionsRef = useRef<Map<string, number>>(new Map());
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

  const displayName = nickname.trim() || userName.trim();
  const initialLetter = (userName.trim() || brandName.trim()).charAt(0).toUpperCase();

  const handleSaveNickname = (newName: string, newNickname: string) => {
    setUserName(newName);
    setNickname(newNickname);
    syncSettingsToServer({ userName: newName, nickname: newNickname });
  };

  const handleProviderChange = (p: string) => {
    setActiveProvider(p);
    const targetModel = providerModels[p as keyof typeof providerModels] || '';
    syncSettingsToServer({
      activeProvider: p as 'gemini' | 'groq' | 'mistral',
      activeModel: targetModel,
    });
  };

  const handleSelectProviderModel = (provider: string, model: string) => {
    const updated = { ...providerModels, [provider]: model };
    setProviderModels(updated);
    syncSettingsToServer({
      providerModels: updated,
      ...(provider === activeProvider ? { activeModel: model } : {}),
    });
  };

  const handleSelectModelAndActivate = (provider: string, model: string) => {
    const updated = { ...providerModels, [provider]: model };
    setProviderModels(updated);
    setActiveProvider(provider);
    syncSettingsToServer({
      activeProvider: provider as 'gemini' | 'groq' | 'mistral',
      activeModel: model,
      providerModels: updated,
    });
  };

  const handleVoiceChange = (newVoice: string) => {
    setVoice(newVoice);
    syncSettingsToServer({ voice: newVoice });
  };

  const persistCredentialSetting = async (
    field: 'customGeminiKey' | 'customGroqKey' | 'customMistralKey' | 'customTavilyKey',
    key: string,
    updateClientValue: (value: string) => void,
  ) => {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: key }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success !== true) {
      throw new Error(typeof data?.error === 'string' ? data.error : 'Credential persistence failed. Check Neon database connectivity.');
    }
    const sanitizedValue = data.settings?.[field];
    updateClientValue(typeof sanitizedValue === 'string' ? sanitizedValue : '');
  };

  const handleSaveGeminiKey = async (key: string) => {
    await persistCredentialSetting('customGeminiKey', key, setCustomGeminiKey);
  };

  const handleSaveGroqKey = async (key: string) => {
    await persistCredentialSetting('customGroqKey', key, setCustomGroqKey);
  };

  const handleSaveMistralKey = async (key: string) => {
    await persistCredentialSetting('customMistralKey', key, setCustomMistralKey);
  };

  const handleSaveTavilyKey = async (key: string) => {
    await persistCredentialSetting('customTavilyKey', key, setCustomTavilyKey);
  };

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const scrollState = getChatScrollState({
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
    });

    if (jumpToLatestInProgressRef.current) {
      setShowScrollToLatest(scrollState.shouldShowJumpToLatest);
      if (scrollState.isAtLatest) {
        jumpToLatestInProgressRef.current = false;
        isFollowingLatestRef.current = true;
      }
    } else {
      isFollowingLatestRef.current = scrollState.isAtLatest;
      setShowScrollToLatest(scrollState.shouldShowJumpToLatest);
    }

    if (activeThreadId) {
      threadScrollPositionsRef.current.set(activeThreadId, container.scrollTop);
    }
  };

  const interruptProgrammaticScroll = () => {
    jumpToLatestInProgressRef.current = false;
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth', forceFollow = false) => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (forceFollow) {
      isFollowingLatestRef.current = true;
      jumpToLatestInProgressRef.current = behavior === 'smooth';
    }

    container.scrollTo({ top: container.scrollHeight, behavior });

    if (behavior === 'auto') {
      jumpToLatestInProgressRef.current = false;
      isFollowingLatestRef.current = true;
      setShowScrollToLatest(false);
    }

    if (activeThreadId) {
      threadScrollPositionsRef.current.set(
        activeThreadId,
        Math.max(0, container.scrollHeight - container.clientHeight),
      );
    }
  };

  useEffect(() => {
    if (activeTab !== 'chat') return;

    const requestedThreadId = pendingThreadRestoreRef.current;
    const shouldRestoreThread = Boolean(
      requestedThreadId && requestedThreadId === activeThreadId,
    );

    const frame = window.requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (!container) return;

      if (shouldRestoreThread && requestedThreadId) {
        if (pendingThreadRestoreRef.current !== requestedThreadId) return;
        pendingThreadRestoreRef.current = null;
        jumpToLatestInProgressRef.current = false;

        const savedScrollTop = threadScrollPositionsRef.current.get(requestedThreadId);
        if (savedScrollTop !== undefined) {
          container.scrollTop = Math.min(
            savedScrollTop,
            Math.max(0, container.scrollHeight - container.clientHeight),
          );
          handleMessagesScroll();
        } else {
          scrollToBottom('auto', true);
        }
        return;
      }

      const savedScrollTop = activeThreadId
        ? threadScrollPositionsRef.current.get(activeThreadId)
        : undefined;
      if (!isFollowingLatestRef.current && savedScrollTop !== undefined) {
        container.scrollTop = Math.min(
          savedScrollTop,
          Math.max(0, container.scrollHeight - container.clientHeight),
        );
      } else if (isFollowingLatestRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      handleMessagesScroll();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, isLoading, activeThreadId, activeTab]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const content = messagesContentRef.current;
    if (activeTab !== 'chat' || !container || !content || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (isFollowingLatestRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      handleMessagesScroll();
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [activeTab, activeThreadId]);

  // Handle sending a chat message with live Server-Sent Events (SSE) streaming and dynamic model dispatch
  const handleSendMessage = async (
    text: string,
    requestAudio: boolean = false,
    audioData?: { mimeType: string; data: string },
    baseMessages: ChatMessage[] = messages,
    useSwarm?: boolean,
    imageData?: { mimeType: string; data: string; name?: string }
  ) => {
    if ((!text.trim() && !audioData && !imageData) || isLoading) return;

    setActiveTab('chat');
    setErrorMessage(null);
    isFollowingLatestRef.current = true;
    jumpToLatestInProgressRef.current = false;
    setShowScrollToLatest(false);

    const now = Date.now();
    const currentThreadId = activeThreadId || `thread-${now}`;
    if (!activeThreadId) {
      setActiveThreadId(currentThreadId);
      syncSettingsToServer({ activeThreadId: currentThreadId });
    }

    const userMsg: ChatMessage = {
      id: `user-${now}`,
      role: 'user',
      content: text,
      audioData,
      imageData,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: now,
      channel,
    };

    const newMessages = [...baseMessages, userMsg];
    setMessages(newMessages);
    setIsLoading(true);

    const assistantId = `assistant-${now + 1}`;
    const assistantMsgPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: now + 1,
      channel,
    };

    let assistantAdded = false;
    const ensureAssistantMessage = (initialPatch?: Partial<ChatMessage>) => {
      if (!assistantAdded) {
        assistantAdded = true;
        setMessages((prev) => {
          if (prev.some((m) => m.id === assistantId)) return prev;
          return [...prev, { ...assistantMsgPlaceholder, ...initialPatch }];
        });
      }
    };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m: any) => ({
            role: m.role,
            content: m.content,
            audioData: m.audioData,
            imageData: m.imageData,
          })),
          channel,
          userName,
          nickname,
          threadId: currentThreadId,
          threadTitle: baseMessages.length === 0 ? text.slice(0, 48) : undefined,
          userContext: {
            nickname: nickname || displayName,
            userName,
            activeModel,
            activeProvider,
            selectedVoice: voice,
            channel,
          },
          provider: activeProvider,
          model: activeModel,
          customGroqKey,
          customMistralKey,
          useSwarm,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Readable stream not supported.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';
      let sseBuffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        // Keep the last fragment in sseBuffer in case line boundary was split
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') {
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              // Model info metadata
              if (parsed.meta) {
                const { artifacts, ...modelInfo } = parsed.meta;
                ensureAssistantMessage({ 
                  ...(modelInfo.provider ? { modelInfo } : {}),
                  ...(artifacts ? { artifacts } : {})
                });
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId ? { 
                      ...msg, 
                      ...(modelInfo.provider ? { modelInfo } : {}),
                      ...(artifacts ? { artifacts } : {})
                    } : msg
                  )
                );
              }
              // Saved database message IDs
              if (parsed.savedMeta) {
                ensureAssistantMessage();
                const { userDbId, assistantDbId } = parsed.savedMeta;
                const persistence = parsed.savedMeta.persistence;
                if (persistence) {
                  const failedItems = Object.entries(persistence)
                    .filter(([, status]) => status === 'failed')
                    .map(([item]) => item);
                  if (failedItems.length > 0) {
                    setErrorMessage(
                      `Reply received, but database persistence failed for: ${failedItems.join(', ')}. The current conversation may not be available after a refresh.`
                    );
                  }
                }
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id === userMsg.id && userDbId) return { ...msg, dbId: userDbId };
                    if (msg.id === assistantId && assistantDbId) return { ...msg, dbId: assistantDbId };
                    return msg;
                  })
                );
                fetch('/api/threads')
                  .then((r) => (r.ok ? r.json() : null))
                  .then((d) => {
                    if (d?.threads) setThreads(d.threads);
                  })
                  .catch(() => {});
              }
              // Normal-chat live search and extraction events are rendered from actual tool responses.
              if (
                parsed.toolEvent &&
                (parsed.toolEvent.toolName === 'searchWeb' || parsed.toolEvent.toolName === 'extractWebPages') &&
                typeof parsed.toolEvent.toolId === 'string' &&
                parsed.toolEvent.toolId.trim()
              ) {
                const toolEvent = parsed.toolEvent;
                ensureAssistantMessage();
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== assistantId) return msg;
                    const current = [...(msg.researchActivity || [])];
                    const existingIndex = current.findIndex((activity) => activity.toolId === toolEvent.toolId);

                    if (toolEvent.type === 'start') {
                      if (existingIndex < 0) {
                        current.push({
                          toolId: toolEvent.toolId,
                          toolName: toolEvent.toolName,
                          status: 'running',
                          input: toolEvent.args && typeof toolEvent.args === 'object' ? toolEvent.args : undefined,
                        });
                      }
                    } else if (toolEvent.type === 'complete' && existingIndex >= 0) {
                      const result = toolEvent.result;
                      const resultRecord = result && typeof result === 'object' && !Array.isArray(result)
                        ? result as Record<string, unknown>
                        : null;
                      current[existingIndex] = {
                        ...current[existingIndex],
                        status: resultRecord?.status === 'success' ? 'completed' : 'error',
                        result,
                      };
                    }

                    return { ...msg, researchActivity: current };
                  })
                );
              }

              // Multi-Agent Specialist Swarm Real-Time Trace
              if (parsed.swarmEvent) {
                ensureAssistantMessage();
                const ev = parsed.swarmEvent;
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== assistantId) return msg;

                    const currentTrace: SwarmSessionState = msg.swarmTrace
                      ? JSON.parse(JSON.stringify(msg.swarmTrace))
                      : {
                          sessionId: ev.sessionId || `session-${Date.now()}`,
                          goal: ev.goal || '',
                          specialists: ev.specialists || [],
                          status: 'running',
                          specialistProgress: [],
                        };

                    if (ev.type === 'init') {
                      currentTrace.sessionId = ev.sessionId;
                      currentTrace.goal = ev.goal;
                      currentTrace.specialists = ev.specialists;
                      currentTrace.status = 'running';
                    } else if (ev.type === 'specialist_start') {
                      currentTrace.activeSpecialist = ev.specialist;
                      const existing = currentTrace.specialistProgress.find((p) => p.specialist === ev.specialist);
                      if (existing) {
                        existing.status = 'active';
                        existing.taskDescription = ev.taskDescription;
                      } else {
                        currentTrace.specialistProgress.push({
                          specialist: ev.specialist,
                          role: ev.role,
                          taskDescription: ev.taskDescription,
                          status: 'active',
                          tools: [],
                        });
                      }
                    } else if (ev.type === 'tool_call') {
                      let spec = currentTrace.specialistProgress.find((p) => p.specialist === ev.specialist);
                      if (!spec) {
                        spec = {
                          specialist: ev.specialist,
                          role: ev.specialist,
                          taskDescription: '',
                          status: 'active',
                          tools: [],
                        };
                        currentTrace.specialistProgress.push(spec);
                      }
                      spec.tools.push({
                        toolName: ev.toolName,
                        specialist: ev.specialist,
                        status: 'pending',
                        input: ev.input,
                      });
                    } else if (ev.type === 'tool_result') {
                      const spec = currentTrace.specialistProgress.find((p) => p.specialist === ev.specialist);
                      if (spec) {
                        const targetTool = [...spec.tools].reverse().find((t) => t.toolName === ev.toolName);
                        if (targetTool) {
                          targetTool.status = ev.status;
                          targetTool.durationMs = ev.durationMs;
                          targetTool.outputSummary = ev.outputSummary;
                          targetTool.result = ev.result;
                        }
                      }
                    } else if (ev.type === 'specialist_done') {
                      const spec = currentTrace.specialistProgress.find((p) => p.specialist === ev.specialist);
                      if (spec) {
                        spec.status = 'done';
                        spec.durationMs = ev.durationMs;
                        spec.summaryPreview = ev.summaryPreview;
                      }
                    } else if (ev.type === 'complete') {
                      const sessionStatus = ev.session?.status;
                      currentTrace.status = sessionStatus === 'failed' || sessionStatus === 'completed_with_errors'
                        ? 'error'
                        : sessionStatus === 'cancelled' || sessionStatus === 'timed_out'
                          ? 'aborted'
                          : 'completed';
                      if (ev.session) {
                        currentTrace.totalDurationMs = ev.session.totalDurationMs;
                      }
                    } else if (ev.type === 'error') {
                      currentTrace.status = 'error';
                    }

                    return {
                      ...msg,
                      swarmTrace: {
                        ...currentTrace,
                        specialistProgress: [...currentTrace.specialistProgress],
                      },
                    };
                  })
                );
              }

              if (parsed.text) {
                accumulatedContent += parsed.text;
                ensureAssistantMessage({ content: accumulatedContent });
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId ? { ...msg, content: accumulatedContent } : msg
                  )
                );
              }
            } catch (pErr) {
              if (pErr instanceof Error && pErr.message !== 'Unexpected end of JSON input' && dataStr.includes('"error"')) {
                throw pErr;
              }
            }
          }
        }
      }

      // Flush any remaining buffer fragment
      if (sseBuffer.trim().startsWith('data: ')) {
        const dataStr = sseBuffer.trim().slice(6).trim();
        if (dataStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.savedMeta) {
              ensureAssistantMessage();
              const { userDbId, assistantDbId } = parsed.savedMeta;
              const persistence = parsed.savedMeta.persistence;
              if (persistence) {
                const failedItems = Object.entries(persistence)
                  .filter(([, status]) => status === 'failed')
                  .map(([item]) => item);
                if (failedItems.length > 0) {
                  setErrorMessage(
                    `Reply received, but database persistence failed for: ${failedItems.join(', ')}. The current conversation may not be available after a refresh.`
                  );
                }
              }
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id === userMsg.id && userDbId) return { ...msg, dbId: userDbId };
                  if (msg.id === assistantId && assistantDbId) return { ...msg, dbId: assistantDbId };
                  return msg;
                })
              );
            }
            if (parsed.text) {
              accumulatedContent += parsed.text;
              ensureAssistantMessage({ content: accumulatedContent });
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId ? { ...msg, content: accumulatedContent } : msg
                )
              );
            }
          } catch {}
        }
      }

      // If user requested audio auto-generation, synthesize speech via Gemini TTS
      if (requestAudio && accumulatedContent) {
        handleGenerateAudio(assistantId, accumulatedContent);
      }
    } catch (err: unknown) {
      console.error('Chat error:', err);
      const errMsg = err instanceof Error ? err.message : 'Failed to communicate with your digital twin.';
      setErrorMessage(errMsg);
      const visibleError = `⚠️ Error: ${errMsg}`;
      ensureAssistantMessage({ content: visibleError });
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId ? { ...msg, content: visibleError } : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Generate Voice Note via dynamic TTS model resolution
  const handleGenerateAudio = async (messageId: string, text: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, isGeneratingAudio: true } : m))
    );

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate voice note.');
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, audioUrl: data.audioDataUrl, isGeneratingAudio: false } : m
        )
      );
    } catch (err: unknown) {
      console.error('Audio generation failed:', err);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isGeneratingAudio: false } : m))
      );
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setErrorMessage(null);
  };

  const handleRetryMessage = async (messageId: string) => {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;

    let userMsgIndex = index - 1;
    while (userMsgIndex >= 0 && messages[userMsgIndex].role !== 'user') {
      userMsgIndex--;
    }
    if (userMsgIndex < 0) return;

    const userMsg = messages[userMsgIndex];
    const priorMessages = messages.slice(0, userMsgIndex);
    await handleSendMessage(userMsg.content, false, undefined, priorMessages);
  };

  const handleExportChat = () => {
    setIsExportModalOpen(true);
  };

  // Adaptive channel & theme container styling
  const isLightTheme = !isDark;
  const channelContainerClass = isLightTheme
    ? channel === 'telegram'
      ? 'bg-[#e7ecef] text-slate-900'
      : channel === 'whatsapp'
      ? 'bg-[#efeae2] text-slate-900'
      : 'bg-slate-50 text-slate-900'
    : channel === 'telegram'
    ? 'bg-[#0e1621] text-slate-100'
    : channel === 'whatsapp'
    ? 'bg-[#0b141a] text-slate-100'
    : 'bg-slate-950 text-slate-100';

  const activeThread = threads.find((t) => t.id === activeThreadId);

  // Search matches within active messages
  const matchingMessages = searchQuery.trim()
    ? messages.filter((m) => m.content.toLowerCase().includes(searchQuery.toLowerCase().trim()))
    : [];

  const displayMessages = filterOnlyMatches && searchQuery.trim() ? matchingMessages : messages;

  const handleNextMatch = () => {
    if (matchingMessages.length === 0) return;
    const nextIdx = (searchMatchIndex + 1) % matchingMessages.length;
    setSearchMatchIndex(nextIdx);
    const target = document.getElementById(`message-${matchingMessages[nextIdx].id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handlePrevMatch = () => {
    if (matchingMessages.length === 0) return;
    const prevIdx = (searchMatchIndex - 1 + matchingMessages.length) % matchingMessages.length;
    setSearchMatchIndex(prevIdx);
    const target = document.getElementById(`message-${matchingMessages[prevIdx].id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className={`h-[100dvh] flex flex-col font-sans overflow-hidden overflow-x-hidden ${channelContainerClass}`}>
      {/* Top Header: Clean, Uncrowded */}
      <Header
        brandName={brandName}
        channel={channel}
        onChannelChange={setChannel}
        userName={userName}
        nickname={nickname}
        activeProvider={activeProvider}
        activeModel={activeModel}
        onOpenNicknameModal={() => setIsNicknameModalOpen(true)}
        onOpenSettingsModal={() => setActiveTab('settings')}
        onClearChat={handleClearChat}
        onExportChat={handleExportChat}
        messageCount={messages.length}
        activeTab={activeTab}
        onOpenThreadDrawer={() => {
          loadThreads();
          setIsThreadDrawerOpen(true);
        }}
        onNewThread={handleNewThread}
        activeThreadTitle={activeThread?.title}
        onToggleSearch={() => setIsSearchOpen((prev) => !prev)}
        isSearchOpen={isSearchOpen}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
        onProviderChange={handleProviderChange}
        onOpenVoiceModal={() => setIsVoiceModalOpen(true)}
      />

      {/* Main Content Area Switched by Navigation Tabs */}
      <div className="flex-1 flex flex-row min-h-0 overflow-hidden relative">
        {/* Desktop Persistent Sidebar (Optimized) */}
        <div className="hidden lg:flex w-72 h-full border-r border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-950 flex-col shrink-0">
          <ThreadDrawer
            isOpen={true}
            onClose={() => {}}
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onRenameThread={handleRenameThread}
            onDeleteThread={handleDeleteThread}
            onRefreshThreads={loadThreads}
            onClearAllThreads={handleClearAllThreads}
            userName={userName}
            nickname={nickname}
            onOpenSettings={() => setActiveTab('settings')}
            isPersistent={true}
          />
        </div>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {/* Tab 1: Dedicated Home Dashboard */}
        {activeTab === 'home' && (
          <HomeView
            brandName={brandName}
            displayName={displayName}
            userName={userName}
            nickname={nickname}
            onOpenNicknameModal={() => setIsNicknameModalOpen(true)}
            activeProvider={activeProvider}
            activeModel={activeModel}
            providerModels={providerModels}
            onProviderChange={handleProviderChange}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onSelectPrompt={(text) => {
              setActiveTab('chat');
              handleSendMessage(text);
            }}
            messageCount={messages.length}
            threads={threads}
            onSelectThread={handleSelectThread}
            onOpenThreadDrawer={() => {
              loadThreads();
              setIsThreadDrawerOpen(true);
            }}
            onOpenTelegramModal={() => setIsTelegramModalOpen(true)}
            customPrompts={customPrompts}
            dynamicPrompts={promptTemplates}
            onRefreshDynamicPrompts={() => fetchPrompts(true)}
            onOpenCustomPromptModal={() => setIsCustomPromptModalOpen(true)}
          />
        )}

        {/* Tab 2: Conversational Thinking Partner Workspace */}
        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden overflow-x-hidden max-w-4xl w-full mx-auto">
            {/* In-Chat Real-Time Search Bar */}
            {isSearchOpen && (
              <ChatSearchInput
                query={searchQuery}
                onQueryChange={(q) => {
                  setSearchQuery(q);
                  setSearchMatchIndex(0);
                }}
                onClear={() => {
                  setSearchQuery('');
                  setSearchMatchIndex(0);
                }}
                matchCount={matchingMessages.length}
                currentMatchIndex={searchMatchIndex}
                onNextMatch={handleNextMatch}
                onPrevMatch={handlePrevMatch}
                filterOnlyMatches={filterOnlyMatches}
                onToggleFilterOnly={() => setFilterOnlyMatches((prev) => !prev)}
                onClose={() => {
                  setIsSearchOpen(false);
                  setSearchQuery('');
                  setFilterOnlyMatches(false);
                }}
              />
            )}

            {/* Error Notification Banner if any */}
            {errorMessage && (
              <div className="mx-3 sm:mx-4 mt-2 p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-center justify-between gap-3 shadow-lg">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="text-red-400 hover:text-red-200 font-medium underline shrink-0"
                >
                  Dismiss
                </button>
              </div>
            )}

            <ArtifactStorageNotice />

            {/* Messages Feed or Context-Grounded Empty State */}
            <div className="relative flex-1 min-h-0">
              <div
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                onWheel={interruptProgrammaticScroll}
                onTouchStart={interruptProgrammaticScroll}
                onPointerDown={interruptProgrammaticScroll}
                className="chat-messages-viewport h-full min-h-0 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-3"
              >
                <div ref={messagesContentRef} className="min-h-full w-full min-w-0 flex flex-col space-y-1">
              {messages.length === 0 ? (
                <EmptyState
                  promptTemplates={promptTemplates}
                  promptStatus={promptTemplatesStatus}
                  promptError={promptTemplatesError}
                  onSelectPrompt={(text) => handleSendMessage(text)}
                  onRefreshPrompts={() => fetchPrompts(true)}
                />
              ) : (
                <>
                  <GroupedChatMessageList
                    messages={displayMessages}
                    channel={channel}
                    displayName={displayName}
                    onGenerateAudio={handleGenerateAudio}
                    onEditMessage={handleEditMessage}
                    onEditAndRegenerate={handleEditAndRegenerate}
                    onDeleteMessage={handleDeleteMessage}
                    onRetryMessage={handleRetryMessage}
                    searchQuery={searchQuery}
                    autoPlayVoice={autoPlayVoice}
                    voiceSpeed={voiceSpeed}
                    onVoiceSpeedChange={handleVoiceSpeedChange}
                    isDark={isDark}
                    isStreamingResponse={isLoading}
                  />

                  {isLoading && displayMessages[displayMessages.length - 1]?.role !== 'assistant' && (
                    <div className="flex items-center gap-2 text-xs text-slate-400 ml-2 py-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                      <span>{displayName ? `Thinking through this with you, ${displayName}...` : 'Thinking through your request...'}</span>
                    </div>
                  )}
                </>
              )}
                </div>
              </div>
              {showScrollToLatest && displayMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => scrollToBottom('smooth', true)}
                  aria-label="Jump to latest message"
                  title="Jump to latest message"
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-600/70 bg-slate-900/90 text-slate-100 shadow-xl shadow-black/30 backdrop-blur-md transition hover:border-amber-400/70 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 motion-reduce:transition-none"
                >
                  <ArrowDown className="h-5 w-5" aria-hidden="true" />
                  <span className="sr-only">Jump to latest message</span>
                </button>
              )}
            </div>

            {/* Chat Input Dock */}
            <ChatInput
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
              channel={channel}
              promptTemplates={promptTemplates}
              onRefreshPrompts={() => fetchPrompts(true)}
              onOpenKnowledgeVault={() => setActiveTab('knowledge')}
              onOpenDecisionAnalyzer={() => setActiveTab('advice')}
            />
          </div>
        )}

        {/* Tab 3: 7-Step Decision Deconstructor */}
        {activeTab === 'advice' && (
          <DecisionAnalyzerModal
            isOpen={true}
            isEmbedded={true}
            onClose={() => setActiveTab('home')}
            onInsertToChat={(text) => {
              setActiveTab('chat');
              handleSendMessage(text);
            }}
            userName={userName}
            nickname={nickname}
            model={activeModel}
          />
        )}

        {/* Tab 4: Decision Calibration & Experiment Engine */}
        {activeTab === 'calibration' && (
          <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 max-w-4xl w-full mx-auto pb-24">
            <DecisionCalibrationDashboard
              isEmbedded={true}
              onClose={() => setActiveTab('home')}
            />
          </div>
        )}

        {/* Tab 5: Vector Knowledge Vault */}
        {activeTab === 'knowledge' && (
          <KnowledgeModal
            isOpen={true}
            isEmbedded={true}
            onClose={() => setActiveTab('home')}
            onInsertToChat={(text) => {
              setActiveTab('chat');
              handleSendMessage(text);
            }}
            onOpenPromptCreator={() => setIsCustomPromptModalOpen(true)}
          />
        )}

        {/* Tab 5: Multi-Model Brain Settings */}
        {activeTab === 'settings' && (
          <SettingsModal
            isOpen={true}
            isEmbedded={true}
            onClose={() => setActiveTab('home')}
            brandName={brandName}
            onSaveBrandName={handleSaveBrandName}
            userName={userName}
            nickname={nickname}
            onSaveName={handleSaveNickname}
            activeProvider={activeProvider}
            onProviderChange={handleProviderChange}
            providerModels={providerModels}
            onSelectProviderModel={handleSelectProviderModel}
            onSelectModelAndActivate={handleSelectModelAndActivate}
            voice={voice}
            onVoiceChange={handleVoiceChange}
            customGeminiKey={customGeminiKey}
            onSaveGeminiKey={handleSaveGeminiKey}
            customGroqKey={customGroqKey}
            onSaveGroqKey={handleSaveGroqKey}
            customMistralKey={customMistralKey}
            onSaveMistralKey={handleSaveMistralKey}
            customTavilyKey={customTavilyKey}
            onSaveTavilyKey={handleSaveTavilyKey}
            themeMode={themeMode}
            onThemeModeChange={handleThemeModeChange}
            autoPlayVoice={autoPlayVoice}
            onAutoPlayVoiceChange={handleAutoPlayVoiceChange}
            voiceSpeed={voiceSpeed}
            onVoiceSpeedChange={handleVoiceSpeedChange}
          />
        )}
      </div>
    </div>

      {/* Mobile-First Categorized Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
      />

      {/* Nickname / Name Modal */}
      <NicknameModal
        isOpen={isNicknameModalOpen}
        onClose={() => setIsNicknameModalOpen(false)}
        userName={userName}
        nickname={nickname}
        onSave={handleSaveNickname}
      />

      {/* Profile & Master Prompt Modal with Quick Theme Switcher */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        brandName={brandName}
        userName={userName}
        onSelectPrompt={(text) => {
          setActiveTab('chat');
          handleSendMessage(text);
        }}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
      />

      {/* Mobile Thread Drawer (Sliding removed, now just appearing) */}
      <div className="lg:hidden">
        <ThreadDrawer
          isOpen={isThreadDrawerOpen}
          onClose={() => setIsThreadDrawerOpen(false)}
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onRenameThread={handleRenameThread}
          onDeleteThread={handleDeleteThread}
          onRefreshThreads={loadThreads}
          onClearAllThreads={handleClearAllThreads}
          userName={userName}
          nickname={nickname}
          onOpenSettings={() => setActiveTab('settings')}
        />
      </div>

      {/* Enhanced Conversation Export Modal (Markdown, PDF, JSON) */}
      <ChatExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        messages={messages}
        threadTitle={activeThread?.title || 'Conversation Session'}
        channel={channel}
        userName={userName}
        brandName={brandName}
      />

      {/* Custom Prompt Template Creator in Vault */}
      <CustomPromptModal
        isOpen={isCustomPromptModalOpen}
        onClose={() => setIsCustomPromptModalOpen(false)}
        onSavePrompt={handleSaveCustomPrompt}
        onDeletePrompt={handleDeleteCustomPrompt}
        existingCustomPrompts={customPrompts}
      />

      {/* Voice Recorder & Executive Summary Modal */}
      <VoiceRecorderModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        onInsertMessage={(text) => {
          setActiveTab('chat');
          handleSendMessage(text);
        }}
      />

      {/* Home dashboard Telegram card opens this modal through isTelegramModalOpen. */}
      <TelegramModal
        isOpen={isTelegramModalOpen}
        onClose={() => setIsTelegramModalOpen(false)}
        brandName={brandName}
        userName={userName}
        nickname={nickname}
      />
    </div>
  );
}
