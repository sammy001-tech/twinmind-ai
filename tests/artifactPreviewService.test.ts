import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseCsvRows, buildArtifactPreview } from '../server/services/artifactPreviewService.ts';

test('parseCsvRows parses BOM, quoted commas, escaped quotes, and mixed newlines cleanly', () => {
  const csv = [
    '\uFEFFName,Role,"Notes, Extra"',
    '"Ada ""Countess"" Lovelace",Engineer,"Line, 1"',
    'Alan Turing,Mathematician,Simple\r',
  ].join('\r\n');

  const rows = parseCsvRows(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['Name', 'Role', 'Notes, Extra']);
  assert.deepEqual(rows[1], ['Ada "Countess" Lovelace', 'Engineer', 'Line, 1']);
  assert.deepEqual(rows[2], ['Alan Turing', 'Mathematician', 'Simple']);
});

test('buildArtifactPreview renders markdown, bounded CSV tables, PDF links, and live ExcelJS workbooks', async () => {
  // Markdown
  const mdPreview = await buildArtifactPreview({
    fileName: 'summary.md',
    displayName: 'summary.md',
    type: 'md',
    mimeType: 'text/markdown',
    sizeBytes: 18,
    content: Buffer.from('# Title\n\nBody text', 'utf-8'),
  });
  assert.equal(mdPreview.previewKind, 'markdown');
  assert.equal(mdPreview.markdownText, '# Title\n\nBody text');

  // CSV truncation boundary (>200 data rows)
  const csvLines = ['ColA,ColB'];
  for (let i = 1; i <= 205; i++) {
    csvLines.push(`Row${i},${i * 10}`);
  }
  const csvBuffer = Buffer.from(csvLines.join('\n'), 'utf-8');
  const csvPreview = await buildArtifactPreview({
    fileName: 'metrics.csv',
    displayName: 'metrics.csv',
    type: 'csv',
    mimeType: 'text/csv',
    sizeBytes: csvBuffer.length,
    content: csvBuffer,
  });
  assert.equal(csvPreview.previewKind, 'table');
  assert.deepEqual(csvPreview.headers, ['ColA', 'ColB']);
  assert.equal(csvPreview.totalRows, 205);
  assert.equal(csvPreview.rows?.length, 200);
  assert.equal(csvPreview.truncated, true);

  // Live ExcelJS XLSX multi-sheet preview
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Summary');
  s1.addRow(['Metric', 'Value', 'Date']);
  s1.addRow(['Net Revenue', { formula: '100+50', result: 150 }, new Date(Date.UTC(2026, 10, 12))]);
  const s2 = wb.addWorksheet('LargeData');
  s2.addRow(['Index']);
  for (let i = 1; i <= 202; i++) {
    s2.addRow([i]);
  }
  const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());
  const xlsxPreview = await buildArtifactPreview({
    fileName: 'report.xlsx',
    displayName: 'report.xlsx',
    type: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: xlsxBuf.length,
    content: xlsxBuf,
  });
  assert.equal(xlsxPreview.previewKind, 'workbook');
  assert.equal(xlsxPreview.sheets?.length, 2);
  assert.equal(xlsxPreview.sheets?.[0].name, 'Summary');
  assert.deepEqual(xlsxPreview.sheets?.[0].rows[0], ['Net Revenue', '150', '2026-11-12']);
  assert.equal(xlsxPreview.sheets?.[0].truncated, false);
  assert.equal(xlsxPreview.sheets?.[1].name, 'LargeData');
  assert.equal(xlsxPreview.sheets?.[1].totalRows, 202);
  assert.equal(xlsxPreview.sheets?.[1].rows.length, 200);
  assert.equal(xlsxPreview.sheets?.[1].truncated, true);

  // Empty ExcelJS workbook fails transparently
  const emptyWb = new ExcelJS.Workbook();
  const emptyBuf = Buffer.from(await emptyWb.xlsx.writeBuffer());
  await assert.rejects(
    () =>
      buildArtifactPreview({
        fileName: 'empty.xlsx',
        displayName: 'empty.xlsx',
        type: 'xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: emptyBuf.length,
        content: emptyBuf,
      }),
    /ARTIFACT_PREVIEW_EMPTY_WORKBOOK/
  );

  // PDF inline URL passthrough
  const pdfPreview = await buildArtifactPreview(
    {
      fileName: 'plan.pdf',
      displayName: 'plan.pdf',
      type: 'pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      content: Buffer.from('%PDF'),
    },
    '/api/artifacts/plan.pdf?inline=1'
  );
  assert.equal(pdfPreview.previewKind, 'pdf');
  assert.equal(pdfPreview.inlineUrl, '/api/artifacts/plan.pdf?inline=1');
});
