import path from 'node:path';

export interface ArtifactStorageDirectoryOptions {
  configuredPath?: string;
  nodeEnv?: string;
  cwd?: string;
}

/**
 * Production file generation must target an explicitly configured absolute path.
 * A local project directory is useful during development but is not assumed to
 * survive a managed-host restart or redeploy.
 */
export function resolveArtifactStorageDirectory(
  options: ArtifactStorageDirectoryOptions = {},
): string {
  const configuredPath = options.configuredPath === undefined
    ? process.env.ARTIFACTS_DIR
    : options.configuredPath;
  const nodeEnv = options.nodeEnv === undefined ? process.env.NODE_ENV : options.nodeEnv;
  const cwd = options.cwd || process.cwd();
  const trimmed = typeof configuredPath === 'string' ? configuredPath.trim() : '';

  if (nodeEnv === 'production' && !trimmed) {
    throw new Error('ARTIFACT_STORAGE_CONFIGURATION_MISSING: configure ARTIFACTS_DIR to a mounted persistent directory before generating files');
  }
  if (nodeEnv === 'production' && !path.isAbsolute(trimmed)) {
    throw new Error('ARTIFACT_STORAGE_PATH_MUST_BE_ABSOLUTE: production ARTIFACTS_DIR must be an absolute mounted path');
  }

  return path.resolve(cwd, trimmed || path.join(cwd, 'public', 'artifacts'));
}

/** Resolve the directory used by download routes, including local development. */
export function getArtifactStorageDirectory(): string {
  const configuredPath = process.env.ARTIFACTS_DIR?.trim();
  return path.resolve(configuredPath || path.join(process.cwd(), 'public', 'artifacts'));
}

/** Fail closed when production generation has no explicitly configured storage. */
export function getArtifactStorageDirectoryForGeneration(): string {
  return resolveArtifactStorageDirectory();
}
