import { randomUUID } from 'node:crypto';
import { knowledgeService } from '../db/knowledgeService.ts';
import { inferImpactLevelFromCategory } from './memoryGovernanceService.ts';
import type {
  AutonomousMemoryEvent,
  MemoryConfidenceStatus,
  MemoryImpactLevel,
  MemoryLifecycleStatus,
  MemorySourceType,
} from '../../src/types/index.ts';
import type { VaultRevisionAuditMeta } from './vaultVersioningService.ts';

export type VaultUpdateCategory =
  | 'personal_note'
  | 'decision_framework'
  | 'project_brief'
  | 'philosophy'
  | 'reference';

export type VaultUpdateTier = 'architectural' | 'preference' | 'workflow';

export type VaultUpdateMode = 'update_or_create' | 'update_only' | 'remove_rule' | 'retire_doc';

export interface VaultDocumentRecord {
  id: string | number;
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  similarity?: number;
}

export interface VaultMemoryUpdateInput {
  topic?: unknown;
  memoryEntry?: unknown;
  targetTitle?: unknown;
  mode?: unknown;
  category?: unknown;
  tier?: unknown;
}

export interface ValidatedVaultMemoryUpdate {
  topic: string;
  memoryEntry: string;
  targetTitle?: string;
  mode: VaultUpdateMode;
  category: VaultUpdateCategory;
  tier: VaultUpdateTier;
}

export interface VaultMemoryStore {
  search: (query: string, limit?: number, threshold?: number) => Promise<VaultDocumentRecord[]>;
  listDocuments: (category?: string, query?: string, limit?: number) => Promise<VaultDocumentRecord[]>;
  updateDocument: (
    id: string | number,
    patch: {
      title?: string;
      content?: string;
      category?: string;
      tags?: string[];
      lastVerifiedAt?: string | null;
      lifecycleStatus?: MemoryLifecycleStatus;
      confidenceStatus?: MemoryConfidenceStatus;
    },
    audit?: VaultRevisionAuditMeta,
  ) => Promise<boolean>;
  addDocument: (params: {
    title: string;
    content: string;
    category?: string;
    tags?: string[];
    sourceType?: MemorySourceType;
    confidenceStatus?: MemoryConfidenceStatus;
    impactLevel?: MemoryImpactLevel;
    lifecycleStatus?: MemoryLifecycleStatus;
    lastVerifiedAt?: string | null;
  }, audit?: VaultRevisionAuditMeta) => Promise<{ id: string | number; success: boolean; hasEmbedding?: boolean }>;
  deleteDocument: (id: string | number, audit?: VaultRevisionAuditMeta) => Promise<boolean>;
}

const VALID_CATEGORIES: readonly VaultUpdateCategory[] = [
  'personal_note',
  'decision_framework',
  'project_brief',
  'philosophy',
  'reference',
] as const;

const VALID_TIERS: readonly VaultUpdateTier[] = ['architectural', 'preference', 'workflow'] as const;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'our', 'your', 'about',
  'rule', 'rules', 'note', 'notes', 'memory', 'vault', 'update', 'save', 'keep', 'all',
  'forget', 'remove', 'delete',
]);

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractSignificantTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

/**
 * Pure validator for updateMemoryVault tool arguments.
 * Rejects empty entries and prevents raw attached-document dumps from polluting the Vault.
 */
export function validateVaultUpdateInput(
  raw: VaultMemoryUpdateInput
): { valid: true; value: ValidatedVaultMemoryUpdate } | { valid: false; code: string; error: string } {
  const topic = typeof raw.topic === 'string' ? raw.topic.trim() : '';
  const memoryEntry = typeof raw.memoryEntry === 'string' ? raw.memoryEntry.trim() : '';
  const targetTitle = typeof raw.targetTitle === 'string' && raw.targetTitle.trim() ? raw.targetTitle.trim() : undefined;

  const rawMode = typeof raw.mode === 'string' ? raw.mode.trim().toLowerCase() : '';
  const mode: VaultUpdateMode =
    rawMode === 'update_only' || rawMode === 'update_existing'
      ? 'update_only'
      : rawMode === 'remove_rule' || rawMode === 'forget_rule'
        ? 'remove_rule'
        : rawMode === 'retire_doc' || rawMode === 'delete_doc'
          ? 'retire_doc'
          : 'update_or_create';

  if (!topic) {
    return {
      valid: false,
      code: 'VAULT_TOPIC_REQUIRED',
      error: 'A concise topic or memory title is required to update the Vault.',
    };
  }

  if (mode !== 'retire_doc' && (!memoryEntry || memoryEntry.length < 4)) {
    return {
      valid: false,
      code: 'VAULT_ENTRY_REQUIRED',
      error: 'A clear, concise memory rule or factual update is required.',
    };
  }

  if (memoryEntry.length > 2500) {
    return {
      valid: false,
      code: 'VAULT_ENTRY_TOO_LONG',
      error: 'Vault memory updates must be concise synthesized rules or facts (under 2500 characters), not raw document dumps.',
    };
  }

  if (/\[ATTACHED DOCUMENT:/i.test(memoryEntry)) {
    return {
      valid: false,
      code: 'VAULT_RAW_ATTACHMENT_REJECTED',
      error: 'Do not store raw attached document headers or unedited conversation payloads in Vault memory updates.',
    };
  }

  const rawCategory = typeof raw.category === 'string' ? raw.category.trim().toLowerCase() : '';
  const category: VaultUpdateCategory = VALID_CATEGORIES.includes(rawCategory as VaultUpdateCategory)
    ? (rawCategory as VaultUpdateCategory)
    : 'personal_note';

  const rawTier = typeof raw.tier === 'string' ? raw.tier.trim().toLowerCase() : '';
  const tier: VaultUpdateTier = VALID_TIERS.includes(rawTier as VaultUpdateTier)
    ? (rawTier as VaultUpdateTier)
    : 'preference';

  return {
    valid: true,
    value: {
      topic: topic.slice(0, 120),
      memoryEntry: memoryEntry || topic.slice(0, 120),
      targetTitle: targetTitle ? targetTitle.slice(0, 120) : undefined,
      mode,
      category,
      tier,
    },
  };
}

/**
 * Pure matching algorithm across listed Vault documents and semantic search results.
 */
export function selectMatchingVaultDocument(
  docs: VaultDocumentRecord[],
  semanticMatches: VaultDocumentRecord[],
  input: Pick<ValidatedVaultMemoryUpdate, 'topic' | 'targetTitle' | 'memoryEntry'>
): VaultDocumentRecord | null {
  const candidates = new Map<string, VaultDocumentRecord>();
  for (const doc of docs) {
    candidates.set(String(doc.id), doc);
  }
  for (const doc of semanticMatches) {
    const key = String(doc.id);
    if (!candidates.has(key)) {
      candidates.set(key, doc);
    } else {
      const existing = candidates.get(key)!;
      if (typeof doc.similarity === 'number') {
        candidates.set(key, { ...existing, similarity: doc.similarity });
      }
    }
  }

  const all = Array.from(candidates.values());
  if (all.length === 0) return null;

  const targetHint = normalizeText(input.targetTitle || input.topic);
  const topicNorm = normalizeText(input.topic);

  // 1. Exact or substring title match
  for (const doc of all) {
    const docTitleNorm = normalizeText(doc.title);
    if (!docTitleNorm) continue;
    if (docTitleNorm === targetHint || docTitleNorm === topicNorm) {
      return doc;
    }
    if (
      (targetHint.length >= 4 && docTitleNorm.includes(targetHint)) ||
      (docTitleNorm.length >= 4 && targetHint.includes(docTitleNorm))
    ) {
      return doc;
    }
  }

  // 2. Significant token overlap score against title + content + semantic similarity
  const queryTokens = new Set([
    ...extractSignificantTokens(input.targetTitle || ''),
    ...extractSignificantTokens(input.topic),
    ...extractSignificantTokens(input.memoryEntry),
  ]);

  let bestDoc: VaultDocumentRecord | null = null;
  let bestScore = 0;

  for (const doc of all) {
    const titleTokens = extractSignificantTokens(doc.title);
    const contentTokens = new Set(extractSignificantTokens(doc.content.slice(0, 800)));

    let titleOverlap = 0;
    for (const token of titleTokens) {
      if (queryTokens.has(token)) titleOverlap++;
    }

    let contentOverlap = 0;
    for (const token of queryTokens) {
      if (contentTokens.has(token)) contentOverlap++;
    }

    const titleRatio = titleTokens.length > 0 ? titleOverlap / titleTokens.length : 0;
    const semanticBonus = typeof doc.similarity === 'number' && doc.similarity >= 0.5 ? doc.similarity : 0;
    const score = titleRatio * 0.65 + Math.min(contentOverlap, 4) * 0.08 + semanticBonus * 0.55;

    if (score > bestScore && (titleOverlap >= 1 || semanticBonus >= 0.55 || contentOverlap >= 2)) {
      bestScore = score;
      bestDoc = doc;
    }
  }

  if (bestDoc && bestScore >= 0.42) {
    return bestDoc;
  }

  // 3. Fallback to strong top semantic match if vector similarity is high
  const topSemantic = semanticMatches[0];
  if (topSemantic && typeof topSemantic.similarity === 'number' && topSemantic.similarity >= 0.58) {
    return all.find((d) => String(d.id) === String(topSemantic.id)) || topSemantic;
  }

  return null;
}

/**
 * Pure helper to merge an updated rule or fact cleanly into an existing Vault document
 * without duplicating an identical rule.
 */
export function mergeMemoryEntryIntoDocument(
  existingContent: string,
  memoryEntry: string,
  dateStamp = new Date().toISOString().split('T')[0]
): { updatedContent: string; alreadyPresent: boolean } {
  const existingNorm = normalizeText(existingContent);
  const entryNorm = normalizeText(memoryEntry);

  if (entryNorm && existingNorm.includes(entryNorm)) {
    return { updatedContent: existingContent, alreadyPresent: true };
  }

  const trimmedExisting = existingContent.trim();
  const trimmedEntry = memoryEntry.trim();

  if (!trimmedExisting) {
    return { updatedContent: `- (${dateStamp}) ${trimmedEntry}`, alreadyPresent: false };
  }

  return {
    updatedContent: `${trimmedExisting}\n\n- **Updated (${dateStamp}):** ${trimmedEntry}`,
    alreadyPresent: false,
  };
}

/**
 * Pure helper to remove a matching rule/line from an existing Vault document cleanly.
 */
export function removeMemoryEntryFromDocument(
  existingContent: string,
  ruleToRemove: string
): { updatedContent: string; removedCount: number; remainingEmpty: boolean } {
  const targetNorm = normalizeText(ruleToRemove);
  const targetTokens = extractSignificantTokens(ruleToRemove);
  if (!targetNorm && targetTokens.length === 0) {
    return { updatedContent: existingContent, removedCount: 0, remainingEmpty: !existingContent.trim() };
  }

  const lines = existingContent.split(/\r?\n/);
  const keptLines: string[] = [];
  let removedCount = 0;

  for (const line of lines) {
    const lineNorm = normalizeText(line);
    if (!lineNorm) {
      keptLines.push(line);
      continue;
    }

    const directMatch =
      (targetNorm.length >= 6 && lineNorm.includes(targetNorm)) ||
      (lineNorm.length >= 6 && targetNorm.includes(lineNorm));

    let tokenMatch = false;
    if (!directMatch && targetTokens.length >= 2) {
      const lineTokenSet = new Set(extractSignificantTokens(line));
      const matchedTokens = targetTokens.filter((t) => lineTokenSet.has(t)).length;
      if (matchedTokens / targetTokens.length >= 0.65) {
        tokenMatch = true;
      }
    }

    if (directMatch || tokenMatch) {
      removedCount++;
    } else {
      keptLines.push(line);
    }
  }

  const collapsed = keptLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    updatedContent: collapsed,
    removedCount,
    remainingEmpty: collapsed.length === 0,
  };
}

export async function executeVaultMemoryUpdate(
  rawInput: VaultMemoryUpdateInput,
  store: VaultMemoryStore = knowledgeService
): Promise<
  | {
      status: 'success';
      action: 'update_existing' | 'create_new' | 'remove_rule' | 'delete_doc';
      docId: string | number;
      docTitle: string;
      alreadyPresent: boolean;
      memoryEvent: AutonomousMemoryEvent;
    }
  | {
      status: 'error';
      code: string;
      error: string;
    }
> {
  const validation = validateVaultUpdateInput(rawInput);
  if (!('value' in validation)) {
    return {
      status: 'error',
      code: validation.code,
      error: validation.error,
    };
  }

  const input = validation.value;
  const searchQuery = `${input.targetTitle || input.topic}: ${input.memoryEntry}`;

  let semanticMatches: VaultDocumentRecord[] = [];
  try {
    semanticMatches = await store.search(searchQuery, 5, 0.35);
  } catch {
    semanticMatches = [];
  }

  let listedDocs: VaultDocumentRecord[] = [];
  try {
    listedDocs = await store.listDocuments(undefined, undefined, 100);
  } catch {
    listedDocs = [];
  }

  const matchedDoc = selectMatchingVaultDocument(listedDocs, semanticMatches, input);
  const dateStamp = new Date().toISOString().split('T')[0];

  // Retire entire matching document
  if (input.mode === 'retire_doc') {
    if (!matchedDoc) {
      return {
        status: 'error',
        code: 'VAULT_TARGET_NOT_FOUND',
        error: `No existing Vault memory matching "${input.targetTitle || input.topic}" was found to remove.`,
      };
    }

    const deletedOk = await store.deleteDocument(matchedDoc.id);
    if (!deletedOk) {
      return {
        status: 'error',
        code: 'VAULT_PERSISTENCE_FAILED',
        error: `Failed to delete Vault record "${matchedDoc.title}". Verify database connectivity.`,
      };
    }

    const event: AutonomousMemoryEvent = {
      id: `mem-evt-${randomUUID()}`,
      action: 'delete_doc',
      docId: matchedDoc.id,
      docTitle: matchedDoc.title,
      category: matchedDoc.category || input.category,
      confidenceScore: 100,
      tier: input.tier,
      summary: `Removed Vault record "${matchedDoc.title}"`,
      previousContent: matchedDoc.content,
      userStatementSnippet: input.memoryEntry,
      timestamp: new Date().toISOString(),
    };

    return {
      status: 'success',
      action: 'delete_doc',
      docId: matchedDoc.id,
      docTitle: matchedDoc.title,
      alreadyPresent: false,
      memoryEvent: event,
    };
  }

  // Remove a specific rule from an existing document (or retire doc if nothing remains)
  if (input.mode === 'remove_rule') {
    if (!matchedDoc) {
      return {
        status: 'error',
        code: 'VAULT_TARGET_NOT_FOUND',
        error: `No existing Vault memory matching "${input.targetTitle || input.topic}" was found.`,
      };
    }

    const removal = removeMemoryEntryFromDocument(matchedDoc.content || '', input.memoryEntry);
    if (removal.removedCount === 0) {
      return {
        status: 'error',
        code: 'VAULT_RULE_NOT_FOUND',
        error: `Could not locate a rule matching "${input.memoryEntry}" inside "${matchedDoc.title}".`,
      };
    }

    if (removal.remainingEmpty) {
      const deletedOk = await store.deleteDocument(matchedDoc.id, {
        operation: 'retire',
        reason: `Removed rule and retired empty record: ${input.memoryEntry}`,
      });
      if (!deletedOk) {
        return {
          status: 'error',
          code: 'VAULT_PERSISTENCE_FAILED',
          error: `Failed to remove empty Vault record "${matchedDoc.title}". Verify database connectivity.`,
        };
      }

      const event: AutonomousMemoryEvent = {
        id: `mem-evt-${randomUUID()}`,
        action: 'delete_doc',
        docId: matchedDoc.id,
        docTitle: matchedDoc.title,
        category: matchedDoc.category || input.category,
        confidenceScore: 100,
        tier: input.tier,
        summary: `Removed rule and retired empty Vault record "${matchedDoc.title}"`,
        previousContent: matchedDoc.content,
        userStatementSnippet: input.memoryEntry,
        timestamp: new Date().toISOString(),
      };

      return {
        status: 'success',
        action: 'delete_doc',
        docId: matchedDoc.id,
        docTitle: matchedDoc.title,
        alreadyPresent: false,
        memoryEvent: event,
      };
    }

    const updatedOk = await store.updateDocument(
      matchedDoc.id,
      {
        title: matchedDoc.title,
        content: removal.updatedContent,
      },
      { operation: 'remove_rule', reason: `Removed rule: ${input.memoryEntry}` },
    );

    if (!updatedOk) {
      return {
        status: 'error',
        code: 'VAULT_PERSISTENCE_FAILED',
        error: `Failed to persist rule removal to Vault record "${matchedDoc.title}". Verify database connectivity.`,
      };
    }

    const event: AutonomousMemoryEvent = {
      id: `mem-evt-${randomUUID()}`,
      action: 'remove_rule',
      docId: matchedDoc.id,
      docTitle: matchedDoc.title,
      category: matchedDoc.category || input.category,
      confidenceScore: 100,
      tier: input.tier,
      summary: `Removed rule from "${matchedDoc.title}": ${input.memoryEntry}`,
      updatedContent: removal.updatedContent,
      previousContent: matchedDoc.content,
      userStatementSnippet: input.memoryEntry,
      timestamp: new Date().toISOString(),
    };

    return {
      status: 'success',
      action: 'remove_rule',
      docId: matchedDoc.id,
      docTitle: matchedDoc.title,
      alreadyPresent: false,
      memoryEvent: event,
    };
  }

  // Update existing matched document
  if (matchedDoc) {
    const { updatedContent, alreadyPresent } = mergeMemoryEntryIntoDocument(
      matchedDoc.content || '',
      input.memoryEntry,
      dateStamp
    );

    if (!alreadyPresent) {
      const updatedOk = await store.updateDocument(
        matchedDoc.id,
        {
          title: matchedDoc.title,
          content: updatedContent,
          confidenceStatus: 'confirmed',
          lifecycleStatus: 'active',
          lastVerifiedAt: new Date().toISOString(),
        },
        { operation: 'update', reason: `Added/updated rule: ${input.memoryEntry}` },
      );

      if (!updatedOk) {
        return {
          status: 'error',
          code: 'VAULT_PERSISTENCE_FAILED',
          error: `Failed to persist update to Vault record "${matchedDoc.title}". Verify database connectivity.`,
        };
      }
    }

    const event: AutonomousMemoryEvent = {
      id: `mem-evt-${randomUUID()}`,
      action: 'update_existing',
      docId: matchedDoc.id,
      docTitle: matchedDoc.title,
      category: matchedDoc.category || input.category,
      confidenceScore: 100,
      tier: input.tier,
      summary: alreadyPresent
        ? `Confirmed existing rule in "${matchedDoc.title}"`
        : `Updated "${matchedDoc.title}" with: ${input.memoryEntry}`,
      updatedContent,
      previousContent: matchedDoc.content,
      userStatementSnippet: input.memoryEntry,
      timestamp: new Date().toISOString(),
    };

    return {
      status: 'success',
      action: 'update_existing',
      docId: matchedDoc.id,
      docTitle: matchedDoc.title,
      alreadyPresent,
      memoryEvent: event,
    };
  }

  if (input.mode === 'update_only') {
    return {
      status: 'error',
      code: 'VAULT_TARGET_NOT_FOUND',
      error: `No existing Vault memory matching "${input.targetTitle || input.topic}" was found to update.`,
    };
  }

  const created = await store.addDocument(
    {
      title: input.topic,
      content: `- **Rule / Note (${dateStamp}):** ${input.memoryEntry}`,
      category: input.category,
      tags: extractSignificantTokens(input.topic).slice(0, 4),
      sourceType: 'in_turn_synthesis',
      confidenceStatus: 'confirmed',
      impactLevel: inferImpactLevelFromCategory(input.category, input.tier),
      lifecycleStatus: 'active',
      lastVerifiedAt: new Date().toISOString(),
    },
    { operation: 'create', reason: `Created via Vault tool: ${input.topic}` },
  );

  if (!created || !created.success || !created.id) {
    return {
      status: 'error',
      code: 'VAULT_PERSISTENCE_FAILED',
      error: 'Unable to save the memory update to Neon PostgreSQL. Verify database connectivity.',
    };
  }

  const event: AutonomousMemoryEvent = {
    id: `mem-evt-${randomUUID()}`,
    action: 'create_new',
    docId: created.id,
    docTitle: input.topic,
    category: input.category,
    confidenceScore: 100,
    tier: input.tier,
    summary: `Saved to "${input.topic}": ${input.memoryEntry}`,
    updatedContent: `- **Rule / Note (${dateStamp}):** ${input.memoryEntry}`,
    userStatementSnippet: input.memoryEntry,
    timestamp: new Date().toISOString(),
  };

  return {
    status: 'success',
    action: 'create_new',
    docId: created.id,
    docTitle: input.topic,
    alreadyPresent: false,
    memoryEvent: event,
  };
}

export interface DuplicateVaultCluster {
  primaryId: string | number;
  primaryTitle: string;
  primaryCategory: string;
  primaryContentPreview: string;
  matches: Array<{
    id: string | number;
    title: string;
    category: string;
    contentPreview: string;
    similarityScore: number;
    sharedTokens: string[];
  }>;
}

/**
 * Pure deterministic scanner for duplicate or near-duplicate Vault records.
 * Computes exact normalized title similarity + significant content token Jaccard/overlap.
 */
export function scanDuplicateVaultDocuments(
  docs: VaultDocumentRecord[],
  minSimilarity = 0.55
): DuplicateVaultCluster[] {
  if (!Array.isArray(docs) || docs.length < 2) return [];

  const tokenized = docs.map((doc) => {
    const titleNorm = normalizeText(doc.title || '');
    const titleTokens = new Set(extractSignificantTokens(doc.title || ''));
    const bodyTokens = new Set(extractSignificantTokens(`${doc.title || ''} ${(doc.content || '').slice(0, 1500)}`));
    return { doc, titleNorm, titleTokens, bodyTokens };
  });

  const assignedToCluster = new Set<string>();
  const clusters: DuplicateVaultCluster[] = [];

  for (let i = 0; i < tokenized.length; i++) {
    const base = tokenized[i];
    const baseKey = String(base.doc.id);
    if (assignedToCluster.has(baseKey)) continue;

    const matches: DuplicateVaultCluster['matches'] = [];

    for (let j = i + 1; j < tokenized.length; j++) {
      const candidate = tokenized[j];
      const candKey = String(candidate.doc.id);
      if (assignedToCluster.has(candKey)) continue;

      let score = 0;
      const shared: string[] = [];

      if (base.titleNorm && candidate.titleNorm) {
        if (base.titleNorm === candidate.titleNorm) {
          score = Math.max(score, 0.98);
        } else if (
          (base.titleNorm.length >= 6 && candidate.titleNorm.includes(base.titleNorm)) ||
          (candidate.titleNorm.length >= 6 && base.titleNorm.includes(candidate.titleNorm))
        ) {
          score = Math.max(score, 0.8);
        }
      }

      if (base.bodyTokens.size > 0 && candidate.bodyTokens.size > 0) {
        const union = new Set([...base.bodyTokens, ...candidate.bodyTokens]);
        for (const tok of base.bodyTokens) {
          if (candidate.bodyTokens.has(tok)) shared.push(tok);
        }
        const jaccard = union.size > 0 ? shared.length / union.size : 0;
        const smallerSize = Math.min(base.bodyTokens.size, candidate.bodyTokens.size);
        const containment = smallerSize > 0 ? shared.length / smallerSize : 0;
        const tokenScore = jaccard * 0.65 + containment * 0.35;
        score = Math.max(score, tokenScore);
      }

      if (score >= minSimilarity) {
        matches.push({
          id: candidate.doc.id,
          title: candidate.doc.title,
          category: candidate.doc.category || 'personal_note',
          contentPreview: (candidate.doc.content || '').slice(0, 220),
          similarityScore: Math.round(score * 100) / 100,
          sharedTokens: shared.slice(0, 8),
        });
        assignedToCluster.add(candKey);
      }
    }

    if (matches.length > 0) {
      assignedToCluster.add(baseKey);
      clusters.push({
        primaryId: base.doc.id,
        primaryTitle: base.doc.title,
        primaryCategory: base.doc.category || 'personal_note',
        primaryContentPreview: (base.doc.content || '').slice(0, 220),
        matches,
      });
    }
  }

  return clusters;
}

