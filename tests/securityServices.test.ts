import assert from 'node:assert/strict';
import test from 'node:test';

import { ownerAuthService, OWNER_SESSION_TTL_SECONDS } from '../server/services/authService.ts';
import { artifactAccessService } from '../server/services/artifactAccessService.ts';
import { resolveConfiguredLiveModel } from '../server/services/modelCatalogService.ts';

function withEnvironment<T>(values: Record<string, string>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('owner auth fails closed when required session configuration is missing', () => {
  withEnvironment({ APP_AUTH_PASSWORD: '', APP_AUTH_SECRET: '' }, () => {
    assert.equal(ownerAuthService.isConfigured(), false);
    assert.equal(ownerAuthService.isValidSessionToken('anything'), false);
    assert.throws(() => ownerAuthService.createSessionToken(), /AUTH_CONFIGURATION_MISSING/);
  });
});

test('owner session tokens are signed, time-bound, and reject tampering', () => {
  withEnvironment({
    APP_AUTH_PASSWORD: 'test-password-with-enough-length',
    APP_AUTH_SECRET: 'a-test-session-secret-with-more-than-thirty-two-characters',
  }, () => {
    const issuedAt = 1_800_000_000_000;
    const token = ownerAuthService.createSessionToken(issuedAt);

    assert.equal(ownerAuthService.isValidSessionToken(token, issuedAt + 60_000), true);
    assert.equal(ownerAuthService.isValidSessionToken(token + 'x', issuedAt + 60_000), false);
    assert.equal(ownerAuthService.isValidSessionToken(token, issuedAt + (OWNER_SESSION_TTL_SECONDS + 1) * 1000), false);
  });
});

test('signed artifact links are limited to their filename and expiry', () => {
  withEnvironment({
    APP_AUTH_SECRET: 'a-test-artifact-secret-with-more-than-thirty-two-characters',
  }, () => {
    const issuedAt = 1_800_000_000_000;
    const signedPath = artifactAccessService.createSignedPath('meeting-notes.pdf', issuedAt);
    const signedUrl = new URL(signedPath, 'https://owner.example');
    const expires = signedUrl.searchParams.get('expires') || '';
    const signature = signedUrl.searchParams.get('signature') || '';

    assert.equal(
      artifactAccessService.verifySignedRequest('meeting-notes.pdf', expires, signature, issuedAt + 60_000),
      true,
    );
    assert.equal(
      artifactAccessService.verifySignedRequest('another-file.pdf', expires, signature, issuedAt + 60_000),
      false,
    );
    assert.equal(
      artifactAccessService.verifySignedRequest('meeting-notes.pdf', expires, signature, issuedAt + 16 * 60_000),
      false,
    );
    assert.throws(() => artifactAccessService.createSignedPath('../private.txt', issuedAt), /INVALID_ARTIFACT_NAME/);
  });
});

test('live model resolver rejects absent catalogue and stale configured identifiers', () => {
  assert.throws(
    () => resolveConfiguredLiveModel('gemini', 'saved-model', []),
    /LIVE_MODEL_CATALOG_UNAVAILABLE:gemini/,
  );
  assert.throws(
    () => resolveConfiguredLiveModel('groq', undefined, [{ id: 'live-model', displayName: 'Live model' }]),
    /MODEL_CONFIGURATION_REQUIRED:groq/,
  );
  assert.throws(
    () => resolveConfiguredLiveModel('mistral', 'retired-model', [{ id: 'current-model', displayName: 'Current model' }]),
    /MODEL_NOT_CURRENTLY_AVAILABLE:mistral:retired-model/,
  );
});
