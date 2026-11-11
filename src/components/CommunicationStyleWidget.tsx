import React, { useState, useEffect } from 'react';
import { ChatMessage, CommunicationStyleAnalysis } from '../types/index.ts';
import {
  HeartHandshake,
  TrendingUp,
  Activity,
  Zap,
  Smile,
  Frown,
  Brain,
  ShieldCheck,
  RefreshCw,
  Loader2,
  Sparkles,
  MessageSquare,
  Sliders,
  ChevronRight,
  Gauge,
  AlertCircle,
  BarChart2,
} from 'lucide-react';

interface CommunicationStyleWidgetProps {
  messages: ChatMessage[];
  threadId?: string | null;
  isOpen?: boolean;
  onClose?: () => void;
  isEmbedded?: boolean;
}

export const CommunicationStyleWidget: React.FC<CommunicationStyleWidgetProps> = ({
  messages,
  threadId,
  isOpen = true,
  onClose,
  isEmbedded = false,
}) => {
  const [analysis, setAnalysis] = useState<CommunicationStyleAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'persona'>('overview');

  const fetchAnalysis = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const formattedMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
        created_at: m.createdAt ? new Date(m.createdAt).toISOString() : m.timestamp,
      }));

      const res = await fetch('/api/communication-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: formattedMessages,
          threadId,
        }),
      });

      const data = await res.json();
      if (data.success && data.analysis) {
        setAnalysis(data.analysis);
      } else {
        setError(data.error || 'Failed to analyze communication style');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAnalysis();
    }
  }, [messages.length, threadId, isOpen]);

  if (!isOpen) return null;

  return (
    <div className={isEmbedded ? 'w-full' : 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150'}>
      <div className={`w-full ${isEmbedded ? 'max-w-full' : 'max-w-3xl max-h-[90vh]'} bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/60 dark:bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-600 dark:text-pink-400">
              <HeartHandshake className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  Communication Style &amp; Tone Mirror
                </h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-700 dark:text-pink-300 border border-pink-500/30">
                  Emotional Resonance Engine
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tracks sentiment, urgency, and emotional tone to dynamically tune TwinMind's response persona
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchAnalysis}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
              title="Refresh sentiment analysis"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-pink-500' : ''}`} />
            </button>
            {!isEmbedded && onClose && (
              <button
                onClick={onClose}
                className="px-2.5 py-1 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition font-medium"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* Status Strip & Nav Tabs */}
        <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800/80 bg-slate-100/60 dark:bg-slate-950/40 flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-[11px]">
            <Activity className="w-3.5 h-3.5 text-pink-500" />
            <span>
              <strong>{analysis?.totalAnalyzedMessages ?? 0}</strong> user turn(s) analyzed
            </span>
            <span>•</span>
            <span className="font-medium text-slate-900 dark:text-white">
              State: {analysis?.overallSentiment || 'Calibrating'}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1 rounded-md transition text-xs font-medium ${
                activeTab === 'overview'
                  ? 'bg-pink-600 text-white font-bold shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Overview &amp; Tone
            </button>
            <button
              onClick={() => setActiveTab('timeline')}
              className={`px-3 py-1 rounded-md transition text-xs font-medium flex items-center gap-1 ${
                activeTab === 'timeline'
                  ? 'bg-purple-600 text-white font-bold shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <TrendingUp className="w-3 h-3" />
              <span>Timeline Trend</span>
            </button>
            <button
              onClick={() => setActiveTab('persona')}
              className={`px-3 py-1 rounded-md transition text-xs font-medium flex items-center gap-1 ${
                activeTab === 'persona'
                  ? 'bg-emerald-600 text-white font-bold shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Zap className="w-3 h-3" />
              <span>Twin Adaptation</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {isLoading && !analysis && (
            <div className="py-16 flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
              <p className="text-xs text-slate-500">Performing psycholinguistic tone analysis across user turns...</p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!isLoading && analysis && (
            <>
              {activeTab === 'overview' && (
                <div className="space-y-4">
                  {/* Top Key Metrics Banner */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                      <span className="text-[11px] text-slate-400 font-medium block">Overall Sentiment</span>
                      <div className="flex items-center gap-2">
                        {analysis.averageScore < -0.2 ? (
                          <Frown className="w-5 h-5 text-rose-500" />
                        ) : analysis.averageScore > 0.2 ? (
                          <Smile className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <Brain className="w-5 h-5 text-purple-500" />
                        )}
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {analysis.overallSentiment}
                        </span>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                      <span className="text-[11px] text-slate-400 font-medium block">Sentiment Index (-1.0 to +1.0)</span>
                      <div className="flex items-center gap-2">
                        <BarChart2 className="w-5 h-5 text-blue-500" />
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {analysis.averageScore > 0 ? `+${analysis.averageScore}` : analysis.averageScore}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          ({analysis.averageScore > 0 ? 'Positive/Focused' : analysis.averageScore < 0 ? 'Urgent/Critical' : 'Balanced'})
                        </span>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                      <span className="text-[11px] text-slate-400 font-medium block">Active Persona Tuning</span>
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-5 h-5 text-emerald-500" />
                        <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                          {analysis.personaAdaptation.activeToneMode}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Twin's Perceived Persona Traits Summary Section */}
                  <div className="p-4 rounded-xl bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-amber-500/10 border border-purple-500/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-500" />
                        <h4 className="font-bold text-xs text-slate-900 dark:text-white">
                          Twin's Current Perceived Persona Traits
                        </h4>
                      </div>
                      <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-300">
                        Derived from Chat History Analysis
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                      {(analysis.perceivedTraits || []).map((t) => (
                        <div
                          key={t.trait}
                          className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 space-y-1 shadow-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-slate-900 dark:text-white">
                              {t.trait}
                            </span>
                            <span className="text-[10px] font-extrabold text-purple-600 dark:text-purple-400">
                              {t.score}%
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500"
                              style={{ width: `${t.score}%` }}
                            />
                          </div>
                          <p className="text-[9px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-tight pt-0.5">
                            {t.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Emotional Tone Breakdown Progress Bars */}
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                    <h4 className="font-bold text-xs text-slate-900 dark:text-white flex items-center justify-between">
                      <span>Tone &amp; Emotional Distribution</span>
                      <span className="text-[10px] text-slate-400 font-normal">Real-time percentage breakdown</span>
                    </h4>

                    <div className="space-y-2.5">
                      {analysis.toneBreakdown.map((tb) => (
                        <div key={tb.label} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-700 dark:text-slate-300">{tb.label}</span>
                            <span className="font-bold text-slate-900 dark:text-white">{tb.percentage}%</span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full transition-all duration-500 rounded-full"
                              style={{ width: `${tb.percentage}%`, backgroundColor: tb.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Key Emotional Insights List */}
                  <div className="p-4 rounded-xl bg-pink-500/10 border border-pink-500/20 space-y-2 text-xs">
                    <h4 className="font-bold text-pink-900 dark:text-pink-300 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-pink-500" />
                      <span>Psycholinguistic Pattern Insights</span>
                    </h4>
                    <ul className="space-y-1.5 text-pink-950/90 dark:text-pink-200">
                      {analysis.keyEmotionalInsights.map((insight, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-[11px] leading-relaxed">
                          <ChevronRight className="w-3 h-3 text-pink-500 shrink-0 mt-0.5" />
                          <span>{insight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {activeTab === 'timeline' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-200 dark:border-slate-800 text-xs">
                    <span className="font-bold text-slate-900 dark:text-white">Message Turn Timeline ({analysis.timeline.length})</span>
                    <span className="text-slate-400 text-[10px]">Sentiment (-1 to +1), Urgency &amp; Technical Depth (0 to 10)</span>
                  </div>

                  {analysis.timeline.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-8">No user turn data recorded yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {analysis.timeline.map((point) => (
                        <div
                          key={point.messageIndex}
                          className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 hover:border-pink-500/30 transition"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-700 dark:text-slate-300">
                                #{point.messageIndex}
                              </span>
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {point.dominantEmotion}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  point.sentiment === 'frustrated'
                                    ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                                    : point.sentiment === 'enthusiastic'
                                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                    : point.sentiment === 'analytical'
                                    ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300'
                                    : 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                                }`}
                              >
                                {point.sentiment} (score: {point.score})
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400">
                              {new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <blockquote className="text-xs italic text-slate-600 dark:text-slate-300 pl-3 border-l-2 border-slate-300 dark:border-slate-700">
                            "{point.userSnippet}"
                          </blockquote>

                          <div className="grid grid-cols-3 gap-2 pt-1 text-[10px]">
                            <div className="flex items-center justify-between p-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                              <span className="text-slate-400">Urgency:</span>
                              <strong className="text-slate-900 dark:text-white">{point.urgency}/10</strong>
                            </div>
                            <div className="flex items-center justify-between p-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                              <span className="text-slate-400">Formality:</span>
                              <strong className="text-slate-900 dark:text-white">{point.formality}/10</strong>
                            </div>
                            <div className="flex items-center justify-between p-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                              <span className="text-slate-400">Tech Depth:</span>
                              <strong className="text-slate-900 dark:text-white">{point.technicalDepth}/10</strong>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'persona' && (
                <div className="space-y-4 max-w-2xl mx-auto">
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-emerald-500" />
                        <h4 className="font-bold text-xs text-slate-900 dark:text-white">
                          TwinMind Dynamic Persona Tuning Policy
                        </h4>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                        {analysis.personaAdaptation.recommendedPacing.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                      Active Tone Mode: {analysis.personaAdaptation.activeToneMode}
                    </p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {analysis.personaAdaptation.explanation}
                    </p>
                  </div>

                  {/* Resonating Sliders / Gauges */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <Gauge className="w-3.5 h-3.5 text-pink-500" />
                          <span>Empathy Resonance</span>
                        </span>
                        <strong className="text-pink-600 dark:text-pink-400 font-bold">
                          {analysis.personaAdaptation.empathyLevel}%
                        </strong>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-pink-500 rounded-full transition-all duration-500"
                          style={{ width: `${analysis.personaAdaptation.empathyLevel}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Higher values prioritize warmth, validation, and emotional matching.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <Sliders className="w-3.5 h-3.5 text-blue-500" />
                          <span>Formality Target</span>
                        </span>
                        <strong className="text-blue-600 dark:text-blue-400 font-bold">
                          {analysis.personaAdaptation.formalityTarget}%
                        </strong>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all duration-500"
                          style={{ width: `${analysis.personaAdaptation.formalityTarget}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Controls technical precision versus casual conversational style.
                      </p>
                    </div>
                  </div>

                  {/* Active Adapted Behaviors List */}
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                    <h4 className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                      <MessageSquare className="w-4 h-4 text-purple-500" />
                      <span>Active Behavioral Adaptation Directives</span>
                    </h4>
                    <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                      {analysis.personaAdaptation.adaptedBehaviors.map((beh, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-[11px] leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0 mt-1.5" />
                          <span>{beh}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
