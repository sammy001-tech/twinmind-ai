import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { canonicalHttpUrl, resolveBoundedIntegerSetting } from '../utils/researchEvidence.ts';
import { knowledgeService } from '../db/knowledgeService.ts';
import {
  validateImageAttachment,
  type ImageAttachment,
  type VisualEvidencePackage,
} from './visionCapabilityService.ts';

export type SupportedDocumentFormat =
  | 'pdf'
  | 'markdown'
  | 'text'
  | 'json'
  | 'csv'
  | 'xlsx'
  | 'docx'
  | 'ocr_image';

export interface ParsedDocumentMetadata {
  extractionMethod: string;
  pageCount?: number;
  tablesExtracted?: number;
  ocrPagesProcessed?: number;
  ocrProvider?: string;
  ocrModel?: string;
  uncertaintyDetected?: boolean;
}

export interface ParsedDocument {
  title: string;
  content: string;
  format: SupportedDocumentFormat;
  metadata?: ParsedDocumentMetadata;
}

export type DocumentOcrExtractor = (
  image: ImageAttachment,
  contextPrompt: string,
) => Promise<VisualEvidencePackage>;

export interface ParseDocumentOptions {
  ocrExtractor?: DocumentOcrExtractor;
  keys?: {
    gemini?: string;
    groq?: string;
    mistral?: string;
  };
  userPrompt?: string;
  signal?: AbortSignal;
}

export interface DocumentChunk {
  title: string;
  content: string;
  chunkIndex: number;
  totalChunks: number;
}

export interface IngestionResult {
  success: boolean;
  documentsCreated: number;
  primaryTitle: string;
  category: string;
  totalCharacters: number;
  totalChunks: number;
  tags: string[];
  metadata?: ParsedDocumentMetadata;
}

/**
 * Extracts clean, human-readable text from an HTML document string.
 */
export function extractTextAndTitleFromHtml(html: string): { title: string; text: string } {
  if (!html || typeof html !== 'string') {
    return { title: '', text: '' };
  }

  // 1. Extract <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch ? titleMatch[1].trim() : '';

  // Fallback to og:title
  if (!title) {
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitleMatch) title = ogTitleMatch[1].trim();
  }

  // Fallback to <h1>
  if (!title) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) title = h1Match[1].replace(/<[^>]+>/g, '').trim();
  }

  // Decode common HTML entities in title
  title = decodeHtmlEntities(title);

  // 2. Remove scripts, styles, svg, and non-content elements
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ');

  // 3. Convert line-breaking block elements to newlines
  cleaned = cleaned
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');

  // 4. Strip all remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // 5. Decode HTML entities
  cleaned = decodeHtmlEntities(cleaned);

  // 6. Normalize whitespace
  const lines = cleaned.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim());
  const normalizedText = lines
    .filter((l) => l.length > 0)
    .join('\n\n')
    .trim();

  return {
    title: title || 'Untitled Web Page',
    text: normalizedText,
  };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function formatCellMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function format2DTableAsMarkdown(rows: string[][]): string {
  const cleanedRows = rows
    .map((row) => row.map((cell) => formatCellMarkdown(String(cell ?? ''))))
    .filter((row) => row.some((cell) => cell.length > 0));
  if (cleanedRows.length === 0) return '';

  const width = cleanedRows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return '';

  const normalized = cleanedRows.map((row) => {
    const padded = [...row];
    while (padded.length < width) padded.push('');
    return padded;
  });

  const [headerRow, ...dataRows] = normalized;
  const headerLine = `| ${headerRow.map((cell, idx) => cell || `Column ${idx + 1}`).join(' | ')} |`;
  const sepLine = `| ${headerRow.map(() => '---').join(' | ')} |`;
  const bodyLines = dataRows.map((row) => `| ${row.join(' | ')} |`);
  return [headerLine, sepLine, ...bodyLines].join('\n');
}

function formatExcelCellValue(raw: unknown): string {
  if (raw == null) return '';
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if ('result' in obj && obj.result !== undefined) return formatExcelCellValue(obj.result);
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((part: any) => String(part?.text || '')).join('');
    }
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.hyperlink === 'string') return obj.hyperlink;
    if (typeof obj.formula === 'string') return `=${obj.formula}`;
  }
  return String(raw);
}

function convertMammothHtmlToStructuredMarkdown(html: string): string {
  let text = html;

  // Convert HTML tables into clean Markdown tables
  text = text.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    const rowMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    const matrix: string[][] = [];
    for (const rowMatch of rowMatches) {
      const cells = [...rowMatch[1].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((cellMatch) =>
        decodeHtmlEntities(cellMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()),
      );
      if (cells.length > 0) matrix.push(cells);
    }
    const md = format2DTableAsMarkdown(matrix);
    return md ? `\n\n${md}\n\n` : '\n\n';
  });

  // Preserve headings and list structure cleanly
  text = text
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, inner) => `\n\n# ${decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ')).trim()}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, inner) => `\n\n## ${decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ')).trim()}\n\n`)
    .replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, (_, inner) => `\n\n### ${decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ')).trim()}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `- ${decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ')).trim()}\n`)
    .replace(/<\/(p|div|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  text = decodeHtmlEntities(text);
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function resolveDefaultOcrExtractor(options?: ParseDocumentOptions): Promise<DocumentOcrExtractor> {
  if (options?.ocrExtractor) return options.ocrExtractor;
  const { twinAgentService } = await import('./twinAgentService.ts');
  return async (image: ImageAttachment, contextPrompt: string) => {
    return twinAgentService.executeVisionSpecialistPrePass(
      image,
      contextPrompt,
      options?.keys,
      options?.signal,
    );
  };
}

function hasVisualUncertaintyWarning(analysis: string): boolean {
  const match = analysis.match(/Visual Uncertainty \/ Ambiguities:\s*([^\r\n]*)/i);
  if (!match) return false;
  const value = match[1].trim();
  return Boolean(value) && !/^none\b/i.test(value);
}

/**
 * Parses raw document buffer into structured text and title based on file format.
 * Supports text & table-aware PDFs, scanned PDF OCR fallback, standalone image OCR,
 * Excel (.xlsx), Word (.docx), Markdown, Plain Text, JSON, and CSV.
 */
export async function parseDocumentBuffer(
  filename: string,
  buffer: Buffer,
  mimeType?: string,
  options?: ParseDocumentOptions,
): Promise<ParsedDocument> {
  if (!buffer || buffer.length === 0) {
    throw new Error('DOCUMENT_BUFFER_EMPTY: The uploaded file is empty (0 bytes).');
  }

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const baseName = filename.replace(/\.[^/.]+$/, '').trim() || 'Untitled Document';
  const normalizedMime = (mimeType || '').trim().toLowerCase();

  // 1. Standalone Image Document OCR (PNG, JPEG, WebP, GIF)
  if (
    /^image\/(jpeg|jpg|png|webp|gif)$/.test(normalizedMime) ||
    ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
  ) {
    const resolvedMime = normalizedMime && normalizedMime !== 'image/jpg'
      ? normalizedMime
      : ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : 'image/jpeg';

    const validation = validateImageAttachment({
      mimeType: resolvedMime,
      data: buffer.toString('base64'),
      name: filename,
    });
    if (!validation.valid || !validation.attachment) {
      throw new Error(validation.error || 'IMAGE_VALIDATION_FAILED');
    }

    const ocrExtractor = await resolveDefaultOcrExtractor(options);
    const contextPrompt =
      options?.userPrompt ||
      `Transcribe verbatim text, tabular data, formulas/equations, charts, and diagrams from image "${filename}". Explicitly note any blurry or uncertain characters.`;
    const result = await ocrExtractor(validation.attachment, contextPrompt);

    if (result.status !== 'success' || !result.rawAnalysis?.trim()) {
      const code = result.errorCode === 'NO_VISION_SPECIALIST_AVAILABLE'
        ? 'IMAGE_OCR_UNAVAILABLE'
        : 'IMAGE_OCR_FAILED';
      throw new Error(`${code}: ${result.errorMessage || 'Live vision OCR did not return readable content.'}`);
    }

    return {
      title: baseName,
      content: result.rawAnalysis.trim(),
      format: 'ocr_image',
      metadata: {
        extractionMethod: 'vision_specialist_ocr',
        ocrPagesProcessed: 1,
        ocrProvider: result.specialistProvider,
        ocrModel: result.specialistModel,
        uncertaintyDetected: hasVisualUncertaintyWarning(result.rawAnalysis),
      },
    };
  }

  // 2. Excel Spreadsheets (.xlsx)
  if (
    ext === 'xlsx' ||
    normalizedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);

      const sheetSections: string[] = [];
      let totalTables = 0;

      for (const worksheet of workbook.worksheets) {
        if (!worksheet || worksheet.rowCount === 0) continue;
        const rows: string[][] = [];
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const values: string[] = [];
          const colCount = Math.max(row.cellCount, worksheet.columnCount);
          for (let col = 1; col <= colCount; col++) {
            values.push(formatExcelCellValue(row.getCell(col).value));
          }
          if (values.some((cell) => cell.trim().length > 0)) {
            rows.push(values);
          }
        });

        const tableMd = format2DTableAsMarkdown(rows);
        if (tableMd) {
          totalTables += 1;
          sheetSections.push(`## Worksheet: ${worksheet.name}\n\n${tableMd}`);
        }
      }

      if (sheetSections.length === 0) {
        throw new Error('XLSX_CONTENT_EMPTY: Excel workbook contains no readable rows or worksheets.');
      }

      return {
        title: baseName,
        content: sheetSections.join('\n\n'),
        format: 'xlsx',
        metadata: {
          extractionMethod: 'exceljs_structured_tables',
          tablesExtracted: totalTables,
        },
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('XLSX_')) {
        throw err;
      }
      throw new Error(`XLSX_PARSE_FAILED: Failed to parse Excel workbook: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Word Documents (.docx)
  if (
    ext === 'docx' ||
    normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    try {
      const htmlRes = await mammoth.convertToHtml({ buffer });
      let markdown = convertMammothHtmlToStructuredMarkdown(htmlRes.value || '');
      if (!markdown) {
        const rawRes = await mammoth.extractRawText({ buffer });
        markdown = (rawRes.value || '').trim();
      }
      if (!markdown) {
        throw new Error('DOCX_CONTENT_EMPTY: Word document contains no readable text.');
      }

      const h1Match = markdown.match(/^#\s+(.+)$/m);
      return {
        title: h1Match ? h1Match[1].trim() : baseName,
        content: markdown,
        format: 'docx',
        metadata: {
          extractionMethod: 'mammoth_structured_docx',
          tablesExtracted: (markdown.match(/^\| ---/gm) || []).length,
        },
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('DOCX_')) {
        throw err;
      }
      throw new Error(`DOCX_PARSE_FAILED: Failed to parse Word document: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Table-Aware PDF + Scanned-PDF Vision OCR Fallback
  if (ext === 'pdf' || normalizedMime === 'application/pdf') {
    let parser: any = null;
    try {
      const pdfParseModule = await import('pdf-parse');
      let extractedText = '';
      let totalPages = 1;
      const extractedTablesMarkdown: string[] = [];

      if (typeof (pdfParseModule as any).PDFParse === 'function') {
        const ParserClass = (pdfParseModule as any).PDFParse;
        parser = new ParserClass({ data: buffer });
        await parser.load();

        const textResult = await parser.getText();
        extractedText = typeof textResult === 'string' ? textResult : (textResult?.text || '');
        if (typeof textResult?.total === 'number' && textResult.total > 0) {
          totalPages = textResult.total;
        } else if (Array.isArray(textResult?.pages) && textResult.pages.length > 0) {
          totalPages = textResult.pages.length;
        }

        // Attempt native table extraction from PDF vector structure
        if (typeof parser.getTable === 'function') {
          try {
            const tableRes = await parser.getTable();
            const tablePages: Array<{ num?: number; tables?: string[][][] }> = Array.isArray(tableRes?.pages)
              ? tableRes.pages
              : [];
            for (const pageEntry of tablePages) {
              if (!Array.isArray(pageEntry.tables)) continue;
              for (const rawTable of pageEntry.tables) {
                if (!Array.isArray(rawTable) || rawTable.length < 2) continue;
                const md = format2DTableAsMarkdown(rawTable);
                if (md) {
                  const pageLabel = pageEntry.num ? `Page ${pageEntry.num}` : 'Document';
                  extractedTablesMarkdown.push(`### Extracted Table (${pageLabel})\n\n${md}`);
                }
              }
            }
          } catch {
            // Table detection is supplemental; continue with extracted text
          }
        }
      } else if (typeof (pdfParseModule as any).default === 'function') {
        const parseFn = (pdfParseModule as any).default;
        const data = await parseFn(buffer);
        extractedText = data.text || '';
      } else {
        throw new Error('PDF_PARSER_UNAVAILABLE: No compatible PDF extraction engine found.');
      }

      const cleanText = extractedText.replace(/\r\n/g, '\n').trim();
      const nonWhitespaceChars = cleanText.replace(/\s+/g, '').length;
      const avgCharsPerPage = totalPages > 0 ? nonWhitespaceChars / totalPages : nonWhitespaceChars;
      const needsOcr = nonWhitespaceChars < 10 || (totalPages >= 1 && avgCharsPerPage < 25 && extractedTablesMarkdown.length === 0);

      if (!needsOcr) {
        const combinedContent = extractedTablesMarkdown.length > 0
          ? `${cleanText}\n\n## Structured Tables Extracted from PDF\n\n${extractedTablesMarkdown.join('\n\n')}`
          : cleanText;
        return {
          title: baseName,
          content: combinedContent,
          format: 'pdf',
          metadata: {
            extractionMethod: extractedTablesMarkdown.length > 0 ? 'pdf_parse_text_and_tables' : 'pdf_parse_text',
            pageCount: totalPages,
            tablesExtracted: extractedTablesMarkdown.length,
          },
        };
      }

      // Scanned or image-only PDF: render pages via getScreenshot() and run live Vision Specialist OCR
      if (!parser || typeof parser.getScreenshot !== 'function') {
        throw new Error('PDF_OCR_UNAVAILABLE: PDF contains no selectable text and page image rendering is unavailable.');
      }

      const maxOcrPages = resolveBoundedIntegerSetting(process.env, 'TWINMIND_OCR_MAX_PDF_PAGES', 8, 1, 25);
      const shots = await parser.getScreenshot({ scale: 1.5, first: maxOcrPages });
      const renderedPages: Array<{ pageNumber?: number; data?: Uint8Array | Buffer; dataUrl?: string }> =
        Array.isArray(shots?.pages) ? shots.pages : [];

      if (renderedPages.length === 0) {
        throw new Error('PDF_OCR_FAILED: Could not render PDF pages for Vision OCR.');
      }

      const ocrExtractor = await resolveDefaultOcrExtractor(options);
      const ocrSections: string[] = [];
      let ocrProvider: string | undefined;
      let ocrModel: string | undefined;
      let uncertaintyDetected = false;
      const ocrErrors: string[] = [];

      for (let i = 0; i < renderedPages.length; i++) {
        if (options?.signal?.aborted) {
          throw new Error('PDF_OCR_ABORTED: OCR interrupted by caller abort signal.');
        }
        const page = renderedPages[i];
        const pageNum = page.pageNumber || i + 1;
        let base64Png = '';
        if (page.data && page.data.length > 0) {
          base64Png = Buffer.from(page.data).toString('base64');
        } else if (typeof page.dataUrl === 'string' && page.dataUrl.includes(',')) {
          base64Png = page.dataUrl.split(',')[1] || '';
        }
        if (!base64Png) continue;

        const ocrResult = await ocrExtractor(
          {
            mimeType: 'image/png',
            data: base64Png,
            name: `${baseName}_page_${pageNum}.png`,
          },
          options?.userPrompt || `OCR transcribe page ${pageNum} of PDF "${filename}", preserving tables, equations, and flagging unreadable areas.`,
        );

        if (ocrResult.status === 'success' && ocrResult.rawAnalysis?.trim()) {
          ocrProvider = ocrResult.specialistProvider || ocrProvider;
          ocrModel = ocrResult.specialistModel || ocrModel;
          if (hasVisualUncertaintyWarning(ocrResult.rawAnalysis)) {
            uncertaintyDetected = true;
          }
          ocrSections.push(`--- [Page ${pageNum} Vision OCR] ---\n${ocrResult.rawAnalysis.trim()}`);
        } else {
          ocrErrors.push(ocrResult.errorMessage || ocrResult.errorCode || `Page ${pageNum} OCR failed`);
        }
      }

      if (ocrSections.length === 0) {
        throw new Error(
          `PDF_OCR_UNAVAILABLE: No selectable text found in the PDF and live Vision OCR failed (${ocrErrors[0] || 'no vision specialist configured'}).`,
        );
      }

      const mergedOcr = [cleanText, ...ocrSections].filter((part) => part && part.trim()).join('\n\n');
      return {
        title: baseName,
        content: mergedOcr,
        format: 'pdf',
        metadata: {
          extractionMethod: 'pdf_vision_ocr_fallback',
          pageCount: totalPages,
          ocrPagesProcessed: ocrSections.length,
          ocrProvider,
          ocrModel,
          uncertaintyDetected,
        },
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('PDF_')) {
        throw err;
      }
      throw new Error(`PDF_PARSE_FAILED: Failed to extract text from PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (parser && typeof parser.destroy === 'function') {
        try {
          await parser.destroy();
        } catch {}
      }
    }
  }

  if (ext === 'md' || ext === 'markdown' || normalizedMime === 'text/markdown') {
    const rawText = buffer.toString('utf-8').trim();
    if (!rawText) throw new Error('DOCUMENT_TEXT_EMPTY: Markdown file contains no text.');

    const headingMatch = rawText.match(/^#\s+(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : baseName;

    return {
      title,
      content: rawText,
      format: 'markdown',
      metadata: { extractionMethod: 'utf8_markdown' },
    };
  }

  if (ext === 'txt' || normalizedMime === 'text/plain') {
    const rawText = buffer.toString('utf-8').trim();
    if (!rawText) throw new Error('DOCUMENT_TEXT_EMPTY: Text file contains no text.');

    return {
      title: baseName,
      content: rawText,
      format: 'text',
      metadata: { extractionMethod: 'utf8_text' },
    };
  }

  if (ext === 'json' || normalizedMime === 'application/json') {
    const rawText = buffer.toString('utf-8').trim();
    try {
      const parsed = JSON.parse(rawText);
      const formatted = JSON.stringify(parsed, null, 2);
      return {
        title: baseName,
        content: formatted,
        format: 'json',
        metadata: { extractionMethod: 'json_pretty_print' },
      };
    } catch {
      throw new Error('JSON_PARSE_FAILED: The file content is not valid JSON.');
    }
  }

  if (ext === 'csv' || normalizedMime === 'text/csv') {
    const rawText = buffer.toString('utf-8').trim();
    if (!rawText) throw new Error('DOCUMENT_TEXT_EMPTY: CSV file contains no text.');

    return {
      title: baseName,
      content: rawText,
      format: 'csv',
      metadata: { extractionMethod: 'utf8_csv' },
    };
  }

  throw new Error(
    `UNSUPPORTED_FILE_FORMAT: Unsupported file format ".${ext}". Supported formats are: PDF (.pdf), Excel (.xlsx), Word (.docx), Images (.png, .jpg, .webp, .gif), Markdown (.md), Plain Text (.txt), JSON (.json), and CSV (.csv).`
  );
}

/**
 * Intelligent semantic chunking of long documents to maintain embedding coherence.
 */
export function chunkDocumentContent(
  title: string,
  text: string,
  options: { maxChunkSize?: number; overlap?: number } = {}
): DocumentChunk[] {
  const maxChunkSize = options.maxChunkSize || 2500;
  const overlap = options.overlap || 200;

  if (text.length <= maxChunkSize) {
    return [
      {
        title,
        content: text,
        chunkIndex: 1,
        totalChunks: 1,
      },
    ];
  }

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = '';

  for (const para of paragraphs) {
    const candidate = currentChunk ? `${currentChunk}\n\n${para}` : para;
    if (candidate.length <= maxChunkSize) {
      currentChunk = candidate;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      if (para.length > maxChunkSize) {
        let remaining = para;
        while (remaining.length > 0) {
          if (remaining.length <= maxChunkSize) {
            currentChunk = remaining;
            break;
          }
          let splitIdx = remaining.lastIndexOf('. ', maxChunkSize);
          if (splitIdx < maxChunkSize * 0.5) {
            splitIdx = remaining.lastIndexOf('\n', maxChunkSize);
          }
          if (splitIdx < maxChunkSize * 0.5) {
            splitIdx = remaining.lastIndexOf(' ', maxChunkSize);
          }
          if (splitIdx < maxChunkSize * 0.3) {
            splitIdx = maxChunkSize;
          }
          chunks.push(remaining.slice(0, splitIdx + 1).trim());
          remaining = remaining.slice(Math.max(0, splitIdx + 1 - overlap)).trim();
        }
      } else {
        currentChunk = para;
      }
    }
  }

  if (currentChunk && currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  const totalChunks = chunks.length;
  return chunks.map((chunkText, idx) => ({
    title: totalChunks > 1 ? `${title} (Part ${idx + 1}/${totalChunks})` : title,
    content: chunkText,
    chunkIndex: idx + 1,
    totalChunks,
  }));
}

/**
 * Durable ingestion of document chunks into Neon pgvector Knowledge Vault.
 */
export async function ingestDocumentChunks(params: {
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  source: 'file' | 'web';
  format?: string;
  sourceReference?: string;
  metadata?: ParsedDocumentMetadata;
}): Promise<IngestionResult> {
  const {
    title,
    content,
    category = 'reference',
    tags = [],
    source,
    format = 'text',
    sourceReference = '',
    metadata,
  } = params;

  if (!content || !content.trim()) {
    throw new Error('INGESTION_CONTENT_EMPTY: Content to ingest cannot be empty.');
  }

  const chunks = chunkDocumentContent(title, content);
  let documentsCreated = 0;

  const baseTags = [
    ...tags,
    `source:${source}`,
    `format:${format}`,
  ];
  if (sourceReference) {
    baseTags.push(`ref:${sourceReference.slice(0, 100)}`);
  }
  const sanitizedTags = Array.from(new Set(baseTags.map((t) => t.trim()).filter(Boolean)));

  for (const chunk of chunks) {
    const addResult = await knowledgeService.addDocument({
      title: chunk.title,
      content: chunk.content,
      category,
      tags: sanitizedTags,
    });
    if (addResult.success) {
      documentsCreated++;
    }
  }

  return {
    success: documentsCreated > 0,
    documentsCreated,
    primaryTitle: title,
    category,
    totalCharacters: content.length,
    totalChunks: chunks.length,
    tags: sanitizedTags,
    ...(metadata ? { metadata } : {}),
  };
}

/**
 * Fetches, parses, and ingests live public webpage into Knowledge Vault.
 */
export async function fetchAndIngestWebPage(params: {
  url: string;
  category?: string;
  tags?: string[];
}): Promise<IngestionResult> {
  const { url, category = 'reference', tags = [] } = params;

  const safeUrl = canonicalHttpUrl(url);
  if (!safeUrl) {
    throw new Error(
      'INVALID_WEB_URL: Provided URL is invalid, non-public, or refers to a restricted internal address.'
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    response = await fetch(safeUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TwinMindBot/1.0; +https://twinmind.ai)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`WEB_FETCH_TIMEOUT: Fetch timed out after 15 seconds for ${safeUrl}`);
    }
    throw new Error(`WEB_FETCH_FAILED: Network error fetching ${safeUrl}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`WEB_HTTP_ERROR: Received HTTP ${response.status} (${response.statusText}) from ${safeUrl}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml+xml')) {
    throw new Error(`UNSUPPORTED_CONTENT_TYPE: Remote server returned "${contentType}". Only HTML and plain text web pages are supported.`);
  }

  const rawHtml = await response.text();
  if (!rawHtml || rawHtml.trim().length === 0) {
    throw new Error(`WEB_BODY_EMPTY: Received empty response from ${safeUrl}`);
  }

  const { title, text } = extractTextAndTitleFromHtml(rawHtml);
  if (!text || text.length < 50) {
    throw new Error(`WEB_CONTENT_INSUFFICIENT: Web page at ${safeUrl} contained insufficient readable text to ingest (${text.length} characters found).`);
  }

  const parsedHostname = new URL(safeUrl).hostname;
  const webTags = [...tags, `domain:${parsedHostname}`];

  return await ingestDocumentChunks({
    title,
    content: text,
    category,
    tags: webTags,
    source: 'web',
    format: 'html',
    sourceReference: safeUrl,
  });
}

export interface BatchFileInput {
  filename: string;
  buffer: Buffer;
  mimeType?: string;
}

export interface BatchIngestFileResult {
  filename: string;
  archiveSource?: string;
  status: 'ingested' | 'failed';
  documentsCreated: number;
  totalCharacters: number;
  totalChunks: number;
  format?: string;
  title?: string;
  error?: string;
  code?: string;
}

export interface BatchIngestResult {
  success: boolean;
  overallStatus: 'success' | 'partial' | 'failed';
  totalFilesProcessed: number;
  succeededCount: number;
  failedCount: number;
  totalDocumentsCreated: number;
  results: BatchIngestFileResult[];
}

function normalizeArchiveEntryPath(rawPath: string): string {
  return String(rawPath || '').replace(/\\/g, '/').trim();
}

export function isUnsafeZipEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath.includes('\0')) return true;
  const normalized = normalizeArchiveEntryPath(entryPath);
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return true;
  }
  const segments = normalized.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return true;
  return segments.some((seg) => seg === '..' || seg === '.');
}

export function isIgnorableArchiveMetadataEntry(entryPath: string, isDir: boolean): boolean {
  if (isDir) return true;
  const normalized = normalizeArchiveEntryPath(entryPath);
  if (!normalized) return true;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((seg) => seg === '__MACOSX')) return true;
  const base = segments[segments.length - 1] || '';
  if (!base || base === '.DS_Store' || base.startsWith('._')) return true;
  return false;
}

export async function extractZipFileEntries(
  zipBuffer: Buffer,
  options?: {
    maxFiles?: number;
    maxTotalBytes?: number;
    archiveName?: string;
  },
): Promise<Array<{ filename: string; buffer: Buffer; archiveSource: string }>> {
  const maxFiles = options?.maxFiles ?? resolveBoundedIntegerSetting(
    process.env,
    'TWINMIND_BATCH_IMPORT_MAX_FILES',
    20,
    1,
    50,
  );
  const maxTotalMb = resolveBoundedIntegerSetting(
    process.env,
    'TWINMIND_BATCH_IMPORT_MAX_MB',
    50,
    1,
    100,
  );
  const maxTotalBytes = options?.maxTotalBytes ?? maxTotalMb * 1024 * 1024;
  const archiveSource = options?.archiveName || 'archive.zip';

  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(zipBuffer);
  } catch (err: unknown) {
    throw new Error(
      `ZIP_ARCHIVE_INVALID: Could not open ZIP archive "${archiveSource}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const candidateEntries: Array<{ filename: string; entry: JSZip.JSZipObject }> = [];
  for (const [entryPath, entry] of Object.entries(archive.files)) {
    if (isIgnorableArchiveMetadataEntry(entryPath, entry.dir)) {
      continue;
    }
    if (isUnsafeZipEntryPath(entryPath)) {
      throw new Error(
        `ZIP_PATH_TRAVERSAL_REJECTED: Archive "${archiveSource}" contains unsafe entry path "${entryPath}".`,
      );
    }
    const baseName = normalizeArchiveEntryPath(entryPath).split('/').pop() || entryPath;
    candidateEntries.push({ filename: baseName, entry });
  }

  if (candidateEntries.length === 0) {
    throw new Error(`ZIP_ARCHIVE_EMPTY: Archive "${archiveSource}" contains no ingestible files.`);
  }

  if (candidateEntries.length > maxFiles) {
    throw new Error(
      `BATCH_FILE_LIMIT_EXCEEDED: Archive "${archiveSource}" contains ${candidateEntries.length} files, exceeding configured limit of ${maxFiles}.`,
    );
  }

  const extracted: Array<{ filename: string; buffer: Buffer; archiveSource: string }> = [];
  let runningBytes = 0;

  for (const item of candidateEntries) {
    const fileBuf = await item.entry.async('nodebuffer');
    runningBytes += fileBuf.length;
    if (runningBytes > maxTotalBytes) {
      throw new Error(
        `ZIP_UNCOMPRESSED_SIZE_EXCEEDED: Extracted contents of "${archiveSource}" exceed configured ceiling of ${Math.round(maxTotalBytes / (1024 * 1024))}MB.`,
      );
    }
    extracted.push({
      filename: item.filename,
      buffer: fileBuf,
      archiveSource,
    });
  }

  return extracted;
}

export async function ingestDocumentBatch(
  files: BatchFileInput[],
  options?: {
    category?: string;
    tags?: string[];
    parseOptions?: ParseDocumentOptions;
  },
): Promise<BatchIngestResult> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('BATCH_FILES_REQUIRED: At least one file is required for batch ingestion.');
  }

  const maxFiles = resolveBoundedIntegerSetting(
    process.env,
    'TWINMIND_BATCH_IMPORT_MAX_FILES',
    20,
    1,
    50,
  );
  const maxTotalMb = resolveBoundedIntegerSetting(
    process.env,
    'TWINMIND_BATCH_IMPORT_MAX_MB',
    50,
    1,
    100,
  );
  const maxTotalBytes = maxTotalMb * 1024 * 1024;

  const targetCategory = typeof options?.category === 'string' && options.category.trim()
    ? options.category.trim().toLowerCase().replace(/\s+/g, '_')
    : 'reference';
  const baseTags = Array.isArray(options?.tags) ? options.tags : [];

  const expandedItems: Array<{
    filename: string;
    buffer: Buffer;
    mimeType?: string;
    archiveSource?: string;
  }> = [];
  const results: BatchIngestFileResult[] = [];
  let totalDecodedBytes = 0;

  for (const file of files) {
    const fname = String(file?.filename || '').trim();
    const mime = String(file?.mimeType || '').toLowerCase();
    const isZip = fname.toLowerCase().endsWith('.zip')
      || mime === 'application/zip'
      || mime === 'application/x-zip-compressed';

    if (!fname || !Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) {
      results.push({
        filename: fname || '(unnamed)',
        status: 'failed',
        documentsCreated: 0,
        totalCharacters: 0,
        totalChunks: 0,
        code: 'FILE_CONTENT_EMPTY',
        error: 'FILE_CONTENT_EMPTY: Uploaded file is empty or missing content.',
      });
      continue;
    }

    if (isZip) {
      try {
        const remainingSlots = Math.max(1, maxFiles - expandedItems.length);
        const remainingBytes = Math.max(1, maxTotalBytes - totalDecodedBytes);
        const entries = await extractZipFileEntries(file.buffer, {
          maxFiles: remainingSlots,
          maxTotalBytes: remainingBytes,
          archiveName: fname,
        });
        for (const entry of entries) {
          totalDecodedBytes += entry.buffer.length;
          expandedItems.push({
            filename: entry.filename,
            buffer: entry.buffer,
            archiveSource: entry.archiveSource,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const codeMatch = message.match(/^([A-Z0-9_]+):/);
        results.push({
          filename: fname,
          status: 'failed',
          documentsCreated: 0,
          totalCharacters: 0,
          totalChunks: 0,
          code: codeMatch?.[1] || 'ZIP_EXTRACT_FAILED',
          error: message,
        });
      }
      continue;
    }

    totalDecodedBytes += file.buffer.length;
    if (totalDecodedBytes > maxTotalBytes) {
      results.push({
        filename: fname,
        status: 'failed',
        documentsCreated: 0,
        totalCharacters: 0,
        totalChunks: 0,
        code: 'BATCH_SIZE_EXCEEDED',
        error: `BATCH_SIZE_EXCEEDED: Combined batch payload exceeds configured ${maxTotalMb}MB ceiling.`,
      });
      continue;
    }

    expandedItems.push({
      filename: fname,
      buffer: file.buffer,
      mimeType: file.mimeType,
    });
  }

  if (expandedItems.length > maxFiles) {
    throw new Error(
      `BATCH_FILE_LIMIT_EXCEEDED: Batch contains ${expandedItems.length} total files, exceeding configured limit of ${maxFiles}.`,
    );
  }

  for (const item of expandedItems) {
    if (options?.parseOptions?.signal?.aborted) {
      results.push({
        filename: item.filename,
        ...(item.archiveSource ? { archiveSource: item.archiveSource } : {}),
        status: 'failed',
        documentsCreated: 0,
        totalCharacters: 0,
        totalChunks: 0,
        code: 'BATCH_INGESTION_ABORTED',
        error: 'BATCH_INGESTION_ABORTED: Operation cancelled before processing file.',
      });
      continue;
    }

    try {
      const parsed = await parseDocumentBuffer(
        item.filename,
        item.buffer,
        item.mimeType,
        options?.parseOptions,
      );
      const itemTags = item.archiveSource
        ? [...baseTags, `archive:${item.archiveSource.slice(0, 80)}`]
        : baseTags;

      const ingestion = await ingestDocumentChunks({
        title: parsed.title,
        content: parsed.content,
        category: targetCategory,
        tags: itemTags,
        source: 'file',
        format: parsed.format,
        sourceReference: item.archiveSource ? `${item.archiveSource}/${item.filename}` : item.filename,
        metadata: parsed.metadata,
      });

      if (!ingestion.success || ingestion.documentsCreated === 0) {
        results.push({
          filename: item.filename,
          ...(item.archiveSource ? { archiveSource: item.archiveSource } : {}),
          status: 'failed',
          documentsCreated: 0,
          totalCharacters: parsed.content.length,
          totalChunks: ingestion.totalChunks,
          format: parsed.format,
          title: parsed.title,
          code: 'PERSISTENCE_FAILED',
          error: 'PERSISTENCE_FAILED: Parsed document could not be stored in Neon PostgreSQL Knowledge Vault.',
        });
      } else {
        results.push({
          filename: item.filename,
          ...(item.archiveSource ? { archiveSource: item.archiveSource } : {}),
          status: 'ingested',
          documentsCreated: ingestion.documentsCreated,
          totalCharacters: ingestion.totalCharacters,
          totalChunks: ingestion.totalChunks,
          format: parsed.format,
          title: parsed.title,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const codeMatch = message.match(/^([A-Z0-9_]+):/);
      results.push({
        filename: item.filename,
        ...(item.archiveSource ? { archiveSource: item.archiveSource } : {}),
        status: 'failed',
        documentsCreated: 0,
        totalCharacters: 0,
        totalChunks: 0,
        code: codeMatch?.[1] || 'FILE_INGESTION_FAILED',
        error: message,
      });
    }
  }

  const succeededCount = results.filter((r) => r.status === 'ingested').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  const totalDocumentsCreated = results.reduce((sum, r) => sum + r.documentsCreated, 0);
  const overallStatus: 'success' | 'partial' | 'failed' =
    succeededCount > 0 && failedCount === 0
      ? 'success'
      : succeededCount > 0
        ? 'partial'
        : 'failed';

  return {
    success: succeededCount > 0,
    overallStatus,
    totalFilesProcessed: results.length,
    succeededCount,
    failedCount,
    totalDocumentsCreated,
    results,
  };
}
