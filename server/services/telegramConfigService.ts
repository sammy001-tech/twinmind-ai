import { normalizeProviderCredential } from './providerCredentialService.ts';

export type TelegramMode = 'polling' | 'webhook';

export function isTelegramMode(value: unknown): value is TelegramMode {
  return value === 'polling' || value === 'webhook';
}

export function resolveTelegramMode(environmentMode: unknown, savedMode: unknown): TelegramMode {
  if (environmentMode !== undefined && environmentMode !== null && String(environmentMode).trim()) {
    if (isTelegramMode(environmentMode)) return environmentMode;
    throw new Error('INVALID_TELEGRAM_MODE');
  }
  if (isTelegramMode(savedMode)) return savedMode;
  return 'polling';
}

export function resolveTelegramToken(environmentToken: unknown, savedToken: unknown): string {
  const environment = normalizeProviderCredential(environmentToken);
  return environment || normalizeProviderCredential(savedToken);
}

export function parseTelegramOwnerId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isValidTelegramWebhookUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return true;
  try {
    const parsed = new URL(value.trim());
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
