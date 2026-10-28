import React, { useState } from 'react';
import { DecisionAnalysis } from '../types/index.ts';
import { DecisionCalibrationDashboard } from './DecisionCalibrationDashboard.tsx';
import {
  X,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Lightbulb,
  ShieldAlert,
  Target,
  Users,
  Flame,
  Zap,
  Brain,
  MessageSquare,
  Copy,
  Volume2,
  Share2,
  MoreVertical,
  Check,
  BarChart3,
} from 'lucide-react';
import { renderFormattedMarkdown, renderInlineMarkdown } from '../utils/markdown.tsx';

export interface DebateRound {
  agent: string;
  model: string;
  role: string;
  text: string;
}

export interface DebateResult {
  decisionId?: number | null;
  topic: string;
  forecast?: {
    predictionEvent: string;
    predictedProbability: number;
    predictionDeadline: string;
  } | null;
  persistence?: { status: 'persisted'; decisionId: number };
  contextStatus?: 'available' | 'unavailable';
  partialRun?: boolean;
  rounds: DebateRound[];
}

interface DecisionAnalyzerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertToChat: (text: string) => void;
  userName?: string;
  nickname?: string;
  model?: string;
  isEmbedded?: boolean;
}

export const DecisionAnalyzerModal: React.FC<DecisionAnalyzerModalProps> = ({
  isOpen,
  onClose,
  onInsertToChat,
  userName = '',
  nickname = '',
  model,
  isEmbedded = false,
}) => {
  const displayName = nickname.trim() || userName.trim();
  const [viewMode, setViewMode] = useState<'7-step' | 'debate'>('7-step');

  // 1. 7-Step Decision State
  const [dilemma, setDilemma] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<DecisionAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 2. Multi-Agent Debate and optional probabilistic forecast state
  const [debateTopic, setDebateTopic] = useState('');
  const [forecastEvent, setForecastEvent] = useState('');
  const [forecastProbabilityPercent, setForecastProbabilityPercent] = useState('');
  const [forecastDeadline, setForecastDeadline] = useState('');
  const [debateLoading, setDebateLoading] = useState(false);
  const [debateResult, setDebateResult] = useState<DebateResult | null>(null);
  const [debateError, setDebateError] = useState<string | null>(null);

  // 3. Post-Decision Outcome Review State
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewObservation, setReviewObservation] = useState('');
  const [reviewEvidenceSource, setReviewEvidenceSource] = useState('');
  const [reviewOutcome, setReviewOutcome] = useState('');
  const [reviewCorrectionTarget, setReviewCorrectionTarget] = useState('');
  const [reviewOwnerConfirmed, setReviewOwnerConfirmed] = useState(false);
  const [reviewIdempotencyKey, setReviewIdempotencyKey] = useState(() => globalThis.crypto.randomUUID());
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);
  const [reviewHistory, setReviewHistory] = useState<Array<{
    id: number;
    observation: string;
    actual_outcome: string | null;
    evidence_source: string | null;
    outcome_verified: boolean;
    supersedes_review_id: number | null;
    created_at: string;
  }>>([]);

  if (!isOpen) return null;

  const handleAnalyze = async () => {
    if (!dilemma.trim()) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const res = await fetch('/api/analyze-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dilemma, userName, nickname, model }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze dilemma.');
      }
      setAnalysis(data.analysis);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRunDebate = async (customTopic?: string) => {
    const topicToRun = (customTopic || debateTopic).trim();
    if (!topicToRun) return;

    const hasForecast = Boolean(forecastEvent.trim() || forecastProbabilityPercent.trim() || forecastDeadline);
    const probabilityPercent = forecastProbabilityPercent.trim() === '' ? Number.NaN : Number(forecastProbabilityPercent);
    const deadlineMillis = forecastDeadline ? new Date(forecastDeadline).getTime() : Number.NaN;
    if (hasForecast && (!forecastEvent.trim() || !forecastProbabilityPercent.trim() || !forecastDeadline)) {
      setDebateError('To record a forecast, provide the event, probability, and deadline. Leave all three blank to skip forecasting.');
      return;
    }
    if (hasForecast && (!Number.isFinite(probabilityPercent) || probabilityPercent < 0 || probabilityPercent > 100)) {
      setDebateError('Forecast probability must be a number from 0 to 100 percent.');
      return;
    }
    if (hasForecast && (!Number.isFinite(deadlineMillis) || deadlineMillis <= Date.now())) {
      setDebateError('Forecast deadline must be a valid future date and time.');
      return;
    }

    setDebateLoading(true);
    setDebateError(null);
    setDebateResult(null);

    try {
      const res = await fetch('/api/debate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicToRun,
          ...(hasForecast ? {
            predictionEvent: forecastEvent.trim(),
            predictedProbability: probabilityPercent / 100,
            predictionDeadline: new Date(forecastDeadline).toISOString(),
          } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Multi-agent debate failed.');
      }
      setDebateResult(data);
      if (data.forecast) {
        // Keep a forecast tied to one saved decision; avoid accidentally reusing it on the next run.
        setForecastEvent('');
        setForecastProbabilityPercent('');
        setForecastDeadline('');
      }
      if (data.decisionId) {
        fetchReviews(data.decisionId);
      }
    } catch (err: unknown) {
      setDebateError(err instanceof Error ? err.message : 'Multi-agent debate error.');
    } finally {
      setDebateLoading(false);
    }
  };

  const fetchReviews = async (decisionId: number) => {
    try {
      const res = await fetch(`/api/decisions/${decisionId}/reviews`);
      if (res.ok) {
        const data = await res.json();
        setReviewHistory(data.reviews || []);
      }
    } catch (e) {
      console.warn('Failed to fetch decision reviews:', e);
    }
  };

  const handleSubmitReview = async () => {
    if (!debateResult?.decisionId || !reviewObservation.trim() || !reviewEvidenceSource.trim() || !reviewOutcome) {
      setReviewMsg('Outcome, observation, and evidence source are required.');
      return;
    }

    const isBinaryOutcome = reviewOutcome === 'Met Success Threshold' || reviewOutcome === 'Missed Baseline';
    if (isBinaryOutcome && !reviewOwnerConfirmed) {
      setReviewMsg('Confirm the binary outcome as an owner attestation before recording it.');
      return;
    }

    setReviewSubmitting(true);
    setReviewMsg(null);

    try {
      const res = await fetch(`/api/decisions/${debateResult.decisionId}/reviews`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: reviewIdempotencyKey,
          observation: reviewObservation.trim(),
          actualOutcome: reviewOutcome,
          evidenceSource: reviewEvidenceSource.trim(),
          ownerConfirmed: reviewOwnerConfirmed,
          ...(reviewCorrectionTarget ? { supersedesReviewId: Number(reviewCorrectionTarget) } : {}),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success !== true) {
        throw new Error(data?.code || data?.error || 'Failed to persist the review observation.');
      }

      setReviewMsg(data.message || 'Observation appended to immutable history.');
      setReviewObservation('');
      setReviewEvidenceSource('');
      setReviewCorrectionTarget('');
      setReviewOwnerConfirmed(false);
      setReviewIdempotencyKey(globalThis.crypto.randomUUID());
      await fetchReviews(debateResult.decisionId);
    } catch (err: unknown) {
      setReviewMsg(err instanceof Error ? err.message : 'Submission failed; the observation was not confirmed as saved.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const samplePrompts = [
    'Should I spend $3,500 on an intensive engineering bootcamp or build 3 production projects on my own?',
    'A client offers a 20% equity stake instead of cash for a 3-month consulting project. How should I evaluate this?',
    'I want to launch a SaaS tool, but my full-time job is demanding. Should I quit now or validate with an MVP first?',
  ];

  const sampleDebates = [
    'Monolith vs. Microservices for early-stage startup architecture',
    'Build in public on X/LinkedIn vs. Stealth mode execution',
    'Bootstrapping to profitability vs. Raising early venture capital',
    'Usage-based billing vs. Flat monthly SaaS subscription',
  ];

  const getAgentColorStyle = (role: string) => {
    if (role.includes('Optimist') || role.includes('Pro')) {
      return {
        badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
        card: 'border-emerald-200 dark:border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/15',
        icon: Sparkles,
        iconColor: 'text-emerald-600 dark:text-emerald-400',
      };
    }
    if (role.includes('Skeptic') || role.includes('Contrarian')) {
      return {
        badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30',
        card: 'border-rose-200 dark:border-rose-500/40 bg-rose-50/40 dark:bg-rose-950/15',
        icon: Flame,
        iconColor: 'text-rose-600 dark:text-rose-400',
      };
    }
    if (role.includes('Realist')) {
      return {
        badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
        card: 'border-amber-200 dark:border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/15',
        icon: Zap,
        iconColor: 'text-amber-600 dark:text-amber-400',
      };
    }
    return {
      badge: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30',
      card: 'border-indigo-200 dark:border-indigo-500/50 bg-indigo-50/30 dark:bg-gradient-to-r dark:from-indigo-950/25 dark:to-slate-950/40',
      icon: Brain,
      iconColor: 'text-indigo-600 dark:text-indigo-400',
    };
  };

  const modalInner = (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl flex flex-col shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100 ${
        isEmbedded ? 'my-2' : 'max-h-[90vh]'
      }`}
    >
      {/* Modal Header with Segmented Tab Switcher */}
      <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-400">
            {viewMode === '7-step' ? <Target className="w-4 h-4" /> : <Users className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />}
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white text-sm sm:text-base">
              {viewMode === '7-step'
                ? `${displayName}'s 7-Step Decision Deconstructor`
                : "Multi-Agent Debate & Devil's Advocate Panel"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {viewMode === '7-step'
                ? 'Substance over hype, verified evidence, realistic trade-offs, and clear next steps'
                : 'Live multi-model clash: Gemini Pro vs. Mistral Contrarian vs. Groq Realist vs. Chief Arbiter'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Segmented Mode Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('7-step')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                viewMode === '7-step'
                  ? 'bg-amber-500/20 text-amber-900 dark:text-amber-300 border border-amber-500/30 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Target className="w-3.5 h-3.5" />
              <span>7-Step Evaluator</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('debate')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                viewMode === 'debate'
                  ? 'bg-indigo-500/20 text-indigo-900 dark:text-indigo-300 border border-indigo-500/30 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
              <span>Multi-Agent Debate</span>
            </button>
          </div>

          {!isEmbedded && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Modal Body */}
      <div className="p-5 sm:p-6 overflow-y-auto space-y-6">
        {/* MODE 1: 7-STEP DECISION EVALUATOR */}
        {viewMode === '7-step' && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                Present a real decision, investment, trade-off, or dilemma:
              </label>
              <textarea
                value={dilemma}
                onChange={(e) => setDilemma(e.target.value)}
                placeholder="e.g. I am debating between two job offers: one pays $70k at an early-stage startup with equity, the other pays $95k at an established firm with rigid hours. I want to build independence in 3 years..."
                rows={3}
                className="w-full bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700/80 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Quick tests:</span>
                  {samplePrompts.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setDilemma(s)}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60 transition truncate max-w-xs"
                      title={s}
                    >
                      Scenario {idx + 1}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleAnalyze}
                  disabled={loading || !dilemma.trim()}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-semibold text-xs flex items-center gap-2 shadow-md transition disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deconstructing with {displayName}...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Run 7-Step Evaluation</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-200 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="font-semibold">Analysis Failed</p>
                  <p className="opacity-90">{error}</p>
                </div>
              </div>
            )}

            {/* Rendered Analysis */}
            {analysis && (
              <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Structured Decision Breakdown
                  </h3>
                  <button
                    onClick={() => {
                      const text = `**Situation Analysis:** ${analysis.actualSituation}\n**Confidence Level:** ${
                        analysis.confidenceLevel || 'Medium'
                      } (${analysis.confidenceReason || ''})\n**What Matters Most:** ${
                        analysis.whatMattersMost
                      }\n**Recommended Course:** ${analysis.recommendedAction}\n**Next Practical Step:** ${
                        analysis.nextPracticalStep
                      }`;
                      onInsertToChat(text);
                      onClose();
                    }}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-medium flex items-center gap-1"
                  >
                    <span>Discuss in Chat</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>

                {/* Confidence Level */}
                <div
                  className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center gap-2 ${
                    analysis.confidenceLevel === 'High'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-100'
                      : analysis.confidenceLevel === 'Low'
                      ? 'bg-red-500/10 border-red-500/30 text-red-900 dark:text-red-100'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-100'
                  }`}
                >
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
                        analysis.confidenceLevel === 'High'
                          ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-500/40'
                          : analysis.confidenceLevel === 'Low'
                          ? 'bg-red-500/20 text-red-800 dark:text-red-300 border-red-500/40'
                          : 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40'
                      }`}
                    >
                      {analysis.confidenceLevel || 'Medium'} Confidence
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed opacity-90">
                    {analysis.confidenceReason ||
                      'Assessed against verified facts versus unresolved assumptions.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div className="p-3.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] text-slate-600 dark:text-slate-400">
                        1
                      </span>
                      Actual Situation (Facts vs Assumptions)
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{renderFormattedMarkdown(analysis.actualSituation)}</div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] text-slate-600 dark:text-slate-400">
                        2
                      </span>
                      What Matters Most
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{renderFormattedMarkdown(analysis.whatMattersMost)}</div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] text-slate-600 dark:text-slate-400">
                        3
                      </span>
                      Realistic Options
                    </div>
                    <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1 list-disc list-inside">
                      {analysis.realisticOptions?.map((opt, i) => (
                        <li key={i}>{renderInlineMarkdown(opt)}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] text-slate-600 dark:text-slate-400">
                        4
                      </span>
                      Trade-offs &amp; Resource Costs
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{renderFormattedMarkdown(analysis.tradeOffs)}</div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-red-500/10 dark:bg-red-950/10 border border-red-200 dark:border-red-900/40">
                    <div className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
                      Principal Risks &amp; Diminishing Returns
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{renderFormattedMarkdown(analysis.principalRisks)}</div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-emerald-500/10 dark:bg-emerald-950/10 border border-emerald-200 dark:border-emerald-900/40">
                    <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1 flex items-center gap-1.5">
                      <Lightbulb className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                      Recommended Course of Action
                    </div>
                    <div className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
                      {renderFormattedMarkdown(analysis.recommendedAction)}
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-indigo-500/10 dark:from-amber-950/30 dark:to-indigo-950/30 border border-amber-300 dark:border-amber-600/30">
                  <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                    <Target className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                    Next Practical Step (Immediate Execution)
                  </div>
                  <div className="text-xs md:text-sm text-slate-900 dark:text-slate-100 font-semibold leading-relaxed">
                    {renderFormattedMarkdown(analysis.nextPracticalStep)}
                  </div>
                  {analysis.clarifyingQuestion && (
                    <div className="mt-2 text-xs text-amber-800 dark:text-amber-200/90 italic border-t border-amber-300 dark:border-amber-500/20 pt-2 flex items-center gap-1">
                      <span>💡 Clarifying Question:</span> {renderInlineMarkdown(analysis.clarifyingQuestion)}
                    </div>
                  )}
                </div>

                {analysis.challengerCritique && (
                  <div className="p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                        <span>Challenger Audit ({analysis.challengerCritique.model})</span>
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                        {analysis.challengerCritique.agreementLevel}
                      </span>
                    </div>
                    <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1 list-disc list-inside leading-relaxed">
                      {analysis.challengerCritique.points.map((pt, idx) => (
                        <li key={idx}>{renderInlineMarkdown(pt)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* MODE 2: MULTI-AGENT DEBATE & DEVIL'S ADVOCATE PANEL */}
        {viewMode === 'debate' && (
          <div className="space-y-5">
            {/* Participating Agents Lineup Banner */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs flex-1">
                <div className="p-2 rounded-lg bg-emerald-500/10 dark:bg-emerald-950/30 border border-emerald-500/30">
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">
                    Pro Advocate
                  </span>
                  <p className="font-semibold text-slate-900 dark:text-white truncate">Gemini Pro</p>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">Optimist &amp; Velocity</span>
                </div>
                <div className="p-2 rounded-lg bg-rose-500/10 dark:bg-rose-950/30 border border-rose-500/30">
                  <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider block">
                    Devil&apos;s Advocate
                  </span>
                  <p className="font-semibold text-slate-900 dark:text-white truncate">Mistral AI</p>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">Contrarian Audit</span>
                </div>
                <div className="p-2 rounded-lg bg-amber-500/10 dark:bg-amber-950/30 border border-amber-500/30">
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider block">
                    Realist
                  </span>
                  <p className="font-semibold text-slate-900 dark:text-white truncate">Groq LPUs</p>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">Execution Realities</span>
                </div>
                <div className="p-2 rounded-lg bg-indigo-500/10 dark:bg-indigo-950/30 border border-indigo-500/30">
                  <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider block">
                    Chief Arbiter
                  </span>
                  <p className="font-semibold text-slate-900 dark:text-white truncate">Digital Twin</p>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">Synthesis &amp; Action</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCalibrationModal(true)}
                className="px-3 py-2 text-xs font-bold rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 transition flex items-center gap-1.5 shrink-0"
              >
                <BarChart3 className="w-3.5 h-3.5 text-indigo-500" />
                <span>Calibration Dashboard</span>
              </button>
            </div>

            {showCalibrationModal && (
              <DecisionCalibrationDashboard onClose={() => setShowCalibrationModal(false)} />
            )}

            {/* Topic Input Form */}
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                Enter strategic proposition or dilemma to debate:
              </label>
              <textarea
                value={debateTopic}
                onChange={(e) => setDebateTopic(e.target.value)}
                placeholder="e.g. Monolith vs. Microservices for an early-stage startup, or Should we build in public on X vs stealth mode?"
                rows={2}
                className="w-full bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700/80 rounded-xl p-3 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
              />

              <div className="mt-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 space-y-2">
                <div>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">Optional probability forecast</p>
                  <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                    Save a testable prediction for later calibration. Leave all fields blank to skip. Forecasts need an event, probability, and future deadline.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">Predicted event</label>
                    <input
                      type="text"
                      value={forecastEvent}
                      onChange={(e) => setForecastEvent(e.target.value)}
                      maxLength={2000}
                      placeholder="e.g. Reach 100 paid users"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">Probability (%)</label>
                    <input
                      type="number"
                      value={forecastProbabilityPercent}
                      onChange={(e) => setForecastProbabilityPercent(e.target.value)}
                      min={0}
                      max={100}
                      step={1}
                      placeholder="e.g. 70"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">Deadline</label>
                    <input
                      type="datetime-local"
                      value={forecastDeadline}
                      onChange={(e) => setForecastDeadline(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Preset Debates:</span>
                  {sampleDebates.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setDebateTopic(s);
                        handleRunDebate(s);
                      }}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60 transition truncate max-w-xs"
                      title={s}
                    >
                      {s.split(' vs')[0] || `Debate ${idx + 1}`}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => handleRunDebate()}
                  disabled={debateLoading || !debateTopic.trim()}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold text-xs flex items-center gap-2 shadow-md transition disabled:opacity-50"
                >
                  {debateLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Convening 4-Agent Debate...</span>
                    </>
                  ) : (
                    <>
                      <Users className="w-3.5 h-3.5" />
                      <span>Convene Multi-Agent Debate</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {debateError && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-200 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="font-semibold">Debate Panel Error</p>
                  <p className="opacity-90">{debateError}</p>
                </div>
              </div>
            )}

            {/* Rendered Live Multi-Agent Debate Transcript */}
            {debateResult && (
              <div className="space-y-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                {debateResult.forecast && (
                  <div className="p-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 dark:bg-indigo-500/10 space-y-1.5">
                    <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
                      Forecast saved with Decision #{debateResult.decisionId}
                    </p>
                    <p className="text-sm text-slate-900 dark:text-slate-100">{debateResult.forecast.predictionEvent}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                      <span>Predicted probability: {(debateResult.forecast.predictedProbability * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</span>
                      <span>Deadline: {new Date(debateResult.forecast.predictionDeadline).toLocaleString()}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">This is the original saved forecast; later observations are recorded separately.</p>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      Debate Proposition
                    </span>
                    <span className="text-xs text-slate-900 dark:text-white font-semibold">&ldquo;{debateResult.topic}&rdquo;</span>
                  </div>

                  <button
                    onClick={() => {
                      const debateSummary = `### ⚔️ Multi-Agent Debate: "${debateResult.topic}"\n\n${debateResult.rounds
                        .map((r) => `**${r.agent} (${r.role}):**\n${r.text}`)
                        .join('\n\n---\n\n')}`;
                      onInsertToChat(debateSummary);
                      onClose();
                    }}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-medium flex items-center gap-1"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Send Transcript to Chat</span>
                  </button>
                </div>

                {/* Agent Speeches Timeline */}
                <div className="space-y-3">
                  {debateResult.rounds.map((round, idx) => {
                    const style = getAgentColorStyle(round.role);
                    const Icon = style.icon;
                    const isArbiter = round.role === 'Chief Arbiter';

                    return (
                      <div
                        key={idx}
                        className={`p-4 rounded-xl border ${style.card} transition-all space-y-2`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 dark:border-white/5 pb-2">
                          <div className="flex items-center gap-2">
                            <div className={`p-1 rounded-md bg-white/80 dark:bg-black/40 shadow-xs ${style.iconColor}`}>
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                            <span className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm">
                              {round.agent}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${style.badge}`}
                            >
                              {round.role}
                            </span>
                          </div>

                          <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400 bg-black/5 dark:bg-black/30 px-2 py-0.5 rounded">
                            {round.model}
                          </span>
                        </div>

                        <div className="text-xs sm:text-[13px] text-slate-800 dark:text-slate-200 leading-relaxed font-sans">
                          {renderFormattedMarkdown(round.text)}
                        </div>

                        {/* Icon-Only Action Row matching ChatGPT style */}
                        <div className="flex items-center gap-3 pt-2 text-slate-500 dark:text-slate-400 border-t border-black/5 dark:border-white/5">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(`${round.agent} (${round.role}):\n${round.text}`);
                            }}
                            className="hover:text-slate-900 dark:hover:text-slate-100 transition p-0.5"
                            title="Copy speech"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if ('speechSynthesis' in window) {
                                window.speechSynthesis.cancel();
                                const u = new SpeechSynthesisUtterance(round.text);
                                window.speechSynthesis.speak(u);
                              }
                            }}
                            className="hover:text-slate-900 dark:hover:text-slate-100 transition p-0.5"
                            title="Read Aloud"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (navigator.share) {
                                navigator.share({ title: `${round.agent} on ${debateResult.topic}`, text: round.text }).catch(() => {});
                              } else {
                                navigator.clipboard.writeText(round.text);
                              }
                            }}
                            className="hover:text-slate-900 dark:hover:text-slate-100 transition p-0.5"
                            title="Share argument"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {isArbiter && (
                          <div className="pt-2 border-t border-indigo-200 dark:border-indigo-500/20 flex items-center justify-between text-[11px] text-indigo-700 dark:text-indigo-300">
                            <span>Strict Zero-Fallback Multi-Model Synthesis</span>
                            <span className="font-semibold text-slate-900 dark:text-white">Chief Arbiter: {displayName}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Append-Only Post-Decision Outcome Review Section */}
                {debateResult.decisionId && (
                  <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-emerald-500" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                          Post-Decision Review & Empirical Outcome Logging
                        </h4>
                      </div>

                      <button
                        type="button"
                        onClick={() => setShowReviewForm(!showReviewForm)}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 transition"
                      >
                        {showReviewForm ? 'Hide Review Form' : '+ Record Outcome Observation'}
                      </button>
                    </div>

                    {showReviewForm && (
                      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                              Evidence Source
                            </label>
                            <input
                              type="text"
                              value={reviewEvidenceSource}
                              onChange={(e) => setReviewEvidenceSource(e.target.value)}
                              maxLength={2048}
                              placeholder="Report, dashboard, document, or source URL"
                              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                              Empirical Outcome Result
                            </label>
                            <select
                              value={reviewOutcome}
                              onChange={(e) => {
                                setReviewOutcome(e.target.value);
                                setReviewOwnerConfirmed(false);
                              }}
                              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            >
                              <option value="">Select an observed outcome</option>
                              <option value="Pending Verification">Pending Verification</option>
                              <option value="Met Success Threshold">Met Success Threshold</option>
                              <option value="Missed Baseline">Missed Baseline</option>
                              <option value="Inconclusive">Inconclusive</option>
                              <option value="Pivot Executed">Pivot Executed</option>
                              <option value="Cancelled">Cancelled</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                            Correction of Prior Observation (Optional)
                          </label>
                          <select
                            value={reviewCorrectionTarget}
                            onChange={(e) => setReviewCorrectionTarget(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                          >
                            <option value="">Record a new observation</option>
                            {reviewHistory
                              .filter((candidate) => !reviewHistory.some((review) => review.supersedes_review_id === candidate.id))
                              .map((review) => (
                                <option key={review.id} value={String(review.id)}>
                                  #{review.id} · {review.actual_outcome || 'Pending Verification'} · {new Date(review.created_at).toLocaleString()}
                                </option>
                              ))}
                          </select>
                          <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                            A correction appends a new record linked to the prior one. The original observation is never overwritten.
                          </p>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                            Outcome Observation / Observed Evidence
                          </label>
                          <textarea
                            value={reviewObservation}
                            onChange={(e) => setReviewObservation(e.target.value)}
                            rows={2}
                            placeholder="Enter observed empirical metrics, customer response, or actual results..."
                            className="w-full p-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                          />
                        </div>

                        {(reviewOutcome === 'Met Success Threshold' || reviewOutcome === 'Missed Baseline') && (
                          <label className="flex items-start gap-2 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={reviewOwnerConfirmed}
                              onChange={(e) => setReviewOwnerConfirmed(e.target.checked)}
                              className="mt-1"
                            />
                            <span>I attest that this binary outcome was observed. This is an owner attestation, not independent verification.</span>
                          </label>
                        )}

                        {reviewMsg && (
                          <p role="status" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {reviewMsg}
                          </p>
                        )}

                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={handleSubmitReview}
                            disabled={reviewSubmitting || !reviewObservation.trim()}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition flex items-center gap-1.5"
                          >
                            {reviewSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            <span>Append Outcome Observation</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Historical Append-Only Review Records */}
                    {reviewHistory.length > 0 && (
                      <div className="space-y-2 pt-2">
                        <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          Recorded Empirical History ({reviewHistory.length})
                        </h5>
                        <div className="space-y-1.5">
                          {reviewHistory.map((rh) => (
                            <div
                              key={rh.id}
                              className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between text-[10px] text-slate-500">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">
                                  {rh.outcome_verified ? 'Owner-attested binary outcome' : 'Observation not eligible for calibration'}
                                </span>
                                <span className="font-mono">{new Date(rh.created_at).toLocaleString()}</span>
                              </div>
                              <p className="text-slate-800 dark:text-slate-200 font-sans">{rh.observation}</p>
                              {rh.evidence_source && (
                                <p className="text-slate-500 dark:text-slate-400">Evidence source: {rh.evidence_source}</p>
                              )}
                              {rh.supersedes_review_id && (
                                <p className="text-amber-700 dark:text-amber-300">Correction supersedes review #{rh.supersedes_review_id}</p>
                              )}
                              {rh.actual_outcome && (
                                <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
                                  Outcome: {rh.actual_outcome}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (isEmbedded) {
    return (
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 max-w-4xl w-full mx-auto pb-24">
        {modalInner}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      {modalInner}
    </div>
  );
};
