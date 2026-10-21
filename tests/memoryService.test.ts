import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPPORTED_PERSONA_MEMORY_CATEGORIES,
  buildMemoryExtractionPrompt,
  validateAndNormalizeMemory,
  parseExtractedMemories,
  memoryService,
} from '../server/services/memoryService.ts';
import { neonDb } from '../server/db/neonService.ts';

test.after(async () => {
  await neonDb.close();
});

// -----------------------------------------------------------------------------
// 1. Identity Neutrality Tests
// -----------------------------------------------------------------------------

test('buildMemoryExtractionPrompt does not contain hardcoded Lekzy references', () => {
  const promptDefault = buildMemoryExtractionPrompt(
    'I prefer using TypeScript over Python for backend services.',
    'Understood, I will keep backend examples in TypeScript.'
  );

  assert.equal(
    promptDefault.toLowerCase().includes('lekzy'),
    false,
    'Memory extraction prompt must never contain hardcoded "Lekzy"'
  );
  assert.ok(
    promptDefault.includes('the user'),
    'Default prompt should refer to "the user" neutrally'
  );

  const promptNamed = buildMemoryExtractionPrompt(
    'Never use dark mode mockups.',
    'Acknowledged.',
    'Alex'
  );

  assert.equal(
    promptNamed.toLowerCase().includes('lekzy'),
    false,
    'Named prompt must not contain hardcoded "Lekzy"'
  );
  assert.ok(
    promptNamed.includes('Alex'),
    'Prompt should use the explicitly configured user name'
  );
});

// -----------------------------------------------------------------------------
// 2. Memory Validation & Category Constraints
// -----------------------------------------------------------------------------

test('SUPPORTED_PERSONA_MEMORY_CATEGORIES contains only expected canonical categories', () => {
  assert.deepEqual(SUPPORTED_PERSONA_MEMORY_CATEGORIES, [
    'preference',
    'opinion',
    'correction',
    'feedback',
  ]);
});

test('validateAndNormalizeMemory accepts valid candidates across all supported categories', () => {
  for (const cat of SUPPORTED_PERSONA_MEMORY_CATEGORIES) {
    const validated = validateAndNormalizeMemory({
      category: cat,
      content: `User shared a ${cat}`,
      priority: 3,
    });

    assert.ok(validated !== null);
    assert.equal(validated?.category, cat);
    assert.equal(validated?.content, `User shared a ${cat}`);
    assert.equal(validated?.priority, 3);
  }
});

test('validateAndNormalizeMemory rejects unsupported categories', () => {
  const invalidCategories = ['random_thought', 'fact', 'biography', 'mood', '', 'UNKNOWN'];
  for (const cat of invalidCategories) {
    const validated = validateAndNormalizeMemory({
      category: cat,
      content: 'Some valid content',
      priority: 3,
    });
    assert.equal(validated, null, `Category "${cat}" must be rejected`);
  }
});

test('validateAndNormalizeMemory rejects empty, whitespace, or non-string content', () => {
  const invalidContents = ['', '   ', null, undefined, 12345, {}, []];
  for (const content of invalidContents) {
    const validated = validateAndNormalizeMemory({
      category: 'preference',
      content,
      priority: 3,
    });
    assert.equal(validated, null, `Invalid content ${JSON.stringify(content)} must be rejected`);
  }
});

test('validateAndNormalizeMemory enforces canonical priority defaults when priority is invalid or missing', () => {
  const correction = validateAndNormalizeMemory({
    category: 'correction',
    content: 'Do not use corporate jargon.',
  });
  assert.equal(correction?.priority, 5, 'Correction should default to priority 5');

  const preference = validateAndNormalizeMemory({
    category: 'preference',
    content: 'Prefers dark mode.',
    priority: 999, // out of range
  });
  assert.equal(preference?.priority, 4, 'Out of range priority should fall back to category default 4');

  const opinion = validateAndNormalizeMemory({
    category: 'opinion',
    content: 'Values clean code above speed.',
    priority: -2,
  });
  assert.equal(opinion?.priority, 3, 'Negative priority should fall back to category default 3');

  const feedback = validateAndNormalizeMemory({
    category: 'feedback',
    content: 'Great structure on the last summary.',
    priority: 'high', // wrong type
  });
  assert.equal(feedback?.priority, 2, 'Non-number priority should fall back to category default 2');
});

// -----------------------------------------------------------------------------
// 3. JSON Parsing & Malformed Model Output Rejection
// -----------------------------------------------------------------------------

test('parseExtractedMemories parses clean JSON arrays', () => {
  const jsonInput = JSON.stringify([
    { category: 'preference', content: 'Prefers Python for data scripts', priority: 4 },
    { category: 'correction', content: 'Call me Dr. Smith', priority: 5 },
  ]);

  const results = parseExtractedMemories(jsonInput);
  assert.equal(results.length, 2);
  assert.equal(results[0].category, 'preference');
  assert.equal(results[1].category, 'correction');
});

test('parseExtractedMemories parses markdown-fenced JSON arrays', () => {
  const fenced = '```json\n[\n  {"category": "opinion", "content": "Believes remote work is more productive", "priority": 3}\n]\n```';
  const results = parseExtractedMemories(fenced);
  assert.equal(results.length, 1);
  assert.equal(results[0].category, 'opinion');
  assert.equal(results[0].content, 'Believes remote work is more productive');
});

test('parseExtractedMemories extracts embedded JSON arrays from surrounding commentary', () => {
  const surrounded = 'Here are the memories extracted from the conversation:\n[{"category": "feedback", "content": "Liked bulleted points", "priority": 2}]\nHope this helps!';
  const results = parseExtractedMemories(surrounded);
  assert.equal(results.length, 1);
  assert.equal(results[0].category, 'feedback');
  assert.equal(results[0].content, 'Liked bulleted points');
});

test('parseExtractedMemories rejects malformed JSON and non-array output cleanly', () => {
  assert.deepEqual(parseExtractedMemories(''), []);
  assert.deepEqual(parseExtractedMemories('Not JSON at all'), []);
  assert.deepEqual(parseExtractedMemories('{"category": "preference"}'), []); // Object instead of Array
  assert.deepEqual(parseExtractedMemories('[{malformed json: 123]'), []);
});

test('parseExtractedMemories filters out invalid array elements and deduplicates', () => {
  const mixed = JSON.stringify([
    { category: 'preference', content: 'Prefers concise emails', priority: 4 },
    { category: 'invalid_category', content: 'Should be ignored', priority: 4 },
    { category: 'preference', content: '', priority: 4 }, // empty content
    { category: 'preference', content: 'Prefers concise emails', priority: 4 }, // duplicate
    null,
    123,
    { category: 'opinion', content: 'Prefers async communication', priority: 3 },
  ]);

  const results = parseExtractedMemories(mixed);
  assert.equal(results.length, 2);
  assert.equal(results[0].content, 'Prefers concise emails');
  assert.equal(results[1].content, 'Prefers async communication');
});

// -----------------------------------------------------------------------------
// 4. Short Message Bypass
// -----------------------------------------------------------------------------

test('extractMemoriesFromInteraction returns empty array immediately for short greetings', async () => {
  const resEmpty = await memoryService.extractMemoriesFromInteraction('', 'Hello!');
  assert.deepEqual(resEmpty, []);

  const resShort = await memoryService.extractMemoriesFromInteraction('Hi', 'Hello there!');
  assert.deepEqual(resShort, []);
});
