import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGeminiCatalogueFailure, resolveConfiguredLiveModel } from '../server/services/modelCatalogService.ts';

test('rejects execution when live catalogue is unavailable', () => {
  assert.throws(
    () => resolveConfiguredLiveModel('gemini', 'a-saved-model', []),
    /LIVE_MODEL_CATALOG_UNAVAILABLE:gemini/
  );
});

test('requires explicit model configuration rather than selecting an implicit fallback', () => {
  assert.throws(
    () => resolveConfiguredLiveModel('groq', undefined, [{ id: 'listed-live-model', displayName: 'Listed live model' }]),
    /MODEL_CONFIGURATION_REQUIRED:groq/
  );
});

test('accepts only an exact identifier present in the current live catalogue', () => {
  const catalogue = [
    { id: 'currently-listed', displayName: 'Currently listed' },
    { id: 'another-listed-model', displayName: 'Another listed model' },
  ];
  assert.equal(resolveConfiguredLiveModel('mistral', 'currently-listed', catalogue), 'currently-listed');
  assert.throws(
    () => resolveConfiguredLiveModel('mistral', 'stale-configured-model', catalogue),
    /MODEL_NOT_CURRENTLY_AVAILABLE:mistral:stale-configured-model/
  );
});

test('classifies Gemini authentication and permission failures with safe codes only', () => {
  assert.deepEqual(
    classifyGeminiCatalogueFailure({ status: 401, message: 'rejected credential value MUST_NOT_LEAK' }),
    { errorCode: 'GEMINI_AUTHENTICATION_REJECTED', httpStatus: 401 },
  );
  assert.deepEqual(
    classifyGeminiCatalogueFailure({ status: 403 }),
    { errorCode: 'GEMINI_ACCESS_FORBIDDEN', httpStatus: 403 },
  );
});

test('classifies throttling, provider outages, and network failures explicitly', () => {
  assert.deepEqual(classifyGeminiCatalogueFailure({ status: 429 }), {
    errorCode: 'GEMINI_RATE_LIMITED',
    httpStatus: 429,
  });
  assert.deepEqual(classifyGeminiCatalogueFailure({ status: 503 }), {
    errorCode: 'GEMINI_PROVIDER_UNAVAILABLE',
    httpStatus: 503,
  });
  assert.deepEqual(classifyGeminiCatalogueFailure(new Error('fetch failed')), {
    errorCode: 'GEMINI_NETWORK_REQUEST_FAILED',
  });
});

test('does not return raw provider error content or secret-like text in diagnostics', () => {
  const result = classifyGeminiCatalogueFailure(new Error('provider echoed secret MUST_NOT_LEAK'));
  assert.equal(result.errorCode, 'GEMINI_CATALOG_REQUEST_FAILED');
  assert.equal(JSON.stringify(result).includes('MUST_NOT_LEAK'), false);
});
