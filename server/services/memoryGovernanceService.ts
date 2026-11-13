import type {
  MemoryConfidenceStatus,
  MemoryImpactLevel,
  MemoryLifecycleStatus,
  MemorySourceType,
  RetrievedMemoryDiagnostic,
} from '../../src/types/index.ts';

export interface GovernedKnowledgeRecord {
  id: number | string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  similarity?: number;
  hasEmbedding?: boolean;
  sourceType: MemorySourceType;
  sourceRef: string | null;
  confidenceStatus: MemoryConfidenceStatus;
  impactLevel: MemoryImpactLevel;
  lifecycleStatus: MemoryLifecycleStatus;
  supersededById: number | string | null;
  validFrom: string | null;
  validUntil: string | null;
  lastVerifiedAt: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SupersessionCandidate {
  id?: number | string;
  title: string;
  content: string;
  category?: string;
  confidenceStatus?: MemoryConfidenceStatus;
  impactLevel?: MemoryImpactLevel;
  sourceType?: MemorySourceType;
  validFrom?: string | null;
  createdAt?: string | null;
}

export interface SupersessionDecision {
  action: 'auto_supersede' | 'preserve_conflict';
  existingNewStatus: MemoryLifecycleStatus;
  incomingNewStatus: MemoryLifecycleStatus;
  reason: string;
  requiresOwnerReview: boolean;
}

const VALID_SOURCE_TYPES: readonly MemorySourceType[] = [
  'direct_directive',
  'imported_doc',
  'in_turn_synthesis',
  'web_research',
  'legacy_import',
];

const VALID_CONFIDENCE: readonly MemoryConfidenceStatus[] = [
  'confirmed',
  'provisional',
  'inferred',
];

const VALID_IMPACT: readonly MemoryImpactLevel[] = ['low', 'medium', 'high'];

const VALID_LIFECYCLE: readonly MemoryLifecycleStatus[] = [
  'active',
  'superseded',
  'conflicted',
  'unconfirmed',
];

export function normalizeSourceType(val: unknown): MemorySourceType {
  if (typeof val === 'string' && (VALID_SOURCE_TYPES as readonly string[]).includes(val)) {
    return val as MemorySourceType;
  }
  return 'legacy_import';
}

export function normalizeConfidenceStatus(val: unknown): MemoryConfidenceStatus {
  if (typeof val === 'string' && (VALID_CONFIDENCE as readonly string[]).includes(val)) {
    return val as MemoryConfidenceStatus;
  }
  return 'confirmed';
}

export function normalizeImpactLevel(val: unknown): MemoryImpactLevel {
  if (typeof val === 'string' && (VALID_IMPACT as readonly string[]).includes(val)) {
    return val as MemoryImpactLevel;
  }
  return 'medium';
}

export function normalizeLifecycleStatus(val: unknown): MemoryLifecycleStatus {
  if (typeof val === 'string' && (VALID_LIFECYCLE as readonly string[]).includes(val)) {
    return val as MemoryLifecycleStatus;
  }
  return 'active';
}

export function inferImpactLevelFromCategory(category?: string, tier?: string): MemoryImpactLevel {
  const cat = (category || '').toLowerCase();
  const normalizedTier = (tier || '').toLowerCase();
  if (
    normalizedTier === 'architectural' ||
    cat === 'decision_framework' ||
    cat === 'philosophy' ||
    cat === 'project_brief'
  ) {
    return 'high';
  }
  if (cat === 'reference' || normalizedTier === 'workflow') {
    return 'medium';
  }
  return 'low';
}

export function toGovernedRecord(raw: Record<string, unknown>): GovernedKnowledgeRecord {
  const toIsoOrNull = (v: unknown): string | null => {
    if (!v) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
    const str = String(v).trim();
    return str || null;
  };

  const simRaw = raw.similarity;
  const similarity =
    typeof simRaw === 'number' && Number.isFinite(simRaw)
      ? simRaw
      : typeof simRaw === 'string' && simRaw.trim() && Number.isFinite(Number(simRaw))
        ? Number(simRaw)
        : undefined;

  return {
    id: (raw.id as number | string) ?? 0,
    title: String(raw.title ?? ''),
    content: String(raw.content ?? ''),
    category: String(raw.category ?? 'personal_note'),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t)) : [],
    similarity,
    hasEmbedding: raw.hasEmbedding !== undefined ? Boolean(raw.hasEmbedding) : Boolean(raw.has_embedding),
    sourceType: normalizeSourceType(raw.sourceType ?? raw.source_type),
    sourceRef: raw.sourceRef ? String(raw.sourceRef) : raw.source_ref ? String(raw.source_ref) : null,
    confidenceStatus: normalizeConfidenceStatus(raw.confidenceStatus ?? raw.confidence_status),
    impactLevel: normalizeImpactLevel(raw.impactLevel ?? raw.impact_level),
    lifecycleStatus: normalizeLifecycleStatus(raw.lifecycleStatus ?? raw.lifecycle_status),
    supersededById: (raw.supersededById ?? raw.superseded_by_id ?? null) as number | string | null,
    validFrom: toIsoOrNull(raw.validFrom ?? raw.valid_from ?? raw.createdAt ?? raw.created_at),
    validUntil: toIsoOrNull(raw.validUntil ?? raw.valid_until),
    lastVerifiedAt: toIsoOrNull(raw.lastVerifiedAt ?? raw.last_verified_at),
    createdAt: toIsoOrNull(raw.createdAt ?? raw.created_at),
    updatedAt: toIsoOrNull(raw.updatedAt ?? raw.updated_at),
  };
}

/**
 * Deterministic impact-, provenance-, and confidence-gated supersession policy:
 * - Newer confirmed records automatically supersede conflicting older low/medium-impact records,
 *   unless explicitly flagged as high-impact architectural/life decisions.
 * - High-impact conflicts or provisional/inferred updates preserve both records in 'conflicted' status
 *   until explicitly reconciled by the owner.
 */
export function evaluateMemorySupersession(
  existing: SupersessionCandidate,
  incoming: SupersessionCandidate,
  options: { explicitOwnerOverride?: boolean } = {}
): SupersessionDecision {
  const existingConfidence = normalizeConfidenceStatus(existing.confidenceStatus);
  const incomingConfidence = normalizeConfidenceStatus(incoming.confidenceStatus);
  const existingImpact =
    existing.impactLevel ?? inferImpactLevelFromCategory(existing.category);
  const incomingImpact =
    incoming.impactLevel ?? inferImpactLevelFromCategory(incoming.category);

  if (options.explicitOwnerOverride) {
    return {
      action: 'auto_supersede',
      existingNewStatus: 'superseded',
      incomingNewStatus: 'active',
      reason: 'Owner explicitly confirmed supersession of prior record.',
      requiresOwnerReview: false,
    };
  }

  // Only confirmed incoming records can trigger automatic supersession.
  if (incomingConfidence !== 'confirmed') {
    return {
      action: 'preserve_conflict',
      existingNewStatus: 'conflicted',
      incomingNewStatus: 'conflicted',
      reason: `Incoming record is "${incomingConfidence}" rather than confirmed; preserving both records for review.`,
      requiresOwnerReview: true,
    };
  }

  // High-impact architectural / policy / major decisions always require explicit human adjudication
  if (existingImpact === 'high' || incomingImpact === 'high') {
    return {
      action: 'preserve_conflict',
      existingNewStatus: 'conflicted',
      incomingNewStatus: 'conflicted',
      reason: `High-impact record conflict (${existingImpact}/${incomingImpact}); both premises retained and flagged for explicit review.`,
      requiresOwnerReview: true,
    };
  }

  // Low/medium impact where existing is older or non-confirmed and incoming is confirmed
  const existingTs = Date.parse(existing.validFrom || existing.createdAt || '') || 0;
  const incomingTs = Date.parse(incoming.validFrom || incoming.createdAt || '') || Date.now();
  const isNewer = incomingTs >= existingTs;

  if (isNewer || existingConfidence !== 'confirmed') {
    return {
      action: 'auto_supersede',
      existingNewStatus: 'superseded',
      incomingNewStatus: 'active',
      reason: `Newer confirmed ${incomingImpact}-impact record automatically supersedes prior record.`,
      requiresOwnerReview: false,
    };
  }

  return {
    action: 'preserve_conflict',
    existingNewStatus: 'conflicted',
    incomingNewStatus: 'conflicted',
    reason: 'Temporal ordering is tied or older than stored confirmed record; preserving both under conflict review.',
    requiresOwnerReview: true,
  };
}

function confidenceRank(c: MemoryConfidenceStatus): number {
  if (c === 'confirmed') return 3;
  if (c === 'provisional') return 2;
  return 1;
}

/**
 * Filter out superseded facts from primary prompt injection while exposing
 * full retrieval diagnostics (similarity, provenance, timestamps, exclusion reasons).
 */
export function rankAndFilterRetrievedMemories(
  candidates: GovernedKnowledgeRecord[],
  options: { limit?: number; includeSupersededInDiagnostics?: boolean } = {}
): {
  primaryRecords: GovernedKnowledgeRecord[];
  diagnostics: RetrievedMemoryDiagnostic[];
  conflictsDetected: Array<{
    existingDocId: number | string;
    title: string;
    explanation: string;
    impactLevel: MemoryImpactLevel;
  }>;
} {
  const limit = options.limit ?? 5;
  const includeSuperseded = options.includeSupersededInDiagnostics ?? true;

  const sorted = [...candidates].sort((a, b) => {
    // Active non-superseded confirmed records rank highest
    const lifecycleScore = (r: GovernedKnowledgeRecord) =>
      r.lifecycleStatus === 'active'
        ? 3
        : r.lifecycleStatus === 'conflicted'
          ? 2
          : r.lifecycleStatus === 'unconfirmed'
            ? 1
            : 0;

    const lDiff = lifecycleScore(b) - lifecycleScore(a);
    if (lDiff !== 0) return lDiff;

    const cDiff = confidenceRank(b.confidenceStatus) - confidenceRank(a.confidenceStatus);
    if (cDiff !== 0) return cDiff;

    const simDiff = (b.similarity ?? 0) - (a.similarity ?? 0);
    if (Math.abs(simDiff) > 0.015) return simDiff;

    const tsA = Date.parse(a.lastVerifiedAt || a.updatedAt || a.validFrom || a.createdAt || '') || 0;
    const tsB = Date.parse(b.lastVerifiedAt || b.updatedAt || b.validFrom || b.createdAt || '') || 0;
    return tsB - tsA;
  });

  const primaryRecords: GovernedKnowledgeRecord[] = [];
  const diagnostics: RetrievedMemoryDiagnostic[] = [];
  const conflictsDetected: Array<{
    existingDocId: number | string;
    title: string;
    explanation: string;
    impactLevel: MemoryImpactLevel;
  }> = [];

  for (const record of sorted) {
    if (record.lifecycleStatus === 'superseded') {
      if (includeSuperseded) {
        diagnostics.push({
          id: record.id,
          title: record.title,
          category: record.category,
          similarity: record.similarity,
          sourceType: record.sourceType,
          confidenceStatus: record.confidenceStatus,
          impactLevel: record.impactLevel,
          lifecycleStatus: record.lifecycleStatus,
          supersededById: record.supersededById,
          validFrom: record.validFrom,
          lastVerifiedAt: record.lastVerifiedAt,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          includedInPrompt: false,
          reason: record.supersededById
            ? `Excluded from primary factual injection: superseded by record #${record.supersededById}.`
            : 'Excluded from primary factual injection: marked as superseded.',
        });
      }
      continue;
    }

    const willInclude = primaryRecords.length < limit;
    if (willInclude) {
      primaryRecords.push(record);
    }

    let reason = 'Included: active confirmed memory matching query.';
    if (!willInclude) {
      reason = `Omitted due to retrieval limit (${limit}) after ranking.`;
    } else if (record.lifecycleStatus === 'conflicted') {
      reason = `Included with conflict warning: competing ${record.impactLevel}-impact record requires owner adjudication.`;
      conflictsDetected.push({
        existingDocId: record.id,
        title: record.title,
        explanation: `Retrieved memory "${record.title}" is marked conflicted and must be surfaced alongside competing context.`,
        impactLevel: record.impactLevel,
      });
    } else if (record.confidenceStatus !== 'confirmed' || record.lifecycleStatus === 'unconfirmed') {
      reason = `Included as ${record.confidenceStatus} (${record.lifecycleStatus}): must be distinguished from confirmed facts.`;
    }

    diagnostics.push({
      id: record.id,
      title: record.title,
      category: record.category,
      similarity: record.similarity,
      sourceType: record.sourceType,
      confidenceStatus: record.confidenceStatus,
      impactLevel: record.impactLevel,
      lifecycleStatus: record.lifecycleStatus,
      supersededById: record.supersededById,
      validFrom: record.validFrom,
      lastVerifiedAt: record.lastVerifiedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      includedInPrompt: willInclude,
      reason,
    });
  }

  return { primaryRecords, diagnostics, conflictsDetected };
}
