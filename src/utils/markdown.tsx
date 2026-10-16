import React from 'react';

// Render inline bold, italic, and code formatting
export const renderInlineMarkdown = (str: string): React.ReactNode => {
  const parts = str.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-slate-900 dark:text-white break-words">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i} className="italic text-slate-800 dark:text-slate-200 break-words">{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-black/30 font-mono text-xs text-amber-700 dark:text-amber-300 break-all whitespace-pre-wrap">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i} className="break-words">{part}</span>;
  });
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
        <div key={`code-${i}`} className="my-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 overflow-hidden font-mono text-xs shadow-md">
          {lang && (
            <div className="px-3 py-1 bg-slate-200 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 text-[10px] text-amber-700 dark:text-amber-400 font-semibold uppercase tracking-wider">
              {lang}
            </div>
          )}
          <pre className="p-3 whitespace-pre-wrap break-all text-slate-800 dark:text-amber-200/90 leading-relaxed font-mono text-[12px]">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>
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
          className="my-3 overflow-x-auto rounded-xl border border-slate-300 dark:border-slate-700/80 bg-white dark:bg-slate-950/70 shadow-md"
        >
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700/70 text-xs">
            <thead className="bg-slate-100 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200">
              <tr>
                {headers.map((h, colIdx) => (
                  <th
                    key={colIdx}
                    className={`px-3 py-2 font-bold tracking-wide uppercase text-[11px] ${
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
                      className={`px-3 py-2 text-xs leading-relaxed ${
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
        <h4 key={`h4-${i}`} className="text-xs sm:text-sm font-bold text-amber-600 dark:text-amber-300 mt-2.5 mb-1 tracking-wide break-words">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h4>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-sm sm:text-base font-bold text-slate-900 dark:text-white mt-3 mb-1.5 tracking-tight border-b border-slate-200 dark:border-slate-800 pb-1 break-words">
          {renderInlineMarkdown(trimmed.slice(3))}
        </h3>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-3.5 mb-1.5 tracking-tight break-words">
          {renderInlineMarkdown(trimmed.slice(2))}
        </h2>
      );
      i++;
      continue;
    }

    // 4. Bullet list items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <li key={`li-${i}`} className="ml-4 list-disc my-0.5 leading-relaxed text-inherit break-words">
          {renderInlineMarkdown(trimmed.slice(2))}
        </li>
      );
      i++;
      continue;
    }

    // 5. Numbered list items
    if (/^\d+\.\s/.test(trimmed)) {
      elements.push(
        <li key={`ol-${i}`} className="ml-4 list-decimal my-0.5 leading-relaxed text-inherit break-words">
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
      <p key={`p-${i}`} className="my-1 leading-relaxed text-inherit break-words">
        {renderInlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return elements;
};

