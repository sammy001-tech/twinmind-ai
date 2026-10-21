import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsManager } from '../server/db/settingsService.ts';
import { neonDb } from '../server/db/neonService.ts';
import { buildSystemPrompt } from '../src/prompt/masterPrompt.ts';
import {
  THINKING_PRESETS,
  resolveActiveThinkingPreset,
  formatThinkingModeBadge,
} from '../src/utils/thinkingModes.ts';

test.after(async () => {
  await neonDb.close();
});

test('end-to-end thinking presets: dynamic resolution, database persistence, and system prompt calibration', async () => {
  // 1. Executive Briefing Preset
  const executivePreset = THINKING_PRESETS.find((p) => p.id === 'executive')!;
  assert.ok(executivePreset, 'Executive preset must exist');

  await settingsManager.updateSettings({ soulTuning: executivePreset.weights });
  const execSettings = settingsManager.getSettings();
  assert.deepEqual(execSettings.soulTuning, executivePreset.weights);

  const resolvedExec = resolveActiveThinkingPreset(execSettings.soulTuning);
  assert.equal(resolvedExec?.id, 'executive');
  const execBadge = formatThinkingModeBadge(execSettings.soulTuning);
  assert.equal(execBadge.icon, '🎯');
  assert.equal(execBadge.label, 'Executive');

  const execPrompt = buildSystemPrompt({
    channel: 'web',
    soulTuning: execSettings.soulTuning,
  });
  assert.match(execPrompt, /Tone \[20\/100\]: Analytical emphasis/);
  assert.match(execPrompt, /Directness \[15\/100\]: Concise emphasis/);
  assert.match(execPrompt, /Perspective \[50\/100\]: Balanced perspective/);

  // 2. Red Team / Devil's Advocate Preset
  const redTeamPreset = THINKING_PRESETS.find((p) => p.id === 'red_team')!;
  await settingsManager.updateSettings({ soulTuning: redTeamPreset.weights });
  const redSettings = settingsManager.getSettings();
  assert.deepEqual(redSettings.soulTuning, redTeamPreset.weights);

  const resolvedRed = resolveActiveThinkingPreset(redSettings.soulTuning);
  assert.equal(resolvedRed?.id, 'red_team');
  const redBadge = formatThinkingModeBadge(redSettings.soulTuning);
  assert.equal(redBadge.icon, '🛡️');
  assert.equal(redBadge.label, 'Red Team');

  const redPrompt = buildSystemPrompt({
    channel: 'web',
    soulTuning: redSettings.soulTuning,
  });
  assert.match(redPrompt, /Tone \[15\/100\]: Analytical emphasis/);
  assert.match(redPrompt, /Directness \[25\/100\]: Concise emphasis/);
  assert.match(redPrompt, /Perspective \[10\/100\]: Skeptical emphasis/);

  // 3. Visionary Brainstorm Preset
  const visionaryPreset = THINKING_PRESETS.find((p) => p.id === 'visionary')!;
  await settingsManager.updateSettings({ soulTuning: visionaryPreset.weights });
  const visSettings = settingsManager.getSettings();
  assert.deepEqual(visSettings.soulTuning, visionaryPreset.weights);

  const resolvedVis = resolveActiveThinkingPreset(visSettings.soulTuning);
  assert.equal(resolvedVis?.id, 'visionary');
  const visBadge = formatThinkingModeBadge(visSettings.soulTuning);
  assert.equal(visBadge.icon, '💡');
  assert.equal(visBadge.label, 'Visionary');

  const visPrompt = buildSystemPrompt({
    channel: 'web',
    soulTuning: visSettings.soulTuning,
  });
  assert.match(visPrompt, /Perspective \[90\/100\]: Visionary emphasis/);

  // 4. Reset to Neutral Thought Partner
  const neutralPreset = THINKING_PRESETS.find((p) => p.id === 'neutral')!;
  await settingsManager.updateSettings({ soulTuning: neutralPreset.weights });
  const neutralSettings = settingsManager.getSettings();
  assert.deepEqual(neutralSettings.soulTuning, neutralPreset.weights);

  const resolvedNeutral = resolveActiveThinkingPreset(neutralSettings.soulTuning);
  assert.equal(resolvedNeutral?.id, 'neutral');
  const neutralBadge = formatThinkingModeBadge(neutralSettings.soulTuning);
  assert.equal(neutralBadge.icon, '⚖️');
  assert.equal(neutralBadge.label, 'Neutral');
});
