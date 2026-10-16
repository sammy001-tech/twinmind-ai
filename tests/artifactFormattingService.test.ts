import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';

import {
  generateArtifactBuffer,
  normalizeArtifactFormat,
  parseArtifactContent,
} from '../server/services/artifactFormattingService.ts';

test('normalizes only the file formats supported by the artifact generator', () => {
  assert.equal(normalizeArtifactFormat('xlsx'), 'xlsx');
  assert.equal(normalizeArtifactFormat('excel'), 'xlsx');
  assert.equal(normalizeArtifactFormat('pdf'), 'pdf');
  assert.equal(normalizeArtifactFormat('csv'), 'csv');
  assert.equal(normalizeArtifactFormat('md'), 'md');
  assert.throws(() => normalizeArtifactFormat(undefined), /ARTIFACT_FORMAT_REQUIRED/);
  assert.throws(() => normalizeArtifactFormat('docx'), /UNSUPPORTED_ARTIFACT_FORMAT/);
});

test('rejects missing content and malformed markdown table structures', async () => {
  assert.throws(() => parseArtifactContent('   '), /ARTIFACT_CONTENT_REQUIRED/);
  assert.throws(
    () => parseArtifactContent('| Brand | Email |\n| --- | --- |\n| Example Brand | contact@example.com | extra |'),
    /INCONSISTENT_TABLE_COLUMNS/,
  );
  await assert.rejects(
    () => generateArtifactBuffer('xlsx', '| Brand | Email |\n| --- | --- |', 'Empty_Table.xlsx'),
    /ARTIFACT_TABLE_EMPTY/,
  );
});

test('parses JSON-encoded tabular source records without converting them into prose', () => {
  const parsed = parseArtifactContent('[{"Brand":"Source Brand","Website":"https://source.example"}]');
  assert.equal(parsed.kind, 'table');
  if (parsed.kind !== 'table') return;
  assert.deepEqual(parsed.headers, ['Brand', 'Website']);
  assert.deepEqual(parsed.rows, [['Source Brand', 'https://source.example']]);

  const objectTable = parseArtifactContent(
    '{"headers":["Brand","Email"],"rows":[{"Brand":"Source Brand","Email":"contact@source.example"}]}',
  );
  assert.equal(objectTable.kind, 'table');
  if (objectTable.kind !== 'table') return;
  assert.deepEqual(objectTable.rows, [['Source Brand', 'contact@source.example']]);
});

test('parses structured records without inventing fields or rows', () => {
  const parsed = parseArtifactContent([
    { brand: 'Brand A', email: 'contact@example.com' },
    { brand: 'Brand B', email: null },
  ]);
  assert.equal(parsed.kind, 'table');
  if (parsed.kind !== 'table') return;
  assert.deepEqual(parsed.headers, ['brand', 'email']);
  assert.deepEqual(parsed.rows, [
    ['Brand A', 'contact@example.com'],
    ['Brand B', null],
  ]);
});

test('creates an XLSX workbook with a title, styled header, frozen rows, filters, and preserved data', async () => {
  const generated = await generateArtifactBuffer(
    'xlsx',
    [
      { Brand: 'Brand A', Website: 'https://example.com', Contact: 'sales@example.com' },
      { Brand: 'Brand B', Website: 'https://brand.example', Contact: 'info@example.com' },
    ],
    'South_African_Prospects.xlsx',
    new Date('2026-01-02T03:04:05.000Z'),
  );

  assert.equal(generated.type, 'xlsx');
  assert.equal(generated.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok(generated.buffer.length > 0);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(generated.buffer);
  const sheet = workbook.getWorksheet('Data');
  assert.ok(sheet);
  assert.equal(sheet?.getCell('A1').value, 'South African Prospects');
  assert.equal(sheet?.getCell('A4').value, 'Brand');
  assert.equal(sheet?.getCell('B4').value, 'Website');
  assert.equal(sheet?.getCell('A5').value, 'Brand A');
  assert.equal(sheet?.getCell('C6').value, 'info@example.com');
  assert.equal(sheet?.views[0]?.state, 'frozen');
  assert.ok(sheet?.autoFilter);
  assert.equal(sheet?.getCell('A4').font?.bold, true);
});

test('creates CSV with proper quoting, UTF-8 BOM, and formula-like text neutralized', async () => {
  const generated = await generateArtifactBuffer(
    'csv',
    [
      { Brand: 'Brand, Incorporated', Notes: 'Says "hello"\nand then left', FormulaLike: '=HYPERLINK("https://example.com","open")', NegativeFormulaLike: '-HYPERLINK("https://example.com","open")', NegativeNumericText: '-100.50', Balance: -100 },
    ],
    'Prospects.csv',
    new Date('2026-01-02T03:04:05.000Z'),
  );

  const csv = generated.buffer.toString('utf8');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"Brand, Incorporated"'));
  assert.ok(csv.includes('"Says ""hello""\nand then left"'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'-HYPERLINK"));
  assert.ok(csv.includes(',-100.50'));
  assert.ok(csv.includes(',-100'));
});

test('creates readable Markdown with a title and a valid table without changing source values', async () => {
  const generated = await generateArtifactBuffer(
    'md',
    '| Brand | Contact |\n| --- | --- |\n| Brand A | contact@example.com |',
    'Prospect_Report.md',
    new Date('2026-01-02T03:04:05.000Z'),
  );
  const markdown = generated.buffer.toString('utf8');
  assert.ok(markdown.startsWith('# Prospect Report'));
  assert.ok(markdown.includes('*Generated by TwinMind AI · 2026-01-02T03:04:05.000Z*'));
  assert.ok(markdown.includes('| Brand | Contact |'));
  assert.ok(markdown.includes('| Brand A | contact@example.com |'));
});

test('creates a valid PDF document with a readable PDF file signature', async () => {
  const generated = await generateArtifactBuffer(
    'pdf',
    '# Summary\n\n## Findings\n\n- Evidence was supplied by the user.\n- Unverified values remain unverified.',
    'Evidence_Summary.pdf',
    new Date('2026-01-02T03:04:05.000Z'),
  );
  assert.equal(generated.mimeType, 'application/pdf');
  assert.equal(generated.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(generated.buffer.length > 100);
});

test('does not label malformed or unsupported artifact input as successful output', async () => {
  await assert.rejects(
    () => generateArtifactBuffer('docx', 'Content', 'Unsupported.docx'),
    /UNSUPPORTED_ARTIFACT_FORMAT/,
  );
  await assert.rejects(
    () => generateArtifactBuffer('xlsx', '', 'Empty.xlsx'),
    /ARTIFACT_CONTENT_REQUIRED/,
  );
});
