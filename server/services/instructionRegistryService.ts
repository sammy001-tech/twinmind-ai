import type {
  ExcludedInstructionEntry,
  InstructionResolutionManifest,
  InstructionScope,
  PersonaMemoryRecord,
  ResolvedInstructionEntry,
} from '../../src/types/index.ts';

export interface InstructionResolutionContext {
  threadId?: string | null;
  projectKey?: string | null;
  now?: Date;
}

const VALID_SCOPES: readonly InstructionScope[] = ['permanent', 'project', 'temporary'];

export function normalizeInstructionScope(raw: unknown): InstructionScope {
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    if ((VALID_SCOPES as readonly string[]).includes(lower)) {
      return lower as InstructionScope;
    }
  }
  return 'permanent';
}

export function normalizeProjectKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  return trimmed || null;
}

const SCOPE_PRECEDENCE_RANK: Record<InstructionScope, number> = {
  permanent: 1,
  project: 2,
  temporary: 3,
};

const SCOPE_LABEL: Record<InstructionScope, string> = {
  permanent: 'Permanent',
  project: 'Project',
  temporary: 'Temporary',
};

const OPPOSITION_PAIRS: Array<[RegExp, RegExp, string]> = [
  [/\b(concise|brief|short|tl;dr|bullets?\s+only)\b/i, /\b(detailed|comprehensive|thorough|long-form|deep\s+dive|elaborate)\b/i, 'response_verbosity'],
  [/\b(formal|academic|professional)\b/i, /\b(casual|informal|playful|colloquial)\b/i, 'register_tone'],
  [/\b(never|do\s+not|don't|avoid)\s+use\s+(tables?|markdown\s+tables?)\b/i, /\b(always|prefer|use)\s+(tables?|markdown\s+tables?)\b/i, 'table_formatting'],
  [/\b(skip|no|omit)\s+(examples?|quizzes?|practice\s+questions?)\b/i, /\b(always|include|give)\s+(examples?|practice\s+questions?|check\s+answers?)\b/i, 'pedagogical_structure'],
  [/\b(never|do\s+not|don't|skip)\s+(code\s+comments?|comments?)\b/i, /\b(always|include|add)\s+(code\s+comments?|comments?)\b/i, 'code_comments'],
];

const TOPIC_STOPWORDS = new Set([
  'always', 'never', 'prefer', 'please', 'use', 'keep', 'make', 'sure', 'when',
  'with', 'that', 'this', 'from', 'into', 'for', 'the', 'and', 'your', 'responses',
  'answers', 'only', 'avoid', 'include', 'every', 'must', 'should',
]);

function extractRuleTokens(content: string): string[] {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !TOPIC_STOPWORDS.has(t));
}

function hasExplicitNegation(text: string): boolean {
  return /\b(never|do\s+not|don't|avoid|stop|skip|no\s+longer|without)\b/i.test(text);
}

/**
 * Detect whether two instructions govern the same behavioral dimension in incompatible ways.
 */
export function detectRuleConflict(ruleA: string, ruleB: string): { conflicts: boolean; dimension?: string } {
  for (const [patternX, patternY, dimension] of OPPOSITION_PAIRS) {
    if ((patternX.test(ruleA) && patternY.test(ruleB)) || (patternY.test(ruleA) && patternX.test(ruleB))) {
      return { conflicts: true, dimension };
    }
  }

  // Opposite polarity (one positive, one negative) over shared domain tokens
  const negA = hasExplicitNegation(ruleA);
  const negB = hasExplicitNegation(ruleB);
  if (negA !== negB) {
    const tokensA = new Set(extractRuleTokens(ruleA));
    const tokensB = extractRuleTokens(ruleB);
    const shared = tokensB.filter((t) => tokensA.has(t));
    if (shared.length >= 2) {
      return { conflicts: true, dimension: `polarity(${shared.slice(0, 3).join(',')})` };
    }
  }

  return { conflicts: false };
}

/**
 * Deterministic pre-generation instruction resolver.
 * Precedence order (strict, non-overridable from below):
 *   System/Safety (implicit ceiling) > Permanent > Project > Temporary
 * Within the same scope: higher numeric priority wins, then newer timestamp.
 */
export function resolveInstructions(
  records: PersonaMemoryRecord[],
  context: InstructionResolutionContext = {}
): {
  manifest: InstructionResolutionManifest;
  expiredIds: number[];
  promptBlock: string;
} {
  const now = context.now ?? new Date();
  const activeProjectKey = normalizeProjectKey(context.projectKey);
  const activeThreadId = context.threadId?.trim() || null;

  const excluded: ExcludedInstructionEntry[] = [];
  const overridden: ExcludedInstructionEntry[] = [];
  const eligible: Array<PersonaMemoryRecord & { resolvedScope: InstructionScope }> = [];
  const expiredIds: number[] = [];

  for (const rec of records) {
    const scope = normalizeInstructionScope(rec.scope ?? (rec.metadata?.scope as unknown));
    const isActive = rec.is_active !== false;
    const supersededBy = rec.superseded_by_id ?? null;
    const ruleProjectKey = normalizeProjectKey(rec.project_key ?? (rec.metadata?.project_key as unknown));
    const ruleThreadId = (rec.thread_id ?? (rec.metadata?.thread_id as string | undefined) ?? null) || null;
    const expiresAt = rec.expires_at ?? (rec.metadata?.expires_at as string | undefined) ?? null;

    if (!isActive) {
      excluded.push({
        id: rec.id,
        category: rec.category,
        content: rec.content,
        priority: rec.priority,
        scope,
        project_key: ruleProjectKey,
        thread_id: ruleThreadId,
        expires_at: expiresAt,
        reason: 'inactive',
        explanation: 'Excluded: rule is currently deactivated.',
      });
      continue;
    }

    if (supersededBy !== null && supersededBy !== undefined) {
      excluded.push({
        id: rec.id,
        category: rec.category,
        content: rec.content,
        priority: rec.priority,
        scope,
        project_key: ruleProjectKey,
        thread_id: ruleThreadId,
        expires_at: expiresAt,
        reason: 'superseded',
        explanation: `Excluded: superseded by rule #${supersededBy}.`,
        overriddenByRuleId: Number(supersededBy),
      });
      continue;
    }

    if (expiresAt) {
      const expiryMs = Date.parse(expiresAt);
      if (Number.isFinite(expiryMs) && expiryMs <= now.getTime()) {
        expiredIds.push(rec.id);
        excluded.push({
          id: rec.id,
          category: rec.category,
          content: rec.content,
          priority: rec.priority,
          scope,
          project_key: ruleProjectKey,
          thread_id: ruleThreadId,
          expires_at: expiresAt,
          reason: 'expired',
          explanation: `Excluded: temporary rule expired at ${new Date(expiryMs).toISOString()}.`,
        });
        continue;
      }
    }

    if (scope === 'project') {
      if (!ruleProjectKey || !activeProjectKey || ruleProjectKey !== activeProjectKey) {
        excluded.push({
          id: rec.id,
          category: rec.category,
          content: rec.content,
          priority: rec.priority,
          scope,
          project_key: ruleProjectKey,
          thread_id: ruleThreadId,
          expires_at: expiresAt,
          reason: 'wrong_project_scope',
          explanation: activeProjectKey
            ? `Excluded: scoped to project "${ruleProjectKey || 'unspecified'}" (active project is "${activeProjectKey}").`
            : `Excluded: scoped to project "${ruleProjectKey || 'unspecified'}" while no project scope is selected for this thread.`,
        });
        continue;
      }
    }

    if (scope === 'temporary' && ruleThreadId && activeThreadId && ruleThreadId !== activeThreadId) {
      excluded.push({
        id: rec.id,
        category: rec.category,
        content: rec.content,
        priority: rec.priority,
        scope,
        project_key: ruleProjectKey,
        thread_id: ruleThreadId,
        expires_at: expiresAt,
        reason: 'wrong_thread_scope',
        explanation: `Excluded: session rule belongs to another thread (${ruleThreadId}).`,
      });
      continue;
    }

    eligible.push({ ...rec, resolvedScope: scope });
  }

  // Sort strictly by precedence: Permanent (1) > Project (2) > Temporary (3), then priority DESC, then newest DESC
  eligible.sort((a, b) => {
    const sDiff = SCOPE_PRECEDENCE_RANK[a.resolvedScope] - SCOPE_PRECEDENCE_RANK[b.resolvedScope];
    if (sDiff !== 0) return sDiff;

    const pDiff = (b.priority ?? 1) - (a.priority ?? 1);
    if (pDiff !== 0) return pDiff;

    const tsA = Date.parse(a.updated_at || a.created_at || '') || 0;
    const tsB = Date.parse(b.updated_at || b.created_at || '') || 0;
    return tsB - tsA;
  });

  const applied: ResolvedInstructionEntry[] = [];

  for (const candidate of eligible) {
    const conflictingWinner = applied.find((winner) => detectRuleConflict(winner.content, candidate.content).conflicts);
    if (conflictingWinner) {
      const winnerHigherScope =
        SCOPE_PRECEDENCE_RANK[conflictingWinner.scope] < SCOPE_PRECEDENCE_RANK[candidate.resolvedScope];
      overridden.push({
        id: candidate.id,
        category: candidate.category,
        content: candidate.content,
        priority: candidate.priority,
        scope: candidate.resolvedScope,
        project_key: normalizeProjectKey(candidate.project_key),
        thread_id: candidate.thread_id ?? null,
        expires_at: candidate.expires_at ?? null,
        reason: winnerHigherScope ? 'overridden_by_higher_precedence' : 'overridden_by_priority',
        overriddenByRuleId: conflictingWinner.id,
        explanation: winnerHigherScope
          ? `Overridden: ${SCOPE_LABEL[candidate.resolvedScope]} rule cannot override higher-precedence ${SCOPE_LABEL[conflictingWinner.scope]} rule #${conflictingWinner.id}.`
          : `Overridden: superseded within ${SCOPE_LABEL[candidate.resolvedScope]} scope by higher-priority rule #${conflictingWinner.id}.`,
      });
      continue;
    }

    applied.push({
      id: candidate.id,
      category: candidate.category,
      content: candidate.content,
      priority: candidate.priority,
      scope: candidate.resolvedScope,
      project_key: normalizeProjectKey(candidate.project_key),
      thread_id: candidate.thread_id ?? null,
      expires_at: candidate.expires_at ?? null,
      precedenceRank: SCOPE_PRECEDENCE_RANK[candidate.resolvedScope],
      sourceLabel: `${SCOPE_LABEL[candidate.resolvedScope]} · ${candidate.category} · P${candidate.priority}`,
    });
  }

  const scopeCounts = {
    permanent: applied.filter((r) => r.scope === 'permanent').length,
    project: applied.filter((r) => r.scope === 'project').length,
    temporary: applied.filter((r) => r.scope === 'temporary').length,
  };

  const manifest: InstructionResolutionManifest = {
    resolvedAt: now.toISOString(),
    threadId: activeThreadId,
    projectKey: activeProjectKey,
    precedenceOrder: ['system_safety', 'permanent', 'project', 'temporary'],
    applied,
    overridden,
    excluded,
    scopeCounts,
  };

  return {
    manifest,
    expiredIds,
    promptBlock: formatResolvedInstructionsPrompt(manifest),
  };
}

export function formatResolvedInstructionsPrompt(manifest: InstructionResolutionManifest): string {
  if (manifest.applied.length === 0) return '';

  const permanentRules = manifest.applied.filter((r) => r.scope === 'permanent');
  const projectRules = manifest.applied.filter((r) => r.scope === 'project');
  const temporaryRules = manifest.applied.filter((r) => r.scope === 'temporary');

  let out = '\n\n======================================================\n';
  out += 'PERSISTENT INSTRUCTION REGISTRY (DETERMINISTIC PRE-GENERATION RESOLUTION)\n';
  out += '======================================================\n';
  out += 'Precedence enforced by runtime: System/Safety > Permanent > Project > Temporary.\n';
  out += 'Apply ALL resolved directives below consistently throughout this response without needing reminders:\n';

  if (permanentRules.length > 0) {
    out += '\n[PERMANENT INSTRUCTIONS — HIGHEST USER PRECEDENCE]\n';
    out += permanentRules.map((r) => `- [Rule #${r.id} | ${r.category} | P${r.priority}] ${r.content}`).join('\n');
  }

  if (projectRules.length > 0) {
    out += `\n\n[PROJECT INSTRUCTIONS — PROJECT: ${manifest.projectKey}]\n`;
    out += projectRules.map((r) => `- [Rule #${r.id} | ${r.category} | P${r.priority}] ${r.content}`).join('\n');
  }

  if (temporaryRules.length > 0) {
    out += '\n\n[TEMPORARY SESSION INSTRUCTIONS]\n';
    out += temporaryRules.map((r) => `- [Rule #${r.id} | ${r.category} | P${r.priority}] ${r.content}`).join('\n');
  }

  return out;
}
