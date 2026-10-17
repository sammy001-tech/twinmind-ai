import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * Only absolute HTTP(S) links are interactive. This keeps Markdown labels readable
 * without making javascript:, data:, or protocol-relative URLs navigable.
 */
export function isSafeExternalMarkdownUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export const renderInlineMarkdown = (str: string): React.ReactNode => {
  const parts = str.split(/(\[[^\]]+\]\([^)]+\)|\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
  return parts.map((part, i) => {
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, url] = linkMatch;
      return isSafeExternalMarkdownUrl(url)
        ? (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-amber-700 underline decoration-amber-500/40 underline-offset-2 hover:decoration-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 dark:text-amber-300 dark:hover:text-amber-200 break-words"
          >
            {label}
          </a>
        )
        : <span key={i} className="break-words">{label}</span>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-slate-950 dark:text-white break-words">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i} className="italic text-slate-800 dark:text-slate-200 break-words">{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded-md border border-slate-200/80 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.875em] font-medium text-amber-800 break-all whitespace-pre-wrap dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-amber-200">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i} className="break-words">{part}</span>;
  });
};

interface CodeBlockProps {
  language: string;
  code: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

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
    <section aria-label={language ? language + ' code block' : 'Code block'} className="my-4 min-w-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-950/90">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-slate-200/90 bg-slate-50 px-3 sm:px-4 dark:border-slate-800 dark:bg-slate-900/90">
        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
          {language || 'Code'}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label={copyState === 'copied' ? 'Code copied' : 'Copy code'}
          title={copyState === 'failed' ? 'Clipboard access failed' : copyState === 'copied' ? 'Copied' : 'Copy code'}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          {copyState === 'copied' ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span aria-live="polite">{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy code'}</span>
        </button>
      </div>
      <pre className="max-h-[32rem] overflow-auto overscroll-x-contain p-3.5 text-[13px] leading-6 text-slate-800 sm:p-4 dark:text-slate-100">
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
    </section>
  );
};

// Render message body with full markdown formatting (including proper tables, headers, code blocks, lists)
export const renderFormattedMarkdown = (text: string): React.ReactNode[] => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  const isTableRow = (line: string) => {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 3;
  };

  const isTableSeparator = (line: string) => {
    const trimmed = line.trim();
    if (!isTableRow(trimmed)) return false;
    const inner = trimmed.slice(1, -1).split('|');
    return inner.every((cell) => /^[\s:-]+$/.test(cell.trim()) && cell.includes('-'));
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Code Block: ```lang ... ```
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++; // skip closing ```
      }
      elements.push(
        <CodeBlock key={`code-${i}`} language={lang} code={codeLines.join('\n')} />
      );
      continue;
    }

    // 2. Markdown Table Detection
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerRow = trimmed;
      const separatorRow = lines[i + 1].trim();
      i += 2;

      const headers = headerRow
        .slice(1, -1)
        .split('|')
        .map((h) => h.trim());

      const separatorCells = separatorRow
        .slice(1, -1)
        .split('|')
        .map((s) => s.trim());

      const alignments = separatorCells.map((s) => {
        if (s.startsWith(':') && s.endsWith(':')) return 'center';
        if (s.endsWith(':')) return 'right';
        return 'left';
      });

      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        const rowCells = lines[i]
          .trim()
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        rows.push(rowCells);
        i++;
      }

      elements.push(
        <div
          key={`table-${i}`}
          className="my-3 w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain rounded-xl border border-slate-300 bg-white shadow-md dark:border-slate-700/80 dark:bg-slate-950/70"
        >
          <table className="w-max min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700/70">
            <thead className="bg-slate-100 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200">
              <tr>
                {headers.map((h, colIdx) => (
                  <th
                    key={colIdx}
                    className={`min-w-[7rem] max-w-[18rem] whitespace-normal break-words px-3 py-2.5 font-semibold tracking-wide uppercase text-xs ${
                      alignments[colIdx] === 'center'
                        ? 'text-center'
                        : alignments[colIdx] === 'right'
                        ? 'text-right'
                        : 'text-left'
                    }`}
                  >
                    {renderInlineMarkdown(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 text-slate-700 dark:text-slate-300">
              {rows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className={`transition ${
                    rIdx % 2 === 0 ? 'bg-transparent' : 'bg-slate-50 dark:bg-slate-900/40'
                  } hover:bg-slate-100 dark:hover:bg-slate-800/30`}
                >
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className={`min-w-[7rem] max-w-[18rem] whitespace-normal break-words px-3 py-2.5 text-[13px] leading-5 ${
                        alignments[cIdx] === 'center'
                          ? 'text-center'
                          : alignments[cIdx] === 'right'
                          ? 'text-right'
                          : 'text-left'
                      }`}
                    >
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 3. Headings
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={`h4-${i}`} className="text-sm sm:text-base font-semibold text-amber-700 dark:text-amber-300 mt-4 mb-2 tracking-tight break-words">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h4>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-base sm:text-lg font-semibold text-slate-950 dark:text-white mt-5 mb-2 tracking-tight border-b border-slate-200/80 dark:border-slate-800 pb-2 break-words">
          {renderInlineMarkdown(trimmed.slice(3))}
        </h3>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-lg sm:text-xl font-semibold text-slate-950 dark:text-white mt-6 mb-2 tracking-tight break-words">
          {renderInlineMarkdown(trimmed.slice(2))}
        </h2>
      );
      i++;
      continue;
    }

    // 4. Bullet list items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <li key={`li-${i}`} className="ml-5 list-disc my-1 leading-7 text-inherit break-words">
          {renderInlineMarkdown(trimmed.slice(2))}
        </li>
      );
      i++;
      continue;
    }

    // 5. Numbered list items
    if (/^\d+\.\s/.test(trimmed)) {
      elements.push(
        <li key={`ol-${i}`} className="ml-5 list-decimal my-1 leading-7 text-inherit break-words">
          {renderInlineMarkdown(trimmed.replace(/^\d+\.\s/, ''))}
        </li>
      );
      i++;
      continue;
    }

    // 6. Blank lines
    if (!trimmed) {
      elements.push(<div key={`blank-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // 7. Normal paragraphs
    elements.push(
      <p key={`p-${i}`} className="my-1.5 leading-7 text-inherit break-words">
        {renderInlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return elements;
};

