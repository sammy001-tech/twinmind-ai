import React, { useState, useRef, useEffect } from 'react';
import { ChannelType, PromptTemplate, ThinkingLevel, ThreadPinnedDoc } from '../types/index.ts';
import { ThinkingLevelSelector } from './ThinkingLevelSelector.tsx';
import {
  AudioLines,
  Mic,
  ArrowUp,
  Square,
  X,
  Cpu,
  Plus,
  Camera,
  Paperclip,
  BookOpen,
  Brain,
  Check,
  FileText,
  Loader2,
  Pin,
  FolderGit2,
  ScrollText,
  Clock,
  Sparkles,
} from 'lucide-react';
import { createSafeAudioRecorder, formatMicrophoneError } from '../utils/mediaPermissions.ts';
import { clearChatDraft, loadChatDraft, saveChatDraft } from '../utils/chatDrafts.ts';
import { apiFetch } from '../utils/apiFetch.ts';

interface ChatInputProps {
  onSendMessage: (
    content: string,
    requestAudio?: boolean,
    audioData?: { mimeType: string; data: string },
    baseMessages?: any,
    useSwarm?: boolean,
    imageData?: { mimeType: string; data: string; name?: string }
  ) => void;
  isLoading: boolean;
  channel: ChannelType;
  promptTemplates?: PromptTemplate[];
  onRefreshPrompts?: () => void;
  initialSwarmMode?: boolean;
  onOpenKnowledgeVault?: () => void;
  onOpenDecisionAnalyzer?: () => void;
  thinkingLevel?: ThinkingLevel;
  onThinkingLevelChange?: (level: ThinkingLevel) => void | Promise<void>;
  pinnedDocs?: ThreadPinnedDoc[];
  onPinAttachedDoc?: (doc: { fileName: string; format: string; content: string }) => Promise<void>;
  onUnpinDoc?: (docId: number) => Promise<void>;
  isPinningDoc?: boolean;
  voiceConversationMode?: boolean;
  onToggleVoiceConversationMode?: () => void;
  activeProjectKey?: string | null;
  onSetProjectKey?: (projectKey: string | null) => Promise<void> | void;
  onCreateTempRule?: (content: string, expiresMinutes?: number | null) => Promise<void> | void;
  onOpenRulesDrawer?: () => void;
  appliedRulesCount?: number;
  threadId?: string | null;
  isKeyboardOpen?: boolean;
  prefillValue?: string;
  onPrefillHandled?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isLoading,
  channel,
  promptTemplates = [],
  onRefreshPrompts,
  initialSwarmMode = false,
  onOpenKnowledgeVault,
  onOpenDecisionAnalyzer,
  thinkingLevel = 'low',
  onThinkingLevelChange,
  pinnedDocs = [],
  onPinAttachedDoc,
  onUnpinDoc,
  isPinningDoc = false,
  voiceConversationMode = false,
  onToggleVoiceConversationMode,
  activeProjectKey = null,
  onSetProjectKey,
  onCreateTempRule,
  onOpenRulesDrawer,
  appliedRulesCount,
  threadId = null,
  isKeyboardOpen = false,
  prefillValue,
  onPrefillHandled,
}) => {
  const [text, setText] = useState(() => loadChatDraft(threadId));
  const [requestVoiceNote, setRequestVoiceNote] = useState(false);
  const [swarmMode, setSwarmMode] = useState(initialSwarmMode);
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [selectedImage, setSelectedImage] = useState<{
    mimeType: string;
    data: string;
    name: string;
    previewUrl: string;
  } | null>(null);
  const [attachedDocument, setAttachedDocument] = useState<{
    name: string;
    format: string;
    content: string;
    charCount: number;
  } | null>(null);
  const [isParsingDocument, setIsParsingDocument] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isProjectPopoverOpen, setIsProjectPopoverOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState(activeProjectKey || '');
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isTempRulePopoverOpen, setIsTempRulePopoverOpen] = useState(false);
  const [tempRuleText, setTempRuleText] = useState('');
  const [tempRuleExpiryMinutes, setTempRuleExpiryMinutes] = useState<number | null>(120);
  const [isSavingTempRule, setIsSavingTempRule] = useState(false);

  useEffect(() => {
    setProjectDraft(activeProjectKey || '');
  }, [activeProjectKey]);

  const lastThreadIdRef = useRef<string | null>(threadId);
  useEffect(() => {
    if (lastThreadIdRef.current !== threadId) {
      lastThreadIdRef.current = threadId;
      setText(loadChatDraft(threadId));
    }
  }, [threadId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveChatDraft(threadId, text);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [threadId, text]);

  useEffect(() => {
    if (prefillValue) {
      setText((prev) => {
        const trimmed = prev.trim();
        return trimmed ? `${trimmed}\n\n${prefillValue}` : prefillValue;
      });
      if (textareaRef.current) {
        textareaRef.current.focus();
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
      }
      onPrefillHandled?.();
    }
  }, [prefillValue, onPrefillHandled]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recorderMimeTypeRef = useRef<string>('audio/webm');
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [text]);

  // Close popup menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsToolMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const startRecording = async () => {
    setDocumentError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { recorder, mimeType } = createSafeAudioRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorderMimeTypeRef.current = mimeType;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorderMimeTypeRef.current });
        stream.getTracks().forEach((track) => track.stop());

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = (reader.result as string).split(',')[1];
          if (base64String) {
            onSendMessage('[Voice Note Audio]', true, {
              mimeType: recorderMimeTypeRef.current,
              data: base64String,
            });
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to start audio recording:', err);
      setDocumentError(formatMicrophoneError(err));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
    audioChunksRef.current = [];
  };

  const handlePinCurrentDoc = async () => {
    if (!attachedDocument || !onPinAttachedDoc || isPinningDoc) return;
    setDocumentError(null);
    try {
      await onPinAttachedDoc({
        fileName: attachedDocument.name,
        format: attachedDocument.format,
        content: attachedDocument.content,
      });
      setAttachedDocument(null);
    } catch (err: unknown) {
      setDocumentError(err instanceof Error ? err.message : 'Could not pin document to thread.');
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!text.trim() && !selectedImage && !attachedDocument) || isLoading || isParsingDocument) return;

    let sendContent = text.trim();
    if (attachedDocument) {
      const docHeader = `[ATTACHED DOCUMENT: ${attachedDocument.name} (${attachedDocument.format.toUpperCase()}, ${attachedDocument.charCount.toLocaleString()} chars)]\n${attachedDocument.content}\n[END ATTACHED DOCUMENT]`;
      sendContent = sendContent ? `${sendContent}\n\n${docHeader}` : `Please analyze this attached document (${attachedDocument.name}):\n\n${docHeader}`;
    } else if (selectedImage && !sendContent) {
      sendContent = `Please analyze this uploaded photo/image (${selectedImage.name}):`;
    }

    const imagePayload = selectedImage ? { mimeType: selectedImage.mimeType, data: selectedImage.data, name: selectedImage.name } : undefined;

    onSendMessage(
      sendContent,
      Boolean(requestVoiceNote || voiceConversationMode),
      undefined,
      undefined,
      swarmMode,
      imagePayload
    );
    setText('');
    clearChatDraft(threadId);
    setSelectedImage(null);
    setAttachedDocument(null);
    setDocumentError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || navigator.maxTouchPoints > 0);
    if (e.key === 'Enter') {
      if (isMobile) {
        return; // Allow newline on mobile
      }
      if (!e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    setDocumentError(null);

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const resultStr = reader.result as string;
        const base64Data = resultStr.split(',')[1];
        setSelectedImage({
          mimeType: file.type,
          data: base64Data,
          name: file.name,
          previewUrl: resultStr,
        });
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      setIsParsingDocument(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const resultStr = reader.result as string;
          const base64Data = resultStr.split(',')[1];
          const res = await apiFetch('/api/documents/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              contentBase64: base64Data,
              mimeType: 'application/pdf',
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Failed to parse PDF file');
          }
          setAttachedDocument({
            name: file.name,
            format: data.format || 'pdf',
            content: data.content,
            charCount: data.charCount || data.content.length,
          });
        } catch (err: unknown) {
          setDocumentError(err instanceof Error ? err.message : 'Could not read PDF');
        } finally {
          setIsParsingDocument(false);
        }
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        setAttachedDocument({
          name: file.name,
          format: file.name.split('.').pop() || 'text',
          content,
          charCount: content.length,
        });
      };
      reader.readAsText(file);
    }
    setIsToolMenuOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const hasContent = Boolean(text.trim() || selectedImage || attachedDocument);

  return (
    <div className={`w-full shrink-0 max-w-3xl mx-auto px-3 sm:px-4 ${isKeyboardOpen ? 'pb-1 pt-0.5' : 'pb-3 pt-1'} relative z-20 transition-all`}>
      {/* Hidden File Input supporting PDF, photos, images, and text documents */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.json,.csv,.js,.ts,.tsx,.py"
      />

      {/* Recording Overlay Bar */}
      {isRecording && (
        <div className="mb-2 flex items-center justify-between bg-red-950/80 border border-red-800/80 rounded-2xl px-4 py-2.5 text-xs text-red-200 animate-pulse backdrop-blur-md shadow-xl">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
            <span className="font-semibold">Recording voice message... ({Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, '0')})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelRecording}
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 transition flex items-center gap-1 text-[11px]"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              type="button"
              onClick={stopRecording}
              className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition flex items-center gap-1 text-[11px]"
            >
              <Square className="w-3.5 h-3.5 fill-white" /> Send Voice
            </button>
          </div>
        </div>
      )}

      {/* Floating Hybrid Composer Card: Claude-style 2-tier spacious deck with ChatGPT pill ergonomics */}
      <div className="relative bg-white/95 dark:bg-[#1b1c20]/95 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl sm:rounded-3xl shadow-xl dark:shadow-2xl backdrop-blur-xl transition-all focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/30 p-2 sm:p-2.5">
        
        {/* Attached Image/Photo Preview Chip */}
        {selectedImage && (
          <div className="mb-2 px-1 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs">
              <img src={selectedImage.previewUrl} alt="Preview" className="w-8 h-8 rounded-lg object-cover border border-amber-500/50" />
              <div className="flex flex-col">
                <span className="font-semibold truncate max-w-[160px] text-xs">{selectedImage.name}</span>
                <span className="text-[10px] text-amber-500 font-medium">Photo Attached (Vision Ready)</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="text-slate-400 hover:text-red-500 p-1 rounded-lg transition"
              title="Remove attached photo"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Thread-Pinned Reference Documents Bar */}
        {pinnedDocs.length > 0 && (
          <div className="mb-2 px-1 flex flex-wrap items-center gap-1.5 border-b border-slate-100 dark:border-slate-800/70 pb-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mr-1">
              <Pin className="w-3 h-3" /> Pinned:
            </span>
            {pinnedDocs.map((doc) => (
              <div
                key={doc.id}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium max-w-full"
              >
                <FileText className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[140px] sm:max-w-[200px]">{doc.file_name}</span>
                <span className="text-[10px] opacity-70 font-mono">
                  {Math.max(1, Math.round(doc.char_count / 1000))}k
                </span>
                {onUnpinDoc && (
                  <button
                    type="button"
                    onClick={() => { void onUnpinDoc(doc.id); }}
                    className="p-0.5 rounded hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 transition"
                    title={`Unpin ${doc.file_name}`}
                    aria-label={`Unpin ${doc.file_name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Attached Document Preview Chip */}
        {attachedDocument && (
          <div className="mb-2 px-1 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs min-w-0">
              <FileText className="w-5 h-5 text-indigo-500 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="font-semibold truncate max-w-[160px] sm:max-w-[220px] text-xs">{attachedDocument.name}</span>
                <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-medium">
                  {attachedDocument.format.toUpperCase()} ({attachedDocument.charCount.toLocaleString()} chars)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {onPinAttachedDoc && (
                <button
                  type="button"
                  onClick={() => { void handlePinCurrentDoc(); }}
                  disabled={isPinningDoc}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition disabled:opacity-50"
                  title="Keep this document pinned across every turn in this thread"
                >
                  {isPinningDoc ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pin className="w-3 h-3" />}
                  <span>Pin</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setAttachedDocument(null)}
                className="text-slate-400 hover:text-red-500 p-1 rounded-lg transition"
                title="Remove attached document"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Document Parsing Progress Indicator */}
        {isParsingDocument && (
          <div className="mb-2 px-1 flex items-center gap-2 text-xs text-indigo-500 dark:text-indigo-400">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>Reading and extracting document text...</span>
          </div>
        )}

        {/* Document Parsing Error Banner */}
        {documentError && (
          <div className="mb-2 px-1 flex items-center justify-between text-xs text-rose-500">
            <span>{documentError}</span>
            <button
              type="button"
              onClick={() => setDocumentError(null)}
              className="text-slate-400 hover:text-rose-500 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Active Swarm Mode Pill Indicator (when active) */}
        {swarmMode && (
          <div className="mb-1.5 px-1 flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] font-semibold">
              <Cpu className="w-3 h-3 text-amber-500 animate-pulse" />
              <span>Swarm Debate Mode Active</span>
            </div>
            <button
              type="button"
              onClick={() => setSwarmMode(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs px-1"
              title="Turn off Swarm Mode"
            >
              Turn off
            </button>
          </div>
        )}

        {/* Top Text Deck: Full Width Unconstrained Textarea (Claude Style) */}
        <div className="w-full px-1 pt-0.5">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message TwinMind AI..."
            className="w-full bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-[15px] sm:text-base focus:outline-none resize-none py-1.5 px-1 min-h-[42px] max-h-[160px] leading-relaxed block"
          />
        </div>

        {/* Bottom Utility Dock: Clean Claude/ChatGPT Hybrid Row */}
        <div className="pt-1 px-0.5 flex items-center justify-between gap-2 relative">
          
          {/* Left Controls: (+) Tool Menu, Thinking Level Pill, and Subtle Rules/Scope Pill */}
          <div className="flex items-center gap-1.5 min-w-0" ref={menuRef}>
            {/* Pop-Up Tool Menu Button (+) */}
            <button
              type="button"
              onClick={() => setIsToolMenuOpen(!isToolMenuOpen)}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition shrink-0 ${
                isToolMenuOpen
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700/60'
              }`}
              title="Add attachment, swarm debate, or launch tools"
              aria-label="Add attachment, swarm debate, or launch tools"
            >
              <Plus className={`w-4 h-4 transition-transform duration-200 ${isToolMenuOpen ? 'rotate-45 text-amber-500 dark:text-amber-400' : ''}`} />
            </button>

            {/* Claude-Style Compact Thinking Level Pill */}
            {onThinkingLevelChange && (
              <ThinkingLevelSelector
                value={thinkingLevel}
                onChange={onThinkingLevelChange}
                compact={true}
                dropUp={true}
                className="shrink-0"
              />
            )}

            {/* Compact Rules Pill (Shows active rules count, opens rules drawer) */}
            {onOpenRulesDrawer && (
              <button
                type="button"
                onClick={onOpenRulesDrawer}
                className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-xl border transition text-xs truncate max-w-[130px] sm:max-w-[160px] shrink-0 ${
                  activeProjectKey
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 font-semibold'
                    : 'bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700/60'
                }`}
                title={activeProjectKey ? `Project Scope: ${activeProjectKey}` : 'Global Persona Rules'}
              >
                <ScrollText className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="truncate">
                  {activeProjectKey ? activeProjectKey : 'Rules'}
                </span>
                {appliedRulesCount !== undefined && appliedRulesCount > 0 && (
                  <span className="font-mono tabular-nums text-[10px] opacity-80">
                    ({appliedRulesCount})
                  </span>
                )}
              </button>
            )}

            {/* Tool Action Sheet Dropdown Menu */}
            {isToolMenuOpen && (
              <div className="absolute bottom-11 left-0 w-72 bg-white dark:bg-[#1e1f23] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 px-2.5 py-1 uppercase tracking-wider">
                  Tools & Capabilities
                </div>
                
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2.5 transition"
                  >
                    <Camera className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                    <span className="font-medium">Upload Photo or Image</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2.5 transition"
                  >
                    <Paperclip className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                    <span>Upload Document File</span>
                  </button>

                  {/* Swarm Debate Toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      setSwarmMode(!swarmMode);
                      setIsToolMenuOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <Cpu className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                      <span className="font-medium">Swarm Debate Mode</span>
                    </div>
                    {swarmMode && <Check className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />}
                  </button>

                  {/* Hands-Free Voice Mode Toggle */}
                  {onToggleVoiceConversationMode && (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleVoiceConversationMode();
                        setIsToolMenuOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <AudioLines className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                        <span className="font-medium">Hands-Free Voice Mode</span>
                      </div>
                      {voiceConversationMode && <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />}
                    </button>
                  )}

                  {onOpenKnowledgeVault && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolMenuOpen(false);
                        onOpenKnowledgeVault();
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2.5 transition"
                    >
                      <BookOpen className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                      <span>Knowledge Memory Vault</span>
                    </button>
                  )}

                  {onOpenDecisionAnalyzer && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolMenuOpen(false);
                        onOpenDecisionAnalyzer();
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2.5 transition"
                    >
                      <Brain className="w-4 h-4 text-purple-500 dark:text-purple-400" />
                      <span>7-Step Decision Deconstructor</span>
                    </button>
                  )}

                  {/* Quick Project Scope Setting */}
                  {onSetProjectKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolMenuOpen(false);
                        setIsProjectPopoverOpen(true);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2.5 transition"
                    >
                      <FolderGit2 className="w-4 h-4 text-indigo-400" />
                      <span>Set Project Scope...</span>
                    </button>
                  )}

                  {/* Quick Session Rule */}
                  {onCreateTempRule && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolMenuOpen(false);
                        setIsTempRulePopoverOpen(true);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2.5 transition"
                    >
                      <Clock className="w-4 h-4 text-amber-500" />
                      <span>Add Session Rule...</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Action Group: Mic button at rest, Circular Amber Send Arrow when typing */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* If Hands-Free Mode is Active, show indicator */}
            {voiceConversationMode && (
              <button
                type="button"
                onClick={onToggleVoiceConversationMode}
                className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center transition"
                title="Hands-Free Voice Active (Click to disable)"
              >
                <AudioLines className="w-4 h-4 animate-pulse" />
              </button>
            )}

            {/* When hasContent: Circular Amber Send Button (ChatGPT/Claude style). When empty: Mic button */}
            {hasContent || isLoading ? (
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={!hasContent || isLoading || isParsingDocument}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition shadow-md ${
                  hasContent && !isLoading && !isParsingDocument
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold active:scale-95 shadow-amber-500/20'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
                }`}
                title="Send message"
                aria-label="Send message"
              >
                {isLoading ? (
                  <Square className="w-3.5 h-3.5 fill-slate-950 animate-pulse" />
                ) : (
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                )}
              </button>
            ) : (
              <div className="flex items-center gap-1">
                {onToggleVoiceConversationMode && !voiceConversationMode && (
                  <button
                    type="button"
                    onClick={onToggleVoiceConversationMode}
                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 flex items-center justify-center transition"
                    title="Hands-Free Voice Mode"
                    aria-label="Hands-Free Voice Mode"
                  >
                    <AudioLines className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={startRecording}
                  className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white border border-slate-200/80 dark:border-slate-700/60 flex items-center justify-center transition"
                  title="Record voice note"
                  aria-label="Record voice note"
                >
                  <Mic className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Project Binding Popover */}
        {isProjectPopoverOpen && onSetProjectKey && (
          <div className="absolute bottom-full left-2 mb-2 z-50 w-72 rounded-2xl bg-white dark:bg-[#1e1f23] border border-slate-200 dark:border-slate-800 shadow-2xl p-3 space-y-2 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Thread Project Scope
              </span>
              <button
                type="button"
                onClick={() => setIsProjectPopoverOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              type="text"
              value={projectDraft}
              onChange={(e) => setProjectDraft(e.target.value)}
              placeholder="e.g. twinmind-ai, uniace"
              className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                disabled={isSavingProject}
                onClick={async () => {
                  setIsSavingProject(true);
                  try {
                    setProjectDraft('');
                    await onSetProjectKey(null);
                    setIsProjectPopoverOpen(false);
                  } finally {
                    setIsSavingProject(false);
                  }
                }}
                className="text-[11px] text-slate-500 hover:text-rose-500"
              >
                Reset to Global
              </button>
              <button
                type="button"
                disabled={isSavingProject}
                onClick={async () => {
                  setIsSavingProject(true);
                  try {
                    await onSetProjectKey(projectDraft.trim() || null);
                    setIsProjectPopoverOpen(false);
                  } finally {
                    setIsSavingProject(false);
                  }
                }}
                className="px-3 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold disabled:opacity-50"
              >
                {isSavingProject ? 'Saving...' : 'Bind Scope'}
              </button>
            </div>
          </div>
        )}

        {/* Quick Temporary Session Rule Popover */}
        {isTempRulePopoverOpen && onCreateTempRule && (
          <div className="absolute bottom-full right-2 mb-2 z-50 w-72 rounded-2xl bg-white dark:bg-[#1e1f23] border border-slate-200 dark:border-slate-800 shadow-2xl p-3 space-y-2 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Add Session Rule
              </span>
              <button
                type="button"
                onClick={() => setIsTempRulePopoverOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              rows={2}
              value={tempRuleText}
              onChange={(e) => setTempRuleText(e.target.value)}
              placeholder="e.g., Explain step-by-step with 1 practice question at the end."
              className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <select
                value={tempRuleExpiryMinutes === null ? 'none' : String(tempRuleExpiryMinutes)}
                onChange={(e) =>
                  setTempRuleExpiryMinutes(e.target.value === 'none' ? null : Number(e.target.value))
                }
                className="px-2 py-1 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-200"
              >
                <option value="60">Expires in 1h</option>
                <option value="120">Expires in 2h</option>
                <option value="1440">Expires in 24h</option>
                <option value="none">Session only</option>
              </select>
              <button
                type="button"
                disabled={isSavingTempRule || !tempRuleText.trim()}
                onClick={async () => {
                  if (!tempRuleText.trim()) return;
                  setIsSavingTempRule(true);
                  try {
                    await onCreateTempRule(tempRuleText.trim(), tempRuleExpiryMinutes);
                    setTempRuleText('');
                    setIsTempRulePopoverOpen(false);
                  } finally {
                    setIsSavingTempRule(false);
                  }
                }}
                className="px-3 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-semibold disabled:opacity-50"
              >
                {isSavingTempRule ? 'Adding...' : 'Apply Rule'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quiet Footer Tagline - Automatically hidden when mobile keyboard is open */}
      {!isKeyboardOpen && (
        <div className="hidden sm:block text-center mt-1.5">
          <span className="text-[11px] text-slate-500/80 tracking-wide">
            TwinMind AI thinking partner · Grounded in your context
          </span>
        </div>
      )}
    </div>
  );
};
