import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { knowledgeService } from '../db/knowledgeService.ts';
import { settingsManager } from '../db/settingsService.ts';
import { modelCatalogService } from './modelCatalogService.ts';
import { callWithBoundedRetry } from '../utils/retryHelper.ts';
import type { BeliefConflict } from '../../src/types/index.ts';

class ContradictionDetectorService {
  private getAiClient(customKey?: string): GoogleGenAI | null {
    const s = settingsManager.getSettings();
    const apiKey = customKey || s.customGeminiKey || process.env.GEMINI_API_KEY || '';
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build-contradiction-detector',
        },
      },
    });
  }

  /**
   * Evaluates user input against stored knowledge records to detect any direct contradictions,
   * reversals, or policy pivots.
   */
  public async detectContradiction(
    userStatement: string,
    options: { customGeminiKey?: string; signal?: AbortSignal } = {}
  ): Promise<BeliefConflict | null> {
    const trimmed = userStatement.trim();
    if (!trimmed || trimmed.length < 15) return null;

    // Skip simple greetings, single words, or trivial messages
    if (/^(hi|hello|hey|thanks|thank you|good morning|ok|okay|yes|no)\b/i.test(trimmed)) {
      return null;
    }

    try {
      // 1. Semantic retrieval of top candidate knowledge records
      const candidateDocs = await knowledgeService.search(trimmed, 3, 0.45);
      if (!candidateDocs || candidateDocs.length === 0) {
        return null;
      }

      // 2. Evaluate with Gemini using structured JSON schema
      const client = this.getAiClient(options.customGeminiKey);
      if (!client) return null;

      const model = await modelCatalogService.resolveModelForProvider(
        'gemini',
        undefined,
        options.customGeminiKey || process.env.GEMINI_API_KEY || ''
      );

      const prompt = `You are an evidence-based premise and contradiction analyzer for a digital twin memory vault.
Analyze whether the user's latest statement contradicts, reverses, or invalidates an established premise, policy, decision, or preference in any of the stored memory records below.

STORED MEMORY RECORDS:
${candidateDocs
  .map(
    (d, i) =>
      `[Record ${i + 1} | ID: ${d.id} | Title: "${d.title}"]
Category: ${d.category}
Content: ${d.content}`
  )
  .join('\n\n')}

USER LATEST STATEMENT:
"${trimmed}"

EVALUATION RULES:
1. ONLY flag a contradiction if the user's statement directly conflicts with, negates, or reverses an established factual policy, technical standard, business decision, or personal preference in a stored record.
2. Do NOT flag general questions, casual curiosity, complementary additions, or unrelated new topics.
3. If there is NO direct contradiction or policy reversal, output {"hasConflict": false}.
4. If there IS a genuine contradiction, output JSON matching this exact structure:
{
  "hasConflict": true,
  "conflictType": "direct_contradiction" | "policy_pivot" | "preference_update",
  "conflictingDocId": <number or string ID of the conflicting record>,
  "conflictingTitle": "<exact title of conflicting record>",
  "conflictingExcerpt": "<1-2 sentence excerpt from the record that is contradicted>",
  "userStatement": "<the user statement that creates the tension>",
  "explanation": "<1 clear sentence explaining why this conflicts with the stored record>",
  "suggestedAction": "update_record" | "retire_record" | "mark_evolution"
}

Output JSON only.`;

      const res = await callWithBoundedRetry(
        () =>
          client.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
        { operationName: 'ContradictionEvaluation', signal: options.signal }
      );

      const raw = res.text?.trim() || '';
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed.hasConflict || !parsed.conflictingDocId) {
        return null;
      }

      const matchingDoc = candidateDocs.find(
        (d) => String(d.id) === String(parsed.conflictingDocId)
      ) || candidateDocs[0];

      return {
        id: `conflict-${randomUUID()}`,
        existingDocId: matchingDoc.id,
        existingTitle: parsed.conflictingTitle || matchingDoc.title,
        existingExcerpt: parsed.conflictingExcerpt || matchingDoc.content.slice(0, 160),
        conflictType: parsed.conflictType || 'policy_pivot',
        explanation: parsed.explanation || 'Current statement differs from stored belief.',
        userStatement: parsed.userStatement || trimmed,
        suggestedAction: parsed.suggestedAction || 'mark_evolution',
        status: 'pending',
      };
    } catch (err) {
      console.warn('[ContradictionDetector] Warning during evaluation:', err);
      return null;
    }
  }

  /**
   * Scans all stored knowledge documents in the vault to identify mutual contradictions or tensions.
   */
  public async scanVaultConflicts(): Promise<BeliefConflict[]> {
    const docs = await knowledgeService.listDocuments(undefined, undefined, 50);
    if (docs.length < 2) return [];

    const client = this.getAiClient();
    if (!client) return [];

    try {
      const model = await modelCatalogService.resolveModelForProvider('gemini');
      const docsSummary = docs
        .slice(0, 25)
        .map((d) => `ID ${d.id}: "${d.title}" - ${d.content.slice(0, 200)}`)
        .join('\n');

      const prompt = `Analyze this list of stored memory notes for any internal contradictions or conflicting directives between pairs of notes:

${docsSummary}

If any two notes contradict each other (e.g. Note A says X, Note B says Opposite of X), return JSON:
{
  "conflicts": [
    {
      "id": "uuid",
      "existingDocId": 12,
      "existingTitle": "...",
      "existingExcerpt": "...",
      "conflictType": "direct_contradiction",
      "explanation": "...",
      "userStatement": "...",
      "suggestedAction": "update_record"
    }
  ]
}
If no conflicts exist, return {"conflicts": []}. Output JSON only.`;

      const res = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const parsed = JSON.parse(res.text || '{}');
      if (Array.isArray(parsed.conflicts)) {
        return parsed.conflicts.map((c: any) => ({
          id: c.id || `conflict-${randomUUID()}`,
          existingDocId: c.existingDocId,
          existingTitle: c.existingTitle || 'Stored Knowledge',
          existingExcerpt: c.existingExcerpt || '',
          conflictType: c.conflictType || 'direct_contradiction',
          explanation: c.explanation || 'Contradictory premises identified in knowledge base.',
          userStatement: c.userStatement || '',
          suggestedAction: c.suggestedAction || 'update_record',
          status: 'pending' as const,
        }));
      }
    } catch (err) {
      console.warn('[ContradictionDetector] Vault scan warning:', err);
    }
    return [];
  }

  /**
   * Resolves an identified belief conflict durably:
   * - 'update': Overwrites the outdated record content with the new statement.
   * - 'retire': Deletes the outdated document from the database.
   * - 'evolve': Preserves historical reasoning by appending an evolutionary pivot record with timestamp.
   */
  public async resolveConflict(params: {
    conflictId: string;
    docId: string | number;
    action: 'update' | 'retire' | 'evolve';
    newStatement?: string;
  }): Promise<{ success: boolean; message: string }> {
    const { docId, action, newStatement = '' } = params;

    if (!docId) {
      return { success: false, message: 'Document ID is required to resolve conflict.' };
    }

    if (!['update', 'retire', 'evolve'].includes(action)) {
      return { success: false, message: `Invalid resolution action: ${action}` };
    }

    if (action === 'retire') {
      const deleted = await knowledgeService.deleteDocument(docId);
      return {
        success: deleted,
        message: deleted
          ? `Outdated belief record #${docId} was permanently retired from your memory vault.`
          : `Failed to retire record #${docId}.`,
      };
    }

    const docs = await knowledgeService.listDocuments();
    const existing = docs.find((d) => String(d.id) === String(docId));
    if (!existing) {
      return { success: false, message: `Knowledge document #${docId} was not found.` };
    }

    const timestamp = new Date().toISOString().split('T')[0];

    if (action === 'update') {
      const updatedContent = newStatement.trim()
        ? `${newStatement.trim()}\n\n[Updated on ${timestamp} to supersede previous stance: "${existing.content.slice(0, 100)}..."]`
        : existing.content;

      const updated = await knowledgeService.updateDocument(docId, {
        content: updatedContent,
      });

      return {
        success: updated,
        message: updated
          ? `Memory record "${existing.title}" updated successfully with your new position.`
          : `Failed to update record #${docId}.`,
      };
    }

    if (action === 'evolve') {
      const evolvedContent = `${existing.content}\n\n---\n> **🔄 Strategic Evolution (${timestamp}):**\n> ${newStatement.trim() || 'Stance updated by user.'}`;

      const updated = await knowledgeService.updateDocument(docId, {
        content: evolvedContent,
      });

      return {
        success: updated,
        message: updated
          ? `Marked as an intentional strategic evolution on "${existing.title}". Historical context preserved.`
          : `Failed to update record #${docId}.`,
      };
    }

    return { success: false, message: 'Unknown resolution action.' };
  }
}

export const contradictionDetectorService = new ContradictionDetectorService();
