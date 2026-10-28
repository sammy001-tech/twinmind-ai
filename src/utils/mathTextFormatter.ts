/**
 * mathTextFormatter.ts
 *
 * Converts LaTeX mathematical expressions ($$...$$, $...$, \(...\), \[...\])
 * into clean, universally readable Unicode math text for environments that
 * do not render browser KaTeX HTML (e.g. native Telegram client, PDF transcripts,
 * plain text export, clipboard).
 */

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
  'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ',
  'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'j': 'ʲ', 'k': 'ᵏ',
  'l': 'ˡ', 'm': 'ᵐ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ',
  's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ'
};

const SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
  'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ',
  'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ',
  'v': 'ᵥ', 'x': 'ₓ'
};

const SYMBOL_MAP: Record<string, string> = {
  '\\cdot': '·',
  '\\times': '×',
  '\\div': '÷',
  '\\pm': '±',
  '\\mp': '∓',
  '\\leq': '≤',
  '\\le': '≤',
  '\\geq': '≥',
  '\\ge': '≥',
  '\\neq': '≠',
  '\\ne': '≠',
  '\\approx': '≈',
  '\\equiv': '≡',
  '\\sim': '∼',
  '\\infty': '∞',
  '\\propto': '∝',
  '\\sum': '∑',
  '\\prod': '∏',
  '\\int': '∫',
  '\\partial': '∂',
  '\\nabla': '∇',
  '\\in': '∈',
  '\\notin': '∉',
  '\\subset': '⊂',
  '\\subseteq': '⊆',
  '\\cup': '∪',
  '\\cap': '∩',
  '\\forall': '∀',
  '\\exists': '∃',
  '\\neg': '¬',
  '\\to': '→',
  '\\rightarrow': '→',
  '\\leftarrow': '←',
  '\\Rightarrow': '⇒',
  '\\Leftarrow': '⇐',
  '\\Leftrightarrow': '⇔',
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\epsilon': 'ε',
  '\\zeta': 'ζ',
  '\\eta': 'η',
  '\\theta': 'θ',
  '\\iota': 'ι',
  '\\kappa': 'κ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\nu': 'ν',
  '\\xi': 'ξ',
  '\\pi': 'π',
  '\\rho': 'ρ',
  '\\sigma': 'σ',
  '\\tau': 'τ',
  '\\upsilon': 'υ',
  '\\phi': 'φ',
  '\\chi': 'χ',
  '\\psi': 'ψ',
  '\\omega': 'ω',
  '\\Gamma': 'Γ',
  '\\Delta': 'Δ',
  '\\Theta': 'Θ',
  '\\Lambda': 'Λ',
  '\\Xi': 'Ξ',
  '\\Pi': 'Π',
  '\\Sigma': 'Σ',
  '\\Upsilon': 'Υ',
  '\\Phi': 'Φ',
  '\\Psi': 'Ψ',
  '\\Omega': 'Ω',
};

/**
 * Converts a sequence of characters to superscript Unicode characters if possible.
 */
function toSuperscript(str: string): string {
  let res = '';
  for (const char of str) {
    if (SUPERSCRIPTS[char]) {
      res += SUPERSCRIPTS[char];
    } else {
      // If not all characters have a superscript mapping, return original in parentheses
      return `^(${str})`;
    }
  }
  return res;
}

/**
 * Converts a sequence of characters to subscript Unicode characters if possible.
 */
function toSubscript(str: string): string {
  let res = '';
  for (const char of str) {
    if (SUBSCRIPTS[char]) {
      res += SUBSCRIPTS[char];
    } else {
      return `_(${str})`;
    }
  }
  return res;
}

/**
 * Formats an individual LaTeX math expression into native Unicode math text.
 */
export function formatLatexMathSegment(latex: string): string {
  let out = latex.trim();

  // 1. Remove left/right bracket sizing commands
  out = out.replace(/\\left\s*([(\[{|])/g, '$1');
  out = out.replace(/\\right\s*([)\]}|])/g, '$1');
  out = out.replace(/\\left\s*\./g, '');
  out = out.replace(/\\right\s*\./g, '');
  out = out.replace(/\\{/g, '{').replace(/\\}/g, '}');

  // 2. Fractions: \frac{numerator}{denominator}
  // Repeat to handle nested or multiple fractions
  while (/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/.test(out)) {
    out = out.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_match, num, den) => {
      const cleanNum = num.trim();
      const cleanDen = den.trim();
      if ((cleanNum === 'd' || cleanNum === '\\partial') && (cleanDen.startsWith('d') || cleanDen.startsWith('\\partial'))) {
        return `${cleanNum}/${cleanDen}`;
      }
      return `${cleanNum} / ${cleanDen}`;
    });
  }

  // 3. Square Roots: \sqrt{arg} or \sqrt[n]{arg}
  out = out.replace(/\\sqrt\s*\{([^{}]+)\}/g, '√($1)');
  out = out.replace(/\\sqrt\[(\d+)\]\s*\{([^{}]+)\}/g, (_m, root, arg) => `${toSuperscript(root)}√(${arg})`);

  // 4. Superscripts: ^{content} or ^char
  out = out.replace(/\^\{([^{}]+)\}/g, (_m, exp) => toSuperscript(exp));
  out = out.replace(/\^([a-zA-Z0-9+\-])/g, (_m, exp) => toSuperscript(exp));

  // 5. Subscripts: _{content} or _char
  out = out.replace(/_\{([^{}]+)\}/g, (_m, sub) => toSubscript(sub));
  out = out.replace(/_([a-zA-Z0-9+\-])/g, (_m, sub) => toSubscript(sub));

  // 6. Common LaTeX mathematical symbols & Greek letters
  for (const [tex, uni] of Object.entries(SYMBOL_MAP)) {
    // Replace with word boundary or non-letter boundary
    const escaped = tex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escaped}(?![a-zA-Z])`, 'g');
    out = out.replace(regex, uni);
  }

  // 7. Spacing commands: \, \: \; \! \quad \qquad
  out = out.replace(/\\(?:quad|qquad)/g, '  ');
  out = out.replace(/\\[,;:!]/g, ' ');

  // 8. Text formatting inside math: \text{...}, \mathbf{...}, \mathit{...}
  out = out.replace(/\\(?:text|mathbf|mathit|mathrm|operatorname)\s*\{([^{}]+)\}/g, '$1');

  // 9. Normalize multiple spaces and bracket padding
  out = out.replace(/\[\s+/g, '[');
  out = out.replace(/\s+\]/g, ']');
  out = out.replace(/\(\s+/g, '(');
  out = out.replace(/\s+\)/g, ')');
  out = out.replace(/[ \t]+/g, ' ').trim();

  return out;
}

/**
 * Scans a full text or message, detects LaTeX delimiters, and converts all math expressions
 * to clean Unicode math notation while preserving general text and plain currency amounts (e.g. $100).
 */
export function formatLatexToUnicodeMath(text: string): string {
  if (!text || typeof text !== 'string') return '';

  let result = text;

  // 1. Multi-line Block Math: $$...$$ or \[...\]
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_match, math) => {
    const formatted = formatLatexMathSegment(math);
    return `\n${formatted}\n`;
  });

  result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_match, math) => {
    const formatted = formatLatexMathSegment(math);
    return `\n${formatted}\n`;
  });

  // 2. Inline Bracket Math: \(...\)
  result = result.replace(/\\\(([\s\S]+?)\\\)/g, (_match, math) => {
    return formatLatexMathSegment(math);
  });

  // 3. Inline Dollar Math: $...$
  // Avoid treating currency like $100 or $5.50 as math
  result = result.replace(/\$(?!\s)([^\$\n]+?)(?<!\s)\$/g, (match, math) => {
    // Check if it's pure numeric currency (e.g. $100, $29.99)
    if (/^\d+(\.\d+)?$/.test(math.trim())) {
      return match;
    }
    return formatLatexMathSegment(math);
  });

  return result;
}
