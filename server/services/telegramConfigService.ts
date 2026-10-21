import { normalizeProviderCredential } from './providerCredentialService.ts';

export type TelegramMode = 'polling' | 'webhook';

export function isTelegramMode(value: unknown): value is TelegramMode {
  return value === 'polling' || value === 'webhook';
}

export function resolveTelegramMode(environmentMode: unknown, savedMode: unknown): TelegramMode {
  if (environmentMode !== undefined && environmentMode !== null && String(environmentMode).trim()) {
    const normalizedEnvironmentMode = typeof environmentMode === 'string' ? environmentMode.trim() : environmentMode;
    if (isTelegramMode(normalizedEnvironmentMode)) return normalizedEnvironmentMode;
    throw new Error('INVALID_TELEGRAM_MODE');
  }
  const normalizedSavedMode = typeof savedMode === 'string' ? savedMode.trim() : savedMode;
  if (isTelegramMode(normalizedSavedMode)) return normalizedSavedMode;
  return 'polling';
}

export function resolveTelegramToken(environmentToken: unknown, savedToken: unknown): string {
  const environment = normalizeProviderCredential(environmentToken);
  return environment || normalizeProviderCredential(savedToken);
}

export function parseTelegramOwnerId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveTelegramOwnerId(environmentValue: unknown, savedValue: unknown): number | null {
  if (typeof environmentValue === 'string' && environmentValue.trim()) {
    const ownerId = parseTelegramOwnerId(environmentValue);
    if (ownerId === null) throw new Error('INVALID_TELEGRAM_OWNER_ID');
    return ownerId;
  }
  if (typeof environmentValue === 'number') {
    const ownerId = parseTelegramOwnerId(environmentValue);
    if (ownerId === null) throw new Error('INVALID_TELEGRAM_OWNER_ID');
    return ownerId;
  }
  return parseTelegramOwnerId(savedValue);
}

function cleanConfigurationString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

export function resolveTelegramWebhookUrl(environmentValue: unknown, savedValue: unknown): string {
  return cleanConfigurationString(environmentValue) || cleanConfigurationString(savedValue);
}

export function isValidTelegramWebhookUrl(value: unknown): boolean {
  const cleaned = cleanConfigurationString(value);
  if (!cleaned) return true;
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function shouldAttemptTelegramStart(
  hasToken: boolean,
  runtimeConfigurationChanged: boolean,
  isRunning: boolean,
): boolean {
  return hasToken && (runtimeConfigurationChanged || !isRunning);
}

export function normalizePairingCode(code: unknown): string {
  if (typeof code !== 'string') return '';
  return code.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function extractSuppliedPairingCode(text: unknown): string {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  const startParts = trimmed.split(/\s+/);
  if (startParts[0]?.toLowerCase().startsWith('/start')) {
    if (startParts[1]) {
      return startParts[1];
    }
    if (startParts[0].includes('=')) {
      return startParts[0].split('=')[1] || '';
    }
    return '';
  }
  // Allow direct paste of code like "LKN-VEDVL76E" or "LKN4DCYDGBC"
  if (trimmed.toUpperCase().startsWith('LKN-') || trimmed.toUpperCase().startsWith('LKN')) {
    return trimmed;
  }
  return '';
}

export function matchesPairingCode(suppliedInput: unknown, expectedCode: unknown): boolean {
  const extracted = extractSuppliedPairingCode(suppliedInput);
  const normalizedSupplied = normalizePairingCode(extracted);
  const normalizedExpected = normalizePairingCode(expectedCode);
  if (!normalizedSupplied || !normalizedExpected) return false;
  return normalizedSupplied === normalizedExpected;
}

