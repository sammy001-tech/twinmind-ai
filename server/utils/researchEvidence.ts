/**
 * Pure evidence-bound helpers for live research.
 *
 * These functions normalize provider-returned records and validate model-produced plans.
 * They never manufacture sources, titles, excerpts, publication dates, scores, or search queries.
 */

import { isIP } from 'node:net';
import { isArtifactGenerationRequest } from './artifactFormat.ts';

export interface ResearchSource {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
}

export interface AdaptiveResearchPlan {
  followUpQueries: string[];
  unresolvedQuestions: string[];
}

function isNonPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipVersion = isIP(host);

  if (ipVersion === 4) {
    const octets = host.split('.').map(Number);
    const [a, b, d] = octets;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && d === 113) ||
      a >= 224
    );
  }
  if (ipVersion === 6) {
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb') ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('ff') ||
      host.startsWith('::ffff:')
    );
  }

  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    !host.includes('.')
  );
}

export function canonicalHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      isNonPublicHostname(parsed.hostname)
    ) {
      return null;
    }
    parsed.hash = '';
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return null;
  }
}

function firstText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

function normalizeSourceArray(
  value: unknown,
  maxContentChars: number,
  allowedSources?: ResearchSource[],
): ResearchSource[] {
  if (!Array.isArray(value)) return [];

  const allowedByCanonical = allowedSources
    ? new Map(allowedSources.map((source) => [canonicalHttpUrl(source.url), source] as const))
    : undefined;
  const allowedByProvenanceKey = allowedSources
    ? new Map(allowedSources.map((source) => [normalizeUrlForProvenanceMatch(source.url), source] as const))
    : undefined;
  const unique = new Map<string, ResearchSource>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const url = canonicalHttpUrl(record.url);
    if (!url) continue;
    const provenanceKey = normalizeUrlForProvenanceMatch(url);
    const isAllowed = !allowedSources
      || allowedByCanonical?.has(url)
      || (provenanceKey !== null && allowedByProvenanceKey?.has(provenanceKey));
    if (!isAllowed) continue;

    const knownSource =
      allowedByCanonical?.get(url) ||
      (provenanceKey !== null ? allowedByProvenanceKey?.get(provenanceKey) : undefined);
    const title = firstText(record, ['title']) || knownSource?.title || '';
    const content = firstText(record, ['raw_content', 'rawContent', 'content', 'snippet', 'extract']);
    if (!title || !content) continue;

    const normalized: ResearchSource = {
      title,
      url,
      content: content.slice(0, maxContentChars),
    };

    if (typeof record.score === 'number' && Number.isFinite(record.score)) {
      normalized.score = record.score;
    }

    const publishedDate = firstText(record, ['published_date', 'publishedDate', 'published_at', 'publishedAt']);
    if (publishedDate) normalized.publishedDate = publishedDate;

    const existing = unique.get(url);
    if (!existing || normalized.content.length > existing.content.length) {
      if (existing) {
        if (normalized.score === undefined && existing.score !== undefined) normalized.score = existing.score;
        if (!normalized.publishedDate && existing.publishedDate) normalized.publishedDate = existing.publishedDate;
      }
      unique.set(url, normalized);
    } else {
      if (existing.score === undefined && normalized.score !== undefined) existing.score = normalized.score;
      if (!existing.publishedDate && normalized.publishedDate) existing.publishedDate = normalized.publishedDate;
    }
  }

  return [...unique.values()];
}

/** Normalize, validate, and deduplicate requested source URLs without accepting non-HTTP protocols. */
export function normalizeResearchUrls(value: unknown, maxUrls = 5): string[] {
  if (!Array.isArray(value) || !Number.isSafeInteger(maxUrls) || maxUrls <= 0) return [];
  const unique = new Set<string>();
  for (const candidate of value) {
    const url = canonicalHttpUrl(candidate);
    if (!url || unique.has(url)) continue;
    unique.add(url);
    if (unique.size >= maxUrls) break;
  }
  return [...unique];
}

/** Preserve only source records with provider-returned titles, HTTP(S) URLs, and evidence text. */
export function normalizeResearchSearchResults(
  value: unknown,
  maxContentChars = 6000,
): ResearchSource[] {
  const payload = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const results = Array.isArray(value) ? value : payload?.results;
  return normalizeSourceArray(results, maxContentChars);
}

/** Preserve only extracted pages that match URLs returned by the preceding search. */
export function normalizeResearchExtractions(
  value: unknown,
  allowedSources: ResearchSource[],
  maxContentChars = 12000,
): ResearchSource[] {
  const payload = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const results = Array.isArray(value)
    ? value
    : payload?.results ?? payload?.extract_results;
  return normalizeSourceArray(results, maxContentChars, allowedSources);
}

export interface InitialResearchPlan {
  researchQuestions: string[];
  searchQueries: string[];
}

/** Validate the initial decomposition produced by the configured live model. */
export function parseInitialResearchPlan(
  raw: string,
  options: { maxQueries: number; excludeQueries?: string[] },
): InitialResearchPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('RESEARCH_INITIAL_PLAN_INVALID_JSON: the selected model did not return valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('RESEARCH_INITIAL_PLAN_SCHEMA_INVALID: expected a JSON object');
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    !Array.isArray(candidate.searchQueries) ||
    !candidate.searchQueries.every((value) => typeof value === 'string') ||
    !Array.isArray(candidate.researchQuestions) ||
    !candidate.researchQuestions.every((value) => typeof value === 'string')
  ) {
    throw new Error('RESEARCH_INITIAL_PLAN_SCHEMA_INVALID: searchQueries and researchQuestions must be string arrays');
  }

  const excluded = new Set((options.excludeQueries || []).map((query) => query.trim().toLocaleLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const searchQueries: string[] = [];
  for (const value of candidate.searchQueries) {
    const query = value.trim();
    const key = query.toLocaleLowerCase();
    if (!query || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    searchQueries.push(query);
    if (searchQueries.length >= options.maxQueries) break;
  }

  const researchQuestions = [...new Set(candidate.researchQuestions.map((value) => value.trim()).filter(Boolean))];
  if (options.maxQueries <= 0) searchQueries.length = 0;
  return { researchQuestions, searchQueries };
}

/** Select only search modes supported by the live retrieval provider. */
export function resolveResearchSearchDepth(env: Record<string, string | undefined>): 'basic' | 'advanced' {
  const configured = env.TWINMIND_RESEARCH_SEARCH_DEPTH;
  if (configured === undefined || configured.trim() === '') return 'advanced';
  const value = configured.trim().toLowerCase();
  if (value === 'basic' || value === 'advanced') return value;
  throw new Error('RESEARCH_CONFIGURATION_INVALID:TWINMIND_RESEARCH_SEARCH_DEPTH: expected basic or advanced');
}

/**
 * Read a numeric operational limit from the runtime environment.
 * Defaults here are execution limits, not generated research content or claimed live facts.
 * An explicitly provided but invalid value fails closed rather than being silently substituted.
 */
export function resolveBoundedIntegerSetting(
  env: Record<string, string | undefined>,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`RESEARCH_CONFIGURATION_INVALID:${name}: expected an integer from ${minimum} to ${maximum}`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`RESEARCH_CONFIGURATION_INVALID:${name}: expected an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

/** Validate citation identifiers against source IDs created from the current research evidence ledger. */
export function inspectCitationReferences(
  text: string,
  validSourceIds: ReadonlySet<string>,
): { hasCitation: boolean; unknownIds: string[] } {
  const ids = [...text.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
  return {
    hasCitation: ids.length > 0,
    unknownIds: [...new Set(ids.filter((id) => !validSourceIds.has(id)))],
  };
}

/** Parse an adaptive plan returned by the configured live model; malformed output is an error. */
export function parseAdaptiveResearchPlan(
  raw: string,
  options: { maxQueries: number; previouslySearched?: string[] },
): AdaptiveResearchPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('RESEARCH_PLAN_INVALID_JSON: the selected model did not return valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('RESEARCH_PLAN_SCHEMA_INVALID: expected a JSON object');
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    !Array.isArray(candidate.followUpQueries) ||
    !candidate.followUpQueries.every((value) => typeof value === 'string') ||
    !Array.isArray(candidate.unresolvedQuestions) ||
    !candidate.unresolvedQuestions.every((value) => typeof value === 'string')
  ) {
    throw new Error('RESEARCH_PLAN_SCHEMA_INVALID: followUpQueries and unresolvedQuestions must be string arrays');
  }

  if (options.maxQueries <= 0) {
    return {
      followUpQueries: [],
      unresolvedQuestions: [...new Set(candidate.unresolvedQuestions.map((value) => value.trim()).filter(Boolean))],
    };
  }

  const prior = new Set((options.previouslySearched || []).map((query) => query.trim().toLocaleLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const followUpQueries: string[] = [];

  for (const value of candidate.followUpQueries) {
    const query = value.trim();
    const key = query.toLocaleLowerCase();
    if (!query || prior.has(key) || seen.has(key)) continue;
    seen.add(key);
    followUpQueries.push(query);
    if (followUpQueries.length >= options.maxQueries) break;
  }

  const unresolvedQuestions = [...new Set(
    candidate.unresolvedQuestions.map((value) => value.trim()).filter(Boolean),
  )];

  return { followUpQueries, unresolvedQuestions };
}

const BENIGN_TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
]);

/**
 * Compute a comparison key for verifying that an extraction target URL came from
 * an earlier live search or user message without altering SSRF / hostname safety.
 */
export function normalizeUrlForProvenanceMatch(value: unknown): string | null {
  const canonical = canonicalHttpUrl(value);
  if (!canonical) return null;
  try {
    const parsed = new URL(canonical);
    parsed.protocol = 'https:';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...parsed.searchParams.keys()]) {
      if (BENIGN_TRACKING_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Partition requested extraction URLs against verified allowed URLs (from live search
 * or explicit user prompt), substituting exact verified canonical URLs when matched.
 */
export function partitionExtractionUrls(
  rawRequestedUrls: unknown,
  allowedUrls: string[],
): {
  matchedUrls: string[];
  unauthorizedUrls: string[];
  invalidEntries: boolean;
} {
  if (!Array.isArray(rawRequestedUrls)) {
    return { matchedUrls: [], unauthorizedUrls: [], invalidEntries: true };
  }

  const allowedByProvenanceKey = new Map<string, string>();
  for (const allowed of allowedUrls) {
    const canonical = canonicalHttpUrl(allowed);
    if (!canonical) continue;
    const key = normalizeUrlForProvenanceMatch(canonical);
    if (key && !allowedByProvenanceKey.has(key)) {
      allowedByProvenanceKey.set(key, canonical);
    }
  }

  const matchedSet = new Set<string>();
  const unauthorizedSet = new Set<string>();
  let invalidEntries = false;

  for (const rawEntry of rawRequestedUrls) {
    if (typeof rawEntry !== 'string') {
      invalidEntries = true;
      continue;
    }
    const canonical = canonicalHttpUrl(rawEntry);
    if (!canonical) {
      invalidEntries = true;
      continue;
    }
    const key = normalizeUrlForProvenanceMatch(canonical);
    const verifiedCanonical = key ? allowedByProvenanceKey.get(key) : undefined;
    if (verifiedCanonical) {
      matchedSet.add(verifiedCanonical);
    } else {
      unauthorizedSet.add(canonical);
    }
  }

  return {
    matchedUrls: [...matchedSet],
    unauthorizedUrls: [...unauthorizedSet],
    invalidEntries,
  };
}

/** Split an array of URLs into provider-sized batches without silently dropping items. */
export function chunkUrlsByBatchLimit(urls: string[], batchLimit: number): string[][] {
  const safeLimit = Number.isSafeInteger(batchLimit) && batchLimit >= 1 ? batchLimit : 1;
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += safeLimit) {
    batches.push(urls.slice(i, i + safeLimit));
  }
  return batches;
}

export interface DynamicAgentExecutionPolicy {
  maxToolCalls: number;
  maxToolRounds: number;
  extractBatchLimit: number;
  deliverableReserveCalls: number;
  budgetSource: 'explicit_env' | 'dynamic_task_resolved';
  taskProfile: {
    thinkingLevel: 'low' | 'medium' | 'high';
    requiresArtifactDelivery: boolean;
    requiresDeepResearch: boolean;
  };
}

const TAVILY_EXTRACT_API_MAX_BATCH = 20;

/**
 * Dynamically resolve execution budgets from live task requirements and explicit
 * operator environment configuration instead of rigid static turn caps.
 */
export function resolveDynamicAgentExecutionPolicy(input: {
  env: Record<string, string | undefined>;
  userPrompt: string;
  thinkingLevel?: 'low' | 'medium' | 'high';
  hasSearchProvider?: boolean;
}): DynamicAgentExecutionPolicy {
  const thinkingLevel: 'low' | 'medium' | 'high' =
    input.thinkingLevel === 'high' || input.thinkingLevel === 'medium' ? input.thinkingLevel : 'low';
  const prompt = (input.userPrompt || '').trim();
  const hasExplicitUrls = /https?:\/\/[^\s"'<>]+/i.test(prompt);
  const requiresArtifactDelivery =
    isArtifactGenerationRequest(prompt) ||
    /\b(?:create|generate|export|prepare|produce|make|write)\b[\s\S]{0,60}\b(?:pdf|xlsx|excel|csv|markdown|report|document)\b/i.test(prompt);
  const requiresDeepResearch =
    Boolean(input.hasSearchProvider) &&
    (hasExplicitUrls ||
      /\b(?:research|deep\s+dive|analy[sz]e|compar(?:e|ison)|market|evidence|sources?|citations?|benchmark|frameworks?|latest|current|state\s+of|report)\b/i.test(prompt));

  const extractBatchLimit = resolveBoundedIntegerSetting(
    input.env,
    'TWINMIND_RESEARCH_EXTRACT_LIMIT',
    10,
    1,
    TAVILY_EXTRACT_API_MAX_BATCH,
  );

  const hasExplicitCalls =
    typeof input.env.TWINMIND_AGENT_MAX_TOOL_CALLS === 'string' &&
    input.env.TWINMIND_AGENT_MAX_TOOL_CALLS.trim() !== '';
  const hasExplicitRounds =
    typeof input.env.TWINMIND_AGENT_MAX_TOOL_ROUNDS === 'string' &&
    input.env.TWINMIND_AGENT_MAX_TOOL_ROUNDS.trim() !== '';

  const baseCallsByThinking = thinkingLevel === 'high' ? 14 : thinkingLevel === 'medium' ? 10 : 6;
  const baseRoundsByThinking = thinkingLevel === 'high' ? 6 : thinkingLevel === 'medium' ? 5 : 3;

  const computedCalls = Math.min(
    24,
    baseCallsByThinking + (requiresDeepResearch ? 4 : 0) + (requiresArtifactDelivery ? 2 : 0),
  );
  const computedRounds = Math.min(
    10,
    baseRoundsByThinking + (requiresDeepResearch ? 1 : 0) + (requiresArtifactDelivery ? 1 : 0),
  );

  const maxToolCalls = hasExplicitCalls
    ? resolveBoundedIntegerSetting(input.env, 'TWINMIND_AGENT_MAX_TOOL_CALLS', computedCalls, 1, 60)
    : computedCalls;

  const maxToolRounds = hasExplicitRounds
    ? resolveBoundedIntegerSetting(input.env, 'TWINMIND_AGENT_MAX_TOOL_ROUNDS', computedRounds, 1, 16)
    : computedRounds;

  // Preserve at least 1 execution slot for final deliverable synthesis when total budget > 1
  const deliverableReserveCalls = requiresArtifactDelivery && maxToolCalls > 1 ? 1 : 0;

  return {
    maxToolCalls,
    maxToolRounds,
    extractBatchLimit,
    deliverableReserveCalls,
    budgetSource: hasExplicitCalls || hasExplicitRounds ? 'explicit_env' : 'dynamic_task_resolved',
    taskProfile: {
      thinkingLevel,
      requiresArtifactDelivery,
      requiresDeepResearch,
    },
  };
}
