import assert from 'node:assert/strict';
import test from 'node:test';
import { getMessageDeliveryStatusLabel, resolveMessageProcessingStatus, resolvePersistedMessageStatus } from '../src/utils/messageStatus.ts';

test('status remains unknown when there is no persisted provider evidence', () => {
  assert.equal(resolvePersistedMessageStatus(undefined), undefined);
  assert.equal(resolvePersistedMessageStatus(null), undefined);
  assert.equal(resolvePersistedMessageStatus(''), undefined);
  assert.equal(resolvePersistedMessageStatus('some-fabricated-state'), undefined);
});

test('only supported provider states map into explicit delivery statuses', () => {
  for (const status of ['pending', 'accepted', 'queued', 'sending', 'sent', 'delivered', 'read', 'undelivered']) {
    assert.equal(resolvePersistedMessageStatus(status), status);
  }
});

test('provider failure states render as failure without being promoted to sent/read', () => {
  assert.equal(resolvePersistedMessageStatus('failed'), 'error');
  assert.equal(resolvePersistedMessageStatus('canceled'), 'error');
  assert.equal(resolvePersistedMessageStatus('partially_delivered'), 'error');
  assert.equal(getMessageDeliveryStatusLabel('accepted'), 'Accepted by provider');
  assert.equal(getMessageDeliveryStatusLabel('delivered'), 'Delivered');
  assert.equal(getMessageDeliveryStatusLabel('read'), 'Read');
  assert.equal(getMessageDeliveryStatusLabel('error'), 'Failed');
});

test('processing status stays unknown when no persisted work state exists', () => {
  assert.equal(resolveMessageProcessingStatus(undefined), undefined);
  assert.equal(resolveMessageProcessingStatus(null), undefined);
  assert.equal(resolveMessageProcessingStatus('waiting-maybe'), undefined);
});

test('processing lifecycle accepts only persisted processing, completed, or failed states', () => {
  assert.equal(resolveMessageProcessingStatus('processing'), 'processing');
  assert.equal(resolveMessageProcessingStatus('completed'), 'completed');
  assert.equal(resolveMessageProcessingStatus('failed'), 'failed');
});
