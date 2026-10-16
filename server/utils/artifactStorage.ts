import path from 'node:path';

export type ArtifactStorageScope = 'configured-directory' | 'instance-local';

export function getArtifactStorageDirectory(): string {
  const configuredDirectory = process.env.ARTIFACTS_DIR?.trim();
  if (configuredDirectory) {
    if (!path.isAbsolute(configuredDirectory)) {
      throw new Error('ARTIFACT_STORAGE_PATH_MUST_BE_ABSOLUTE');
    }
    return path.resolve(configuredDirectory);
  }

  return path.resolve(process.cwd(), 'public', 'artifacts');
}

/**
 * This indicates whether an explicit directory was configured. A configured
 * path is not claimed to be durable unless the hosting platform mounts storage there.
 */
export function getArtifactStorageScope(): ArtifactStorageScope {
  return process.env.ARTIFACTS_DIR?.trim() ? 'configured-directory' : 'instance-local';
}

export function resolveArtifactFilePath(fileName: string): string {
  const name = fileName.trim();
  if (
    !name ||
    name !== path.basename(name) ||
    name === '.' ||
    name === '..' ||
    name.includes('\\') ||
    name.includes('/') ||
    name.includes('\0')
  ) {
    throw new Error('INVALID_ARTIFACT_NAME');
  }

  const root = getArtifactStorageDirectory();
  const resolved = path.resolve(root, name);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('INVALID_ARTIFACT_PATH');
  }
  return resolved;
}
