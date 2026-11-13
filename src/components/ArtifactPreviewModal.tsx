import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  Download,
  ExternalLink,
  Loader2,
  AlertTriangle,
  RefreshCw,
  FileSpreadsheet,
  FileCode2,
  FileText,
  Share2,
} from 'lucide-react';
import type { ArtifactPreviewData, GeneratedArtifact } from '../types/index.ts';
import { renderFormattedMarkdown } from '../utils/markdown.tsx';
import { apiFetch } from '../utils/apiFetch.ts';
import { canUseNativeFileShare, downloadOrShareArtifact } from '../utils/artifactDownload.ts';

interface ArtifactPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  artifact: GeneratedArtifact;
  downloadUrl?: string | null;
}

export const ArtifactPreviewModal: React.FC<ArtifactPreviewModalProps> = ({
  isOpen,
  onClose,
  artifact,
  downloadUrl,
}) => {
  const [preview, setPreview] = useState<ArtifactPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [isTransferring, setIsTransferring] = useState(false);

  const loadPreview = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/artifacts/${encodeURIComponent(artifact.name)}/preview`, {
        method: 'GET',
        cache: 'no-store',
        signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.preview) {
        throw new Error(data?.error || `Preview service returned HTTP ${res.status}.`);
      }
      if (!signal?.aborted) {
        setPreview(data.preview as ArtifactPreviewData);
        setSelectedSheetIndex(0);
      }
    } catch (err: unknown) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : 'Unable to load artifact preview.');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [artifact.name]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    void loadPreview(controller.signal);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      controller.abort();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, loadPreview, onClose]);

  if (!isOpen) return null;

  const displayName = preview?.displayName || artifact.displayName || artifact.name;
  const resolvedDownloadUrl = downloadUrl || preview?.inlineUrl || null;

  const renderTable = (headers: string[], rows: string[][], totalRows?: number, truncated?: boolean) => (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span>
          Showing <strong>{rows.length}</strong> of <strong>{totalRows ?? rows.length}</strong> row(s)
        </span>
        {truncated && (
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            Preview truncated to first 200 rows. Download full file to inspect all rows.
          </span>
        )}
      </div>

      <div className="overflow-auto max-h-[60vh] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <table className="w-full text-left border-collapse text-xs">
          {headers.length > 0 && (
            <thead className="sticky top-0 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
              <tr>
                {headers.map((header, idx) => (
                  <th
                    key={idx}
                    className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap border-r last:border-r-0 border-slate-200 dark:border-slate-800"
                  >
                    {header || `Col ${idx + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(1, headers.length)} className="px-3 py-6 text-center text-slate-400">
                  No data rows in this sheet.
                </td>
              </tr>
            ) : (
              rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  {Array.from({ length: Math.max(headers.length, row.length) }).map((_, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-3 py-2 text-slate-700 dark:text-slate-300 border-r last:border-r-0 border-slate-100 dark:border-slate-800/60 max-w-xs break-words align-top"
                    >
                      {row[cIdx] ?? ''}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const TypeIcon = artifact.type.toLowerCase() === 'xlsx' || artifact.type.toLowerCase() === 'csv'
    ? FileSpreadsheet
    : artifact.type.toLowerCase() === 'md' || artifact.type.toLowerCase() === 'markdown'
      ? FileCode2
      : FileText;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${displayName}`}
    >
      <div className="w-full max-w-4xl max-h-[92dvh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
              <TypeIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{displayName}</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {artifact.type.toUpperCase()} Preview
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {resolvedDownloadUrl && (
              <>
                {canUseNativeFileShare() && (
                  <button
                    type="button"
                    disabled={isTransferring}
                    onClick={async () => {
                      setIsTransferring(true);
                      try {
                        await downloadOrShareArtifact({
                          url: resolvedDownloadUrl,
                          fileName: displayName,
                          preferShare: true,
                        });
                      } finally {
                        setIsTransferring(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-semibold text-xs transition disabled:opacity-60"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Share</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isTransferring}
                  onClick={async () => {
                    setIsTransferring(true);
                    try {
                      await downloadOrShareArtifact({
                        url: resolvedDownloadUrl,
                        fileName: displayName,
                        preferShare: false,
                      });
                    } finally {
                      setIsTransferring(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition disabled:opacity-60"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Download</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 transition"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Preview Content */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 min-h-0">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
              <span>Loading artifact preview...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Artifact preview is unavailable</p>
                  <p className="break-words">{error}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { void loadPreview(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-500/40 font-semibold hover:bg-rose-500/10 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          ) : preview?.previewKind === 'markdown' ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
              {renderFormattedMarkdown(preview.markdownText || '')}
            </div>
          ) : preview?.previewKind === 'table' ? (
            renderTable(preview.headers || [], preview.rows || [], preview.totalRows, preview.truncated)
          ) : preview?.previewKind === 'workbook' && preview.sheets && preview.sheets.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {preview.sheets.map((sheet, idx) => (
                  <button
                    key={sheet.name + idx}
                    type="button"
                    onClick={() => setSelectedSheetIndex(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${
                      idx === selectedSheetIndex
                        ? 'bg-amber-500 text-slate-950 border-amber-500'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-500/50'
                    }`}
                  >
                    {sheet.name} ({sheet.totalRows})
                  </button>
                ))}
              </div>
              {(() => {
                const activeSheet = preview.sheets[selectedSheetIndex] || preview.sheets[0];
                return renderTable(activeSheet.headers, activeSheet.rows, activeSheet.totalRows, activeSheet.truncated);
              })()}
            </div>
          ) : preview?.previewKind === 'pdf' && preview.inlineUrl ? (
            <div className="space-y-3">
              <iframe
                src={preview.inlineUrl}
                title={displayName}
                className="w-full h-[65vh] rounded-xl border border-slate-200 dark:border-slate-800 bg-white"
              />
              <div className="flex items-center justify-end">
                <a
                  href={preview.inlineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 hover:underline font-medium"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open PDF in new tab if browser blocks inline frame</span>
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
