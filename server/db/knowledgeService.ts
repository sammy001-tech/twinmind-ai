import { GoogleGenAI } from '@google/genai';
import { neonDb } from './neonService.ts';
import { modelCatalogService } from '../services/modelCatalogService.ts';
import {
  evaluateMemorySupersession,
  inferImpactLevelFromCategory,
  rankAndFilterRetrievedMemories,
  toGovernedRecord,
  type GovernedKnowledgeRecord,
} from '../services/memoryGovernanceService.ts';
import type {
  GraphNode,
  GraphEdge,
  KnowledgeGraphData,
  MemoryConfidenceStatus,
  MemoryImpactLevel,
  MemoryLifecycleStatus,
  MemorySourceType,
  RetrievedMemoryDiagnostic,
} from '../../src/types/index.ts';

export interface KnowledgeDoc {
  id: string | number;
  title: string;
  content: string;
  category: string;
  tags: string[];
  embedding?: number[];
  sourceType?: MemorySourceType;
  sourceRef?: string | null;
  confidenceStatus?: MemoryConfidenceStatus;
  impactLevel?: MemoryImpactLevel;
  lifecycleStatus?: MemoryLifecycleStatus;
  supersededById?: number | string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  lastVerifiedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
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
      const model = await modelCatalogService.resolveSpecializedModel('embedding');
      const res = await ai.models.embedContent({
        model,
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
   * Save a new note or document with automatic vector embedding and governance provenance
   */
  public async addDocument(params: {
    title: string;
    content: string;
    category?: string;
    tags?: string[];
    sourceType?: MemorySourceType;
    sourceRef?: string | null;
    confidenceStatus?: MemoryConfidenceStatus;
    impactLevel?: MemoryImpactLevel;
    lifecycleStatus?: MemoryLifecycleStatus;
    validFrom?: string | null;
    validUntil?: string | null;
    lastVerifiedAt?: string | null;
  }): Promise<{ id: string | number; success: boolean; hasEmbedding: boolean }> {
    const {
      title,
      content,
      category = 'personal_note',
      tags = [],
      sourceType = 'direct_directive',
      sourceRef = null,
      confidenceStatus = 'confirmed',
      impactLevel = inferImpactLevelFromCategory(category),
      lifecycleStatus = confidenceStatus === 'confirmed' ? 'active' : 'unconfirmed',
      validFrom = null,
      validUntil = null,
      lastVerifiedAt = null,
    } = params;

    const textToEmbed = `${title}\n\n${content}`;
    const embedding = await this.generateEmbedding(textToEmbed);

    const status = await neonDb.refreshConnection();
    if (status) {
      const neonRes = await neonDb.saveKnowledge({
        title,
        content,
        category,
        tags,
        embedding: embedding.length > 0 ? embedding : undefined,
        sourceType,
        sourceRef,
        confidenceStatus,
        impactLevel,
        lifecycleStatus,
        validFrom,
        validUntil,
        lastVerifiedAt,
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
   * Governed hybrid retrieval: filters out superseded records from primary prompt injection
   * while returning full provenance & exclusion diagnostics.
   */
  public async searchWithDiagnostics(
    queryText: string,
    limit = 5,
    threshold = 0.45
  ): Promise<{
    primaryRecords: GovernedKnowledgeRecord[];
    diagnostics: RetrievedMemoryDiagnostic[];
    conflictsDetected: Array<{
      existingDocId: number | string;
      title: string;
      explanation: string;
      impactLevel: MemoryImpactLevel;
    }>;
  }> {
    if (!queryText.trim()) {
      return { primaryRecords: [], diagnostics: [], conflictsDetected: [] };
    }

    const queryEmbedding = await this.generateEmbedding(queryText);
    if (queryEmbedding.length > 0) {
      try {
        const candidatePoolLimit = Math.max(limit * 3, 12);
        const rawResults = await neonDb.searchKnowledgeVector(queryEmbedding, candidatePoolLimit, threshold);
        if (rawResults.length > 0) {
          const governed = rawResults.map((row) => toGovernedRecord(row as unknown as Record<string, unknown>));
          return rankAndFilterRetrievedMemories(governed, {
            limit,
            includeSupersededInDiagnostics: true,
          });
        }
      } catch (err) {
        console.warn('[KnowledgeService] Neon vector diagnostic search error:', err);
      }
    }

    return { primaryRecords: [], diagnostics: [], conflictsDetected: [] };
  }

  /**
   * Semantic vector search across active (non-superseded) stored documents
   */
  public async search(
    queryText: string,
    limit = 5,
    threshold = 0.45
  ): Promise<GovernedKnowledgeRecord[]> {
    const result = await this.searchWithDiagnostics(queryText, limit, threshold);
    return result.primaryRecords;
  }

  /**
   * List all documents
   */
  public async listDocuments(category?: string, query?: string, limit?: number, lifecycleStatus?: string) {
    return await neonDb.getKnowledgeList(category, query, limit, lifecycleStatus);
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
   * Update document content, title, category, tags, or governance metadata
   */
  public async updateDocument(
    id: string | number,
    patch: {
      title?: string;
      content?: string;
      category?: string;
      tags?: string[];
      sourceType?: MemorySourceType;
      sourceRef?: string | null;
      confidenceStatus?: MemoryConfidenceStatus;
      impactLevel?: MemoryImpactLevel;
      lifecycleStatus?: MemoryLifecycleStatus;
      supersededById?: number | string | null;
      validUntil?: string | null;
      lastVerifiedAt?: string | null;
    }
  ): Promise<boolean> {
    let embedding: number[] | undefined;
    if (patch.title || patch.content) {
      const textToEmbed = `${patch.title || ''}\n\n${patch.content || ''}`.trim();
      if (textToEmbed) {
        embedding = await this.generateEmbedding(textToEmbed);
      }
    }
    return await neonDb.updateKnowledge(id, {
      ...patch,
      embedding: embedding && embedding.length > 0 ? embedding : undefined,
    });
  }

  /**
   * Apply impact- and confidence-weighted supersession between an existing document and a newer record
   */
  public async supersedeDocument(params: {
    oldDocId: string | number;
    newDocId: string | number;
    explicitOverride?: boolean;
  }): Promise<{
    success: boolean;
    action: 'auto_supersede' | 'preserve_conflict';
    reason: string;
  }> {
    const docs = await this.listDocuments(undefined, undefined, 250);
    const oldDoc = docs.find((d) => String(d.id) === String(params.oldDocId));
    const newDoc = docs.find((d) => String(d.id) === String(params.newDocId));
    if (!oldDoc || !newDoc) {
      return {
        success: false,
        action: 'preserve_conflict',
        reason: 'Target document(s) not found in Knowledge Vault.',
      };
    }

    const decision = evaluateMemorySupersession(
      toGovernedRecord(oldDoc as unknown as Record<string, unknown>),
      toGovernedRecord(newDoc as unknown as Record<string, unknown>),
      { explicitOwnerOverride: params.explicitOverride }
    );

    if (decision.action === 'auto_supersede') {
      const okOld = await neonDb.updateKnowledge(oldDoc.id, {
        lifecycleStatus: 'superseded',
        supersededById: newDoc.id,
        validUntil: new Date().toISOString(),
      });
      const okNew = await neonDb.updateKnowledge(newDoc.id, {
        lifecycleStatus: 'active',
        lastVerifiedAt: new Date().toISOString(),
      });
      return {
        success: okOld && okNew,
        action: decision.action,
        reason: decision.reason,
      };
    }

    const okOld = await neonDb.updateKnowledge(oldDoc.id, { lifecycleStatus: 'conflicted' });
    const okNew = await neonDb.updateKnowledge(newDoc.id, { lifecycleStatus: 'conflicted' });
    return {
      success: okOld && okNew,
      action: decision.action,
      reason: decision.reason,
    };
  }

  /**
   * Generate graph nodes and edges for the Visual Knowledge Graph
   */
  public async getKnowledgeGraph(): Promise<KnowledgeGraphData> {
    const docs = await this.listDocuments(undefined, undefined, 200);
    const nodes: GraphNode[] = docs.map((doc) => ({
      id: `doc-${doc.id}`,
      dbId: doc.id,
      title: doc.title,
      category: doc.category || 'personal_note',
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      snippet: (doc.content || '').slice(0, 180),
      wordCount: (doc.content || '').trim().split(/\s+/).filter(Boolean).length,
      hasEmbedding: Boolean(doc.hasEmbedding),
      createdAt: doc.createdAt,
    }));

    // Derive deterministic edges between nodes based on shared tags and category clusters
    const edges: GraphEdge[] = [];
    const edgeKeySet = new Set<string>();

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];

        // 1. Shared tags check
        const sharedTags = a.tags.filter((t) =>
          b.tags.some((bt) => bt.toLowerCase() === t.toLowerCase())
        );
        if (sharedTags.length > 0) {
          const edgeId = `edge-tag-${a.id}-${b.id}`;
          if (!edgeKeySet.has(edgeId)) {
            edgeKeySet.add(edgeId);
            edges.push({
              id: edgeId,
              source: a.id,
              target: b.id,
              type: 'shared_tag',
              weight: Math.min(1.0, 0.4 + sharedTags.length * 0.2),
              label: sharedTags.slice(0, 2).join(', '),
            });
          }
        } else if (a.category && b.category && a.category === b.category) {
          // 2. Same category cluster edge (subtler weight)
          const edgeId = `edge-cat-${a.id}-${b.id}`;
          if (!edgeKeySet.has(edgeId)) {
            edgeKeySet.add(edgeId);
            edges.push({
              id: edgeId,
              source: a.id,
              target: b.id,
              type: 'shared_category',
              weight: 0.25,
            });
          }
        }
      }
    }

    // Category summary statistics
    const catMap = new Map<string, number>();
    for (const n of nodes) {
      catMap.set(n.category, (catMap.get(n.category) || 0) + 1);
    }

    const categories = Array.from(catMap.entries()).map(([name, count]) => ({
      name,
      count,
      color: '',
    }));

    return {
      nodes,
      edges,
      categories,
      totalNodes: nodes.length,
      totalEdges: edges.length,
    };
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
      model: await modelCatalogService.resolveSpecializedModel('embedding'),
    };
  }
}

export const knowledgeService = new KnowledgeService();
