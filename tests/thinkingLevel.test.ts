import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidThinkingLevel,
  resolveThinkingLevel,
  getThinkingLevelOption,
  THINKING_LEVEL_OPTIONS,
  DEFAULT_THINKING_LEVEL,
} from '../src/utils/thinkingLevel.ts';
import {
  compileThinkingLevelDirective,
  buildSystemPrompt,
} from '../src/prompt/masterPrompt.ts';

test('isValidThinkingLevel validates strictly without hardcoded assumptions', () => {
  assert.equal(isValidThinkingLevel('low'), true);
  assert.equal(isValidThinkingLevel('medium'), true);
  assert.equal(isValidThinkingLevel('high'), true);

  assert.equal(isValidThinkingLevel('fast'), false);
  assert.equal(isValidThinkingLevel('deep'), false);
  assert.equal(isValidThinkingLevel('gemini-3.8-flash'), false);
  assert.equal(isValidThinkingLevel(''), false);
  assert.equal(isValidThinkingLevel(null), false);
  assert.equal(isValidThinkingLevel(undefined), false);
  assert.equal(isValidThinkingLevel(123), false);
  assert.equal(isValidThinkingLevel({}), false);
});

test('resolveThinkingLevel safely resolves to default without failing or guessing', () => {
  assert.equal(resolveThinkingLevel('low'), 'low');
  assert.equal(resolveThinkingLevel('medium'), 'medium');
  assert.equal(resolveThinkingLevel('high'), 'high');

  assert.equal(resolveThinkingLevel('unknown_level'), DEFAULT_THINKING_LEVEL);
  assert.equal(resolveThinkingLevel(undefined), DEFAULT_THINKING_LEVEL);
  assert.equal(resolveThinkingLevel(null), DEFAULT_THINKING_LEVEL);
});

test('THINKING_LEVEL_OPTIONS match screenshot copy 1:1', () => {
  assert.equal(THINKING_LEVEL_OPTIONS.length, 3);

  const low = getThinkingLevelOption('low');
  assert.equal(low.label, 'Low');
  assert.equal(low.description, 'Fast and efficient');

  const medium = getThinkingLevelOption('medium');
  assert.equal(medium.label, 'Medium');
  assert.equal(medium.description, 'Balanced depth');

  const high = getThinkingLevelOption('high');
  assert.equal(high.label, 'High');
  assert.equal(high.description, 'Extra thorough');
});

test('compileThinkingLevelDirective produces structured directives for all 3 levels', () => {
  const lowDirective = compileThinkingLevelDirective('low');
  assert.match(lowDirective, /THINKING LEVEL: LOW - FAST AND EFFICIENT/);
  assert.match(lowDirective, /Fast and efficient/);
  assert.match(lowDirective, /swift, direct, concise/);

  const medDirective = compileThinkingLevelDirective('medium');
  assert.match(medDirective, /THINKING LEVEL: MEDIUM - BALANCED DEPTH/);
  assert.match(medDirective, /Balanced depth/);
  assert.match(medDirective, /balanced analytical depth/);

  const highDirective = compileThinkingLevelDirective('high');
  assert.match(highDirective, /THINKING LEVEL: HIGH - EXTRA THOROUGH/);
  assert.match(highDirective, /Extra thorough/);
  assert.match(highDirective, /rigorous multi-angle exploration/);

  assert.equal(compileThinkingLevelDirective(undefined), '');
  assert.equal(compileThinkingLevelDirective(''), '');
});

test('buildSystemPrompt injects dynamic thinking level directive across any arbitrary model and provider with zero hardcoded model checks', () => {
  // Test with Gemini provider and dynamic non-hardcoded model ID
  const geminiPrompt = buildSystemPrompt({
    channel: 'web',
    activeProvider: 'gemini',
    activeModel: 'custom-live-resolved-model-2026',
    thinkingLevel: 'low',
  });
  assert.match(geminiPrompt, /THINKING LEVEL: LOW - FAST AND EFFICIENT/);
  assert.match(geminiPrompt, /custom-live-resolved-model-2026/);

  // Test with Groq provider and dynamic non-hardcoded model ID
  const groqPrompt = buildSystemPrompt({
    channel: 'web',
    activeProvider: 'groq',
    activeModel: 'llama-3.3-70b-versatile-live',
    thinkingLevel: 'medium',
  });
  assert.match(groqPrompt, /THINKING LEVEL: MEDIUM - BALANCED DEPTH/);
  assert.match(groqPrompt, /llama-3.3-70b-versatile-live/);

  // Test with Mistral provider and dynamic non-hardcoded model ID
  const mistralPrompt = buildSystemPrompt({
    channel: 'web',
    activeProvider: 'mistral',
    activeModel: 'mistral-large-2411-live',
    thinkingLevel: 'high',
  });
  assert.match(mistralPrompt, /THINKING LEVEL: HIGH - EXTRA THOROUGH/);
  assert.match(mistralPrompt, /mistral-large-2411-live/);
});
