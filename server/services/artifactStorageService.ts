import { createHash } from 'node:crypto';

export type ArtifactStorageMode = 'database' | 'unavailable';

export interface ArtifactStorageStatus {
  mode: ArtifactStorageMode;
  configured: boolean;
  canGenerate: boolean;
  warning: string;
}

export interface ArtifactStorageReadiness {
  configured: boolean;
  connected: boolean;
  schemaReady: boolean;
}

/** A configured URL is insufficient: connection and artifact table readiness are required. */
export function getArtifactStorageStatus(
  readiness: ArtifactStorageReadiness = {
    configured: Boolean(process.env.DATABASE_URL?.trim()),
    connected: false,
    schemaReady: false,
  },
): ArtifactStorageStatus {
  if (!readiness.configured) {
    return {
      mode: 'unavailable',
      configured: false,
      canGenerate: false,
      warning: 'Neon PostgreSQL artifact storage is not configured. Set DATABASE_URL on the server before generating or downloading artifacts.',
    };
  }
  if (!readiness.connected) {
    return {
      mode: 'unavailable',
      configured: true,
      canGenerate: false,
      warning: 'Neon PostgreSQL is not connected. Artifact generation and downloads are disabled until database connectivity is restored.',
    };
  }
  if (!readiness.schemaReady) {
    return {
      mode: 'unavailable',
      configured: true,
      canGenerate: false,
      warning: 'The generated_artifacts table is not ready in Neon PostgreSQL. Artifact generation and downloads remain disabled until database schema initialization succeeds.',
    };
  }
  return {
    mode: 'database',
    configured: true,
    canGenerate: true,
    warning: 'Generated file contents and integrity metadata are stored in Neon PostgreSQL. Artifact persistence does not depend on Render local storage or ARTIFACTS_DIR.',
  };
}

/** Validate file bytes after reading them back from durable storage. */
export function validateStoredArtifact(
  content: Uint8Array,
  expectedSizeBytes: number,
  expectedSha256: string,
): Buffer {
  const buffer = Buffer.from(content);
  if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes <= 0 || buffer.length !== expectedSizeBytes) {
    throw new Error('ARTIFACT_INTEGRITY_CHECK_FAILED');
  }
  const normalizedHash = typeof expectedSha256 === 'string' ? expectedSha256.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) {
    throw new Error('ARTIFACT_INTEGRITY_CHECK_FAILED');
  }
  const actualHash = createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== normalizedHash) {
    throw new Error('ARTIFACT_INTEGRITY_CHECK_FAILED');
  }
  return buffer;
}
