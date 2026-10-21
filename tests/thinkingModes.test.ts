import assert from 'node:assert/strict';
import test from 'node:test';
import {
  THINKING_PRESETS,
  resolveActiveThinkingPreset,
  formatThinkingModeBadge,
} from '../src/utils/thinkingModes.ts';
import { validateSoulTuningInput } from '../src/prompt/masterPrompt.ts';

test('all thinking presets conform to valid 0-100 integer ranges under validateSoulTuningInput', () => {
  for (const preset of THINKING_PRESETS) {
    const validation = validateSoulTuningInput(preset.weights);
    assert.equal(validation.valid, true, `Preset ${preset.id} must be strictly valid`);
    assert.deepEqual(validation.config, preset.weights);
  }
});

test('resolveActiveThinkingPreset correctly identifies each preset', () => {
  // Neutral
  const neutral = resolveActiveThinkingPreset({ tone: 50, directness: 50, perspective: 50 });
  assert.equal(neutral?.id, 'neutral');

  // Executive
  const executive = resolveActiveThinkingPreset({ tone: 20, directness: 15, perspective: 50 });
  assert.equal(executive?.id, 'executive');

  // Red Team
  const redTeam = resolveActiveThinkingPreset({ tone: 15, directness: 25, perspective: 10 });
  assert.equal(redTeam?.id, 'red_team');

  // Visionary
  const visionary = resolveActiveThinkingPreset({ tone: 70, directness: 70, perspective: 90 });
  assert.equal(visionary?.id, 'visionary');

  // Custom calibration
  const custom = resolveActiveThinkingPreset({ tone: 35, directness: 80, perspective: 45 });
  assert.equal(custom, null);

  // Missing or null defaults to neutral
  const fromNull = resolveActiveThinkingPreset(null);
  assert.equal(fromNull?.id, 'neutral');
});

test('formatThinkingModeBadge returns clear, scannable labels and icons', () => {
  // Preset badge
  const execBadge = formatThinkingModeBadge({ tone: 20, directness: 15, perspective: 50 });
  assert.equal(execBadge.icon, '🎯');
  assert.equal(execBadge.label, 'Executive');
  assert.equal(execBadge.isPreset, true);
  assert.ok(execBadge.effect.includes('bullet points'));
  assert.equal(execBadge.colors.dot, 'bg-sky-500');

  // Custom badge
  const customBadge = formatThinkingModeBadge({ tone: 85, directness: 20, perspective: 75 });
  assert.equal(customBadge.icon, '🎛️');
  assert.equal(customBadge.label, 'Custom (85/20/75)');
  assert.equal(customBadge.isPreset, false);
  assert.ok(customBadge.effect.includes('Tone 85/100'));
  assert.equal(customBadge.colors.dot, 'bg-purple-500');
});
