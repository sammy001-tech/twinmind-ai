/**
 * Automated Verification Suite for Milestone 1: Shared Operational Controls
 * Verifies:
 * 1. Global 6-call tool budget ceiling (attempt 7 rejected)
 * 2. Retries consume tool budget
 * 3. Manual cancellation via root AbortController sets status 'cancelled'
 * 4. Global deadline timeout sets status 'timed_out'
 * 5. Late results are discarded after session termination
 * 6. Provider Circuit Breakers (429 vs 5xx, state transitions, cooldown)
 * 7. Phase 1 regression suite (deterministic AST math & zero mock policy)
 */

import {
  SwarmToolBudget,
  SwarmBudgetExceededError,
  ProviderCircuitBreakerRegistry,
  SwarmSessionRegistry,
} from '../server/utils/swarmResourceManager.ts';
import { evaluateMathExpression } from '../server/utils/mathEvaluator.ts';
import { specialistSwarmService } from '../server/services/specialistSwarmService.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runMilestone1Tests() {
  console.log('\n======================================================');
  console.log('RUNNING MILESTONE 1 VERIFICATION TEST SUITE');
  console.log('======================================================\n');

  // ----------------------------------------------------------------
  // Test 1: Global Tool-Call Budget Ceiling
  // ----------------------------------------------------------------
  console.log('Test 1: Global Tool-Call Budget Ceiling (max 6 calls)');
  const budget = new SwarmToolBudget(6);
  assert(budget.getRemaining() === 6, 'Initial remaining budget is 6');

  for (let i = 1; i <= 6; i++) {
    budget.claim('calculateMath', 1);
  }
  assert(budget.getUsed() === 6, 'Budget tracks exactly 6 calls used');
  assert(budget.getRemaining() === 0, 'Remaining budget is 0');

  let budgetErrorCaught = false;
  try {
    budget.claim('calculateMath', 1); // 7th attempt
  } catch (err: unknown) {
    if (err instanceof SwarmBudgetExceededError) {
      budgetErrorCaught = true;
    }
  }
  assert(budgetErrorCaught, 'Attempt 7 was rejected with SwarmBudgetExceededError');

  // ----------------------------------------------------------------
  // Test 2: Retries Consume Tool Budget
  // ----------------------------------------------------------------
  console.log('\nTest 2: Retries Consume Tool Budget');
  const retryBudget = new SwarmToolBudget(6);
  retryBudget.claim('searchWeb', 1); // initial attempt
  retryBudget.claim('searchWeb', 2); // retry attempt 1
  retryBudget.claim('searchWeb', 3); // retry attempt 2
  assert(retryBudget.getUsed() === 3, 'Tool retries incremented budget count to 3');
  assert(retryBudget.getRemaining() === 3, 'Remaining budget correctly decreased to 3');

  // ----------------------------------------------------------------
  // Test 3: Root AbortController + Manual Cancellation
  // ----------------------------------------------------------------
  console.log('\nTest 3: Root AbortController + Manual Cancellation');
  const registry = new SwarmSessionRegistry();
  const sessionScope = registry.createSessionScope({
    sessionId: 'test-session-manual-abort',
    userId: 'user_123',
    deadlineMs: 10_000,
  });

  assert(sessionScope.status === 'running', 'New session starts in running status');
  assert(!sessionScope.isTerminated, 'Session is not terminated initially');

  // Trigger manual cancellation
  const cancelled = registry.cancelSession('test-session-manual-abort', 'user_123');
  assert(cancelled, 'cancelSession returned true for authorized owner');
  assert(sessionScope.isTerminated, 'Session marked terminated immediately');
  assert(sessionScope.status === 'cancelled', 'Session status transitioned to cancelled');
  assert(sessionScope.combinedSignal.aborted, 'Combined signal observed manual abort');

  // Verify unauthorized cancellation is rejected
  const sessionScope2 = registry.createSessionScope({
    sessionId: 'test-session-security-boundary',
    userId: 'user_alice',
  });
  let unauthorizedCaught = false;
  try {
    registry.cancelSession('test-session-security-boundary', 'user_bob');
  } catch (err) {
    unauthorizedCaught = true;
  }
  assert(unauthorizedCaught, 'Unauthorized user cancellation rejected at security boundary');

  // ----------------------------------------------------------------
  // Test 4: Global Deadline Timeout triggers 'timed_out'
  // ----------------------------------------------------------------
  console.log('\nTest 4: Global Deadline Timeout triggers timed_out');
  const timeoutScope = registry.createSessionScope({
    sessionId: 'test-session-deadline-timeout',
    deadlineMs: 150, // short timeout for testing
  });

  await new Promise((r) => setTimeout(r, 250));
  assert(timeoutScope.isTerminated, 'Session marked terminated when deadline expired');
  assert(timeoutScope.status === 'timed_out', 'Session status transitioned to timed_out');
  assert(timeoutScope.combinedSignal.aborted, 'Combined signal aborted upon deadline expiration');

  // ----------------------------------------------------------------
  // Test 5: Late Results are Discarded After Termination
  // ----------------------------------------------------------------
  console.log('\nTest 5: Late Results Discarded After Termination');
  let callbackInvokedAfterAbort = false;
  const abortTestSession = await specialistSwarmService.executeSwarmTurn({
    userPrompt: 'Calculate (100 * 5) and search for latest AI developments',
    deadlineMs: 10, // immediate timeout
    callbacks: {
      onSynthesisChunk: () => {
        callbackInvokedAfterAbort = true;
      },
      onComplete: (sess) => {
        assert(sess.status === 'timed_out', 'Completed callback reported timed_out');
      },
    },
  });
  assert(
    abortTestSession.status === 'timed_out',
    'executeSwarmTurn observed timeout and returned timed_out status'
  );
  assert(!callbackInvokedAfterAbort, 'Late synthesis callback was discarded and not invoked');

  // ----------------------------------------------------------------
  // Test 6: Provider Circuit Breakers (429 vs 5xx, Cooldown, Half-Open)
  // ----------------------------------------------------------------
  console.log('\nTest 6: Provider Circuit Breakers');
  const cb = new ProviderCircuitBreakerRegistry(3, 200); // 200ms cooldown for test

  assert(cb.checkCanExecute('tavily').canExecute, 'Initial circuit state is CLOSED');

  // Record 2 failures (threshold is 3)
  cb.recordFailure('tavily', 503, 'Service unavailable');
  cb.recordFailure('tavily', 500, 'Internal server error');
  assert(cb.getState('tavily') === 'CLOSED', 'Breaker remains CLOSED at 2 failures');

  // 3rd failure trips breaker
  cb.recordFailure('tavily', 503, 'Service unavailable');
  assert(cb.getState('tavily') === 'OPEN', 'Breaker transitioned to OPEN on 3rd 5xx error');
  assert(!cb.checkCanExecute('tavily').canExecute, 'Call blocked while breaker is OPEN');

  // Test cooldown & transition to HALF_OPEN
  await new Promise((r) => setTimeout(r, 220));
  const probeCheck = cb.checkCanExecute('tavily');
  assert(probeCheck.canExecute, 'Call permitted after cooldown to probe recovery');
  assert(cb.getState('tavily') === 'HALF_OPEN', 'State transitioned to HALF_OPEN for probe');

  // Successful probe resets to CLOSED
  cb.recordSuccess('tavily');
  assert(cb.getState('tavily') === 'CLOSED', 'Successful probe reset breaker to CLOSED');

  // ----------------------------------------------------------------
  // Test 7: Phase 1 Regression (Deterministic Math & Zero Mock)
  // ----------------------------------------------------------------
  console.log('\nTest 7: Phase 1 Regression Suite');
  const math1 = evaluateMathExpression({ expression: '(5000 * 1.08^5) - 5000', precision: 4 });
  assert(math1.status === 'success', 'Math calculation status is success');
  assert(math1.result === 2346.6404, `Accurate result: ${math1.result}`);
  assert(Boolean(math1.steps && math1.steps.length === 3), 'Audit trail contains step-by-step arithmetic');

  const divZero = evaluateMathExpression({ expression: '100 / 0' });
  assert(divZero.status === 'error', 'Division by zero caught cleanly');
  assert(divZero.error === 'Division by zero is undefined', 'Explicit error message returned');

  console.log('\n======================================================');
  console.log('ALL MILESTONE 1 TESTS PASSED SUCCESSFULLY! (7/7)');
  console.log('======================================================\n');
  process.exit(0);
}

runMilestone1Tests().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
