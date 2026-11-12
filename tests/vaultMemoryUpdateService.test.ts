import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateVaultUpdateInput,
  selectMatchingVaultDocument,
  mergeMemoryEntryIntoDocument,
  removeMemoryEntryFromDocument,
  executeVaultMemoryUpdate,
  type VaultMemoryStore,
  type VaultDocumentRecord,
} from '../server/services/vaultMemoryUpdateService.ts';
import {
  GEMINI_TWIN_TOOLS,
  OPENAI_COMPATIBLE_TWIN_TOOLS,
} from '../server/services/twinAgentService.ts';

test('validateVaultUpdateInput rejects empty inputs and raw attached-document dumps', () => {
  const missingTopic = validateVaultUpdateInput({ topic: ' ', memoryEntry: 'Include video lessons' });
  assert.equal(missingTopic.valid, false);
  if (!missingTopic.valid) assert.equal(missingTopic.code, 'VAULT_TOPIC_REQUIRED');

  const shortEntry = validateVaultUpdateInput({ topic: 'Learning Journey', memoryEntry: 'ok' });
  assert.equal(shortEntry.valid, false);
  if (!shortEntry.valid) assert.equal(shortEntry.code, 'VAULT_ENTRY_REQUIRED');

  const rawDump = validateVaultUpdateInput({
    topic: 'Course Outline',
    memoryEntry: 'Are we following this [ATTACHED DOCUMENT: GET_205.pdf (PDF, 3566 chars)]...',
  });
  assert.equal(rawDump.valid, false);
  if (!rawDump.valid) assert.equal(rawDump.code, 'VAULT_RAW_ATTACHMENT_REJECTED');

  const retireWithoutEntry = validateVaultUpdateInput({
    topic: 'Old Forex Note',
    mode: 'retire_doc',
  });
  assert.equal(retireWithoutEntry.valid, true);
});

test('selectMatchingVaultDocument finds existing journey/rule document by title and semantic overlap', () => {
  const docs: VaultDocumentRecord[] = [
    {
      id: 101,
      title: 'Forex Training Journey',
      content: 'Demo trading only on EUR/USD using Deriv MT5. Four-question knowledge check per lesson.',
      category: 'workflow',
      tags: ['forex', 'training'],
    },
    {
      id: 102,
      title: 'Database Engineering Standard',
      content: 'Use Neon PostgreSQL with pgvector.',
      category: 'decision_framework',
      tags: ['database'],
    },
  ];

  const matched = selectMatchingVaultDocument(docs, [], {
    topic: 'Forex Learning Journey',
    targetTitle: 'Forex Training Journey',
    memoryEntry: 'All lessons must include a video explanation or recommend best approaches.',
  });

  assert.ok(matched, 'Should match existing Forex Training Journey document');
  assert.equal(matched?.id, 101);
});

test('mergeMemoryEntryIntoDocument appends dated rule and prevents duplicates', () => {
  const firstMerge = mergeMemoryEntryIntoDocument(
    'Demo trading only on EUR/USD.',
    'All lessons must include a video explanation or recommend best approaches.',
    '2026-11-12'
  );
  assert.equal(firstMerge.alreadyPresent, false);
  assert.ok(firstMerge.updatedContent.includes('Demo trading only on EUR/USD.'));
  assert.ok(firstMerge.updatedContent.includes('**Updated (2026-11-12):** All lessons must include a video explanation'));

  const duplicateCheck = mergeMemoryEntryIntoDocument(
    firstMerge.updatedContent,
    'All lessons must include a video explanation or recommend best approaches.',
    '2026-11-12'
  );
  assert.equal(duplicateCheck.alreadyPresent, true);
  assert.equal(duplicateCheck.updatedContent, firstMerge.updatedContent);
});

test('removeMemoryEntryFromDocument strips targeted rule while preserving remaining notes', () => {
  const content = [
    '- **Rule / Note (2026-11-10):** Demo trading only on EUR/USD.',
    '',
    '- **Updated (2026-11-12):** Every lesson must include a video explanation.',
  ].join('\n');

  const removed = removeMemoryEntryFromDocument(content, 'Every lesson must include a video explanation');
  assert.equal(removed.removedCount, 1);
  assert.equal(removed.remainingEmpty, false);
  assert.ok(removed.updatedContent.includes('Demo trading only on EUR/USD.'));
  assert.ok(!removed.updatedContent.includes('video explanation'));
});

test('executeVaultMemoryUpdate updates existing Vault record in-place and returns Memory updated event', async () => {
  const docs: VaultDocumentRecord[] = [
    {
      id: 7,
      title: 'Forex Training Journey',
      content: 'Demo trading only for now. No deposits.',
      category: 'personal_note',
      tags: ['forex'],
    },
  ];

  let updatedPayload: { id: string | number; content?: string } | null = null;
  let addCalled = false;

  const store: VaultMemoryStore = {
    search: async () => [{ ...docs[0], similarity: 0.76 }],
    listDocuments: async () => docs,
    updateDocument: async (id, patch) => {
      updatedPayload = { id, content: patch.content };
      return true;
    },
    addDocument: async () => {
      addCalled = true;
      return { id: 99, success: true };
    },
    deleteDocument: async () => true,
  };

  const result = await executeVaultMemoryUpdate(
    {
      topic: 'Forex Training Journey',
      memoryEntry: 'Every lesson must include a video explanation or recommend best approaches.',
      tier: 'workflow',
    },
    store
  );

  assert.equal(result.status, 'success');
  assert.equal(addCalled, false, 'Should update existing record instead of creating a duplicate');
  if (result.status === 'success') {
    assert.equal(result.action, 'update_existing');
    assert.equal(result.docId, 7);
    assert.equal(result.docTitle, 'Forex Training Journey');
    assert.ok(result.memoryEvent.updatedContent?.includes('Demo trading only for now'));
    assert.ok(result.memoryEvent.updatedContent?.includes('Every lesson must include a video explanation'));
  }
  assert.ok(updatedPayload !== null);
});

test('executeVaultMemoryUpdate supports remove_rule and retires empty docs cleanly', async () => {
  const docs: VaultDocumentRecord[] = [
    {
      id: 14,
      title: 'Forex Training Journey',
      content: '- **Rule (2026-11-12):** Include a video explanation for every lesson.',
      category: 'personal_note',
    },
  ];

  let deletedId: string | number | null = null;
  const store: VaultMemoryStore = {
    search: async () => [{ ...docs[0], similarity: 0.85 }],
    listDocuments: async () => docs,
    updateDocument: async () => true,
    addDocument: async () => ({ id: 99, success: true }),
    deleteDocument: async (id) => {
      deletedId = id;
      return true;
    },
  };

  const missingRule = await executeVaultMemoryUpdate(
    {
      topic: 'Forex Training Journey',
      memoryEntry: 'unrelated nonexistent directive',
      mode: 'remove_rule',
    },
    store
  );
  assert.equal(missingRule.status, 'error');
  if (missingRule.status === 'error') {
    assert.equal(missingRule.code, 'VAULT_RULE_NOT_FOUND');
  }

  const removeLastRule = await executeVaultMemoryUpdate(
    {
      topic: 'Forex Training Journey',
      memoryEntry: 'Include a video explanation for every lesson',
      mode: 'remove_rule',
    },
    store
  );
  assert.equal(removeLastRule.status, 'success');
  assert.equal(deletedId, 14);
  if (removeLastRule.status === 'success') {
    assert.equal(removeLastRule.action, 'delete_doc');
  }
});

test('executeVaultMemoryUpdate fails transparently when DB persistence fails or update_only target missing', async () => {
  const failingStore: VaultMemoryStore = {
    search: async () => [],
    listDocuments: async () => [],
    updateDocument: async () => false,
    addDocument: async () => ({ id: 0, success: false }),
    deleteDocument: async () => false,
  };

  const missingTarget = await executeVaultMemoryUpdate(
    {
      topic: 'Nonexistent Record',
      memoryEntry: 'Always verify outputs.',
      mode: 'update_only',
    },
    failingStore
  );
  assert.equal(missingTarget.status, 'error');
  if (missingTarget.status === 'error') {
    assert.equal(missingTarget.code, 'VAULT_TARGET_NOT_FOUND');
  }

  const dbFailure = await executeVaultMemoryUpdate(
    {
      topic: 'Learning Rules',
      memoryEntry: 'Always include practical exercises.',
      mode: 'update_or_create',
    },
    failingStore
  );
  assert.equal(dbFailure.status, 'error');
  if (dbFailure.status === 'error') {
    assert.equal(dbFailure.code, 'VAULT_PERSISTENCE_FAILED');
  }
});

test('updateMemoryVault tool is registered for Gemini, Groq, and Mistral', () => {
  assert.ok(GEMINI_TWIN_TOOLS.some((t) => t.name === 'updateMemoryVault'));
  assert.ok(OPENAI_COMPATIBLE_TWIN_TOOLS.some((t) => t.function?.name === 'updateMemoryVault'));
});
