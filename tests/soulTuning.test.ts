import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateSoulTuningInput,
  compileSoulTuningDirective,
  buildSystemPrompt,
} from '../src/prompt/masterPrompt.ts';

// -----------------------------------------------------------------------------
// 1. Mathematical Validation & Clamping Tests
// -----------------------------------------------------------------------------

test('validateSoulTuningInput defaults missing configuration to neutral 50/50/50', () => {
  const resultNull = validateSoulTuningInput(null);
  assert.equal(resultNull.valid, true);
  if (resultNull.valid) {
    assert.deepEqual(resultNull.config, { tone: 50, directness: 50, perspective: 50 });
  }

  const resultUndefined = validateSoulTuningInput(undefined);
  assert.equal(resultUndefined.valid, true);
  if (resultUndefined.valid) {
    assert.deepEqual(resultUndefined.config, { tone: 50, directness: 50, perspective: 50 });
  }

  const resultEmpty = validateSoulTuningInput({});
  assert.equal(resultEmpty.valid, true);
  if (resultEmpty.valid) {
    assert.deepEqual(resultEmpty.config, { tone: 50, directness: 50, perspective: 50 });
  }
});

test('validateSoulTuningInput accepts valid boundary values 0 and 100', () => {
  const boundaries = validateSoulTuningInput({
    tone: 0,
    directness: 100,
    perspective: 0,
  });

  assert.equal(boundaries.valid, true);
  if (boundaries.valid) {
    assert.equal(boundaries.config.tone, 0);
    assert.equal(boundaries.config.directness, 100);
    assert.equal(boundaries.config.perspective, 0);
  }
});

test('validateSoulTuningInput deterministically clamps out-of-range integers', () => {
  const clamped = validateSoulTuningInput({
    tone: 150,
    directness: -25,
    perspective: 1000,
  });

  assert.equal(clamped.valid, true);
  if (clamped.valid) {
    assert.equal(clamped.config.tone, 100, 'Integer 150 must clamp to 100');
    assert.equal(clamped.config.directness, 0, 'Integer -25 must clamp to 0');
    assert.equal(clamped.config.perspective, 100, 'Integer 1000 must clamp to 100');
  }
});

test('validateSoulTuningInput rejects decimal values explicitly', () => {
  const decimalTone = validateSoulTuningInput({ tone: 42.5 });
  assert.equal(decimalTone.valid, false);
  if (!decimalTone.valid) {
    assert.match(decimalTone.error, /SOUL_TUNING_INVALID_VALUE/);
  }

  const decimalDirectness = validateSoulTuningInput({ directness: 99.9 });
  assert.equal(decimalDirectness.valid, false);
  if (!decimalDirectness.valid) {
    assert.match(decimalDirectness.error, /SOUL_TUNING_INVALID_VALUE/);
  }
});

test('validateSoulTuningInput rejects NaN, Infinity, strings, and non-objects', () => {
  const nanVal = validateSoulTuningInput({ tone: Number.NaN });
  assert.equal(nanVal.valid, false);

  const infVal = validateSoulTuningInput({ perspective: Number.POSITIVE_INFINITY });
  assert.equal(infVal.valid, false);

  const strVal = validateSoulTuningInput({ directness: '50' as unknown as number });
  assert.equal(strVal.valid, false);

  const arrVal = validateSoulTuningInput([50, 50, 50]);
  assert.equal(arrVal.valid, false);

  const primitiveVal = validateSoulTuningInput('invalid');
  assert.equal(primitiveVal.valid, false);
});

test('validateSoulTuningInput preserves existing configuration for partial updates', () => {
  const existing = { tone: 80, directness: 20, perspective: 70 };
  const partial = validateSoulTuningInput({ tone: 15 }, existing);

  assert.equal(partial.valid, true);
  if (partial.valid) {
    assert.equal(partial.config.tone, 15);
    assert.equal(partial.config.directness, 20);
    assert.equal(partial.config.perspective, 70);
  }
});

// -----------------------------------------------------------------------------
// 2. Behavioral Calibration Directive Compilation Tests
// -----------------------------------------------------------------------------

test('compileSoulTuningDirective produces structured, composable instructions for all 3 axes', () => {
  const directive = compileSoulTuningDirective({
    tone: 10,
    directness: 90,
    perspective: 85,
  });

  assert.match(directive, /DIGITAL TWIN BEHAVIORAL CALIBRATION DIRECTIVE/);
  assert.match(directive, /Tone \[10\/100\]: Analytical emphasis/);
  assert.match(directive, /Directness \[90\/100\]: Elaborate depth/);
  assert.match(directive, /Perspective \[85\/100\]: Visionary emphasis/);
});

test('compileSoulTuningDirective enforces non-negotiable safety and factual boundaries', () => {
  const directive = compileSoulTuningDirective({
    tone: 100,
    directness: 0,
    perspective: 0,
  });

  assert.match(directive, /OPERATING BOUNDARIES \(NON-NEGOTIABLE\)/);
  assert.match(directive, /control communicative style and analytical emphasis/);
  assert.match(directive, /do not prohibit analytical rigor when empathy is emphasized/);
  assert.match(directive, /Under no circumstance do these weights override safety policies, factual truth/);
  assert.match(directive, /Explicit user instructions in the current turn take precedence/);
});

test('compileSoulTuningDirective returns empty string when config is absent', () => {
  assert.equal(compileSoulTuningDirective(null), '');
  assert.equal(compileSoulTuningDirective(undefined), '');
});

// -----------------------------------------------------------------------------
// 3. Master System Prompt Integration Tests
// -----------------------------------------------------------------------------

test('buildSystemPrompt injects compiled behavioral directive when soulTuning is provided', () => {
  const prompt = buildSystemPrompt({
    channel: 'web',
    userName: 'Alex',
    soulTuning: {
      tone: 85,
      directness: 15,
      perspective: 20,
    },
  });

  assert.match(prompt, /DIGITAL TWIN BEHAVIORAL CALIBRATION DIRECTIVE/);
  assert.match(prompt, /Tone \[85\/100\]: Empathetic emphasis/);
  assert.match(prompt, /Directness \[15\/100\]: Concise emphasis/);
  assert.match(prompt, /Perspective \[20\/100\]: Skeptical emphasis/);
  assert.match(prompt, /PERSONAL DIGITAL ASSISTANT — EVIDENCE-BOUND OPERATING POLICY/);
});

test('buildSystemPrompt preserves core prompt sections when soulTuning is neutral', () => {
  const prompt = buildSystemPrompt({
    channel: 'telegram',
    userName: 'Jordan',
    soulTuning: {
      tone: 50,
      directness: 50,
      perspective: 50,
    },
  });

  assert.match(prompt, /CHANNEL FORMAT: TELEGRAM/);
  assert.match(prompt, /Tone \[50\/100\]: Balanced tone/);
  assert.match(prompt, /Directness \[50\/100\]: Proportionate depth/);
  assert.match(prompt, /Perspective \[50\/100\]: Balanced perspective/);
});
