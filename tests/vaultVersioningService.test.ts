import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeTextDiff,
  computeSnapshotDiff,
  type VaultSnapshotPayload,
} from '../server/services/vaultVersioningService.ts';
import { knowledgeService } from '../server/db/knowledgeService.ts';
import { memoryService } from '../server/services/memoryService.ts';
import { neonDb } from '../server/db/neonService.ts';

test.after(async () => {
  await neonDb.close();
});

test('computeTextDiff calculates deterministic additions, removals, and context lines', () => {
  const before = [
    'Line 1: Context start',
    'Line 2: Keep risk budget under 2%',
    'Line 3: Trade London open only',
    'Line 4: Context end',
  ].join('\n');

  const after = [
    'Line 1: Context start',
    'Line 2: Keep risk budget under 1%',
    'Line 3: Trade London open only',
    'Line 3b: Log every setup in journal',
    'Line 4: Context end',
  ].join('\n');

  const diff = computeTextDiff(before, after, { contextLines: 1 });
  assert.equal(diff.addedCount, 2);
  assert.equal(diff.removedCount, 1);
  assert.equal(diff.truncated, false);
  assert.match(diff.summary, /\+2 lines \/ -1 line/);

  const removedTexts = diff.lines.filter((l) => l.type === 'remove').map((l) => l.text);
  const addedTexts = diff.lines.filter((l) => l.type === 'add').map((l) => l.text);
  assert.deepEqual(removedTexts, ['Line 2: Keep risk budget under 2%']);
  assert.deepEqual(addedTexts, [
    'Line 2: Keep risk budget under 1%',
    'Line 3b: Log every setup in journal',
  ]);
});

test('computeSnapshotDiff summarizes initial creation, metadata updates, and retirement', () => {
  const initialDoc: VaultSnapshotPayload = {
    title: 'Risk Rulebook',
    content: 'Max drawdown 2% daily.\nNo revenge trades.',
    category: 'personal_note',
    tags: ['trading'],
    confidenceStatus: 'confirmed',
    impactLevel: 'high',
    lifecycleStatus: 'active',
  };

  const created = computeSnapshotDiff('knowledge_doc', null, initialDoc, 'create');
  assert.ok(created.changedFields.includes('content'));
  assert.ok(created.changedFields.includes('title'));
  assert.match(created.diffSummary, /Initial version/i);
  assert.ok(created.diffLines.every((l) => l.type === 'add'));

  const updatedDoc: VaultSnapshotPayload = {
    ...initialDoc,
    content: 'Max drawdown 1% daily.\nNo revenge trades.',
    tags: ['trading', 'risk'],
  };
  const updated = computeSnapshotDiff('knowledge_doc', initialDoc, updatedDoc, 'update');
  assert.ok(updated.changedFields.includes('content'));
  assert.ok(updated.changedFields.includes('tags'));
  assert.match(updated.diffSummary, /\+1 line \/ -1 line/);

  const retired = computeSnapshotDiff('knowledge_doc', updatedDoc, null, 'retire');
  assert.match(retired.diffSummary, /Retired/i);
  assert.ok(retired.diffLines.every((l) => l.type === 'remove'));
});

test('computeSnapshotDiff detects active_rule scope and priority mutations', () => {
  const prevRule: VaultSnapshotPayload = {
    category: 'preference',
    content: 'Explain concepts step-by-step.',
    priority: 2,
    scope: 'permanent',
    is_active: true,
  };
  const nextRule: VaultSnapshotPayload = {
    ...prevRule,
    priority: 5,
    scope: 'project',
    project_key: 'twinmind-ai',
  };

  const res = computeSnapshotDiff('active_rule', prevRule, nextRule, 'update');
  assert.ok(res.changedFields.includes('priority'));
  assert.ok(res.changedFields.includes('scope'));
  assert.ok(res.changedFields.includes('project_key'));
  assert.equal(res.diffLines.length, 0);
});

test('history and rollback fail closed with DATABASE_UNAVAILABLE when DB is disconnected', async () => {
  if (neonDb.isDatabaseConnected()) {
    return;
  }

  await assert.rejects(
    () => knowledgeService.getDocumentHistory(1),
    /DATABASE_UNAVAILABLE/,
  );
  await assert.rejects(
    () => knowledgeService.rollbackDocument(1, 1),
    /DATABASE_UNAVAILABLE/,
  );
  await assert.rejects(
    () => memoryService.getRuleHistory(1),
    /DATABASE_UNAVAILABLE/,
  );
  await assert.rejects(
    () => memoryService.rollbackRule(1, 1),
    /DATABASE_UNAVAILABLE/,
  );
});
