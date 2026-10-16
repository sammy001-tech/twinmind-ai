export type ArtifactCell = string | number | boolean | null;

export interface ParsedArtifactTable {
  headers: string[];
  rows: ArtifactCell[][];
}

function dataRequired(): Error {
  return new Error(
    'ARTIFACT_TABULAR_DATA_REQUIRED: provide structured records, a Markdown table, TSV, or CSV with headers and at least one data row.',
  );
}

function cellValue(value: unknown): ArtifactCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  const serialized = JSON.stringify(value);
  return typeof serialized === 'string' ? serialized : String(value);
}

function validateTable(headersInput: unknown[], rowsInput: unknown[][]): ParsedArtifactTable {
  const headers = headersInput.map((value) =>
    typeof value === 'string' ? value.trim() : String(value ?? '').trim(),
  );

  if (headers.length === 0 || headers.some((header) => !header)) {
    throw new Error(
      'ARTIFACT_COLUMN_HEADER_MISSING: every spreadsheet column must have a source-provided header.',
    );
  }
  if (rowsInput.length === 0) throw dataRequired();

  const rows = rowsInput.map((row) => {
    if (!Array.isArray(row) || row.length !== headers.length) {
      throw new Error(
        'ARTIFACT_TABLE_SHAPE_INVALID: each data row must match the number of source headers.',
      );
    }
    return row.map(cellValue);
  });

  if (!rows.some((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''))) {
    throw dataRequired();
  }

  return { headers, rows };
}

function parseObjectRows(value: unknown[]): ParsedArtifactTable {
  if (value.length === 0 || !value.every(
    (item) => item !== null && typeof item === 'object' && !Array.isArray(item),
  )) {
    throw dataRequired();
  }

  const records = value as Record<string, unknown>[];
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  if (headers.length === 0) throw dataRequired();

  return validateTable(
    headers,
    records.map((record) => headers.map((header) => record[header])),
  );
}

function parseArrayRows(value: unknown[]): ParsedArtifactTable {
  if (value.length < 2 || !Array.isArray(value[0])) throw dataRequired();
  const headers = value[0] as unknown[];
  if (headers.some((header) => typeof header !== 'string')) {
    throw new Error(
      'ARTIFACT_COLUMN_HEADER_MISSING: the first row must contain source-provided text headers.',
    );
  }
  return validateTable(headers, value.slice(1) as unknown[][]);
}

function parseJsonStructure(value: unknown): ParsedArtifactTable | null {
  if (Array.isArray(value)) {
    if (value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
      return parseObjectRows(value);
    }
    if (value.every(Array.isArray)) return parseArrayRows(value);
    return null;
  }

  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const headers = record.headers;
  const rows = record.rows;

  if (Array.isArray(headers) && Array.isArray(rows)) {
    if (rows.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) {
      const headerNames = headers.map((header) => String(header ?? '').trim());
      const objects = rows as Record<string, unknown>[];
      return validateTable(headerNames, objects.map((row) => headerNames.map((name) => row[name])));
    }
    if (rows.every(Array.isArray)) {
      return validateTable(headers, rows as unknown[][]);
    }
    throw new Error('ARTIFACT_TABLE_SHAPE_INVALID: rows must be arrays or records.');
  }

  return null;
}

function splitMarkdownRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith('|')) source = source.slice(1);
  if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);

  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function isMarkdownSeparator(line: string): boolean {
  const cells = splitMarkdownRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdownTable(content: string): ParsedArtifactTable | null {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index + 2 < lines.length; index += 1) {
    const headerLine = lines[index].trim();
    const separatorLine = lines[index + 1].trim();
    if (!headerLine.includes('|') || !separatorLine.includes('|') || !isMarkdownSeparator(separatorLine)) {
      continue;
    }

    const headers = splitMarkdownRow(headerLine);
    const expectedColumns = headers.length;
    const rows: unknown[][] = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex].trim();
      if (!line || !line.includes('|')) break;
      const cells = splitMarkdownRow(line);
      if (cells.length !== expectedColumns) {
        throw new Error(
          'ARTIFACT_TABLE_SHAPE_INVALID: a Markdown row does not match its header width.',
        );
      }
      rows.push(cells);
    }

    return validateTable(headers, rows);
  }
  return null;
}

function parseDelimitedText(content: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === '"') {
      if (inQuotes && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (inQuotes) {
        inQuotes = false;
      } else if (cell.trim() === '') {
        inQuotes = true;
      } else {
        throw new Error('ARTIFACT_DELIMITED_DATA_INVALID: unexpected quote in an unquoted field.');
      }
      continue;
    }

    if (!inQuotes && character === delimiter) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if (!inQuotes && (character === '\n' || character === '\r')) {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += character;
  }

  if (inQuotes) {
    throw new Error('ARTIFACT_DELIMITED_DATA_INVALID: an escaped quoted field was not closed.');
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

/**
 * Parse only explicit tabular source data. It deliberately refuses to fabricate
 * headers, rows, or placeholder columns when the model gives prose or empty output.
 */
export function parseArtifactTableContent(content: unknown): ParsedArtifactTable {
  if (Array.isArray(content)) {
    const structured = parseJsonStructure(content);
    if (structured) return structured;
  }

  if (content && typeof content === 'object') {
    const structured = parseJsonStructure(content);
    if (structured) return structured;
  }

  if (typeof content !== 'string' || !content.trim()) throw dataRequired();
  let trimmed = content.trim();
  const fencedLines = trimmed.split(/\r?\n/);
  if (
    fencedLines.length >= 3 &&
    /^\x60{3}(?:json|csv|tsv|markdown|md)?\s*$/i.test(fencedLines[0].trim()) &&
    /^\x60{3}\s*$/.test(fencedLines[fencedLines.length - 1].trim())
  ) {
    trimmed = fencedLines.slice(1, -1).join('\n').trim();
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('ARTIFACT_JSON_INVALID: structured artifact content contains invalid JSON.');
    }
    const structured = parseJsonStructure(parsed);
    if (structured) return structured;
    if (typeof parsed === 'string') return parseArtifactTableContent(parsed);
    throw dataRequired();
  }

  const markdown = parseMarkdownTable(trimmed);
  if (markdown) return markdown;

  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  if (firstLine.includes('\t')) {
    const rows = parseDelimitedText(trimmed, '\t');
    if (rows.length < 2) throw dataRequired();
    return validateTable(rows[0], rows.slice(1));
  }

  if (firstLine.includes(',')) {
    const rows = parseDelimitedText(trimmed, ',');
    if (rows.length < 2) throw dataRequired();
    return validateTable(rows[0], rows.slice(1));
  }

  throw dataRequired();
}

function toCsvCell(value: ArtifactCell): string {
  if (value === null) return '';
  // CSV opened directly in spreadsheet software can execute formula-like cells.
  // Preserve numeric types while neutralizing formula syntax in source text.
  const rawText = String(value);
  const text = typeof value === 'string' && /^[\t\r\n ]*[=+@-]/.test(rawText)
    ? `'${rawText}`
    : rawText;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeArtifactCsv(table: ParsedArtifactTable): string {
  return [
    table.headers.map(toCsvCell).join(','),
    ...table.rows.map((row) => row.map(toCsvCell).join(',')),
  ].join('\r\n');
}
