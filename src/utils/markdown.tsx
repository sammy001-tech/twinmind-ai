import React, { useState } from 'react';
import { Check, Copy, Sparkles, Lightbulb, AlertCircle } from 'lucide-react';
import katex from 'katex';
import { Marked, type Token, type Tokens } from 'marked';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js';
import { classifyContentStructure } from './contentClassifier.ts';

// Initialize configured Marked instance with official KaTeX extension
const markedEngine = new Marked({
  gfm: true,
  breaks: true,
});
markedEngine.use(markedKatex({ throwOnError: false, nonStandard: true }));

/**
 * Validates external URLs for interactive links.
 */
export function isSafeExternalMarkdownUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Safely renders LaTeX math using KaTeX without throwing.
 */
export function renderKaTeXToString(math: string, displayMode: boolean): { html: string; success: boolean } {
  try {
    const html = katex.renderToString(math.trim(), {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: false,
    });
    return { html, success: true };
  } catch {
    return { html: '', success: false };
  }
}

interface CodeBlockProps {
  language: string;
  code: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const highlightedHtml = React.useMemo(() => {
    try {
      const cleanLang = (language || '').trim().toLowerCase();
      if (cleanLang && hljs.getLanguage(cleanLang)) {
        return hljs.highlight(code, { language: cleanLang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return null;
    }
  }, [code, language]);

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable in this browser.');
      }
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <section
      aria-label={language ? language + ' code block' : 'Code block'}
      className="my-4 min-w-0 overflow-hidden rounded-2xl border border-slate-700/80 bg-[#1e1e1e] text-slate-100 shadow-xs dark:border-slate-800 dark:bg-slate-950"
    >
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-slate-700/80 bg-slate-900/90 px-3 sm:px-4">
        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          {language || 'Code'}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label={copyState === 'copied' ? 'Code copied' : 'Copy code'}
          title={copyState === 'failed' ? 'Clipboard access failed' : copyState === 'copied' ? 'Copied' : 'Copy code'}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
        >
          {copyState === 'copied' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span aria-live="polite">{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy code'}</span>
        </button>
      </div>
      <pre className="max-h-[32rem] overflow-auto overscroll-x-contain p-3.5 text-[13px] leading-6 text-slate-100 sm:p-4 font-mono">
        {highlightedHtml ? (
          <code
            className={`hljs font-mono whitespace-pre ${language ? `language-${language}` : ''}`}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <code className="font-mono whitespace-pre">{code}</code>
        )}
      </pre>
    </section>
  );
};

/**
 * Parses and renders epistemic certainty badges [Verified], [Inferred], [Hypothesis], [Unknown]
 */
function renderTextWithEpistemicBadges(text: string, baseKey: string): React.ReactNode[] {
  const parts = text.split(/(\[(?:Verified|Inferred|Hypothesis|Unknown)\])/g);
  return parts.map((part, idx) => {
    const key = `${baseKey}-ep-${idx}`;
    if (part === '[Verified]') {
      return (
        <span key={key} className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 align-middle">
          <Check className="w-3 h-3 text-emerald-500" />
          Verified
        </span>
      );
    }
    if (part === '[Inferred]') {
      return (
        <span key={key} className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 align-middle">
          <Sparkles className="w-3 h-3 text-sky-500" />
          Inferred
        </span>
      );
    }
    if (part === '[Hypothesis]') {
      return (
        <span key={key} className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 align-middle">
          <Lightbulb className="w-3 h-3 text-amber-500" />
          Hypothesis
        </span>
      );
    }
    if (part === '[Unknown]') {
      return (
        <span key={key} className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 align-middle">
          <AlertCircle className="w-3 h-3 text-rose-500" />
          Unknown
        </span>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

/**
 * Traverses Marked AST tokens recursively and converts them into React elements.
 * Eliminates all hardcoded regexes and string prefixes.
 */
function renderAstTokens(tokens: Token[] | undefined, prefix = 'tok'): React.ReactNode[] {
  if (!tokens || tokens.length === 0) return [];

  const nodes: React.ReactNode[] = [];

  tokens.forEach((token, idx) => {
    const key = `${prefix}-${idx}`;

    switch (token.type) {
      case 'space':
        break;

      case 'hr':
        nodes.push(<hr key={key} className="my-4 border-t border-slate-200/80 dark:border-slate-800" />);
        break;

      case 'heading': {
        const hToken = token as Tokens.Heading;
        const depth = Math.min(Math.max(hToken.depth, 1), 6);
        const children = renderAstTokens(hToken.tokens, `${key}-h`);

        switch (depth) {
          case 1:
            nodes.push(<h2 key={key} className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white mt-6 mb-2 tracking-tight break-words">{children}</h2>);
            break;
          case 2:
            nodes.push(<h3 key={key} className="text-base sm:text-lg font-semibold text-slate-950 dark:text-white mt-5 mb-2 tracking-tight border-b border-slate-200/80 dark:border-slate-800 pb-2 break-words">{children}</h3>);
            break;
          case 3:
            nodes.push(<h4 key={key} className="text-sm sm:text-base font-semibold text-amber-700 dark:text-amber-300 mt-4 mb-2 tracking-tight break-words">{children}</h4>);
            break;
          case 4:
            nodes.push(<h5 key={key} className="text-xs sm:text-sm font-bold uppercase tracking-wide text-slate-800 dark:text-slate-200 mt-4 mb-1.5 break-words">{children}</h5>);
            break;
          case 5:
            nodes.push(<h6 key={key} className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mt-3.5 mb-1.5 break-words">{children}</h6>);
            break;
          case 6:
          default:
            nodes.push(<h6 key={key} className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mt-3 mb-1 break-words">{children}</h6>);
            break;
        }
        break;
      }

      case 'code': {
        const cToken = token as Tokens.Code;
        nodes.push(<CodeBlock key={key} language={cToken.lang || ''} code={cToken.text} />);
        break;
      }

      case 'table': {
        const tToken = token as Tokens.Table;
        nodes.push(
          <div key={key} className="my-3 w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain rounded-xl border border-slate-300 bg-white shadow-xs dark:border-slate-700/80 dark:bg-slate-950/70">
            <table className="w-max min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700/70">
              <thead className="bg-slate-100 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200">
                <tr>
                  {tToken.header.map((cell, cIdx) => (
                    <th key={cIdx} className={`min-w-[7rem] max-w-[18rem] whitespace-normal break-words px-3 py-2.5 font-semibold tracking-wide uppercase text-xs ${tToken.align[cIdx] ? `text-${tToken.align[cIdx]}` : 'text-left'}`}>
                      {renderAstTokens(cell.tokens, `${key}-th-${cIdx}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 text-slate-700 dark:text-slate-300">
                {tToken.rows.map((row, rIdx) => (
                  <tr key={rIdx} className={`transition ${rIdx % 2 === 0 ? 'bg-transparent' : 'bg-slate-50 dark:bg-slate-900/40'} hover:bg-slate-100 dark:hover:bg-slate-800/30`}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className={`min-w-[7rem] max-w-[18rem] whitespace-normal break-words px-3 py-2.5 text-[13px] leading-5 ${tToken.align[cIdx] ? `text-${tToken.align[cIdx]}` : 'text-left'}`}>
                        {renderAstTokens(cell.tokens, `${key}-td-${rIdx}-${cIdx}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        break;
      }

      case 'blockquote': {
        const bToken = token as Tokens.Blockquote;
        nodes.push(
          <div key={key} className="my-3.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 sm:p-4 text-slate-800 dark:text-slate-100 shadow-xs backdrop-blur-xs leading-relaxed">
            {renderAstTokens(bToken.tokens, `${key}-bq`)}
          </div>
        );
        break;
      }

      case 'list': {
        const lToken = token as Tokens.List;
        const listItems = lToken.items.map((item, itemIdx) => (
          <li key={`${key}-item-${itemIdx}`} className="my-1 leading-7 text-inherit break-words">
            {renderAstTokens(item.tokens, `${key}-li-${itemIdx}`)}
          </li>
        ));
        if (lToken.ordered) {
          nodes.push(<ol key={key} start={typeof lToken.start === 'number' ? lToken.start : undefined} className="ml-5 list-decimal my-1.5 space-y-1">{listItems}</ol>);
        } else {
          nodes.push(<ul key={key} className="ml-5 list-disc my-1.5 space-y-1">{listItems}</ul>);
        }
        break;
      }

      case 'paragraph': {
        const pToken = token as Tokens.Paragraph;
        // Check if paragraph contains only a block math element
        const pTokens = pToken.tokens || [];
        if (pTokens.length === 1 && ((pTokens[0] as any).type === 'blockKatex' || ((pTokens[0] as any).type === 'inlineKatex' && (pTokens[0] as any).displayMode))) {
          nodes.push(...renderAstTokens(pTokens, `${key}-p`));
        } else {
          nodes.push(
            <div key={key} className="my-1.5 leading-7 text-inherit break-words">
              {renderAstTokens(pToken.tokens, `${key}-p`)}
            </div>
          );
        }
        break;
      }

      case 'strong': {
        const sToken = token as Tokens.Strong;
        nodes.push(
          <strong key={key} className="font-semibold text-slate-950 dark:text-white break-words">
            {renderAstTokens(sToken.tokens, `${key}-st`)}
          </strong>
        );
        break;
      }

      case 'em': {
        const eToken = token as Tokens.Em;
        nodes.push(
          <em key={key} className="italic text-slate-800 dark:text-slate-200 break-words">
            {renderAstTokens(eToken.tokens, `${key}-em`)}
          </em>
        );
        break;
      }

      case 'codespan': {
        const cToken = token as Tokens.Codespan;
        nodes.push(
          <code key={key} className="rounded-md border border-slate-200/80 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.875em] font-medium text-amber-800 break-all whitespace-pre-wrap dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-amber-200">
            {cToken.text}
          </code>
        );
        break;
      }

      case 'link': {
        const lToken = token as Tokens.Link;
        if (isSafeExternalMarkdownUrl(lToken.href)) {
          nodes.push(
            <a
              key={key}
              href={lToken.href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-amber-700 underline decoration-amber-500/40 underline-offset-2 hover:decoration-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 dark:text-amber-300 dark:hover:text-amber-200 break-words"
            >
              {renderAstTokens(lToken.tokens, `${key}-link`)}
            </a>
          );
        } else {
          nodes.push(<span key={key} className="break-words">{renderAstTokens(lToken.tokens, `${key}-link`)}</span>);
        }
        break;
      }

      // Block KaTeX Math ($$...$$)
      case 'blockKatex': {
        const kToken = token as any;
        const { html, success } = renderKaTeXToString(kToken.text, true);
        if (success && html) {
          nodes.push(
            <div
              key={key}
              className="my-3 py-2 px-3 overflow-x-auto overflow-y-hidden text-center rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/60 text-slate-900 dark:text-slate-100 font-sans"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } else {
          nodes.push(<pre key={key} className="my-2 p-2 font-mono text-xs overflow-x-auto text-amber-700 dark:text-amber-300">{kToken.raw}</pre>);
        }
        break;
      }

      // Inline KaTeX Math ($...$ or $$...$$)
      case 'inlineKatex': {
        const kToken = token as any;
        const isDisplay = Boolean(kToken.displayMode);
        const { html, success } = renderKaTeXToString(kToken.text, isDisplay);
        if (success && html) {
          if (isDisplay) {
            nodes.push(
              <div
                key={key}
                className="my-3 py-2 px-3 overflow-x-auto overflow-y-hidden text-center rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800/60 text-slate-900 dark:text-slate-100 font-sans"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          } else {
            nodes.push(
              <span
                key={key}
                className="inline-math px-0.5 font-sans"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }
        } else {
          nodes.push(<span key={key} className="break-words">{kToken.raw}</span>);
        }
        break;
      }

      case 'text': {
        const tToken = token as Tokens.Text;
        if (tToken.tokens && tToken.tokens.length > 0) {
          nodes.push(...renderAstTokens(tToken.tokens, `${key}-txt`));
        } else {
          nodes.push(...renderTextWithEpistemicBadges(tToken.text, key));
        }
        break;
      }

      default: {
        const genericToken = token as any;
        if (genericToken.tokens && Array.isArray(genericToken.tokens)) {
          nodes.push(...renderAstTokens(genericToken.tokens, `${key}-sub`));
        } else if (genericToken.text) {
          nodes.push(...renderTextWithEpistemicBadges(genericToken.text, key));
        }
        break;
      }
    }
  });

  return nodes;
}

/**
 * Normalizes common delimiter boundaries so standard CommonMark / GFM block lexers trigger reliably.
 */
function normalizeMarkdown(text: string): string {
  return text
    .replace(/(^|[^\n])\n\$\$/g, (_m, p1) => `${p1}\n\n$$`)
    .replace(/\$\$\n([^\n]|$)/g, (_m, p1) => `$$\n\n${p1}`)
    .replace(/(^|[^\n])\n---(\n|$)/g, (_m, p1, p2) => `${p1}\n\n---\n${p2}`);
}

export interface MarkdownRenderOptions {
  isMultiPart?: boolean;
}

/**
 * Renders full markdown with KaTeX mathematical formulas, GFM tables, code blocks,
 * epistemic status badges, and headings via standard Marked AST parser without ad-hoc regexes.
 * When isMultiPart is enabled, modular sections are dynamically wrapped in structured containers.
 */
export const renderFormattedMarkdown = (
  text: string,
  options?: MarkdownRenderOptions
): React.ReactNode[] => {
  if (!text) return [];
  const normalized = normalizeMarkdown(text);
  const tokens = markedEngine.lexer(normalized);

  if (options?.isMultiPart) {
    const classified = classifyContentStructure(tokens, normalized);
    if (classified.hasDistinctModules && classified.sections.length > 1) {
      return classified.sections.map((sec, idx) => {
        // Preamble without headings can render directly
        if (sec.type === 'preamble' && !sec.headingToken) {
          return (
            <div key={`section-${sec.id}-${idx}`} className="space-y-2">
              {renderAstTokens(sec.tokens, `sec-${sec.id}`)}
            </div>
          );
        }

        // Modular container with distinct visual padding for structured sections
        return (
          <section
            key={`section-${sec.id}-${idx}`}
            className="my-3.5 rounded-2xl border border-slate-200/90 bg-slate-50/60 p-4 sm:p-5 shadow-xs transition-colors dark:border-slate-800/80 dark:bg-slate-900/40"
          >
            {renderAstTokens(sec.tokens, `sec-${sec.id}`)}
          </section>
        );
      });
    }
  }

  return renderAstTokens(tokens, 'root');
};

/**
 * Renders inline markdown strings (e.g. table headers, bullet points, titles)
 * with KaTeX math and nested formatting via standard AST tokenizer.
 */
export const renderInlineMarkdown = (str: string): React.ReactNode[] => {
  if (!str) return [];
  const normalized = normalizeMarkdown(str);
  const tokens = markedEngine.lexer(normalized);
  // If wrapped in a single paragraph, extract its inline children to avoid unwanted block wrapper
  if (tokens.length === 1 && tokens[0].type === 'paragraph' && (tokens[0] as Tokens.Paragraph).tokens) {
    return renderAstTokens((tokens[0] as Tokens.Paragraph).tokens, 'inline');
  }
  return renderAstTokens(tokens, 'inline');
};

