import React, { useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, ChevronDown, ExternalLink, Loader2, Search } from 'lucide-react';
import type { LiveResearchActivity } from '../types/index.ts';

interface LiveResearchActivityFeedProps {
  activities: LiveResearchActivity[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function getWebHostname(value: unknown): string | null {
  if (!isWebUrl(value)) return null;
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

export const LiveResearchActivityFeed: React.FC<LiveResearchActivityFeedProps> = ({ activities }) => {
  const [expanded, setExpanded] = useState(true);
  if (activities.length === 0) return null;

  const runningCount = activities.filter((activity) => activity.status === 'running').length;

  return (
    <section className="my-4 overflow-hidden rounded-2xl border border-slate-200/90 bg-white text-slate-800 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-200">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-slate-200/80 bg-slate-50/90 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500/60 dark:border-slate-700/60 dark:bg-slate-800/50 dark:hover:bg-slate-800/80"
        aria-expanded={expanded}
      >
        <span className="flex min-w-0 items-center gap-2">
          {runningCount > 0
            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyan-500" />
            : <Search className="h-4 w-4 shrink-0 text-cyan-500" />}
          <span className="truncate text-[13px] font-semibold tracking-tight">Live web activity</span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">
            {activities.length} tool events
          </span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>

      {expanded && (
        <div className="space-y-4 p-3.5 sm:p-4">
          {activities.map((activity) => {
            const result = asRecord(activity.result);
            const sourcesValue = result?.sources;
            const sources = Array.isArray(sourcesValue)
              ? sourcesValue.filter((source) => source && typeof source === 'object' && !Array.isArray(source)) as Record<string, unknown>[]
              : [];
            const query = typeof activity.input?.query === 'string' ? activity.input.query : '';
            const error = typeof result?.error === 'string' ? result.error : '';
            const success = result?.status === 'success';
            const title = activity.toolName === 'searchWeb' ? 'Searching live web' : 'Reading source pages';
            const SummaryIcon = activity.status === 'running'
              ? Loader2
              : activity.status === 'error'
                ? AlertCircle
                : CheckCircle2;

            return (
              <div key={activity.toolId} className="space-y-2.5">
                <div className="flex items-start gap-2">
                  <SummaryIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${activity.status === 'running' ? 'animate-spin text-cyan-500' : activity.status === 'error' ? 'text-rose-500' : 'text-emerald-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">{title}</div>
                    {query && (
                      <p className="mt-0.5 break-words text-[11px] text-slate-500 dark:text-slate-400">{query}</p>
                    )}
                    {activity.status === 'running' && (
                      <p className="mt-0.5 text-[11px] text-cyan-600 dark:text-cyan-400">Waiting for the live provider result.</p>
                    )}
                    {activity.status === 'error' && error && (
                      <p className="mt-0.5 break-words text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
                    )}
                    {activity.status === 'completed' && success && (
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {activity.toolName === 'searchWeb'
                          ? `Provider returned ${sources.length} usable source records.`
                          : `Provider extracted content from ${sources.length} source pages.`}
                      </p>
                    )}
                  </div>
                </div>

                {sources.length > 0 && (
                  <div className="ml-5 space-y-2 border-l border-slate-200 pl-3 dark:border-slate-700/70">
                    {sources.map((source, index) => {
                      const url = source.url;
                      const sourceTitle = typeof source.title === 'string' && source.title.trim()
                        ? source.title
                        : isWebUrl(url) ? url : '';
                      const summary = typeof source.snippet === 'string'
                        ? source.snippet
                        : typeof source.content === 'string'
                          ? source.content
                          : '';
                      return (
                        <article key={isWebUrl(url) ? url : `${activity.toolId}-source-${index}`} className="min-w-0 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-700/70 dark:bg-slate-950/50">
                          {isWebUrl(url) ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-full items-start gap-1.5 break-words text-[13px] font-semibold leading-5 text-cyan-800 underline decoration-cyan-500/30 underline-offset-2 hover:decoration-cyan-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 dark:text-cyan-300 dark:hover:text-cyan-200"
                            >
                              <span className="min-w-0">{sourceTitle}</span>
                              <ExternalLink aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            </a>
                          ) : sourceTitle ? (
                            <span className="text-[11px]">{sourceTitle}</span>
                          ) : null}
                          {getWebHostname(url) && <p className="mt-1 break-all text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{getWebHostname(url)}</p>}
                          {summary && <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600 dark:text-slate-300">{summary}</p>}
                        </article>
                      );
                    })}
                  </div>
                )}

                {activity.toolName === 'extractWebPages' && Array.isArray(result?.requestedUrls) && sources.length === 0 && (
                  <div className="ml-5 space-y-1">
                    {(result?.requestedUrls as unknown[]).filter(isWebUrl).map((url) => (
                      <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="flex min-h-8 items-center gap-2 break-all rounded-lg px-2 py-1 text-xs text-cyan-800 underline decoration-cyan-500/30 underline-offset-2 hover:bg-slate-100 hover:decoration-cyan-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 dark:text-cyan-300 dark:hover:bg-slate-800/70">
                        <BookOpen className="h-3 w-3 shrink-0" />
                        {url}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
