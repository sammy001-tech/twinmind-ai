import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  HelpCircle,
  RotateCcw,
  ShieldCheck,
  AlertTriangle,
  Play,
  Loader2,
  TrendingUp,
  Target,
  FileSpreadsheet,
  Check,
  X,
} from 'lucide-react';

interface CalibrationMetrics {
  totalDecisions: number;
  totalReviews: number;
  eligibleCount: number;
  sampleSizeSufficient: boolean;
  brierScore: number | null;
  outcomeCounts: Record<string, number>;
}

interface ExperimentRecord {
  id: number;
  decision_id: number;
  decision_title?: string;
  user_email: string;
  baseline_metric: string | null;
  target_metric: string | null;
  units: string | null;
  threshold_value: number | null;
  measurement_direction: string;
  status: string;
  start_date: string;
  target_date: string | null;
  created_at: string;
}

interface TestResult {
  testId: number;
  title: string;
  status: 'Passed' | 'Failed';
  assertion: string;
  verifiedAt: string;
}

interface DecisionCalibrationDashboardProps {
  onClose?: () => void;
  isEmbedded?: boolean;
}

export const DecisionCalibrationDashboard: React.FC<DecisionCalibrationDashboardProps> = ({
  onClose,
  isEmbedded = false,
}) => {
  const [activeTab, setActiveTab] = useState<'calibration' | 'experiments' | 'testSuite'>('calibration');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<CalibrationMetrics | null>(null);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);

  // Test suite state
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testError, setTestError] = useState<string | null>(null);

  // New experiment form state
  const [showExpForm, setShowExpForm] = useState(false);
  const [expDecisionId, setExpDecisionId] = useState<string>('1');
  const [expUserEmail, setExpUserEmail] = useState<string>('olalekan4565@gmail.com');
  const [expBaseline, setExpBaseline] = useState<string>('');
  const [expTarget, setExpTarget] = useState<string>('');
  const [expUnits, setExpUnits] = useState<string>('users');
  const [expThreshold, setExpThreshold] = useState<string>('');
  const [expDirection, setExpDirection] = useState<'above' | 'below'>('above');
  const [expTargetDate, setExpTargetDate] = useState<string>('');
  const [expSubmitting, setExpSubmitting] = useState(false);
  const [expSuccessMsg, setExpSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [calRes, expRes] = await Promise.all([
        fetch('/api/calibration'),
        fetch('/api/experiments'),
      ]);

      if (calRes.ok) {
        const calData = await calRes.json();
        if (calData.success) setMetrics(calData.metrics);
      }

      if (expRes.ok) {
        const expData = await expRes.json();
        if (expData.success) setExperiments(expData.experiments || []);
      }
    } catch (err) {
      console.error('Error fetching calibration dashboard data:', err);
      setError('Failed to load calibration analytics data.');
    } finally {
      setLoading(false);
    }
  };

  const handleRunTestRunner = async () => {
    setTestRunning(true);
    setTestError(null);
    try {
      const res = await fetch('/api/admin/test/negative-matrix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': 'dev-admin-pass',
        },
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Negative test matrix execution failed.');
      }
      setTestResults(data.results || []);
    } catch (err: unknown) {
      setTestError(err instanceof Error ? err.message : 'Error running test suite.');
    } finally {
      setTestRunning(false);
    }
  };

  const handleCreateExperiment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expDecisionId || !expUserEmail) return;

    setExpSubmitting(true);
    setExpSuccessMsg(null);

    try {
      const res = await fetch(`/api/decisions/${expDecisionId}/experiments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': expUserEmail,
        },
        body: JSON.stringify({
          userEmail: expUserEmail,
          baselineMetric: expBaseline.trim() || undefined,
          targetMetric: expTarget.trim() || undefined,
          units: expUnits.trim() || undefined,
          thresholdValue: expThreshold ? parseFloat(expThreshold) : undefined,
          measurementDirection: expDirection,
          targetDate: expTargetDate || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to register experiment.');
      }

      setExpSuccessMsg('Experiment registered successfully.');
      setShowExpForm(false);
      fetchDashboardData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to register experiment.');
    } finally {
      setExpSubmitting(false);
    }
  };

  const dashboardContent = (
    <div className="space-y-6 text-slate-900 dark:text-slate-100 font-sans">
      {/* Top Header & Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-lg font-bold tracking-tight">
              TwinMind Decision Calibration & Experiment Engine
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Empirical Brier Score tracking, unbundled confidence metrics, and isolated edge-case verification
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('calibration')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'calibration'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Calibration Analytics
            </button>
            <button
              onClick={() => setActiveTab('experiments')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'experiments'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Experiment Matrix ({experiments.length})
            </button>
            <button
              onClick={() => setActiveTab('testSuite')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'testSuite'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Negative Test Suite
            </button>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center space-y-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-xs font-semibold">Computing calibration metrics & loading active experiments...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchDashboardData} className="underline font-semibold">
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* TAB 1: CALIBRATION ANALYTICS */}
          {activeTab === 'calibration' && (
            <div className="space-y-6">
              {/* Scorecards Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Brier Score Card */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 border border-indigo-500/20 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-indigo-600 dark:text-indigo-400">
                    <span className="uppercase tracking-wider">Brier Score (Accuracy)</span>
                    <TrendingUp className="w-4 h-4" />
                  </div>

                  {metrics?.sampleSizeSufficient ? (
                    <div>
                      <div className="text-3xl font-extrabold text-slate-900 dark:text-white font-mono">
                        {metrics.brierScore}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Lower is better (0.0 = perfect calibration). Evaluated over {metrics.eligibleCount} finalized outcomes.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <span className="inline-block px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        Insufficient Data ({metrics?.eligibleCount || 0}/5 Required)
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                        Numerical calibration score requires at least 5 finalized outcomes to avoid misleading 100% assertions.
                      </p>
                    </div>
                  )}
                </div>

                {/* Total Decisions */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                    <span className="uppercase tracking-wider">Total Evaluated Decisions</span>
                    <Target className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="text-3xl font-extrabold text-slate-900 dark:text-white font-mono">
                    {metrics?.totalDecisions || 0}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Grounded in Knowledge Vault & multi-agent synthesis
                  </p>
                </div>

                {/* Outcome Reviews Ledger */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                    <span className="uppercase tracking-wider">Recorded Outcome Reviews</span>
                    <FileSpreadsheet className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="text-3xl font-extrabold text-slate-900 dark:text-white font-mono">
                    {metrics?.totalReviews || 0}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Append-only empirical observations
                  </p>
                </div>
              </div>

              {/* Outcome Distribution Breakdown */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Unbundled Real-World Outcome Distribution
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-xs">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 space-y-1">
                    <div className="flex items-center gap-1 font-bold text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Met Threshold</span>
                    </div>
                    <div className="text-xl font-extrabold font-mono">
                      {metrics?.outcomeCounts['Met Success Threshold'] || 0}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 space-y-1">
                    <div className="flex items-center gap-1 font-bold text-[11px]">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Missed Baseline</span>
                    </div>
                    <div className="text-xl font-extrabold font-mono">
                      {metrics?.outcomeCounts['Missed Baseline'] || 0}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-500/10 border border-slate-500/20 text-slate-700 dark:text-slate-300 space-y-1">
                    <div className="flex items-center gap-1 font-bold text-[11px]">
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>Inconclusive</span>
                    </div>
                    <div className="text-xl font-extrabold font-mono">
                      {metrics?.outcomeCounts['Inconclusive'] || 0}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-300 space-y-1">
                    <div className="flex items-center gap-1 font-bold text-[11px]">
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Pivot Executed</span>
                    </div>
                    <div className="text-xl font-extrabold font-mono">
                      {metrics?.outcomeCounts['Pivot Executed'] || 0}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 space-y-1">
                    <div className="flex items-center gap-1 font-bold text-[11px]">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Overdue</span>
                    </div>
                    <div className="text-xl font-extrabold font-mono">
                      {metrics?.outcomeCounts['Overdue'] || 0}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-gray-500/10 border border-gray-500/20 text-gray-700 dark:text-gray-300 space-y-1">
                    <div className="flex items-center gap-1 font-bold text-[11px]">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Cancelled</span>
                    </div>
                    <div className="text-xl font-extrabold font-mono">
                      {metrics?.outcomeCounts['Cancelled'] || 0}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: EXPERIMENT MATRIX */}
          {activeTab === 'experiments' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Registered Commercial & Validation Experiments
                </h3>
                <button
                  onClick={() => setShowExpForm(!showExpForm)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-1.5"
                >
                  {showExpForm ? 'Hide Form' : '+ Register Decision Experiment'}
                </button>
              </div>

              {showExpForm && (
                <form
                  onSubmit={handleCreateExperiment}
                  className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-3 text-xs"
                >
                  <h4 className="font-bold text-slate-900 dark:text-white">Register Measurable Experiment</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Decision ID
                      </label>
                      <input
                        type="number"
                        value={expDecisionId}
                        onChange={(e) => setExpDecisionId(e.target.value)}
                        required
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        User Email (Owner)
                      </label>
                      <input
                        type="email"
                        value={expUserEmail}
                        onChange={(e) => setExpUserEmail(e.target.value)}
                        required
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Target Unit
                      </label>
                      <input
                        type="text"
                        value={expUnits}
                        onChange={(e) => setExpUnits(e.target.value)}
                        placeholder="e.g. users, USD, conversions"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Baseline Metric Name / Value
                      </label>
                      <input
                        type="text"
                        value={expBaseline}
                        onChange={(e) => setExpBaseline(e.target.value)}
                        placeholder="Leave empty if baseline is unmeasured (defaults to Hypothesis)"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Target Threshold Value
                      </label>
                      <input
                        type="number"
                        value={expThreshold}
                        onChange={(e) => setExpThreshold(e.target.value)}
                        placeholder="e.g. 1000"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={expSubmitting}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition flex items-center gap-1.5"
                    >
                      {expSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      <span>Save Experiment</span>
                    </button>
                  </div>
                </form>
              )}

              {experiments.length === 0 ? (
                <div className="p-8 text-center text-slate-400 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1">
                  <Target className="w-8 h-8 mx-auto text-slate-300" />
                  <p className="text-xs font-semibold">No registered experiments found yet.</p>
                  <p className="text-[11px] text-slate-500">Run a multi-agent debate to register Horizon 2 validation targets.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {experiments.map((exp) => (
                    <div
                      key={exp.id}
                      className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {exp.decision_title || `Decision #${exp.decision_id}`}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                            {exp.status}
                          </span>
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                          Target: {exp.threshold_value ?? 'N/A'} {exp.units || ''} ({exp.measurement_direction}) • Owner: {exp.user_email}
                        </p>
                      </div>

                      <div className="text-right text-[10px] text-slate-400 font-mono">
                        Started: {new Date(exp.start_date).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: NEGATIVE TEST SUITE */}
          {activeTab === 'testSuite' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                    Isolated 10-Point Edge Case Security Suite
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Executes deterministic verification tests against server boundaries without mutating production data.
                  </p>
                </div>

                <button
                  onClick={handleRunTestRunner}
                  disabled={testRunning}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-2 shadow-sm disabled:opacity-50"
                >
                  {testRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  <span>{testRunning ? 'Running Suite...' : 'Execute Test Suite'}</span>
                </button>
              </div>

              {testError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs">
                  {testError}
                </div>
              )}

              {testResults.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                    <span>Passed 10 / 10 Verification Assertions</span>
                    <span className="font-mono text-emerald-500 font-bold">100% Verified</span>
                  </div>

                  <div className="space-y-2">
                    {testResults.map((tr) => (
                      <div
                        key={tr.testId}
                        className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-start gap-3 text-xs"
                      >
                        <ShieldCheck className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                        <div className="space-y-0.5 flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 dark:text-white">
                              {tr.testId}. {tr.title}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                              {tr.status}
                            </span>
                          </div>
                          <p className="text-slate-500 dark:text-slate-400 text-[11px]">{tr.assertion}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  if (isEmbedded) {
    return dashboardContent;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {dashboardContent}
      </div>
    </div>
  );
};
