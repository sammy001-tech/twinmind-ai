import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePullDistance,
  isPullThresholdMet,
  canStartPull,
  buildCacheBustReloadUrl,
} from '../src/utils/pullToRefreshLogic.ts';

test('calculatePullDistance returns 0 for zero, negative, or invalid deltaY', () => {
  assert.equal(calculatePullDistance(0), 0);
  assert.equal(calculatePullDistance(-20), 0);
  assert.equal(calculatePullDistance(NaN), 0);
  assert.equal(calculatePullDistance(-Infinity), 0);
});

test('calculatePullDistance dampens positive pulls and respects maxPullDistance', () => {
  const smallPull = calculatePullDistance(10);
  const mediumPull = calculatePullDistance(50);
  const largePull = calculatePullDistance(150);
  const hugePull = calculatePullDistance(800, 95);

  assert.ok(smallPull > 0, 'small pull should be positive');
  assert.ok(mediumPull > smallPull, 'medium pull should exceed small pull');
  assert.ok(largePull > mediumPull, 'large pull should exceed medium pull');
  assert.equal(hugePull, 95, 'pull should clamp to maxPullDistance');
});

test('isPullThresholdMet validates when threshold is reached or exceeded', () => {
  assert.equal(isPullThresholdMet(40, 60), false);
  assert.equal(isPullThresholdMet(59.9, 60), false);
  assert.equal(isPullThresholdMet(60, 60), true);
  assert.equal(isPullThresholdMet(85, 60), true);
  assert.equal(isPullThresholdMet(NaN, 60), false);
});

test('canStartPull permits gesture only at top of scroll container (scrollTop <= 0)', () => {
  assert.equal(canStartPull(0), true);
  assert.equal(canStartPull(-5), true); // elastic overscroll
  assert.equal(canStartPull(1), false);
  assert.equal(canStartPull(150), false);
  assert.equal(canStartPull(NaN), false);
});

test('buildCacheBustReloadUrl appends fresh _v parameter to absolute and relative URLs', () => {
  const fixedTime = 1773400000000;
  
  // Relative URL
  const rel = buildCacheBustReloadUrl('/chat', fixedTime);
  assert.equal(rel, '/chat?_v=1773400000000');

  // Relative with existing parameters
  const relWithParams = buildCacheBustReloadUrl('/chat?mode=dark#section', fixedTime);
  assert.equal(relWithParams, '/chat?mode=dark&_v=1773400000000#section');

  // Absolute URL
  const abs = buildCacheBustReloadUrl('https://example.com/app?thread=123', fixedTime);
  assert.equal(abs, 'https://example.com/app?thread=123&_v=1773400000000');

  // Overwriting existing _v parameter
  const updated = buildCacheBustReloadUrl('https://example.com/app?_v=999', fixedTime);
  assert.equal(updated, 'https://example.com/app?_v=1773400000000');
});
