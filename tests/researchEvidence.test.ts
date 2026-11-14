import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chunkUrlsByBatchLimit,
  normalizeResearchExtractions,
  normalizeResearchSearchResults,
  normalizeResearchUrls,
  normalizeUrlForProvenanceMatch,
  partitionExtractionUrls,
  inspectCitationReferences,
  resolveResearchSearchDepth,
  resolveDynamicAgentExecutionPolicy,
  parseAdaptiveResearchPlan,
  parseInitialResearchPlan,
  resolveBoundedIntegerSetting,
} from '../server/utils/researchEvidence.ts';
import {
  buildGeminiTwinTools,
  buildOpenAiCompatibleTwinTools,
} from '../server/services/twinAgentService.ts';

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
      { title: 'Redirected www variant', url: 'https://www.docs.example.org/allowed?utm_source=test', raw_content: 'Extracted canonical redirect' },
      { title: 'Unrequested page', url: 'https://docs.example.org/other', raw_content: 'Must not enter the evidence set' },
      { title: 'No URL', raw_content: 'Not attributable to a source' },
    ],
  }, allowed);

  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].url, 'https://docs.example.org/allowed');
  assert.equal(extracted[1].url, 'https://www.docs.example.org/allowed?utm_source=test');
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

test('URL safety rejects loopback while allowing syntactically valid public IPv6 source URLs', () => {
  assert.deepEqual(
    normalizeResearchUrls([
      'http://[::1]/admin',
      'https://[2606:4700:4700::1111]/guide',
    ]),
    ['https://[2606:4700:4700::1111]/guide'],
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


test('initial research plans decompose the objective and deduplicate actual model-proposed queries', () => {
  assert.deepEqual(
    parseInitialResearchPlan(JSON.stringify({
      researchQuestions: ['What do official sources say?', 'What operational risks are documented?', 'What do official sources say?'],
      searchQueries: [
        'official product documentation',
        'Official Product Documentation',
        'independent production benchmark',
        'published operational failure reports',
      ],
    }), {
      maxQueries: 2,
      excludeQueries: ['the original user query'],
    }),
    {
      researchQuestions: ['What do official sources say?', 'What operational risks are documented?'],
      searchQueries: ['official product documentation', 'independent production benchmark'],
    },
  );
});

test('initial plans fail closed when the model output does not satisfy the plan schema', () => {
  assert.throws(
    () => parseInitialResearchPlan('not json', { maxQueries: 2 }),
    /RESEARCH_INITIAL_PLAN_INVALID_JSON/,
  );
  assert.throws(
    () => parseInitialResearchPlan(JSON.stringify({ searchQueries: ['query'] }), { maxQueries: 2 }),
    /RESEARCH_INITIAL_PLAN_SCHEMA_INVALID/,
  );
});

test('resolveDynamicAgentExecutionPolicy scales budget dynamically by complexity and reserves deliverable slots', () => {
  const lowSimple = resolveDynamicAgentExecutionPolicy({
    env: {},
    userPrompt: 'Summarize our conversation notes.',
    thinkingLevel: 'low',
    hasSearchProvider: false,
  });
  const highResearchPdf = resolveDynamicAgentExecutionPolicy({
    env: {},
    userPrompt: 'Research enterprise AI agent frameworks with citations and generate a PDF report comparing trade-offs.',
    thinkingLevel: 'high',
    hasSearchProvider: true,
  });

  assert.equal(lowSimple.budgetSource, 'dynamic_task_resolved');
  assert.equal(lowSimple.deliverableReserveCalls, 0);
  assert.ok(highResearchPdf.maxToolCalls > lowSimple.maxToolCalls);
  assert.ok(highResearchPdf.maxToolRounds > lowSimple.maxToolRounds);
  assert.equal(highResearchPdf.deliverableReserveCalls, 1);
  assert.equal(highResearchPdf.extractBatchLimit, 10);

  const explicitEnv = resolveDynamicAgentExecutionPolicy({
    env: {
      TWINMIND_AGENT_MAX_TOOL_CALLS: '15',
      TWINMIND_AGENT_MAX_TOOL_ROUNDS: '7',
      TWINMIND_RESEARCH_EXTRACT_LIMIT: '12',
    },
    userPrompt: 'Create a PDF research report',
    thinkingLevel: 'medium',
    hasSearchProvider: true,
  });
  assert.equal(explicitEnv.budgetSource, 'explicit_env');
  assert.equal(explicitEnv.maxToolCalls, 15);
  assert.equal(explicitEnv.maxToolRounds, 7);
  assert.equal(explicitEnv.extractBatchLimit, 12);

  assert.throws(
    () => resolveDynamicAgentExecutionPolicy({
      env: { TWINMIND_AGENT_MAX_TOOL_CALLS: '999' },
      userPrompt: 'Research frameworks',
      thinkingLevel: 'high',
      hasSearchProvider: true,
    }),
    /RESEARCH_CONFIGURATION_INVALID/,
  );
});

test('partitionExtractionUrls matches benign URL variations to verified canonical URLs while rejecting unverified/SSRF URLs', () => {
  const allowed = ['https://docs.langchain.com/langgraph?v=2', 'https://openai.github.io/agents-sdk'];
  const partition = partitionExtractionUrls(
    [
      'http://www.docs.langchain.com/langgraph/?utm_source=chat&v=2',
      'https://openai.github.io/agents-sdk/',
      'https://unverified.example.com/fabricated',
      'http://127.0.0.1/secret',
    ],
    allowed,
  );

  assert.deepEqual(partition.matchedUrls, [
    'https://docs.langchain.com/langgraph?v=2',
    'https://openai.github.io/agents-sdk',
  ]);
  assert.deepEqual(partition.unauthorizedUrls, ['https://unverified.example.com/fabricated']);
  assert.equal(partition.invalidEntries, true);
  assert.equal(
    normalizeUrlForProvenanceMatch('http://www.Example.COM/path/?utm_medium=social&a=1#frag'),
    'https://example.com/path?a=1',
  );
});

test('chunkUrlsByBatchLimit splits 6+ URLs cleanly into provider-sized batches without dropping URLs', () => {
  const urls = Array.from({ length: 13 }, (_, idx) => `https://example.com/source-${idx + 1}`);
  const batches = chunkUrlsByBatchLimit(urls, 5);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map((b) => b.length), [5, 5, 3]);
  assert.deepEqual(batches.flat(), urls);
});

test('dynamic twin tool builders inject extract batch limits and isolate generateArtifact on delivery round', () => {
  const policy = resolveDynamicAgentExecutionPolicy({
    env: { TWINMIND_RESEARCH_EXTRACT_LIMIT: '12' },
    userPrompt: 'Research frameworks and generate a PDF report',
    thinkingLevel: 'high',
    hasSearchProvider: true,
  });

  const geminiTools = buildGeminiTwinTools(policy);
  const geminiExtract = geminiTools.find((t) => t.name === 'extractWebPages');
  assert.match(geminiExtract.description, /12 URLs per API batch/);

  const geminiDeliveryOnly = buildGeminiTwinTools(policy, { onlyArtifactDelivery: true });
  assert.deepEqual(geminiDeliveryOnly.map((t) => t.name), ['generateArtifact', 'generateArtifactBatch']);

  const openAiDeliveryOnly = buildOpenAiCompatibleTwinTools(policy, { onlyArtifactDelivery: true });
  assert.deepEqual(openAiDeliveryOnly.map((t) => t.function.name), ['generateArtifact', 'generateArtifactBatch']);
});
