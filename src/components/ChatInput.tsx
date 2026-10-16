import React, { useState, useRef, useEffect } from 'react';
import { ChannelType, PromptTemplate } from '../types/index.ts';
import {
  Send,
  Sparkles,
  Volume2,
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
  RefreshCw,
} from 'lucide-react';

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
}) => {
  const [text, setText] = useState('');
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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = (reader.result as string).split(',')[1];
          if (base64String) {
            onSendMessage('[Voice Note Audio]', true, {
              mimeType: 'audio/webm',
              data: base64String,
            });
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to start audio recording:', err);
      alert('Could not access microphone. Please check browser permissions.');
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

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!text.trim() && !selectedImage) || isLoading) return;
    
    const sendContent = text.trim() || (selectedImage ? `Please analyze this uploaded photo/image (${selectedImage.name}):` : '');
    const imagePayload = selectedImage ? { mimeType: selectedImage.mimeType, data: selectedImage.data, name: selectedImage.name } : undefined;

    onSendMessage(sendContent, requestVoiceNote, undefined, undefined, swarmMode, imagePayload);
    setText('');
    setSelectedImage(null);
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
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        setText((prev) => (prev ? `${prev}\n\n[Attached File: ${file.name}]\n${content.slice(0, 500)}` : `Analyze this file content:\n\nFilename: ${file.name}\n${content.slice(0, 1000)}`));
      };
      reader.readAsText(file);
    }
    setIsToolMenuOpen(false);
  };

  return (
    <div className="w-full shrink-0 max-w-3xl mx-auto px-3 sm:px-4 pb-3 pt-1 relative z-20">
      {/* Hidden File Input supporting photos, images, and text documents */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.json,.csv,.js,.ts,.tsx,.py"
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

      {/* Floating Composer Container */}
      <div className="relative bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl shadow-xl dark:shadow-2xl backdrop-blur-xl transition-all focus-within:border-amber-500/50 focus-within:ring-1 focus-within:ring-amber-500/30">
        
        {/* Attached Image/Photo Preview Chip */}
        {selectedImage && (
          <div className="pt-2.5 px-3.5 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs">
              <img src={selectedImage.previewUrl} alt="Preview" className="w-8 h-8 rounded-lg object-cover border border-amber-500/50" />
              <div className="flex flex-col">
                <span className="font-semibold truncate max-w-[160px] text-xs">{selectedImage.name}</span>
                <span className="text-[10px] text-amber-500 font-medium">Photo Attached (Gemini Vision Ready)</span>
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

        {/* Active Mode Badge Chip above text input */}
        {swarmMode && (
          <div className="pt-2.5 px-3.5 flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] font-semibold">
              <Cpu className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 animate-pulse" />
              <span>⚡ Swarm Debate Mode Active</span>
            </div>
            <button
              type="button"
              onClick={() => setSwarmMode(false)}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-0.5 rounded transition"
              title="Deactivate Swarm Debate Mode"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Input Text Area Form */}
        <form onSubmit={handleSubmit} className="p-2 sm:p-2.5 flex items-end gap-2">
          
          {/* Tool Menu Anchor & 1-Tap Toggle Dock Group */}
          <div className="relative flex items-center gap-1 shrink-0 pb-0.5" ref={menuRef}>
            
            {/* Pop-Up Tool Action Sheet Button (+) */}
            <button
              type="button"
              onClick={() => setIsToolMenuOpen(!isToolMenuOpen)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${
                isToolMenuOpen
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700/60'
              }`}
              title="Open tools and attachment menu"
            >
              <Plus className={`w-4 h-4 transition-transform duration-200 ${isToolMenuOpen ? 'rotate-45 text-amber-500 dark:text-amber-400' : ''}`} />
            </button>

            {/* 1-Tap Swarm Debate Toggle Button beside (+) */}
            <button
              type="button"
              onClick={() => setSwarmMode(!swarmMode)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${
                swarmMode
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/50 shadow-sm shadow-amber-500/20'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-300 border border-slate-200 dark:border-slate-700/60'
              }`}
              title={swarmMode ? 'Swarm Debate Active (Click to disable)' : 'Activate Swarm Debate Mode (1-Tap)'}
            >
              <Cpu className="w-4 h-4" />
            </button>

            {/* Tool Action Sheet Dropdown Menu */}
            {isToolMenuOpen && (
              <div className="absolute bottom-12 left-0 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 px-2.5 py-1 uppercase tracking-wider">
                  TwinMind Tools & Capabilities
                </div>
                
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2.5 transition"
                  >
                    <Camera className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                    <span className="font-medium">Upload Photo or Image</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2.5 transition"
                  >
                    <Paperclip className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                    <span>Upload Document File</span>
                  </button>

                  {onOpenKnowledgeVault && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolMenuOpen(false);
                        onOpenKnowledgeVault();
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2.5 transition"
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
                      className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2.5 transition"
                    >
                      <Brain className="w-4 h-4 text-purple-500 dark:text-purple-400" />
                      <span>7-Step Decision Deconstructor</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setSwarmMode(!swarmMode);
                      setIsToolMenuOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <Cpu className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                      <span className="font-medium">Swarm Debate Mode</span>
                    </div>
                    {swarmMode && <Check className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Text Area Input */}
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message TwinMind AI..."
              className="w-full bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none resize-none py-1.5 px-1 min-h-[38px] max-h-[160px] leading-relaxed"
            />
          </div>

          {/* Right Action Group: Mic & Circular Send Button */}
          <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
            
            {/* Mic / Audio Record Button */}
            <button
              type="button"
              onClick={startRecording}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700/60 flex items-center justify-center transition"
              title="Record voice note"
            >
              <Mic className="w-4 h-4" />
            </button>

            {/* Circular Amber Send Button */}
            <button
              type="submit"
              disabled={!text.trim() || isLoading}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition shadow-lg ${
                text.trim() && !isLoading
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold active:scale-95 shadow-amber-500/20'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 dark:bg-slate-800 dark:text-slate-600 dark:border-slate-700/50 cursor-not-allowed'
              }`}
              title="Send message"
            >
              {isLoading ? (
                <Square className="w-3.5 h-3.5 fill-slate-950 animate-pulse" />
              ) : (
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Quiet Footer Tagline matching concept */}
      <div className="text-center mt-2">
        <span className="text-[11px] text-slate-500/80 tracking-wide">
          TwinMind AI thinking partner · Grounded in your context
        </span>
      </div>
    </div>
  );
};
