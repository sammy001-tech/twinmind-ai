export type ArtifactFormat = 'pdf' | 'md' | 'csv' | 'xlsx';

export type ArtifactFormatResolution =
  | { format: ArtifactFormat; source: 'explicit-request' | 'model-tool-argument' }
  | {
      error: 'ARTIFACT_FORMAT_REQUIRED' | 'ARTIFACT_FORMAT_AMBIGUOUS' | 'ARTIFACT_TYPE_UNSUPPORTED';
      message: string;
    };

interface FormatCue {
  format: ArtifactFormat;
  pattern: RegExp;
}

const explicitOutputCues: FormatCue[] = [
  { format: 'csv', pattern: /\b(?:as|to|into|in)\s+(?:a\s+)?(?:csv|comma[- ]separated(?: values)?)\b/i },
  { format: 'xlsx', pattern: /\b(?:as|to|into|in)\s+(?:an?\s+)?(?:excel|xlsx|spreadsheet|workbook)\b/i },
  { format: 'pdf', pattern: /\b(?:as|to|into|in)\s+(?:a\s+)?(?:pdf|portable document format)\b/i },
  { format: 'md', pattern: /\b(?:as|to|into|in)\s+(?:a\s+)?(?:markdown|md)\b/i },
];

const formatKeywords: FormatCue[] = [
  { format: 'csv', pattern: /\bcsv\b|comma[- ]separated(?: values)?/i },
  { format: 'xlsx', pattern: /\b(?:excel|xlsx|spreadsheet|workbook)\b/i },
  { format: 'pdf', pattern: /\bpdf\b|portable document format/i },
  { format: 'md', pattern: /\bmarkdown\b|(?:^|\s)md(?:$|\s)/i },
];

function normalizeModelFormat(value: unknown): ArtifactFormat | null {
  if (typeof value !== 'string') return null;

  switch (value.trim().toLowerCase()) {
    case 'pdf':
      return 'pdf';
    case 'xlsx':
    case 'excel':
      return 'xlsx';
    case 'csv':
      return 'csv';
    case 'md':
    case 'markdown':
      return 'md';
    default:
      return null;
  }
}

/** Detect file-generation requests without treating every format mention as a request. */
export function isArtifactGenerationRequest(userRequest: string): boolean {
  const forward = /\b(?:create|generate|make|produce|prepare|export|download|attach|provide|deliver|format|convert|save|build|write|give(?: me)?)\b[\s\S]{0,100}\b(?:file|spreadsheet|excel|xlsx|csv|pdf|document|workbook|markdown|artifact|report)\b/i;
  const reverse = /\b(?:file|spreadsheet|excel|xlsx|csv|pdf|document|workbook|markdown|artifact|report)\b[\s\S]{0,100}\b(?:create|generate|make|produce|prepare|export|download|attach|provide|deliver|format|convert|save|build|write|give(?: me)?)\b/i;
  return forward.test(userRequest) || reverse.test(userRequest);
}

/**
 * Resolve the requested output format without guessing.
 * The user's explicit target format wins over tool metadata (for example, Excel -> PDF).
 * Missing or ambiguous formats are errors rather than silent Markdown/CSV defaults.
 */
export function resolveArtifactFormat(
  userRequest: string,
  modelToolArgument: unknown,
): ArtifactFormatResolution {
  const request = userRequest.trim();
  const explicitFormats = [...new Set(
    explicitOutputCues
      .filter(({ pattern }) => pattern.test(request))
      .map(({ format }) => format),
  )];

  if (explicitFormats.length === 1) {
    return { format: explicitFormats[0], source: 'explicit-request' };
  }
  if (explicitFormats.length > 1) {
    return {
      error: 'ARTIFACT_FORMAT_AMBIGUOUS',
      message: 'The request names multiple output formats. Specify one output format per file-generation request.',
    };
  }

  const mentionedFormats = [...new Set(
    formatKeywords
      .filter(({ pattern }) => pattern.test(request))
      .map(({ format }) => format),
  )];
  if (mentionedFormats.length === 1) {
    return { format: mentionedFormats[0], source: 'explicit-request' };
  }
  if (mentionedFormats.length > 1) {
    return {
      error: 'ARTIFACT_FORMAT_AMBIGUOUS',
      message: 'The request mentions multiple file formats without identifying the desired output. Specify the target format.',
    };
  }

  const modelFormat = normalizeModelFormat(modelToolArgument);
  if (modelFormat) return { format: modelFormat, source: 'model-tool-argument' };

  if (typeof modelToolArgument === 'string' && modelToolArgument.trim()) {
    return {
      error: 'ARTIFACT_TYPE_UNSUPPORTED',
      message: 'The requested file format is unsupported. Choose PDF, XLSX, CSV, or Markdown.',
    };
  }

  return {
    error: 'ARTIFACT_FORMAT_REQUIRED',
    message: 'Specify the output format (PDF, XLSX, CSV, or Markdown). No default file format was selected.',
  };
}
