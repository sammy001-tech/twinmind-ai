import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {
  renderKaTeXToString,
  renderInlineMarkdown,
  renderFormattedMarkdown,
  isSafeExternalMarkdownUrl,
} from '../src/utils/markdown.tsx';

test('renderKaTeXToString formats mathematical LaTeX into standard KaTeX HTML', () => {
  // Inline math
  const inline = renderKaTeXToString("f'(x)", false);
  assert.equal(inline.success, true);
  assert.ok(inline.html.includes('katex'));
  assert.ok(inline.html.includes('f'));

  // Block fractions and superscripts
  const block = renderKaTeXToString(
    '\\frac{d}{dx} \\left[ (g(x))^n \\right] = n \\cdot (g(x))^{n-1} \\cdot g\'(x)',
    true
  );
  assert.equal(block.success, true);
  assert.ok(block.html.includes('katex-display') || block.html.includes('katex'));
  assert.ok(block.html.includes('frac') || block.html.includes('vlist'));
});

test('renderFormattedMarkdown renders block math equations cleanly', () => {
  const markdown = [
    'Here is the derivative equation:',
    '$$',
    '\\frac{d}{dx}(x^2) = 2x',
    '$$',
    'And a single line equation:',
    '$$E = mc^2$$',
  ].join('\n');

  const elements = renderFormattedMarkdown(markdown);
  assert.ok(elements.length >= 4);

  // Check that block math rendered with dangerouslySetInnerHTML containing katex
  const mathDivs = elements.filter(
    (el) => React.isValidElement(el) && (el.props as any)?.dangerouslySetInnerHTML?.__html?.includes('katex')
  );
  assert.equal(mathDivs.length, 2, 'Both block equations must be converted to KaTeX containers');
});

test('renderFormattedMarkdown renders horizontal divider dashes (---) as hr elements', () => {
  const markdown = [
    'Section 1: Hypothesis',
    '---',
    'Section 2: Verification',
  ].join('\n');

  const elements = renderFormattedMarkdown(markdown);
  assert.equal(elements.length, 3);

  const hrElement = elements.find(
    (el) => React.isValidElement(el) && el.type === 'hr'
  );
  assert.ok(hrElement, '--- must be rendered as an hr element');
});

test('renderInlineMarkdown formats inline math equations without corrupting currency', () => {
  // Inline math
  const mathNodes = renderInlineMarkdown('The slope is $f\'(x)$ at point $x_0$.');
  assert.ok(Array.isArray(mathNodes));

  const mathSpans = (mathNodes as React.ReactElement[]).filter(
    (node) => React.isValidElement(node) && (node.props as any)?.dangerouslySetInnerHTML?.__html?.includes('katex')
  );
  assert.equal(mathSpans.length, 2, 'Both $f\'(x)$ and $x_0$ must render as KaTeX inline elements');

  // Currency
  const currencyNodes = renderInlineMarkdown('Cost is $100 per user.');
  const currencyMath = (currencyNodes as React.ReactElement[]).filter(
    (node) => React.isValidElement(node) && (node.props as any)?.dangerouslySetInnerHTML?.__html?.includes('katex')
  );
  assert.equal(currencyMath.length, 0, 'Plain currency $100 must not be treated as a math equation');
});

test('isSafeExternalMarkdownUrl validates safe external protocols', () => {
  assert.equal(isSafeExternalMarkdownUrl('https://example.com/docs'), true);
  assert.equal(isSafeExternalMarkdownUrl('http://example.com/api'), true);
  assert.equal(isSafeExternalMarkdownUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalMarkdownUrl('data:text/html,<h1>evil</h1>'), false);
  assert.equal(isSafeExternalMarkdownUrl('not-a-url'), false);
});

test('renderInlineMarkdown renders epistemic badges alongside math equations', () => {
  const nodes = renderInlineMarkdown('[Verified] The derivative is $f\'(x) = 2x$.');
  assert.ok(Array.isArray(nodes));

  const hasBadge = (nodes as React.ReactElement[]).some(
    (n) => React.isValidElement(n) && (n.props as any)?.className?.includes('bg-emerald-500/15')
  );
  assert.equal(hasBadge, true, 'Epistemic badge [Verified] must be converted into formatted badge element');

  const hasMath = (nodes as React.ReactElement[]).some(
    (n) => React.isValidElement(n) && (n.props as any)?.dangerouslySetInnerHTML?.__html?.includes('katex')
  );
  assert.equal(hasMath, true, 'Math formula must render alongside the badge');
});

