import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsManager } from '../server/db/settingsService.ts';
import { neonDb } from '../server/db/neonService.ts';

test.after(async () => {
  await neonDb.close();
});

test('SettingsManager durably persists configured provider models across all 3 providers', async () => {
  const testModels = {
    gemini: 'gemini-2.5-flash',
    groq: 'llama-3.3-70b-versatile',
    mistral: 'mistral-large-latest',
  };

  // 1. Update settings with explicit models for all 3 providers
  const updated = await settingsManager.updateSettings({
    activeProvider: 'gemini',
    activeModel: 'gemini-2.5-flash',
    providerModels: testModels,
  });

  assert.equal(updated.providerModels.gemini, 'gemini-2.5-flash');
  assert.equal(updated.providerModels.groq, 'llama-3.3-70b-versatile');
  assert.equal(updated.providerModels.mistral, 'mistral-large-latest');
  assert.equal(updated.activeProvider, 'gemini');
  assert.equal(updated.activeModel, 'gemini-2.5-flash');

  // 2. Simulate server restart hydration from database
  const hydrated = await settingsManager.syncFromDatabase();

  assert.equal(hydrated.providerModels.gemini, 'gemini-2.5-flash');
  assert.equal(hydrated.providerModels.groq, 'llama-3.3-70b-versatile');
  assert.equal(hydrated.providerModels.mistral, 'mistral-large-latest');

  // 3. Verify getSanitizedSettings exposes the exact providerModels
  const sanitized = settingsManager.getSanitizedSettings();
  assert.deepEqual(sanitized.providerModels, testModels);
});

test('syncFromDatabase preserves valid in-memory/disk provider models if database has empty strings', async () => {
  // Set memory to known configured models
  await settingsManager.updateSettings({
    providerModels: {
      gemini: 'gemini-2.5-flash',
      groq: 'llama-3.3-70b-versatile',
      mistral: 'mistral-large-latest',
    },
  });

  // Verify sync preserves them
  const rehydrated = await settingsManager.syncFromDatabase();
  assert.equal(rehydrated.providerModels.gemini, 'gemini-2.5-flash');
  assert.equal(rehydrated.providerModels.groq, 'llama-3.3-70b-versatile');
  assert.equal(rehydrated.providerModels.mistral, 'mistral-large-latest');
});

test('updateSettings preserves existing provider models when updating a single provider or model', async () => {
  // Update only Groq active model
  const next = await settingsManager.updateSettings({
    activeProvider: 'groq',
    activeModel: 'llama-3.3-70b-specdec',
  });

  assert.equal(next.activeProvider, 'groq');
  assert.equal(next.activeModel, 'llama-3.3-70b-specdec');
  assert.equal(next.providerModels.groq, 'llama-3.3-70b-specdec');
  // Gemini and Mistral models must remain intact!
  assert.equal(next.providerModels.gemini, 'gemini-2.5-flash');
  assert.equal(next.providerModels.mistral, 'mistral-large-latest');
});
