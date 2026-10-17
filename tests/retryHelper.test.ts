import assert from 'node:assert/strict';
import test from 'node:test';

import { callWithBoundedRetry, waitWithAbort } from '../server/utils/retryHelper.ts';

test('bounded retry rejects before starting work when the request signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let attempts = 0;

  await assert.rejects(
    callWithBoundedRetry(async () => {
      attempts += 1;
      return 'unreachable';
    }, { signal: controller.signal }),
    /aborted before attempt/,
  );
  assert.equal(attempts, 0);
});

test('waitWithAbort rejects on cancellation and discards a later operation result', async () => {
  const controller = new AbortController();
  let resolveOperation!: (value: string) => void;
  const operation = new Promise<string>((resolve) => {
    resolveOperation = resolve;
  });

  const pending = waitWithAbort(operation, controller.signal, 'research planning');
  controller.abort();

  await assert.rejects(pending, /research planning aborted/);
  resolveOperation('late provider result');
});

test('waitWithAbort preserves a result when the signal remains active', async () => {
  const controller = new AbortController();
  assert.equal(
    await waitWithAbort(Promise.resolve('provider response'), controller.signal, 'unit operation'),
    'provider response',
  );
});
