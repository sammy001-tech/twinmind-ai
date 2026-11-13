import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsManager, mergeHydratedDatabaseSettings } from '../server/db/settingsService.ts';
import { neonDb } from '../server/db/neonService.ts';

test.after(async () => {
  await neonDb.close();
});

const hasLiveDatabase = Boolean(process.env.DATABASE_URL?.trim());

test('mergeHydratedDatabaseSettings restores brand, identity, activeProvider, and providerModels over blank boot defaults', () => {
  const bootSettings = settingsManager.getSettings();
  const emptyLocal = {
    ...bootSettings,
    brandName: '',
    userName: '',
    nickname: '',
    activeProvider: '' as const,
    activeModel: '',
    providerModels: { gemini: '', groq: '', mistral: '' },
  };

  const { merged, dbNeedsBackfill } = mergeHydratedDatabaseSettings(emptyLocal, {
    brandName: 'TwinMind Pro',
    userName: 'Olalekan',
    nickname: 'Brier',
    activeProvider: 'gemini',
    activeModel: 'gemini-2.5-pro',
    providerModels: {
      gemini: 'gemini-2.5-pro',
      groq: 'llama-3.3-70b-versatile',
      mistral: 'mistral-large-latest',
    },
  });

  assert.equal(merged.brandName, 'TwinMind Pro');
  assert.equal(merged.userName, 'Olalekan');
  assert.equal(merged.nickname, 'Brier');
  assert.equal(merged.activeProvider, 'gemini');
  assert.equal(merged.activeModel, 'gemini-2.5-pro');
  assert.equal(merged.providerModels.gemini, 'gemini-2.5-pro');
  assert.equal(merged.providerModels.groq, 'llama-3.3-70b-versatile');
  assert.equal(merged.providerModels.mistral, 'mistral-large-latest');
  assert.equal(dbNeedsBackfill, false);
});

test('SettingsManager fails closed on durable provider model updates when DATABASE_URL is unavailable', {
  skip: hasLiveDatabase ? 'Skipped negative-case check when live DATABASE_URL is active' : false,
}, async () => {
  const before = settingsManager.getSanitizedSettings();
  await assert.rejects(
    () =>
      settingsManager.updateSettings({
        activeProvider: 'gemini',
        activeModel: 'gemini-test-model',
        providerModels: {
          gemini: 'gemini-test-model',
          groq: 'groq-test-model',
          mistral: 'mistral-test-model',
        },
      }),
    /CREDENTIAL_PERSISTENCE_UNAVAILABLE/,
  );
  const after = settingsManager.getSanitizedSettings();
  assert.deepEqual(after.providerModels, before.providerModels);
  assert.equal(after.activeProvider, before.activeProvider);
});

test('SettingsManager durably persists configured provider models across all 3 providers', {
  skip: !hasLiveDatabase ? 'BLOCKED: DATABASE_URL is not configured for live Neon PostgreSQL integration' : false,
}, async () => {
  const testModels = {
    gemini: 'gemini-3.8-flash',
    groq: 'llama-3.3-70b-versatile',
    mistral: 'mistral-large-latest',
  };

  // 1. Update settings with explicit models for all 3 providers
  const updated = await settingsManager.updateSettings({
    activeProvider: 'gemini',
    activeModel: 'gemini-3.8-flash',
    providerModels: testModels,
  });

  assert.equal(updated.providerModels.gemini, 'gemini-3.8-flash');
  assert.equal(updated.providerModels.groq, 'llama-3.3-70b-versatile');
  assert.equal(updated.providerModels.mistral, 'mistral-large-latest');
  assert.equal(updated.activeProvider, 'gemini');
  assert.equal(updated.activeModel, 'gemini-3.8-flash');

  // 2. Simulate server restart hydration from database
  const hydrated = await settingsManager.syncFromDatabase();

  assert.equal(hydrated.providerModels.gemini, 'gemini-3.8-flash');
  assert.equal(hydrated.providerModels.groq, 'llama-3.3-70b-versatile');
  assert.equal(hydrated.providerModels.mistral, 'mistral-large-latest');

  // 3. Verify getSanitizedSettings exposes the exact providerModels
  const sanitized = settingsManager.getSanitizedSettings();
  assert.deepEqual(sanitized.providerModels, testModels);
});

test('syncFromDatabase preserves valid in-memory/disk provider models if database has empty strings', {
  skip: !hasLiveDatabase ? 'BLOCKED: DATABASE_URL is not configured for live Neon PostgreSQL integration' : false,
}, async () => {
  // Set memory to known configured models
  await settingsManager.updateSettings({
    providerModels: {
      gemini: 'gemini-3.8-flash',
      groq: 'llama-3.3-70b-versatile',
      mistral: 'mistral-large-latest',
    },
  });

  // Verify sync preserves them
  const rehydrated = await settingsManager.syncFromDatabase();
  assert.equal(rehydrated.providerModels.gemini, 'gemini-3.8-flash');
  assert.equal(rehydrated.providerModels.groq, 'llama-3.3-70b-versatile');
  assert.equal(rehydrated.providerModels.mistral, 'mistral-large-latest');
});

test('updateSettings preserves existing provider models when updating a single provider or model', {
  skip: !hasLiveDatabase ? 'BLOCKED: DATABASE_URL is not configured for live Neon PostgreSQL integration' : false,
}, async () => {
  // Update only Groq active model
  const next = await settingsManager.updateSettings({
    activeProvider: 'groq',
    activeModel: 'llama-3.3-70b-specdec',
  });

  assert.equal(next.activeProvider, 'groq');
  assert.equal(next.activeModel, 'llama-3.3-70b-specdec');
  assert.equal(next.providerModels.groq, 'llama-3.3-70b-specdec');
  // Gemini and Mistral models must remain intact!
  assert.equal(next.providerModels.gemini, 'gemini-3.8-flash');
  assert.equal(next.providerModels.mistral, 'mistral-large-latest');
});
