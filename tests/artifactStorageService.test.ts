import assert from 'node:assert/strict';
import test from 'node:test';
import { getArtifactStorageStatus, resolveArtifactStorageDirectory } from '../server/services/artifactStorageService.ts';

test('production storage is unavailable without ARTIFACTS_DIR and reports instance-local risk', () => {
  const status = getArtifactStorageStatus({ configuredPath: '', nodeEnv: 'production', cwd: '/app' });
  assert.equal(status.mode, 'instance-local');
  assert.equal(status.configured, false);
  assert.equal(status.canGenerate, false);
  assert.match(status.warning, /may disappear/);
  assert.match(status.warning, /persistent mounted volume/);
  assert.throws(
    () => resolveArtifactStorageDirectory({ configuredPath: '', nodeEnv: 'production', cwd: '/app' }),
    /ARTIFACT_STORAGE_CONFIGURATION_MISSING/,
  );
});

test('a relative ARTIFACTS_DIR is explicitly misconfigured and cannot authorize generation', () => {
  const status = getArtifactStorageStatus({ configuredPath: 'artifacts', nodeEnv: 'production', cwd: '/app' });
  assert.equal(status.mode, 'misconfigured');
  assert.equal(status.configured, true);
  assert.equal(status.canGenerate, false);
  assert.match(status.warning, /absolute path/);
  assert.throws(
    () => resolveArtifactStorageDirectory({ configuredPath: 'artifacts', nodeEnv: 'production', cwd: '/app' }),
    /ARTIFACT_STORAGE_PATH_MUST_BE_ABSOLUTE/,
  );
});

test('an absolute configured path is disclosed without claiming the host mount is verified', () => {
  const status = getArtifactStorageStatus({ configuredPath: '/var/data/artifacts', nodeEnv: 'production', cwd: '/app' });
  assert.equal(status.mode, 'configured-path');
  assert.equal(status.configured, true);
  assert.equal(status.canGenerate, true);
  assert.match(status.warning, /cannot verify that the host mounted a persistent volume/);
  assert.equal(
    resolveArtifactStorageDirectory({ configuredPath: '/var/data/artifacts', nodeEnv: 'production', cwd: '/app' }),
    '/var/data/artifacts',
  );
});

test('development can use instance-local storage but the status still warns about durability', () => {
  const status = getArtifactStorageStatus({ configuredPath: '', nodeEnv: 'development', cwd: '/app' });
  assert.equal(status.mode, 'instance-local');
  assert.equal(status.canGenerate, true);
  assert.match(status.warning, /may disappear/);
  assert.equal(
    resolveArtifactStorageDirectory({ configuredPath: '', nodeEnv: 'development', cwd: '/app' }),
    '/app/public/artifacts',
  );
});
