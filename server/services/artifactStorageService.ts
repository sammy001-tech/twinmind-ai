import path from 'node:path';

export interface ArtifactStorageDirectoryOptions {
  configuredPath?: string;
  nodeEnv?: string;
  cwd?: string;
}

export type ArtifactStorageMode = 'instance-local' | 'configured-path' | 'misconfigured';

export interface ArtifactStorageStatus {
  mode: ArtifactStorageMode;
  configured: boolean;
  canGenerate: boolean;
  warning: string;
}

function getOptions(options: ArtifactStorageDirectoryOptions = {}) {
  const configuredPath = options.configuredPath === undefined
    ? process.env.ARTIFACTS_DIR
    : options.configuredPath;
  const nodeEnv = options.nodeEnv === undefined ? process.env.NODE_ENV : options.nodeEnv;
  const cwd = options.cwd || process.cwd();
  const directory = typeof configuredPath === 'string' ? configuredPath.trim() : '';
  return { directory, nodeEnv, cwd };
}

/**
 * A configured directory is not automatically durable: the host must mount a
 * persistent volume at that exact absolute path. Production refuses to generate
 * artifacts when that configuration is absent or relative.
 */
export function resolveArtifactStorageDirectory(
  options: ArtifactStorageDirectoryOptions = {},
): string {
  const { directory, nodeEnv, cwd } = getOptions(options);

  if (nodeEnv === 'production' && !directory) {
    throw new Error(
      'ARTIFACT_STORAGE_CONFIGURATION_MISSING: configure ARTIFACTS_DIR to an absolute path on a persistent mounted volume before generating files',
    );
  }
  if (directory && !path.isAbsolute(directory)) {
    throw new Error(
      'ARTIFACT_STORAGE_PATH_MUST_BE_ABSOLUTE: ARTIFACTS_DIR must be an absolute path',
    );
  }

  return path.resolve(cwd, directory || path.join(cwd, 'public', 'artifacts'));
}

/** Resolve the same storage directory for download/access routes and generation. */
export function getArtifactStorageDirectory(): string {
  const configuredPath = process.env.ARTIFACTS_DIR?.trim();
  // Keep the server bootable so the UI can report a misconfiguration. Generation
  // is separately fail-closed by getArtifactStorageDirectoryForGeneration().
  if (!configuredPath || !path.isAbsolute(configuredPath)) {
    return path.resolve(process.cwd(), 'public', 'artifacts');
  }
  return path.resolve(configuredPath);
}

/** Strict production generation gate. */
export function getArtifactStorageDirectoryForGeneration(): string {
  return resolveArtifactStorageDirectory();
}

/**
 * Safe, secret-free status for the authenticated UI. The application can confirm
 * that an absolute path is configured, but cannot independently prove that the
 * hosting provider actually mounted durable storage there.
 */
export function getArtifactStorageStatus(
  options: ArtifactStorageDirectoryOptions = {},
): ArtifactStorageStatus {
  const { directory, nodeEnv } = getOptions(options);
  const configured = Boolean(directory);

  if (directory && !path.isAbsolute(directory)) {
    return {
      mode: 'misconfigured',
      configured: true,
      canGenerate: false,
      warning: 'ARTIFACTS_DIR must be an absolute path. Artifact generation is blocked until it is corrected.',
    };
  }

  if (nodeEnv === 'production' && !configured) {
    return {
      mode: 'instance-local',
      configured: false,
      canGenerate: false,
      warning: 'Generated files would use instance-local storage and may disappear after a restart or redeploy. Configure ARTIFACTS_DIR to an absolute path on a persistent mounted volume. Production artifact generation is disabled until it is configured.',
    };
  }

  if (!configured) {
    return {
      mode: 'instance-local',
      configured: false,
      canGenerate: true,
      warning: 'Generated files use instance-local storage and may disappear after a restart or redeploy. Configure ARTIFACTS_DIR to an absolute path on a persistent mounted volume if files need to survive.',
    };
  }

  return {
    mode: 'configured-path',
    configured: true,
    canGenerate: true,
    warning: 'ARTIFACTS_DIR is configured, but the application cannot verify that the host mounted a persistent volume at this path. Confirm the path matches the hosting disk mount.',
  };
}
