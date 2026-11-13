import { apiFetch } from './apiFetch.ts';

export function safeArtifactPath(value: string): string | null {
  if (!/^\/artifacts\/[^/?#]+(?:\?[^#]*)?$/.test(value)) return null;
  return value;
}

export function isFreshSignedPath(value: string | null): boolean {
  if (!value) return false;
  const safe = safeArtifactPath(value);
  if (!safe) return false;
  const queryIndex = safe.indexOf('?');
  if (queryIndex < 0) return false;
  const params = new URLSearchParams(safe.slice(queryIndex + 1));
  const expires = Number(params.get('expires'));
  return (
    Boolean(params.get('signature')) &&
    Number.isSafeInteger(expires) &&
    expires * 1000 > Date.now() + 5000
  );
}

export async function resolveSignedArtifactUrl(
  fileName: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('The stored artifact identifier is invalid.');
  }

  const response = await apiFetch('/api/artifacts/' + encodeURIComponent(fileName) + '/access', {
    method: 'GET',
    cache: 'no-store',
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  const data =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;

  if (!response.ok || data?.success !== true || typeof data.url !== 'string') {
    const serverError =
      typeof data?.error === 'string' && data.error.trim()
        ? data.error
        : data?.code === 'ARTIFACT_NOT_FOUND'
          ? 'This file is not present in the database-backed store. Regenerate it if it predates the storage rollout.'
          : 'The secure link service returned HTTP ' + response.status + '.';
    throw new Error(serverError);
  }

  const resolvedUrl = safeArtifactPath(data.url);
  if (!resolvedUrl || !isFreshSignedPath(resolvedUrl)) {
    throw new Error('The server did not return a valid, unexpired artifact link.');
  }

  return resolvedUrl;
}

export function canUseNativeFileShare(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    typeof File !== 'undefined'
  );
}

export interface ArtifactTransferResult {
  ok: boolean;
  method?: 'share' | 'blob-download' | 'external-link';
  cancelled?: boolean;
  error?: string;
}

export async function downloadOrShareArtifact(options: {
  url: string;
  fileName: string;
  preferShare?: boolean;
}): Promise<ArtifactTransferResult> {
  const { url, fileName, preferShare = false } = options;

  try {
    const response = await apiFetch(url, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status}.`);
    }

    const blob = await response.blob();
    const contentType = blob.type || 'application/octet-stream';

    if (preferShare && canUseNativeFileShare()) {
      const file = new File([blob], fileName, { type: contentType });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: fileName,
          });
          return { ok: true, method: 'share' };
        } catch (shareErr: unknown) {
          if (
            shareErr &&
            typeof shareErr === 'object' &&
            'name' in shareErr &&
            (shareErr as { name?: string }).name === 'AbortError'
          ) {
            return { ok: false, cancelled: true, error: 'Share cancelled.' };
          }
          // Fall through to Blob download if Share Sheet failed for any reason
        }
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return { ok: true, method: 'blob-download' };
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
    }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not transfer artifact file.',
    };
  }
}
