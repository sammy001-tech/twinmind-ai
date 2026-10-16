import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isArtifactGenerationRequest,
  resolveArtifactFormat,
} from '../server/utils/artifactFormat.ts';

test('resolves the requested output format rather than the source format', () => {
  assert.deepEqual(
    resolveArtifactFormat('Convert the existing Excel file to PDF', 'xlsx'),
    { format: 'pdf', source: 'explicit-request' },
  );
  assert.deepEqual(
    resolveArtifactFormat('Provide this prospect list in an Excel file', 'csv'),
    { format: 'xlsx', source: 'explicit-request' },
  );
});

test('uses a valid tool format only when the user request does not specify one', () => {
  assert.deepEqual(
    resolveArtifactFormat('Create a report from the current analysis', 'pdf'),
    { format: 'pdf', source: 'model-tool-argument' },
  );
});

test('does not guess a format when a file is requested without one', () => {
  assert.deepEqual(
    resolveArtifactFormat('Create a file from the current analysis', undefined),
    {
      error: 'ARTIFACT_FORMAT_REQUIRED',
      message: 'Specify the output format (PDF, XLSX, CSV, or Markdown). No default file format was selected.',
    },
  );
});

test('rejects ambiguous output formats instead of choosing one', () => {
  const result = resolveArtifactFormat('Create an Excel and PDF report', undefined);
  assert.ok('error' in result);
  if ('error' in result) assert.equal(result.error, 'ARTIFACT_FORMAT_AMBIGUOUS');
});

test('rejects unsupported format arguments', () => {
  const result = resolveArtifactFormat('Create a report from the current analysis', 'docx');
  assert.ok('error' in result);
  if ('error' in result) assert.equal(result.error, 'ARTIFACT_TYPE_UNSUPPORTED');
});

test('detects file creation requests without treating format comparisons as generation', () => {
  assert.equal(isArtifactGenerationRequest('Provide this prospect list in an Excel file and format it professionally.'), true);
  assert.equal(isArtifactGenerationRequest('What is the difference between Excel and PDF?'), false);
  assert.equal(isArtifactGenerationRequest('Which format should I choose, Excel or PDF?'), false);
});
