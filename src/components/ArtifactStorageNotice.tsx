import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

type StorageMode = 'database' | 'unavailable';
const DISMISSED_SESSION_KEY = 'twinmind:artifact-storage-notice:dismissed';

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
    (payload.mode !== 'database' && payload.mode !== 'unavailable')
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
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.sessionStorage.getItem(DISMISSED_SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });

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

  if (state.status === 'loading' || isDismissed) return null;

  const mode = state.status === 'ready' ? state.storage.mode : 'unavailable';
  const isDatabaseBacked = mode === 'database';
  const isUnavailable = state.status === 'unavailable' || mode === 'unavailable';
  const statusMessage = state.status === 'ready'
    ? state.storage.warning
    : state.message;

  return (
    <div
      role={isUnavailable ? 'alert' : 'status'}
      className={
        'mx-3 mb-2 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed sm:mx-4 ' +
        (isUnavailable
          ? 'border-red-500/30 bg-red-500/5 text-red-800 dark:text-red-300'
          : 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300')
      }
    >
      {state.status === 'ready' && state.storage.mode === 'database'
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {state.status === 'unavailable' || isUnavailable
            ? 'Database-backed artifact storage unavailable'
            : isDatabaseBacked
              ? 'Database-backed artifact storage active'
              : 'Artifact storage status unavailable'}
        </p>
        <p className="mt-0.5 break-words">{statusMessage}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          setIsDismissed(true);
          try {
            window.sessionStorage.setItem(DISMISSED_SESSION_KEY, 'true');
          } catch {
            // Dismissal remains effective for this component mount when browser storage is blocked.
          }
        }}
        aria-label="Dismiss artifact storage status"
        title="Dismiss"
        className="ml-1 shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};
