import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { ArtifactPreviewData, ArtifactPreviewSheet } from '../../src/types/index.ts';

const MAX_PREVIEW_ROWS = 200;

/**
 * RFC-4180 compliant CSV parser returning normalized rows of strings.
 */
export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  const normalized = csvText.replace(/^\uFEFF/, '');
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell);
      currentCell = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.trim() !== '') || row.length > 1);
}

function formatExcelCellValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) {
      return String(value.result);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || '').join('');
    }
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export async function buildArtifactPreview(
  artifact: {
    fileName: string;
    displayName: string;
    type: 'pdf' | 'md' | 'csv' | 'xlsx' | 'zip';
    mimeType: string;
    sizeBytes: number;
    content: Buffer;
  },
  inlineUrl?: string
): Promise<ArtifactPreviewData> {
  if (artifact.type === 'zip') {
    const zip = await JSZip.loadAsync(artifact.content);
    const archiveEntries: Array<{ name: string; sizeBytes: number; compressedBytes?: number; directory?: boolean }> = [];
    for (const [entryName, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const buf = await entry.async('nodebuffer');
      archiveEntries.push({
        name: entryName,
        sizeBytes: buf.length,
        compressedBytes: (entry as any)._data?.compressedSize ?? undefined,
        directory: false,
      });
    }
    return {
      fileName: artifact.fileName,
      displayName: artifact.displayName,
      type: 'zip',
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      previewKind: 'archive',
      archiveEntries,
      inlineUrl,
    };
  }
  if (artifact.type === 'md') {
    return {
      fileName: artifact.fileName,
      displayName: artifact.displayName,
      type: 'md',
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      previewKind: 'markdown',
      markdownText: artifact.content.toString('utf-8'),
      inlineUrl,
    };
  }

  if (artifact.type === 'csv') {
    const parsedRows = parseCsvRows(artifact.content.toString('utf-8'));
    const headers = parsedRows[0] || [];
    const dataRows = parsedRows.slice(1);
    const truncated = dataRows.length > MAX_PREVIEW_ROWS;
    return {
      fileName: artifact.fileName,
      displayName: artifact.displayName,
      type: 'csv',
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      previewKind: 'table',
      headers,
      rows: dataRows.slice(0, MAX_PREVIEW_ROWS),
      totalRows: dataRows.length,
      truncated,
      inlineUrl,
    };
  }

  if (artifact.type === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(artifact.content as any);
    const sheets: ArtifactPreviewSheet[] = [];

    workbook.eachSheet((worksheet) => {
      const sheetRows: string[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        sheetRows.push(values.map((cell) => formatExcelCellValue(cell as ExcelJS.CellValue)));
      });
      const headers = sheetRows[0] || [];
      const dataRows = sheetRows.slice(1);
      sheets.push({
        name: worksheet.name || 'Sheet',
        headers,
        rows: dataRows.slice(0, MAX_PREVIEW_ROWS),
        totalRows: dataRows.length,
        truncated: dataRows.length > MAX_PREVIEW_ROWS,
      });
    });

    if (sheets.length === 0) {
      throw new Error('ARTIFACT_PREVIEW_EMPTY_WORKBOOK: Excel workbook contains no readable worksheets.');
    }

    return {
      fileName: artifact.fileName,
      displayName: artifact.displayName,
      type: 'xlsx',
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      previewKind: 'workbook',
      sheets,
      inlineUrl,
    };
  }

  return {
    fileName: artifact.fileName,
    displayName: artifact.displayName,
    type: 'pdf',
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    previewKind: 'pdf',
    inlineUrl,
  };
}
