import test from 'node:test';
import assert from 'node:assert/strict';
import { getMessageContentView, AI_MESSAGE_PREVIEW_LIMIT } from '../src/utils/chatMessagePresentation.ts';

test('keeps user messages fully visible regardless of length or expansion state', () => {
  const content = 'User message '.repeat(AI_MESSAGE_PREVIEW_LIMIT);
  assert.deepEqual(getMessageContentView(content, 'user', false), {
    content,
    canExpand: false,
    isExpanded: false,
  });
});

test('collapses long completed assistant responses and exposes an expansion toggle state', () => {
  const content = 'AI response '.repeat(150);
  const preview = getMessageContentView(content, 'assistant', false);
  assert.equal(preview.canExpand, true);
  assert.equal(preview.isExpanded, false);
  assert.ok(preview.content.length <= AI_MESSAGE_PREVIEW_LIMIT + 1);
  assert.ok(preview.content.endsWith('…'));

  const expanded = getMessageContentView(content, 'assistant', true);
  assert.equal(expanded.canExpand, true);
  assert.equal(expanded.isExpanded, true);
  assert.equal(expanded.content, content);
});

test('does not truncate streaming assistant content before the response is complete', () => {
  const content = 'Live streamed content '.repeat(150);
  const view = getMessageContentView(content, 'assistant', false, true);
  assert.equal(view.canExpand, false);
  assert.equal(view.content, content);
});

test('does not truncate short assistant messages', () => {
  const content = 'A short response.';
  assert.deepEqual(getMessageContentView(content, 'assistant', false), {
    content,
    canExpand: false,
    isExpanded: false,
  });
});
