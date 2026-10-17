/**
 * Pure evidence-bound helpers for live research.
 *
 * These functions normalize provider-returned records and validate model-produced plans.
 * They never manufacture sources, titles, excerpts, publication dates, scores, or search queries.
 */

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

function canonicalHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
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

  const allowed = allowedSources
    ? new Map(allowedSources.map((source) => [canonicalHttpUrl(source.url), source] as const))
    : undefined;
  const unique = new Map<string, ResearchSource>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const url = canonicalHttpUrl(record.url);
    if (!url || (allowed && !allowed.has(url))) continue;

    const knownSource = allowed?.get(url);
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
      unique.set(url, normalized);
    } else if (existing.score === undefined && normalized.score !== undefined) {
      existing.score = normalized.score;
    }
  }

  return [...unique.values()];
}

/** Normalize, validate, and deduplicate requested source URLs without accepting non-HTTP protocols. */
export function normalizeResearchUrls(value: unknown, maxUrls = 5): string[] {
  if (!Array.isArray(value)) return [];
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
