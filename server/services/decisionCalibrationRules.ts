export type BinaryForecastOutcome = 'Met Success Threshold' | 'Missed Baseline';

export interface PredictionForecast {
  predictionEvent: string;
  predictedProbability: number;
  predictionDeadline: string;
}

export interface PredictionForecastValidation {
  forecast: PredictionForecast | null;
  error: string | null;
}

export interface CalibrationCandidate {
  decisionId: number;
  predictionEvent: string | null;
  predictedProbability: number | string | null;
  predictionDeadline: string | Date | null;
  actualOutcome: string | null;
  outcomeVerified: boolean;
  evidenceSource: string | null;
  verifiedAt: string | Date | null;
}

export interface CalibrationBand {
  label: string;
  lowerBound: number;
  upperBound: number;
  sampleSize: number;
  sufficient: boolean;
  meanPredictedProbability: number | null;
  observedSuccessRate: number | null;
}

export interface CalibrationCalculation {
  eligibleCount: number;
  sampleSizeSufficient: boolean;
  brierScore: number | null;
  meanPredictedProbability: number | null;
  observedSuccessRate: number | null;
  meanCalibrationBias: number | null;
  successfulOutcomes: number;
  calibrationBands: CalibrationBand[];
}

export const MIN_CALIBRATION_SAMPLE_SIZE = 5;
export const BINARY_FORECAST_OUTCOMES: readonly BinaryForecastOutcome[] = [
  'Met Success Threshold',
  'Missed Baseline',
];

const EXPERIMENT_STATUSES = [
  'Proposed',
  'Active Experiment',
  'Awaiting Data',
  'Overdue',
  'Completed Review',
  'Inconclusive',
  'Pivoted',
  'Cancelled',
] as const;

export type ExperimentLifecycleStatus = typeof EXPERIMENT_STATUSES[number];

export function isExperimentLifecycleStatus(value: unknown): value is ExperimentLifecycleStatus {
  return typeof value === 'string' && (EXPERIMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Forecasts are optional, but partial forecasts are invalid. Qualitative
 * confidence and evidence-sufficiency scores are deliberately not accepted here.
 */
export function validatePredictionForecast(
  input: { predictionEvent?: unknown; predictedProbability?: unknown; predictionDeadline?: unknown },
  nowMs = Date.now(),
): PredictionForecastValidation {
  const eventInput = input.predictionEvent;
  const probabilityInput = input.predictedProbability;
  const deadlineInput = input.predictionDeadline;
  const hasAny = (
    (typeof eventInput === 'string' && eventInput.trim().length > 0)
    || (probabilityInput !== undefined && probabilityInput !== null && probabilityInput !== '')
    || (typeof deadlineInput === 'string' && deadlineInput.trim().length > 0)
  );

  if (!hasAny) return { forecast: null, error: null };
  if (typeof eventInput !== 'string' || !eventInput.trim() || eventInput.trim().length > 2000) {
    return { forecast: null, error: 'PREDICTION_EVENT_REQUIRED' };
  }
  if (typeof probabilityInput !== 'number' || !Number.isFinite(probabilityInput) || probabilityInput < 0 || probabilityInput > 1) {
    return { forecast: null, error: 'PREDICTED_PROBABILITY_MUST_BE_BETWEEN_0_AND_1' };
  }
  if (typeof deadlineInput !== 'string' || !deadlineInput.trim()) {
    return { forecast: null, error: 'PREDICTION_DEADLINE_REQUIRED' };
  }
  const deadlineMs = Date.parse(deadlineInput);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= nowMs) {
    return { forecast: null, error: 'PREDICTION_DEADLINE_MUST_BE_IN_THE_FUTURE' };
  }

  return {
    forecast: {
      predictionEvent: eventInput.trim(),
      predictedProbability: probabilityInput,
      predictionDeadline: new Date(deadlineMs).toISOString(),
    },
    error: null,
  };
}

function validDateMillis(value: string | Date | null): number | null {
  if (value === null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validProbability(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

/**
 * Only verified outcomes with evidence and an elapsed forecast window qualify.
 * Inconclusive, pivoted, cancelled, overdue, and unverified records are excluded.
 */
export function calculateCalibrationMetrics(
  rows: CalibrationCandidate[],
  nowMs = Date.now(),
): CalibrationCalculation {
  const eligible = rows.filter((row) => {
    const probability = validProbability(row.predictedProbability);
    const deadline = validDateMillis(row.predictionDeadline);
    const verifiedAt = validDateMillis(row.verifiedAt);
    return Number.isSafeInteger(row.decisionId)
      && typeof row.predictionEvent === 'string'
      && row.predictionEvent.trim().length > 0
      && probability !== null
      && deadline !== null
      && deadline <= nowMs
      && verifiedAt !== null
      && verifiedAt <= nowMs
      && row.outcomeVerified === true
      && typeof row.evidenceSource === 'string'
      && row.evidenceSource.trim().length > 0
      && BINARY_FORECAST_OUTCOMES.includes(row.actualOutcome as BinaryForecastOutcome);
  });

  const values = eligible.map((row) => ({
    probability: validProbability(row.predictedProbability) as number,
    outcome: row.actualOutcome === 'Met Success Threshold' ? 1 : 0,
  }));
  const count = values.length;
  const sufficient = count >= MIN_CALIBRATION_SAMPLE_SIZE;
  const mean = count > 0 ? values.reduce((sum, value) => sum + value.probability, 0) / count : null;
  const observed = count > 0 ? values.reduce((sum, value) => sum + value.outcome, 0) / count : null;
  const brier = count > 0
    ? values.reduce((sum, value) => sum + Math.pow(value.probability - value.outcome, 2), 0) / count
    : null;

  const calibrationBands: CalibrationBand[] = [];
  for (let index = 0; index < 5; index++) {
    const lowerBound = index / 5;
    const upperBound = (index + 1) / 5;
    const inBand = values.filter((value) =>
      value.probability >= lowerBound
      && (index === 4 ? value.probability <= upperBound : value.probability < upperBound),
    );
    calibrationBands.push({
      label: `${Math.round(lowerBound * 100)}–${Math.round(upperBound * 100)}%`,
      lowerBound,
      upperBound,
      sampleSize: inBand.length,
      sufficient: inBand.length >= MIN_CALIBRATION_SAMPLE_SIZE,
      meanPredictedProbability: inBand.length
        ? inBand.reduce((sum, value) => sum + value.probability, 0) / inBand.length
        : null,
      observedSuccessRate: inBand.length
        ? inBand.reduce((sum, value) => sum + value.outcome, 0) / inBand.length
        : null,
    });
  }

  return {
    eligibleCount: count,
    sampleSizeSufficient: sufficient,
    brierScore: brier === null ? null : Number(brier.toFixed(4)),
    meanPredictedProbability: mean === null ? null : Number(mean.toFixed(4)),
    observedSuccessRate: observed === null ? null : Number(observed.toFixed(4)),
    meanCalibrationBias: mean === null || observed === null ? null : Number((mean - observed).toFixed(4)),
    successfulOutcomes: values.filter((value) => value.outcome === 1).length,
    calibrationBands,
  };
}

function normalizeStoredStatus(status: string): string {
  return status === 'Active' ? 'Active Experiment' : status;
}

/** Overdue is derived from the elapsed target date; it is not an outcome. */
export function getEffectiveExperimentStatus(
  status: string,
  targetDate: string | Date | null,
  nowMs = Date.now(),
): ExperimentLifecycleStatus | null {
  const normalized = normalizeStoredStatus(status);
  if (!(EXPERIMENT_STATUSES as readonly string[]).includes(normalized)) return null;

  if (normalized === 'Active Experiment' || normalized === 'Awaiting Data') {
    const deadline = validDateMillis(targetDate);
    if (deadline !== null && deadline < nowMs) return 'Overdue';
  }
  return normalized as ExperimentLifecycleStatus;
}

const ALLOWED_EXPERIMENT_TRANSITIONS: Record<ExperimentLifecycleStatus, ExperimentLifecycleStatus[]> = {
  Proposed: ['Active Experiment', 'Cancelled'],
  'Active Experiment': ['Awaiting Data', 'Completed Review', 'Inconclusive', 'Pivoted', 'Cancelled'],
  'Awaiting Data': ['Completed Review', 'Inconclusive', 'Pivoted', 'Cancelled'],
  Overdue: ['Completed Review', 'Inconclusive', 'Pivoted', 'Cancelled'],
  'Completed Review': [],
  Inconclusive: [],
  Pivoted: [],
  Cancelled: [],
};

export function canTransitionExperiment(
  fromStatus: ExperimentLifecycleStatus,
  toStatus: ExperimentLifecycleStatus,
): boolean {
  return ALLOWED_EXPERIMENT_TRANSITIONS[fromStatus].includes(toStatus);
}

export function transitionRequiresReplacement(status: ExperimentLifecycleStatus): boolean {
  return status === 'Pivoted';
}
