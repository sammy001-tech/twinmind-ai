import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectRuleConflict,
  formatResolvedInstructionsPrompt,
  normalizeProjectKey,
  resolveInstructions,
} from '../server/services/instructionRegistryService.ts';
import type { PersonaMemoryRecord } from '../src/types/index.ts';

test('normalizeProjectKey produces deterministic slug or null', () => {
  assert.equal(normalizeProjectKey('  TwinMind AI  '), 'twinmind-ai');
  assert.equal(normalizeProjectKey('UniAce_v2!'), 'uniace_v2');
  assert.equal(normalizeProjectKey('   '), null);
  assert.equal(normalizeProjectKey(undefined), null);
});

test('resolveInstructions enforces strict System > Permanent > Project > Temporary precedence', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const records: PersonaMemoryRecord[] = [
    {
      id: 1,
      category: 'preference',
      content: 'Always provide detailed comprehensive explanations with concrete examples.',
      priority: 3,
      scope: 'permanent',
      is_active: true,
      created_at: '2026-11-01T10:00:00.000Z',
    },
    {
      id: 2,
      category: 'preference',
      content: 'Always be brief and concise with tl;dr bullets only.',
      priority: 5,
      scope: 'temporary',
      thread_id: 'thread-1',
      expires_at: '2026-11-14T12:00:00.000Z',
      is_active: true,
      created_at: '2026-11-13T10:00:00.000Z',
    },
    {
      id: 3,
      category: 'preference',
      content: 'Enforce ZeroMock policy and dynamic resolution in backend services.',
      priority: 4,
      scope: 'project',
      project_key: 'twinmind-ai',
      is_active: true,
      created_at: '2026-11-10T10:00:00.000Z',
    },
  ];

  const { manifest, expiredIds, promptBlock } = resolveInstructions(records, {
    threadId: 'thread-1',
    projectKey: 'TwinMind AI',
    now,
  });

  assert.deepEqual(expiredIds, []);
  assert.deepEqual(
    manifest.applied.map((r) => r.id),
    [1, 3],
    'Permanent and matching Project rules apply; conflicting Temporary rule must not override Permanent'
  );
  assert.equal(manifest.overridden.length, 1);
  assert.equal(manifest.overridden[0].id, 2);
  assert.equal(manifest.overridden[0].reason, 'overridden_by_higher_precedence');
  assert.equal(manifest.overridden[0].overriddenByRuleId, 1);

  assert.match(promptBlock, /PERMANENT INSTRUCTIONS/);
  assert.match(promptBlock, /PROJECT INSTRUCTIONS — PROJECT: twinmind-ai/);
  assert.doesNotMatch(promptBlock, /tl;dr bullets only/);
});

test('resolveInstructions enforces project isolation, thread isolation, expiry, inactive, and superseded exclusions', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const records: PersonaMemoryRecord[] = [
    {
      id: 10,
      category: 'preference',
      content: 'Use UniAce semester rubric formatting.',
      priority: 4,
      scope: 'project',
      project_key: 'uniace',
      is_active: true,
      created_at: '2026-11-01T00:00:00.000Z',
    },
    {
      id: 11,
      category: 'feedback',
      content: 'Temporary expired session rule.',
      priority: 3,
      scope: 'temporary',
      thread_id: 'thread-active',
      expires_at: '2026-11-13T11:00:00.000Z',
      is_active: true,
      created_at: '2026-11-13T09:00:00.000Z',
    },
    {
      id: 12,
      category: 'preference',
      content: 'Temporary rule for another thread.',
      priority: 3,
      scope: 'temporary',
      thread_id: 'thread-other',
      expires_at: '2026-11-14T12:00:00.000Z',
      is_active: true,
      created_at: '2026-11-13T09:00:00.000Z',
    },
    {
      id: 13,
      category: 'correction',
      content: 'Paused rule.',
      priority: 5,
      scope: 'permanent',
      is_active: false,
      created_at: '2026-11-01T00:00:00.000Z',
    },
    {
      id: 14,
      category: 'preference',
      content: 'Old superseded rule.',
      priority: 4,
      scope: 'permanent',
      is_active: true,
      superseded_by_id: 15,
      created_at: '2026-11-01T00:00:00.000Z',
    },
    {
      id: 15,
      category: 'preference',
      content: 'Break down complex topics step-by-step and give practice questions.',
      priority: 4,
      scope: 'permanent',
      is_active: true,
      created_at: '2026-11-12T00:00:00.000Z',
    },
  ];

  const resolved = resolveInstructions(records, {
    threadId: 'thread-active',
    projectKey: 'twinmind-ai',
    now,
  });

  assert.deepEqual(resolved.expiredIds, [11]);
  assert.deepEqual(resolved.manifest.applied.map((r) => r.id), [15]);

  const reasonById = new Map(resolved.manifest.excluded.map((e) => [e.id, e.reason]));
  assert.equal(reasonById.get(10), 'wrong_project_scope');
  assert.equal(reasonById.get(11), 'expired');
  assert.equal(reasonById.get(12), 'wrong_thread_scope');
  assert.equal(reasonById.get(13), 'inactive');
  assert.equal(reasonById.get(14), 'superseded');
});

test('detectRuleConflict identifies opposing polarity over shared instruction dimensions', () => {
  const conflict = detectRuleConflict(
    'Always include practice questions after explanations.',
    'Skip practice questions and quizzes.'
  );
  assert.equal(conflict.conflicts, true);

  const nonConflict = detectRuleConflict(
    'Always use TypeScript strict mode.',
    'Format financial numbers in USD.'
  );
  assert.equal(nonConflict.conflicts, false);

  const emptyBlock = formatResolvedInstructionsPrompt({
    resolvedAt: '2026-11-13T12:00:00.000Z',
    precedenceOrder: ['system_safety', 'permanent', 'project', 'temporary'],
    applied: [],
    overridden: [],
    excluded: [],
    scopeCounts: { permanent: 0, project: 0, temporary: 0 },
  });
  assert.equal(emptyBlock, '');
});
