/**
 * Sanitized PostgreSQL connection diagnostics.
 *
 * These helpers intentionally never return the connection string, username, or
 * password. They retain enough network error metadata to distinguish common
 * transient connection failures from terminal configuration/authentication errors.
 */
type ErrorRecord = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  errno?: unknown;
  syscall?: unknown;
  address?: unknown;
  port?: unknown;
  cause?: unknown;
};

export interface DatabaseConnectionDiagnostics {
  message: string;
  name?: string;
  code?: string;
  syscall?: string;
  address?: string;
  port?: number;
  causeMessage?: string;
  causeCode?: string;
  causeSyscall?: string;
  targetHost?: string;
  targetPort?: number;
  sslMode?: string;
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  '57P01',
  '57P02',
  '57P03',
]);

function asErrorRecord(value: unknown): ErrorRecord | null {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
  return value as ErrorRecord;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readPort(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (parsed > 0 && parsed <= 65535) return parsed;
  }
  return undefined;
}

function errorChain(error: unknown): ErrorRecord[] {
  const chain: ErrorRecord[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && chain.length < 5 && !seen.has(current)) {
    seen.add(current);
    const record = asErrorRecord(current);
    if (!record) break;
    chain.push(record);
    current = record.cause;
  }
  return chain;
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/\b(password|passwd|secret|token|api[_-]?key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[REDACTED]');
}

export function isRetryableDatabaseError(error: unknown): boolean {
  const chain = errorChain(error);
  for (const item of chain) {
    const code = readString(item.code) || readString(item.errno);
    if (code && TRANSIENT_CODES.has(code.toUpperCase())) return true;

    const message = readString(item.message)?.toLowerCase() || '';
    if (
      message.includes('connection terminated due to connection timeout') ||
      message.includes('timeout') ||
      message.includes('socket hang up') ||
      message.includes('connection reset') ||
      message.includes('connection terminated unexpectedly') ||
      message.includes('server closed the connection unexpectedly')
    ) {
      return true;
    }
  }
  return false;
}

export function summarizeDatabaseConnectionError(
  error: unknown,
  connectionString?: string,
): DatabaseConnectionDiagnostics {
  const chain = errorChain(error);
  const outer = chain[0];
  const root = chain.length > 1 ? chain[chain.length - 1] : outer;
  const rawMessage = readString(outer?.message) || (typeof error === 'string' ? error : 'Unknown database connection error');
  const rawCauseMessage = root && root !== outer ? readString(root.message) : undefined;

  let targetHost: string | undefined;
  let targetPort: number | undefined;
  let sslMode: string | undefined;
  if (connectionString) {
    try {
      const parsed = new URL(connectionString);
      targetHost = parsed.hostname || undefined;
      targetPort = readPort(parsed.port) || 5432;
      sslMode = readString(parsed.searchParams.get('sslmode') || undefined);
    } catch {
      // Do not surface the raw URL if it is malformed; that could contain credentials.
    }
  }

  const code = chain.map(item => readString(item.code) || readString(item.errno)).find(Boolean);
  const syscall = [...chain].reverse().map(item => readString(item.syscall)).find(Boolean);
  const address = [...chain].reverse().map(item => readString(item.address)).find(Boolean);
  const port = [...chain].reverse().map(item => readPort(item.port)).find(Boolean);

  return {
    message: sanitizeMessage(rawMessage),
    ...(readString(outer?.name) ? { name: readString(outer?.name) } : {}),
    ...(code ? { code } : {}),
    ...(syscall ? { syscall } : {}),
    ...(address ? { address } : {}),
    ...(port ? { port } : {}),
    ...(rawCauseMessage ? { causeMessage: sanitizeMessage(rawCauseMessage) } : {}),
    ...(root !== outer && readString(root?.code) ? { causeCode: readString(root?.code) } : {}),
    ...(root !== outer && readString(root?.syscall) ? { causeSyscall: readString(root?.syscall) } : {}),
    ...(targetHost ? { targetHost } : {}),
    ...(targetPort ? { targetPort } : {}),
    ...(sslMode ? { sslMode } : {}),
  };
}
