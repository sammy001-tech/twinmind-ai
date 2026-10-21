import { canonicalHttpUrl } from '../utils/researchEvidence.ts';
import { knowledgeService } from '../db/knowledgeService.ts';

export interface ParsedDocument {
  title: string;
  content: string;
  format: 'pdf' | 'markdown' | 'text' | 'json' | 'csv';
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

/**
 * Parses raw document buffer into structured text and title based on file format.
 */
export async function parseDocumentBuffer(
  filename: string,
  buffer: Buffer,
  mimeType?: string
): Promise<ParsedDocument> {
  if (!buffer || buffer.length === 0) {
    throw new Error('DOCUMENT_BUFFER_EMPTY: The uploaded file is empty (0 bytes).');
  }

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const baseName = filename.replace(/\.[^/.]+$/, '').trim() || 'Untitled Document';

  if (ext === 'pdf' || mimeType === 'application/pdf') {
    try {
      const pdfParseModule = await import('pdf-parse');
      let extractedText = '';

      if (typeof (pdfParseModule as any).PDFParse === 'function') {
        const ParserClass = (pdfParseModule as any).PDFParse;
        const parser = new ParserClass({ data: buffer });
        await parser.load();
        const textResult = await parser.getText();
        extractedText = typeof textResult === 'string' ? textResult : (textResult?.text || '');
      } else if (typeof (pdfParseModule as any).default === 'function') {
        const parseFn = (pdfParseModule as any).default;
        const data = await parseFn(buffer);
        extractedText = data.text || '';
      } else {
        throw new Error('PDF_PARSER_UNAVAILABLE: No compatible PDF extraction engine found.');
      }

      const cleanText = extractedText.replace(/\r\n/g, '\n').trim();
      if (!cleanText || cleanText.length < 10) {
        throw new Error('PDF_TEXT_EMPTY: No readable text found in the PDF. Scanned images without OCR are not supported.');
      }

      return {
        title: baseName,
        content: cleanText,
        format: 'pdf',
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('PDF_')) {
        throw err;
      }
      throw new Error(`PDF_PARSE_FAILED: Failed to extract text from PDF: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (ext === 'md' || ext === 'markdown' || mimeType === 'text/markdown') {
    const rawText = buffer.toString('utf-8').trim();
    if (!rawText) throw new Error('DOCUMENT_TEXT_EMPTY: Markdown file contains no text.');

    // Look for first # Heading for title
    const headingMatch = rawText.match(/^#\s+(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : baseName;

    return {
      title,
      content: rawText,
      format: 'markdown',
    };
  }

  if (ext === 'txt' || mimeType === 'text/plain') {
    const rawText = buffer.toString('utf-8').trim();
    if (!rawText) throw new Error('DOCUMENT_TEXT_EMPTY: Text file contains no text.');

    return {
      title: baseName,
      content: rawText,
      format: 'text',
    };
  }

  if (ext === 'json' || mimeType === 'application/json') {
    const rawText = buffer.toString('utf-8').trim();
    try {
      const parsed = JSON.parse(rawText);
      const formatted = JSON.stringify(parsed, null, 2);
      return {
        title: baseName,
        content: formatted,
        format: 'json',
      };
    } catch {
      throw new Error('JSON_PARSE_FAILED: The file content is not valid JSON.');
    }
  }

  if (ext === 'csv' || mimeType === 'text/csv') {
    const rawText = buffer.toString('utf-8').trim();
    if (!rawText) throw new Error('DOCUMENT_TEXT_EMPTY: CSV file contains no text.');

    return {
      title: baseName,
      content: rawText,
      format: 'csv',
    };
  }

  throw new Error(
    `UNSUPPORTED_FILE_FORMAT: Unsupported file format ".${ext}". Supported formats are: PDF (.pdf), Markdown (.md), Plain Text (.txt), JSON (.json), and CSV (.csv).`
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
      // Current chunk is full
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      // If a single paragraph itself is larger than maxChunkSize, split by sentence or fixed window
      if (para.length > maxChunkSize) {
        let remaining = para;
        while (remaining.length > 0) {
          if (remaining.length <= maxChunkSize) {
            currentChunk = remaining;
            break;
          }
          // Find last period before maxChunkSize
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
}): Promise<IngestionResult> {
  const {
    title,
    content,
    category = 'reference',
    tags = [],
    source,
    format = 'text',
    sourceReference = '',
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
  // Deduplicate tags
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
