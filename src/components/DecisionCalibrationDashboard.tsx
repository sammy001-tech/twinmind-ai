import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  HelpCircle,
  Loader2,
  RotateCcw,
  Target,
  X,
  XCircle,
} from 'lucide-react';

interface CalibrationBand {
  label: string;
  sampleSize: number;
  sufficient: boolean;
  meanPredictedProbability: number | null;
  observedSuccessRate: number | null;
}

interface CalibrationMetrics {
  available: boolean;
  totalDecisions: number | null;
  totalReviews: number | null;
  eligibleCount: number;
  sampleSizeSufficient: boolean;
  brierScore: number | null;
  meanPredictedProbability: number | null;
  observedSuccessRate: number | null;
  meanCalibrationBias: number | null;
  successfulOutcomes: number;
  verifiedOutcomeCount: number;
  unverifiedOutcomeCount: number;
  calibrationBands: CalibrationBand[];
  outcomeCounts: Record<string, number>;
}

interface ExperimentRecord {
  id: number;
  decision_id: number;
  decision_title?: string;
  baseline_metric: string | null;
  baseline_value: number | string | null;
  target_metric: string | null;
  units: string | null;
  threshold_value: number | string | null;
  measurement_direction: 'above' | 'below' | string;
  observation_window_days: number | null;
  evidence_source: string | null;
  is_hypothesis: boolean;
  supersedes_experiment_id: number | null;
  status: string;
  start_date: string;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

interface DecisionCalibrationDashboardProps {
  onClose?: () => void;
  isEmbedded?: boolean;
}

type ObservationDraft = {
  observation: string;
  measuredValue: string;
  evidenceSource: string;
  actualOutcome: string;
  ownerConfirmed: boolean;
};

const emptyObservationDraft = (): ObservationDraft => ({
  observation: '',
  measuredValue: '',
  evidenceSource: '',
  actualOutcome: '',
  ownerConfirmed: false,
});

const statusesByCurrentState: Record<string, string[]> = {
  Proposed: ['Active Experiment', 'Cancelled'],
  'Active Experiment': ['Awaiting Data', 'Completed Review', 'Inconclusive', 'Pivoted', 'Cancelled'],
  'Awaiting Data': ['Completed Review', 'Inconclusive', 'Pivoted', 'Cancelled'],
  Overdue: ['Completed Review', 'Inconclusive', 'Pivoted', 'Cancelled'],
  'Completed Review': [],
  Inconclusive: [],
  Pivoted: [],
  Cancelled: [],
};

function idempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function responseMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'code' in payload) {
    const code = (payload as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code;
  }
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  return fallback;
}

async function readResponse(response: Response, fallback: string): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload) || (payload as Record<string, unknown>).success !== true) {
    throw new Error(responseMessage(payload, fallback));
  }
  return payload as Record<string, unknown>;
}

export const DecisionCalibrationDashboard: React.FC<DecisionCalibrationDashboardProps> = ({
  onClose,
  isEmbedded = false,
}) => {
  const [activeTab, setActiveTab] = useState<'calibration' | 'experiments'>('calibration');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CalibrationMetrics | null>(null);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);

  const [showExpForm, setShowExpForm] = useState(false);
  const [expDecisionId, setExpDecisionId] = useState('');
  const [expHypothesisOnly, setExpHypothesisOnly] = useState(false);
  const [expBaseline, setExpBaseline] = useState('');
  const [expBaselineValue, setExpBaselineValue] = useState('');
  const [expTarget, setExpTarget] = useState('');
  const [expUnits, setExpUnits] = useState('');
  const [expThreshold, setExpThreshold] = useState('');
  const [expDirection, setExpDirection] = useState<'above' | 'below'>('above');
  const [expTargetDate, setExpTargetDate] = useState('');
  const [expObservationWindowDays, setExpObservationWindowDays] = useState('30');
  const [expEvidenceSource, setExpEvidenceSource] = useState('');
  const [expSupersedesId, setExpSupersedesId] = useState('');
  const [expIdempotencyKey, setExpIdempotencyKey] = useState(idempotencyKey);
  const [expSubmitting, setExpSubmitting] = useState(false);
  const [expSuccessMsg, setExpSuccessMsg] = useState<string | null>(null);

  const [observationDrafts, setObservationDrafts] = useState<Record<number, ObservationDraft>>({});
  const [pendingObservationKeys, setPendingObservationKeys] = useState<Record<number, string>>({});
  const [transitionTargets, setTransitionTargets] = useState<Record<number, string>>({});
  const [transitionNotes, setTransitionNotes] = useState<Record<number, string>>({});
  const [replacementIds, setReplacementIds] = useState<Record<number, string>>({});
  const [pendingTransitionKeys, setPendingTransitionKeys] = useState<Record<number, string>>({});
  const [actionBusy, setActionBusy] = useState<Record<number, string>>({});
  const [actionMessages, setActionMessages] = useState<Record<number, { kind: 'success' | 'error'; text: string }>>({});

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [calRes, expRes] = await Promise.all([
        fetch('/api/calibration', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/experiments', { credentials: 'same-origin', cache: 'no-store' }),
      ]);
      const [calData, expData] = await Promise.all([
        readResponse(calRes, 'Calibration data is unavailable.'),
        readResponse(expRes, 'Experiment data is unavailable.'),
      ]);
      setMetrics(calData.metrics as CalibrationMetrics);
      setExperiments(Array.isArray(expData.experiments) ? expData.experiments as ExperimentRecord[] : []);
    } catch (err: unknown) {
      setMetrics(null);
      setExperiments([]);
      setError(err instanceof Error ? err.message : 'Dashboard data could not be verified.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboardData();
  }, [fetchDashboardData]);

  const updateObservationDraft = (experimentId: number, patch: Partial<ObservationDraft>) => {
    setObservationDrafts((previous) => ({
      ...previous,
      [experimentId]: { ...(previous[experimentId] || emptyObservationDraft()), ...patch },
    }));
  };

  const showActionMessage = (experimentId: number, kind: 'success' | 'error', text: string) => {
    setActionMessages((previous) => ({ ...previous, [experimentId]: { kind, text } }));
  };

  const handleCreateExperiment = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setExpSuccessMsg(null);

    const decisionId = Number(expDecisionId);
    if (!Number.isSafeInteger(decisionId) || decisionId < 1) {
      setError('Enter a valid saved decision ID. The dashboard will not assume a default decision.');
      return;
    }

    setExpSubmitting(true);
    try {
      const response = await fetch('/api/decisions/' + decisionId + '/experiments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: expIdempotencyKey,
          hypothesisOnly: expHypothesisOnly,
          baselineMetric: expBaseline.trim() || undefined,
          baselineValue: expBaselineValue === '' ? undefined : Number(expBaselineValue),
          targetMetric: expTarget.trim() || undefined,
          units: expUnits.trim() || undefined,
          thresholdValue: expThreshold === '' ? undefined : Number(expThreshold),
          measurementDirection: expDirection,
          targetDate: expTargetDate || undefined,
          observationWindowDays: expObservationWindowDays === '' ? undefined : Number(expObservationWindowDays),
          evidenceSource: expEvidenceSource.trim() || undefined,
          supersedesExperimentId: expSupersedesId === '' ? undefined : Number(expSupersedesId),
        }),
      });
      const data = await readResponse(response, 'Experiment registration failed.');
      setExpSuccessMsg(data.isDuplicate === true ? 'This experiment request was already recorded.' : 'Experiment registered as Proposed.');
      setExpIdempotencyKey(idempotencyKey());
      setShowExpForm(false);
      setExpDecisionId('');
      setExpHypothesisOnly(false);
      setExpBaseline('');
      setExpBaselineValue('');
      setExpTarget('');
      setExpUnits('');
      setExpThreshold('');
      setExpTargetDate('');
      setExpObservationWindowDays('30');
      setExpEvidenceSource('');
      setExpSupersedesId('');
      await fetchDashboardData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Experiment registration failed.';
      setError(message);
      if (message.includes('IDEMPOTENCY_PAYLOAD_CONFLICT')) setExpIdempotencyKey(idempotencyKey());
    } finally {
      setExpSubmitting(false);
    }
  };

  const recordObservation = async (experiment: ExperimentRecord) => {
    const draft = observationDrafts[experiment.id] || emptyObservationDraft();
    if (!draft.observation.trim() || !draft.evidenceSource.trim()) {
      showActionMessage(experiment.id, 'error', 'Observation and evidence source are required.');
      return;
    }
    if (
      (draft.actualOutcome === 'Met Success Threshold' || draft.actualOutcome === 'Missed Baseline')
      && !draft.ownerConfirmed
    ) {
      showActionMessage(experiment.id, 'error', 'Confirm the binary outcome before it can contribute to calibration.');
      return;
    }

    const key = pendingObservationKeys[experiment.id] || idempotencyKey();
    setPendingObservationKeys((previous) => ({ ...previous, [experiment.id]: key }));
    setActionBusy((previous) => ({ ...previous, [experiment.id]: 'observation' }));
    setActionMessages((previous) => { const next = { ...previous }; delete next[experiment.id]; return next; });
    try {
      const response = await fetch('/api/experiments/' + experiment.id + '/observations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: key,
          observation: draft.observation.trim(),
          measuredValue: draft.measuredValue === '' ? undefined : Number(draft.measuredValue),
          evidenceSource: draft.evidenceSource.trim(),
          actualOutcome: draft.actualOutcome || undefined,
          ownerConfirmed: draft.ownerConfirmed,
        }),
      });
      const data = await readResponse(response, 'Observation could not be recorded.');
      showActionMessage(experiment.id, 'success', data.isDuplicate === true ? 'Identical observation already exists.' : 'Observation appended to the experiment history.');
      setPendingObservationKeys((previous) => { const next = { ...previous }; delete next[experiment.id]; return next; });
      setObservationDrafts((previous) => ({ ...previous, [experiment.id]: emptyObservationDraft() }));
      await fetchDashboardData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Observation could not be recorded.';
      showActionMessage(experiment.id, 'error', message);
      if (message.includes('IDEMPOTENCY_PAYLOAD_CONFLICT')) {
        setPendingObservationKeys((previous) => { const next = { ...previous }; delete next[experiment.id]; return next; });
      }
    } finally {
      setActionBusy((previous) => { const next = { ...previous }; delete next[experiment.id]; return next; });
    }
  };

  const transitionExperiment = async (experiment: ExperimentRecord) => {
    const toStatus = transitionTargets[experiment.id];
    if (!toStatus) {
      showActionMessage(experiment.id, 'error', 'Select a lifecycle transition first.');
      return;
    }
    const note = (transitionNotes[experiment.id] || '').trim();
    if (['Cancelled', 'Inconclusive', 'Pivoted'].includes(toStatus) && !note) {
      showActionMessage(experiment.id, 'error', 'A reason is required for this transition.');
      return;
    }
    const replacementText = replacementIds[experiment.id] || '';
    if (toStatus === 'Pivoted' && (!Number.isSafeInteger(Number(replacementText)) || Number(replacementText) < 1)) {
      showActionMessage(experiment.id, 'error', 'Provide the replacement experiment ID linked to this experiment.');
      return;
    }

    const key = pendingTransitionKeys[experiment.id] || idempotencyKey();
    setPendingTransitionKeys((previous) => ({ ...previous, [experiment.id]: key }));
    setActionBusy((previous) => ({ ...previous, [experiment.id]: 'transition' }));
    setActionMessages((previous) => { const next = { ...previous }; delete next[experiment.id]; return next; });
    try {
      const response = await fetch('/api/experiments/' + experiment.id + '/status', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: key,
          toStatus,
          note: note || undefined,
          replacementExperimentId: toStatus === 'Pivoted' ? Number(replacementText) : undefined,
        }),
      });
      const data = await readResponse(response, 'Experiment transition failed.');
      showActionMessage(experiment.id, 'success', data.isDuplicate === true ? 'This transition was already recorded.' : 'Lifecycle event recorded.');
      setPendingTransitionKeys((previous) => { const next = { ...previous }; delete next[experiment.id]; return next; });
      setTransitionTargets((previous) => ({ ...previous, [experiment.id]: '' }));
      setTransitionNotes((previous) => ({ ...previous, [experiment.id]: '' }));
      setReplacementIds((previous) => ({ ...previous, [experiment.id]: '' }));
      await fetchDashboardData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Experiment transition failed.';
      showActionMessage(experiment.id, 'error', message);
      if (message.includes('IDEMPOTENCY_PAYLOAD_CONFLICT')) {
        setPendingTransitionKeys((previous) => { const next = { ...previous }; delete next[experiment.id]; return next; });
      }
    } finally {
      setActionBusy((previous) => { const next = { ...previous }; delete next[experiment.id]; return next; });
    }
  };

  const dashboardContent = (
    <div className="space-y-6 text-slate-900 dark:text-slate-100 font-sans">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-lg font-bold tracking-tight">Decision Calibration & Experiment Tracking</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Probabilistic forecasts, verified outcomes, explicit sample sizes, and append-only experiment history
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-semibold">
            <button onClick={() => setActiveTab('calibration')} className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'calibration' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}>
              Calibration
            </button>
            <button onClick={() => setActiveTab('experiments')} className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'experiments' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}>
              Experiments ({experiments.length})
            </button>
          </div>
          {onClose && <button type="button" aria-label="Close dashboard" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"><X className="w-5 h-5" /></button>}
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-xs font-semibold">Loading persisted forecasts, outcomes, and experiments…</p>
        </div>
      ) : error ? (
        <div role="alert" className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => void fetchDashboardData()} className="underline font-semibold">Retry</button>
        </div>
      ) : metrics ? (
        <>
          {activeTab === 'calibration' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Brier Score · Forecast Error</div>
                  {metrics.sampleSizeSufficient && metrics.brierScore !== null ? (
                    <>
                      <div className="text-3xl font-extrabold font-mono">{metrics.brierScore.toFixed(4)}</div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Lower is better. Eligible forecasts: {metrics.eligibleCount}.</p>
                    </>
                  ) : (
                    <>
                      <div className="text-base font-extrabold text-amber-600 dark:text-amber-400">Insufficient sample</div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{metrics.eligibleCount} eligible forecast(s); at least 5 required before showing the aggregate score as established.</p>
                    </>
                  )}
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Stored Decisions</div>
                  <div className="text-3xl font-extrabold font-mono">{metrics.totalDecisions ?? '—'}</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Some decisions may have no explicit probabilistic forecast.</p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Review Observations</div>
                  <div className="text-3xl font-extrabold font-mono">{metrics.totalReviews ?? '—'}</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Includes pending, inconclusive, and correction history.</p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Observed Binary Outcomes</div>
                  <div className="text-3xl font-extrabold font-mono">{metrics.successfulOutcomes} / {metrics.verifiedOutcomeCount}</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Count of recorded verified successes, not a claim of 100% predictive accuracy.</p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Confidence calibration by probability band</h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Only forecasts with an explicit event and probability, an elapsed deadline, an owner-confirmed binary outcome, and a non-empty evidence source are eligible. Qualitative confidence and evidence sufficiency are different fields.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                  {(metrics.calibrationBands || []).map((band) => (
                    <div key={band.label} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                      <div className="text-xs font-bold">{band.label}</div>
                      <div className="text-[10px] text-slate-500 mt-1">n = {band.sampleSize}</div>
                      {band.sufficient && band.meanPredictedProbability !== null && band.observedSuccessRate !== null ? (
                        <div className="mt-2 space-y-1 text-[11px]">
                          <div>Mean forecast: {(band.meanPredictedProbability * 100).toFixed(1)}%</div>
                          <div>Observed success: {(band.observedSuccessRate * 100).toFixed(1)}%</div>
                        </div>
                      ) : (
                        <div className="mt-2 text-[11px] font-semibold text-amber-600 dark:text-amber-400">Insufficient sample (5+ required)</div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                  {[
                    ['Met threshold', 'Met Success Threshold', CheckCircle2],
                    ['Missed baseline', 'Missed Baseline', XCircle],
                    ['Inconclusive', 'Inconclusive', HelpCircle],
                    ['Pivot executed', 'Pivot Executed', RotateCcw],
                    ['Cancelled', 'Cancelled', AlertTriangle],
                    ['Unverified', 'Unverified Outcome', Clock],
                  ].map(([label, key, Icon]) => {
                    const OutcomeIcon = Icon as React.ComponentType<{ className?: string }>;
                    return (
                      <div key={String(key)} className="p-2.5 rounded-xl bg-white/70 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-1 font-bold text-[11px]"><OutcomeIcon className="w-3.5 h-3.5" />{String(label)}</div>
                        <div className="mt-1 text-xl font-extrabold font-mono">{metrics.outcomeCounts[String(key)] ?? 0}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'experiments' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Experiment lifecycle</h3>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Overdue means evidence is missing after the target date; it is not an automatic failure.</p>
                </div>
                <button type="button" onClick={() => setShowExpForm(!showExpForm)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition">
                  {showExpForm ? 'Hide form' : '+ Register'}
                </button>
              </div>

              {expSuccessMsg && <p role="status" className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{expSuccessMsg}</p>}

              {showExpForm && (
                <form onSubmit={handleCreateExperiment} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                  <h4 className="font-bold text-slate-900 dark:text-white">Register experiment or hypothesis</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">A measurable experiment requires a recorded baseline, target metric, units, threshold, observation window, due date, and evidence source. A hypothesis may be registered without inventing a baseline.</p>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={expHypothesisOnly} onChange={(e) => setExpHypothesisOnly(e.target.checked)} className="mt-0.5" />
                    <span><strong>Register as hypothesis</strong> — baseline is not measured yet; this will not be treated as a measurable experiment.</span>
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="block">Saved decision ID
                      <input type="number" min="1" required value={expDecisionId} onChange={(e) => setExpDecisionId(e.target.value)} placeholder="Enter an existing decision ID" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                    </label>
                    <label className="block">Metric name
                      <input type="text" required={!expHypothesisOnly} value={expBaseline} onChange={(e) => setExpBaseline(e.target.value)} placeholder="e.g. weekly active users" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                    </label>
                    <label className="block">Measured baseline value
                      <input type="number" required={!expHypothesisOnly} value={expBaselineValue} onChange={(e) => setExpBaselineValue(e.target.value)} placeholder="Actual measured starting value" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                    </label>
                    <label className="block">Target metric label
                      <input type="text" required={!expHypothesisOnly} value={expTarget} onChange={(e) => setExpTarget(e.target.value)} placeholder="e.g. increase weekly active users" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                    </label>
                    <label className="block">Units
                      <input type="text" required={!expHypothesisOnly} value={expUnits} onChange={(e) => setExpUnits(e.target.value)} placeholder="e.g. users, USD, conversions" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                    </label>
                    <label className="block">Success threshold value
                      <input type="number" required={!expHypothesisOnly} value={expThreshold} onChange={(e) => setExpThreshold(e.target.value)} placeholder="Numeric threshold" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                    </label>
                    <label className="block">Measurement direction
                      <select value={expDirection} onChange={(e) => setExpDirection(e.target.value as 'above' | 'below')} className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800">
                        <option value="above">Above threshold</option>
                        <option value="below">Below threshold</option>
                      </select>
                    </label>
                    <label className="block">Observation window (days)
                      <input type="number" min="1" max="3650" required={!expHypothesisOnly} value={expObservationWindowDays} onChange={(e) => setExpObservationWindowDays(e.target.value)} className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                    </label>
                    <label className="block">Target / review date
                      <input type="date" required={!expHypothesisOnly} value={expTargetDate} onChange={(e) => setExpTargetDate(e.target.value)} className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                    </label>
                    <label className="block">Evidence source / measurement method
                      <input type="text" required={!expHypothesisOnly} value={expEvidenceSource} onChange={(e) => setExpEvidenceSource(e.target.value)} placeholder="Where the metric will be checked" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                    </label>
                    <label className="block">Replacement for experiment ID (optional)
                      <input type="number" min="1" value={expSupersedesId} onChange={(e) => setExpSupersedesId(e.target.value)} placeholder="For a linked pivot" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                    </label>
                  </div>
                  <div className="flex justify-end pt-2">
                    <button type="submit" disabled={expSubmitting} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition flex items-center gap-1.5 disabled:opacity-50">
                      {expSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      <span>{expSubmitting ? 'Saving…' : 'Register as Proposed'}</span>
                    </button>
                  </div>
                </form>
              )}

              {experiments.length === 0 ? (
                <div className="p-8 text-center text-slate-400 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1">
                  <Target className="w-8 h-8 mx-auto text-slate-300" />
                  <p className="text-xs font-semibold">No experiments or hypotheses recorded yet.</p>
                  <p className="text-[11px] text-slate-500">Register one against an existing saved decision. No sample decision is selected automatically.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {experiments.map((experiment) => {
                    const draft = observationDrafts[experiment.id] || emptyObservationDraft();
                    const busy = actionBusy[experiment.id];
                    const allowedTargets = statusesByCurrentState[experiment.status] || [];
                    const binaryOutcome = draft.actualOutcome === 'Met Success Threshold' || draft.actualOutcome === 'Missed Baseline';
                    return (
                      <article key={experiment.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-bold text-sm text-slate-900 dark:text-white">{experiment.decision_title || `Decision #${experiment.decision_id}`}</h4>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">{experiment.status}</span>
                              {experiment.is_hypothesis && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300">Hypothesis · baseline not measured</span>}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Experiment #{experiment.id} · {experiment.observation_window_days ? experiment.observation_window_days + ' day observation window' : 'No observation window specified'} · due {experiment.target_date ? new Date(experiment.target_date).toLocaleDateString() : 'not set'}</p>
                            {experiment.supersedes_experiment_id && <p className="text-[11px] text-slate-500">Supersedes experiment #{experiment.supersedes_experiment_id}</p>}
                            <p className="text-xs text-slate-700 dark:text-slate-300">
                              Baseline: {experiment.baseline_value ?? (experiment.is_hypothesis ? 'Not measured' : 'Unavailable')} {experiment.units || ''}
                              {experiment.baseline_metric ? ' · ' + experiment.baseline_metric : ''}
                            </p>
                            <p className="text-xs text-slate-700 dark:text-slate-300">Target: {experiment.target_metric || 'Not defined'} · {experiment.measurement_direction} {experiment.threshold_value ?? 'no threshold'} {experiment.units || ''}</p>
                            {experiment.evidence_source && <p className="text-[11px] text-slate-500 dark:text-slate-400">Evidence plan: {experiment.evidence_source}</p>}
                          </div>
                          <div className="text-right text-[10px] text-slate-400 font-mono">Created {new Date(experiment.created_at).toLocaleDateString()}</div>
                        </div>

                        {allowedTargets.length > 0 && (
                          <div className="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
                            <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Lifecycle transition</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <label className="block text-[11px]">Next state
                                <select value={transitionTargets[experiment.id] || ''} onChange={(e) => setTransitionTargets((previous) => ({ ...previous, [experiment.id]: e.target.value }))} className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs">
                                  <option value="">Select allowed next state…</option>
                                  {allowedTargets.map((status) => <option key={status} value={status}>{status}</option>)}
                                </select>
                              </label>
                              <label className="block text-[11px]">Reason / review note
                                <input value={transitionNotes[experiment.id] || ''} onChange={(e) => setTransitionNotes((previous) => ({ ...previous, [experiment.id]: e.target.value }))} placeholder="Required for cancellation, inconclusive, or pivot" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs" />
                              </label>
                              {transitionTargets[experiment.id] === 'Pivoted' && (
                                <label className="block text-[11px] sm:col-span-2">Linked replacement experiment ID
                                  <input type="number" min="1" value={replacementIds[experiment.id] || ''} onChange={(e) => setReplacementIds((previous) => ({ ...previous, [experiment.id]: e.target.value }))} placeholder="Create a replacement experiment first and link it to this experiment" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs" />
                                </label>
                              )}
                            </div>
                            <button type="button" disabled={busy === 'transition'} onClick={() => void transitionExperiment(experiment)} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50">{busy === 'transition' ? 'Saving transition…' : 'Append lifecycle event'}</button>
                          </div>
                        )}

                        {['Active Experiment', 'Awaiting Data', 'Overdue'].includes(experiment.status) && (
                          <div className="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
                            <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Append measurement / outcome</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <label className="block text-[11px] sm:col-span-2">Observation
                                <textarea value={draft.observation} onChange={(e) => updateObservationDraft(experiment.id, { observation: e.target.value })} rows={2} placeholder="What was actually observed? Avoid inference when data is missing." className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs" />
                              </label>
                              <label className="block text-[11px]">Measured value (optional)
                                <input type="number" value={draft.measuredValue} onChange={(e) => updateObservationDraft(experiment.id, { measuredValue: e.target.value })} className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs" />
                              </label>
                              <label className="block text-[11px]">Evidence source
                                <input value={draft.evidenceSource} onChange={(e) => updateObservationDraft(experiment.id, { evidenceSource: e.target.value })} placeholder="Dashboard, report, or dated record" className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs" />
                              </label>
                              <label className="block text-[11px] sm:col-span-2">Outcome classification
                                <select value={draft.actualOutcome} onChange={(e) => updateObservationDraft(experiment.id, { actualOutcome: e.target.value })} className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs">
                                  <option value="">Observation only — outcome not classified</option>
                                  <option value="Met Success Threshold">Met success threshold</option>
                                  <option value="Missed Baseline">Missed baseline</option>
                                  <option value="Inconclusive">Inconclusive</option>
                                  <option value="Pivot Executed">Pivot executed</option>
                                </select>
                              </label>
                            </div>
                            {binaryOutcome && (
                              <label className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300">
                                <input type="checkbox" checked={draft.ownerConfirmed} onChange={(e) => updateObservationDraft(experiment.id, { ownerConfirmed: e.target.checked })} className="mt-0.5" />
                                <span>I checked the recorded evidence and confirm this binary outcome. This is an owner attestation, not independent provider verification.</span>
                              </label>
                            )}
                            <button type="button" disabled={busy === 'observation'} onClick={() => void recordObservation(experiment)} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50">{busy === 'observation' ? 'Saving observation…' : 'Append observation'}</button>
                          </div>
                        )}

                        {actionMessages[experiment.id] && (
                          <p role={actionMessages[experiment.id].kind === 'error' ? 'alert' : 'status'} className={'text-xs ' + (actionMessages[experiment.id].kind === 'error' ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-400')}>
                            {actionMessages[experiment.id].text}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div role="alert" className="p-4 text-xs text-rose-600">Calibration data is unavailable.</div>
      )}
    </div>
  );

  if (isEmbedded) return dashboardContent;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {dashboardContent}
      </div>
    </div>
  );
};
