import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatLatexMathSegment,
  formatLatexToUnicodeMath,
} from '../src/utils/mathTextFormatter.ts';

test('formatLatexMathSegment converts complex calculus equations into clean Unicode math', () => {
  // Chain rule equation from user prompt:
  // $$\frac{d}{dx} \left[ (g(x))^n \right] = n \cdot (g(x))^{n-1} \cdot g'(x)$$
  const latex = '\\frac{d}{dx} \\left[ (g(x))^n \\right] = n \\cdot (g(x))^{n-1} \\cdot g\'(x)';
  const formatted = formatLatexMathSegment(latex);
  assert.equal(formatted, 'd/dx [(g(x))ⁿ] = n · (g(x))ⁿ⁻¹ · g\'(x)');
});

test('formatLatexMathSegment converts polynomial power equations with superscripts', () => {
  // f'(x) = 8(2x^3 + 5x^2 - 7)^7(6x^2 + 10x)
  const latex = 'f\'(x) = 8(2x^3 + 5x^2 - 7)^7(6x^2 + 10x)';
  const formatted = formatLatexMathSegment(latex);
  assert.equal(formatted, 'f\'(x) = 8(2x³ + 5x² - 7)⁷(6x² + 10x)');
});

test('formatLatexToUnicodeMath formats block and inline math without mangling currency', () => {
  const text = [
    'The profit margin is $150 per unit.',
    'Here is the marginal revenue function:',
    '$$R\'(x) = 20x - 5$$',
    'And the derivative is $f\'(x) = 2x$ at $x_0$.',
  ].join('\n');

  const result = formatLatexToUnicodeMath(text);
  assert.ok(result.includes('$150 per unit'));
  assert.ok(result.includes('R\'(x) = 20x - 5'));
  assert.ok(result.includes('f\'(x) = 2x'));
  assert.ok(!result.includes('$$'));
});

test('formatLatexMathSegment supports Greek letters, fractions, and square roots', () => {
  const input = '\\alpha + \\beta = \\sqrt{x} \\times \\theta';
  const formatted = formatLatexMathSegment(input);
  assert.equal(formatted, 'α + β = √(x) × θ');
});
