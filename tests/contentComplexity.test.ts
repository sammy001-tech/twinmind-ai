import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  classifyResponseContent,
  classifyContentStructure,
} from '../src/utils/contentClassifier.ts';
import {
  renderFormattedMarkdown,
} from '../src/utils/markdown.tsx';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';

const testMarked = new Marked({ gfm: true, breaks: true });
testMarked.use(markedKatex({ throwOnError: false, nonStandard: true }));

test('classifyResponseContent handles empty and trivial strings safely', () => {
  const empty = classifyResponseContent('');
  assert.equal(empty.complexity, 'low');
  assert.equal(empty.primaryType, 'conversational');
  assert.equal(empty.structuralCounts.paragraphs, 0);

  const short = classifyResponseContent('Hello! How can I help you today?');
  assert.equal(short.complexity, 'low');
  assert.equal(short.primaryType, 'conversational');
  assert.ok(short.structuralCounts.paragraphs >= 1);
});

test('classifyResponseContent dynamically scores structured technical content', () => {
  const technicalResponse = [
    '# Architectural Overview',
    'Here is the primary workflow for processing inbound messages:',
    '',
    '## Component Comparison',
    '| Feature | In-Memory | SQLite / Postgres |',
    '|---|---|---|',
    '| Persistence | None | Durable WAL |',
    '| Recovery | Process Loss | Immediate |',
    '',
    '## Implementation Details',
    '```typescript',
    'export async function executePipeline(input: PipelineInput): Promise<PipelineResult> {',
    '  const validated = validateInput(input);',
    '  return await processDurable(validated);',
    '}',
    '```',
    '',
    '## Mathematical Verification',
    '$$P(A|B) = \\frac{P(B|A)P(A)}{P(B)}$$',
    '',
    '1. Step 1: Ingest payload and verify signature',
    '2. Step 2: Resolve model capability dynamically',
    '3. Step 3: Persist transaction audit trail',
  ].join('\n');

  const metadata = classifyResponseContent(technicalResponse);
  const { structuralCounts: stats } = metadata;
  
  assert.ok(stats.headings >= 3, 'Must detect 3+ headings');
  assert.ok(stats.tables >= 1, 'Must detect table');
  assert.ok(stats.codeBlocks >= 1, 'Must detect code block');
  assert.ok(stats.mathBlocks >= 1, 'Must detect math block');
  assert.ok(stats.lists >= 1, 'Must detect list');
  assert.ok(metadata.complexity === 'high' || metadata.complexity === 'ultra', 'Score should reflect dense or deep-technical content');
  assert.equal(metadata.primaryType, 'data_heavy', 'Tables prioritize data_heavy classification');
});

test('layoutHints adjusts typography and spacing across complexity tiers', () => {
  const compactMetadata = classifyResponseContent('Quick answer: Yes, that is correct.');
  assert.equal(compactMetadata.complexity, 'low');
  assert.ok(compactMetadata.layoutHints.containerClassName.includes('px-1'));

  const denseResponse = [
    '### Step 1: Mathematical Foundations',
    '$$\\nabla f(x) = 0$$',
    '### Step 2: Implementation',
    '```javascript\nconsole.log(true);\n```',
    '### Step 3: Performance Verification',
    '| Metric | Value |',
    '|---|---|',
    '| Latency | 12ms |',
  ].join('\n');

  const denseMetadata = classifyResponseContent(denseResponse);
  assert.ok(denseMetadata.complexity === 'high' || denseMetadata.complexity === 'ultra');
  assert.ok(denseMetadata.layoutHints.sectionSpacing.includes('space-y-'));
  assert.equal(denseMetadata.layoutHints.showHierarchyLines, true);
});


test('classifyContentStructure groups multi-part AST tokens into modular sections', () => {
  const doc = [
    'Opening remarks introducing the architectural synthesis.',
    '',
    '## Section 1: Executive Principles',
    'Core invariant rules are enforced at runtime.',
    '',
    '## Section 2: Code Execution',
    '```python\ndef run():\n    return 42\n```',
  ].join('\n');

  const tokens = testMarked.lexer(doc);
  const classified = classifyContentStructure(tokens, doc);

  assert.equal(classified.isMultiPart, true);
  assert.equal(classified.hasDistinctModules, true);
  assert.ok(classified.sections.length >= 2);
  assert.equal(classified.sections[0].type, 'preamble');
});

test('renderFormattedMarkdown wraps multi-part responses in structured modular containers when enabled', () => {
  const multiPartText = [
    'Executive Summary: We analyzed both approaches.',
    '',
    '## Part 1: First-Principles Derivation',
    'We define the objective function:',
    '$$f(x) = x^2 - 4x + 4$$',
    '',
    '## Part 2: Concrete Implementation',
    '```typescript',
    'const solve = (x: number) => x * x - 4 * x + 4;',
    '```',
  ].join('\n');

  const elements = renderFormattedMarkdown(multiPartText, { isMultiPart: true });
  assert.ok(elements.length >= 2, 'Must render distinct section elements');

  // Verify that at least one section tag wrapper exists for modular cards
  const sectionWrappers = elements.filter(
    (el) => React.isValidElement(el) && el.type === 'section'
  );
  assert.ok(sectionWrappers.length >= 2, 'Modular sections must be wrapped in <section> containers');
});

test('CodeBlock with highlight.js syntax highlighting produces styled tokens', () => {
  const codeSample = [
    '```typescript',
    'interface UserSession {',
    '  id: string;',
    '  active: boolean;',
    '}',
    '```',
  ].join('\n');

  const elements = renderFormattedMarkdown(codeSample);
  assert.equal(elements.length, 1);
  const codeComponent = elements[0] as React.ReactElement;
  assert.equal(typeof codeComponent.type, 'function');
  assert.equal((codeComponent.props as any).language, 'typescript');

  const renderedHtml = renderToStaticMarkup(codeComponent);
  assert.ok(renderedHtml.includes('<section'), 'Must render section wrapper');
  assert.ok(renderedHtml.includes('<pre'), 'Must render pre element');
  assert.ok(renderedHtml.includes('<code'), 'Must render code element');
  assert.ok(
    renderedHtml.includes('hljs-keyword') || renderedHtml.includes('hljs-title') || renderedHtml.includes('hljs-attr'),
    'highlight.js syntax token classes must be applied to tokens'
  );
});
