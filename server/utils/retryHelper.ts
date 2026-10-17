/**
 * Zero Silent Failure Policy - Bounded Retry Utility
 * Retries eligible transient failures up to maxRetries with exponential backoff and randomized jitter.
 */
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  isTransient?: (err: unknown) => boolean;
  operationName?: string;
  onAttempt?: (attempt: number) => void;
  signal?: AbortSignal;
}

export function isDefaultTransientError(err: unknown): boolean {
  const errStr = String(err).toLowerCase();
  return (
    errStr.includes('503') ||
    errStr.includes('429') ||
    errStr.includes('unavailable') ||
    errStr.includes('high demand') ||
    errStr.includes('econnreset') ||
    errStr.includes('etimedout') ||
    errStr.includes('network error') ||
    errStr.includes('fetch failed') ||
    errStr.includes('timeout')
  );
}

/**
 * Stop awaiting a provider operation when its owning request/session is cancelled.
 * If an SDK cannot cancel its underlying request, any later result is still discarded here.
 */
export function waitWithAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  operationName = 'Operation',
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    return Promise.reject(new Error(`[AbortableOperation] ${operationName} aborted before completion`));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(
      new Error(`[AbortableOperation] ${operationName} aborted before completion`),
    ));

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export async function callWithBoundedRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 6000,
    jitterMs = 200,
    isTransient = isDefaultTransientError,
    operationName = 'Operation',
    onAttempt,
    signal,
  } = options;

  let attempt = 0;
  let delay = baseDelayMs;

  while (true) {
    attempt++;
    if (signal?.aborted) {
      throw new Error(`[BoundedRetry] ${operationName} aborted before attempt ${attempt}`);
    }
    onAttempt?.(attempt);

    try {
      return await waitWithAbort(fn(attempt), signal, operationName);
    } catch (err: unknown) {
      const transient = isTransient(err);

      if (attempt < maxRetries && transient && !signal?.aborted) {
        // Exponential backoff + randomized jitter (+/- jitterMs)
        const currentJitter = Math.floor(Math.random() * (jitterMs * 2)) - jitterMs;
        const sleepMs = Math.min(maxDelayMs, Math.max(100, delay + currentJitter));

        console.warn(
          `[BoundedRetry] ${operationName} transient error (attempt ${attempt}/${maxRetries}), retrying in ${sleepMs}ms:`,
          err instanceof Error ? err.message : String(err)
        );

        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) return reject(new Error('Operation aborted during retry backoff'));
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Operation aborted during retry backoff'));
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          }, sleepMs);
          signal?.addEventListener('abort', onAbort, { once: true });
        });
        delay = Math.floor(delay * 1.5);
      } else {
        // Permanent error or exhausted retries: fail closed and rethrow
        throw err;
      }
    }
  }
}
