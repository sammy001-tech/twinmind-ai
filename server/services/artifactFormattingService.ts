import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { Buffer } from 'node:buffer';
import { resolveBoundedIntegerSetting } from '../utils/researchEvidence.ts';

export type ArtifactFormat = 'pdf' | 'md' | 'csv' | 'xlsx';
export type StoredOrBatchArtifactFormat = ArtifactFormat | 'zip';
export type ParsedArtifactContent =
  | { kind: 'table'; headers: string[]; rows: unknown[][]; preamble: string[]; postamble: string[] }
  | { kind: 'document'; text: string };

export interface WorkbookSheetSpec {
  name: string;
  content: ParsedArtifactContent;
}

export interface FormattedArtifact {
  buffer: Buffer;
  type: ArtifactFormat;
  mimeType: string;
  title: string;
  generatedAt: string;
}

export interface BatchArtifactItemInput {
  type: unknown;
  fileName: string;
  content: unknown;
}

export interface ZipArtifactEntryMetadata {
  fileName: string;
  type: ArtifactFormat;
  mimeType: string;
  sizeBytes: number;
}

export interface FormattedZipArtifact {
  buffer: Buffer;
  type: 'zip';
  mimeType: 'application/zip';
  title: string;
  generatedAt: string;
  entries: ZipArtifactEntryMetadata[];
}

const MIME_TYPES: Record<StoredOrBatchArtifactFormat, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

// Fixed styling tokens are presentation rules, not user data or live facts.
const DESIGN = { navy: '183153', accent: 'C78324', ink: '243447', muted: '64748B', border: 'D9E1EA', band: 'F2F6FA', white: 'FFFFFF' };

function titleFromFileName(fileName: string): string {
  const title = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('ARTIFACT_TITLE_REQUIRED');
  return title;
}

export function normalizeArtifactFormat(value: unknown): ArtifactFormat {
  if (typeof value !== 'string') throw new Error('ARTIFACT_FORMAT_REQUIRED');
  const type = value.trim().toLowerCase();
  if (type === 'excel' || type === 'xls' || type === 'xlsx') return 'xlsx';
  if (type === 'pdf' || type === 'md' || type === 'csv') return type;
  throw new Error('UNSUPPORTED_ARTIFACT_FORMAT');
}

function objectToTable(records: unknown[]): ParsedArtifactContent | null {
  if (records.length === 0 || records.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) return null;
  const allRecords = records as Record<string, unknown>[];
  const headers = [...new Set(allRecords.flatMap((record) => Object.keys(record)))];
  if (headers.length === 0 || !headers.some((header) => header.trim())) return null;
  return { kind: 'table', headers, rows: allRecords.map((record) => headers.map((header) => record[header] ?? null)), preamble: [], postamble: [] };
}

function splitMarkdownTableRow(line: string): string[] {
  const source = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  for (const character of source) {
    if (escaped) { cell += character; escaped = false; }
    else if (character === '\\') escaped = true;
    else if (character === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += character;
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 3;
}
function isMarkdownTableSeparator(line: string): boolean {
  return isMarkdownTableRow(line) && splitMarkdownTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')));
}

function parseMarkdownTable(text: string): ParsedArtifactContent | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let headerIndex = -1;
  for (let index = 0; index < lines.length - 1; index++) {
    if (isMarkdownTableRow(lines[index]) && isMarkdownTableSeparator(lines[index + 1])) { headerIndex = index; break; }
  }
  if (headerIndex < 0) return null;
  const headers = splitMarkdownTableRow(lines[headerIndex]);
  if (!headers.length || headers.some((header) => !header.trim())) throw new Error('INVALID_TABLE_HEADER');

  const rows: unknown[][] = [];
  let index = headerIndex + 2;
  for (; index < lines.length && isMarkdownTableRow(lines[index]); index++) {
    const row = splitMarkdownTableRow(lines[index]);
    if (row.length !== headers.length) throw new Error('INCONSISTENT_TABLE_COLUMNS: expected ' + headers.length + ', received ' + row.length);
    rows.push(row);
  }
  return {
    kind: 'table', headers, rows,
    preamble: lines.slice(0, headerIndex).filter((line) => line.trim()),
    postamble: lines.slice(index).filter((line) => line.trim()),
  };
}

function parseJsonTable(text: string): ParsedArtifactContent | null {
  let trimmed = text.trim();
  const fenced = trimmed.match(/^\x60\x60\x60(?:json)?\s*\r?\n([\s\S]*?)\r?\n\x60\x60\x60$/i);
  if (fenced) trimmed = fenced[1].trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('ARTIFACT_JSON_INVALID: structured artifact content contains invalid JSON');
  }

  if (Array.isArray(parsed)) {
    const records = objectToTable(parsed);
    if (records) return records;

    if (parsed.length > 0 && parsed.every((row) => Array.isArray(row))) {
      const [rawHeaders, ...rawRows] = parsed as unknown[][];
      if (!rawHeaders.length || rawHeaders.some((header) => typeof header !== 'string' || !header.trim())) {
        throw new Error('INVALID_TABLE_HEADER');
      }
      const headers = rawHeaders.map((header) => String(header).trim());
      const rows = rawRows.map((row) => {
        if (row.length !== headers.length) {
          throw new Error('INCONSISTENT_TABLE_COLUMNS: expected ' + headers.length + ', received ' + row.length);
        }
        return row;
      });
      return { kind: 'table', headers, rows, preamble: [], postamble: [] };
    }
    return null;
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.headers) && Array.isArray(record.rows)) {
      const headers = record.headers.map((header) => typeof header === 'string' ? header.trim() : '');
      if (!headers.length || headers.some((header) => !header)) throw new Error('INVALID_TABLE_HEADER');

      const rows = record.rows.map((rawRow) => {
        if (Array.isArray(rawRow)) {
          if (rawRow.length !== headers.length) {
            throw new Error('INCONSISTENT_TABLE_COLUMNS: expected ' + headers.length + ', received ' + rawRow.length);
          }
          return rawRow;
        }
        if (rawRow && typeof rawRow === 'object' && !Array.isArray(rawRow)) {
          const row = rawRow as Record<string, unknown>;
          return headers.map((header) => Object.prototype.hasOwnProperty.call(row, header) ? row[header] : null);
        }
        throw new Error('INCONSISTENT_TABLE_COLUMNS: structured rows must be arrays or objects');
      });
      return { kind: 'table', headers, rows, preamble: [], postamble: [] };
    }
  }

  return null;
}

export function parseMultiSheetWorkbookInput(contentInput: unknown): WorkbookSheetSpec[] | null {
  let obj: unknown = contentInput;
  if (typeof contentInput === 'string') {
    let trimmed = contentInput.trim();
    const fenced = trimmed.match(/^\x60\x60\x60(?:json)?\s*\r?\n([\s\S]*?)\r?\n\x60\x60\x60$/i);
    if (fenced) trimmed = fenced[1].trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const record = obj as Record<string, unknown>;
  if (!Array.isArray(record.sheets)) return null;
  if (record.sheets.length === 0) {
    throw new Error('ARTIFACT_WORKBOOK_EMPTY: sheets array must contain at least one worksheet definition.');
  }

  const usedNames = new Set<string>();
  const specs: WorkbookSheetSpec[] = [];
  for (let i = 0; i < record.sheets.length; i++) {
    const rawSheet = record.sheets[i];
    if (!rawSheet || typeof rawSheet !== 'object' || Array.isArray(rawSheet)) {
      throw new Error(`INVALID_WORKSHEET_SPEC: sheet at index ${i} must be an object with name and content/rows.`);
    }
    const sheetObj = rawSheet as Record<string, unknown>;
    const rawName = typeof sheetObj.name === 'string' && sheetObj.name.trim() ? sheetObj.name.trim() : `Sheet ${i + 1}`;
    // Excel worksheet names max 31 chars and cannot contain []:*?/\
    let cleanName = rawName.replace(/[\[\]:*?/\\]/g, '_').slice(0, 31).trim() || `Sheet ${i + 1}`;
    let dedupeIdx = 2;
    while (usedNames.has(cleanName.toLowerCase())) {
      const suffix = `_${dedupeIdx++}`;
      cleanName = cleanName.slice(0, Math.max(1, 31 - suffix.length)) + suffix;
    }
    usedNames.add(cleanName.toLowerCase());

    const sheetPayload = sheetObj.content !== undefined
      ? sheetObj.content
      : (Array.isArray(sheetObj.headers) && Array.isArray(sheetObj.rows))
        ? { headers: sheetObj.headers, rows: sheetObj.rows }
        : Array.isArray(sheetObj.rows)
          ? sheetObj.rows
          : null;

    if (sheetPayload === null) {
      throw new Error(`ARTIFACT_SHEET_CONTENT_REQUIRED: worksheet "${cleanName}" requires content or headers+rows.`);
    }
    const parsedContent = parseArtifactContent(sheetPayload);
    if (parsedContent.kind === 'table' && parsedContent.rows.length === 0) {
      throw new Error(`ARTIFACT_TABLE_EMPTY: worksheet "${cleanName}" contains zero data rows.`);
    }
    specs.push({ name: cleanName, content: parsedContent });
  }
  return specs;
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"' && field.length === 0) quoted = true;
    else if (character === delimiter) { row.push(field.trim()); field = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(field.trim()); field = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (quoted) throw new Error('MALFORMED_DELIMITED_CONTENT: unterminated quoted field');
  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function detectDelimitedTable(text: string): ParsedArtifactContent | null {
  const candidates = [',', '\t', ';'].filter((delimiter) => text.includes(delimiter)).map((delimiter) => {
    const rows = parseDelimited(text, delimiter);
    const widths = rows.map((row) => row.length);
    const consistent = widths.length >= 2 && widths.every((width) => width === widths[0]);
    return { rows, consistent, score: consistent && widths[0] > 1 ? widths[0] * rows.length : 0 };
  }).filter((candidate) => candidate.consistent && candidate.score > 0).sort((a, b) => b.score - a.score);
  const selected = candidates[0];
  if (!selected) return null;
  const [headerRow, ...dataRows] = selected.rows;
  const headers = headerRow.map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error('INVALID_TABLE_HEADER');
  return { kind: 'table', headers, rows: dataRows, preamble: [], postamble: [] };
}

export function parseArtifactContent(content: unknown): ParsedArtifactContent {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>;
    if (Array.isArray(obj.headers) && Array.isArray(obj.rows)) {
      const rawHeaders = obj.headers as unknown[];
      if (!rawHeaders.length || rawHeaders.some((header) => typeof header !== 'string' || !header.trim())) {
        throw new Error('INVALID_TABLE_HEADER');
      }
      const headers = rawHeaders.map((header) => String(header).trim());
      const rows = (obj.rows as unknown[]).map((row) => {
        if (!Array.isArray(row)) {
          if (row && typeof row === 'object') {
            return headers.map((h) => (row as Record<string, unknown>)[h] ?? '');
          }
          throw new Error('INVALID_TABLE_ROW: row must be an array');
        }
        if (row.length !== headers.length) {
          throw new Error('INCONSISTENT_TABLE_COLUMNS: expected ' + headers.length + ', received ' + row.length);
        }
        return row;
      });
      return { kind: 'table', headers, rows, preamble: [], postamble: [] };
    }
    if (Array.isArray(obj.rows)) {
      const table = objectToTable(obj.rows);
      if (table) return table;
    }
  }
  if (Array.isArray(content)) {
    const table = objectToTable(content);
    if (table) return table;
    if (content.length > 0 && content.every((row) => Array.isArray(row))) {
      const [rawHeaders, ...rawRows] = content as unknown[][];
      if (!rawHeaders.length || rawHeaders.some((header) => typeof header !== 'string' || !header.trim())) throw new Error('INVALID_TABLE_HEADER');
      const headers = rawHeaders.map((header) => String(header).trim());
      const rows = rawRows.map((row) => {
        if (row.length !== headers.length) throw new Error('INCONSISTENT_TABLE_COLUMNS: expected ' + headers.length + ', received ' + row.length);
        return row;
      });
      return { kind: 'table', headers, rows, preamble: [], postamble: [] };
    }
    throw new Error('UNSUPPORTED_ARTIFACT_CONTENT: arrays must contain consistent objects or rows with a header row');
  }
  if (typeof content !== 'string') throw new Error('UNSUPPORTED_ARTIFACT_CONTENT: supply non-empty text or structured table data');
  const text = content.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('ARTIFACT_CONTENT_REQUIRED');
  return parseJsonTable(text) || parseMarkdownTable(text) || detectDelimitedTable(text) || { kind: 'document', text };
}

function displayValue(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const serialized = JSON.stringify(value);
  return typeof serialized === 'string' ? serialized : String(value);
}
function safeTextCell(value: unknown): string {
  const text = displayValue(value);
  // Preserve number-shaped text (including negative values) but neutralize strings
  // that spreadsheet software could interpret as formulas.
  if (typeof value !== 'string') return text;
  if (/^[\t\r\n ]*-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(text)) return text;
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? "'" + text : text;
}
function serializeCsv(headers: string[], rows: unknown[][]): string {
  const encode = (value: unknown): string => {
    const text = safeTextCell(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return [headers, ...rows].map((row) => row.map(encode).join(',')).join('\r\n') + '\r\n';
}
function markdownTable(headers: string[], rows: unknown[][]): string {
  const escape = (value: unknown) => displayValue(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  return ['| ' + headers.map(escape).join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |', ...rows.map((row) => '| ' + headers.map((_, index) => escape(row[index])).join(' | ') + ' |')].join('\n');
}
function formatMarkdown(text: string, title: string, generatedAt: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const firstLine = normalized.split('\n').find((line) => line.trim()) || '';
  const alreadyHasLeadingTitle = /^#\s+\S/.test(firstLine.trim());
  const withTitle = alreadyHasLeadingTitle ? normalized : '# ' + title + '\n\n' + normalized;
  const lines = withTitle.split('\n');
  const titleIndex = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (titleIndex >= 0) {
    lines.splice(
      titleIndex + 1,
      0,
      '',
      '*Generated by TwinMind AI · ' + generatedAt + '*',
      '',
      '---',
    );
  }
  const polished = lines.reduce<string[]>((result, line) => {
    const current = line.trimEnd();
    if (!current.trim() && result.length > 0 && !result[result.length - 1].trim()) return result;
    result.push(current);
    return result;
  }, []).join('\n').trim();
  return polished + '\n';
}
function isTableContent(content: ParsedArtifactContent): content is Extract<ParsedArtifactContent, { kind: 'table' }> {
  return content.kind === 'table';
}
function formatCellForExcel(value: unknown): ExcelJS.CellValue {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return displayValue(value);
}
function columnWidth(header: string, values: unknown[]): number {
  const longest = values.reduce<number>((width, value) => Math.max(width, ...displayValue(value).split('\n').map((line) => line.length)), header.length);
  return Math.min(44, Math.max(14, longest + 2));
}

function appendContentWorksheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  content: ParsedArtifactContent,
  title: string,
  generatedAt: string,
): void {
  if (isTableContent(content)) {
    const columnCount = content.headers.length;
    const sheet = workbook.addWorksheet(sheetName, { views: [{ showGridLines: false, state: 'frozen', ySplit: 4, topLeftCell: 'A5' }] });
    sheet.mergeCells(1, 1, 1, columnCount);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { name: 'Aptos Display', size: 20, bold: true, color: { argb: DESIGN.white } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DESIGN.navy } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(1).height = 38;
    sheet.mergeCells(2, 1, 2, columnCount);
    const metadataCell = sheet.getCell(2, 1);
    metadataCell.value = 'Generated by TwinMind AI · ' + generatedAt;
    metadataCell.font = { name: 'Aptos', size: 9, italic: true, color: { argb: DESIGN.muted } };
    metadataCell.alignment = { vertical: 'middle', wrapText: true };
    sheet.getRow(2).height = 22;
    sheet.getRow(3).height = 8;

    const headerRow = sheet.getRow(4);
    content.headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: DESIGN.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DESIGN.accent } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'medium', color: { argb: DESIGN.navy } } };
    });
    headerRow.height = 32;
    content.headers.forEach((header, columnIndex) => {
      sheet.getColumn(columnIndex + 1).width = columnWidth(header, content.rows.map((row) => row[columnIndex]));
    });
    content.rows.forEach((sourceRow, rowIndex) => {
      const row = sheet.getRow(rowIndex + 5);
      content.headers.forEach((_, columnIndex) => {
        const cell = row.getCell(columnIndex + 1), rawValue = sourceRow[columnIndex];
        cell.value = formatCellForExcel(rawValue);
        cell.font = { name: 'Aptos', size: 10, color: { argb: DESIGN.ink } };
        cell.alignment = { vertical: 'top', wrapText: true, horizontal: typeof rawValue === 'number' ? 'right' : 'left' };
        cell.border = { bottom: { style: 'hair', color: { argb: DESIGN.border } } };
        if (rowIndex % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DESIGN.band } };
      });
      row.height = Math.min(90, Math.max(22, ...sourceRow.map((value) => Math.ceil(displayValue(value).length / 52) * 15)));
    });
    if (content.rows.length > 0) sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: content.rows.length + 4, column: columnCount } };
    sheet.pageSetup = {
      orientation: columnCount > 5 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };
    sheet.headerFooter.oddFooter = '&LTwinMind AI&RA Page &P of &N';

    if (content.preamble.length || content.postamble.length) {
      const notesName = sheetName === 'Data' ? 'Context' : `${sheetName.slice(0, 22)}_Context`;
      const notes = workbook.addWorksheet(notesName);
      notes.getColumn(1).width = 110;
      notes.mergeCells('A1:H1');
      notes.getCell('A1').value = 'Context accompanying the data';
      notes.getCell('A1').font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: DESIGN.white } };
      notes.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DESIGN.navy } };
      notes.getCell('A2').value = 'Content retained from the supplied report surrounding its table.';
      notes.getCell('A2').font = { italic: true, size: 9, color: { argb: DESIGN.muted } };
      let rowIndex = 4;
      for (const line of [...content.preamble, ...content.postamble]) {
        const cell = notes.getCell(rowIndex++, 1);
        cell.value = line;
        cell.alignment = { vertical: 'top', wrapText: true };
      }
    }
  } else {
    const sheet = workbook.addWorksheet(sheetName, { views: [{ showGridLines: false }] });
    sheet.getColumn(1).width = 104;
    sheet.mergeCells('A1:H1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = title;
    titleCell.font = { name: 'Aptos Display', size: 20, bold: true, color: { argb: DESIGN.white } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DESIGN.navy } };
    titleCell.alignment = { vertical: 'middle', wrapText: true };
    sheet.getRow(1).height = 40;
    sheet.mergeCells('A2:H2');
    const metadataCell = sheet.getCell('A2');
    metadataCell.value = 'Generated by TwinMind AI · ' + generatedAt;
    metadataCell.font = { name: 'Aptos', size: 9, italic: true, color: { argb: DESIGN.muted } };
    sheet.getRow(2).height = 22;
    sheet.getRow(3).height = 8;

    let rowNumber = 4;
    for (const line of content.text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { rowNumber++; continue; }
      const row = sheet.getRow(rowNumber++), cell = row.getCell(1);
      const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
      const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
      const numbered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
      if (/^---+$/.test(trimmed)) continue;
      if (heading) {
        cell.value = heading[2];
        cell.font = { name: 'Aptos Display', size: heading[1].length === 1 ? 16 : heading[1].length === 2 ? 13 : 11, bold: true, color: { argb: heading[1].length === 1 ? DESIGN.navy : DESIGN.accent } };
        cell.alignment = { vertical: 'middle', wrapText: true };
        row.height = heading[1].length === 1 ? 30 : 24;
      } else {
        cell.value = bullet ? '•  ' + bullet[1] : numbered ? trimmed : trimmed.replace(/\*\*(.*?)\*\*/g, '$1');
        cell.font = { name: 'Aptos', size: 10, color: { argb: DESIGN.ink } };
        cell.alignment = { vertical: 'top', wrapText: true, indent: bullet ? 1 : 0 };
        row.height = Math.min(90, Math.max(21, Math.ceil(String(cell.value).length / 100) * 15));
        cell.border = { bottom: { style: 'hair', color: { argb: DESIGN.border } } };
      }
    }
    sheet.pageSetup = {
      orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9,
      margins: { left: 0.45, right: 0.45, top: 0.65, bottom: 0.65, header: 0.25, footer: 0.25 },
    };
    sheet.headerFooter.oddFooter = '&LTwinMind AI&RA Page &P of &N';
  }
}

async function generateXlsx(
  content: ParsedArtifactContent | WorkbookSheetSpec[],
  title: string,
  generatedAt: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TwinMind AI';
  workbook.created = new Date(generatedAt);
  workbook.modified = new Date(generatedAt);
  workbook.subject = 'Generated artifact';
  workbook.company = 'TwinMind AI';

  if (Array.isArray(content)) {
    for (const sheetSpec of content) {
      appendContentWorksheet(workbook, sheetSpec.name, sheetSpec.content, `${title} — ${sheetSpec.name}`, generatedAt);
    }
  } else {
    appendContentWorksheet(
      workbook,
      isTableContent(content) ? 'Data' : 'Report',
      content,
      title,
      generatedAt,
    );
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const verification = new ExcelJS.Workbook();
  await verification.xlsx.load(buffer);
  if (verification.worksheets.length === 0) throw new Error('ARTIFACT_VALIDATION_FAILED: workbook has no worksheets');
  if (!verification.worksheets.some((worksheet) => worksheet.rowCount > 0)) throw new Error('ARTIFACT_VALIDATION_FAILED: workbook has no rows');
  return buffer;
}

type PdfFontSet = {
  regular: string;
  bold: string;
  italic: string;
  mono: string;
  supportsUnicode: boolean;
};

type PdfBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'blockquote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list-item'; marker: string; text: string }
  | { kind: 'hr' }
  | { kind: 'paragraph'; text: string };

const CANDIDATE_UNICODE_FONT_FAMILIES = [
  {
    regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    italic: '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
    mono: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  },
  {
    regular: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    bold: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    italic: '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf',
    mono: '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
  },
  {
    regular: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    bold: '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    italic: '/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf',
    mono: '/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf',
  },
];

function resolvePdfFonts(doc: InstanceType<typeof PDFDocument>): PdfFontSet {
  for (const family of CANDIDATE_UNICODE_FONT_FAMILIES) {
    try {
      if (fs.existsSync(family.regular) && fs.existsSync(family.bold)) {
        doc.registerFont('TMBodyRegular', family.regular);
        doc.registerFont('TMBodyBold', family.bold);
        const italicFont = fs.existsSync(family.italic) ? family.italic : family.regular;
        const monoFont = fs.existsSync(family.mono) ? family.mono : family.regular;
        doc.registerFont('TMBodyItalic', italicFont);
        doc.registerFont('TMBodyMono', monoFont);
        return {
          regular: 'TMBodyRegular',
          bold: 'TMBodyBold',
          italic: 'TMBodyItalic',
          mono: 'TMBodyMono',
          supportsUnicode: true,
        };
      }
    } catch {
      // Probe next available font family dynamically
    }
  }

  return {
    regular: 'Helvetica',
    bold: 'Helvetica-Bold',
    italic: 'Helvetica-Oblique',
    mono: 'Courier',
    supportsUnicode: false,
  };
}

/**
 * Normalize Unicode symbols for PDF Type-1 WinAnsi fonts when no TTF font is installed.
 * Prevents byte-truncation corruption (for example, >= turning into "e or <= into "d).
 */
export function normalizeTextForWinAnsi(text: string): string {
  return text
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=')
    .replace(/\u2260/g, '!=')
    .replace(/\u2248/g, '~')
    .replace(/\u2192|\u2794|\u279C/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2194/g, '<->')
    .replace(/\u00D7/g, 'x')
    .replace(/\u00F7/g, '/')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, (ch) => {
      if (ch === '\u2013') return '-';
      if (ch === '\u2014') return '--';
      if (ch === '\u2022') return '*';
      return '';
    });
}

function cleanInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(new RegExp(String.fromCharCode(96) + '([^' + String.fromCharCode(96) + ']+)' + String.fromCharCode(96), 'g'), '$1');
}

export function parsePdfDocumentBlocks(text: string): PdfBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: PdfBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    // Fenced code blocks
    const fence = String.fromCharCode(96, 96, 96);
    if (trimmed.startsWith(fence)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && lines[index].trim().startsWith(fence)) {
        index += 1;
      }
      blocks.push({ kind: 'code', text: codeLines.join('\n') });
      continue;
    }

    // Markdown tables (any number of tables anywhere in the document)
    if (
      index + 1 < lines.length &&
      isMarkdownTableRow(lines[index]) &&
      isMarkdownTableSeparator(lines[index + 1])
    ) {
      const headers = splitMarkdownTableRow(lines[index]).map((cell) => cleanInlineMarkdown(cell));
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        const parsedRow = splitMarkdownTableRow(lines[index]);
        const normalizedRow = headers.map((_, colIdx) => cleanInlineMarkdown(parsedRow[colIdx] ?? ''));
        rows.push(normalizedRow);
        index += 1;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }

    // Horizontal divider
    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
      blocks.push({ kind: 'hr' });
      index += 1;
      continue;
    }

    // Headings
    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        text: cleanInlineMarkdown(heading[2]),
      });
      index += 1;
      continue;
    }

    // Blockquotes (group contiguous quote lines)
    if (/^>\s*/.test(trimmed)) {
      const quoteParts: string[] = [];
      while (index < lines.length && /^>\s*/.test(lines[index].trim())) {
        const stripped = lines[index].trim().replace(/^>\s*/, '');
        if (stripped) quoteParts.push(cleanInlineMarkdown(stripped));
        index += 1;
      }
      if (quoteParts.length > 0) {
        blocks.push({ kind: 'blockquote', text: quoteParts.join(' ') });
      }
      continue;
    }

    // Bullet or numbered list items
    const bullet = /^[-*+]\s+(.+)$/.exec(trimmed);
    const numbered = /^(\d+[.)])\s+(.+)$/.exec(trimmed);
    if (bullet || numbered) {
      blocks.push({
        kind: 'list-item',
        marker: numbered ? numbered[1] : '•',
        text: cleanInlineMarkdown((bullet?.[1] ?? numbered?.[2]) || ''),
      });
      index += 1;
      continue;
    }

    // Body paragraph: merge consecutive prose lines so text flows cleanly full-width
    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const curr = lines[index].trim();
      if (
        !curr ||
        curr.startsWith(fence) ||
        /^(?:---+|\*\*\*+|___+)$/.test(curr) ||
        /^(#{1,4})\s+/.test(curr) ||
        /^>\s*/.test(curr) ||
        /^[-*+]\s+/.test(curr) ||
        /^\d+[.)]\s+/.test(curr) ||
        (index + 1 < lines.length && isMarkdownTableRow(lines[index]) && isMarkdownTableSeparator(lines[index + 1]))
      ) {
        break;
      }
      paragraphLines.push(cleanInlineMarkdown(curr));
      index += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraphLines.join(' ') });
    }
  }

  return blocks;
}

function computeDynamicColumnWidths(
  headers: string[],
  rows: unknown[][],
  availableWidth: number,
): number[] {
  const columnCount = headers.length;
  if (columnCount <= 0) return [];
  const minColumnWidth = Math.min(64, availableWidth / columnCount);

  const weights = headers.map((header, colIndex) => {
    const sampleLengths = rows.map((row) => displayValue(row[colIndex]).length).sort((a, b) => a - b);
    const p80Length = sampleLengths.length > 0
      ? sampleLengths[Math.min(sampleLengths.length - 1, Math.floor(sampleLengths.length * 0.8))]
      : 0;
    const effective = Math.max(header.length + 2, Math.min(68, Math.round(p80Length * 0.85) + 4));
    return Math.max(8, effective);
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || columnCount;
  const rawWidths = weights.map((w) => (availableWidth * w) / totalWeight);

  // Enforce readable minimum column width while preserving total availableWidth exactly
  const clamped = rawWidths.map((w) => Math.max(minColumnWidth, w));
  const clampedSum = clamped.reduce((sum, w) => sum + w, 0);
  return clamped.map((w) => (w * availableWidth) / clampedSum);
}

function pdfAddTable(
  doc: InstanceType<typeof PDFDocument>,
  headers: string[],
  rows: unknown[][],
  fonts: PdfFontSet,
  formatText: (s: string) => string,
): void {
  const leftMargin = doc.page.margins.left;
  const availableWidth = doc.page.width - leftMargin - doc.page.margins.right;
  const widths = computeDynamicColumnWidths(headers, rows, availableWidth);
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 10;

  const measureRowHeight = (values: unknown[], header: boolean): { texts: string[]; height: number } => {
    const texts = headers.map((_, columnIndex) => formatText(cleanInlineMarkdown(displayValue(values[columnIndex]))));
    doc.font(header ? fonts.bold : fonts.regular).fontSize(header ? 8.5 : 8);
    const heights = texts.map((text, index) =>
      doc.heightOfString(text || ' ', {
        width: Math.max(20, widths[index] - 10),
        lineGap: 1.5,
      }),
    );
    const height = Math.max(header ? 26 : 20, ...heights.map((item) => item + 10));
    return { texts, height };
  };

  const renderRow = (values: unknown[], header: boolean, rowIndex: number) => {
    const { texts, height } = measureRowHeight(values, header);
    if (doc.y + height > bottomLimit) {
      doc.addPage();
      doc.x = leftMargin;
      if (!header) renderRow(headers, true, -1);
    }

    let x = leftMargin;
    const y = doc.y;
    texts.forEach((text, index) => {
      const width = widths[index];
      const fill = header ? '#' + DESIGN.navy : rowIndex % 2 === 1 ? '#' + DESIGN.band : '#' + DESIGN.white;
      doc.rect(x, y, width, height).fill(fill);
      doc.rect(x, y, width, height).stroke('#' + DESIGN.border);
      doc.font(header ? fonts.bold : fonts.regular)
        .fontSize(header ? 8.5 : 8)
        .fillColor(header ? '#' + DESIGN.white : '#' + DESIGN.ink)
        .text(text, x + 5, y + 5, {
          width: Math.max(20, width - 10),
          lineGap: 1.5,
        });
      x += width;
    });
    // Critical: restore both horizontal and vertical cursor after drawing multi-column cells
    doc.x = leftMargin;
    doc.y = y + height;
  };

  // Ensure table header is not stranded alone at the bottom of a page without at least row 0
  const headerMeasure = measureRowHeight(headers, true);
  const firstRowMeasure = rows.length > 0 ? measureRowHeight(rows[0], false) : { height: 0 };
  if (doc.y + headerMeasure.height + firstRowMeasure.height > bottomLimit) {
    doc.addPage();
    doc.x = leftMargin;
  }

  renderRow(headers, true, -1);
  rows.forEach((row, rowIndex) => renderRow(row, false, rowIndex));
  doc.x = leftMargin;
  doc.moveDown(0.6);
}

async function generatePdf(
  content: ParsedArtifactContent,
  title: string,
  generatedAt: string,
  rawMarkdownSource?: string,
): Promise<Buffer> {
  const document = new PDFDocument({
    size: 'A4',
    margins: { top: 62, right: 44, bottom: 56, left: 44 },
    bufferPages: true,
    info: { Title: title, Author: 'TwinMind AI', Subject: 'Generated document' },
  });
  const fonts = resolvePdfFonts(document);
  const formatText = (input: string): string => (fonts.supportsUnicode ? input : normalizeTextForWinAnsi(input));

  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    document.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  const leftMargin = document.page.margins.left;
  const contentWidth = document.page.width - leftMargin - document.page.margins.right;
  const bottomLimit = document.page.height - document.page.margins.bottom - 10;

  const drawTopRule = () => {
    document.save();
    document.rect(0, 0, document.page.width, 6).fill('#' + DESIGN.accent);
    document.restore();
    document.x = leftMargin;
  };
  document.on('pageAdded', drawTopRule);
  drawTopRule();

  document.y = 36;
  document.x = leftMargin;
  document.font(fonts.bold).fontSize(22).fillColor('#' + DESIGN.navy)
    .text(formatText(title), leftMargin, document.y, { width: contentWidth });
  document.moveDown(0.25);
  document.font(fonts.regular).fontSize(8.5).fillColor('#' + DESIGN.muted)
    .text(formatText('Generated by TwinMind AI · ' + generatedAt), leftMargin, document.y, { width: contentWidth });
  document.moveDown(0.45);
  document.strokeColor('#' + DESIGN.accent).lineWidth(1)
    .moveTo(leftMargin, document.y)
    .lineTo(leftMargin + contentWidth, document.y)
    .stroke();
  document.moveDown(0.85);
  document.x = leftMargin;

  const ensureVerticalSpace = (requiredHeight: number) => {
    if (document.y + requiredHeight > bottomLimit) {
      document.addPage();
      document.x = leftMargin;
    }
  };

  const renderMarkdownBlocks = (rawMarkdown: string) => {
    const blocks = parsePdfDocumentBlocks(rawMarkdown);
    for (let idx = 0; idx < blocks.length; idx++) {
      const block = blocks[idx];
      document.x = leftMargin;

      if (block.kind === 'hr') {
        ensureVerticalSpace(14);
        document.moveDown(0.3);
        document.strokeColor('#' + DESIGN.border).lineWidth(0.7)
          .moveTo(leftMargin, document.y)
          .lineTo(leftMargin + contentWidth, document.y)
          .stroke();
        document.moveDown(0.45);
        document.x = leftMargin;
        continue;
      }

      if (block.kind === 'heading') {
        const fontSize = block.level === 1 ? 16 : block.level === 2 ? 12.5 : 10.5;
        const color = block.level === 1 ? '#' + DESIGN.navy : '#' + DESIGN.accent;
        const text = formatText(block.text);
        document.font(fonts.bold).fontSize(fontSize);
        const h = document.heightOfString(text, { width: contentWidth, lineGap: 2 });
        // Keep heading paired with at least 36pt of subsequent content
        ensureVerticalSpace(h + 36);
        document.moveDown(block.level === 1 ? 0.55 : 0.35);
        document.fillColor(color).text(text, leftMargin, document.y, { width: contentWidth, lineGap: 2 });
        document.moveDown(0.2);
        document.x = leftMargin;
        continue;
      }

      if (block.kind === 'table') {
        pdfAddTable(document, block.headers, block.rows, fonts, formatText);
        continue;
      }

      if (block.kind === 'blockquote') {
        const text = formatText(block.text);
        const indent = 14;
        const quoteWidth = contentWidth - indent - 6;
        document.font(fonts.italic).fontSize(9.5);
        const h = document.heightOfString(text, { width: quoteWidth, lineGap: 2.5 });
        ensureVerticalSpace(Math.min(h, 60));
        const startY = document.y;
        document.fillColor('#' + DESIGN.muted)
          .text(text, leftMargin + indent, startY, { width: quoteWidth, lineGap: 2.5 });
        const endY = document.y;
        if (endY > startY) {
          document.save();
          document.strokeColor('#' + DESIGN.accent).lineWidth(2)
            .moveTo(leftMargin + 4, startY + 2)
            .lineTo(leftMargin + 4, endY - 2)
            .stroke();
          document.restore();
        }
        document.moveDown(0.35);
        document.x = leftMargin;
        continue;
      }

      if (block.kind === 'list-item') {
        const markerText = formatText(block.marker === '•' ? (fonts.supportsUnicode ? '•' : '*') : block.marker);
        const itemText = formatText(block.text);
        const markerWidth = block.marker === '•' ? 12 : Math.max(16, block.marker.length * 6 + 6);
        const textWidth = contentWidth - 10 - markerWidth;
        document.font(fonts.regular).fontSize(9.5);
        const h = document.heightOfString(itemText, { width: textWidth, lineGap: 2.5 });
        ensureVerticalSpace(Math.min(h, 32));
        const rowY = document.y;
        document.fillColor('#' + DESIGN.accent).font(fonts.bold)
          .text(markerText, leftMargin + 10, rowY, { width: markerWidth, lineBreak: false });
        document.fillColor('#' + DESIGN.ink).font(fonts.regular)
          .text(itemText, leftMargin + 10 + markerWidth, rowY, { width: textWidth, lineGap: 2.5 });
        document.moveDown(0.15);
        document.x = leftMargin;
        continue;
      }

      if (block.kind === 'code') {
        const text = formatText(block.text);
        document.font(fonts.mono).fontSize(8);
        const h = document.heightOfString(text || ' ', { width: contentWidth - 16, lineGap: 1.5 });
        ensureVerticalSpace(Math.min(h + 12, 80));
        document.fillColor('#' + DESIGN.ink)
          .text(text, leftMargin + 8, document.y, { width: contentWidth - 16, lineGap: 1.5 });
        document.moveDown(0.35);
        document.x = leftMargin;
        continue;
      }

      // Paragraph
      const text = formatText(block.text);
      document.font(fonts.regular).fontSize(9.5);
      const h = document.heightOfString(text, { width: contentWidth, lineGap: 3 });
      ensureVerticalSpace(Math.min(h, 36));
      document.fillColor('#' + DESIGN.ink)
        .text(text, leftMargin, document.y, { width: contentWidth, lineGap: 3 });
      document.moveDown(0.35);
      document.x = leftMargin;
    }
  };

  if (rawMarkdownSource) {
    renderMarkdownBlocks(rawMarkdownSource);
  } else if (isTableContent(content)) {
    if (content.preamble.length) renderMarkdownBlocks(content.preamble.join('\n'));
    pdfAddTable(document, content.headers, content.rows, fonts, formatText);
    if (content.postamble.length) {
      document.moveDown(0.3);
      renderMarkdownBlocks(content.postamble.join('\n'));
    }
  } else {
    renderMarkdownBlocks(content.text);
  }

  const pageRange = document.bufferedPageRange();
  for (let index = pageRange.start; index < pageRange.start + pageRange.count; index++) {
    document.switchToPage(index);
    const savedBottomMargin = document.page.margins.bottom;
    // Prevent PDFKit from spawning phantom blank pages when drawing footer text below content margin
    document.page.margins.bottom = 0;
    document.font(fonts.regular).fontSize(7.5).fillColor('#' + DESIGN.muted).text(
      formatText('TwinMind AI · ' + title + ' · Page ' + (index + 1) + ' of ' + pageRange.count),
      document.page.margins.left,
      document.page.height - 32,
      {
        width: document.page.width - document.page.margins.left - document.page.margins.right,
        align: 'center',
        lineBreak: false,
      },
    );
    document.page.margins.bottom = savedBottomMargin;
  }
  document.end();
  const buffer = await output;
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('ARTIFACT_VALIDATION_FAILED: generated PDF signature is invalid');
  return buffer;
}

export async function generateArtifactBuffer(
  formatInput: unknown,
  contentInput: unknown,
  fileName: string,
  generatedAtValue = new Date(),
): Promise<FormattedArtifact> {
  const type = normalizeArtifactFormat(formatInput);
  if (typeof fileName !== 'string' || !fileName.trim()) throw new Error('ARTIFACT_FILENAME_REQUIRED');
  const title = titleFromFileName(fileName);
  const generatedAt = generatedAtValue.toISOString();

  if (type === 'xlsx') {
    const multiSheets = parseMultiSheetWorkbookInput(contentInput);
    if (multiSheets) {
      const buffer = await generateXlsx(multiSheets, title, generatedAt);
      if (buffer.length === 0) throw new Error('ARTIFACT_VALIDATION_FAILED: generated workbook is empty');
      return { buffer, type, mimeType: MIME_TYPES[type], title, generatedAt };
    }
  }

  const content = parseArtifactContent(contentInput);
  if ((type === 'csv' || type === 'xlsx') && content.kind !== 'table') {
    throw new Error('ARTIFACT_TABULAR_DATA_REQUIRED: provide structured records or a table with source-provided headers and at least one data row');
  }
  if (content.kind === 'table' && content.headers.length === 0) throw new Error('ARTIFACT_TABLE_HEADERS_REQUIRED');
  if (content.kind === 'table' && content.rows.length === 0) {
    throw new Error('ARTIFACT_TABLE_EMPTY: no data rows were supplied; no empty dataset was presented as a completed artifact');
  }

  let buffer: Buffer;
  if (type === 'md') {
    const markdown = isTableContent(content)
      ? [content.preamble.join('\n'), markdownTable(content.headers, content.rows), content.postamble.join('\n')].filter((section) => section.trim()).join('\n\n')
      : content.text;
    buffer = Buffer.from(formatMarkdown(markdown, title, generatedAt), 'utf8');
  } else if (type === 'csv') {
    if (isTableContent(content)) {
      const hasContext = content.preamble.length > 0 || content.postamble.length > 0;
      if (hasContext) {
        const headers = ['Record Type', 'Context', ...content.headers];
        const contextRows = [
          ...content.preamble.map((line) => ['Context', line, ...content.headers.map(() => '')]),
          ...content.postamble.map((line) => ['Context', line, ...content.headers.map(() => '')]),
        ];
        const dataRows = content.rows.map((row) => ['Data', '', ...row]);
        buffer = Buffer.from('\uFEFF' + serializeCsv(headers, [...contextRows, ...dataRows]), 'utf8');
      } else {
        buffer = Buffer.from('\uFEFF' + serializeCsv(content.headers, content.rows), 'utf8');
      }
    } else {
      buffer = Buffer.from('\uFEFF' + serializeCsv(['Content'], content.text.split('\n').map((line) => [line])), 'utf8');
    }
  } else if (type === 'xlsx') {
    buffer = await generateXlsx(content, title, generatedAt);
  } else {
    const rawMarkdown = typeof contentInput === 'string' && parseMarkdownTable(contentInput.replace(/\r\n?/g, '\n').trim())
      ? contentInput.replace(/\r\n?/g, '\n').trim()
      : undefined;
    buffer = await generatePdf(content, title, generatedAt, rawMarkdown);
  }

  if (buffer.length === 0) throw new Error('ARTIFACT_VALIDATION_FAILED: generated file is empty');
  if (type === 'md' && !buffer.toString('utf8').trim()) throw new Error('ARTIFACT_VALIDATION_FAILED: Markdown document has no content');
  if (type === 'csv' && !buffer.toString('utf8').replace(/^\uFEFF/, '').trim()) throw new Error('ARTIFACT_VALIDATION_FAILED: CSV has no content');
  return { buffer, type, mimeType: MIME_TYPES[type], title, generatedAt };
}

function sanitizeBatchEntryFileName(rawName: unknown, format: ArtifactFormat): string {
  if (typeof rawName !== 'string' || !rawName.trim()) {
    throw new Error('ARTIFACT_FILENAME_REQUIRED');
  }
  const trimmed = rawName.trim();
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    throw new Error(`INVALID_BATCH_ENTRY_FILENAME: Path traversal characters are disallowed in "${trimmed}".`);
  }
  const withoutExt = trimmed.replace(/\.(pdf|csv|xlsx|xls|md)$/i, '');
  const safeStem = withoutExt.replace(/[^a-z0-9._-]/gi, '_').replace(/^[._-]+|[._-]+$/g, '');
  if (!safeStem) {
    throw new Error(`INVALID_BATCH_ENTRY_FILENAME: "${trimmed}" contains no valid filename characters.`);
  }
  return `${safeStem}.${format}`;
}

export async function generateZipArtifactBundle(
  items: BatchArtifactItemInput[],
  archiveFileName: string,
  generatedAtValue = new Date(),
): Promise<FormattedZipArtifact> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('BATCH_ITEMS_REQUIRED: Provide at least one artifact item to bundle.');
  }
  const maxBatchFiles = resolveBoundedIntegerSetting(process.env, 'TWINMIND_ARTIFACT_BATCH_MAX_FILES', 15, 1, 50);
  if (items.length > maxBatchFiles) {
    throw new Error(`BATCH_LIMIT_EXCEEDED: Requested ${items.length} artifacts, exceeding configured batch cap of ${maxBatchFiles}.`);
  }
  if (typeof archiveFileName !== 'string' || !archiveFileName.trim()) {
    throw new Error('ARTIFACT_FILENAME_REQUIRED');
  }

  const title = titleFromFileName(archiveFileName);
  const generatedAt = generatedAtValue.toISOString();
  const zip = new JSZip();
  const usedEntryNames = new Set<string>();
  const entries: ZipArtifactEntryMetadata[] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (!item || typeof item !== 'object') {
      throw new Error(`INVALID_BATCH_ITEM: Item at index ${idx} must be an object.`);
    }
    const format = normalizeArtifactFormat(item.type);
    let safeEntryName = sanitizeBatchEntryFileName(item.fileName, format);
    if (usedEntryNames.has(safeEntryName.toLowerCase())) {
      const stem = safeEntryName.replace(/\.[^.]+$/, '');
      safeEntryName = `${stem}_${idx + 1}.${format}`;
    }
    usedEntryNames.add(safeEntryName.toLowerCase());

    const generated = await generateArtifactBuffer(format, item.content, safeEntryName, generatedAtValue);
    zip.file(safeEntryName, generated.buffer);
    entries.push({
      fileName: safeEntryName,
      type: format,
      mimeType: generated.mimeType,
      sizeBytes: generated.buffer.length,
    });
  }

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  if (!zipBuffer || zipBuffer.length === 0) {
    throw new Error('ARTIFACT_VALIDATION_FAILED: generated zip bundle is empty');
  }

  // Re-open archive to verify integrity and entry count match before returning
  const verificationZip = await JSZip.loadAsync(zipBuffer);
  const verifiedNames = Object.keys(verificationZip.files).filter((name) => !verificationZip.files[name].dir);
  if (verifiedNames.length !== entries.length) {
    throw new Error(`ARTIFACT_VALIDATION_FAILED: zip verification expected ${entries.length} files, found ${verifiedNames.length}`);
  }

  return {
    buffer: zipBuffer,
    type: 'zip',
    mimeType: 'application/zip',
    title,
    generatedAt,
    entries,
  };
}

