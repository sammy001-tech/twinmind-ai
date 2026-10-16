import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  Link2,
} from 'lucide-react';
import type { GeneratedArtifact } from '../types/index.ts';
import { formatArtifactSize } from '../utils/artifacts.ts';

interface GeneratedArtifactCardProps {
  artifact: GeneratedArtifact;
}

interface ActionFeedback {
  kind: 'success' | 'error';
  message: string;
}

function getStorageFileName(artifactUrl: string): string {
  const parsed = new URL(artifactUrl, window.location.origin);
  if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith('/artifacts/')) {
    throw new Error('The artifact download path is invalid.');
  }

  const encodedFileName = parsed.pathname.slice('/artifacts/'.length);
  const fileName = decodeURIComponent(encodedFileName);
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..') {
    throw new Error('The artifact download path is invalid.');
  }
  return fileName;
}

function fileTypeIcon(type: GeneratedArtifact['type']) {
  if (type === 'xlsx' || type === 'excel') return FileSpreadsheet;
  if (type === 'pdf' || type === 'md' || type === 'markdown') return FileText;
  return FileDown;
}

export const GeneratedArtifactCard: React.FC<GeneratedArtifactCardProps> = ({ artifact }) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCreatingShareLink, setIsCreatingShareLink] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const Icon = fileTypeIcon(artifact.type);
  const generatedDate = artifact.generatedAt ? new Date(artifact.generatedAt) : null;

  const handleDownload = async () => {
    setIsDownloading(true);
    setFeedback(null);
    try {
      const response = await fetch(artifact.url, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('This file requires an active owner session. Sign in again and retry.');
        }
        if (response.status === 404) {
          throw new Error('This file is no longer available in the configured artifact storage. It may have been removed during a restart or redeploy.');
        }
        throw new Error(`The server could not provide the file (HTTP ${response.status}).`);
      }

      const blob = await response.blob();
      if (blob.size <= 0) {
        throw new Error('The server returned an empty file. No download was started.');
      }
      if (artifact.sizeBytes !== undefined && blob.size !== artifact.sizeBytes) {
        throw new Error('The downloaded file size did not match the generated metadata. No download was started.');
      }

      const expectedMime = artifact.mimeType?.split(';', 1)[0].trim().toLowerCase();
      const actualMime = blob.type.split(';', 1)[0].trim().toLowerCase();
      if (
        expectedMime &&
        actualMime &&
        actualMime !== 'application/octet-stream' &&
        expectedMime !== actualMime
      ) {
        throw new Error('The server returned a different file type than the generated metadata. No download was started.');
      }

      if (artifact.sha256 && window.crypto?.subtle) {
        const digest = await window.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        const actualHash = Array.from(new Uint8Array(digest))
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('');
        if (actualHash !== artifact.sha256.toLowerCase()) {
          throw new Error('The downloaded file failed its SHA-256 integrity check. No download was started.');
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = artifact.name;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      setFeedback({ kind: 'success', message: 'File verified. Download started.' });
    } catch (error: unknown) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The file could not be downloaded.',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyTemporaryLink = async () => {
    setIsCreatingShareLink(true);
    setFeedback(null);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable in this browser session.');
      }
      const storageFileName = getStorageFileName(artifact.url);
      const response = await fetch(
        `/api/artifacts/${encodeURIComponent(storageFileName)}/share-link`,
        { method: 'POST', credentials: 'same-origin', cache: 'no-store' },
      );
      const data: unknown = await response.json().catch(() => null);
      const payload = data && typeof data === 'object' && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (!response.ok || payload?.success !== true || typeof payload.url !== 'string') {
        if (response.status === 401) {
          throw new Error('Sign in again to create a temporary download link.');
        }
        const reason = typeof payload?.error === 'string' && payload.error.trim()
          ? payload.error
          : `A temporary link could not be created (HTTP ${response.status}).`;
        throw new Error(reason);
      }

      const shareUrl = new URL(payload.url, window.location.origin);
      if (shareUrl.origin !== window.location.origin || !shareUrl.pathname.startsWith('/artifacts/')) {
        throw new Error('The server returned an invalid temporary download link.');
      }
      await navigator.clipboard.writeText(shareUrl.toString());

      const expiry = typeof payload.expiresAt === 'string' ? new Date(payload.expiresAt) : null;
      const expiryLabel = expiry && !Number.isNaN(expiry.getTime())
        ? ` Expires ${expiry.toLocaleTimeString()}.`
        : ' The link is time-limited.';
      setFeedback({ kind: 'success', message: `Temporary link copied.${expiryLabel}` });
    } catch (error: unknown) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'A temporary link could not be copied.',
      });
    } finally {
      setIsCreatingShareLink(false);
    }
  };

  return (
    <section
      aria-label={`Generated file ${artifact.name}`}
      className="mt-3 w-full min-w-0 max-w-xl rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm transition-colors dark:border-slate-700 dark:bg-slate-900/90 sm:p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
              {artifact.name}
            </h3>
            <span className="inline-flex shrink-0 rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300">
              {artifact.type}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span>{formatArtifactSize(artifact.sizeBytes)}</span>
            {generatedDate && !Number.isNaN(generatedDate.getTime()) && (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={generatedDate.toISOString()}>{generatedDate.toLocaleString()}</time>
              </>
            )}
          </div>
          {artifact.storageScope === 'instance-local' && (
            <p className="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
              Instance-local storage. This file may become unavailable after a service restart or redeploy.
            </p>
          )}
          {artifact.storageScope === 'configured-directory' && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Saved to the configured artifact directory. Persistence depends on the hosting volume mounted at that path.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading || isCreatingShareLink}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-wait disabled:opacity-60"
        >
          {isDownloading ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          {isDownloading ? 'Verifying file…' : 'Download file'}
        </button>
        <button
          type="button"
          onClick={handleCopyTemporaryLink}
          disabled={isDownloading || isCreatingShareLink}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-amber-500/60 hover:bg-amber-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
        >
          {isCreatingShareLink ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : feedback?.kind === 'success' && feedback.message.startsWith('Temporary link copied') ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Link2 className="h-4 w-4" aria-hidden="true" />
          )}
          {isCreatingShareLink ? 'Creating link…' : 'Copy 15-min link'}
        </button>
      </div>

      {feedback && (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`mt-3 flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            feedback.kind === 'error'
              ? 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'
              : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {feedback.kind === 'error' ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0 break-words">{feedback.message}</span>
        </div>
      )}
    </section>
  );
};
