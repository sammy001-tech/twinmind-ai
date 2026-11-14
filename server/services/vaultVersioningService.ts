export type VaultEntityType = 'knowledge_doc' | 'active_rule';

export type VaultRevisionOperation =
  | 'create'
  | 'update'
  | 'supersede'
  | 'remove_rule'
  | 'rollback'
  | 'retire';

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface TextDiffResult {
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  lines: DiffLine[];
  summary: string;
  truncated: boolean;
}

export interface VaultSnapshotPayload {
  // Knowledge document fields
  title?: string;
  content: string;
  category: string;
  tags?: string[];
  sourceType?: string;
  sourceRef?: string | null;
  confidenceStatus?: string;
  impactLevel?: string;
  lifecycleStatus?: string;
  supersededById?: number | null;
  validUntil?: string | null;
  lastVerifiedAt?: string | null;
  // Active rule fields
  priority?: number;
  scope?: 'permanent' | 'project' | 'temporary' | string;
  project_key?: string | null;
  thread_id?: string | null;
  expires_at?: string | null;
  is_active?: boolean;
  superseded_by_id?: number | null;
}

export interface VaultRevisionAuditMeta {
  operation?: VaultRevisionOperation;
  reason?: string | null;
  channel?: string | null;
}

export interface VaultRevisionRecord {
  id: number;
  entityType: VaultEntityType;
  entityId: number;
  versionNumber: number;
  operation: VaultRevisionOperation;
  snapshot: VaultSnapshotPayload;
  diffSummary: string;
  diffLines: DiffLine[];
  changedFields: string[];
  reason: string | null;
  channel: string | null;
  createdAt: string;
}

interface RawDiffOp {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  text: string;
}

function normalizeLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * Deterministic line-level diff using Myers/DP LCS over line arrays, with a bounded fallback
 * for extra-large documents so CPU usage remains strictly bounded.
 */
export function computeTextDiff(
  beforeText: string,
  afterText: string,
  options?: { contextLines?: number; maxLines?: number },
): TextDiffResult {
  const contextLines = Math.max(0, Math.min(10, options?.contextLines ?? 2));
  const maxLines = Math.max(20, Math.min(500, options?.maxLines ?? 160));
  const oldLines = normalizeLines(beforeText);
  const newLines = normalizeLines(afterText);

  if (oldLines.length === 0 && newLines.length === 0) {
    return {
      addedCount: 0,
      removedCount: 0,
      unchangedCount: 0,
      lines: [],
      summary: 'No text changes',
      truncated: false,
    };
  }

  // Trim shared prefix/suffix first to minimize LCS matrix size cleanly
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midOld = oldLines.slice(prefix, oldLines.length - suffix);
  const midNew = newLines.slice(prefix, newLines.length - suffix);

  const ops: RawDiffOp[] = [];
  for (let i = 0; i < prefix; i++) {
    ops.push({ type: 'context', oldLine: i + 1, newLine: i + 1, text: oldLines[i] });
  }

  const cellBudget = midOld.length * midNew.length;
  if (cellBudget === 0) {
    for (let i = 0; i < midOld.length; i++) {
      ops.push({ type: 'remove', oldLine: prefix + i + 1, text: midOld[i] });
    }
    for (let j = 0; j < midNew.length; j++) {
      ops.push({ type: 'add', newLine: prefix + j + 1, text: midNew[j] });
    }
  } else if (cellBudget <= 80_000) {
    const m = midOld.length;
    const n = midNew.length;
    const dp = new Int32Array((m + 1) * (n + 1));
    const cols = n + 1;
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (midOld[i] === midNew[j]) {
          dp[i * cols + j] = dp[(i + 1) * cols + (j + 1)] + 1;
        } else {
          const down = dp[(i + 1) * cols + j];
          const right = dp[i * cols + (j + 1)];
          dp[i * cols + j] = down >= right ? down : right;
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midOld[i] === midNew[j]) {
        ops.push({
          type: 'context',
          oldLine: prefix + i + 1,
          newLine: prefix + j + 1,
          text: midOld[i],
        });
        i++;
        j++;
      } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
        ops.push({ type: 'remove', oldLine: prefix + i + 1, text: midOld[i] });
        i++;
      } else {
        ops.push({ type: 'add', newLine: prefix + j + 1, text: midNew[j] });
        j++;
      }
    }
    while (i < m) {
      ops.push({ type: 'remove', oldLine: prefix + i + 1, text: midOld[i] });
      i++;
    }
    while (j < n) {
      ops.push({ type: 'add', newLine: prefix + j + 1, text: midNew[j] });
      j++;
    }
  } else {
    // Bounded fallback for very large edits: show middle removals then additions
    for (let i = 0; i < midOld.length; i++) {
      ops.push({ type: 'remove', oldLine: prefix + i + 1, text: midOld[i] });
    }
    for (let j = 0; j < midNew.length; j++) {
      ops.push({ type: 'add', newLine: prefix + j + 1, text: midNew[j] });
    }
  }

  for (let s = 0; s < suffix; s++) {
    const oldIdx = oldLines.length - suffix + s;
    const newIdx = newLines.length - suffix + s;
    ops.push({ type: 'context', oldLine: oldIdx + 1, newLine: newIdx + 1, text: oldLines[oldIdx] });
  }

  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;
  const changedIndices = new Set<number>();

  ops.forEach((op, idx) => {
    if (op.type === 'add') {
      addedCount++;
      changedIndices.add(idx);
    } else if (op.type === 'remove') {
      removedCount++;
      changedIndices.add(idx);
    } else {
      unchangedCount++;
    }
  });

  if (addedCount === 0 && removedCount === 0) {
    return {
      addedCount: 0,
      removedCount: 0,
      unchangedCount,
      lines: [],
      summary: 'No text changes',
      truncated: false,
    };
  }

  const includedIndices = new Set<number>();
  for (const idx of changedIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(ops.length - 1, idx + contextLines);
    for (let k = start; k <= end; k++) {
      includedIndices.add(k);
    }
  }

  const sortedIncluded = Array.from(includedIndices).sort((a, b) => a - b);
  const hunkLines: DiffLine[] = sortedIncluded.slice(0, maxLines).map((idx) => ops[idx]);
  const truncated = sortedIncluded.length > maxLines;

  const summaryParts: string[] = [];
  if (addedCount > 0) summaryParts.push(`+${addedCount} line${addedCount === 1 ? '' : 's'}`);
  if (removedCount > 0) summaryParts.push(`-${removedCount} line${removedCount === 1 ? '' : 's'}`);

  return {
    addedCount,
    removedCount,
    unchangedCount,
    lines: hunkLines,
    summary: summaryParts.join(' / '),
    truncated,
  };
}

function stableStringifyValue(val: unknown): string {
  if (Array.isArray(val)) {
    return JSON.stringify([...val].map((v) => String(v)));
  }
  return JSON.stringify(val ?? null);
}

/**
 * Compute field-level + line-level diff between two Vault snapshots.
 */
export function computeSnapshotDiff(
  entityType: VaultEntityType,
  prev: VaultSnapshotPayload | null,
  next: VaultSnapshotPayload | null,
  operation: VaultRevisionOperation = 'update',
): {
  diffSummary: string;
  diffLines: DiffLine[];
  changedFields: string[];
} {
  if (!prev && next) {
    const initialDiff = computeTextDiff('', next.content || '');
    return {
      diffSummary: `Initial version (${initialDiff.addedCount} line${initialDiff.addedCount === 1 ? '' : 's'})`,
      diffLines: initialDiff.lines,
      changedFields: entityType === 'knowledge_doc' ? ['title', 'content', 'category'] : ['content', 'category', 'scope'],
    };
  }

  if (prev && !next) {
    const retiredDiff = computeTextDiff(prev.content || '', '');
    return {
      diffSummary: `Retired record (-${retiredDiff.removedCount} line${retiredDiff.removedCount === 1 ? '' : 's'})`,
      diffLines: retiredDiff.lines,
      changedFields: ['retired'],
    };
  }

  if (!prev || !next) {
    return { diffSummary: 'Snapshot captured', diffLines: [], changedFields: [] };
  }

  const fieldsToCheck: Array<{ key: keyof VaultSnapshotPayload; label: string }> =
    entityType === 'knowledge_doc'
      ? [
          { key: 'title', label: 'title' },
          { key: 'category', label: 'category' },
          { key: 'tags', label: 'tags' },
          { key: 'sourceType', label: 'sourceType' },
          { key: 'confidenceStatus', label: 'confidenceStatus' },
          { key: 'impactLevel', label: 'impactLevel' },
          { key: 'lifecycleStatus', label: 'lifecycleStatus' },
          { key: 'supersededById', label: 'supersededById' },
          { key: 'validUntil', label: 'validUntil' },
        ]
      : [
          { key: 'category', label: 'category' },
          { key: 'priority', label: 'priority' },
          { key: 'scope', label: 'scope' },
          { key: 'project_key', label: 'project_key' },
          { key: 'thread_id', label: 'thread_id' },
          { key: 'expires_at', label: 'expires_at' },
          { key: 'is_active', label: 'is_active' },
          { key: 'superseded_by_id', label: 'superseded_by_id' },
        ];

  const changedFields: string[] = [];
  const metaSummaries: string[] = [];

  for (const field of fieldsToCheck) {
    const a = prev[field.key];
    const b = next[field.key];
    if (stableStringifyValue(a) !== stableStringifyValue(b)) {
      changedFields.push(field.label);
      if (field.key === 'is_active') {
        metaSummaries.push(b ? 'reactivated' : 'paused');
      } else if (field.key === 'priority' || field.key === 'scope' || field.key === 'category' || field.key === 'lifecycleStatus') {
        metaSummaries.push(`${field.label}: ${String(a ?? 'none')} -> ${String(b ?? 'none')}`);
      } else {
        metaSummaries.push(`${field.label} updated`);
      }
    }
  }

  const contentDiff = computeTextDiff(prev.content || '', next.content || '');
  if (contentDiff.addedCount > 0 || contentDiff.removedCount > 0) {
    changedFields.unshift('content');
  }

  const parts: string[] = [];
  if (operation === 'rollback') parts.push('Rollback');
  if (contentDiff.addedCount > 0 || contentDiff.removedCount > 0) {
    parts.push(contentDiff.summary);
  }
  if (metaSummaries.length > 0) {
    parts.push(metaSummaries.join('; '));
  }

  return {
    diffSummary: parts.length > 0 ? parts.join(' · ') : 'Metadata verified / refreshed',
    diffLines: contentDiff.lines,
    changedFields,
  };
}
