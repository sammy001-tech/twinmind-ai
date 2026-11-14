import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAFE_QUERYABLE_TABLES,
  validateReadOnlySqlQuery,
  inspectAllowlistedSchema,
  executeReadOnlySqlQuery,
  executeExternalStructuredQuery,
} from '../server/services/structuredDataQueryService.ts';
import { neonDb } from '../server/db/neonService.ts';

test.after(async () => {
  await neonDb.close();
});

test('validateReadOnlySqlQuery allows valid single SELECT and WITH queries over allowlisted tables', () => {
  const simple = validateReadOnlySqlQuery(
    'SELECT id, title, created_at FROM decisions WHERE status = $1 ORDER BY created_at DESC;',
  );
  assert.equal(simple.valid, true);
  assert.deepEqual(simple.referencedTables, ['decisions']);
  assert.equal(simple.normalizedSql?.endsWith(';'), false);

  const cteJoin = validateReadOnlySqlQuery(`
    WITH recent_threads AS (
      SELECT id, title FROM chat_threads
    )
    SELECT rt.title, COUNT(c.id) AS msg_count
    FROM recent_threads rt
    JOIN conversations c ON c.thread_id = rt.id
    GROUP BY rt.title
  `);
  assert.equal(cteJoin.valid, true);
  assert.deepEqual(cteJoin.referencedTables, ['chat_threads', 'conversations']);

  // Quoted string literals containing dangerous words must not trigger false positives
  const literalSafe = validateReadOnlySqlQuery(
    "SELECT id, title FROM twin_knowledge WHERE title != 'delete drop pg_sleep(1)'",
  );
  assert.equal(literalSafe.valid, true);
});

test('validateReadOnlySqlQuery rejects mutations, stacked statements, comments, and restricted/system tables', () => {
  const cases: Array<{ sql: unknown; expectedCode: string }> = [
    { sql: '', expectedCode: 'SQL_QUERY_REQUIRED' },
    { sql: 'DELETE FROM decisions WHERE id = 1', expectedCode: 'QUERY_READONLY_VIOLATION' },
    { sql: 'UPDATE chat_threads SET title = \'hack\'', expectedCode: 'QUERY_READONLY_VIOLATION' },
    { sql: 'INSERT INTO decisions (title) VALUES (\'x\')', expectedCode: 'QUERY_READONLY_VIOLATION' },
    { sql: 'SELECT id FROM decisions; DROP TABLE decisions', expectedCode: 'QUERY_MULTI_STATEMENT_DISALLOWED' },
    { sql: 'SELECT id FROM decisions -- comment', expectedCode: 'QUERY_READONLY_VIOLATION' },
    { sql: 'SELECT id FROM decisions /* block */', expectedCode: 'QUERY_READONLY_VIOLATION' },
    { sql: 'SELECT pg_sleep(5) FROM decisions', expectedCode: 'QUERY_READONLY_VIOLATION' },
    { sql: 'SELECT * FROM twin_settings', expectedCode: 'TABLE_NOT_ALLOWLISTED' },
    { sql: 'SELECT * FROM persona_memories', expectedCode: 'TABLE_NOT_ALLOWLISTED' },
    { sql: 'SELECT * FROM pg_catalog.pg_tables', expectedCode: 'TABLE_NOT_ALLOWLISTED' },
    { sql: 'SELECT * FROM information_schema.tables', expectedCode: 'TABLE_NOT_ALLOWLISTED' },
    { sql: 'SELECT * FROM audit.decisions', expectedCode: 'TABLE_NOT_ALLOWLISTED' },
    { sql: 'SELECT 1 + 1', expectedCode: 'QUERY_TABLE_REFERENCE_REQUIRED' },
    { sql: 'SELECT * FROM generated_artifacts', expectedCode: 'BINARY_COLUMN_DISALLOWED' },
    { sql: 'SELECT id, content FROM generated_artifacts', expectedCode: 'BINARY_COLUMN_DISALLOWED' },
  ];

  for (const c of cases) {
    const res = validateReadOnlySqlQuery(c.sql);
    assert.equal(res.valid, false, `Expected invalid SQL for: ${String(c.sql)}`);
    assert.equal(res.code, c.expectedCode);
  }

  // Explicitly confirm metadata queries against generated_artifacts remain allowed
  const artifactMeta = validateReadOnlySqlQuery(
    'SELECT id, file_name, mime_type, size_bytes, created_at FROM generated_artifacts',
  );
  assert.equal(artifactMeta.valid, true);
  assert.ok(SAFE_QUERYABLE_TABLES.has('generated_artifacts'));
  assert.equal(SAFE_QUERYABLE_TABLES.has('twin_settings'), false);
});

test('executeExternalStructuredQuery enforces SSRF blocking, allowed HTTP methods, and host allowlisting', async () => {
  const ssrfTargets = [
    'http://localhost:3000/api/settings',
    'http://127.0.0.1:8080/health',
    'http://169.254.169.254/latest/meta-data',
    'ftp://example.com/file.json',
    'not-a-url',
  ];

  for (const url of ssrfTargets) {
    const res = await executeExternalStructuredQuery({ url });
    assert.equal(res.status, 'error');
    assert.equal(res.code, 'INVALID_API_URL');
  }

  const badMethod = await executeExternalStructuredQuery({
    url: 'https://api.github.com/zen',
    method: 'DELETE',
  });
  assert.equal(badMethod.status, 'error');
  assert.equal(badMethod.code, 'UNSUPPORTED_HTTP_METHOD');

  const previousAllowlist = process.env.TWINMIND_ALLOWED_DATA_API_HOSTS;
  process.env.TWINMIND_ALLOWED_DATA_API_HOSTS = 'api.example.org,data.trusted.io';
  try {
    const blockedHost = await executeExternalStructuredQuery({
      url: 'https://untrusted.example.com/v1/metrics',
      method: 'GET',
    });
    assert.equal(blockedHost.status, 'error');
    assert.equal(blockedHost.code, 'API_HOST_NOT_ALLOWLISTED');
  } finally {
    if (previousAllowlist === undefined) {
      delete process.env.TWINMIND_ALLOWED_DATA_API_HOSTS;
    } else {
      process.env.TWINMIND_ALLOWED_DATA_API_HOSTS = previousAllowlist;
    }
  }
});

const hasLiveDatabase = Boolean(process.env.DATABASE_URL?.trim());

test('inspectAllowlistedSchema & executeReadOnlySqlQuery fail transparently when DATABASE_URL is absent', {
  skip: hasLiveDatabase ? 'Skipped offline DB check while live DATABASE_URL is active' : false,
}, async () => {
  const schema = await inspectAllowlistedSchema();
  assert.equal(schema.status, 'error');
  assert.equal(schema.code, 'DATABASE_UNCONNECTED');
  assert.deepEqual(schema.tables, []);

  const query = await executeReadOnlySqlQuery('SELECT id, title FROM decisions LIMIT 5');
  assert.equal(query.status, 'error');
  assert.equal(query.code, 'DATABASE_UNCONNECTED');
  assert.deepEqual(query.rows, []);
});
