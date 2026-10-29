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

test('renderFormattedMarkdown parses level 4 headings (####) as styled heading elements', () => {
  const markdown = '#### 1. Identify and differentiate the inside';
  const elements = renderFormattedMarkdown(markdown);
  assert.equal(elements.length, 1);

  const headingEl = elements[0] as React.ReactElement;
  assert.equal(headingEl.type, 'h5', 'Markdown #### must render as an h5 element');
  assert.ok(
    (headingEl.props as any)?.className?.includes('font-bold'),
    'Heading element must have bold styling class'
  );
});

test('renderFormattedMarkdown parses nested math inside bold (**Inside function $g(x)$:**)', () => {
  const markdown = '**Inside function $g(x)$:** $4x^2 - 5x + 2$';
  const elements = renderFormattedMarkdown(markdown);
  assert.equal(elements.length, 1);

  const paragraphEl = elements[0] as React.ReactElement;
  const children = React.Children.toArray((paragraphEl.props as any).children) as React.ReactElement[];
  
  // Find the strong element
  const strongEl = children.find((c) => c.type === 'strong');
  assert.ok(strongEl, 'Bold wrapper must exist');

  // Verify strong element contains a KaTeX rendered math span
  const strongChildren = React.Children.toArray((strongEl.props as any).children) as React.ReactElement[];
  const mathInBold = strongChildren.find(
    (c) => React.isValidElement(c) && (c.props as any)?.dangerouslySetInnerHTML?.__html?.includes('katex')
  );
  assert.ok(mathInBold, 'Math formula $g(x)$ must be rendered as KaTeX inside the bold tag');
});

test('renderFormattedMarkdown renders math numerals ($2$, $0$, ($6$), ($3$)) and equations ($g\'(x) = 8x - 5$)', () => {
  const sample = [
    '• Derivative of the constant $2$ is $0$',
    '• So, $g\'(x) = 8x - 5$',
    'You bring the exponent ($6$) down and multiply by ($3$)',
  ].join('\n');

  const elements = renderFormattedMarkdown(sample);
  assert.ok(elements.length >= 1);

  // Recursively collect all elements with KaTeX
  const collectKaTeX = (nodes: any[]): any[] => {
    const list: any[] = [];
    for (const node of nodes) {
      if (React.isValidElement(node)) {
        if ((node.props as any)?.dangerouslySetInnerHTML?.__html?.includes('katex')) {
          list.push(node);
        }
        if ((node.props as any)?.children) {
          list.push(...collectKaTeX(React.Children.toArray((node.props as any).children)));
        }
      }
    }
    return list;
  };

  const allMath = collectKaTeX(elements);
  // Expected KaTeX math: $2$, $0$, $g'(x) = 8x - 5$, $6$, $3$ (total 5)
  assert.equal(allMath.length, 5, 'All 5 math instances ($2$, $0$, equation, $6$, $3$) must render as KaTeX');
});

test('renderFormattedMarkdown never renders a div inside a p tag (hydration safety)', () => {
  const samples = [
    'A paragraph with display math:\n$$g(x) = 4x^2 - 5x + 2$$\nand trailing text.',
    'A paragraph with code:\n```js\nconsole.log(1);\n```',
    'Plain text paragraph without math.',
  ];

  for (const sample of samples) {
    const elements = renderFormattedMarkdown(sample);
    
    // Recursively check that no <p> element has a <div> descendant
    const assertNoDivInP = (node: any, insideP = false) => {
      if (!React.isValidElement(node)) return;
      
      const isP = node.type === 'p';
      if (insideP && node.type === 'div') {
        assert.fail(`Found <div> descendant inside <p> tag in markdown output for: ${sample}`);
      }
      
      if ((node.props as any)?.children) {
        React.Children.forEach((node.props as any).children, (child) => {
          assertNoDivInP(child, insideP || isP);
        });
      }
    };

    elements.forEach((el) => assertNoDivInP(el, false));
  }
});


