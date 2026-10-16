/**
 * Environment credentials are authoritative; saved Settings values are the fallback.
 * Request-supplied values are only a final backwards-compatible fallback.
 */
export type ProviderCredentialSource = 'environment' | 'settings' | 'request' | 'none';
export interface ProviderCredentialResolution { key: string; source: ProviderCredentialSource; }

export function normalizeProviderCredential(value: unknown): string {
  if (typeof value !== 'string') return '';
  const key = value.trim().replace(/^["']|["']$/g, '');
  if (!key || key.includes('...') || key === '********') return '';
  return key;
}

export function resolveProviderCredential(environmentKey: unknown, settingsKey: unknown, requestKey?: unknown): ProviderCredentialResolution {
  const env = normalizeProviderCredential(environmentKey);
  if (env) return { key: env, source: 'environment' };
  const setting = normalizeProviderCredential(settingsKey);
  if (setting) return { key: setting, source: 'settings' };
  const request = normalizeProviderCredential(requestKey);
  if (request) return { key: request, source: 'request' };
  return { key: '', source: 'none' };
}

export type OriginRejectionCode = 'ORIGIN_REQUIRED' | 'INVALID_ORIGIN' | 'INVALID_PUBLIC_ORIGIN_CONFIGURATION';
export type SameOriginDecision = { allowed: true } | { allowed: false; code: OriginRejectionCode };

function normalizedOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function evaluateSameOriginRequest(input: {
  origin?: string | null; host?: string | null; protocol?: string | null; publicOrigin?: string | null;
}): SameOriginDecision {
  if (!input.origin?.trim() || !input.host?.trim()) return { allowed: false, code: 'ORIGIN_REQUIRED' };
  const origin = normalizedOrigin(input.origin);
  if (!origin) return { allowed: false, code: 'INVALID_ORIGIN' };
  let expected: string | null;
  if (input.publicOrigin?.trim()) {
    expected = normalizedOrigin(input.publicOrigin);
    if (!expected) return { allowed: false, code: 'INVALID_PUBLIC_ORIGIN_CONFIGURATION' };
  } else {
    const protocol = input.protocol?.trim().toLowerCase();
    if (protocol !== 'http' && protocol !== 'https') return { allowed: false, code: 'INVALID_ORIGIN' };
    expected = normalizedOrigin(protocol + '://' + input.host.trim());
  }
  return origin === expected ? { allowed: true } : { allowed: false, code: 'INVALID_ORIGIN' };
}
