import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConfiguredLiveModel } from '../server/services/modelCatalogService.ts';

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
