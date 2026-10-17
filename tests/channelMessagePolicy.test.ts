import assert from 'node:assert/strict';
import test from 'node:test';
import { CHANNEL_MESSAGE_LIMITS, formatChannelMessage, splitChannelMessage } from '../server/services/channelMessagePolicy.ts';

test('Telegram formatting turns links into readable plain text and strips Markdown emphasis', () => {
  assert.equal(
    formatChannelMessage('## Findings\n**Important**: [Read source](https://example.com/path)\n- First item', 'telegram'),
    'Findings\nImportant: Read source (https://example.com/path)\n• First item'
  );
});

test('WhatsApp formatting normalizes double-asterisk Markdown to supported emphasis', () => {
  assert.equal(
    formatChannelMessage('**Important**\n[Read source](https://example.com/path)\n- First item', 'whatsapp'),
    '*Important*\nRead source: https://example.com/path\n• First item'
  );
});

test('channel splitting respects provider limits and preserves formatted text exactly', () => {
  const source = Array.from({ length: 14 }, (_, index) => `Paragraph ${index + 1} with enough words to test a channel-safe split.`).join('\n\n');
  for (const channel of ['telegram', 'whatsapp'] as const) {
    const formatted = formatChannelMessage(source, channel);
    const parts = splitChannelMessage(source, channel);
    assert.ok(parts.length > 1);
    assert.ok(parts.every((part) => part.length <= CHANNEL_MESSAGE_LIMITS[channel]));
    assert.equal(parts.join(''), formatted);
  }
});

test('channel splitting does not separate UTF-16 surrogate pairs', () => {
  const source = '🙂'.repeat(2000);
  const parts = splitChannelMessage(source, 'whatsapp');
  assert.ok(parts.every((part) => part.length <= CHANNEL_MESSAGE_LIMITS.whatsapp));
  assert.equal(parts.join(''), source);
  for (const part of parts) {
    assert.equal(part.charCodeAt(0) >= 0xdc00 && part.charCodeAt(0) <= 0xdfff, false);
    const finalCode = part.charCodeAt(part.length - 1);
    assert.equal(finalCode >= 0xd800 && finalCode <= 0xdbff, false);
  }
});

test('empty or whitespace-only replies produce no outbound provider calls', () => {
  assert.deepEqual(splitChannelMessage('  \n ', 'telegram'), []);
});
