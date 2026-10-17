import React, { useEffect, useState, useRef } from 'react';
import { ChatMessage, ChannelType } from '../types/index.ts';
import { VoicePlayer } from './VoicePlayer.tsx';
import { SwarmTraceFeed } from './SwarmTraceFeed.tsx';
import { LiveResearchActivityFeed } from './LiveResearchActivityFeed.tsx';
import {
  Volume2,
  Loader2,
  Copy,
  Check,
  CheckCheck,
  Brain,
  Edit2,
  Trash2,
  X,
  RefreshCw,
  Share2,
  MoreVertical,
  FileText,
  Pencil,
  FileDown,
} from 'lucide-react';
import { renderFormattedMarkdown } from '../utils/markdown.tsx';
import { ArtifactCard } from './ArtifactCard.tsx';
import { getMessageContentView } from '../utils/chatMessagePresentation.ts';

export interface GroupedMessages {
  groupId: string;
  role: 'user' | 'assistant';
  messages: ChatMessage[];
  firstTimestamp: string;
  lastTimestamp: string;
  modelInfo?: {
    provider: string;
    model: string;
  };
}

/**
 * Aggregates sequential messages from the same sender within a 5-minute window
 */
export function groupMessagesBySender(
  messages: ChatMessage[],
  windowMs: number = 5 * 60 * 1000
): GroupedMessages[] {
  const groups: GroupedMessages[] = [];

  const getMsgTime = (msg: ChatMessage): number => {
    if (msg.createdAt) return msg.createdAt;
    const match = msg.id.match(/\d{10,13}/);
    if (match) {
      const parsed = parseInt(match[0], 10);
      if (!isNaN(parsed) && parsed > 100000000000) return parsed;
    }
    return 0;
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prevGroup = groups[groups.length - 1];

    if (!prevGroup) {
      groups.push({
        groupId: `group-${msg.id}`,
        role: msg.role,
        messages: [msg],
        firstTimestamp: msg.timestamp,
        lastTimestamp: msg.timestamp,
        modelInfo: msg.modelInfo,
      });
      continue;
    }

    const prevMsg = prevGroup.messages[prevGroup.messages.length - 1];
    const prevTime = getMsgTime(prevMsg);
    const currTime = getMsgTime(msg);

    const isSameRole = prevGroup.role === msg.role;
    let isWithinWindow = false;

    if (prevTime > 0 && currTime > 0) {
      isWithinWindow = Math.abs(currTime - prevTime) <= windowMs;
    } else {
      isWithinWindow = prevMsg.timestamp === msg.timestamp;
    }

    if (isSameRole && isWithinWindow) {
      prevGroup.messages.push(msg);
      prevGroup.lastTimestamp = msg.timestamp;
      if (msg.modelInfo) {
        prevGroup.modelInfo = msg.modelInfo;
      }
    } else {
      groups.push({
        groupId: `group-${msg.id}`,
        role: msg.role,
        messages: [msg],
        firstTimestamp: msg.timestamp,
        lastTimestamp: msg.timestamp,
        modelInfo: msg.modelInfo,
      });
    }
  }

  return groups;
}

interface ChatMessageProps {
  message: ChatMessage;
  channel: ChannelType;
  displayName?: string;
  onGenerateAudio: (messageId: string, text: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onEditAndRegenerate?: (messageId: string, newContent: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onRetryMessage?: (messageId: string) => void;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  hasMultipleInGroup?: boolean;
  searchQuery?: string;
  autoPlayVoice?: boolean;
  voiceSpeed?: number;
  onVoiceSpeedChange?: (speed: number) => void;
  isDark?: boolean;
  isStreaming?: boolean;
}

export const ChatMessageItem: React.FC<ChatMessageProps> = ({
  message,
  channel,
  displayName = '',
  onGenerateAudio,
  onEditMessage,
  onEditAndRegenerate,
  onDeleteMessage,
  onRetryMessage,
  isFirstInGroup = true,
  isLastInGroup = true,
  hasMultipleInGroup = false,
  searchQuery = '',
  autoPlayVoice = false,
  voiceSpeed = 1,
  onVoiceSpeedChange,
  isDark = true,
  isStreaming = false,
}) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [displayedContent, setDisplayedContent] = useState(isStreaming ? '' : message.content);
  const displayedContentRef = useRef(isStreaming ? '' : message.content);

  // Animate newly received assistant text without altering the underlying message
  // content used by copy, audio, persistence, and other message actions.
  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!isStreaming || reduceMotion) {
      displayedContentRef.current = message.content;
      setDisplayedContent(message.content);
      return;
    }

    const target = message.content;
    if (displayedContentRef.current.length >= target.length) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const revealNext = () => {
      if (cancelled) return;
      const current = displayedContentRef.current;
      if (current.length >= target.length) return;

      const remaining = target.length - current.length;
      const increment = Math.max(1, Math.min(6, Math.ceil(remaining / 18)));
      const next = target.slice(0, Math.min(target.length, current.length + increment));
      displayedContentRef.current = next;
      setDisplayedContent(next);

      if (next.length < target.length) {
        timer = setTimeout(revealNext, 16);
      }
    };

    revealNext();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [message.content, message.id, isStreaming]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = () => {
    if (!editContent.trim()) return;
    if (onEditMessage) {
      onEditMessage(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleSaveAndRegenerate = () => {
    if (!editContent.trim()) return;
    if (onEditAndRegenerate) {
      onEditAndRegenerate(message.id, editContent.trim());
    } else if (onEditMessage) {
      onEditMessage(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (onDeleteMessage) {
      onDeleteMessage(message.id);
    }
    setIsDeleting(false);
  };

  // Touch handlers for long-press trigger on user messages across ALL channels
  const handleTouchStart = () => {
    if (!isUser) return;
    longPressTimerRef.current = setTimeout(() => {
      setShowContextMenu(true);
    }, 400);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchMove = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isUser) {
      e.preventDefault();
      setShowContextMenu(true);
    }
  };

  // Inline edit box component
  const editBox = (
    <div className="w-full space-y-2 py-1">
      <textarea
        value={editContent}
        onChange={(e) => setEditContent(e.target.value)}
        className="w-full min-h-[95px] p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-500 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 font-sans leading-relaxed shadow-sm"
        placeholder="Edit message..."
        autoFocus
      />
      <div className="flex items-center justify-end gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => {
            setIsEditing(false);
            setEditContent(message.content);
          }}
          className="px-2.5 py-1 rounded-lg text-xs bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSaveEdit}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition"
        >
          Save
        </button>
        {isUser && onEditAndRegenerate && (
          <button
            type="button"
            onClick={handleSaveAndRegenerate}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white transition flex items-center gap-1 shadow-sm"
          >
            <Brain className="w-3 h-3" />
            <span>Save &amp; Resend</span>
          </button>
        )}
      </div>
    </div>
  );

  const isMatch = Boolean(searchQuery?.trim()) && message.content.toLowerCase().includes(searchQuery.toLowerCase().trim());
  const contentView = getMessageContentView(
    isUser ? message.content : displayedContent,
    message.role,
    isExpanded,
    isStreaming,
  );

  // Channel-tailored style mapping while maintaining UNIFIED features across Light and Dark modes
  const getBubbleStyle = () => {
    if (isUser) {
      if (channel === 'telegram') {
        return !isDark
          ? 'bg-[#eeffde] text-slate-900 border border-[#b2e59e] rounded-2xl rounded-tr-xs px-3.5 py-2 text-sm shadow-xs max-w-[95%] sm:max-w-[85%]'
          : 'bg-[#2b5278] text-white border border-[#3b6794]/80 rounded-2xl rounded-tr-xs px-3.5 py-2 text-sm shadow-sm max-w-[95%] sm:max-w-[85%]';
      }
      if (channel === 'whatsapp') {
        return !isDark
          ? 'bg-[#d9fdd3] text-[#111b21] border border-[#b4f0aa] rounded-2xl rounded-tr-xs px-3.5 py-2 text-sm shadow-xs max-w-[95%] sm:max-w-[85%]'
          : 'bg-[#005c4b] text-[#e9edef] border border-[#007a64]/80 rounded-2xl rounded-tr-xs px-3.5 py-2 text-sm shadow-xs max-w-[95%] sm:max-w-[85%]';
      }
      // Web chat: a restrained primary-accent tint distinguishes user content
      // while keeping the assistant's response on an uncluttered canvas.
      return !isDark
        ? 'bg-amber-50/90 text-slate-900 border border-amber-200/80 rounded-[24px] rounded-br-md px-4 py-3 text-sm md:text-[15px] leading-7 shadow-sm max-w-[95%] sm:max-w-[85%]'
        : 'bg-amber-400/10 text-slate-100 border border-amber-300/15 rounded-[24px] rounded-br-md px-4 py-3 text-sm md:text-[15px] leading-7 shadow-sm max-w-[95%] sm:max-w-[85%]';
    } else {
      // Assistant
      if (channel === 'telegram') {
        return !isDark
          ? 'bg-white text-slate-900 border border-slate-200/90 rounded-2xl rounded-tl-xs px-3.5 py-2.5 shadow-xs max-w-[98%] sm:max-w-[90%]'
          : 'bg-[#182533] text-slate-100 border border-slate-700/60 rounded-2xl rounded-tl-xs px-3.5 py-2.5 shadow-sm max-w-[98%] sm:max-w-[90%]';
      }
      if (channel === 'whatsapp') {
        return !isDark
          ? 'bg-white text-[#111b21] border border-slate-200/80 rounded-2xl rounded-tl-xs px-3.5 py-2.5 shadow-xs max-w-[98%] sm:max-w-[90%]'
          : 'bg-[#202c33] text-[#d1d7db] border border-slate-700/50 rounded-2xl rounded-tl-xs px-3.5 py-2.5 shadow-sm max-w-[98%] sm:max-w-[90%]';
      }
      // ChatGPT-inspired assistant canvas: readable typography without a heavy card.
      return 'bg-transparent border-0 shadow-none px-0 py-0.5 text-slate-900 dark:text-slate-100 text-sm md:text-[15px] leading-7 w-full';
    }
  };

  return (
    <div
      id={`message-${message.id}`}
      className={`w-full flex flex-col relative break-words overflow-hidden ${isUser ? 'items-end' : 'items-start'} ${isLastInGroup ? 'mb-3' : 'mb-1'}`}
    >
      {/* Message Bubble Container */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onContextMenu={handleContextMenu}
        className={`relative transition-all duration-200 select-text ${
          isMatch ? 'ring-2 ring-amber-400 border-amber-400 shadow-md shadow-amber-500/10' : ''
        } ${getBubbleStyle()} ${isUser ? 'cursor-pointer active:scale-[0.99]' : ''}`}
      >
        {/* Telegram Header Badge */}
        {!isUser && channel === 'telegram' && isFirstInGroup && (
          <div className="flex items-center gap-1.5 mb-1 pb-1 border-b border-white/10 text-xs font-semibold text-sky-400">
            <span>Your Digital Twin</span>
            <span className="text-[10px] font-normal px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              TWINMIND
            </span>
          </div>
        )}

        {/* WhatsApp Header Badge */}
        {!isUser && channel === 'whatsapp' && isFirstInGroup && (
          <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-[#00a884]">
            <span>Your Digital Twin</span>
          </div>
        )}

        {!isUser && message.swarmTrace && (
          <SwarmTraceFeed trace={message.swarmTrace} />
        )}

        {!isUser && message.researchActivity && message.researchActivity.length > 0 && (
          <LiveResearchActivityFeed activities={message.researchActivity} />
        )}

        {message.imageData && !isEditing && (
          <div className="mb-2">
            <img
              src={message.imageData.data.startsWith('data:') ? message.imageData.data : `data:${message.imageData.mimeType || 'image/jpeg'};base64,${message.imageData.data}`}
              alt={message.imageData.name || "Uploaded photo"}
              className="max-w-xs sm:max-w-sm max-h-64 rounded-xl border border-slate-200 dark:border-slate-800 shadow-md object-cover"
            />
            {message.imageData.name && (
              <span className="text-[10px] text-slate-500 mt-1 block font-medium">📷 Attached Photo: {message.imageData.name}</span>
            )}
          </div>
        )}

        {isEditing ? (
          editBox
        ) : (
          <div className="space-y-1">
            {!message.content && !isUser ? (
              <div className="flex items-center gap-1.5 py-1 text-amber-500 dark:text-amber-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="text-xs font-medium tracking-wide animate-pulse">TwinMind AI is thinking...</span>
              </div>
            ) : (
              <>
                {renderFormattedMarkdown(contentView.content)}
                {contentView.canExpand && (
                  <button
                    type="button"
                    aria-expanded={contentView.isExpanded}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsExpanded((expanded) => !expanded);
                    }}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg py-1 text-xs font-medium text-amber-600 hover:text-amber-500 dark:text-amber-300 dark:hover:text-amber-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                  >
                    <span>{contentView.isExpanded ? 'See less' : 'See more'}</span>
                    <RefreshCw className={`h-3 w-3 ${contentView.isExpanded ? '-rotate-90' : 'rotate-90'} transition-transform`} />
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {message.audioUrl && !isEditing && (
          <div className="mt-2">
            <VoicePlayer
              audioUrl={message.audioUrl}
              theme={channel}
              autoPlay={autoPlayVoice}
              voiceSpeed={voiceSpeed}
              onSpeedChange={onVoiceSpeedChange}
            />
          </div>
        )}
        
        {message.artifacts && message.artifacts.length > 0 && !isEditing && (
          <div className="mt-3 w-full min-w-0 space-y-3">
            {message.artifacts.map((artifact, index) => (
              <ArtifactCard key={artifact.name + ':' + index} artifact={artifact} />
            ))}
          </div>
        )}

        {/* WhatsApp Checkmark Indicator */}
        {channel === 'whatsapp' && isUser && isLastInGroup && !isEditing && (
          <div className="flex items-center justify-end gap-1 mt-1 text-[10.5px] text-[#8696a0]">
            <span>{message.timestamp}</span>
            <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb] inline" />
          </div>
        )}

        {/* Telegram Checkmark Indicator */}
        {channel === 'telegram' && isUser && isLastInGroup && !isEditing && (
          <div className="flex items-center justify-end gap-1 mt-1 text-[11px] text-sky-300/80">
            <span>{message.timestamp}</span>
            <CheckCheck className="w-3.5 h-3.5 text-sky-400 inline" />
          </div>
        )}

        {/* Delete Confirmation Banner */}
        {isDeleting && (
          <div className="mt-2 flex items-center justify-between gap-2 bg-red-950/90 border border-red-800/80 rounded-xl px-3 py-1.5 text-xs text-red-200">
            <span>Delete message?</span>
            <div className="flex items-center gap-2 font-bold">
              <button type="button" onClick={handleDelete} className="text-red-400 hover:underline">
                Yes
              </button>
              <button type="button" onClick={() => setIsDeleting(false)} className="text-slate-400 hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Long-Press Context Menu Popover for User Messages (Unified across Web, Telegram, WhatsApp) */}
        {isUser && showContextMenu && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
              onClick={(e) => {
                e.stopPropagation();
                setShowContextMenu(false);
              }}
            />

            <div className="absolute right-0 top-full mt-1.5 z-50 w-56 p-3 bg-[#2d2d2e] dark:bg-[#282829] text-white rounded-[22px] border border-white/10 shadow-2xl animate-in fade-in zoom-in-95 duration-150 font-sans">
              <div className="text-[11px] text-slate-400 font-medium pb-2 mb-1 border-b border-white/10 px-1">
                {message.timestamp ? (message.timestamp.includes(',') ? message.timestamp : `Today, ${message.timestamp}`) : 'Today'}
              </div>

              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy();
                    setShowContextMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/10 text-xs sm:text-sm text-slate-100 font-medium transition"
                >
                  <Copy className="w-4 h-4 text-slate-300 shrink-0" />
                  <span>Copy</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(message.content);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                    setShowContextMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/10 text-xs sm:text-sm text-slate-100 font-medium transition"
                >
                  <FileText className="w-4 h-4 text-slate-300 shrink-0" />
                  <span>Select text</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                    setShowContextMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/10 text-xs sm:text-sm text-slate-100 font-medium transition"
                >
                  <Pencil className="w-4 h-4 text-slate-300 shrink-0" />
                  <span>Edit message</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (navigator.share) {
                      navigator.share({ title: 'Shared Prompt', text: message.content }).catch(() => {});
                    } else {
                      handleCopy();
                    }
                    setShowContextMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/10 text-xs sm:text-sm text-slate-100 font-medium transition"
                >
                  <Share2 className="w-4 h-4 text-slate-300 shrink-0" />
                  <span>Share prompt</span>
                </button>

                {onDeleteMessage && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsDeleting(true);
                      setShowContextMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-red-500/20 text-xs sm:text-sm text-red-400 font-medium transition border-t border-white/10 mt-1 pt-2"
                  >
                    <Trash2 className="w-4 h-4 text-red-400 shrink-0" />
                    <span>Delete</span>
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Assistant Action Toolbar - Unified Minimal Icons across all Channels */}
      {!isUser && !isEditing && message.content && (
        <div className="flex items-center gap-3.5 mt-1.5 text-slate-500 dark:text-slate-400 relative pl-0.5">
          {/* Copy Icon */}
          <button
            type="button"
            onClick={handleCopy}
            className="hover:text-slate-900 dark:hover:text-slate-200 transition p-0.5 rounded"
            title={copied ? 'Copied' : 'Copy'}
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Voice / Read Aloud Icon */}
          <button
            type="button"
            onClick={() => onGenerateAudio(message.id, message.content)}
            disabled={message.isGeneratingAudio}
            className="hover:text-slate-900 dark:hover:text-slate-200 transition p-0.5 rounded disabled:opacity-50"
            title={message.audioUrl ? 'Voice attached' : 'Read Aloud'}
          >
            {message.isGeneratingAudio ? (
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
            ) : (
              <Volume2 className={`w-4 h-4 ${message.audioUrl ? 'text-amber-500' : ''}`} />
            )}
          </button>

          {/* Share Icon */}
          <button
            type="button"
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: 'TwinMind Response', text: message.content }).catch(() => {});
              } else {
                handleCopy();
              }
            }}
            className="hover:text-slate-900 dark:hover:text-slate-200 transition p-0.5 rounded"
            title="Share response"
          >
            <Share2 className="w-4 h-4" />
          </button>

          {/* More Options Overflow Vertical Dots Icon */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="hover:text-slate-900 dark:hover:text-slate-200 transition p-0.5 rounded"
              title="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                <div className="absolute left-0 top-full mt-1.5 z-50 w-44 p-1.5 bg-[#2d2d2e] dark:bg-[#282829] text-white rounded-xl border border-white/10 shadow-xl font-sans text-xs space-y-0.5">
                  {onRetryMessage && (
                    <button
                      type="button"
                      onClick={() => {
                        onRetryMessage(message.id);
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Regenerate response</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      handleCopy();
                      setShowMoreMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy text</span>
                  </button>
                  {onDeleteMessage && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsDeleting(true);
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-red-500/20 text-red-400 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface GroupedChatMessageListProps {
  messages: ChatMessage[];
  channel: ChannelType;
  displayName?: string;
  onGenerateAudio: (messageId: string, text: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onEditAndRegenerate?: (messageId: string, newContent: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onRetryMessage?: (messageId: string) => void;
  searchQuery?: string;
  autoPlayVoice?: boolean;
  voiceSpeed?: number;
  onVoiceSpeedChange?: (speed: number) => void;
  isDark?: boolean;
  isStreamingResponse?: boolean;
}

export const GroupedChatMessageList: React.FC<GroupedChatMessageListProps> = ({
  messages,
  channel,
  displayName = '',
  onGenerateAudio,
  onEditMessage,
  onEditAndRegenerate,
  onDeleteMessage,
  onRetryMessage,
  searchQuery = '',
  autoPlayVoice = false,
  voiceSpeed = 1,
  onVoiceSpeedChange,
  isDark = true,
  isStreamingResponse = false,
}) => {
  const groups = groupMessagesBySender(messages, 5 * 60 * 1000);

  return (
    <div className="space-y-4 w-full overflow-x-hidden">
      {groups.map((group, groupIndex) => {
        const isUser = group.role === 'user';
        const hasMultiple = group.messages.length > 1;

        return (
          <div
            key={group.groupId}
            className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`${
                isUser 
                  ? 'max-w-[92%] md:max-w-[85%] items-end' 
                  : channel === 'web' 
                    ? 'max-w-full items-start' 
                    : 'max-w-[92%] md:max-w-[85%] items-start'
              } flex flex-col w-full`}
            >
              {/* Stacked Group Messages */}
              <div className="w-full space-y-1">
                {group.messages.map((message, msgIdx) => (
                  <ChatMessageItem
                    key={message.id}
                    message={message}
                    channel={channel}
                    displayName={displayName}
                    onGenerateAudio={onGenerateAudio}
                    onEditMessage={onEditMessage}
                    onEditAndRegenerate={onEditAndRegenerate}
                    onDeleteMessage={onDeleteMessage}
                    onRetryMessage={onRetryMessage}
                    isFirstInGroup={msgIdx === 0}
                    isLastInGroup={msgIdx === group.messages.length - 1}
                    hasMultipleInGroup={hasMultiple}
                    searchQuery={searchQuery}
                    autoPlayVoice={autoPlayVoice}
                    voiceSpeed={voiceSpeed}
                    onVoiceSpeedChange={onVoiceSpeedChange}
                    isDark={isDark}
                    isStreaming={
                      isStreamingResponse &&
                      groupIndex === groups.length - 1 &&
                      group.role === 'assistant' &&
                      msgIdx === group.messages.length - 1
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
