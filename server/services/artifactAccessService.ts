import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const SIGNED_URL_TTL_SECONDS = 15 * 60;

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function getSecret(): string {
  const secret = process.env.APP_AUTH_SECRET || '';
  if (secret.length < 32) throw new Error('ARTIFACT_SIGNING_CONFIGURATION_MISSING');
  return secret;
}

function signature(fileName: string, expires: string): string {
  return createHmac('sha256', getSecret())
    .update(`artifact-download:\n${fileName}\n${expires}`)
    .digest('base64url');
}

export class ArtifactAccessService {
  public createSignedPath(fileName: string, now = Date.now()): string {
    const safeName = fileName.trim();
    if (!safeName || safeName !== safeName.split(/[\\/]/).pop() || safeName === '.' || safeName === '..') {
      throw new Error('INVALID_ARTIFACT_NAME');
    }

    const expires = String(Math.floor(now / 1000) + SIGNED_URL_TTL_SECONDS);
    const sig = signature(safeName, expires);
    return `/artifacts/${encodeURIComponent(safeName)}?expires=${expires}&signature=${encodeURIComponent(sig)}`;
  }

  public verifySignedRequest(fileName: string, expiresInput: unknown, signatureInput: unknown, now = Date.now()): boolean {
    if (typeof expiresInput !== 'string' || typeof signatureInput !== 'string') return false;
    if (!/^\d+$/.test(expiresInput)) return false;
    const expires = Number(expiresInput);
    const nowSeconds = Math.floor(now / 1000);
    if (!Number.isSafeInteger(expires) || expires <= nowSeconds || expires > nowSeconds + SIGNED_URL_TTL_SECONDS + 30) return false;

    const safeName = fileName.trim();
    if (!safeName || safeName !== safeName.split(/[\\/]/).pop() || safeName === '.' || safeName === '..') return false;

    try {
      return safeEqual(signatureInput, signature(safeName, expiresInput));
    } catch {
      return false;
    }
  }
}

export const artifactAccessService = new ArtifactAccessService();
