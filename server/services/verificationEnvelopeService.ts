import type {
  ClaimEvidenceStatus,
  EvidenceClaimRecord,
  RetrievedMemoryDiagnostic,
  ToolExecutionLedgerEntry,
  ToolExecutionStatus,
  VerificationEnvelope,
  VerificationOverallPosture,
} from '../../src/types/index.ts';

export interface ExecutedToolInput {
  toolName: string;
  args?: Record<string, unknown>;
  result: unknown;
  timestamp?: string;
}

export interface BuildVerificationEnvelopeInput {
  userPrompt: string;
  replyText: string;
  toolsExecuted?: ExecutedToolInput[];
  memoryDiagnostics?: RetrievedMemoryDiagnostic[];
  pinnedDocs?: Array<{ id?: number; file_name: string; format?: string }>;
  researchAttemptExpected?: boolean;
  beliefConflict?: {
    existingDocId?: number | string;
    existingTitle?: string;
    explanation?: string;
  } | null;
  now?: Date;
}

export function classifyToolExecution(entry: ExecutedToolInput): ToolExecutionLedgerEntry {
  const timestamp = entry.timestamp || new Date().toISOString();
  const res = entry.result && typeof entry.result === 'object' && !Array.isArray(entry.result)
    ? (entry.result as Record<string, unknown>)
    : null;

  if (!res) {
    return {
      toolName: entry.toolName,
      executionStatus: 'failed',
      summary: `${entry.toolName} returned an unreadable or empty payload.`,
      errorCode: 'EMPTY_TOOL_OUTPUT',
      timestamp,
    };
  }

  const rawStatus = typeof res.status === 'string' ? res.status.toLowerCase() : '';
  const errorCode = typeof res.code === 'string' ? res.code : undefined;
  const errorMessage = typeof res.error === 'string' ? res.error : undefined;

  if (
    rawStatus === 'error' ||
    rawStatus === 'execution_failed' ||
    rawStatus === 'unconfigured_key' ||
    rawStatus === 'invalid_args' ||
    rawStatus === 'unknown_tool'
  ) {
    const isNoResults =
      errorCode === 'LIVE_SEARCH_NO_USABLE_RESULTS' ||
      errorCode === 'LIVE_EXTRACT_NO_USABLE_RESULTS';

    return {
      toolName: entry.toolName,
      executionStatus: isNoResults ? 'succeeded_insufficient' : 'failed',
      summary: isNoResults
        ? `${entry.toolName} completed but returned zero attributable usable records.`
        : errorMessage || `${entry.toolName} failed (${errorCode || rawStatus}).`,
      errorCode,
      errorMessage,
      resultCount: 0,
      timestamp,
    };
  }

  // Inspect web search / extraction sources cleanly
  if (entry.toolName === 'searchWeb' || entry.toolName === 'extractWebPages') {
    const rawSources = Array.isArray(res.sources)
      ? res.sources
      : Array.isArray(res.results)
        ? res.results
        : [];
    const urls = rawSources
      .map((s) => (s && typeof s === 'object' && typeof (s as Record<string, unknown>).url === 'string' ? String((s as Record<string, unknown>).url) : ''))
      .filter(Boolean);

    if (rawSources.length === 0 || urls.length === 0) {
      return {
        toolName: entry.toolName,
        executionStatus: 'succeeded_insufficient',
        summary: `${entry.toolName} executed without returning attributable source URLs.`,
        resultCount: 0,
        timestamp,
      };
    }

    const usableCount = rawSources.filter((s) => {
      if (!s || typeof s !== 'object') return false;
      const rec = s as Record<string, unknown>;
      const snippet = typeof rec.snippet === 'string' ? rec.snippet : typeof rec.content === 'string' ? rec.content : '';
      return Boolean(rec.url) && snippet.trim().length >= 20;
    }).length;

    if (usableCount === 0) {
      return {
        toolName: entry.toolName,
        executionStatus: 'succeeded_insufficient',
        summary: `${entry.toolName} returned ${rawSources.length} source(s) but excerpts lacked substantive verifiable content.`,
        resultCount: rawSources.length,
        urls,
        timestamp,
      };
    }

    return {
      toolName: entry.toolName,
      executionStatus: 'succeeded_usable',
      summary: `${entry.toolName} retrieved ${usableCount} usable source(s).`,
      resultCount: usableCount,
      urls,
      timestamp,
    };
  }

  if (entry.toolName === 'searchConversationHistory' || entry.toolName === 'recallDecisionsAndTasks') {
    const matches = Array.isArray(res.matches)
      ? res.matches
      : Array.isArray(res.decisions)
        ? res.decisions
        : Array.isArray(res.records)
          ? res.records
          : [];
    if (matches.length === 0) {
      return {
        toolName: entry.toolName,
        executionStatus: 'succeeded_insufficient',
        summary: `${entry.toolName} queried durable storage and found no matching historical records.`,
        resultCount: 0,
        timestamp,
      };
    }
    return {
      toolName: entry.toolName,
      executionStatus: 'succeeded_usable',
      summary: `${entry.toolName} retrieved ${matches.length} matching historical record(s).`,
      resultCount: matches.length,
      timestamp,
    };
  }

  if (entry.toolName === 'generateArtifact') {
    if (res.validationStatus === 'validated' && res.fileName) {
      return {
        toolName: entry.toolName,
        executionStatus: 'succeeded_usable',
        summary: `Generated & validated ${String(res.fileName)}.`,
        resultCount: 1,
        timestamp,
      };
    }
    return {
      toolName: entry.toolName,
      executionStatus: 'failed',
      summary: errorMessage || 'Artifact generation failed validation.',
      errorCode,
      errorMessage,
      timestamp,
    };
  }

  if (rawStatus === 'success') {
    return {
      toolName: entry.toolName,
      executionStatus: 'succeeded_usable',
      summary:
        typeof res.message === 'string' && res.message.trim()
          ? res.message.trim()
          : `${entry.toolName} completed successfully.`,
      resultCount: 1,
      timestamp,
    };
  }

  // Generic ambiguous response cannot be treated as guaranteed usable
  return {
    toolName: entry.toolName,
    executionStatus: 'succeeded_insufficient',
    summary: `${entry.toolName} completed with an unverified or incomplete structure.`,
    timestamp,
  };
}

function promptLikelyRequiresExternalVerification(prompt: string): boolean {
  return /\b(latest|current|today|price|release\s+version|news|according\s+to|verify|check\s+online|search|did\s+we\s+(?:previously\s+)?decide|previously\s+decided)\b/i.test(
    prompt
  );
}

/**
 * Determine if the response relies on retrieved memories, web research, or tools, and produce
 * claim-level evidence classifications without overclaiming overall response verification.
 */
export function buildVerificationEnvelope(
  input: BuildVerificationEnvelopeInput
): VerificationEnvelope {
  const nowIso = (input.now ?? new Date()).toISOString();
  const toolsExecuted = input.toolsExecuted || [];
  const memoryDiagnostics = input.memoryDiagnostics || [];
  const pinnedDocs = input.pinnedDocs || [];

  const toolLedger: ToolExecutionLedgerEntry[] = toolsExecuted.map((t) =>
    classifyToolExecution({ ...t, timestamp: t.timestamp || nowIso })
  );

  // Explicit 'not_attempted' entries for transparency when memory/research was available or expected
  const hasResearchTool = toolLedger.some(
    (t) => t.toolName === 'searchWeb' || t.toolName === 'extractWebPages'
  );
  if (!hasResearchTool && (input.researchAttemptExpected || promptLikelyRequiresExternalVerification(input.userPrompt))) {
    toolLedger.push({
      toolName: 'searchWeb',
      executionStatus: 'not_attempted',
      summary: 'External web search was not executed during this turn.',
      timestamp: nowIso,
    });
  }

  const hasToolFailures = toolLedger.some((t) => t.executionStatus === 'failed');
  const hasInsufficientTools = toolLedger.some((t) => t.executionStatus === 'succeeded_insufficient');

  const includedMemories = memoryDiagnostics.filter((m) => m.includedInPrompt);
  const excludedSuperseded = memoryDiagnostics.filter(
    (m) => !m.includedInPrompt && m.lifecycleStatus === 'superseded'
  );

  const conflictsDetected: VerificationEnvelope['conflictsDetected'] = memoryDiagnostics
    .filter((m) => m.lifecycleStatus === 'conflicted')
    .map((m) => ({
      existingDocId: m.id,
      title: m.title,
      explanation: m.reason,
      impactLevel: m.impactLevel,
    }));

  if (input.beliefConflict?.existingTitle) {
    const alreadyPresent = conflictsDetected.some(
      (c) => String(c.existingDocId) === String(input.beliefConflict?.existingDocId)
    );
    if (!alreadyPresent) {
      conflictsDetected.push({
        existingDocId: input.beliefConflict.existingDocId,
        title: input.beliefConflict.existingTitle,
        explanation: input.beliefConflict.explanation || 'Conflicting statement detected against stored Vault belief.',
      });
    }
  }

  const hasMemoryConflicts = conflictsDetected.length > 0;
  const claims: EvidenceClaimRecord[] = [];

  // 1. Claims backed by retrieved Vault memories
  if (includedMemories.length > 0) {
    const confirmedActive = includedMemories.filter(
      (m) => m.confidenceStatus === 'confirmed' && m.lifecycleStatus === 'active'
    );
    const nonConfirmedOrConflicted = includedMemories.filter(
      (m) => m.confidenceStatus !== 'confirmed' || m.lifecycleStatus !== 'active'
    );

    if (confirmedActive.length > 0) {
      claims.push({
        id: 'claim-memory-confirmed',
        statement: `Retrieved ${confirmedActive.length} active confirmed Vault record(s) informing memory-grounded context.`,
        status: hasMemoryConflicts ? 'partial' : 'verified',
        basisSummary: confirmedActive.map((m) => `"${m.title}"`).join(', '),
        sourceType: hasMemoryConflicts ? 'conflict_unresolved' : 'vault_memory',
        sourceRefs: confirmedActive.map((m) => ({
          kind: 'memory',
          id: m.id,
          label: `${m.title} (${m.sourceType}, ${m.confidenceStatus})`,
          timestamp: m.lastVerifiedAt || m.updatedAt || m.validFrom || m.createdAt || null,
          confidenceStatus: m.confidenceStatus,
          lifecycleStatus: m.lifecycleStatus,
        })),
        gapOrConflictNote: hasMemoryConflicts
          ? 'Related memory records contain unresolved conflict(s) that must be considered together.'
          : undefined,
      });
    }

    if (nonConfirmedOrConflicted.length > 0) {
      claims.push({
        id: 'claim-memory-provisional',
        statement: `${nonConfirmedOrConflicted.length} retrieved memory record(s) are provisional, inferred, or conflicted.`,
        status: nonConfirmedOrConflicted.some((m) => m.lifecycleStatus === 'conflicted') ? 'partial' : 'inferred',
        basisSummary: nonConfirmedOrConflicted.map((m) => `"${m.title}" [${m.lifecycleStatus}/${m.confidenceStatus}]`).join(', '),
        sourceType: 'conflict_unresolved',
        sourceRefs: nonConfirmedOrConflicted.map((m) => ({
          kind: 'memory',
          id: m.id,
          label: `${m.title} (${m.lifecycleStatus})`,
          timestamp: m.lastVerifiedAt || m.updatedAt || m.validFrom || m.createdAt || null,
          confidenceStatus: m.confidenceStatus,
          lifecycleStatus: m.lifecycleStatus,
        })),
        gapOrConflictNote:
          'Conflicted or inferred records require confirmation before treating them as settled decisions.',
      });
    }
  } else if (excludedSuperseded.length > 0) {
    claims.push({
      id: 'claim-memory-superseded-only',
      statement: 'Only superseded historical memory records matched the query; outdated premises were suppressed.',
      status: 'unverified',
      basisSummary: `${excludedSuperseded.length} superseded record(s) filtered out`,
      sourceType: 'vault_memory',
      sourceRefs: excludedSuperseded.map((m) => ({
        kind: 'memory',
        id: m.id,
        label: `${m.title} (superseded)`,
        timestamp: m.updatedAt || m.createdAt || null,
        confidenceStatus: m.confidenceStatus,
        lifecycleStatus: m.lifecycleStatus,
      })),
      gapOrConflictNote: 'Current active confirmation is missing because matching records were superseded.',
    });
  }

  // 2. Claims backed by pinned thread reference documents
  if (pinnedDocs.length > 0) {
    claims.push({
      id: 'claim-pinned-docs',
      statement: `Context grounded in ${pinnedDocs.length} thread-pinned reference document(s).`,
      status: 'verified',
      basisSummary: pinnedDocs.map((d) => d.file_name).join(', '),
      sourceType: 'thread_document',
      sourceRefs: pinnedDocs.map((d) => ({
        kind: 'pinned_doc',
        id: d.id,
        label: d.file_name,
      })),
    });
  }

  // 3. Claims backed by live web research / extraction
  const usableSearchTools = toolLedger.filter(
    (t) =>
      (t.toolName === 'searchWeb' || t.toolName === 'extractWebPages') &&
      t.executionStatus === 'succeeded_usable'
  );
  const failedOrEmptyResearch = toolLedger.filter(
    (t) =>
      (t.toolName === 'searchWeb' || t.toolName === 'extractWebPages') &&
      (t.executionStatus === 'failed' || t.executionStatus === 'succeeded_insufficient')
  );

  if (usableSearchTools.length > 0 && failedOrEmptyResearch.length === 0) {
    const urls = Array.from(new Set(usableSearchTools.flatMap((t) => t.urls || [])));
    const hasExtractedPages = usableSearchTools.some((t) => t.toolName === 'extractWebPages');
    claims.push({
      id: 'claim-web-research',
      statement: hasExtractedPages
        ? `Live web search and page extraction returned ${urls.length} attributable source(s).`
        : `Live search returned ${urls.length} source excerpt(s) (full page extraction not run).`,
      status: hasExtractedPages ? 'verified' : 'partial',
      basisSummary: `${urls.length} live source URL(s)`,
      sourceType: 'web_research',
      sourceRefs: urls.slice(0, 8).map((u) => ({
        kind: 'url',
        label: u,
        url: u,
        timestamp: nowIso,
      })),
      gapOrConflictNote: hasExtractedPages
        ? undefined
        : 'Search snippets provide partial evidence; full page extraction would be needed for full depth.',
    });
  } else if (failedOrEmptyResearch.length > 0) {
    claims.push({
      id: 'claim-web-research-gap',
      statement: 'External research was attempted but failed or returned insufficient attributable evidence.',
      status: usableSearchTools.length > 0 ? 'partial' : 'unverified',
      basisSummary: failedOrEmptyResearch.map((t) => t.summary).join(' | '),
      sourceType: 'web_research',
      sourceRefs: usableSearchTools
        .flatMap((t) => t.urls || [])
        .slice(0, 5)
        .map((u) => ({ kind: 'url', label: u, url: u, timestamp: nowIso })),
      gapOrConflictNote: failedOrEmptyResearch.map((t) => t.summary).join('; '),
    });
  } else if (
    toolLedger.some((t) => t.toolName === 'searchWeb' && t.executionStatus === 'not_attempted')
  ) {
    claims.push({
      id: 'claim-unverified-time-sensitive',
      statement: 'Request appears to require external or prior-decision verification without a completed live search.',
      status: includedMemories.some((m) => m.confidenceStatus === 'confirmed') ? 'partial' : 'unverified',
      basisSummary: 'No live web verification executed for external facts.',
      sourceType: 'reasoning',
      sourceRefs: [],
      gapOrConflictNote: 'External verification not attempted; treat ungrounded factual assertions cautiously.',
    });
  }

  // 4. Other non-research tools (vault writes, active rules, history, artifacts)
  const otherTools = toolLedger.filter(
    (t) => t.toolName !== 'searchWeb' && t.toolName !== 'extractWebPages'
  );
  for (let i = 0; i < otherTools.length; i++) {
    const tool = otherTools[i];
    const status: ClaimEvidenceStatus =
      tool.executionStatus === 'succeeded_usable'
        ? 'verified'
        : tool.executionStatus === 'succeeded_insufficient'
          ? 'partial'
          : 'unverified';
    claims.push({
      id: `claim-tool-${tool.toolName}-${i}`,
      statement: tool.summary,
      status,
      basisSummary: `Tool: ${tool.toolName} (${tool.executionStatus})`,
      sourceType: 'tool_output',
      sourceRefs: [{ kind: 'tool', label: tool.toolName, timestamp: tool.timestamp }],
      gapOrConflictNote:
        status === 'verified' ? undefined : tool.errorMessage || tool.summary,
    });
  }

  // 5. Fallback general reasoning claim when reply has text and no external tool/memory claims exist
  if (claims.length === 0 && input.replyText.trim()) {
    claims.push({
      id: 'claim-general-reasoning',
      statement: 'Response synthesized from model reasoning and active conversation context without external tool verification.',
      status: 'inferred',
      basisSummary: 'Conversational synthesis & reasoning',
      sourceType: 'reasoning',
      sourceRefs: [],
    });
  }

  const hasUnverifiedMaterialClaims = claims.some((c) => c.status === 'unverified');
  const verifiedCount = claims.filter((c) => c.status === 'verified').length;
  const partialCount = claims.filter((c) => c.status === 'partial').length;
  const inferredCount = claims.filter((c) => c.status === 'inferred').length;
  const unverifiedCount = claims.filter((c) => c.status === 'unverified').length;

  // Strict overall posture rule: never classify entire response as 'verified' if ANY claim
  // is non-verified, any tool failed/was insufficient, or any memory conflict remains unresolved.
  let overallPosture: VerificationOverallPosture;
  let summaryLabel: string;

  if (
    verifiedCount > 0 &&
    partialCount === 0 &&
    inferredCount === 0 &&
    unverifiedCount === 0 &&
    !hasToolFailures &&
    !hasInsufficientTools &&
    !hasMemoryConflicts
  ) {
    overallPosture = 'verified';
    summaryLabel = `Verified (${verifiedCount}/${claims.length} claims sourced)`;
  } else if (unverifiedCount === claims.length || (hasToolFailures && verifiedCount === 0)) {
    overallPosture = 'unverified';
    summaryLabel = 'Unverified — missing or failed evidence';
  } else if (verifiedCount > 0 && (partialCount > 0 || inferredCount > 0 || unverifiedCount > 0 || hasMemoryConflicts)) {
    overallPosture = 'mixed';
    summaryLabel = `Mixed evidence (${verifiedCount} verified, ${claims.length - verifiedCount} partial/inferred/unverified)`;
  } else if (partialCount > 0) {
    overallPosture = 'partial';
    summaryLabel = 'Partial evidence — details incomplete';
  } else {
    overallPosture = 'unassisted_reasoning';
    summaryLabel = 'Inferred reasoning — no external tools invoked';
  }

  const bannerMessages: Array<{ severity: 'error' | 'warning'; code: string; message: string }> = [];

  if (hasToolFailures) {
    const failedNames = toolLedger
      .filter((t) => t.executionStatus === 'failed')
      .map((t) => `${t.toolName}${t.errorCode ? ` (${t.errorCode})` : ''}`)
      .join(', ');
    bannerMessages.push({
      severity: 'error',
      code: 'TOOL_EXECUTION_FAILED',
      message: `Tool failure recorded during this turn: ${failedNames}. Related claims cannot be treated as verified.`,
    });
  }

  if (hasInsufficientTools) {
    const insuffNames = toolLedger
      .filter((t) => t.executionStatus === 'succeeded_insufficient')
      .map((t) => t.toolName)
      .join(', ');
    bannerMessages.push({
      severity: 'warning',
      code: 'TOOL_OUTPUT_INSUFFICIENT',
      message: `${insuffNames} completed without sufficient attributable source material.`,
    });
  }

  if (hasMemoryConflicts) {
    bannerMessages.push({
      severity: 'warning',
      code: 'MEMORY_CONFLICT_UNRESOLVED',
      message: `${conflictsDetected.length} conflicting memory record(s) preserved for your review instead of silently overwriting history.`,
    });
  }

  if (hasUnverifiedMaterialClaims && !hasToolFailures) {
    bannerMessages.push({
      severity: 'warning',
      code: 'MATERIAL_CLAIMS_UNVERIFIED',
      message: 'One or more material claims lack verified live or confirmed memory backing.',
    });
  }

  return {
    generatedAt: nowIso,
    overallPosture,
    summaryLabel,
    hasToolFailures,
    hasInsufficientTools,
    hasUnverifiedMaterialClaims,
    hasMemoryConflicts,
    bannerMessages,
    claims,
    toolLedger,
    memoryDiagnostics,
    conflictsDetected,
  };
}
