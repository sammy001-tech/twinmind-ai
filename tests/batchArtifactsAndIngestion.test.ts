import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

import {
  generateArtifactBuffer,
  generateZipArtifactBundle,
  parseMultiSheetWorkbookInput,
} from '../server/services/artifactFormattingService.ts';
import { buildArtifactPreview } from '../server/services/artifactPreviewService.ts';
import {
  extractZipFileEntries,
  ingestDocumentBatch,
  isUnsafeZipEntryPath,
  isIgnorableArchiveMetadataEntry,
} from '../server/services/documentIngestionService.ts';
import { neonDb } from '../server/db/neonService.ts';

test.after(async () => {
  await neonDb.close();
});

test('generateArtifactBuffer builds multi-sheet XLSX workbooks with sanitized unique sheet names', async () => {
  const multiSheetPayload = JSON.stringify({
    sheets: [
      {
        name: 'Summary Metrics / Q1:VeryLongSheetNameExceedingLimit',
        headers: ['Metric', 'Value'],
        rows: [['ARR', 120000], ['NRR', '118%']],
      },
      {
        name: 'Action Items',
        content: '| Owner | Task | Due |\n| --- | --- | --- |\n| Ops | Launch Audit | May 15 |',
      },
    ],
  });

  const parsed = parseMultiSheetWorkbookInput(multiSheetPayload);
  assert.ok(parsed);
  assert.equal(parsed?.length, 2);

  const generated = await generateArtifactBuffer('xlsx', multiSheetPayload, 'Quarterly_Pack.xlsx');
  assert.equal(generated.type, 'xlsx');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(generated.buffer);
  assert.equal(workbook.worksheets.length, 2);
  assert.ok(workbook.worksheets[0].name.length <= 31);
  assert.equal(workbook.worksheets[1].name, 'Action Items');
  assert.equal(workbook.worksheets[0].getCell('A5').value, 'ARR');
  assert.equal(workbook.worksheets[1].getCell('B5').value, 'Launch Audit');
});

test('generateZipArtifactBundle creates verified ZIP package and builds archive preview metadata', async () => {
  const bundle = await generateZipArtifactBundle(
    [
      {
        type: 'md',
        fileName: 'Study_Guide.md',
        content: '# Forex Liquidity Concepts\n\nUnderstand buy-side and sell-side liquidity pools.',
      },
      {
        type: 'csv',
        fileName: 'Quiz_Checklist.csv',
        content: '| Topic | Verified |\n| --- | --- |\n| Order Blocks | Yes |',
      },
      {
        type: 'xlsx',
        fileName: 'Practice_Workbook.xlsx',
        content: JSON.stringify({
          sheets: [
            { name: 'Drills', headers: ['Setup', 'Target'], rows: [['Sweep', '2R']] },
          ],
        }),
      },
    ],
    'Forex_Study_Bundle.zip',
    new Date('2026-05-01T10:00:00.000Z'),
  );

  assert.equal(bundle.type, 'zip');
  assert.equal(bundle.mimeType, 'application/zip');
  assert.equal(bundle.entries.length, 3);
  assert.ok(bundle.buffer.length > 0);

  const opened = await JSZip.loadAsync(bundle.buffer);
  assert.ok(opened.file('Study_Guide.md'));
  assert.ok(opened.file('Quiz_Checklist.csv'));
  assert.ok(opened.file('Practice_Workbook.xlsx'));

  const preview = await buildArtifactPreview(
    {
      fileName: 'Forex_Study_Bundle.zip',
      displayName: 'Forex_Study_Bundle.zip',
      type: 'zip',
      mimeType: 'application/zip',
      content: bundle.buffer,
      sizeBytes: bundle.buffer.length,
    },
    '/artifacts/Forex_Study_Bundle.zip?token=test',
  );

  assert.equal(preview.previewKind, 'archive');
  assert.equal(preview.archiveEntries?.length, 3);
  assert.equal(preview.archiveEntries?.some((e) => e.name === 'Practice_Workbook.xlsx'), true);
});

test('generateZipArtifactBundle rejects empty batch items and path traversal entry names', async () => {
  await assert.rejects(
    () => generateZipArtifactBundle([], 'Empty.zip'),
    /BATCH_ITEMS_REQUIRED/,
  );

  await assert.rejects(
    () =>
      generateZipArtifactBundle(
        [{ type: 'md', fileName: '../../etc/passwd.md', content: 'malicious path' }],
        'Bad_Bundle.zip',
      ),
    /INVALID_BATCH_ENTRY_FILENAME/,
  );
});

test('ZIP ingestion security helpers block Zip Slip paths and ignore macOS metadata junk', async () => {
  assert.equal(isUnsafeZipEntryPath('../secret.txt'), true);
  assert.equal(isUnsafeZipEntryPath('folder/../../evil.md'), true);
  assert.equal(isUnsafeZipEntryPath('/abs/path.txt'), true);
  assert.equal(isUnsafeZipEntryPath('C:\\win\\file.txt'), true);
  assert.equal(isUnsafeZipEntryPath('notes/lesson1.md'), false);

  assert.equal(isIgnorableArchiveMetadataEntry('__MACOSX/._notes.md', false), true);
  assert.equal(isIgnorableArchiveMetadataEntry('.DS_Store', false), true);
  assert.equal(isIgnorableArchiveMetadataEntry('subdir/', true), true);
  assert.equal(isIgnorableArchiveMetadataEntry('subdir/guide.md', false), false);

  // Build malicious ZIP with Zip Slip entry
  const badZip = new JSZip();
  badZip.file('/etc/passwd', 'malicious');
  const badBuffer = await badZip.generateAsync({ type: 'nodebuffer' });

  await assert.rejects(
    () => extractZipFileEntries(badBuffer, { archiveName: 'evil.zip' }),
    /ZIP_PATH_TRAVERSAL_REJECTED/,
  );

  // Build safe ZIP with __MACOSX junk alongside valid note + exceed file limit test
  const okZip = new JSZip();
  okZip.file('__MACOSX/._doc.md', 'junk');
  okZip.file('docs/alpha.md', '# Alpha\nValid content');
  okZip.file('docs/beta.csv', 'ColA,ColB\n1,2');
  const okBuffer = await okZip.generateAsync({ type: 'nodebuffer' });

  const extracted = await extractZipFileEntries(okBuffer, { archiveName: 'notes.zip', maxFiles: 5 });
  assert.equal(extracted.length, 2);
  assert.deepEqual(extracted.map((e) => e.filename).sort(), ['alpha.md', 'beta.csv']);

  await assert.rejects(
    () => extractZipFileEntries(okBuffer, { archiveName: 'notes.zip', maxFiles: 1 }),
    /BATCH_FILE_LIMIT_EXCEEDED/,
  );
});

test('ingestDocumentBatch fails closed cleanly on invalid ZIP and empty file inputs', async () => {
  await assert.rejects(() => ingestDocumentBatch([]), /BATCH_FILES_REQUIRED/);

  const res = await ingestDocumentBatch([
    { filename: 'broken.zip', buffer: Buffer.from('not-a-valid-zip', 'utf8'), mimeType: 'application/zip' },
    { filename: 'empty.txt', buffer: Buffer.alloc(0), mimeType: 'text/plain' },
  ]);

  assert.equal(res.success, false);
  assert.equal(res.overallStatus, 'failed');
  assert.equal(res.succeededCount, 0);
  assert.equal(res.failedCount, 2);
  assert.equal(res.results[0].code, 'ZIP_ARCHIVE_INVALID');
  assert.equal(res.results[1].code, 'FILE_CONTENT_EMPTY');
});
