/**
 * Structured Data Query Service (SQL + External REST/GraphQL API)
 *
 * Enforces strict ZeroMock, dynamic schema introspection, SSRF prevention,
 * and PostgreSQL READ ONLY transactional safety:
 * - Never executes DDL/DML or accesses secret/system tables.
 * - Never fabricates database records or API responses when offline/unavailable.
 */

import { neonDb } from '../db/neonService.ts';
import { canonicalHttpUrl, resolveBoundedIntegerSetting } from '../utils/researchEvidence.ts';

export const SAFE_QUERYABLE_TABLES = new Set([
  'chat_threads',
  'conversations',
  'decisions',
  'decision_reviews',
  'decision_experiments',
  'decision_experiment_observations',
  'learning_journeys',
  'scheduled_checkins',
  'twin_knowledge',
  'generated_artifacts',
]);

// Columns stripped from schema introspection and redacted if returned
const SENSITIVE_OR_BINARY_COLUMNS = new Set([
  'embedding',
  'content_bytes',
  'api_key',
  'access_token',
  'secret',
  'password',
  'custom_gemini_key',
  'custom_groq_key',
  'custom_mistral_key',
  'custom_tavily_key',
]);

const FORBIDDEN_SQL_KEYWORDS_REGEX =
  /\b(?:insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|copy|call|do|execute|prepare|deallocate|vacuum|analyze|lock|begin|commit|rollback|savepoint|set|reset|show|listen|notify|dblink|lo_import|lo_export|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_terminate_backend|pg_cancel_backend)\b/i;

const FORBIDDEN_SYSTEM_SCHEMA_REGEX =
  /\b(?:pg_catalog|pg_toast|information_schema|pg_shadow|pg_authid|pg_roles|pg_stat_activity|pg_user|twin_settings|persona_memories|twin_jobs|telegram_updates|channel_delivery_receipts)\b/i;

export interface SchemaColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
}

export interface SchemaTableInfo {
  tableName: string;
  columns: SchemaColumnInfo[];
}

export interface ReadOnlySqlValidationResult {
  valid: boolean;
  normalizedSql?: string;
  referencedTables?: string[];
  code?: string;
  error?: string;
}

function stripSqlStringLiterals(sql: string): string {
  // Replace single-quoted string literals and dollar-quoted blocks with placeholders so keyword checks inspect only SQL structure
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, "''")
    .replace(/'(?:''|[^'])*'/g, "''");
}

/**
 * Validate a candidate read-only SQL query strictly before executing against Neon PostgreSQL.
 */
export function validateReadOnlySqlQuery(rawSql: unknown): ReadOnlySqlValidationResult {
  if (typeof rawSql !== 'string' || !rawSql.trim()) {
    return {
      valid: false,
      code: 'SQL_QUERY_REQUIRED',
      error: 'Provide a non-empty SQL SELECT or WITH query.',
    };
  }

  let normalized = rawSql.trim().replace(/;+\s*$/, '');
  if (!normalized) {
    return {
      valid: false,
      code: 'SQL_QUERY_REQUIRED',
      error: 'Provide a non-empty SQL SELECT or WITH query.',
    };
  }

  // Reject SQL comments that could mask multi-statements or bypass keyword scanners
  if (/--|\/\*/.test(normalized)) {
    return {
      valid: false,
      code: 'QUERY_READONLY_VIOLATION',
      error: 'SQL comments (-- or /* */) are disallowed in structured queries.',
    };
  }

  const structural = stripSqlStringLiterals(normalized);

  // Reject stacked / multi-statement queries
  if (structural.includes(';')) {
    return {
      valid: false,
      code: 'QUERY_MULTI_STATEMENT_DISALLOWED',
      error: 'Only a single SELECT statement is permitted per query.',
    };
  }

  // Must start with SELECT or WITH
  if (!/^(?:select|with)\b/i.test(structural.trim())) {
    return {
      valid: false,
      code: 'QUERY_READONLY_VIOLATION',
      error: 'Only read-only SELECT or WITH queries are permitted.',
    };
  }

  if (FORBIDDEN_SQL_KEYWORDS_REGEX.test(structural)) {
    return {
      valid: false,
      code: 'QUERY_READONLY_VIOLATION',
      error: 'Query contains forbidden mutating, administrative, or side-effect SQL keywords.',
    };
  }

  if (FORBIDDEN_SYSTEM_SCHEMA_REGEX.test(structural)) {
    return {
      valid: false,
      code: 'TABLE_NOT_ALLOWLISTED',
      error: 'Query references a restricted or system table/schema outside the allowlisted analytics views.',
    };
  }

  // Collect CTE alias names so WITH cte_name AS (...) doesn't trigger allowlist rejection
  const cteAliases = new Set<string>();
  const cteRegex = /(?:with|,)\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi;
  let cteMatch: RegExpExecArray | null;
  while ((cteMatch = cteRegex.exec(structural)) !== null) {
    cteAliases.add(cteMatch[1].toLowerCase());
  }

  // Inspect all referenced tables in FROM / JOIN clauses
  const referencedTables: string[] = [];
  const tableRefRegex = /\b(?:from|join)\s+(?!\()([a-z_][a-z0-9_."]*)/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRefRegex.exec(structural)) !== null) {
    const rawIdentifier = tableMatch[1].replace(/"/g, '').toLowerCase();
    // Skip FROM subquery aliases or LATERAL / UNNEST / JSONB helpers
    if (/^(?:unnest|generate_series|jsonb_array_elements|jsonb_each|lateral)$/.test(rawIdentifier)) {
      continue;
    }
    const tableName = rawIdentifier.includes('.') ? rawIdentifier.split('.').pop() || '' : rawIdentifier;
    const schemaPrefix = rawIdentifier.includes('.') ? rawIdentifier.split('.')[0] : 'public';
    if (schemaPrefix !== 'public') {
      return {
        valid: false,
        code: 'TABLE_NOT_ALLOWLISTED',
        error: `Only tables in the public schema are queryable (disallowed schema "${schemaPrefix}").`,
      };
    }
    if (cteAliases.has(tableName)) continue;
    if (!SAFE_QUERYABLE_TABLES.has(tableName)) {
      return {
        valid: false,
        code: 'TABLE_NOT_ALLOWLISTED',
        error: `Table "${tableName}" is not in the allowlisted queryable schema: ${[...SAFE_QUERYABLE_TABLES].join(', ')}.`,
      };
    }
    if (!referencedTables.includes(tableName)) {
      referencedTables.push(tableName);
    }
  }

  if (referencedTables.length === 0) {
    return {
      valid: false,
      code: 'QUERY_TABLE_REFERENCE_REQUIRED',
      error: 'Query must read from at least one allowlisted TwinMind table.',
    };
  }

  // Prevent selecting raw binary artifact bytes directly
  if (referencedTables.includes('generated_artifacts') && /\*\s*(?:,|$|\bfrom\b)|\bcontent\b/i.test(structural)) {
    return {
      valid: false,
      code: 'BINARY_COLUMN_DISALLOWED',
      error: 'Select explicit metadata columns from generated_artifacts rather than binary content or SELECT *.',
    };
  }

  return {
    valid: true,
    normalizedSql: normalized,
    referencedTables,
  };
}

/**
 * Dynamically introspect live PostgreSQL schema columns for allowlisted tables.
 */
export async function inspectAllowlistedSchema(): Promise<{
  status: 'success' | 'error';
  code?: string;
  error?: string;
  tables: SchemaTableInfo[];
}> {
  if (!neonDb.isDatabaseConnected()) {
    const connected = await neonDb.ensureConnected().catch(() => false);
    if (!connected) {
      return {
        status: 'error',
        code: 'DATABASE_UNCONNECTED',
        error: 'Neon PostgreSQL is not connected; live schema introspection is unavailable.',
        tables: [],
      };
    }
  }

  try {
    const tableList = [...SAFE_QUERYABLE_TABLES];
    const result = await neonDb.executeReadOnlyTransaction(async (queryFn) => {
      return await queryFn(
        `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
         ORDER BY table_name ASC, ordinal_position ASC`,
        [tableList],
      );
    });

    const grouped = new Map<string, SchemaColumnInfo[]>();
    for (const row of result.rows) {
      const tableName = String(row.table_name);
      const columnName = String(row.column_name);
      // Exclude binary artifact bytes and vector embeddings from introspected query surface
      if (
        SENSITIVE_OR_BINARY_COLUMNS.has(columnName.toLowerCase()) ||
        (tableName === 'generated_artifacts' && columnName.toLowerCase() === 'content')
      ) {
        continue;
      }
      const cols = grouped.get(tableName) || [];
      cols.push({
        columnName,
        dataType: String(row.data_type),
        isNullable: String(row.is_nullable).toUpperCase() === 'YES',
      });
      grouped.set(tableName, cols);
    }

    const tables: SchemaTableInfo[] = [...grouped.entries()].map(([tableName, columns]) => ({
      tableName,
      columns,
    }));

    return {
      status: 'success',
      tables,
    };
  } catch (err: unknown) {
    return {
      status: 'error',
      code: 'SCHEMA_INTROSPECTION_FAILED',
      error: err instanceof Error ? err.message : 'Failed to inspect PostgreSQL schema.',
      tables: [],
    };
  }
}

/**
 * Execute a validated, parameterized, read-only SQL SELECT query inside a READ ONLY transaction.
 */
export async function executeReadOnlySqlQuery(
  rawSql: unknown,
  params: unknown[] = [],
  requestedMaxRows?: number,
): Promise<{
  status: 'success' | 'error';
  code?: string;
  error?: string;
  rowCount: number;
  maxRowsApplied?: number;
  truncated?: boolean;
  columns?: string[];
  rows: Array<Record<string, unknown>>;
}> {
  const configuredMaxRows = resolveBoundedIntegerSetting(
    process.env,
    'TWINMIND_STRUCTURED_QUERY_MAX_ROWS',
    50,
    1,
    200,
  );
  const maxRows = typeof requestedMaxRows === 'number' && Number.isSafeInteger(requestedMaxRows) && requestedMaxRows >= 1
    ? Math.min(requestedMaxRows, configuredMaxRows)
    : configuredMaxRows;

  const validation = validateReadOnlySqlQuery(rawSql);
  if (!validation.valid || !validation.normalizedSql) {
    return {
      status: 'error',
      code: validation.code || 'QUERY_READONLY_VIOLATION',
      error: validation.error || 'SQL query validation failed.',
      rowCount: 0,
      rows: [],
    };
  }

  const safeParams = Array.isArray(params) ? params : [];
  // Wrap query in a bounded subselect so oversized tables never flood memory
  const boundedSql = `SELECT * FROM (${validation.normalizedSql}) AS _tm_query_result LIMIT ${maxRows + 1}`;

  try {
    const result = await neonDb.executeReadOnlyTransaction(async (queryFn) => {
      return await queryFn(boundedSql, safeParams);
    });

    const truncated = result.rows.length > maxRows;
    const rawRows = truncated ? result.rows.slice(0, maxRows) : result.rows;

    const sanitizedRows = rawRows.map((row) => {
      const cleanRow: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(row || {})) {
        if (SENSITIVE_OR_BINARY_COLUMNS.has(key.toLowerCase())) {
          cleanRow[key] = '[REDACTED]';
        } else if (Buffer.isBuffer(val)) {
          cleanRow[key] = `[Binary ${val.length} bytes]`;
        } else {
          cleanRow[key] = val;
        }
      }
      return cleanRow;
    });

    const columns = sanitizedRows.length > 0
      ? Object.keys(sanitizedRows[0])
      : (result.fields?.map((f) => f.name) || []);

    return {
      status: 'success',
      rowCount: sanitizedRows.length,
      maxRowsApplied: maxRows,
      truncated,
      columns,
      rows: sanitizedRows,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Structured SQL query execution failed.';
    return {
      status: 'error',
      code: msg === 'DATABASE_UNAVAILABLE' ? 'DATABASE_UNCONNECTED' : 'QUERY_EXECUTION_FAILED',
      error: msg === 'DATABASE_UNAVAILABLE'
        ? 'Neon PostgreSQL is not connected; structured SQL query cannot run.'
        : msg,
      rowCount: 0,
      rows: [],
    };
  }
}

function resolveAllowedExternalApiHosts(env: Record<string, string | undefined>): string[] | null {
  const raw = env.TWINMIND_ALLOWED_DATA_API_HOSTS;
  if (!raw || !raw.trim()) return null;
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Execute an SSRF-validated HTTP REST JSON or GraphQL query against an external structured API.
 */
export async function executeExternalStructuredQuery(input: {
  url: unknown;
  method?: unknown;
  graphqlQuery?: unknown;
  variables?: unknown;
  headers?: unknown;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const safeUrl = canonicalHttpUrl(input.url);
  if (!safeUrl) {
    return {
      status: 'error',
      code: 'INVALID_API_URL',
      error: 'Provide a valid public HTTP(S) API URL. Internal, loopback, and private network addresses are blocked.',
    };
  }

  const parsedUrl = new URL(safeUrl);
  const allowedHosts = resolveAllowedExternalApiHosts(process.env);
  if (allowedHosts && !allowedHosts.includes(parsedUrl.hostname.toLowerCase())) {
    return {
      status: 'error',
      code: 'API_HOST_NOT_ALLOWLISTED',
      error: `Host "${parsedUrl.hostname}" is not in TWINMIND_ALLOWED_DATA_API_HOSTS.`,
    };
  }

  const isGraphql = typeof input.graphqlQuery === 'string' && input.graphqlQuery.trim().length > 0;
  const methodRaw = typeof input.method === 'string' ? input.method.trim().toUpperCase() : '';
  const method = isGraphql ? 'POST' : methodRaw === 'POST' ? 'POST' : 'GET';

  if (methodRaw && methodRaw !== 'GET' && methodRaw !== 'POST') {
    return {
      status: 'error',
      code: 'UNSUPPORTED_HTTP_METHOD',
      error: 'Structured external queries support only read-oriented GET or POST (GraphQL) requests.',
    };
  }

  const safeHeaders: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'TwinMind-StructuredQuery/1.0',
  };
  if (input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers)) {
    for (const [k, v] of Object.entries(input.headers as Record<string, unknown>)) {
      if (typeof v === 'string' && !/^(?:host|content-length|connection)$/i.test(k)) {
        safeHeaders[k] = v;
      }
    }
  }

  const timeoutMs = resolveBoundedIntegerSetting(
    process.env,
    'TWINMIND_STRUCTURED_API_TIMEOUT_MS',
    10000,
    1000,
    30000,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combinedSignal = input.signal
    ? AbortSignal.any([input.signal, controller.signal])
    : controller.signal;

  try {
    let body: string | undefined;
    if (isGraphql) {
      safeHeaders['Content-Type'] = 'application/json';
      body = JSON.stringify({
        query: String(input.graphqlQuery),
        ...(input.variables && typeof input.variables === 'object' ? { variables: input.variables } : {}),
      });
    } else if (method === 'POST' && input.variables !== undefined) {
      safeHeaders['Content-Type'] = 'application/json';
      body = JSON.stringify(input.variables);
    }

    const res = await fetch(safeUrl, {
      method,
      headers: safeHeaders,
      ...(body !== undefined ? { body } : {}),
      signal: combinedSignal,
    });

    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();
    const maxChars = 100000;
    const truncated = rawText.length > maxChars;
    const textSlice = truncated ? rawText.slice(0, maxChars) : rawText;

    if (!res.ok) {
      return {
        status: 'error',
        code: 'EXTERNAL_API_HTTP_ERROR',
        httpStatus: res.status,
        url: safeUrl,
        error: `External API returned HTTP ${res.status}: ${textSlice.slice(0, 500)}`,
      };
    }

    let parsedData: unknown = textSlice;
    try {
      parsedData = JSON.parse(rawText);
    } catch {
      if (contentType.includes('application/json')) {
        return {
          status: 'error',
          code: 'EXTERNAL_API_INVALID_JSON',
          httpStatus: res.status,
          url: safeUrl,
          error: 'External API declared application/json but returned malformed JSON.',
        };
      }
    }

    // Surface GraphQL errors transparently without claiming full success
    if (
      parsedData &&
      typeof parsedData === 'object' &&
      !Array.isArray(parsedData) &&
      Array.isArray((parsedData as Record<string, unknown>).errors) &&
      ((parsedData as Record<string, unknown>).errors as unknown[]).length > 0
    ) {
      return {
        status: 'error',
        code: 'GRAPHQL_QUERY_ERROR',
        httpStatus: res.status,
        url: safeUrl,
        errors: (parsedData as Record<string, unknown>).errors,
        data: (parsedData as Record<string, unknown>).data ?? null,
      };
    }

    return {
      status: 'success',
      httpStatus: res.status,
      url: safeUrl,
      contentType,
      truncated,
      data: parsedData,
    };
  } catch (err: unknown) {
    return {
      status: 'error',
      code: 'EXTERNAL_API_FETCH_FAILED',
      url: safeUrl,
      error: err instanceof Error ? err.message : 'External structured API request failed.',
    };
  } finally {
    clearTimeout(timer);
  }
}
