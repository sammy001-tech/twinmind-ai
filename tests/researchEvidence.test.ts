import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeResearchExtractions,
  normalizeResearchSearchResults,
  normalizeResearchUrls,
  inspectCitationReferences,
  resolveResearchSearchDepth,
  parseAdaptiveResearchPlan,
  resolveBoundedIntegerSetting,
} from '../server/utils/researchEvidence.ts';

// These are pure normalization/validation tests. They do not simulate an external search
// provider, a provider success response, or a successful live research session.

test('search evidence excludes records without real titles, HTTP(S) URLs, or content', () => {
  const sources = normalizeResearchSearchResults([
    { title: 'Real title', url: 'https://docs.example.org/guide#section', content: 'Provider-returned excerpt', score: 0.82 },
    { title: '', url: 'https://docs.example.org/no-title', content: 'Missing title' },
    { title: 'Missing excerpt', url: 'https://docs.example.org/no-content', content: '' },
    { title: 'Invalid scheme', url: 'javascript:alert(1)', content: 'Not a source' },
    { title: 'Credentials in URL', url: 'https://user:pass@docs.example.org/private', content: 'Not a source' },
    { title: 'Local host', url: 'http://localhost/private', content: 'Not a source' },
    { title: 'Private address', url: 'http://192.168.1.20/admin', content: 'Not a source' },
  ]);

  assert.deepEqual(sources, [
    {
      title: 'Real title',
      url: 'https://docs.example.org/guide',
      content: 'Provider-returned excerpt',
      score: 0.82,
    },
  ]);
});

test('search evidence deduplicates canonical URLs while retaining actual source data', () => {
  const sources = normalizeResearchSearchResults([
    { title: 'First title', url: 'https://docs.example.org/guide/', content: 'Short excerpt' },
    { title: 'Updated title', url: 'https://docs.example.org/guide#overview', content: 'A longer provider-returned excerpt', published_date: '2026-10-15' },
  ]);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'Updated title');
  assert.equal(sources[0].content, 'A longer provider-returned excerpt');
  assert.equal(sources[0].publishedDate, '2026-10-15');
  assert.equal(sources[0].score, undefined);
});

test('source extraction accepts only the URLs selected from real search records', () => {
  const allowed = normalizeResearchSearchResults([
    { title: 'Allowed page', url: 'https://docs.example.org/allowed', content: 'Search excerpt' },
  ]);
  const extracted = normalizeResearchExtractions({
    results: [
      { title: 'Allowed page full text', url: 'https://docs.example.org/allowed#top', raw_content: 'Extracted page text' },
      { title: 'Unrequested page', url: 'https://docs.example.org/other', raw_content: 'Must not enter the evidence set' },
      { title: 'No URL', raw_content: 'Not attributable to a source' },
    ],
  }, allowed);

  assert.deepEqual(extracted, [
    { title: 'Allowed page full text', url: 'https://docs.example.org/allowed', content: 'Extracted page text' },
  ]);
});

test('research URL normalization rejects malformed and non-HTTP URLs and removes duplicates', () => {
  assert.deepEqual(
    normalizeResearchUrls([
      'https://docs.example.org/a#part',
      'https://docs.example.org/a',
      'file:///etc/passwd',
      'not-a-url',
      'https://docs.example.org/b',
    ]),
    ['https://docs.example.org/a', 'https://docs.example.org/b'],
  );
});

test('adaptive query plans exclude previously searched queries and duplicate suggestions', () => {
  const plan = parseAdaptiveResearchPlan(JSON.stringify({
    followUpQueries: [
      'Current official pricing',
      'current official pricing',
      'Independent benchmark methodology',
      'Published reliability limitations',
    ],
    unresolvedQuestions: ['Can the full workload fit within the target budget?', ''],
  }), {
    maxQueries: 2,
    previouslySearched: ['current official pricing'],
  });

  assert.deepEqual(plan, {
    followUpQueries: ['Independent benchmark methodology', 'Published reliability limitations'],
    unresolvedQuestions: ['Can the full workload fit within the target budget?'],
  });
});

test('adaptive query plans fail explicitly when model output is invalid', () => {
  assert.throws(
    () => parseAdaptiveResearchPlan('not json', { maxQueries: 2 }),
    /RESEARCH_PLAN_INVALID_JSON/,
  );
  assert.throws(
    () => parseAdaptiveResearchPlan(JSON.stringify({ followUpQueries: ['query'] }), { maxQueries: 2 }),
    /RESEARCH_PLAN_SCHEMA_INVALID/,
  );
});

test('zero remaining query budget produces no follow-up query', () => {
  assert.deepEqual(
    parseAdaptiveResearchPlan(JSON.stringify({
      followUpQueries: ['New research question'],
      unresolvedQuestions: ['Question remains open'],
    }), { maxQueries: 0 }),
    { followUpQueries: [], unresolvedQuestions: ['Question remains open'] },
  );
});

test('runtime research limits accept valid configuration and reject invalid explicit values', () => {
  assert.equal(resolveBoundedIntegerSetting(
    { TWINMIND_RESEARCH_FOLLOW_UP_LIMIT: '3' },
    'TWINMIND_RESEARCH_FOLLOW_UP_LIMIT',
    2,
    0,
    4,
  ), 3);
  assert.equal(resolveBoundedIntegerSetting(
    {},
    'TWINMIND_RESEARCH_FOLLOW_UP_LIMIT',
    2,
    0,
    4,
  ), 2);
  assert.throws(
    () => resolveBoundedIntegerSetting(
      { TWINMIND_RESEARCH_FOLLOW_UP_LIMIT: 'unlimited' },
      'TWINMIND_RESEARCH_FOLLOW_UP_LIMIT',
      2,
      0,
      4,
    ),
    /RESEARCH_CONFIGURATION_INVALID/,
  );
  assert.throws(
    () => resolveBoundedIntegerSetting(
      { TWINMIND_RESEARCH_FOLLOW_UP_LIMIT: '99' },
      'TWINMIND_RESEARCH_FOLLOW_UP_LIMIT',
      2,
      0,
      4,
    ),
    /RESEARCH_CONFIGURATION_INVALID/,
  );
});


test('citation identifiers must resolve to real entries in the current evidence ledger', () => {
  assert.deepEqual(
    inspectCitationReferences('The documented feature exists [S1], but an unsourced detail uses [S9].', new Set(['S1', 'S2'])),
    { hasCitation: true, unknownIds: ['S9'] },
  );
  assert.deepEqual(
    inspectCitationReferences('No source citation was supplied.', new Set(['S1'])),
    { hasCitation: false, unknownIds: [] },
  );
  assert.deepEqual(
    inspectCitationReferences('The source is documented [S2].', new Set(['S2'])),
    { hasCitation: true, unknownIds: [] },
  );
});

test('research search depth is resolved from live deployment configuration and invalid values fail closed', () => {
  assert.equal(resolveResearchSearchDepth({ TWINMIND_RESEARCH_SEARCH_DEPTH: 'basic' }), 'basic');
  assert.equal(resolveResearchSearchDepth({ TWINMIND_RESEARCH_SEARCH_DEPTH: 'ADVANCED' }), 'advanced');
  assert.equal(resolveResearchSearchDepth({}), 'advanced');
  assert.throws(
    () => resolveResearchSearchDepth({ TWINMIND_RESEARCH_SEARCH_DEPTH: 'invented-mode' }),
    /RESEARCH_CONFIGURATION_INVALID/,
  );
});
