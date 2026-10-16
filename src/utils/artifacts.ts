import type { GeneratedArtifact } from '../types/index.ts';

const allowedTypes = new Set(['pdf', 'xlsx', 'excel', 'csv', 'md', 'markdown']);

export function normalizeGeneratedArtifacts(value: unknown): GeneratedArtifact[] {
  if (!Array.isArray(value)) return [];

  const artifacts: GeneratedArtifact[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) continue;
    if (typeof candidate.url !== 'string' || !candidate.url.trim()) continue;
    if (typeof candidate.type !== 'string' || !allowedTypes.has(candidate.type.toLowerCase())) continue;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(candidate.url, 'https://twinmind.invalid');
    } catch {
      continue;
    }
    if (parsedUrl.origin !== 'https://twinmind.invalid' || !parsedUrl.pathname.startsWith('/artifacts/')) continue;

    const encodedFileName = parsedUrl.pathname.slice('/artifacts/'.length);
    let fileName: string;
    try {
      fileName = decodeURIComponent(encodedFileName);
    } catch {
      continue;
    }
    if (
      !fileName ||
      fileName === '.' ||
      fileName === '..' ||
      fileName.includes('/') ||
      fileName.includes('\\') ||
      fileName.includes('\0')
    ) continue;

    const key = `${fileName}\n${candidate.name.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const artifact: GeneratedArtifact = {
      name: candidate.name.trim(),
      url: `${parsedUrl.pathname}${parsedUrl.search}`,
      type: candidate.type.toLowerCase(),
    };

    if (typeof candidate.mimeType === 'string' && candidate.mimeType.trim()) {
      artifact.mimeType = candidate.mimeType.trim();
    }
    if (typeof candidate.sizeBytes === 'number' && Number.isSafeInteger(candidate.sizeBytes) && candidate.sizeBytes > 0) {
      artifact.sizeBytes = candidate.sizeBytes;
    }
    if (typeof candidate.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(candidate.sha256)) {
      artifact.sha256 = candidate.sha256.toLowerCase();
    }
    if (typeof candidate.generatedAt === 'string' && !Number.isNaN(Date.parse(candidate.generatedAt))) {
      artifact.generatedAt = new Date(candidate.generatedAt).toISOString();
    }
    if (candidate.storageScope === 'configured-directory' || candidate.storageScope === 'instance-local') {
      artifact.storageScope = candidate.storageScope;
    }
    artifacts.push(artifact);
  }

  return artifacts;
}

/** Remove a duplicated textual download line only when it points to a real artifact attached to the message. */
export function removeDuplicateArtifactDownloadLines(
  content: string,
  artifacts: readonly GeneratedArtifact[] | undefined,
): string {
  if (!content || !artifacts?.length) return content;

  const artifactReferences = artifacts.map((artifact) => {
    try {
      const url = new URL(artifact.url, 'https://twinmind.invalid');
      return {
        path: url.pathname,
        name: decodeURIComponent(url.pathname.split('/').pop() || ''),
      };
    } catch {
      return { path: '', name: '' };
    }
  }).filter((reference) => reference.path && reference.name);

  if (!artifactReferences.length) return content;

  return content
    .split(/\r?\n/)
    .filter((line) => {
      const referencesArtifact = artifactReferences.some(({ path, name }) =>
        line.includes(path) || line.includes(encodeURI(path)) || line.includes(name),
      );
      const isDownloadLine = /\b(download|downloadable|click here|file link|attachment link)\b/i.test(line);
      const isMarkdownLinkLine = /\]\s*\(/.test(line);
      return !(referencesArtifact && (isDownloadLine || isMarkdownLinkLine));
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatArtifactSize(sizeBytes: number | undefined): string {
  if (sizeBytes == null || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return 'Size unavailable';
  }
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KiB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MiB`;
}
