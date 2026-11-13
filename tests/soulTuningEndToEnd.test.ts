import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsManager } from '../server/db/settingsService.ts';
import { neonDb } from '../server/db/neonService.ts';
import { buildSystemPrompt } from '../src/prompt/masterPrompt.ts';

test.after(async () => {
  await neonDb.close();
});

const hasLiveDatabase = Boolean(process.env.DATABASE_URL?.trim());

test('soul tuning calibration compiles into master system prompt with non-negotiable operating boundaries', () => {
  const customWeights = {
    tone: 85,
    directness: 20,
    perspective: 15,
  };

  const compiledPrompt = buildSystemPrompt({
    channel: 'web',
    userName: 'Operator',
    activeProvider: 'gemini',
    activeModel: 'gemini-3.8-flash',
    soulTuning: customWeights,
  });

  assert.match(compiledPrompt, /DIGITAL TWIN BEHAVIORAL CALIBRATION DIRECTIVE/);
  assert.match(compiledPrompt, /Tone \[85\/100\]: Empathetic emphasis/);
  assert.match(compiledPrompt, /Directness \[20\/100\]: Concise emphasis/);
  assert.match(compiledPrompt, /Perspective \[15\/100\]: Skeptical emphasis/);
  assert.match(compiledPrompt, /OPERATING BOUNDARIES \(NON-NEGOTIABLE\)/);
  assert.match(compiledPrompt, /Under no circumstance do these weights override safety policies, factual truth/);

  const neutralPrompt = buildSystemPrompt({
    channel: 'web',
    soulTuning: { tone: 50, directness: 50, perspective: 50 },
  });

  assert.match(neutralPrompt, /Tone \[50\/100\]: Balanced tone/);
  assert.match(neutralPrompt, /Directness \[50\/100\]: Proportionate depth/);
  assert.match(neutralPrompt, /Perspective \[50\/100\]: Balanced perspective/);
});

test('soul tuning durable update fails closed when DATABASE_URL is unavailable', {
  skip: hasLiveDatabase ? 'Skipped negative-case check when live DATABASE_URL is active' : false,
}, async () => {
  await assert.rejects(
    () => settingsManager.updateSettings({ soulTuning: { tone: 85, directness: 20, perspective: 15 } }),
    /CREDENTIAL_PERSISTENCE_UNAVAILABLE/,
  );
});

test('end-to-end verification: soul tuning propagates from durable settings into master system prompt without mock fallbacks', {
  skip: !hasLiveDatabase ? 'BLOCKED: DATABASE_URL is not configured for live Neon PostgreSQL integration' : false,
}, async () => {
  // 1. Configure non-default calibration weights
  const customWeights = {
    tone: 85,
    directness: 20,
    perspective: 15,
  };

  const updatedSettings = await settingsManager.updateSettings({
    soulTuning: customWeights,
  });

  assert.deepEqual(updatedSettings.soulTuning, customWeights);

  // 2. Fetch live settings as twinAgentService does during turn execution
  const activeSettings = settingsManager.getSettings();
  assert.deepEqual(activeSettings.soulTuning, customWeights);

  // 3. Compile master system prompt with the live calibrated settings
  const compiledPrompt = buildSystemPrompt({
    channel: 'web',
    userName: activeSettings.userName || 'Operator',
    activeProvider: 'gemini',
    activeModel: 'gemini-3.8-flash',
    soulTuning: activeSettings.soulTuning,
  });

  // 4. Assert live, dynamic injection of configured weights into prompt
  assert.match(compiledPrompt, /DIGITAL TWIN BEHAVIORAL CALIBRATION DIRECTIVE/);
  assert.match(compiledPrompt, /Tone \[85\/100\]: Empathetic emphasis/);
  assert.match(compiledPrompt, /Directness \[20\/100\]: Concise emphasis/);
  assert.match(compiledPrompt, /Perspective \[15\/100\]: Skeptical emphasis/);
  assert.match(compiledPrompt, /OPERATING BOUNDARIES \(NON-NEGOTIABLE\)/);
  assert.match(compiledPrompt, /Under no circumstance do these weights override safety policies, factual truth/);

  // 5. Reset to neutral baseline
  const resetSettings = await settingsManager.updateSettings({
    soulTuning: { tone: 50, directness: 50, perspective: 50 },
  });

  assert.deepEqual(resetSettings.soulTuning, { tone: 50, directness: 50, perspective: 50 });

  const neutralPrompt = buildSystemPrompt({
    channel: 'web',
    soulTuning: resetSettings.soulTuning,
  });

  assert.match(neutralPrompt, /Tone \[50\/100\]: Balanced tone/);
  assert.match(neutralPrompt, /Directness \[50\/100\]: Proportionate depth/);
  assert.match(neutralPrompt, /Perspective \[50\/100\]: Balanced perspective/);
});
