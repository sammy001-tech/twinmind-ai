import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { Buffer } from 'node:buffer';

export type ArtifactFormat = 'pdf' | 'md' | 'csv' | 'xlsx';
export type ParsedArtifactContent =
  | { kind: 'table'; headers: string[]; rows: unknown[][]; preamble: string[]; postamble: string[] }
  | { kind: 'document'; text: string };

export interface FormattedArtifact {
  buffer: Buffer;
  type: ArtifactFormat;
  mimeType: string;
  title: string;
  generatedAt: string;
}

const MIME_TYPES: Record<ArtifactFormat, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

async function generateXlsx(content: ParsedArtifactContent, title: string, generatedAt: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TwinMind AI';
  workbook.created = new Date(generatedAt);
  workbook.modified = new Date(generatedAt);
  workbook.subject = 'Generated artifact';
  workbook.company = 'TwinMind AI';

  if (isTableContent(content)) {
    const columnCount = content.headers.length;
    const sheet = workbook.addWorksheet('Data', { views: [{ showGridLines: false, state: 'frozen', ySplit: 4, topLeftCell: 'A5' }] });
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
      const notes = workbook.addWorksheet('Context');
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
    const sheet = workbook.addWorksheet('Report', { views: [{ showGridLines: false }] });
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

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const verification = new ExcelJS.Workbook();
  await verification.xlsx.load(buffer);
  if (verification.worksheets.length === 0) throw new Error('ARTIFACT_VALIDATION_FAILED: workbook has no worksheets');
  if (!verification.worksheets.some((worksheet) => worksheet.rowCount > 0)) throw new Error('ARTIFACT_VALIDATION_FAILED: workbook has no rows');
  return buffer;
}

function cleanInlineMarkdown(text: string): string {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(new RegExp(String.fromCharCode(96) + '([^' + String.fromCharCode(96) + ']+)' + String.fromCharCode(96), 'g'), '$1');
}

function pdfAddTable(doc: InstanceType<typeof PDFDocument>, headers: string[], rows: unknown[][]): void {
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const weights = headers.map((header) => Math.max(8, Math.min(26, header.length + 2)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => availableWidth * weight / totalWeight);

  const renderRow = (values: unknown[], header: boolean, rowIndex: number) => {
    const texts = headers.map((_, columnIndex) => displayValue(values[columnIndex]));
    doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8 : 7.5);
    const heights = texts.map((text, index) => doc.heightOfString(text || ' ', { width: Math.max(24, widths[index] - 10), lineGap: 1 }));
    const height = Math.max(header ? 28 : 22, ...heights.map((item) => item + 10));
    const bottom = doc.page.height - doc.page.margins.bottom - 12;
    if (doc.y + height > bottom) {
      doc.addPage();
      if (!header) renderRow(headers, true, -1);
    }

    let x = doc.page.margins.left;
    const y = doc.y;
    texts.forEach((text, index) => {
      const width = widths[index];
      const fill = header ? '#' + DESIGN.navy : rowIndex % 2 === 1 ? '#' + DESIGN.band : '#' + DESIGN.white;
      doc.rect(x, y, width, height).fill(fill);
      doc.rect(x, y, width, height).stroke('#' + DESIGN.border);
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8 : 7.5)
        .fillColor(header ? '#' + DESIGN.white : '#' + DESIGN.ink)
        .text(text, x + 5, y + 5, { width: Math.max(24, width - 10), height: height - 8, lineGap: 1 });
      x += width;
    });
    doc.y = y + height;
  };
  renderRow(headers, true, -1);
  rows.forEach((row, rowIndex) => renderRow(row, false, rowIndex));
  doc.moveDown(0.5);
}

async function generatePdf(content: ParsedArtifactContent, title: string, generatedAt: string): Promise<Buffer> {
  const document = new PDFDocument({
    size: 'A4', margins: { top: 66, right: 44, bottom: 58, left: 44 }, bufferPages: true,
    info: { Title: title, Author: 'TwinMind AI', Subject: 'Generated document' },
  });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    document.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
  const drawTopRule = () => {
    document.save();
    document.rect(0, 0, document.page.width, 6).fill('#' + DESIGN.accent);
    document.restore();
  };
  document.on('pageAdded', drawTopRule);
  drawTopRule();
  document.y = 36;
  document.font('Helvetica-Bold').fontSize(23).fillColor('#' + DESIGN.navy).text(title, { width: document.page.width - document.page.margins.left - document.page.margins.right });
  document.moveDown(0.25);
  document.font('Helvetica').fontSize(8.5).fillColor('#' + DESIGN.muted).text('Generated by TwinMind AI · ' + generatedAt);
  document.moveDown(0.5);
  document.strokeColor('#' + DESIGN.accent).lineWidth(1).moveTo(document.page.margins.left, document.y)
    .lineTo(document.page.width - document.page.margins.right, document.y).stroke();
  document.moveDown(1);

  const renderMarkdownDocument = (text: string) => {
    let inCodeBlock = false;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { document.moveDown(0.35); continue; }
      if (trimmed.startsWith(String.fromCharCode(96, 96, 96))) { inCodeBlock = !inCodeBlock; continue; }
      if (/^---+$/.test(trimmed)) {
        document.moveDown(0.4);
        document.strokeColor('#' + DESIGN.border).lineWidth(0.7).moveTo(document.page.margins.left, document.y)
          .lineTo(document.page.width - document.page.margins.right, document.y).stroke();
        document.moveDown(0.5);
        continue;
      }
      const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
      const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
      const numbered = /^(\d+[.)])\s+(.+)$/.exec(trimmed);
      const quote = /^>\s+(.+)$/.exec(trimmed);
      const value = cleanInlineMarkdown(heading?.[2] ?? bullet?.[1] ?? numbered?.[2] ?? quote?.[1] ?? trimmed);
      if (heading) {
        document.moveDown(heading[1].length === 1 ? 0.7 : 0.4);
        document.font('Helvetica-Bold').fontSize(heading[1].length === 1 ? 17 : heading[1].length === 2 ? 13 : 11)
          .fillColor(heading[1].length === 1 ? '#' + DESIGN.navy : '#' + DESIGN.accent).text(value, { lineGap: 2 });
        document.moveDown(0.2);
      } else if (quote) {
        document.font('Helvetica-Oblique').fontSize(9.5).fillColor('#' + DESIGN.muted).text(value, { indent: 16, lineGap: 2 });
        document.moveDown(0.3);
      } else if (bullet || numbered) {
        document.font('Helvetica').fontSize(9.5).fillColor('#' + DESIGN.ink)
          .text((numbered ? numbered[1] + ' ' : '•  ') + value, { indent: 12, lineGap: 2 });
      } else {
        document.font(inCodeBlock ? 'Courier' : 'Helvetica').fontSize(inCodeBlock ? 8 : 9.5)
          .fillColor('#' + DESIGN.ink).text(value, { lineGap: 3 });
        document.moveDown(0.2);
      }
    }
  };

  if (isTableContent(content)) {
    if (content.preamble.length) renderMarkdownDocument(content.preamble.join('\n'));
    pdfAddTable(document, content.headers, content.rows);
    if (content.postamble.length) { document.moveDown(0.4); renderMarkdownDocument(content.postamble.join('\n')); }
  } else renderMarkdownDocument(content.text);

  const pageRange = document.bufferedPageRange();
  for (let index = pageRange.start; index < pageRange.start + pageRange.count; index++) {
    document.switchToPage(index);
    document.font('Helvetica').fontSize(7.5).fillColor('#' + DESIGN.muted).text(
      'TwinMind AI · ' + title + ' · Page ' + (index + 1) + ' of ' + pageRange.count,
      document.page.margins.left, document.page.height - 34,
      { width: document.page.width - document.page.margins.left - document.page.margins.right, align: 'center' },
    );
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
  const content = parseArtifactContent(contentInput);
  if ((type === 'csv' || type === 'xlsx') && content.kind !== 'table') {
    throw new Error('ARTIFACT_TABULAR_DATA_REQUIRED: provide structured records or a table with source-provided headers and at least one data row');
  }
  if (content.kind === 'table' && content.headers.length === 0) throw new Error('ARTIFACT_TABLE_HEADERS_REQUIRED');
  if (content.kind === 'table' && content.rows.length === 0) {
    throw new Error('ARTIFACT_TABLE_EMPTY: no data rows were supplied; no empty dataset was presented as a completed artifact');
  }

  const generatedAt = generatedAtValue.toISOString();
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
  } else if (type === 'xlsx') buffer = await generateXlsx(content, title, generatedAt);
  else buffer = await generatePdf(content, title, generatedAt);

  if (buffer.length === 0) throw new Error('ARTIFACT_VALIDATION_FAILED: generated file is empty');
  if (type === 'md' && !buffer.toString('utf8').trim()) throw new Error('ARTIFACT_VALIDATION_FAILED: Markdown document has no content');
  if (type === 'csv' && !buffer.toString('utf8').replace(/^\uFEFF/, '').trim()) throw new Error('ARTIFACT_VALIDATION_FAILED: CSV has no content');
  return { buffer, type, mimeType: MIME_TYPES[type], title, generatedAt };
}
