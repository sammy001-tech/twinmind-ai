import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateMemorySupersession,
  inferImpactLevelFromCategory,
  rankAndFilterRetrievedMemories,
  toGovernedRecord,
} from '../server/services/memoryGovernanceService.ts';

test('evaluateMemorySupersession auto-supersedes older low/medium confirmed records with newer confirmed updates', () => {
  const decision = evaluateMemorySupersession(
    {
      id: 10,
      title: 'Academic standing',
      content: 'Currently a 100-level first-year student.',
      category: 'personal_note',
      confidenceStatus: 'confirmed',
      impactLevel: 'low',
      createdAt: '2025-09-01T10:00:00.000Z',
    },
    {
      id: 11,
      title: 'Academic standing update',
      content: 'Now in 200-level second year.',
      category: 'personal_note',
      confidenceStatus: 'confirmed',
      impactLevel: 'low',
      createdAt: '2026-09-01T10:00:00.000Z',
    }
  );

  assert.equal(decision.action, 'auto_supersede');
  assert.equal(decision.existingNewStatus, 'superseded');
  assert.equal(decision.incomingNewStatus, 'active');
  assert.equal(decision.requiresOwnerReview, false);
});

test('evaluateMemorySupersession preserves conflicts on high-impact architectural records unless explicitly overridden', () => {
  const existing = {
    id: 21,
    title: 'Database Architecture Decision',
    content: 'Use Neon PostgreSQL with pgvector for primary persistence.',
    category: 'decision_framework',
    confidenceStatus: 'confirmed' as const,
    impactLevel: 'high' as const,
    createdAt: '2026-01-10T10:00:00.000Z',
  };
  const incoming = {
    id: 22,
    title: 'Database Migration Idea',
    content: 'Use Firebase Firestore instead of Neon.',
    category: 'decision_framework',
    confidenceStatus: 'confirmed' as const,
    impactLevel: 'high' as const,
    createdAt: '2026-10-10T10:00:00.000Z',
  };

  const defaultDecision = evaluateMemorySupersession(existing, incoming);
  assert.equal(defaultDecision.action, 'preserve_conflict');
  assert.equal(defaultDecision.existingNewStatus, 'conflicted');
  assert.equal(defaultDecision.incomingNewStatus, 'conflicted');
  assert.equal(defaultDecision.requiresOwnerReview, true);

  const overrideDecision = evaluateMemorySupersession(existing, incoming, {
    explicitOwnerOverride: true,
  });
  assert.equal(overrideDecision.action, 'auto_supersede');
  assert.equal(overrideDecision.existingNewStatus, 'superseded');
  assert.equal(overrideDecision.incomingNewStatus, 'active');
  assert.equal(overrideDecision.requiresOwnerReview, false);
});

test('evaluateMemorySupersession refuses auto-supersession when incoming record is inferred or provisional', () => {
  const decision = evaluateMemorySupersession(
    {
      id: 30,
      title: 'Confirmed API preference',
      content: 'Always use TypeScript strict mode.',
      category: 'personal_note',
      confidenceStatus: 'confirmed',
      impactLevel: 'low',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 31,
      title: 'Inferred style switch',
      content: 'Maybe switch to plain JS.',
      category: 'personal_note',
      confidenceStatus: 'inferred',
      impactLevel: 'low',
      createdAt: '2026-11-01T00:00:00.000Z',
    }
  );

  assert.equal(decision.action, 'preserve_conflict');
  assert.equal(decision.requiresOwnerReview, true);
  assert.match(decision.reason, /inferred/i);
});

test('rankAndFilterRetrievedMemories excludes superseded facts from primary prompt injection while exposing diagnostics and conflicts', () => {
  const outdatedFirstYear = toGovernedRecord({
    id: 1,
    title: 'University Level (Old)',
    content: 'User is a first-year 100-level student.',
    category: 'personal_note',
    similarity: 0.94,
    confidence_status: 'confirmed',
    impact_level: 'low',
    lifecycle_status: 'superseded',
    superseded_by_id: 2,
    source_type: 'direct_directive',
    created_at: '2025-10-01T00:00:00.000Z',
  });

  const currentSecondYear = toGovernedRecord({
    id: 2,
    title: 'University Level (Current)',
    content: 'User is now in 200-level.',
    category: 'personal_note',
    similarity: 0.89,
    confidence_status: 'confirmed',
    impact_level: 'low',
    lifecycle_status: 'active',
    source_type: 'direct_directive',
    last_verified_at: '2026-10-01T00:00:00.000Z',
  });

  const conflictedDbChoice = toGovernedRecord({
    id: 3,
    title: 'Storage Stack Tension',
    content: 'Debating Neon vs Firebase.',
    category: 'decision_framework',
    similarity: 0.82,
    confidence_status: 'provisional',
    impact_level: 'high',
    lifecycle_status: 'conflicted',
    source_type: 'in_turn_synthesis',
  });

  const ranked = rankAndFilterRetrievedMemories(
    [outdatedFirstYear, currentSecondYear, conflictedDbChoice],
    { limit: 5 }
  );

  assert.equal(ranked.primaryRecords.some((r) => r.id === 1), false, 'Superseded record must not enter primaryRecords');
  assert.equal(ranked.primaryRecords[0].id, 2, 'Active confirmed record must rank first');
  assert.equal(ranked.diagnostics.length, 3);

  const diagSuperseded = ranked.diagnostics.find((d) => d.id === 1);
  assert.ok(diagSuperseded);
  assert.equal(diagSuperseded.includedInPrompt, false);
  assert.match(diagSuperseded.reason, /superseded by record #2/i);

  assert.equal(ranked.conflictsDetected.length, 1);
  assert.equal(ranked.conflictsDetected[0].existingDocId, 3);
  assert.equal(inferImpactLevelFromCategory('decision_framework'), 'high');
});
