import assert from 'node:assert/strict';
import test from 'node:test';
import { getChannelThreadId } from '../server/services/channelConversationService.ts';

test('integration thread identifiers are stable and do not contain external account identifiers', () => {
  const first = getChannelThreadId('whatsapp', '+2348012345678');
  assert.equal(first, getChannelThreadId('whatsapp', '+2348012345678'));
  assert.match(first, /^whatsapp-[a-f0-9]{32}$/);
  assert.equal(first.includes('+2348012345678'), false);
});

test('different channels and identities resolve to distinct conversation threads', () => {
  assert.notEqual(getChannelThreadId('telegram', 123456), getChannelThreadId('whatsapp', 123456));
  assert.notEqual(getChannelThreadId('telegram', 123456), getChannelThreadId('telegram', 654321));
});

test('missing external identity is a configuration error rather than a shared fallback thread', () => {
  assert.throws(() => getChannelThreadId('telegram', ''), /CHANNEL_IDENTITY_REQUIRED/);
});
