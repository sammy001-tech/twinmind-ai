import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCalibrationMetrics,
  canTransitionExperiment,
  getEffectiveExperimentStatus,
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
