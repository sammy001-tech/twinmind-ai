import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeExternalMarkdownUrl } from '../src/utils/markdown.tsx';

test('allows absolute HTTP and HTTPS Markdown links', () => {
  assert.equal(isSafeExternalMarkdownUrl('https://example.com/path?q=term'), true);
  assert.equal(isSafeExternalMarkdownUrl('http://example.com'), true);
});

test('rejects non-web, relative, and malformed Markdown link destinations', () => {
  assert.equal(isSafeExternalMarkdownUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalMarkdownUrl('data:text/html,hello'), false);
  assert.equal(isSafeExternalMarkdownUrl('//example.com/path'), false);
  assert.equal(isSafeExternalMarkdownUrl('/local/path'), false);
  assert.equal(isSafeExternalMarkdownUrl('not a URL'), false);
});
