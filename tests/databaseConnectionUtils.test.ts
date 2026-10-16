import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRetryableDatabaseError,
  summarizeDatabaseConnectionError,
} from '../server/utils/databaseConnection.ts';

test('database connection timeout preserves network diagnostics without disclosing credentials', () => {
  const cause = Object.assign(new Error('connect ETIMEDOUT 203.0.113.10:5432'), {
    code: 'ETIMEDOUT',
    syscall: 'connect',
    address: '203.0.113.10',
    port: 5432,
  });
  const error = new Error('Connection terminated due to connection timeout', { cause });
  const url = 'postgresql://db-user:private-password@ep-example.neon.tech:5432/app?sslmode=require';

  assert.equal(isRetryableDatabaseError(error), true);
  const details = summarizeDatabaseConnectionError(error, url);
  assert.equal(details.code, 'ETIMEDOUT');
  assert.equal(details.syscall, 'connect');
  assert.equal(details.address, '203.0.113.10');
  assert.equal(details.port, 5432);
  assert.equal(details.targetHost, 'ep-example.neon.tech');
  assert.equal(details.targetPort, 5432);
  assert.equal(details.sslMode, 'require');
  assert.doesNotMatch(JSON.stringify(details), /db-user|private-password/);
});

test('transient PostgreSQL startup and network errors are retryable', () => {
  assert.equal(isRetryableDatabaseError(new Error('Connection terminated due to connection timeout')), true);
  assert.equal(isRetryableDatabaseError(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })), true);
  assert.equal(isRetryableDatabaseError(Object.assign(new Error('database system is starting up'), { code: '57P03' })), true);
});

test('authentication and malformed-configuration errors are not classified as transient', () => {
  assert.equal(isRetryableDatabaseError(Object.assign(new Error('password authentication failed'), { code: '28P01' })), false);
  assert.equal(isRetryableDatabaseError(Object.assign(new Error('database does not exist'), { code: '3D000' })), false);
});

test('connection diagnostics redact full PostgreSQL URLs even when embedded in an error', () => {
  const error = new Error('Could not connect to postgresql://user:secret@example.invalid/db');
  const details = summarizeDatabaseConnectionError(error);

  assert.doesNotMatch(details.message, /user:secret|example\.invalid/);
  assert.match(details.message, /REDACTED_DATABASE_URL/);
});
