import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsManager } from '../server/db/settingsService.ts';
import { neonDb } from '../server/db/neonService.ts';

test.after(async () => {
  await neonDb.close();
});

test('settingsManager rejects invalid soul tuning inputs without altering state', async () => {
  const original = settingsManager.getSettings().soulTuning || { tone: 50, directness: 50, perspective: 50 };

  // Decimal rejection
  await assert.rejects(
    async () => {
      await settingsManager.updateSettings({
        soulTuning: { tone: 42.5 } as any,
      });
    },
    /SOUL_TUNING_INVALID_VALUE/
  );

  // String rejection
  await assert.rejects(
    async () => {
      await settingsManager.updateSettings({
        soulTuning: { directness: 'fast' } as any,
      });
    },
    /SOUL_TUNING_INVALID_VALUE/
  );

  // State remains intact
  const afterFailed = settingsManager.getSettings().soulTuning;
  assert.equal(afterFailed?.tone, original.tone);
  assert.equal(afterFailed?.directness, original.directness);
  assert.equal(afterFailed?.perspective, original.perspective);
});
