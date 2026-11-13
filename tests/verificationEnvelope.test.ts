import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVerificationEnvelope,
  classifyToolExecution,
} from '../server/services/verificationEnvelopeService.ts';

test('classifyToolExecution distinguishes succeeded_usable, succeeded_insufficient, and failed tool outcomes', () => {
  const usable = classifyToolExecution({
    toolName: 'searchWeb',
    result: {
      status: 'success',
      sources: [
        {
          url: 'https://neon.tech/docs/introduction',
          snippet: 'Neon is a serverless Postgres platform supporting pgvector and branching.',
        },
      ],
    },
  });
  assert.equal(usable.executionStatus, 'succeeded_usable');
  assert.equal(usable.resultCount, 1);

  const emptySearch = classifyToolExecution({
    toolName: 'searchWeb',
    result: {
      status: 'error',
      code: 'LIVE_SEARCH_NO_USABLE_RESULTS',
      error: 'No usable sources returned.',
    },
  });
  assert.equal(emptySearch.executionStatus, 'succeeded_insufficient');

  const shortSnippets = classifyToolExecution({
    toolName: 'extractWebPages',
    result: {
      status: 'success',
      sources: [{ url: 'https://example.com', snippet: 'Too short' }],
    },
  });
  assert.equal(shortSnippets.executionStatus, 'succeeded_insufficient');

  const failedTool = classifyToolExecution({
    toolName: 'searchWeb',
    result: {
      status: 'unconfigured_key',
      code: 'MISSING_TAVILY_API_KEY',
      error: 'Tavily API key is not configured.',
    },
  });
  assert.equal(failedTool.executionStatus, 'failed');
  assert.equal(failedTool.errorCode, 'MISSING_TAVILY_API_KEY');
});

test('buildVerificationEnvelope never marks an entire response verified when any claim is partial, conflicted, or tool failed', () => {
  const mixedEnvelope = buildVerificationEnvelope({
    userPrompt: 'Compare our Neon decision with latest pricing',
    replyText: 'We chose Neon in our pinned doc, and search snippets suggest usage-based billing.',
    pinnedDocs: [{ id: 1, file_name: 'architecture-adr.md', format: 'md' }],
    toolsExecuted: [
      {
        toolName: 'searchWeb',
        result: {
          status: 'success',
          sources: [
            {
              url: 'https://neon.tech/pricing',
              snippet: 'Neon offers usage-based compute scaling and storage pricing tiers.',
            },
          ],
        },
      },
    ],
  });

  // searchWeb without extractWebPages yields 'partial', pinnedDocs yields 'verified' => mixed
  assert.equal(mixedEnvelope.overallPosture, 'mixed');
  assert.ok(mixedEnvelope.claims.some((c) => c.status === 'verified'));
  assert.ok(mixedEnvelope.claims.some((c) => c.status === 'partial'));
});

test('buildVerificationEnvelope surfaces failure banners and unverified status when external research fails', () => {
  const failedEnvelope = buildVerificationEnvelope({
    userPrompt: 'What is the latest release version of React today?',
    replyText: 'Unable to retrieve verified live version info.',
    toolsExecuted: [
      {
        toolName: 'searchWeb',
        result: {
          status: 'execution_failed',
          code: 'UPSTREAM_TIMEOUT',
          error: 'Search provider timed out.',
        },
      },
    ],
  });

  assert.equal(failedEnvelope.hasToolFailures, true);
  assert.equal(failedEnvelope.overallPosture, 'unverified');
  assert.ok(
    failedEnvelope.bannerMessages.some(
      (b) => b.severity === 'error' && b.code === 'TOOL_EXECUTION_FAILED'
    )
  );
  assert.ok(failedEnvelope.claims.some((c) => c.status === 'unverified'));
});

test('buildVerificationEnvelope emits explicit not_attempted tool ledger entry when verification-heavy prompt runs no search', () => {
  const envelope = buildVerificationEnvelope({
    userPrompt: 'Did we previously decide to use Neon or Firebase for this component?',
    replyText: 'We discussed Neon earlier, though no live lookup ran.',
    memoryDiagnostics: [
      {
        id: 7,
        title: 'Old Storage Draft',
        category: 'decision_framework',
        similarity: 0.88,
        sourceType: 'legacy_import',
        confidenceStatus: 'confirmed',
        impactLevel: 'high',
        lifecycleStatus: 'superseded',
        supersededById: 9,
        includedInPrompt: false,
        reason: 'Excluded from primary factual injection: superseded by record #9.',
      },
    ],
  });

  const searchEntry = envelope.toolLedger.find((t) => t.toolName === 'searchWeb');
  assert.ok(searchEntry);
  assert.equal(searchEntry.executionStatus, 'not_attempted');
  assert.equal(envelope.overallPosture, 'unverified');
  assert.equal(envelope.hasUnverifiedMaterialClaims, true);
});
