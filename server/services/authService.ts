import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

export const OWNER_SESSION_COOKIE = 'twinmind_owner_session';
export const OWNER_SESSION_TTL_SECONDS = 12 * 60 * 60;

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim();
    }
  }
  return null;
}

class OwnerAuthService {
  public isConfigured(): boolean {
    const password = process.env.APP_AUTH_PASSWORD || '';
    const secret = process.env.APP_AUTH_SECRET || '';
    return password.length >= 16 && secret.length >= 32;
  }

  public missingConfiguration(): string[] {
    const missing: string[] = [];
    if ((process.env.APP_AUTH_PASSWORD || '').length < 16) missing.push('APP_AUTH_PASSWORD (minimum 16 characters)');
    if ((process.env.APP_AUTH_SECRET || '').length < 32) missing.push('APP_AUTH_SECRET (minimum 32 characters)');
    return missing;
  }

  public verifyPassword(candidate: unknown): boolean {
    if (!this.isConfigured() || typeof candidate !== 'string') return false;
    return safeEqual(candidate, process.env.APP_AUTH_PASSWORD || '');
  }

  private signature(expiresAt: string): string {
    const secret = process.env.APP_AUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error('AUTH_CONFIGURATION_MISSING');
    return createHmac('sha256', secret).update(`owner-session:${expiresAt}`).digest('base64url');
  }

  public createSessionToken(now = Date.now()): string {
    if (!this.isConfigured()) throw new Error('AUTH_CONFIGURATION_MISSING');
    const expiresAt = String(Math.floor(now / 1000) + OWNER_SESSION_TTL_SECONDS);
    return `${expiresAt}.${this.signature(expiresAt)}`;
  }

  public isValidSessionToken(token: string | null | undefined, now = Date.now()): boolean {
    if (!this.isConfigured() || !token) return false;
    const separator = token.indexOf('.');
    if (separator <= 0) return false;

    const expiresAt = token.slice(0, separator);
    const suppliedSignature = token.slice(separator + 1);
    if (!/^\d+$/.test(expiresAt) || !suppliedSignature) return false;

    const expirySeconds = Number(expiresAt);
    const nowSeconds = Math.floor(now / 1000);
    if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= nowSeconds) return false;
    if (expirySeconds > nowSeconds + OWNER_SESSION_TTL_SECONDS + 60) return false;

    try {
      return safeEqual(suppliedSignature, this.signature(expiresAt));
    } catch {
      return false;
    }
  }

  public isAuthenticated(request: Request): boolean {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (this.isValidSessionToken(token)) return true;
    }
    return this.isValidSessionToken(readCookie(request, OWNER_SESSION_COOKIE));
  }

  public setSessionCookie(response: Response, token?: string): void {
    const sessionToken = token || this.createSessionToken();
    response.cookie(OWNER_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: OWNER_SESSION_TTL_SECONDS * 1000,
    });
  }

  public clearSessionCookie(response: Response): void {
    response.clearCookie(OWNER_SESSION_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
  }
}

export const ownerAuthService = new OwnerAuthService();
