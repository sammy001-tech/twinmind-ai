import test from 'node:test';
import assert from 'node:assert/strict';
import { contradictionDetectorService } from '../server/services/contradictionDetectorService.ts';
import { knowledgeService } from '../server/db/knowledgeService.ts';
import { neonDb } from '../server/db/neonService.ts';

test('ContradictionDetectorService - negative cases and input validation', async (t) => {
  await t.test('detectContradiction returns null for empty or whitespace statement', async () => {
    const result = await contradictionDetectorService.detectContradiction('   ', {});
    assert.equal(result, null);
  });

  await t.test('detectContradiction returns null when statement is brief', async () => {
    const result = await contradictionDetectorService.detectContradiction('Hi', {});
    assert.equal(result, null);
  });

  await t.test('resolveConflict rejects invalid action with explicit error message', async () => {
    const result = await contradictionDetectorService.resolveConflict({
      conflictId: 'test-1',
      docId: 'doc-1',
      action: 'invalid_action' as 'update',
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('Invalid resolution action'));
  });

  await t.test('resolveConflict rejects missing docId with explicit error message', async () => {
    const result = await contradictionDetectorService.resolveConflict({
      conflictId: 'test-1',
      docId: '',
      action: 'retire',
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('Document ID is required'));
  });

  await t.test('resolveConflict handles non-existent docId gracefully without inventing success', async () => {
    const result = await contradictionDetectorService.resolveConflict({
      conflictId: 'test-non-existent',
      docId: 999999999,
      action: 'update',
      newStatement: 'Valid updated statement',
    });
    assert.equal(result.success, false);
    assert.ok(result.message.includes('not found') || result.message.includes('Failed'));
  });
});

test('KnowledgeService - getKnowledgeGraph structure contract', async () => {
  const graph = await knowledgeService.getKnowledgeGraph();

  // Validate structural shape adheres to KnowledgeGraphData contract
  assert.ok(Array.isArray(graph.nodes), 'Graph should contain an array of nodes');
  assert.ok(Array.isArray(graph.edges), 'Graph should contain an array of edges');
  assert.ok(Array.isArray(graph.categories), 'Graph should contain an array of categories');
  assert.equal(typeof graph.totalNodes, 'number');
  assert.equal(typeof graph.totalEdges, 'number');
  assert.equal(graph.totalNodes, graph.nodes.length);
  assert.equal(graph.totalEdges, graph.edges.length);

  // If nodes are present, verify node schema integrity
  for (const node of graph.nodes) {
    assert.ok(node.id.startsWith('doc-'), 'Node ID must have doc- prefix');
    assert.ok(typeof node.title === 'string', 'Node must have string title');
    assert.ok(typeof node.category === 'string', 'Node must have category');
    assert.ok(Array.isArray(node.tags), 'Node must have array of tags');
    assert.ok(typeof node.clusterGroup === 'number', 'Node must have numeric clusterGroup');
  }

  // If edges are present, verify edge schema integrity
  for (const edge of graph.edges) {
    assert.ok(typeof edge.source === 'string', 'Edge must have source');
    assert.ok(typeof edge.target === 'string', 'Edge must have target');
    assert.ok(typeof edge.weight === 'number' && edge.weight > 0, 'Edge weight must be positive number');
    assert.ok(['similarity', 'shared_tag', 'cluster'].includes(edge.type), 'Edge must have valid type');
  }
});

test('ZeroMock & Dynamic Resolution - database and capability isolation', async (t) => {
  await t.test('Database write returns explicit failure when pool is disconnected', async () => {
    const isDbConnected = await neonDb.refreshConnection();
    if (!isDbConnected) {
      // In disconnected environment, addDocument must fail cleanly rather than simulating a fake ID
      const res = await knowledgeService.addDocument({
        title: 'Test Note',
        content: 'Content that should not be faked',
      });
      assert.equal(res.success, false, 'Must not claim success when database is disconnected');
      assert.equal(res.id, 0, 'Must not invent a synthetic non-zero document ID');
    }
  });
});
