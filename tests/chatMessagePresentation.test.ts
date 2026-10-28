import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMessageContentView,
  findSafeMathSliceIndex,
  DEFAULT_DYNAMIC_PREVIEW_LIMIT,
} from '../src/utils/chatMessagePresentation.ts';

test('dynamic resolution evaluates user and assistant messages identically without role discrimination', () => {
  const shortText = 'Short message that stays fully visible.';
  const longText = 'Dynamic prompt or response content '.repeat(20);

  // Both user and assistant short messages are not expanded
  assert.equal(getMessageContentView(shortText, 'user', false).canExpand, false);
  assert.equal(getMessageContentView(shortText, 'assistant', false).canExpand, false);

  // Both user and assistant long messages dynamically resolve canExpand = true
  const userView = getMessageContentView(longText, 'user', false);
  const assistantView = getMessageContentView(longText, 'assistant', false);

  assert.equal(userView.canExpand, true);
  assert.equal(assistantView.canExpand, true);
  assert.equal(userView.isExpanded, false);
  assert.equal(assistantView.isExpanded, false);
  assert.ok(userView.content.endsWith('…'));
  assert.ok(assistantView.content.endsWith('…'));
});

test('dynamically expands any message regardless of role when expanded is true', () => {
  const longText = 'Expanded message content '.repeat(20);
  const userExpanded = getMessageContentView(longText, 'user', true);
  const assistantExpanded = getMessageContentView(longText, 'assistant', true);

  assert.equal(userExpanded.isExpanded, true);
  assert.equal(userExpanded.content, longText);
  assert.equal(assistantExpanded.isExpanded, true);
  assert.equal(assistantExpanded.content, longText);
});

test('dynamically triggers expansion based on multi-line count threshold', () => {
  const multiLineContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7';
  const view = getMessageContentView(multiLineContent, 'user', false);
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
  const view = getMessageContentView(content, 'assistant', false, true);
  assert.equal(view.canExpand, false);
  assert.equal(view.content, content);
});
