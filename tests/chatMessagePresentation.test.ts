import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMessageContentView,
  findSafeMathSliceIndex,
  DEFAULT_DYNAMIC_PREVIEW_LIMIT,
} from '../src/utils/chatMessagePresentation.ts';

test('on web channel: assistant messages never collapse, while user messages remain collapsible', () => {
  const longText = 'A long message with lots of detailed information. '.repeat(20);

  // Assistant on web channel is NEVER truncated or collapsed
  const webAssistant = getMessageContentView(longText, 'assistant', false, false, { channel: 'web' });
  assert.equal(webAssistant.canExpand, false);
  assert.equal(webAssistant.isExpanded, false);
  assert.equal(webAssistant.content, longText);

  // User on web channel (e.g. mobile screen) IS collapsible
  const webUser = getMessageContentView(longText, 'user', false, false, { channel: 'web' });
  assert.equal(webUser.canExpand, true);
  assert.equal(webUser.isExpanded, false);
  assert.ok(webUser.content.endsWith('…'));

  // User on web expands cleanly
  const webUserExpanded = getMessageContentView(longText, 'user', true, false, { channel: 'web' });
  assert.equal(webUserExpanded.canExpand, true);
  assert.equal(webUserExpanded.isExpanded, true);
  assert.equal(webUserExpanded.content, longText);
});

test('on telegram and whatsapp channels: both user and assistant messages are collapsible', () => {
  const longText = 'A long chat bubble message for mobile messaging apps. '.repeat(20);

  for (const channel of ['telegram', 'whatsapp'] as const) {
    const assistantView = getMessageContentView(longText, 'assistant', false, false, { channel });
    assert.equal(assistantView.canExpand, true);
    assert.equal(assistantView.isExpanded, false);

    const userView = getMessageContentView(longText, 'user', false, false, { channel });
    assert.equal(userView.canExpand, true);
    assert.equal(userView.isExpanded, false);
  }
});

test('short messages remain fully visible without expansion toggle across all channels', () => {
  const shortText = 'Short message that stays fully visible.';
  assert.equal(getMessageContentView(shortText, 'user', false, false, { channel: 'web' }).canExpand, false);
  assert.equal(getMessageContentView(shortText, 'assistant', false, false, { channel: 'web' }).canExpand, false);
  assert.equal(getMessageContentView(shortText, 'user', false, false, { channel: 'telegram' }).canExpand, false);
  assert.equal(getMessageContentView(shortText, 'assistant', false, false, { channel: 'whatsapp' }).canExpand, false);
});

test('dynamically triggers expansion based on multi-line count threshold for collapsible messages', () => {
  const multiLineContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7';
  const view = getMessageContentView(multiLineContent, 'user', false, false, { channel: 'web' });
  assert.equal(view.canExpand, true);
  assert.equal(view.isExpanded, false);
  assert.ok(view.content.includes('Line 5'));
  assert.ok(!view.content.includes('Line 6'));
});

test('findSafeMathSliceIndex preserves closing LaTeX math delimiters', () => {
  const mathPrompt = 'Problem: Find derivative $$f(x) = 3(4x^2 - 5x + 2)^6$$ and show all intermediate steps.';
  const midMathLimit = 35;
  const safeIndex = findSafeMathSliceIndex(mathPrompt, midMathLimit);
  const sliced = mathPrompt.slice(0, safeIndex);
  assert.ok(sliced.includes('$$f(x) = 3(4x^2 - 5x + 2)^6$$'));
});

test('does not truncate streaming content before response completes', () => {
  const content = 'Live streamed content '.repeat(50);
  const view = getMessageContentView(content, 'assistant', false, true, { channel: 'telegram' });
  assert.equal(view.canExpand, false);
  assert.equal(view.content, content);
});
