import React, { useCallback, useEffect, useState } from 'react';
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileCode2,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import type { GeneratedArtifact } from '../types/index.ts';

interface ArtifactCardProps {
  artifact: GeneratedArtifact;
}

function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return '';
  if (sizeBytes < 1024) return sizeBytes + ' B';
  if (sizeBytes < 1024 * 1024) return (sizeBytes / 1024).toFixed(1) + ' KB';
  return (sizeBytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function safeArtifactPath(value: string): string | null {
  if (!/^\/artifacts\/[^/?#]+(?:\?[^#]*)?$/.test(value)) return null;
  return value;
}

function isFreshSignedPath(value: string | null): boolean {
  if (!value) return false;
  const safe = safeArtifactPath(value);
  if (!safe) return false;
  const queryIndex = safe.indexOf('?');
  if (queryIndex < 0) return false;
  const params = new URLSearchParams(safe.slice(queryIndex + 1));
  const expires = Number(params.get('expires'));
  return Boolean(params.get('signature'))
    && Number.isSafeInteger(expires)
    && expires * 1000 > Date.now() + 5000;
}

function artifactIcon(type: string) {
  switch (type.toLowerCase()) {
    case 'xlsx':
    case 'excel':
    case 'csv':
      return FileSpreadsheet;
    case 'md':
    case 'markdown':
      return FileCode2;
    default:
      return FileText;
  }
}

export const ArtifactCard: React.FC<ArtifactCardProps> = ({ artifact }) => {
  const initialUrl = safeArtifactPath(artifact.url);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(
    () => isFreshSignedPath(initialUrl) ? initialUrl : null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const refreshDownloadUrl = useCallback(async (signal?: AbortSignal) => {
    if (!artifact.name || artifact.name.includes('/') || artifact.name.includes('\\')) {
      setDownloadUrl(null);
      setLinkError('The stored artifact identifier is invalid.');
      return;
    }

    setIsRefreshing(true);
    setLinkError(null);
    try {
      const response = await fetch(
        '/api/artifacts/' + encodeURIComponent(artifact.name) + '/access',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      const data = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : null;

      if (!response.ok || data?.success !== true || typeof data.url !== 'string') {
        const serverError = typeof data?.error === 'string' && data.error.trim()
          ? data.error
          : data?.code === 'ARTIFACT_NOT_FOUND'
            ? 'This file is not present in the database-backed store. Regenerate it if it predates the storage rollout.'
            : 'The secure link service returned HTTP ' + response.status + '.';
        throw new Error(serverError);
      }

      const resolvedUrl = safeArtifactPath(data.url);
      if (!resolvedUrl || !isFreshSignedPath(resolvedUrl)) {
        throw new Error('The server did not return a valid, unexpired artifact link.');
      }

      if (signal?.aborted) return;
      setDownloadUrl(resolvedUrl);
      setLinkError(null);
    } catch (error: unknown) {
      if (signal?.aborted) return;
      setDownloadUrl((current) => isFreshSignedPath(current) ? current : null);
      setLinkError(error instanceof Error ? error.message : 'Artifact download access is unavailable.');
    } finally {
      if (!signal?.aborted) setIsRefreshing(false);
    }
  }, [artifact.name]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshDownloadUrl(controller.signal);
    return () => controller.abort();
  }, [refreshDownloadUrl]);

  const safeUrl = downloadUrl;
  const FileIcon = artifactIcon(artifact.type);
  const displayName = artifact.displayName || artifact.name;
  const hasVerifiedMetadata = artifact.validationStatus === 'validated';
  const sizeLabel = typeof artifact.sizeBytes === 'number' ? formatFileSize(artifact.sizeBytes) : '';

  return (
    <section
      aria-label={'Generated file: ' + displayName}
      className="mt-4 w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80"
    >
      <div className="flex items-start gap-3 p-3.5 sm:p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <FileIcon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
            {displayName}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="rounded-md border border-slate-200 px-1.5 py-0.5 font-semibold uppercase tracking-wide dark:border-slate-700">
              {artifact.type}
            </span>
            {sizeLabel && <span>{sizeLabel}</span>}
            {artifact.generatedAt && (
              <time dateTime={artifact.generatedAt}>
                {new Date(artifact.generatedAt).toLocaleString()}
              </time>
            )}
          </div>
          {hasVerifiedMetadata && (
            <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              File generated, saved, and validated
            </div>
          )}
        </div>
      </div>

      {safeUrl ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 p-3 dark:border-slate-700/80 dark:bg-slate-950/40">
          <a
            href={safeUrl}
            download={displayName}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download file
          </a>
          {['pdf', 'md', 'markdown', 'csv'].includes(artifact.type.toLowerCase()) && (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Open
            </a>
          )}
        </div>
      ) : (
        <div role={linkError ? 'alert' : 'status'} className="border-t border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
          <div className="flex items-start gap-2">
            {linkError
              ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              : <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {linkError ? 'Secure download is unavailable' : 'Resolving secure download link'}
              </p>
              {linkError && <p className="mt-1 break-words">{linkError}</p>}
              {linkError && (
                <button
                  type="button"
                  onClick={() => { void refreshDownloadUrl(); }}
                  disabled={isRefreshing}
                  className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-amber-600/40 px-3 py-1.5 font-semibold disabled:opacity-60"
                >
                  <RefreshCw className={'h-3.5 w-3.5' + (isRefreshing ? ' animate-spin' : '')} aria-hidden="true" />
                  Retry link resolution
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
