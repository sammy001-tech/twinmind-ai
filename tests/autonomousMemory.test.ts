import test from 'node:test';
import assert from 'node:assert/strict';
import { autonomousMemoryService } from '../server/services/autonomousMemoryService.ts';

test('AutonomousMemoryService - ignores trivial casual chatter (Tier 3)', async () => {
  const casualStatements = [
    'Hello, how are you today?',
    'What is 2 + 2?',
    'Thanks for the help!',
    'Can you summarize this code snippet for me?',
    'What is the weather like in Tokyo?',
  ];

  for (const statement of casualStatements) {
    const event = await autonomousMemoryService.evaluateAndPersist(statement, {
      mockVectorSearch: async () => [],
    });
    assert.equal(
      event,
      null,
      `Casual statement "${statement}" should not trigger autonomous memory persistence`
    );
  }
});

test('AutonomousMemoryService - saves new structural premise when no match exists (Tier 1)', async () => {
  const statement =
    'From now on, all microservices in our architecture must strictly enforce a ZeroMock policy with runtime database verification.';

  const event = await autonomousMemoryService.evaluateAndPersist(statement, {
    skipAi: true,
    mockVectorSearch: async () => [], // empty search results
    mockAddDocument: async (doc: any) => ({ id: 'doc-new-1', ...doc }),
  });

  assert.ok(event !== null, 'Event should be created for qualified architectural directive');
  assert.equal(event?.action, 'create_new');
  assert.equal(event?.tier, 'architectural');
  assert.ok(event?.confidenceScore && event.confidenceScore >= 70);
  assert.ok(event?.docTitle.length > 0);
  assert.ok(event?.category);
  assert.ok(event?.updatedContent.includes('ZeroMock policy'));
});

test('AutonomousMemoryService - updates existing vault stance in-place with evolution log when matching record exists', async () => {
  const newStatement =
    'We are pivoting our architecture standard from single-tenant isolation to multi-tenant row-level isolation in Neon PostgreSQL.';

  const mockExistingDoc = {
    id: 'doc-123-test',
    title: 'My Technical & Architectural Decisions',
    category: 'decision_framework',
    content:
      'We only deploy single-tenant database instances to ensure maximum tenant isolation.',
  };

  const event = await autonomousMemoryService.evaluateAndPersist(newStatement, {
    skipAi: true,
    mockVectorSearch: async () => [
      {
        ...mockExistingDoc,
        similarity: 0.82,
      },
    ],
    mockListDocuments: async () => [mockExistingDoc],
    mockUpdateDocument: async (_id: number | string, _data: any) => true,
  });

  assert.ok(event !== null, 'Event should be created for evolutionary stance update');
  assert.equal(event?.action, 'update_existing');
  assert.equal(event?.docId, 'doc-123-test');
  assert.equal(event?.docTitle, 'My Technical & Architectural Decisions');
  assert.ok(
    event?.updatedContent.includes('single-tenant database instances') ||
      event?.updatedContent.includes('Strategic Evolution'),
    'Updated content must preserve existing baseline and append evolution section'
  );
  assert.ok(
    event?.updatedContent.includes('Strategic Evolution'),
    'Updated content must include Strategic Evolution header'
  );
});
