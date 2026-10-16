import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCalibrationMetrics,
  canTransitionExperiment,
  getEffectiveExperimentStatus,
  isExperimentLifecycleStatus,
  transitionRequiresReplacement,
  validatePredictionForecast,
} from '../server/services/decisionCalibrationRules.ts';

const fixedNow = Date.parse('2026-10-16T12:00:00.000Z');

test('forecast definition requires event, explicit probability, and future deadline together', () => {
  assert.deepEqual(validatePredictionForecast({}, fixedNow), { forecast: null, error: null });
  assert.equal(
    validatePredictionForecast({ predictionEvent: 'Target reached', predictedProbability: 0.7 }, fixedNow).error,
    'PREDICTION_DEADLINE_REQUIRED',
  );
  assert.equal(
    validatePredictionForecast({
      predictionEvent: 'Target reached',
      predictedProbability: 71,
      predictionDeadline: '2026-12-01T00:00:00.000Z',
    }, fixedNow).error,
    'PREDICTED_PROBABILITY_MUST_BE_BETWEEN_0_AND_1',
  );
  assert.equal(
    validatePredictionForecast({
      predictionEvent: 'Target reached',
      predictedProbability: 0.7,
      predictionDeadline: '2026-10-15T00:00:00.000Z',
    }, fixedNow).error,
    'PREDICTION_DEADLINE_MUST_BE_IN_THE_FUTURE',
  );
});

test('Brier score uses explicit verified probabilities, not general confidence scores', () => {
  const rows = [
    { decisionId: 1, predictionEvent: 'Event 1', predictedProbability: 0.8, predictionDeadline: '2026-10-01T00:00:00.000Z', actualOutcome: 'Met Success Threshold', outcomeVerified: true, evidenceSource: 'Metrics review', verifiedAt: '2026-10-02T00:00:00.000Z' },
    { decisionId: 2, predictionEvent: 'Event 2', predictedProbability: 0.2, predictionDeadline: '2026-10-01T00:00:00.000Z', actualOutcome: 'Missed Baseline', outcomeVerified: true, evidenceSource: 'Metrics review', verifiedAt: '2026-10-02T00:00:00.000Z' },
  ];
  const metrics = calculateCalibrationMetrics(rows, fixedNow);
  assert.equal(metrics.eligibleCount, 2);
  assert.equal(metrics.brierScore, 0.04);
  assert.equal(metrics.successfulOutcomes, 1);
  assert.equal(metrics.sampleSizeSufficient, false);
  assert.ok(metrics.calibrationBands.every((band) => !band.sufficient));
});

test('excludes inconclusive, unverified, evidence-free, future-dated, and invalid probability rows', () => {
  const valid = { decisionId: 1, predictionEvent: 'A defined event', predictedProbability: 0.65, predictionDeadline: '2026-10-01T00:00:00.000Z', actualOutcome: 'Met Success Threshold', outcomeVerified: true, evidenceSource: 'Observed dashboard', verifiedAt: '2026-10-02T00:00:00.000Z' };
  const rows = [
    valid,
    { ...valid, decisionId: 2, actualOutcome: 'Inconclusive' },
    { ...valid, decisionId: 3, outcomeVerified: false },
    { ...valid, decisionId: 4, evidenceSource: '' },
    { ...valid, decisionId: 5, predictionDeadline: '2026-12-01T00:00:00.000Z' },
    { ...valid, decisionId: 6, predictedProbability: 80 },
  ];
  assert.equal(calculateCalibrationMetrics(rows, fixedNow).eligibleCount, 1);
});

test('overdue is derived from a deadline and is not an automatically failed outcome', () => {
  assert.equal(getEffectiveExperimentStatus('Awaiting Data', '2026-10-15T00:00:00.000Z', fixedNow), 'Overdue');
  assert.equal(getEffectiveExperimentStatus('Awaiting Data', '2026-10-18T00:00:00.000Z', fixedNow), 'Awaiting Data');
  assert.equal(canTransitionExperiment('Overdue', 'Inconclusive'), true);
  assert.equal(canTransitionExperiment('Completed Review', 'Active Experiment'), false);
});


function validCandidate(
  decisionId: number,
  predictedProbability: number,
  actualOutcome: 'Met Success Threshold' | 'Missed Baseline' = 'Met Success Threshold',
) {
  return {
    decisionId,
    predictionEvent: `Deterministic forecast fixture ${decisionId}`,
    predictedProbability,
    predictionDeadline: '2026-10-01T00:00:00.000Z',
    actualOutcome,
    outcomeVerified: true,
    evidenceSource: 'Deterministic unit-test evidence fixture',
    verifiedAt: '2026-10-02T00:00:00.000Z',
  };
}

test('accepts exact zero and one probabilities when all forecast fields are valid', () => {
  for (const predictedProbability of [0, 1]) {
    const result = validatePredictionForecast({
      predictionEvent: 'A fully specified binary event',
      predictedProbability,
      predictionDeadline: '2026-12-01T00:00:00.000Z',
    }, fixedNow);
    assert.equal(result.error, null);
    assert.equal(result.forecast?.predictedProbability, predictedProbability);
  }
});

test('rejects probability values that are not finite numbers inside the closed unit interval', () => {
  for (const predictedProbability of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, '0.7']) {
    const result = validatePredictionForecast({
      predictionEvent: 'A fully specified binary event',
      predictedProbability,
      predictionDeadline: '2026-12-01T00:00:00.000Z',
    }, fixedNow);
    assert.equal(result.error, 'PREDICTED_PROBABILITY_MUST_BE_BETWEEN_0_AND_1');
  }
});

test('requires a non-empty event and a parseable future deadline', () => {
  assert.equal(
    validatePredictionForecast({
      predictionEvent: '   ',
      predictedProbability: 0.7,
      predictionDeadline: '2026-12-01T00:00:00.000Z',
    }, fixedNow).error,
    'PREDICTION_EVENT_REQUIRED',
  );
  assert.equal(
    validatePredictionForecast({
      predictionEvent: 'A future event',
      predictedProbability: 0.7,
      predictionDeadline: 'not-a-date',
    }, fixedNow).error,
    'PREDICTION_DEADLINE_MUST_BE_IN_THE_FUTURE',
  );
});

test('marks exactly five eligible outcomes sufficient and four insufficient', () => {
  const four = [1, 2, 3, 4].map((id) => validCandidate(id, 0.8));
  const five = [...four, validCandidate(5, 0.8)];
  assert.equal(calculateCalibrationMetrics(four, fixedNow).sampleSizeSufficient, false);
  const result = calculateCalibrationMetrics(five, fixedNow);
  assert.equal(result.eligibleCount, 5);
  assert.equal(result.sampleSizeSufficient, true);
  assert.equal(result.brierScore, 0.04);
});

test('places probability boundaries in the first and last calibration bands', () => {
  const result = calculateCalibrationMetrics([
    validCandidate(1, 0, 'Missed Baseline'),
    validCandidate(2, 1, 'Met Success Threshold'),
  ], fixedNow);
  assert.equal(result.calibrationBands[0].label, '0–20%');
  assert.equal(result.calibrationBands[0].sampleSize, 1);
  assert.equal(result.calibrationBands[4].label, '80–100%');
  assert.equal(result.calibrationBands[4].sampleSize, 1);
});

test('does not compute a Brier score when no forecasts meet eligibility criteria', () => {
  const result = calculateCalibrationMetrics([], fixedNow);
  assert.equal(result.eligibleCount, 0);
  assert.equal(result.brierScore, null);
  assert.equal(result.meanPredictedProbability, null);
  assert.equal(result.observedSuccessRate, null);
  assert.equal(result.sampleSizeSufficient, false);
});

test('keeps inconclusive, pivoted, cancelled, and pending outcomes outside binary calibration', () => {
  const valid = validCandidate(1, 0.7);
  const rows = [
    valid,
    { ...valid, decisionId: 2, actualOutcome: 'Inconclusive' },
    { ...valid, decisionId: 3, actualOutcome: 'Pivot Executed' },
    { ...valid, decisionId: 4, actualOutcome: 'Cancelled' },
    { ...valid, decisionId: 5, actualOutcome: 'Pending Verification' },
  ];
  const result = calculateCalibrationMetrics(rows, fixedNow);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.brierScore, 0.09);
});

test('accepts only declared lifecycle statuses and protects terminal states', () => {
  for (const status of ['Proposed', 'Active Experiment', 'Awaiting Data', 'Overdue', 'Completed Review', 'Inconclusive', 'Pivoted', 'Cancelled']) {
    assert.equal(isExperimentLifecycleStatus(status), true);
  }
  for (const status of ['Active', 'Success', 'Completed', 'Pending', null]) {
    assert.equal(isExperimentLifecycleStatus(status), false);
  }
  assert.equal(canTransitionExperiment('Proposed', 'Active Experiment'), true);
  assert.equal(canTransitionExperiment('Proposed', 'Completed Review'), false);
  assert.equal(canTransitionExperiment('Active Experiment', 'Awaiting Data'), true);
  assert.equal(canTransitionExperiment('Awaiting Data', 'Active Experiment'), false);
  assert.equal(canTransitionExperiment('Cancelled', 'Active Experiment'), false);
  assert.equal(transitionRequiresReplacement('Pivoted'), true);
  assert.equal(transitionRequiresReplacement('Inconclusive'), false);
});
