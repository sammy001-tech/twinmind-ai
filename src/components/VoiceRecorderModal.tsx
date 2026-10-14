import React, { useState, useRef } from 'react';
import { Mic, Square, Loader2, FileText, Download, CheckCircle2, X, Volume2, Sparkles } from 'lucide-react';

interface VoiceRecorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertMessage: (text: string) => void;
}

export const VoiceRecorderModal: React.FC<VoiceRecorderModalProps> = ({ isOpen, onClose, onInsertMessage }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultData, setResultData] = useState<{
    reply: string;
    toolsExecuted?: Array<{ toolName: string; result: any }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  if (!isOpen) return null;

  const startRecording = async () => {
    setError(null);
    setAudioBlob(null);
    setAudioUrl(null);
    setResultData(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        // Stop all audio tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Microphone access denied or unsupported.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleProcessAudio = async () => {
    if (!audioBlob) return;
    setIsProcessing(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64String = (reader.result as string)?.split(',')[1];
        if (!base64String) {
          throw new Error('Failed to encode audio blob.');
        }

        const res = await fetch('/api/audio/transcribe-and-summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: base64String,
            mimeType: audioBlob.type || 'audio/webm',
            prompt: 'Listen to this voice memo/recording, transcribe it accurately, extract key action items and strategic takeaways, and generate a professional PDF meeting notes document or financial forecast.',
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to process voice note.');
        }

        setResultData({
          reply: data.reply,
          toolsExecuted: data.toolsExecuted,
        });
      };
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Audio processing failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-lg">Voice Note & Executive Summary</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Record a voice memo, transcribe, & generate professional PDF/Excel reports</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {error && (
            <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl text-sm flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {error}
            </div>
          )}

          {!resultData ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-6 text-center">
              <div className={`w-28 h-28 rounded-full flex items-center justify-center transition-all shadow-lg ${isRecording ? 'bg-red-500 text-white animate-pulse shadow-red-500/30 ring-8 ring-red-100 dark:ring-red-950/50' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-600/30'}`}>
                {isRecording ? (
                  <button onClick={stopRecording} className="w-full h-full flex items-center justify-center">
                    <Square className="w-10 h-10 fill-current" />
                  </button>
                ) : (
                  <button onClick={startRecording} className="w-full h-full flex items-center justify-center">
                    <Mic className="w-12 h-12" />
                  </button>
                )}
              </div>

              <div>
                <h4 className="text-base font-semibold text-slate-800 dark:text-slate-200">
                  {isRecording ? 'Recording voice memo... Click to Stop' : 'Tap microphone to start recording'}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Speak clearly about meetings, strategy, finances, or ideas.
                </p>
              </div>

              {audioUrl && !isRecording && (
                <div className="w-full bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                    <span className="flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Recorded Audio Preview
                    </span>
                    <button onClick={startRecording} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                      Re-record
                    </button>
                  </div>
                  <audio controls src={audioUrl} className="w-full h-10" />

                  <button
                    disabled={isProcessing}
                    onClick={handleProcessAudio}
                    className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-600/20 disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" /> Transcribing & Generating Report...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" /> Transcribe & Generate Executive Report
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-xl p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">Transcription & Executive Summary Complete</h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">Audio transcribed, action items extracted, and report formatted.</p>
                </div>
              </div>

              {/* Reply / Transcription */}
              <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Executive Analysis & Transcription</h5>
                <div className="prose dark:prose-invert text-sm max-h-60 overflow-y-auto whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                  {resultData.reply}
                </div>
              </div>

              {/* Generated Artifacts */}
              {resultData.toolsExecuted && resultData.toolsExecuted.length > 0 && (
                <div className="space-y-3">
                  <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Generated Documents</h5>
                  {resultData.toolsExecuted.map((tool, idx) => {
                    const res = tool.result || {};
                    if (tool.toolName === 'generateArtifact' && res.fileName) {
                      const fileUrl = `/artifacts/${encodeURIComponent(res.fileName)}`;
                      return (
                        <div key={idx} className="flex items-center justify-between bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 p-3.5 rounded-xl">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{res.fileName}</p>
                              <p className="text-xs text-indigo-600 dark:text-indigo-400">Ready for download & distribution</p>
                            </div>
                          </div>
                          <a
                            href={fileUrl}
                            download={res.fileName}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium py-2 px-3.5 rounded-lg flex items-center gap-1.5 transition-all shadow-sm"
                          >
                            <Download className="w-4 h-4" /> Download
                          </a>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setResultData(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  Record Another Memo
                </button>
                <button
                  onClick={() => {
                    onInsertMessage(resultData.reply);
                    onClose();
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl shadow-md transition-all"
                >
                  Insert to Chat
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
