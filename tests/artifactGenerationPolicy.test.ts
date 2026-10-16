import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArtifactTableContent,
  serializeArtifactCsv,
} from '../server/utils/artifactTabularData.ts';
import {
  formatArtifactSize,
  normalizeGeneratedArtifacts,
  removeDuplicateArtifactDownloadLines,
} from '../src/utils/artifacts.ts';

test('parses records using the union of keys actually present in source data', () => {
  const parsed = parseArtifactTableContent([
    { brand: 'Brand A', email: 'contact@example.test' },
    { brand: 'Brand B', phone: '+27123456789' },
  ]);

  assert.deepEqual(parsed.headers, ['brand', 'email', 'phone']);
  assert.deepEqual(parsed.rows, [
    ['Brand A', 'contact@example.test', null],
    ['Brand B', null, '+27123456789'],
  ]);
});

test('parses markdown tables without inventing rows or column labels', () => {
  const parsed = parseArtifactTableContent(
    '| Brand | Website |\n| --- | --- |\n| Brand A | https://brand-a.example |\n| Brand B | https://brand-b.example |',
  );
  assert.deepEqual(parsed.headers, ['Brand', 'Website']);
  assert.deepEqual(parsed.rows, [
    ['Brand A', 'https://brand-a.example'],
    ['Brand B', 'https://brand-b.example'],
  ]);
});

test('parses quoted CSV including commas, escaped quotes, and line breaks', () => {
  const parsed = parseArtifactTableContent(
    'Brand,Notes\r\n"Brand A","Contains, a comma"\r\n"Brand B","A ""quoted"" note"',
  );
  assert.deepEqual(parsed.headers, ['Brand', 'Notes']);
  assert.deepEqual(parsed.rows, [
    ['Brand A', 'Contains, a comma'],
    ['Brand B', 'A "quoted" note'],
  ]);
});

test('serializes CSV values using CSV quoting rules', () => {
  const parsed = parseArtifactTableContent([
    { brand: 'Brand A', notes: 'contains, comma' },
    { brand: 'Brand B', notes: 'a "quoted" value' },
  ]);
  assert.equal(
    serializeArtifactCsv(parsed),
    'brand,notes\r\nBrand A,"contains, comma"\r\nBrand B,"a ""quoted"" value"',
  );
});

test('rejects prose, malformed JSON, missing headers, and empty table data', () => {
  assert.throws(() => parseArtifactTableContent('A general paragraph without a table.'), /ARTIFACT_TABULAR_DATA_REQUIRED/);
  assert.throws(() => parseArtifactTableContent('[{"broken":'), /ARTIFACT_JSON_INVALID/);
  assert.throws(() => parseArtifactTableContent('| | Website |\n| --- | --- |\n| Brand A | https://brand-a.example |'), /ARTIFACT_COLUMN_HEADER_MISSING/);
  assert.throws(() => parseArtifactTableContent('| Brand | Website |\n| --- | --- |'), /ARTIFACT_TABULAR_DATA_REQUIRED/);
});

test('refuses malformed or off-origin artifact URLs from metadata', () => {
  assert.deepEqual(normalizeGeneratedArtifacts([
    { name: 'External', url: 'https://elsewhere.example/artifacts/file.xlsx', type: 'xlsx' },
    { name: 'Traversal', url: '/artifacts/%2e%2e', type: 'xlsx' },
    { name: 'No source', url: '/artifacts/file.xlsx', type: 'exe' },
  ]), []);
});

test('keeps only validated metadata for generated artifacts', () => {
  assert.deepEqual(normalizeGeneratedArtifacts([{
    name: 'Prospects.xlsx',
    url: '/artifacts/1780000000000_Prospects.xlsx',
    type: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 8192,
    sha256: 'a'.repeat(64),
    generatedAt: '2026-01-20T10:00:00.000Z',
    storageScope: 'configured-directory',
    ignored: 'not public metadata',
  }]), [{
    name: 'Prospects.xlsx',
    url: '/artifacts/1780000000000_Prospects.xlsx',
    type: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 8192,
    sha256: 'a'.repeat(64),
    generatedAt: '2026-01-20T10:00:00.000Z',
    storageScope: 'configured-directory',
  }]);
});

test('removes a duplicate model-written download line only for attached artifact paths', () => {
  const artifacts = normalizeGeneratedArtifacts([{
    name: 'Prospects.xlsx',
    url: '/artifacts/1780000000000_Prospects.xlsx',
    type: 'xlsx',
  }]);
  const content = [
    'The spreadsheet was generated.',
    'You can download it here: [Download Excel File](/artifacts/1780000000000_Prospects.xlsx).',
    'The output includes verified source fields.',
  ].join('\n\n');
  assert.equal(
    removeDuplicateArtifactDownloadLines(content, artifacts),
    'The spreadsheet was generated.\n\n\n\nThe output includes verified source fields.'.replace(/\n{3,}/g, '\n\n'),
  );
});

test('formats only actual file byte counts', () => {
  assert.equal(formatArtifactSize(0), 'Size unavailable');
  assert.equal(formatArtifactSize(undefined), 'Size unavailable');
  assert.equal(formatArtifactSize(2048), '2.0 KiB');
});
