import React, { useState } from 'react';
import {
  ClaimEvidenceStatus,
  ToolExecutionStatus,
  VerificationEnvelope,
} from '../types/index.ts';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database,
  ExternalLink,
  FileText,
  HelpCircle,
  Info,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';

interface MessageEvidencePanelProps {
  envelope?: VerificationEnvelope;
  variant: 'banners' | 'drawer';
  onOpenKnowledgeVault?: (docId?: string | number) => void;
}

const CLAIM_META: Record<
  ClaimEvidenceStatus,
  {
    label: string;
    badgeClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  verified: {
    label: 'Verified',
    badgeClass:
      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    icon: CheckCircle2,
  },
  partial: {
    label: 'Partial',
    badgeClass:
      'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    icon: AlertTriangle,
  },
  inferred: {
    label: 'Inferred',
    badgeClass:
      'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
    icon: Info,
  },
  unverified: {
    label: 'Unverified',
    badgeClass:
      'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
    icon: HelpCircle,
  },
};

const TOOL_STATUS_META: Record<
  ToolExecutionStatus,
  {
    label: string;
    badgeClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  succeeded_usable: {
    label: 'Succeeded · Usable',
    badgeClass:
      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    icon: CheckCircle2,
  },
  succeeded_insufficient: {
    label: 'Succeeded · Insufficient',
    badgeClass:
      'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    icon: AlertTriangle,
  },
  failed: {
    label: 'Failed',
    badgeClass:
      'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
    icon: XCircle,
  },
  not_attempted: {
    label: 'Not Attempted',
    badgeClass:
      'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/25',
    icon: Info,
  },
};

function formatShortTimestamp(value?: string | null): string {
  if (!value) return 'Timestamp unavailable';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSourceType(sourceType: string): string {
  return sourceType.replace(/_/g, ' ');
}

export const MessageEvidencePanel: React.FC<MessageEvidencePanelProps> = ({
  envelope,
  variant,
  onOpenKnowledgeVault,
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'claims' | 'tools' | 'memory' | 'conflicts'>('claims');
  const [highlightedClaimId, setHighlightedClaimId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ClaimEvidenceStatus | 'all'>('all');

  if (!envelope) return null;

  if (variant === 'banners') {
    if (!envelope.bannerMessages || envelope.bannerMessages.length === 0) {
      return null;
    }

    return (
      <div className="mb-3 space-y-2" role="region" aria-label="Evidence and verification notices">
        {envelope.bannerMessages.map((banner, idx) => {
          const isError = banner.severity === 'error';
          return (
            <div
              key={`${banner.code}-${idx}`}
              className={`rounded-xl border px-3 py-2 text-xs flex items-start gap-2.5 ${
                isError
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-200'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200'
              }`}
            >
              {isError ? (
                <AlertOctagon className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold tracking-tight">
                    {isError ? 'Verification failure' : 'Verification notice'}
                  </span>
                  <span className="font-mono text-[10px] opacity-75">{banner.code}</span>
                </div>
                <p className="leading-relaxed opacity-95">{banner.message}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Drawer + Interactive Claim Transparency Bar
  const claimCounts = {
    verified: envelope.claims.filter((c) => c.status === 'verified').length,
    partial: envelope.claims.filter((c) => c.status === 'partial').length,
    inferred: envelope.claims.filter((c) => c.status === 'inferred').length,
    unverified: envelope.claims.filter((c) => c.status === 'unverified').length,
  };

  const postureIcon =
    envelope.overallPosture === 'verified' ? (
      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
    ) : envelope.overallPosture === 'unverified' ? (
      <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" aria-hidden="true" />
    ) : envelope.overallPosture === 'mixed' || envelope.overallPosture === 'partial' ? (
      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-hidden="true" />
    ) : (
      <Info className="w-3.5 h-3.5 text-sky-500 shrink-0" aria-hidden="true" />
    );

  const handleOpenClaimStatus = (status: ClaimEvidenceStatus) => {
    setIsDrawerOpen(true);
    setActiveTab('claims');
    setStatusFilter((prev) => (prev === status && isDrawerOpen ? 'all' : status));
    const firstMatch = envelope.claims.find((c) => c.status === status);
    setHighlightedClaimId(firstMatch?.id ?? null);
  };

  const visibleClaims =
    statusFilter === 'all'
      ? envelope.claims
      : envelope.claims.filter((c) => c.status === statusFilter);

  return (
    <div className="mt-3 pt-2.5 border-t border-slate-200/75 dark:border-slate-800/80 space-y-2.5 text-xs">
      {/* Summary & Claim-Level Interactive Triggers */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setIsDrawerOpen((prev) => !prev);
              setStatusFilter('all');
            }}
            aria-expanded={isDrawerOpen}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-100/80 hover:bg-slate-200/70 dark:bg-slate-900/70 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
          >
            {postureIcon}
            <span>{envelope.summaryLabel}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${
                isDrawerOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {(['verified', 'partial', 'inferred', 'unverified'] as ClaimEvidenceStatus[]).map((statusKey) => {
            const count = claimCounts[statusKey];
            if (count === 0) return null;
            const meta = CLAIM_META[statusKey];
            const Icon = meta.icon;
            const isSelected = isDrawerOpen && activeTab === 'claims' && statusFilter === statusKey;
            return (
              <button
                key={statusKey}
                type="button"
                onClick={() => handleOpenClaimStatus(statusKey)}
                title={`Inspect ${meta.label.toLowerCase()} claims in evidence drawer`}
                className={`inline-flex items-center gap-1 px-2 py-1 min-h-[30px] rounded-lg border text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  meta.badgeClass
                } ${isSelected ? 'ring-2 ring-offset-1 ring-amber-500/50 dark:ring-offset-slate-950' : 'hover:opacity-90'}`}
              >
                <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span>{meta.label}</span>
                <span className="font-mono tabular-nums text-[10px] opacity-85">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Typographic telemetry counts */}
        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          <span>{envelope.toolLedger.length} tool</span>
          <span aria-hidden="true">·</span>
          <span>{envelope.memoryDiagnostics.length} mem</span>
          {envelope.conflictsDetected.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => {
                  setIsDrawerOpen(true);
                  setActiveTab('conflicts');
                }}
                className="text-amber-600 dark:text-amber-400 font-semibold hover:underline"
              >
                {envelope.conflictsDetected.length} conflict
              </button>
            </>
          )}
        </div>
      </div>

      {/* Collapsible Evidence & Verification Drawer */}
      {isDrawerOpen && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/75 overflow-hidden">
          {/* Sub-tab bar */}
          <div className="flex items-center gap-1 px-2.5 pt-2 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
            {(
              [
                { id: 'claims', label: 'Claims', count: envelope.claims.length, icon: FileText },
                { id: 'tools', label: 'Tool Ledger', count: envelope.toolLedger.length, icon: Wrench },
                { id: 'memory', label: 'Memory Diagnostics', count: envelope.memoryDiagnostics.length, icon: Database },
                { id: 'conflicts', label: 'Conflicts', count: envelope.conflictsDetected.length, icon: Layers },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    if (tab.id !== 'claims') setStatusFilter('all');
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-[11px] font-medium border-b-2 transition whitespace-nowrap ${
                    isActive
                      ? 'border-amber-500 text-slate-900 dark:text-white font-semibold'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                  <span className="font-mono tabular-nums text-[10px] opacity-75">
                    ({tab.count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Drawer Content */}
          <div className="p-3 space-y-2.5 max-h-80 overflow-y-auto">
            {activeTab === 'claims' && (
              <>
                {statusFilter !== 'all' && (
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pb-1">
                    <span>
                      Filtered by: <strong className="text-slate-800 dark:text-slate-200">{CLAIM_META[statusFilter].label}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter('all');
                        setHighlightedClaimId(null);
                      }}
                      className="text-amber-600 dark:text-amber-400 hover:underline font-medium"
                    >
                      Show all claims
                    </button>
                  </div>
                )}

                {visibleClaims.length === 0 ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 py-2">
                    No claims recorded under this filter.
                  </p>
                ) : (
                  visibleClaims.map((claim) => {
                    const meta = CLAIM_META[claim.status];
                    const Icon = meta.icon;
                    const isHighlighted = highlightedClaimId === claim.id;
                    return (
                      <div
                        key={claim.id}
                        className={`rounded-lg border p-2.5 space-y-1.5 transition ${
                          isHighlighted
                            ? 'bg-amber-500/5 border-amber-500/40'
                            : 'bg-white dark:bg-slate-950/70 border-slate-200/80 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium text-slate-900 dark:text-slate-100 leading-snug">
                            {claim.statement}
                          </p>
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold shrink-0 ${meta.badgeClass}`}
                          >
                            <Icon className="w-3 h-3" aria-hidden="true" />
                            <span>{meta.label}</span>
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="capitalize">{formatSourceType(claim.sourceType)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{claim.basisSummary}</span>
                        </div>

                        {claim.gapOrConflictNote && (
                          <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
                            {claim.gapOrConflictNote}
                          </div>
                        )}

                        {claim.sourceRefs.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {claim.sourceRefs.map((ref, refIdx) =>
                              ref.kind === 'url' && ref.url ? (
                                <a
                                  key={`${claim.id}-ref-${refIdx}`}
                                  href={ref.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline max-w-full truncate"
                                >
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                  <span className="truncate max-w-[240px]">{ref.label}</span>
                                </a>
                              ) : ref.kind === 'memory' && onOpenKnowledgeVault && ref.id !== undefined ? (
                                <button
                                  key={`${claim.id}-ref-${refIdx}`}
                                  type="button"
                                  onClick={() => onOpenKnowledgeVault(ref.id)}
                                  className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300 hover:underline"
                                >
                                  <Database className="w-3 h-3 shrink-0" />
                                  <span>{ref.label}</span>
                                  {ref.timestamp && (
                                    <span className="font-mono tabular-nums text-[10px] text-slate-400">
                                      ({formatShortTimestamp(ref.timestamp)})
                                    </span>
                                  )}
                                </button>
                              ) : (
                                <span
                                  key={`${claim.id}-ref-${refIdx}`}
                                  className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300"
                                >
                                  <span>{ref.label}</span>
                                  {ref.timestamp && (
                                    <span className="font-mono tabular-nums text-[10px] text-slate-400">
                                      ({formatShortTimestamp(ref.timestamp)})
                                    </span>
                                  )}
                                </span>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}

            {activeTab === 'tools' && (
              <>
                {envelope.toolLedger.length === 0 ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 py-2">
                    No external tools were invoked during this turn.
                  </p>
                ) : (
                  envelope.toolLedger.map((tool, idx) => {
                    const meta = TOOL_STATUS_META[tool.executionStatus];
                    const Icon = meta.icon;
                    return (
                      <div
                        key={`${tool.toolName}-${idx}`}
                        className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950/70 p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-xs text-slate-900 dark:text-white">
                              {tool.toolName}
                            </span>
                            {tool.resultCount !== undefined && (
                              <span className="font-mono tabular-nums text-[10px] text-slate-500 dark:text-slate-400">
                                {tool.resultCount} result(s)
                              </span>
                            )}
                          </div>
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${meta.badgeClass}`}
                          >
                            <Icon className="w-3 h-3" aria-hidden="true" />
                            <span>{meta.label}</span>
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                          {tool.summary}
                        </p>

                        {(tool.errorCode || tool.errorMessage) && (
                          <div className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1 font-mono">
                            {tool.errorCode ? `[${tool.errorCode}] ` : ''}
                            {tool.errorMessage}
                          </div>
                        )}

                        {tool.urls && tool.urls.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-0.5">
                            {tool.urls.slice(0, 5).map((url, uIdx) => (
                              <a
                                key={`${tool.toolName}-url-${uIdx}`}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline max-w-[260px] truncate"
                              >
                                <ExternalLink className="w-3 h-3 shrink-0" />
                                <span className="truncate">{url}</span>
                              </a>
                            ))}
                          </div>
                        )}

                        <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                          {formatShortTimestamp(tool.timestamp)}
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {activeTab === 'memory' && (
              <>
                {envelope.memoryDiagnostics.length === 0 ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 py-2">
                    No Vault memories matched this turn&apos;s retrieval threshold.
                  </p>
                ) : (
                  envelope.memoryDiagnostics.map((mem) => (
                    <div
                      key={String(mem.id)}
                      className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950/70 p-2.5 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {onOpenKnowledgeVault ? (
                              <button
                                type="button"
                                onClick={() => onOpenKnowledgeVault(mem.id)}
                                className="font-semibold text-xs text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline text-left"
                              >
                                {mem.title}
                              </button>
                            ) : (
                              <span className="font-semibold text-xs text-slate-900 dark:text-white">
                                {mem.title}
                              </span>
                            )}
                            <span className="font-mono tabular-nums text-[10px] text-slate-400">
                              #{mem.id}
                            </span>
                            {mem.similarity !== undefined && (
                              <span className="font-mono tabular-nums text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                                {Math.round(mem.similarity * 100)}% match
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5 capitalize">
                            <span>{mem.confidenceStatus}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatSourceType(mem.sourceType)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{mem.impactLevel} impact</span>
                            <span aria-hidden="true">·</span>
                            <span>{mem.lifecycleStatus}</span>
                            {(mem.lastVerifiedAt || mem.updatedAt || mem.validFrom || mem.createdAt) && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums normal-case">
                                  {formatShortTimestamp(
                                    mem.lastVerifiedAt || mem.updatedAt || mem.validFrom || mem.createdAt
                                  )}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold shrink-0 ${
                            mem.includedInPrompt
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                              : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/25'
                          }`}
                        >
                          {mem.includedInPrompt ? 'Included' : 'Excluded'}
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-600 dark:text-slate-300">{mem.reason}</p>
                    </div>
                  ))
                )}
              </>
            )}

            {activeTab === 'conflicts' && (
              <>
                {envelope.conflictsDetected.length === 0 ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 py-2">
                    No conflicting memory records detected for this turn.
                  </p>
                ) : (
                  envelope.conflictsDetected.map((conflict, cIdx) => (
                    <div
                      key={`${String(conflict.existingDocId ?? cIdx)}-${cIdx}`}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs text-slate-900 dark:text-white">
                          {conflict.title}
                        </span>
                        {conflict.impactLevel && (
                          <span className="text-[10px] font-mono uppercase text-amber-700 dark:text-amber-300">
                            {conflict.impactLevel} impact
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-relaxed">
                        {conflict.explanation}
                      </p>
                      {onOpenKnowledgeVault && conflict.existingDocId !== undefined && (
                        <button
                          type="button"
                          onClick={() => onOpenKnowledgeVault(conflict.existingDocId)}
                          className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                        >
                          Inspect record #{conflict.existingDocId} in Vault
                        </button>
                      )}
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
