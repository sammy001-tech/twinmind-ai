import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { neonDb } from './neonService.ts';

const KNOWLEDGE_FILE = path.resolve(process.cwd(), 'twin-knowledge.json');

export interface KnowledgeDoc {
  id: string | number;
  title: string;
  content: string;
  category: string;
  tags: string[];
  embedding?: number[];
  createdAt: string;
}

class KnowledgeService {
  private localDocs: KnowledgeDoc[] = [];
  private aiClient: GoogleGenAI | null = null;

  constructor() {
    this.loadFromDisk();
  }

  private getAiClient(): GoogleGenAI {
    if (!this.aiClient) {
      const apiKey = process.env.GEMINI_API_KEY || '';
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured on the server.');
      }
      this.aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build-knowledge',
          },
        },
      });
    }
    return this.aiClient;
  }

  private loadFromDisk() {
    if (fs.existsSync(KNOWLEDGE_FILE)) {
      try {
        const raw = fs.readFileSync(KNOWLEDGE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.localDocs = parsed;
          return;
        }
      } catch (err) {
        console.warn('[KnowledgeService] Failed loading twin-knowledge.json:', err);
      }
    }

    // Zero-fallback: initialize with clean empty store without hardcoded docs
    this.localDocs = [];
    this.saveToDisk();
  }

  private saveToDisk() {
    try {
      fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(this.localDocs, null, 2), 'utf-8');
    } catch (err) {
      console.error('[KnowledgeService] Failed saving twin-knowledge.json:', err);
    }
  }

  /**
   * Generate 768-dimensional vector embedding using Google GenAI API
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    if (!process.env.GEMINI_API_KEY) {
      return [];
    }

    try {
      const ai = this.getAiClient();
      const res = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text.slice(0, 8000),
        config: { outputDimensionality: 768 },
      });

      if (res.embeddings?.[0]?.values && res.embeddings[0].values.length > 0) {
        const values = res.embeddings[0].values;
        if (values.length === 768) {
          return values;
        }
        console.warn(`[KnowledgeService] Embedding vector length ${values.length} does not match required 768 dimensions`);
      }
    } catch (err) {
      console.warn('[KnowledgeService] Embedding generation error:', err);
    }
    return [];
  }

  /**
   * Cosine similarity between two vector arrays
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Save a new note or document with automatic vector embedding
   */
  public async addDocument(params: {
    title: string;
    content: string;
    category?: string;
    tags?: string[];
  }): Promise<{ id: string | number; success: boolean; hasEmbedding: boolean }> {
    const { title, content, category = 'personal_note', tags = [] } = params;

    // Generate vector embedding
    const textToEmbed = `${title}\n\n${content}`;
    const embedding = await this.generateEmbedding(textToEmbed);

    let docId: string | number = `doc-${Date.now()}`;

    // Try storing in Neon PostgreSQL if connected
    const status = await neonDb.getStatus();
    if (status.connected) {
      const neonRes = await neonDb.saveKnowledge({
        title,
        content,
        category,
        tags,
        embedding: embedding.length > 0 ? embedding : undefined,
      });
      if (neonRes.success) {
        docId = neonRes.id;
      }
    }

    // Always maintain local cache for resilience
    const newDoc: KnowledgeDoc = {
      id: docId,
      title,
      content,
      category,
      tags,
      embedding: embedding.length > 0 ? embedding : undefined,
      createdAt: new Date().toISOString(),
    };
    this.localDocs.unshift(newDoc);
    this.saveToDisk();

    return {
      id: docId,
      success: true,
      hasEmbedding: embedding.length > 0,
    };
  }

  /**
   * Semantic vector search across stored documents
   */
  public async search(
    queryText: string,
    limit = 5,
    threshold = 0.45
  ): Promise<Array<{ id: string | number; title: string; content: string; category: string; tags: string[]; similarity: number; createdAt?: string }>> {
    if (!queryText.trim()) return [];

    const queryEmbedding = await this.generateEmbedding(queryText);

    // If Neon pgvector is connected and embedding generated, query database
    const status = await neonDb.getStatus();
    if (status.connected && queryEmbedding.length > 0) {
      try {
        const neonResults = await neonDb.searchKnowledgeVector(queryEmbedding, limit, threshold);
        if (neonResults.length > 0) {
          return neonResults;
        }
      } catch (err) {
        console.warn('[KnowledgeService] Neon vector search error, falling back to local search:', err);
      }
    }

    // Fallback: Local vector cosine similarity search
    if (queryEmbedding.length > 0) {
      const scored = this.localDocs
        .filter((d) => d.embedding && d.embedding.length > 0)
        .map((d) => ({
          id: d.id,
          title: d.title,
          content: d.content,
          category: d.category,
          tags: d.tags,
          createdAt: d.createdAt,
          similarity: this.cosineSimilarity(queryEmbedding, d.embedding!),
        }))
        .filter((d) => d.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      if (scored.length > 0) return scored;
    }

    // Text keyword fallback if embeddings not available
    const lowerQuery = queryText.toLowerCase();
    return this.localDocs
      .filter((d) => d.title.toLowerCase().includes(lowerQuery) || d.content.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
      .map((d) => ({
        id: d.id,
        title: d.title,
        content: d.content,
        category: d.category,
        tags: d.tags,
        createdAt: d.createdAt,
        similarity: 0.6,
      }));
  }

  /**
   * List all documents
   */
  public async listDocuments(category?: string, query?: string) {
    const status = await neonDb.getStatus();
    if (status.connected) {
      const dbList = await neonDb.getKnowledgeList(category, query);
      if (dbList.length > 0) {
        return dbList;
      }
    }

    // Return local list
    let list = [...this.localDocs];
    if (category && category !== 'all') {
      list = list.filter((d) => d.category.toLowerCase() === category.toLowerCase());
    }
    if (query && query.trim()) {
      const q = query.toLowerCase().trim();
      list = list.filter((d) => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q));
    }
    return list.map((d) => ({
      id: d.id,
      title: d.title,
      content: d.content,
      category: d.category,
      tags: d.tags,
      hasEmbedding: Boolean(d.embedding && d.embedding.length > 0),
      createdAt: d.createdAt,
    }));
  }

  /**
   * Extract all unique categories present in documents along with item count
   */
  public async getCategoriesWithCounts(): Promise<Array<{ category: string; count: number }>> {
    const docs = await this.listDocuments();
    const map = new Map<string, number>();

    // Baseline categories ensure clean UI out of the box
    const defaultCategories = ['personal_note', 'decision_framework', 'project_brief', 'philosophy', 'reference'];
    for (const def of defaultCategories) {
      map.set(def, 0);
    }

    for (const d of docs) {
      const cat = d.category || 'personal_note';
      map.set(cat, (map.get(cat) || 0) + 1);
    }

    return Array.from(map.entries()).map(([category, count]) => ({
      category,
      count,
    }));
  }

  /**
   * Rename a category across all matching local and Neon documents
   */
  public async renameCategory(oldCategory: string, newCategory: string): Promise<number> {
    if (!oldCategory || !newCategory || oldCategory === newCategory) return 0;
    let modified = 0;

    for (const doc of this.localDocs) {
      if (doc.category.toLowerCase() === oldCategory.toLowerCase()) {
        doc.category = newCategory;
        modified++;
      }
    }
    if (modified > 0) {
      this.saveToDisk();
    }

    // Neon database update if connected
    const status = await neonDb.getStatus();
    if (status.connected) {
      try {
        const pool = (neonDb as any).pool;
        if (pool) {
          await pool.query('UPDATE twin_knowledge SET category = $1 WHERE LOWER(category) = LOWER($2)', [
            newCategory,
            oldCategory,
          ]);
        }
      } catch (err) {
        console.warn('[KnowledgeService] Neon category rename error:', err);
      }
    }

    return modified;
  }

  /**
   * Delete category by reassigning notes to fallback category
   */
  public async deleteCategory(categoryToDelete: string, fallbackCategory = 'personal_note'): Promise<number> {
    return this.renameCategory(categoryToDelete, fallbackCategory);
  }

  /**
   * Delete document by ID
   */
  public async deleteDocument(id: string | number): Promise<boolean> {
    const status = await neonDb.getStatus();
    if (status.connected) {
      await neonDb.deleteKnowledge(id);
    }

    this.localDocs = this.localDocs.filter((d) => String(d.id) !== String(id));
    this.saveToDisk();
    return true;
  }

  /**
   * Get vector database telemetry
   */
  public async getStatus() {
    const dbStatus = await neonDb.getStatus();
    const dbStats = await neonDb.getKnowledgeStats();

    return {
      totalDocuments: dbStatus.connected && dbStats.count > 0 ? dbStats.count : this.localDocs.length,
      embeddedDocuments: dbStatus.connected && dbStats.vectorCount > 0 ? dbStats.vectorCount : this.localDocs.filter((d) => d.embedding).length,
      neonConnected: dbStatus.connected,
      pgvectorActive: dbStats.pgvectorActive,
      dimension: 768,
      model: 'gemini-embedding-001',
    };
  }
}

export const knowledgeService = new KnowledgeService();
