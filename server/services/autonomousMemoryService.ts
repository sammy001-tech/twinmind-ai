import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { knowledgeService } from '../db/knowledgeService.ts';
import { settingsManager } from '../db/settingsService.ts';
import { modelCatalogService } from './modelCatalogService.ts';
import { callWithBoundedRetry } from '../utils/retryHelper.ts';
import type { AutonomousMemoryEvent } from '../../src/types/index.ts';

class AutonomousMemoryService {
  private getAiClient(customKey?: string): GoogleGenAI | null {
    const s = settingsManager.getSettings();
    const apiKey = customKey || s.customGeminiKey || process.env.GEMINI_API_KEY || '';
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build-autonomous-memory',
        },
      },
    });
  }

  /**
   * Deterministic heuristic evaluator for qualifying long-term premises
   * when AI model call is offline or unavailable.
   */
  private qualifyHeuristically(userStatement: string): {
    isQualified: boolean;
    tier: AutonomousMemoryEvent['tier'];
    confidenceScore: number;
    title: string;
    category: string;
    tags: string[];
    summary: string;
  } {
    const text = userStatement.trim();
    const lower = text.toLowerCase();

    // Skip short messages or common greetings
    if (text.length < 18 || /^(hi|hello|hey|thanks|thank you|good morning|ok|okay|yes|no)\b/i.test(lower)) {
      return {
        isQualified: false,
        tier: 'workflow',
        confidenceScore: 0,
        title: '',
        category: 'personal_note',
        tags: [],
        summary: '',
      };
    }

    // High confidence triggers
    const isArch = /\b(architecture|database|schema|postgres|neon|vector|api|backend|framework|auth|security|production|system|deploy|platform|only use|always use|must be|standard)\b/i.test(lower);
    const isPref = /\b(prefer|remember that|my preference|i like|format with|always respond|do not|never|rule|policy|guideline|habit)\b/i.test(lower);

    if (!isArch && !isPref && text.length < 35) {
      return {
        isQualified: false,
        tier: 'workflow',
        confidenceScore: 40,
        title: '',
        category: 'personal_note',
        tags: [],
        summary: '',
      };
    }

    const tier: AutonomousMemoryEvent['tier'] = isArch ? 'architectural' : isPref ? 'preference' : 'workflow';
    const confidenceScore = isArch ? 92 : isPref ? 84 : 72;
    const category = isArch ? 'decision_framework' : isPref ? 'philosophy' : 'personal_note';

    // Formulate a crisp title
    const firstLine = text.split('\n')[0].replace(/^(remember that|i want to|we are|starting today|note that)\s+/i, '');
    const title = firstLine.length > 50 ? firstLine.slice(0, 48) + '...' : firstLine;
    const tags = text.match(/\b[A-Za-z0-9_-]{4,15}\b/g)?.slice(0, 4) || ['auto-memory'];

    return {
      isQualified: true,
      tier,
      confidenceScore,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      category,
      tags,
      summary: `Captured ${tier} stance: "${title}"`,
    };
  }

  /**
   * Evaluates an incoming user statement against current knowledge vault records.
   * Dynamically decides whether to:
   * 1. Update an existing document in-place with a dated evolution block.
   * 2. Save a brand-new document with vector embeddings.
   * 3. Ignore if trivial or unqualified.
   */
  public async evaluateAndPersist(
    userStatement: string,
    options: {
      customGeminiKey?: string;
      signal?: AbortSignal;
      skipAi?: boolean;
      mockVectorSearch?: (query: string) => Promise<any[]>;
      mockAddDocument?: (doc: any) => Promise<any>;
      mockUpdateDocument?: (id: number | string, data: any) => Promise<boolean>;
      mockListDocuments?: () => Promise<any[]>;
    } = {}
  ): Promise<AutonomousMemoryEvent | null> {
    const trimmed = userStatement.trim();
    if (!trimmed || trimmed.length < 15) return null;

    // Search existing knowledge documents for potential semantic match
    const candidateDocs = options.mockVectorSearch
      ? await options.mockVectorSearch(trimmed)
      : await knowledgeService.search(trimmed, 3, 0.40);
    const existingMatch = candidateDocs[0]; // Top vector match if any

    // Try AI model extraction for high precision
    const aiClient = options.skipAi ? null : this.getAiClient(options.customGeminiKey);
    let aiResult: {
      isQualified: boolean;
      action: 'update_existing' | 'create_new';
      targetDocId?: number | string;
      confidenceScore: number;
      tier: 'architectural' | 'preference' | 'workflow';
      title: string;
      category: string;
      tags: string[];
      summary: string;
    } | null = null;

    if (aiClient) {
      try {
        const geminiModel = await modelCatalogService.resolveModelForProvider(
          'gemini',
          settingsManager.getSettings().providerModels.gemini,
          options.customGeminiKey
        );

        if (geminiModel) {
          const candidatesContext = candidateDocs.map((c) => ({
            id: c.id,
            title: c.title,
            category: c.category,
            contentSnippet: c.content.slice(0, 200),
          }));

          const prompt = `You are an expert Autonomous Memory Engine for a digital twin application.
Analyze this incoming user turn:
"${trimmed}"

Existing Vault Candidate Notes:
${JSON.stringify(candidatesContext, null, 2)}

Determine if this statement introduces a long-term architectural decision, user preference, or operating constraint that should be stored or updated in the memory vault.

Return a JSON object matching this exact schema:
{
  "isQualified": boolean,
  "action": "update_existing" | "create_new",
  "targetDocId": number or string or null,
  "confidenceScore": number between 0 and 100,
  "tier": "architectural" | "preference" | "workflow",
  "title": "Short crisp title",
  "category": "personal_note" | "decision_framework" | "project_brief" | "philosophy" | "reference",
  "tags": ["tag1", "tag2"],
  "summary": "Short 1-sentence summary"
}
If isQualified is false (e.g., casual greeting or quick question), set confidenceScore < 70 and set action to "create_new".`;

          const res = await callWithBoundedRetry(
            async () => {
              return await aiClient.models.generateContent({
                model: geminiModel,
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                },
              });
            },
            { maxRetries: 1, signal: options.signal }
          );

          if (res.text) {
            const parsed = JSON.parse(res.text);
            if (parsed.isQualified && typeof parsed.confidenceScore === 'number' && parsed.confidenceScore >= 70) {
              aiResult = {
                isQualified: true,
                action: parsed.action === 'update_existing' && parsed.targetDocId ? 'update_existing' : 'create_new',
                targetDocId: parsed.targetDocId || undefined,
                confidenceScore: parsed.confidenceScore,
                tier: ['architectural', 'preference', 'workflow'].includes(parsed.tier) ? parsed.tier : 'preference',
                title: parsed.title || 'Memory Record',
                category: parsed.category || 'personal_note',
                tags: Array.isArray(parsed.tags) ? parsed.tags : ['auto-memory'],
                summary: parsed.summary || 'Captured memory premise',
              };
            }
          }
        }
      } catch (err) {
        console.warn('[AutonomousMemoryService] AI qualification warning:', err);
      }
    }

    // Heuristic qualification if AI did not return a qualified memory
    if (!aiResult) {
      const h = this.qualifyHeuristically(trimmed);
      if (!h.isQualified) return null;

      // If we have an existing vector match, default to updating existing note
      if (existingMatch && existingMatch.id) {
        aiResult = {
          isQualified: true,
          action: 'update_existing',
          targetDocId: existingMatch.id,
          confidenceScore: h.confidenceScore,
          tier: h.tier,
          title: existingMatch.title,
          category: existingMatch.category || h.category,
          tags: h.tags,
          summary: `Updated stance in "${existingMatch.title}"`,
        };
      } else {
        aiResult = {
          isQualified: true,
          action: 'create_new',
          confidenceScore: h.confidenceScore,
          tier: h.tier,
          title: h.title,
          category: h.category,
          tags: h.tags,
          summary: h.summary,
        };
      }
    }

    const timestamp = new Date().toISOString().split('T')[0];

    // Execution Path 1: Update Existing Document In-Place
    if (aiResult.action === 'update_existing' && aiResult.targetDocId) {
      const allDocs = options.mockListDocuments
        ? await options.mockListDocuments()
        : await knowledgeService.listDocuments();
      const existingDoc = allDocs.find((d) => String(d.id) === String(aiResult?.targetDocId));

      if (existingDoc) {
        const evolvedContent = `${existingDoc.content}\n\n---\n> 🔄 **Strategic Evolution (${timestamp}):**\n> ${trimmed}`;
        
        const updatedSuccess = options.mockUpdateDocument
          ? await options.mockUpdateDocument(existingDoc.id, { content: evolvedContent })
          : await knowledgeService.updateDocument(existingDoc.id, { content: evolvedContent });

        if (updatedSuccess) {
          return {
            id: `mem-evt-${randomUUID()}`,
            action: 'update_existing',
            docId: existingDoc.id,
            docTitle: existingDoc.title,
            category: existingDoc.category || aiResult.category,
            confidenceScore: aiResult.confidenceScore,
            tier: aiResult.tier,
            summary: `Evolved existing memory record "${existingDoc.title}"`,
            updatedContent: evolvedContent,
            previousContent: existingDoc.content,
            userStatementSnippet: trimmed.length > 120 ? trimmed.slice(0, 120) + '...' : trimmed,
            timestamp: new Date().toISOString(),
          };
        }
      }
    }

    // Execution Path 2: Create Brand-New Document with Vector Embeddings
    const created = options.mockAddDocument
      ? await options.mockAddDocument({
          title: aiResult.title,
          content: trimmed,
          category: aiResult.category,
          tags: aiResult.tags,
        })
      : await knowledgeService.addDocument({
          title: aiResult.title,
          content: trimmed,
          category: aiResult.category,
          tags: aiResult.tags,
        });

    if (created && created.id) {
      return {
        id: `mem-evt-${randomUUID()}`,
        action: 'create_new',
        docId: created.id,
        docTitle: aiResult.title,
        category: aiResult.category,
        confidenceScore: aiResult.confidenceScore,
        tier: aiResult.tier,
        summary: `Persisted new ${aiResult.tier} record into Vault`,
        updatedContent: trimmed,
        userStatementSnippet: trimmed.length > 120 ? trimmed.slice(0, 120) + '...' : trimmed,
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  }
}

export const autonomousMemoryService = new AutonomousMemoryService();
