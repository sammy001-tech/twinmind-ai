import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

import { specialistSwarmService } from '../server/services/specialistSwarmService.ts';
import { resolveArtifactFilePath } from '../server/utils/artifactStorage.ts';

async function withTemporaryArtifactDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'twinmind-artifact-integration-'));
  const previous = process.env.ARTIFACTS_DIR;
  process.env.ARTIFACTS_DIR = directory;
  try {
    return await run(directory);
  } finally {
    if (previous === undefined) delete process.env.ARTIFACTS_DIR;
    else process.env.ARTIFACTS_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('integrated generator writes validated PDF, XLSX, CSV, and Markdown files from supplied content', async () => {
  await withTemporaryArtifactDirectory(async (directory) => {
    const tableRows = [
      { Brand: 'Source Brand One', Website: 'https://one.example', Contact: 'info@one.example' },
      { Brand: 'Source Brand Two', Website: 'https://two.example', Contact: 'hello@two.example' },
    ];
    const requests = [
      {
        format: 'xlsx' as const,
        content: tableRows,
        filename: 'Source_Prospects.xlsx',
        expectedMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      {
        format: 'csv' as const,
        content: tableRows,
        filename: 'Source_Prospects.csv',
        expectedMime: 'text/csv; charset=utf-8',
      },
      {
        format: 'pdf' as const,
        content: '# Source Report\n\n## Findings\n\nThe report contains only the supplied findings.',
        filename: 'Source_Report.pdf',
        expectedMime: 'application/pdf',
      },
      {
        format: 'md' as const,
        content: '# Source Notes\n\nOnly source-provided notes are included.',
        filename: 'Source_Notes.md',
        expectedMime: 'text/markdown; charset=utf-8',
      },
    ];

    const generated: string[] = [];
    for (const request of requests) {
      const result = await specialistSwarmService.executeGenerateArtifact(
        request.format,
        request.content,
        request.filename,
      );
      assert.equal(result.status, 'success', result.error);
      assert.equal(result.displayName, request.filename);
      assert.equal(result.type, request.format);
      assert.equal(result.mimeType, request.expectedMime);
      assert.ok(result.sizeBytes && result.sizeBytes > 0);
      assert.match(result.sha256 || '', /^[a-f0-9]{64}$/);
      assert.equal(result.storageScope, 'configured-directory');
      assert.ok(result.generatedAt && !Number.isNaN(Date.parse(result.generatedAt)));
      assert.ok(result.url.startsWith('/artifacts/'));
      assert.ok(result.fileName);
      generated.push(result.fileName);

      const fullPath = resolveArtifactFilePath(result.fileName);
      const bytes = await fs.readFile(fullPath);
      const stats = await fs.stat(fullPath);
      assert.equal(stats.size, result.sizeBytes);
      assert.ok(stats.isFile());
      assert.notEqual(bytes.length, 0);

      if (request.format === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes);
        const sheet = workbook.getWorksheet('Data');
        assert.ok(sheet, 'The generated workbook must contain the real data worksheet.');
        assert.equal(sheet?.getCell('A4').value, 'Brand');
        assert.equal(sheet?.getCell('A5').value, 'Source Brand One');
        assert.equal(sheet?.getCell('C6').value, 'hello@two.example');
        assert.ok(sheet?.autoFilter);
      } else if (request.format === 'csv') {
        const csv = bytes.toString('utf8').replace(/^\uFEFF/, '');
        assert.ok(csv.includes('Source Brand One'));
        assert.ok(csv.includes('info@one.example'));
        assert.ok(csv.includes('Source Brand Two'));
      } else if (request.format === 'pdf') {
        assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
      } else {
        const markdown = bytes.toString('utf8');
        assert.ok(markdown.startsWith('# Source Notes'));
        assert.ok(markdown.includes('Only source-provided notes are included.'));
      }
    }

    const remaining = await fs.readdir(directory);
    assert.deepEqual(remaining.sort(), generated.sort());
  });
});

test('integrated generator fails closed for empty tabular data and unsafe filenames', async () => {
  await withTemporaryArtifactDirectory(async (directory) => {
    const emptyTable = await specialistSwarmService.executeGenerateArtifact(
      'xlsx',
      '| Brand | Website |\n| --- | --- |',
      'Empty_Prospects.xlsx',
    );
    assert.equal(emptyTable.status, 'error');
    assert.equal(emptyTable.url, '');
    assert.equal(emptyTable.fileName, '');
    assert.match(emptyTable.error || '', /ARTIFACT_TABULAR_DATA_REQUIRED|ARTIFACT_TABLE_EMPTY/);

    const unsafeName = await specialistSwarmService.executeGenerateArtifact(
      'pdf',
      '# Content\n\nProvided text.',
      '../private.pdf',
    );
    assert.equal(unsafeName.status, 'error');
    assert.equal(unsafeName.url, '');
    assert.equal(unsafeName.fileName, '');
    assert.match(unsafeName.error || '', /ARTIFACT_FILENAME_INVALID/);
    assert.deepEqual(await fs.readdir(directory), []);
  });
});
