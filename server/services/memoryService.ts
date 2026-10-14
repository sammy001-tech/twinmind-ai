import { neonDb } from '../db/neonService.ts';
import { settingsManager } from '../db/settingsService.ts';
import { GoogleGenAI } from '@google/genai';
import { callWithBoundedRetry } from '../utils/retryHelper.ts';

export interface PersonaMemory {
  id: number;
  category: 'preference' | 'opinion' | 'correction' | 'feedback';
  content: string;
  priority: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

class MemoryService {
  /**
   * Analyze the latest interaction to see if the user shared new personal traits, 
   * preferences, or corrected the twin's behavior.
   */
  public async extractMemoriesFromInteraction(userMessage: string, assistantMessage: string, modelOverride?: string): Promise<void> {
    const s = settingsManager.getSettings();
    const apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    
    if (!apiKey || userMessage.length < 5) return;

    try {
      const genAI = new GoogleGenAI({ apiKey });
      const modelId = modelOverride || s.providerModels?.gemini || s.activeModel;
      
      if (!modelId) {
        console.warn('[MemoryService] No model configured for memory extraction. Skipping.');
        return;
      }

      const extractionPrompt = `
        As a specialized Persona Memory Extractor, analyze the following exchange between a user (Lekzy) and his Digital Twin.
        Your goal is to identify any EXPLICIT preferences, opinions, feedback, or corrections Lekzy shares about himself or the Twin's behavior.

        User Message: "${userMessage}"
        Twin Response: "${assistantMessage}"

        Look for:
        1. Preferences: "I like...", "I prefer...", "I don't use..."
        2. Opinions: "I think X is better than Y", "I value..."
        3. Corrections: "Don't call me that", "You're too formal", "Actually, I'm not X"
        4. Feedback: "Good job", "This was too long", "I like this style"

        Return a JSON array of objects with 'category', 'content', and 'priority' (1-5).
        Category must be one of: 'preference', 'opinion', 'correction', 'feedback'.
        Priority: Corrections (5), Preferences (4), Opinions (3), Feedback (2).
        Content should be a concise 3rd person summary, e.g., "Lekzy prefers concise summaries for Telegram."

        If nothing new or explicit is found, return [].
        ONLY return the JSON array.
      `;

      const result = await callWithBoundedRetry(async () => {
        const response = await genAI.models.generateContent({
          model: modelId,
          contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }],
          config: { temperature: 0.2 }
        });
        const text = response.text || '';
        const jsonMatch = text.match(/\[.*\]/s);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      }, { operationName: 'MemoryExtraction' });

      if (Array.isArray(result) && result.length > 0) {
        for (const memory of result) {
          if (memory.category && memory.content) {
            await neonDb.savePersonaMemory({
              category: memory.category,
              content: memory.content,
              priority: memory.priority || 1,
              metadata: { source_user_msg: userMessage.slice(0, 200) }
            });
            console.log(`[MemoryService] Learned new trait: [${memory.category}] ${memory.content}`);
          }
        }
      }
    } catch (err) {
      console.warn('[MemoryService] Memory extraction failed (skipping):', err);
    }
  }

  /**
   * Get all learned persona context formatted for the system prompt.
   */
  public async getLearnedPersonaContext(): Promise<string> {
    const memories = await neonDb.getPersonaMemories(50);
    if (memories.length === 0) return '';

    const categories = {
      correction: [] as string[],
      preference: [] as string[],
      opinion: [] as string[],
      feedback: [] as string[]
    };

    memories.forEach(m => {
      if (categories[m.category as keyof typeof categories]) {
        categories[m.category as keyof typeof categories].push(m.content);
      }
    });

    let context = '\n\n======================================================\n';
    context += 'EVOLVING PERSONA KNOWLEDGE (LEARNED FROM INTERACTIONS)\n';
    context += '======================================================\n';
    context += 'These are EXPLICIT corrections and preferences shared by your counterpart. They override any generic persona rules:\n';

    if (categories.correction.length > 0) {
      context += '\nCORE CORRECTIONS (CRITICAL):\n- ' + categories.correction.join('\n- ');
    }
    if (categories.preference.length > 0) {
      context += '\nUSER PREFERENCES:\n- ' + categories.preference.join('\n- ');
    }
    if (categories.opinion.length > 0) {
      context += '\nVALUES & OPINIONS:\n- ' + categories.opinion.join('\n- ');
    }
    if (categories.feedback.length > 0) {
      context += '\nFEEDBACK HISTORY (STYLE GUIDES):\n- ' + categories.feedback.join('\n- ');
    }

    return context;
  }
}

export const memoryService = new MemoryService();
