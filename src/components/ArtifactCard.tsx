import React from 'react';
import { Download, ExternalLink, FileSpreadsheet, FileText, FileCode2, ShieldCheck, AlertTriangle } from 'lucide-react';
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

function artifactIcon(type: string) {
  switch (type.toLowerCase()) {
    case 'xlsx':
    case 'excel':
      return FileSpreadsheet;
    case 'md':
    case 'markdown':
      return FileCode2;
    default:
      return FileText;
  }
}

export const ArtifactCard: React.FC<ArtifactCardProps> = ({ artifact }) => {
  const safeUrl = safeArtifactPath(artifact.url);
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
        <div role="alert" className="flex items-start gap-2 border-t border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>The stored artifact link is missing or invalid. No download link has been constructed.</span>
        </div>
      )}
    </section>
  );
};
