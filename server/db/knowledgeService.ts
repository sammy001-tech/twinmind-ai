import { GoogleGenAI } from '@google/genai';
import { neonDb } from './neonService.ts';

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
  private aiClient: GoogleGenAI | null = null;

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

    // Store in Neon PostgreSQL if connected
    const status = await neonDb.refreshConnection();
    if (status) {
      const neonRes = await neonDb.saveKnowledge({
        title,
        content,
        category,
        tags,
        embedding: embedding.length > 0 ? embedding : undefined,
      });
      return {
        id: neonRes.id,
        success: neonRes.success,
        hasEmbedding: embedding.length > 0,
      };
    }

    return {
      id: 0,
      success: false,
      hasEmbedding: false,
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
    if (queryEmbedding.length > 0) {
      try {
        const neonResults = await neonDb.searchKnowledgeVector(queryEmbedding, limit, threshold);
        if (neonResults.length > 0) {
          return neonResults;
        }
      } catch (err) {
        console.warn('[KnowledgeService] Neon vector search error:', err);
      }
    }

    return [];
  }

  /**
   * List all documents
   */
  public async listDocuments(category?: string, query?: string) {
    return await neonDb.getKnowledgeList(category, query);
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
   * Rename a category across Neon documents
   */
  public async renameCategory(oldCategory: string, newCategory: string): Promise<number> {
    if (!oldCategory || !newCategory || oldCategory === newCategory) return 0;

    // Neon database update if connected
    const status = await neonDb.refreshConnection();
    if (status) {
      try {
        const pool = (neonDb as any).pool;
        if (pool) {
          const res = await pool.query('UPDATE twin_knowledge SET category = $1 WHERE LOWER(category) = LOWER($2)', [
            newCategory,
            oldCategory,
          ]);
          return res.rowCount || 0;
        }
      } catch (err) {
        console.warn('[KnowledgeService] Neon category rename error:', err);
      }
    }

    return 0;
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
    return await neonDb.deleteKnowledge(id);
  }

  /**
   * Get vector database telemetry
   */
  public async getStatus() {
    const dbStatus = await neonDb.getStatus();
    const dbStats = await neonDb.getKnowledgeStats();

    return {
      totalDocuments: dbStats.count,
      embeddedDocuments: dbStats.vectorCount,
      neonConnected: dbStatus.connected,
      pgvectorActive: dbStats.pgvectorActive,
      dimension: 768,
      model: 'gemini-embedding-001',
    };
  }
}

export const knowledgeService = new KnowledgeService();
