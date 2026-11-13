import React, { useEffect, useState } from 'react';
import {
  InstructionResolutionManifest,
  InstructionScope,
} from '../types/index.ts';
import {
  AlertTriangle,
  Clock,
  FolderGit2,
  Layers,
  Loader2,
  Power,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  X,
} from 'lucide-react';

interface ThreadRulesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  threadId: string | null;
  projectKey: string | null;
  manifest: InstructionResolutionManifest | null;
  isLoading?: boolean;
  error?: string | null;
  onRefresh: () => Promise<void> | void;
  onUpdateProjectKey: (projectKey: string | null) => Promise<void>;
  onToggleRuleActive: (ruleId: number, isActive: boolean) => Promise<void>;
  onOpenVaultRules: () => void;
}

const SCOPE_STYLES: Record<InstructionScope, { label: string; className: string }> = {
  permanent: {
    label: 'Permanent',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
  project: {
    label: 'Project',
    className: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  },
  temporary: {
    label: 'Temporary',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
};

function formatExpiry(expiresAt?: string | null): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return null;
  const diffMin = Math.round((ms - Date.now()) / 60000);
  if (diffMin <= 0) return 'Expired';
  if (diffMin < 60) return `Expires in ${diffMin}m`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 48) return `Expires in ${diffHours}h`;
  return `Expires ${new Date(ms).toLocaleDateString()}`;
}

export const ThreadRulesDrawer: React.FC<ThreadRulesDrawerProps> = ({
  isOpen,
  onClose,
  threadId,
  projectKey,
  manifest,
  isLoading = false,
  error = null,
  onRefresh,
  onUpdateProjectKey,
  onToggleRuleActive,
  onOpenVaultRules,
}) => {
  const [projectDraft, setProjectDraft] = useState(projectKey || '');
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [togglingRuleId, setTogglingRuleId] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setProjectDraft(projectKey || '');
    setLocalError(null);
  }, [projectKey, isOpen, threadId]);

  if (!isOpen) return null;

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProject(true);
    setLocalError(null);
    try {
      const normalized = projectDraft.trim() || null;
      await onUpdateProjectKey(normalized);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to update thread project scope.');
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleToggleRule = async (ruleId: number, nextActive: boolean) => {
    setTogglingRuleId(ruleId);
    setLocalError(null);
    try {
      await onToggleRuleActive(ruleId, nextActive);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to update rule state.');
    } finally {
      setTogglingRuleId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Conversation instruction scope inspector"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0 bg-slate-50/70 dark:bg-slate-900/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                Applied Conversation Rules
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Deterministic pre-generation instruction resolution
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => { void onRefresh(); }}
              className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Refresh instruction resolution"
              aria-label="Refresh instruction resolution"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              aria-label="Close rules drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Precedence Ladder */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Enforced Precedence Order
              </span>
              {manifest && (
                <span className="font-mono tabular-nums text-[10px] text-slate-500">
                  {manifest.applied.length} applied
                </span>
              )}
            </div>
            <div className="text-[11px] font-medium text-slate-800 dark:text-slate-200 font-mono">
              System/Safety &gt; Permanent &gt; Project &gt; Temporary
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Lower scopes cannot override higher-precedence constraints. Project rules never leak across unrelated threads.
            </p>
          </div>

          {/* Thread Project Scope Binding */}
          <form
            onSubmit={handleSaveProject}
            className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2 bg-white dark:bg-slate-950"
          >
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="thread-project-scope-input"
                className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200"
              >
                <FolderGit2 className="w-3.5 h-3.5 text-indigo-500" />
                <span>Thread Project Scope</span>
              </label>
              {projectKey && (
                <button
                  type="button"
                  onClick={async () => {
                    setProjectDraft('');
                    setIsSavingProject(true);
                    try {
                      await onUpdateProjectKey(null);
                    } finally {
                      setIsSavingProject(false);
                    }
                  }}
                  className="text-[11px] text-slate-500 hover:text-rose-500 transition"
                >
                  Clear binding
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                id="thread-project-scope-input"
                type="text"
                value={projectDraft}
                onChange={(e) => setProjectDraft(e.target.value)}
                placeholder="e.g. twinmind-ai, uniace (empty = global only)"
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={isSavingProject}
                className="px-3 py-2 min-h-[36px] rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition disabled:opacity-50"
              >
                {isSavingProject ? 'Saving...' : 'Apply'}
              </button>
            </div>
          </form>

          {(error || localError) && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{localError || error}</span>
            </div>
          )}

          {isLoading && !manifest ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
              <span>Resolving active instructions...</span>
            </div>
          ) : !manifest ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 p-6 text-center text-slate-500 space-y-2">
              <Shield className="w-6 h-6 mx-auto text-slate-400" />
              <p>No instruction resolution snapshot loaded for this conversation yet.</p>
            </div>
          ) : (
            <>
              {/* 1. Applied Rules */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    Applied Instructions ({manifest.applied.length})
                  </h3>
                  <span className="text-[10px] font-mono tabular-nums text-slate-500">
                    Perm {manifest.scopeCounts.permanent} · Proj {manifest.scopeCounts.project} · Temp {manifest.scopeCounts.temporary}
                  </span>
                </div>

                {manifest.applied.length === 0 ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-3">
                    No active user directives currently apply to this thread.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {manifest.applied.map((rule) => {
                      const scopeMeta = SCOPE_STYLES[rule.scope];
                      const expiryLabel = formatExpiry(rule.expires_at);
                      return (
                        <div
                          key={rule.id}
                          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 p-3 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${scopeMeta.className}`}
                              >
                                {scopeMeta.label}
                                {rule.scope === 'project' && rule.project_key ? `: ${rule.project_key}` : ''}
                              </span>
                              <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                #{rule.id} · P{rule.priority} · {rule.category}
                              </span>
                            </div>

                            <button
                              type="button"
                              disabled={togglingRuleId === rule.id}
                              onClick={() => { void handleToggleRule(rule.id, false); }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 text-[10px] font-medium text-slate-600 dark:text-slate-300 transition disabled:opacity-50"
                              title="Deactivate this rule"
                            >
                              <Power className="w-3 h-3" />
                              <span>Pause</span>
                            </button>
                          </div>

                          <p className="text-slate-800 dark:text-slate-100 leading-relaxed">
                            {rule.content}
                          </p>

                          {expiryLabel && (
                            <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-mono">
                              <Clock className="w-3 h-3" />
                              <span>{expiryLabel}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* 2. Overridden Conflicts */}
              {manifest.overridden.length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Overridden Conflicts ({manifest.overridden.length})</span>
                  </h3>
                  <div className="space-y-2">
                    {manifest.overridden.map((rule) => (
                      <div
                        key={`overridden-${rule.id}`}
                        className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-amber-700 dark:text-amber-300">
                          <span>
                            #{rule.id} · {SCOPE_STYLES[rule.scope].label} · P{rule.priority}
                          </span>
                          {rule.overriddenByRuleId && (
                            <span>Overridden by #{rule.overriddenByRuleId}</span>
                          )}
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 line-through opacity-80">
                          {rule.content}
                        </p>
                        <p className="text-[11px] text-amber-800 dark:text-amber-200">
                          {rule.explanation}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 3. Excluded Instructions */}
              {manifest.excluded.length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-slate-400" />
                    <span>Excluded from This Thread ({manifest.excluded.length})</span>
                  </h3>
                  <div className="space-y-2">
                    {manifest.excluded.map((rule) => (
                      <div
                        key={`excluded-${rule.id}`}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-3 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono text-slate-500">
                            #{rule.id} · {SCOPE_STYLES[rule.scope].label} · {rule.reason.replace(/_/g, ' ')}
                          </span>
                          {rule.reason === 'inactive' && (
                            <button
                              type="button"
                              disabled={togglingRuleId === rule.id}
                              onClick={() => { void handleToggleRule(rule.id, true); }}
                              className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-50"
                            >
                              Reactivate
                            </button>
                          )}
                        </div>
                        <p className="text-slate-700 dark:text-slate-300">{rule.content}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {rule.explanation}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 shrink-0 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Create, edit, or expire rules centrally
          </span>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenVaultRules();
            }}
            className="px-3 py-2 min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition"
          >
            Open Vault Active Rules
          </button>
        </div>
      </div>
    </div>
  );
};
