import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDebateConfiguration } from '../server/services/debateConfigService.ts';

test('resolveDebateConfiguration returns clean default 2-persona 1-round balanced config', () => {
  const res = resolveDebateConfiguration({});
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.config.personaCount, 2);
  assert.equal(res.config.rounds, 1);
  assert.equal(res.config.focusBias, 'balanced');
  assert.equal(res.config.personas.length, 2);
  assert.deepEqual(res.config.constraints, []);
  assert.deepEqual(res.config.clampedFields, []);

  const weightSum = Object.values(res.config.focusWeights).reduce((s, v) => s + v, 0);
  assert.equal(weightSum, 100);
});

test('resolveDebateConfiguration honors custom personas, focusBias, focusWeights, and constraints', () => {
  const res = resolveDebateConfiguration({
    personaCount: 3,
    rounds: 2,
    focusBias: 'risk_averse',
    focusWeights: JSON.stringify({ risk: 60, regulatory: 30, growth: 10, capital: 0, speed: 0 }),
    personas: JSON.stringify([
      { name: 'Chief Compliance Officer', mandate: 'Reject unverified financial claims.', weight: 50 },
      { name: 'Growth VP', mandate: 'Evaluate pipeline expansion velocity.', weight: 25 },
    ]),
    constraints: ['Max budget $15,000', 'Launch within 30 days'],
  });

  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.config.personaCount, 3);
  assert.equal(res.config.rounds, 2);
  assert.equal(res.config.focusBias, 'risk_averse');
  assert.equal(res.config.focusWeights.risk, 60);
  assert.equal(res.config.focusWeights.regulatory, 30);
  assert.equal(res.config.focusWeights.growth, 10);
  assert.equal(res.config.personas[0].name, 'Chief Compliance Officer');
  // 3rd persona dynamically filled from risk_averse archetype ordering
  assert.equal(res.config.personas.length, 3);
  assert.deepEqual(res.config.constraints, ['Max budget $15,000', 'Launch within 30 days']);

  const personaWeightSum = res.config.personas.reduce((s, p) => s + p.weight, 0);
  assert.equal(personaWeightSum, 100);
});

test('resolveDebateConfiguration transparently clamps out-of-range counts using dynamic env limits', () => {
  const customEnv = {
    ...process.env,
    TWINMIND_DEBATE_MAX_PERSONAS: '3',
    TWINMIND_DEBATE_MAX_ROUNDS: '2',
  };

  const res = resolveDebateConfiguration({ personaCount: 9, rounds: 7 }, customEnv);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.config.personaCount, 3);
  assert.equal(res.config.rounds, 2);
  assert.equal(res.config.clampedFields.length, 2);
  assert.ok(res.config.clampedFields.some((msg) => msg.includes('personaCount clamped from 9 to configured maximum 3')));
  assert.ok(res.config.clampedFields.some((msg) => msg.includes('rounds clamped from 7 to configured maximum 2')));
});

test('resolveDebateConfiguration rejects malformed JSON or unknown focusBias fail-closed', () => {
  const badBias = resolveDebateConfiguration({ focusBias: 'ultra_yolo' });
  assert.equal(badBias.ok, false);
  if (!badBias.ok) assert.equal(badBias.code, 'DEBATE_INVALID_FOCUS_BIAS');

  const badPersonas = resolveDebateConfiguration({ personas: '{not valid json' });
  assert.equal(badPersonas.ok, false);
  if (!badPersonas.ok) assert.equal(badPersonas.code, 'DEBATE_INVALID_PERSONAS_JSON');

  const badWeights = resolveDebateConfiguration({ focusWeights: '{"risk": -5}' });
  assert.equal(badWeights.ok, false);
  if (!badWeights.ok) assert.equal(badWeights.code, 'DEBATE_INVALID_FOCUS_WEIGHTS');
});
