import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { getArtifactStorageStatus, validateStoredArtifact } from '../server/services/artifactStorageService.ts';

test('database-backed artifact storage is unavailable when DATABASE_URL is not configured', () => {
  const status = getArtifactStorageStatus({ configured: false, connected: false, schemaReady: false });
  assert.equal(status.mode, 'unavailable');
  assert.equal(status.configured, false);
  assert.equal(status.canGenerate, false);
  assert.match(status.warning, /DATABASE_URL/);
});

test('database-backed artifact storage requires a live database connection', () => {
  const status = getArtifactStorageStatus({ configured: true, connected: false, schemaReady: false });
  assert.equal(status.mode, 'unavailable');
  assert.equal(status.configured, true);
  assert.equal(status.canGenerate, false);
  assert.match(status.warning, /not connected/);
});

test('database-backed artifact storage requires the generated_artifacts table', () => {
  const status = getArtifactStorageStatus({ configured: true, connected: true, schemaReady: false });
  assert.equal(status.mode, 'unavailable');
  assert.equal(status.canGenerate, false);
  assert.match(status.warning, /generated_artifacts table/);
});

test('ready database storage does not require ARTIFACTS_DIR or a Render disk', () => {
  const status = getArtifactStorageStatus({ configured: true, connected: true, schemaReady: true });
  assert.equal(status.mode, 'database');
  assert.equal(status.configured, true);
  assert.equal(status.canGenerate, true);
  assert.match(status.warning, /Neon PostgreSQL/);
  assert.match(status.warning, /does not depend on Render local storage or ARTIFACTS_DIR/);
});

test('accepts database bytes only when byte length and SHA-256 match persisted metadata', () => {
  const content = Buffer.from('artifact bytes persisted in PostgreSQL');
  const hash = createHash('sha256').update(content).digest('hex');
  assert.deepEqual(validateStoredArtifact(content, content.length, hash), content);
});

test('rejects truncated or changed database artifact content', () => {
  const content = Buffer.from('original artifact bytes');
  const hash = createHash('sha256').update(content).digest('hex');
  assert.throws(() => validateStoredArtifact(content, content.length + 1, hash), /ARTIFACT_INTEGRITY_CHECK_FAILED/);
  assert.throws(() => validateStoredArtifact(Buffer.from('modified artifact bytes'), content.length, hash), /ARTIFACT_INTEGRITY_CHECK_FAILED/);
  assert.throws(() => validateStoredArtifact(content, content.length, 'invalid-hash'), /ARTIFACT_INTEGRITY_CHECK_FAILED/);
});
