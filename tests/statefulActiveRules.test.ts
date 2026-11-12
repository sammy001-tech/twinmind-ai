import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatefulMemoryExtractionPrompt,
  parseStatefulMemoryOperations,
  applyActiveRuleOperations,
  executeManageActiveRules,
  type ActiveRuleStore,
  type ExistingPersonaRule,
} from '../server/services/memoryService.ts';
import {
  GEMINI_TWIN_TOOLS,
  OPENAI_COMPATIBLE_TWIN_TOOLS,
} from '../server/services/twinAgentService.ts';

function createInMemoryRuleStore(initial: ExistingPersonaRule[] = []): ActiveRuleStore & {
  snapshot: () => ExistingPersonaRule[];
} {
  let nextId = initial.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const rows: ExistingPersonaRule[] = initial.map((r) => ({ ...r }));

  return {
    snapshot: () => rows.map((r) => ({ ...r })),
    listRules: async (limit = 100) => rows.slice(0, limit).map((r) => ({ ...r })),
    addRule: async (rule) => {
      const id = nextId++;
      rows.push({
        id,
        category: rule.category,
        content: rule.content,
        priority: rule.priority ?? 3,
      });
      return id;
    },
    updateRule: async (id, patch) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      rows[idx] = {
        ...rows[idx],
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      };
      return true;
    },
    deleteRule: async (id) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      rows.splice(idx, 1);
      return true;
    },
  };
}

test('buildStatefulMemoryExtractionPrompt includes existing rules with IDs and supports empty state', () => {
  const emptyPrompt = buildStatefulMemoryExtractionPrompt(
    'Always show derivation steps.',
    'Got it.',
    [],
    'Sam'
  );
  assert.ok(emptyPrompt.includes('CURRENT ACTIVE RULES:\nNone stored yet.'));
  assert.ok(emptyPrompt.includes('Sam'));

  const populatedPrompt = buildStatefulMemoryExtractionPrompt(
    'Include Python examples too.',
    'Understood.',
    [{ id: 12, category: 'preference', content: 'Prefer concise answers.', priority: 4 }]
  );
  assert.ok(populatedPrompt.includes('[ID: 12] (preference, priority 4) Prefer concise answers.'));
});

test('parseStatefulMemoryOperations handles add/update/delete, blocks unknown IDs, and prevents duplicates', () => {
  const existing: ExistingPersonaRule[] = [
    { id: 10, category: 'preference', content: 'Prefer concise summaries in Telegram.', priority: 4 },
    { id: 11, category: 'correction', content: 'Do not use corporate jargon in explanations.', priority: 5 },
  ];

  const jsonPayload = JSON.stringify([
    // Valid update to #10
    {
      action: 'update',
      id: 10,
      category: 'preference',
      content: 'Prefer concise summaries in Telegram with key numbers bolded.',
      priority: 4,
    },
    // No-op update to #11 (identical text, category, priority) -> should be filtered out
    {
      action: 'update',
      id: 11,
      category: 'correction',
      content: 'Do not use corporate jargon in explanations.',
      priority: 5,
    },
    // Invalid delete referencing unknown ID -> should be rejected
    { action: 'delete', id: 999 },
    // Duplicate add of #11 -> should be ignored
    {
      action: 'add',
      category: 'correction',
      content: 'Do not use corporate jargon in explanations.',
      priority: 5,
    },
    // Net-new add
    {
      action: 'add',
      category: 'preference',
      content: 'All Forex lessons must include a video explanation.',
      priority: 4,
    },
  ]);

  const ops = parseStatefulMemoryOperations(jsonPayload, existing);
  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0], {
    action: 'update',
    id: 10,
    category: 'preference',
    content: 'Prefer concise summaries in Telegram with key numbers bolded.',
    priority: 4,
  });
  assert.deepEqual(ops[1], {
    action: 'add',
    category: 'preference',
    content: 'All Forex lessons must include a video explanation.',
    priority: 4,
  });
});

test('applyActiveRuleOperations mutates store in-place and reports DB failures transparently', async () => {
  const store = createInMemoryRuleStore([
    { id: 1, category: 'preference', content: 'Keep lessons text-only.', priority: 4 },
    { id: 2, category: 'feedback', content: 'Use short bullets.', priority: 2 },
  ]);

  const outcome = await applyActiveRuleOperations(
    [
      { action: 'update', id: 1, category: 'preference', content: 'All lessons must include a video explanation.', priority: 5 },
      { action: 'delete', id: 2 },
      { action: 'add', category: 'correction', content: 'Never use demo assumptions without evidence.', priority: 5 },
    ],
    store
  );

  assert.equal(outcome.appliedCount, 3);
  assert.equal(outcome.errors.length, 0);
  assert.equal(outcome.updated.length, 1);
  assert.deepEqual(outcome.deleted, [2]);
  assert.equal(outcome.added.length, 1);

  const after = store.snapshot();
  assert.equal(after.length, 2);
  assert.equal(after[0].id, 1);
  assert.equal(after[0].content, 'All lessons must include a video explanation.');

  const failingStore: ActiveRuleStore = {
    listRules: async () => [{ id: 1, category: 'preference', content: 'Old', priority: 3 }],
    addRule: async () => null,
    updateRule: async () => false,
    deleteRule: async () => false,
  };
  const failedOutcome = await applyActiveRuleOperations(
    [
      { action: 'update', id: 1, content: 'New' },
      { action: 'delete', id: 1 },
      { action: 'add', category: 'preference', content: 'Brand new', priority: 4 },
    ],
    failingStore
  );
  assert.equal(failedOutcome.appliedCount, 0);
  assert.equal(failedOutcome.errors.length, 3);
});

test('executeManageActiveRules supports live add, update, delete, list, deep-link metadata, and negative checks', async () => {
  const store = createInMemoryRuleStore([
    { id: 42, category: 'preference', content: 'Keep lessons to text summaries.', priority: 4 },
  ]);

  const listRes = await executeManageActiveRules({ action: 'list' }, store);
  assert.equal(listRes.status, 'success');
  assert.equal(listRes.rules?.length, 1);

  // Update by exact ID
  const updateRes = await executeManageActiveRules(
    {
      action: 'update',
      ruleId: 42,
      content: 'Every learning lesson must include a video explanation and practical MT5 demo steps.',
      priority: 5,
    },
    store
  );
  assert.equal(updateRes.status, 'success');
  assert.equal(updateRes.memoryEvent?.target, 'rule');
  assert.equal(updateRes.memoryEvent?.ruleId, 42);
  assert.equal(updateRes.memoryEvent?.docId, 'rule-42');
  assert.equal(store.snapshot()[0].content, 'Every learning lesson must include a video explanation and practical MT5 demo steps.');

  // Add net-new rule
  const addRes = await executeManageActiveRules(
    {
      action: 'add',
      category: 'correction',
      content: 'Show full derivation math steps before stating final equations.',
      priority: 5,
    },
    store
  );
  assert.equal(addRes.status, 'success');
  assert.equal(addRes.memoryEvent?.target, 'rule');
  assert.equal(addRes.memoryEvent?.action, 'create_new');
  assert.equal(addRes.memoryEvent?.docId, `rule-${addRes.memoryEvent?.ruleId}`);

  // Delete by fuzzy matchText
  const delRes = await executeManageActiveRules(
    {
      action: 'delete',
      matchText: 'full derivation math steps',
    },
    store
  );
  assert.equal(delRes.status, 'success');
  assert.equal(delRes.memoryEvent?.action, 'remove_rule');
  assert.equal(delRes.memoryEvent?.target, 'rule');
  assert.equal(delRes.memoryEvent?.docId, 'rules');

  // Negative cases
  const badAction = await executeManageActiveRules({ action: 'wipe_all' }, store);
  assert.equal(badAction.status, 'error');
  assert.equal(badAction.code, 'ACTIVE_RULE_ACTION_INVALID');

  const emptyAdd = await executeManageActiveRules({ action: 'add', content: '   ' }, store);
  assert.equal(emptyAdd.status, 'error');
  assert.equal(emptyAdd.code, 'ACTIVE_RULE_CONTENT_REQUIRED');

  const missingTarget = await executeManageActiveRules({ action: 'update', ruleId: 999, content: 'Missing' }, store);
  assert.equal(missingTarget.status, 'error');
  assert.equal(missingTarget.code, 'ACTIVE_RULE_NOT_FOUND');

  // Registered in both provider tool schemas
  assert.ok(GEMINI_TWIN_TOOLS.some((t) => t.name === 'manageActiveRules'));
  assert.ok(OPENAI_COMPATIBLE_TWIN_TOOLS.some((t) => t.function?.name === 'manageActiveRules'));
});
