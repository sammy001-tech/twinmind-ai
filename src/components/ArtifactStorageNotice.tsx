import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

type StorageMode = 'instance-local' | 'configured-path' | 'misconfigured';

interface ArtifactStorageStatus {
  mode: StorageMode;
  configured: boolean;
  canGenerate: boolean;
  warning: string;
}

type RequestState =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; storage: ArtifactStorageStatus };

function parseStorageStatus(value: unknown): ArtifactStorageStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    (payload.mode !== 'instance-local' && payload.mode !== 'configured-path' && payload.mode !== 'misconfigured')
    || typeof payload.configured !== 'boolean'
    || typeof payload.canGenerate !== 'boolean'
    || typeof payload.warning !== 'string'
    || !payload.warning.trim()
  ) {
    return null;
  }
  return {
    mode: payload.mode,
    configured: payload.configured,
    canGenerate: payload.canGenerate,
    warning: payload.warning,
  };
}

export const ArtifactStorageNotice: React.FC = () => {
  const [state, setState] = useState<RequestState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    const loadStatus = async () => {
      try {
        const response = await fetch('/api/artifacts/storage-status', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        const record = payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : null;
        const storage = parseStorageStatus(payload);

        if (!response.ok || record?.success !== true || !storage) {
          const serverMessage = typeof record?.error === 'string' && record.error.trim()
            ? record.error
            : 'The server did not return a valid artifact storage status (HTTP ' + response.status + ').';
          throw new Error(serverMessage);
        }

        if (!controller.signal.aborted) setState({ status: 'ready', storage });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setState({
          status: 'unavailable',
          message: error instanceof Error ? error.message : 'Artifact storage status could not be confirmed.',
        });
      }
    };

    void loadStatus();
    return () => controller.abort();
  }, []);

  if (state.status === 'loading') return null;

  const mode = state.status === 'ready' ? state.storage.mode : 'misconfigured';
  const isInstanceLocal = mode === 'instance-local';
  const isMisconfigured = state.status === 'unavailable' || mode === 'misconfigured';
  const statusMessage = state.status === 'ready'
    ? state.storage.warning
    : state.message;

  return (
    <div
      role={isInstanceLocal || isMisconfigured ? 'alert' : 'status'}
      className={
        'mx-3 mb-2 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed sm:mx-4 ' +
        (isMisconfigured
          ? 'border-red-500/30 bg-red-500/5 text-red-800 dark:text-red-300'
          : isInstanceLocal
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300'
            : 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300')
      }
    >
      {state.status === 'ready' && state.storage.mode === 'configured-path'
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0">
        <p className="font-semibold">
          {state.status === 'unavailable'
            ? 'Artifact storage status unavailable'
            : isMisconfigured
              ? 'Artifact storage configuration needs attention'
              : isInstanceLocal
                ? 'Generated files may not survive restarts'
                : 'Artifact storage path configured'}
        </p>
        <p className="mt-0.5 break-words">{statusMessage}</p>
      </div>
    </div>
  );
};
