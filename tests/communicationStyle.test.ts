import test from 'node:test';
import assert from 'node:assert/strict';
import { communicationStyleService } from '../server/services/communicationStyleService.ts';

test('CommunicationStyleService - empty messages handling', async () => {
  const result = await communicationStyleService.analyzeCommunicationStyle([]);
  assert.equal(result.totalAnalyzedMessages, 0);
  assert.equal(result.overallSentiment, 'Neutral & Observant');
  assert.equal(result.averageScore, 0.0);
  assert.equal(result.timeline.length, 0);
  assert.ok(result.personaAdaptation.activeToneMode);
});

test('CommunicationStyleService - frustrated & direct message classification', async () => {
  const messages = [
    { role: 'user', content: 'Why is it broken again? Fix this from the root and do not parch it 😒', created_at: '2026-11-11T10:00:00Z' },
    { role: 'user', content: 'There is an error when building katex dependencies, exit code 1 😠', created_at: '2026-11-11T10:05:00Z' },
  ];

  const result = await communicationStyleService.analyzeCommunicationStyle(messages);

  assert.equal(result.totalAnalyzedMessages, 2);
  assert.ok(result.averageScore < 0, 'Average score should be negative for frustrated inputs');
  assert.equal(result.timeline.length, 2);
  assert.equal(result.timeline[0].sentiment, 'frustrated');
  assert.ok(result.personaAdaptation.activeToneMode.includes('Terse') || result.personaAdaptation.activeToneMode.includes('Diagnostic') || result.personaAdaptation.activeToneMode.includes('Root-Cause'));
  assert.equal(result.personaAdaptation.recommendedPacing, 'concise_fast');

  const directive = communicationStyleService.getPersonaPromptDirective(result);
  assert.ok(directive.includes('DYNAMIC COMMUNICATION STYLE & EMOTIONAL PERSONA TUNING'));
  assert.ok(directive.includes('Active Twin Persona Tuning Mode'));
});

test('CommunicationStyleService - analytical & technical message classification', async () => {
  const messages = [
    { role: 'user', content: 'How does the Neon pgvector 768-dim similarity query work with the Drizzle ORM schema?', created_at: '2026-11-11T10:00:00Z' },
    { role: 'user', content: 'Can you show me the TypeScript class architecture for candidate contradiction detection?', created_at: '2026-11-11T10:05:00Z' },
  ];

  const result = await communicationStyleService.analyzeCommunicationStyle(messages);

  assert.equal(result.totalAnalyzedMessages, 2);
  assert.ok(result.timeline.every((t) => t.sentiment === 'analytical'), 'Messages should be classified as analytical');
  assert.ok(result.personaAdaptation.formalityTarget >= 60, 'Formality target should be elevated for technical queries');
});

test('CommunicationStyleService - enthusiastic & positive message classification', async () => {
  const messages = [
    { role: 'user', content: 'This visual knowledge graph feature is awesome! I love it 🚀✨', created_at: '2026-11-11T10:00:00Z' },
  ];

  const result = await communicationStyleService.analyzeCommunicationStyle(messages);

  assert.equal(result.totalAnalyzedMessages, 1);
  assert.ok(result.averageScore > 0, 'Enthusiastic input should yield positive sentiment score');
  assert.equal(result.timeline[0].sentiment, 'enthusiastic');
  assert.ok(Array.isArray(result.perceivedTraits), 'perceivedTraits should be an array');
  assert.ok(result.perceivedTraits.some((t) => t.trait === 'Empathetic'));
  assert.ok(result.perceivedTraits.some((t) => t.trait === 'Concise'));
});

test('CommunicationStyleService - fast mode runs deterministically with truthful analysisSource and urgent adaptation', async () => {
  const messages = [
    { role: 'user', content: 'Deploy status asap!! Keep it brief and quick!', created_at: '2026-11-14T10:00:00Z' },
  ];

  const result = await communicationStyleService.analyzeCommunicationStyle(messages, {
    mode: 'fast',
    provider: 'groq',
  });

  assert.equal(result.analysisSource, 'deterministic_heuristic');
  assert.equal(result.analyzedProvider, undefined);
  assert.equal(result.personaAdaptation.activeToneMode, 'High-Velocity Operational Directness');
  assert.equal(result.personaAdaptation.recommendedPacing, 'concise_fast');
});

