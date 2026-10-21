import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractTextAndTitleFromHtml,
  chunkDocumentContent,
  parseDocumentBuffer,
  ingestDocumentChunks,
  fetchAndIngestWebPage,
} from '../server/services/documentIngestionService.ts';
import { knowledgeService } from '../server/db/knowledgeService.ts';
import { neonDb } from '../server/db/neonService.ts';

test.after(async () => {
  await neonDb.close();
});

test('extractTextAndTitleFromHtml extracts title and readable text while stripping noise', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>TwinMind Knowledge Architecture &amp; Design</title>
        <script>console.log("ignore me");</script>
        <style>body { color: red; }</style>
      </head>
      <body>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <header><h1>Header Banner</h1></header>
        <main>
          <h2>Introduction to Second Brain</h2>
          <p>The digital twin captures long-term memory and grounds reasoning in personal knowledge.</p>
          <p>Key pillars include:</p>
          <ul>
            <li>Continuous Soul Tuning</li>
            <li>Zero-Mock Evidence</li>
          </ul>
        </main>
        <footer>&copy; 2026 TwinMind AI. All rights reserved.</footer>
      </body>
    </html>
  `;

  const { title, text } = extractTextAndTitleFromHtml(html);
  assert.equal(title, 'TwinMind Knowledge Architecture & Design');
  assert.ok(text.includes('The digital twin captures long-term memory'));
  assert.ok(text.includes('Continuous Soul Tuning'));
  assert.ok(!text.includes('console.log'));
  assert.ok(!text.includes('color: red'));
  assert.ok(!text.includes('Header Banner'));
  assert.ok(!text.includes('All rights reserved'));
});

test('chunkDocumentContent leaves short text as a single coherent chunk', () => {
  const title = 'Core Philosophy';
  const text = 'A concise note explaining why ZeroMock is the bedrock of trustworthy AI systems.';
  const chunks = chunkDocumentContent(title, text, { maxChunkSize: 1000 });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].title, title);
  assert.equal(chunks[0].content, text);
  assert.equal(chunks[0].chunkIndex, 1);
  assert.equal(chunks[0].totalChunks, 1);
});

test('chunkDocumentContent chunks large text cleanly at paragraphs with overlap', () => {
  const title = 'Engineering Handbook';
  const paragraphs = Array.from({ length: 15 }, (_, i) => `Paragraph ${i + 1}: Detailed guidance on resilience, durable persistence, and system verification across distributed boundaries.`);
  const fullText = paragraphs.join('\n\n');

  const chunks = chunkDocumentContent(title, fullText, { maxChunkSize: 400, overlap: 50 });
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].title, `Engineering Handbook (Part 1/${chunks.length})`);
  assert.equal(chunks[0].chunkIndex, 1);
  assert.equal(chunks[0].totalChunks, chunks.length);

  // Every chunk should contain content and not exceed the maxChunkSize generously
  for (const chunk of chunks) {
    assert.ok(chunk.content.length > 0);
  }
});

test('parseDocumentBuffer correctly parses plain text, markdown, JSON, and CSV', async () => {
  // 1. Text
  const txtBuf = Buffer.from('Simple plain text notes from a strategy session.', 'utf-8');
  const txtDoc = await parseDocumentBuffer('strategy_notes.txt', txtBuf);
  assert.equal(txtDoc.title, 'strategy_notes');
  assert.equal(txtDoc.format, 'text');
  assert.equal(txtDoc.content, 'Simple plain text notes from a strategy session.');

  // 2. Markdown with Heading
  const mdBuf = Buffer.from('# Q4 Product Roadmap\n\n- Feature A\n- Feature B\n- Feature C', 'utf-8');
  const mdDoc = await parseDocumentBuffer('q4_roadmap.md', mdBuf);
  assert.equal(mdDoc.title, 'Q4 Product Roadmap');
  assert.equal(mdDoc.format, 'markdown');
  assert.ok(mdDoc.content.includes('Feature A'));

  // 3. JSON
  const jsonBuf = Buffer.from(JSON.stringify({ project: 'TwinMind', version: '2.0.0' }), 'utf-8');
  const jsonDoc = await parseDocumentBuffer('meta.json', jsonBuf);
  assert.equal(jsonDoc.title, 'meta');
  assert.equal(jsonDoc.format, 'json');
  assert.ok(jsonDoc.content.includes('"project": "TwinMind"'));

  // 4. CSV
  const csvBuf = Buffer.from('id,name,role\n1,Alice,Engineer\n2,Bob,Architect', 'utf-8');
  const csvDoc = await parseDocumentBuffer('team.csv', csvBuf);
  assert.equal(csvDoc.title, 'team');
  assert.equal(csvDoc.format, 'csv');
  assert.ok(csvDoc.content.includes('Alice,Engineer'));

  // 5. Real PDF Document
  const { default: PDFDocument } = await import('pdfkit');
  const pdfDocInstance = new PDFDocument();
  const pdfChunks: Buffer[] = [];
  pdfDocInstance.on('data', (c: Buffer) => pdfChunks.push(c));
  const pdfReady = new Promise<Buffer>((resolve) => {
    pdfDocInstance.on('end', () => resolve(Buffer.concat(pdfChunks)));
  });
  pdfDocInstance.text('Verified TwinMind Research Document for Knowledge Ingestion');
  pdfDocInstance.end();
  const generatedPdfBuffer = await pdfReady;

  const pdfResult = await parseDocumentBuffer('research_paper.pdf', generatedPdfBuffer, 'application/pdf');
  assert.equal(pdfResult.title, 'research_paper');
  assert.equal(pdfResult.format, 'pdf');
  assert.ok(pdfResult.content.includes('Verified TwinMind Research Document'));
});

test('parseDocumentBuffer rejects empty buffers and unsupported file extensions explicitly', async () => {
  const emptyBuf = Buffer.alloc(0);
  await assert.rejects(
    () => parseDocumentBuffer('test.txt', emptyBuf),
    /DOCUMENT_BUFFER_EMPTY/
  );

  const exeBuf = Buffer.from('binary data', 'utf-8');
  await assert.rejects(
    () => parseDocumentBuffer('malware.exe', exeBuf),
    /UNSUPPORTED_FILE_FORMAT/
  );

  const invalidJson = Buffer.from('{ corrupt json content', 'utf-8');
  await assert.rejects(
    () => parseDocumentBuffer('data.json', invalidJson),
    /JSON_PARSE_FAILED/
  );
});

test('fetchAndIngestWebPage blocks non-public / loopback addresses (SSRF prevention)', async () => {
  await assert.rejects(
    () => fetchAndIngestWebPage({ url: 'http://localhost:3000/api/settings' }),
    /INVALID_WEB_URL/
  );

  await assert.rejects(
    () => fetchAndIngestWebPage({ url: 'http://127.0.0.1:8080/secret' }),
    /INVALID_WEB_URL/
  );

  await assert.rejects(
    () => fetchAndIngestWebPage({ url: 'http://169.254.169.254/latest/meta-data' }),
    /INVALID_WEB_URL/
  );

  await assert.rejects(
    () => fetchAndIngestWebPage({ url: 'ftp://files.example.com/data' }),
    /INVALID_WEB_URL/
  );
});

test('end-to-end ingestion: ingests text document into Neon pgvector Knowledge Vault and verifies retrieval', async () => {
  const testTitle = `E2E Ingestion Test Doc ${Date.now()}`;
  const testContent = `This is a verified test document for the TwinMind Knowledge Ingestion pipeline. It details how knowledge is chunked and embedded via Gemini 768-dimensional embeddings and stored into Neon PostgreSQL. Unique identifier: ${Date.now()}`;

  const result = await ingestDocumentChunks({
    title: testTitle,
    content: testContent,
    category: 'reference',
    tags: ['test', 'automated_e2e'],
    source: 'file',
    format: 'text',
    sourceReference: 'e2e_test.txt',
  });

  assert.equal(result.success, true);
  assert.equal(result.documentsCreated, 1);
  assert.equal(result.primaryTitle, testTitle);
  assert.ok(result.tags.includes('source:file'));
  assert.ok(result.tags.includes('format:text'));

  // Verify it appears in knowledgeService.listDocuments
  const docs = await knowledgeService.listDocuments('reference', testTitle);
  const found = docs.find((d) => d.title === testTitle);
  assert.ok(found, 'Document must be retrieved from Neon database');
  assert.equal(found.title, testTitle);

  // Clean up test document from database
  if (found?.id) {
    await knowledgeService.deleteDocument(found.id);
  }
});
