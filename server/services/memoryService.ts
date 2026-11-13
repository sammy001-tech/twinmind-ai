import { randomUUID } from 'node:crypto';
import { neonDb } from '../db/neonService.ts';
import { settingsManager } from '../db/settingsService.ts';
import {
  normalizeInstructionScope,
  normalizeProjectKey,
  resolveInstructions,
  type InstructionResolutionContext,
} from './instructionRegistryService.ts';
import type {
  AutonomousMemoryEvent,
  InstructionResolutionManifest,
  InstructionScope,
  PersonaMemoryRecord,
} from '../../src/types/index.ts';

export type PersonaMemoryCategory = 'preference' | 'opinion' | 'correction' | 'feedback';

export const SUPPORTED_PERSONA_MEMORY_CATEGORIES: readonly PersonaMemoryCategory[] = [
  'preference',
  'opinion',
  'correction',
  'feedback',
] as const;

export interface ExtractedMemoryCandidate {
  category: PersonaMemoryCategory;
  content: string;
  priority: number;
}

export interface PersonaMemory extends ExtractedMemoryCandidate {
  id: number;
  scope?: InstructionScope;
  project_key?: string | null;
  thread_id?: string | null;
  expires_at?: string | null;
  is_active?: boolean;
  superseded_by_id?: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ExistingPersonaRule {
  id: number;
  category: string;
  content: string;
  priority: number;
  scope?: InstructionScope;
  project_key?: string | null;
  thread_id?: string | null;
  expires_at?: string | null;
  is_active?: boolean;
  superseded_by_id?: number | null;
}

export type ActiveRuleOperation =
  | {
      action: 'add';
      category: PersonaMemoryCategory;
      content: string;
      priority: number;
    }
  | {
      action: 'update';
      id: number;
      category?: PersonaMemoryCategory;
      content: string;
      priority?: number;
    }
  | {
      action: 'delete';
      id: number;
    };

export interface ActiveRuleStore {
  listRules: (limit?: number) => Promise<ExistingPersonaRule[]>;
  addRule: (rule: {
    category: PersonaMemoryCategory;
    content: string;
    priority?: number;
    scope?: InstructionScope;
    project_key?: string | null;
    thread_id?: string | null;
    expires_at?: string | null;
    is_active?: boolean;
    metadata?: Record<string, unknown>;
  }) => Promise<number | null>;
  updateRule: (
    id: number,
    patch: {
      category?: PersonaMemoryCategory;
      content?: string;
      priority?: number;
      scope?: InstructionScope;
      project_key?: string | null;
      thread_id?: string | null;
      expires_at?: string | null;
      is_active?: boolean;
    }
  ) => Promise<boolean>;
  deleteRule: (id: number) => Promise<boolean>;
}

export interface ExtractMemoriesOptions {
  provider?: 'gemini' | 'groq' | 'mistral' | string;
  model?: string;
  userName?: string;
  signal?: AbortSignal;
}

const DEFAULT_PRIORITY_BY_CATEGORY: Record<PersonaMemoryCategory, number> = {
  correction: 5,
  preference: 4,
  opinion: 3,
  feedback: 2,
};

function normalizeRuleText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractSignificantRuleTokens(value: string): string[] {
  return normalizeRuleText(value)
    .split(' ')
    .filter((token) => token.length >= 3);
}

function computeRuleTokenSimilarity(a: string, b: string): number {
  const normA = normalizeRuleText(a);
  const normB = normalizeRuleText(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const tokensA = new Set(extractSignificantRuleTokens(normA));
  const tokensB = new Set(extractSignificantRuleTokens(normB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;
  for (const tok of tokensA) {
    if (tokensB.has(tok)) shared++;
  }
  const unionSize = new Set([...tokensA, ...tokensB]).size;
  return unionSize > 0 ? shared / unionSize : 0;
}

/**
 * Pure function: build an identity-neutral memory extraction prompt.
 * Replaces hardcoded names with the configured user identity or 'the user'.
 */
export function buildMemoryExtractionPrompt(
  userMessage: string,
  assistantMessage: string,
  userName?: string
): string {
  const userLabel = userName && userName.trim() ? userName.trim() : 'the user';

  return `As a specialized Persona Memory Extractor, analyze the following exchange between ${userLabel} and their AI digital twin companion.
Your goal is to identify any EXPLICIT preferences, opinions, feedback, or corrections ${userLabel} shares about themselves, their workflow, or the digital twin's behavior.

User Message: "${userMessage}"
Twin Response: "${assistantMessage}"

Look strictly for:
1. Preferences: "I like...", "I prefer...", "I don't use..."
2. Opinions: "I think X is better than Y", "I value..."
3. Corrections: "Don't call me that", "You're too formal", "Actually, I'm not X"
4. Feedback: "Good job", "This was too long", "I like this style"

Return a JSON array of objects with 'category', 'content', and 'priority' (1-5).
Category must be strictly one of: 'preference', 'opinion', 'correction', 'feedback'.
Priority scale:
- 'correction': 5
- 'preference': 4
- 'opinion': 3
- 'feedback': 2

Content must be a concise, objective 3rd-person factual summary (e.g., "${userLabel} prefers concise summaries on Telegram.").
Do not infer traits that were not explicitly stated.
If nothing new, explicit, or relevant was stated, return an empty array [].
Respond ONLY with the JSON array.`;
}

/**
 * Pure function: state-aware prompt that shows existing Active Rules with their IDs
 * so every conversation evaluates whether to keep (return []), add, update in-place, or delete rules.
 */
export function buildStatefulMemoryExtractionPrompt(
  userMessage: string,
  assistantMessage: string,
  existingRules: ExistingPersonaRule[],
  userName?: string
): string {
  const userLabel = userName && userName.trim() ? userName.trim() : 'the user';
  const rulesBlock = existingRules.length > 0
    ? existingRules
        .map((r) => `- [ID: ${r.id}] (${r.category}, priority ${r.priority}) ${r.content}`)
        .join('\n')
    : 'None stored yet.';

  return `As a State-Aware Active Rule Engine, evaluate the latest exchange between ${userLabel} and their AI companion against the CURRENT ACTIVE RULES stored in the database.

CURRENT ACTIVE RULES:
${rulesBlock}

LATEST EXCHANGE:
User Message: "${userMessage}"
Assistant Response: "${assistantMessage}"

INSTRUCTIONS (STRICT ZERO-CLUTTER POLICY):
- If the exchange contains NO new, modified, or retracted explicit preference, correction, opinion, or feedback—OR if the stated rule is already accurately covered by an existing rule—return []. Do NOT create duplicate entries.
- If the exchange refines, narrows, expands, or reverses an existing rule in CURRENT ACTIVE RULES, emit an "update" operation using that rule's exact numeric "id" and the updated consolidated "content".
- If ${userLabel} explicitly withdraws or cancels an existing rule in CURRENT ACTIVE RULES, emit a "delete" operation with its exact numeric "id".
- Only emit an "add" operation when a genuinely net-new explicit standing preference, correction, opinion, or style rule was stated that is not already covered.
- Do not infer unstated personality traits. Never include raw conversation logs.

Return ONLY a JSON array of operations. Each element must use one of:
1. {"action":"add","category":"preference|opinion|correction|feedback","content":"concise 3rd-person rule","priority":1-5}
2. {"action":"update","id":123,"category":"preference|opinion|correction|feedback","content":"revised consolidated rule","priority":1-5}
3. {"action":"delete","id":123}

If no changes are warranted, respond with [].`;
}

/**
 * Pure function: validates and normalizes an extracted memory item.
 * Ensures supported category, non-empty trimmed content, and bounded priority.
 * Returns null for malformed or invalid inputs.
 */
export function validateAndNormalizeMemory(raw: unknown): ExtractedMemoryCandidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  const rawCat = typeof obj.category === 'string' ? obj.category.trim().toLowerCase() : '';
  if (!SUPPORTED_PERSONA_MEMORY_CATEGORIES.includes(rawCat as PersonaMemoryCategory)) {
    return null;
  }
  const category = rawCat as PersonaMemoryCategory;

  if (typeof obj.content !== 'string') {
    return null;
  }
  const content = obj.content.trim();
  if (content.length === 0 || content.length > 1000) {
    return null;
  }

  let priority: number;
  if (typeof obj.priority === 'number' && Number.isInteger(obj.priority) && obj.priority >= 1 && obj.priority <= 5) {
    priority = obj.priority;
  } else {
    priority = DEFAULT_PRIORITY_BY_CATEGORY[category];
  }

  return {
    category,
    content,
    priority,
  };
}

function parseJsonArrayFromModelText(rawJsonText: string): unknown[] {
  if (!rawJsonText || typeof rawJsonText !== 'string') return [];

  const cleaned = rawJsonText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      try {
        parsed = JSON.parse(arrayMatch[0]);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Pure function: parses and validates model JSON text into validated memory candidates.
 */
export function parseExtractedMemories(rawJsonText: string): ExtractedMemoryCandidate[] {
  const parsed = parseJsonArrayFromModelText(rawJsonText);
  if (parsed.length === 0) return [];

  const valid: ExtractedMemoryCandidate[] = [];
  for (const item of parsed) {
    const candidate = validateAndNormalizeMemory(item);
    if (candidate) {
      const isDuplicate = valid.some(
        (v) => v.category === candidate.category && v.content.toLowerCase() === candidate.content.toLowerCase()
      );
      if (!isDuplicate) {
        valid.push(candidate);
      }
    }
  }

  return valid;
}

/**
 * Pure validator & deduplicator for state-aware Active Rule operations (`add` / `update` / `delete`).
 * Rejects invented IDs, no-op updates, and duplicate/near-duplicate additions against existing rules.
 */
export function parseStatefulMemoryOperations(
  rawJsonText: string,
  existingRules: ExistingPersonaRule[] = []
): ActiveRuleOperation[] {
  const parsed = parseJsonArrayFromModelText(rawJsonText);
  if (parsed.length === 0) return [];

  const existingById = new Map<number, ExistingPersonaRule>();
  for (const rule of existingRules) {
    if (Number.isSafeInteger(rule.id) && rule.id > 0) {
      existingById.set(rule.id, rule);
    }
  }

  const opsByRuleId = new Map<number, ActiveRuleOperation>();
  const addOps: Array<Extract<ActiveRuleOperation, { action: 'add' }>> = [];

  for (const rawItem of parsed) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
    const obj = rawItem as Record<string, unknown>;
    const rawAction = typeof obj.action === 'string' ? obj.action.trim().toLowerCase() : 'add';

    if (rawAction === 'delete' || rawAction === 'remove') {
      const id = Number(obj.id);
      if (!Number.isSafeInteger(id) || !existingById.has(id)) continue;
      opsByRuleId.set(id, { action: 'delete', id });
      continue;
    }

    if (rawAction === 'update') {
      const id = Number(obj.id);
      const existing = Number.isSafeInteger(id) ? existingById.get(id) : undefined;
      if (!existing) continue;

      const content = typeof obj.content === 'string' ? obj.content.trim() : '';
      if (!content || content.length > 1000) continue;

      const rawCat = typeof obj.category === 'string' ? obj.category.trim().toLowerCase() : existing.category;
      const category: PersonaMemoryCategory = SUPPORTED_PERSONA_MEMORY_CATEGORIES.includes(rawCat as PersonaMemoryCategory)
        ? (rawCat as PersonaMemoryCategory)
        : (SUPPORTED_PERSONA_MEMORY_CATEGORIES.includes(existing.category as PersonaMemoryCategory)
            ? (existing.category as PersonaMemoryCategory)
            : 'preference');

      const priority =
        typeof obj.priority === 'number' && Number.isInteger(obj.priority) && obj.priority >= 1 && obj.priority <= 5
          ? obj.priority
          : existing.priority;

      const sameText = normalizeRuleText(content) === normalizeRuleText(existing.content);
      const sameCategory = category === existing.category;
      const samePriority = priority === existing.priority;
      if (sameText && sameCategory && samePriority) continue;

      opsByRuleId.set(id, {
        action: 'update',
        id,
        category,
        content,
        priority,
      });
      continue;
    }

    if (rawAction === 'add' || rawAction === 'create') {
      const candidate = validateAndNormalizeMemory(obj);
      if (!candidate) continue;

      // Guard against adding a duplicate or near-duplicate of an already stored rule
      const matchingExisting = existingRules.find(
        (rule) => computeRuleTokenSimilarity(rule.content, candidate.content) >= 0.72
      );
      if (matchingExisting) {
        const isVirtuallyIdentical =
          normalizeRuleText(matchingExisting.content) === normalizeRuleText(candidate.content) ||
          computeRuleTokenSimilarity(matchingExisting.content, candidate.content) >= 0.9;
        if (isVirtuallyIdentical) {
          continue;
        }
        // Evolve existing rule in-place rather than stacking near-duplicate entries
        opsByRuleId.set(matchingExisting.id, {
          action: 'update',
          id: matchingExisting.id,
          category: candidate.category,
          content: candidate.content,
          priority: candidate.priority,
        });
        continue;
      }

      const duplicateInBatch = addOps.some(
        (added) =>
          added.category === candidate.category &&
          (normalizeRuleText(added.content) === normalizeRuleText(candidate.content) ||
            computeRuleTokenSimilarity(added.content, candidate.content) >= 0.85)
      );
      if (!duplicateInBatch) {
        addOps.push({
          action: 'add',
          category: candidate.category,
          content: candidate.content,
          priority: candidate.priority,
        });
      }
    }
  }

  return [...opsByRuleId.values(), ...addOps];
}

export interface ApplyRuleOperationsResult {
  appliedCount: number;
  added: Array<{ id: number; category: PersonaMemoryCategory; content: string; priority: number }>;
  updated: Array<{ id: number; category: PersonaMemoryCategory; content: string; priority: number }>;
  deleted: number[];
  errors: string[];
}

export async function applyActiveRuleOperations(
  operations: ActiveRuleOperation[],
  store: ActiveRuleStore,
  auditMeta: Record<string, unknown> = {}
): Promise<ApplyRuleOperationsResult> {
  const result: ApplyRuleOperationsResult = {
    appliedCount: 0,
    added: [],
    updated: [],
    deleted: [],
    errors: [],
  };

  for (const op of operations) {
    if (op.action === 'delete') {
      const ok = await store.deleteRule(op.id);
      if (ok) {
        result.deleted.push(op.id);
        result.appliedCount++;
      } else {
        result.errors.push(`Failed to delete Active Rule #${op.id}.`);
      }
    } else if (op.action === 'update') {
      const ok = await store.updateRule(op.id, {
        category: op.category,
        content: op.content,
        priority: op.priority,
      });
      if (ok) {
        result.updated.push({
          id: op.id,
          category: op.category || 'preference',
          content: op.content,
          priority: op.priority ?? 3,
        });
        result.appliedCount++;
      } else {
        result.errors.push(`Failed to update Active Rule #${op.id}.`);
      }
    } else if (op.action === 'add') {
      const insertedId = await store.addRule({
        category: op.category,
        content: op.content,
        priority: op.priority,
        metadata: auditMeta,
      });
      if (insertedId && insertedId > 0) {
        result.added.push({
          id: insertedId,
          category: op.category,
          content: op.content,
          priority: op.priority,
        });
        result.appliedCount++;
      } else {
        result.errors.push(`Failed to persist new Active Rule "${op.content.slice(0, 60)}".`);
      }
    }
  }

  return result;
}

export interface ManageActiveRulesToolInput {
  action?: unknown;
  ruleId?: unknown;
  matchText?: unknown;
  category?: unknown;
  content?: unknown;
  priority?: unknown;
  scope?: unknown;
  projectKey?: unknown;
  threadId?: unknown;
  expiresAt?: unknown;
}

const neonActiveRuleStore: ActiveRuleStore = {
  listRules: (limit = 100) => neonDb.getPersonaMemories(limit),
  addRule: (rule) => neonDb.savePersonaMemory(rule),
  updateRule: (id, patch) => neonDb.updatePersonaMemory(id, patch),
  deleteRule: (id) => neonDb.deletePersonaMemory(id),
};

export async function executeManageActiveRules(
  raw: ManageActiveRulesToolInput,
  store: ActiveRuleStore = neonActiveRuleStore
): Promise<{
  status: 'success' | 'error';
  code?: string;
  error?: string;
  rules?: ExistingPersonaRule[];
  memoryEvent?: AutonomousMemoryEvent;
  message?: string;
}> {
  const action = typeof raw.action === 'string' ? raw.action.trim().toLowerCase() : '';
  const existing = await store.listRules(100);

  if (action === 'list') {
    return {
      status: 'success',
      rules: existing,
      message: `${existing.length} active behavioral rule(s) currently stored.`,
    };
  }

  if (action !== 'add' && action !== 'update' && action !== 'delete') {
    return {
      status: 'error',
      code: 'ACTIVE_RULE_ACTION_INVALID',
      error: 'manageActiveRules action must be one of "add", "update", "delete", or "list".',
    };
  }

  const findTargetRule = (): ExistingPersonaRule | undefined => {
    const numericId = raw.ruleId !== undefined && raw.ruleId !== null && raw.ruleId !== '' ? Number(raw.ruleId) : NaN;
    if (Number.isSafeInteger(numericId) && numericId > 0) {
      const byId = existing.find((r) => r.id === numericId);
      if (byId) return byId;
    }

    const matchHint = typeof raw.matchText === 'string' ? raw.matchText.trim() : '';
    const contentHint = typeof raw.content === 'string' ? raw.content.trim() : '';
    const query = matchHint || contentHint;
    if (!query) return undefined;

    const queryNorm = normalizeRuleText(query);
    const substringMatch = existing.find((r) => {
      const ruleNorm = normalizeRuleText(r.content);
      return (
        ruleNorm === queryNorm ||
        (queryNorm.length >= 4 && ruleNorm.includes(queryNorm)) ||
        (ruleNorm.length >= 4 && queryNorm.includes(ruleNorm))
      );
    });
    if (substringMatch) return substringMatch;

    let bestRule: ExistingPersonaRule | undefined;
    let bestSim = 0;
    for (const rule of existing) {
      const sim = computeRuleTokenSimilarity(rule.content, query);
      if (sim > bestSim) {
        bestSim = sim;
        bestRule = rule;
      }
    }
    return bestSim >= 0.45 ? bestRule : undefined;
  };

  if (action === 'delete') {
    const target = findTargetRule();
    if (!target) {
      return {
        status: 'error',
        code: 'ACTIVE_RULE_NOT_FOUND',
        error: 'No matching Active Rule was found to delete.',
      };
    }

    const ok = await store.deleteRule(target.id);
    if (!ok) {
      return {
        status: 'error',
        code: 'ACTIVE_RULE_PERSISTENCE_FAILED',
        error: `Failed to delete Active Rule #${target.id}. Verify database connectivity.`,
      };
    }

    return {
      status: 'success',
      message: `Removed Active Rule #${target.id}: "${target.content}"`,
      memoryEvent: {
        id: `mem-rule-${randomUUID()}`,
        action: 'remove_rule',
        target: 'rule',
        ruleId: target.id,
        docId: 'rules',
        docTitle: 'Active Behavioral Rules',
        category: target.category,
        confidenceScore: 100,
        tier: 'preference',
        summary: `Removed rule #${target.id}: ${target.content}`,
        previousContent: target.content,
        userStatementSnippet: target.content,
        timestamp: new Date().toISOString(),
      },
    };
  }

  const rawCat = typeof raw.category === 'string' ? raw.category.trim().toLowerCase() : '';
  const content = typeof raw.content === 'string' ? raw.content.trim() : '';
  if (!content || content.length > 1000) {
    return {
      status: 'error',
      code: 'ACTIVE_RULE_CONTENT_REQUIRED',
      error: 'Active Rule content must be a non-empty string under 1000 characters.',
    };
  }

  const scope = raw.scope !== undefined ? normalizeInstructionScope(raw.scope) : undefined;
  const projectKey = raw.projectKey !== undefined ? normalizeProjectKey(raw.projectKey) : undefined;
  const threadId = typeof raw.threadId === 'string' && raw.threadId.trim() ? raw.threadId.trim() : undefined;
  const expiresAt = typeof raw.expiresAt === 'string' && raw.expiresAt.trim() ? raw.expiresAt.trim() : undefined;

  if (action === 'update') {
    const target = findTargetRule();
    if (!target) {
      return {
        status: 'error',
        code: 'ACTIVE_RULE_NOT_FOUND',
        error: 'No matching Active Rule was found to update. Provide ruleId or matchText from current rules.',
      };
    }

    const category: PersonaMemoryCategory = SUPPORTED_PERSONA_MEMORY_CATEGORIES.includes(rawCat as PersonaMemoryCategory)
      ? (rawCat as PersonaMemoryCategory)
      : (SUPPORTED_PERSONA_MEMORY_CATEGORIES.includes(target.category as PersonaMemoryCategory)
          ? (target.category as PersonaMemoryCategory)
          : 'preference');

    const priority =
      typeof raw.priority === 'number' && Number.isInteger(raw.priority) && raw.priority >= 1 && raw.priority <= 5
        ? raw.priority
        : target.priority;

    const ok = await store.updateRule(target.id, {
      category,
      content,
      priority,
      ...(scope !== undefined ? { scope } : {}),
      ...(projectKey !== undefined ? { project_key: projectKey } : {}),
      ...(threadId !== undefined ? { thread_id: threadId } : {}),
      ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
      is_active: true,
    });
    if (!ok) {
      return {
        status: 'error',
        code: 'ACTIVE_RULE_PERSISTENCE_FAILED',
        error: `Failed to update Active Rule #${target.id}. Verify database connectivity.`,
      };
    }

    return {
      status: 'success',
      message: `Updated Active Rule #${target.id} (${category}): "${content}"`,
      memoryEvent: {
        id: `mem-rule-${randomUUID()}`,
        action: 'update_existing',
        target: 'rule',
        ruleId: target.id,
        docId: `rule-${target.id}`,
        docTitle: 'Active Behavioral Rules',
        category,
        confidenceScore: 100,
        tier: 'preference',
        summary: `Updated rule #${target.id}: ${content}`,
        previousContent: target.content,
        updatedContent: content,
        userStatementSnippet: content,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // action === 'add' (dedupe / upgrade to in-place update if matching existing rule)
  const category: PersonaMemoryCategory = SUPPORTED_PERSONA_MEMORY_CATEGORIES.includes(rawCat as PersonaMemoryCategory)
    ? (rawCat as PersonaMemoryCategory)
    : 'preference';
  const priority =
    typeof raw.priority === 'number' && Number.isInteger(raw.priority) && raw.priority >= 1 && raw.priority <= 5
      ? raw.priority
      : DEFAULT_PRIORITY_BY_CATEGORY[category];

  const existingSimilar = existing.find((r) => computeRuleTokenSimilarity(r.content, content) >= 0.72);
  if (existingSimilar) {
    const ok = await store.updateRule(existingSimilar.id, {
      category,
      content,
      priority,
      ...(scope !== undefined ? { scope } : {}),
      ...(projectKey !== undefined ? { project_key: projectKey } : {}),
      ...(threadId !== undefined ? { thread_id: threadId } : {}),
      ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
      is_active: true,
    });
    if (!ok) {
      return {
        status: 'error',
        code: 'ACTIVE_RULE_PERSISTENCE_FAILED',
        error: `Failed to update matching Active Rule #${existingSimilar.id}.`,
      };
    }
    return {
      status: 'success',
      message: `Updated existing Active Rule #${existingSimilar.id} in-place: "${content}"`,
      memoryEvent: {
        id: `mem-rule-${randomUUID()}`,
        action: 'update_existing',
        target: 'rule',
        ruleId: existingSimilar.id,
        docId: `rule-${existingSimilar.id}`,
        docTitle: 'Active Behavioral Rules',
        category,
        confidenceScore: 100,
        tier: 'preference',
        summary: `Updated rule #${existingSimilar.id}: ${content}`,
        previousContent: existingSimilar.content,
        updatedContent: content,
        userStatementSnippet: content,
        timestamp: new Date().toISOString(),
      },
    };
  }

  const effectiveScope: InstructionScope = scope || 'permanent';
  const insertedId = await store.addRule({
    category,
    content,
    priority,
    scope: effectiveScope,
    project_key: projectKey ?? null,
    thread_id: threadId ?? null,
    expires_at: expiresAt ?? null,
    is_active: true,
    metadata: { source: 'in_turn_tool' },
  });
  if (!insertedId || insertedId <= 0) {
    return {
      status: 'error',
      code: 'ACTIVE_RULE_PERSISTENCE_FAILED',
      error: 'Failed to save Active Rule to Neon PostgreSQL. Verify database connectivity.',
    };
  }

  return {
    status: 'success',
    message: `Added Active Rule #${insertedId} (${category}): "${content}"`,
    memoryEvent: {
      id: `mem-rule-${randomUUID()}`,
      action: 'create_new',
      target: 'rule',
      ruleId: insertedId,
      docId: `rule-${insertedId}`,
      docTitle: 'Active Behavioral Rules',
      category,
      confidenceScore: 100,
      tier: 'preference',
      summary: `Added rule #${insertedId}: ${content}`,
      updatedContent: content,
      userStatementSnippet: content,
      timestamp: new Date().toISOString(),
    },
  };
}

class MemoryService {
  /**
   * Analyze the latest interaction using the active AI provider against current stored
   * Active Rules so preferences, corrections, and style feedback evolve in-place every turn
   * without stacking duplicates.
   */
  public async extractMemoriesFromInteraction(
    userMessage: string,
    assistantMessage: string,
    options?: ExtractMemoriesOptions | string
  ): Promise<ExtractedMemoryCandidate[]> {
    if (!userMessage || userMessage.trim().length < 5) return [];

    const opts: ExtractMemoriesOptions = typeof options === 'string'
      ? { model: options }
      : (options || {});

    const s = settingsManager.getSettings();
    const effectiveProvider = (opts.provider || s.activeProvider || 'gemini').toLowerCase() as 'gemini' | 'groq' | 'mistral';
    const effectiveModel = opts.model || s.providerModels[effectiveProvider] || s.activeModel;
    const effectiveUser = (opts.userName || s.nickname || s.userName || '').trim();

    try {
      const existingRules = await neonDb.getPersonaMemories(100);
      const extractionPrompt = buildStatefulMemoryExtractionPrompt(
        userMessage,
        assistantMessage,
        existingRules,
        effectiveUser
      );

      const { twinAgentService } = await import('./twinAgentService.ts');
      const responseText = await twinAgentService.generateCompletion({
        prompt: extractionPrompt,
        systemInstruction: 'You are a state-aware active rule updater. Return only a valid JSON array of add/update/delete operations, or [] if unchanged.',
        provider: effectiveProvider,
        model: effectiveModel,
        temperature: 0.1,
        jsonMode: true,
        signal: opts.signal,
      });

      const operations = parseStatefulMemoryOperations(responseText, existingRules);
      if (operations.length === 0) return [];

      const outcome = await applyActiveRuleOperations(operations, neonActiveRuleStore, {
        source_user_msg: userMessage.slice(0, 200),
        extracted_by_provider: effectiveProvider,
        extracted_by_model: effectiveModel || 'unspecified',
      });

      for (const added of outcome.added) {
        console.log(`[MemoryService] Added Active Rule #${added.id} [${added.category}]: ${added.content}`);
      }
      for (const updated of outcome.updated) {
        console.log(`[MemoryService] Updated Active Rule #${updated.id} [${updated.category}]: ${updated.content}`);
      }
      for (const deletedId of outcome.deleted) {
        console.log(`[MemoryService] Deleted Active Rule #${deletedId}`);
      }
      if (outcome.errors.length > 0) {
        console.warn('[MemoryService] Active rule persistence warnings:', outcome.errors.join('; '));
      }

      return [
        ...outcome.updated.map((u) => ({ category: u.category, content: u.content, priority: u.priority })),
        ...outcome.added.map((a) => ({ category: a.category, content: a.content, priority: a.priority })),
      ];
    } catch (err) {
      console.warn('[MemoryService] Memory extraction failed (skipping):', err);
      return [];
    }
  }

  /**
   * Deterministically resolve Permanent > Project > Temporary instructions for the active thread,
   * automatically expiring stale temporary rules and returning both prompt block & inspection manifest.
   */
  public async resolveInstructionsForThread(
    context: InstructionResolutionContext = {}
  ): Promise<{ manifest: InstructionResolutionManifest; promptBlock: string }> {
    const rows = await neonDb.getPersonaMemories(150);
    let projectKey = context.projectKey;
    if (projectKey === undefined && context.threadId) {
      projectKey = await neonDb.getThreadProjectKey(context.threadId).catch(() => null);
    }

    const { manifest, expiredIds, promptBlock } = resolveInstructions(
      rows as unknown as PersonaMemoryRecord[],
      {
        threadId: context.threadId,
        projectKey,
        now: context.now,
      }
    );

    if (expiredIds.length > 0) {
      void neonDb.deactivateExpiredPersonaMemories(expiredIds);
    }

    return { manifest, promptBlock };
  }

  /**
   * Backward-compatible getter delegating to deterministic scoped resolution
   */
  public async getLearnedPersonaContext(context: InstructionResolutionContext = {}): Promise<string> {
    const { promptBlock } = await this.resolveInstructionsForThread(context);
    return promptBlock;
  }
}

export const memoryService = new MemoryService();
