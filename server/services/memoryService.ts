import { neonDb } from '../db/neonService.ts';
import { settingsManager } from '../db/settingsService.ts';

export type PersonaMemoryCategory = 'preference' | 'opinion' | 'correction' | 'feedback';

export const SUPPORTED_PERSONA_MEMORY_CATEGORIES: readonly PersonaMemoryCategory[] = [
  'preference',
  'opinion',
  'correction',
  'feedback',
] as const;

export interface ExtractedMemoryCandidate {
  category: PersonaMemoryCategory;
  content: string;
  priority: number;
}

export interface PersonaMemory extends ExtractedMemoryCandidate {
  id: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ExtractMemoriesOptions {
  provider?: 'gemini' | 'groq' | 'mistral' | string;
  model?: string;
  userName?: string;
  signal?: AbortSignal;
}

/**
 * Pure function: build an identity-neutral memory extraction prompt.
 * Replaces hardcoded names with the configured user identity or 'the user'.
 */
export function buildMemoryExtractionPrompt(
  userMessage: string,
  assistantMessage: string,
  userName?: string
): string {
  const userLabel = userName && userName.trim() ? userName.trim() : 'the user';

  return `As a specialized Persona Memory Extractor, analyze the following exchange between ${userLabel} and their AI digital twin companion.
Your goal is to identify any EXPLICIT preferences, opinions, feedback, or corrections ${userLabel} shares about themselves, their workflow, or the digital twin's behavior.

User Message: "${userMessage}"
Twin Response: "${assistantMessage}"

Look strictly for:
1. Preferences: "I like...", "I prefer...", "I don't use..."
2. Opinions: "I think X is better than Y", "I value..."
3. Corrections: "Don't call me that", "You're too formal", "Actually, I'm not X"
4. Feedback: "Good job", "This was too long", "I like this style"

Return a JSON array of objects with 'category', 'content', and 'priority' (1-5).
Category must be strictly one of: 'preference', 'opinion', 'correction', 'feedback'.
Priority scale:
- 'correction': 5
- 'preference': 4
- 'opinion': 3
- 'feedback': 2

Content must be a concise, objective 3rd-person factual summary (e.g., "${userLabel} prefers concise summaries on Telegram.").
Do not infer traits that were not explicitly stated.
If nothing new, explicit, or relevant was stated, return an empty array [].
Respond ONLY with the JSON array.`;
}

/**
 * Pure function: validates and normalizes an extracted memory item.
 * Ensures supported category, non-empty trimmed content, and bounded priority.
 * Returns null for malformed or invalid inputs.
 */
export function validateAndNormalizeMemory(raw: unknown): ExtractedMemoryCandidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  // Category validation
  const rawCat = typeof obj.category === 'string' ? obj.category.trim().toLowerCase() : '';
  if (!SUPPORTED_PERSONA_MEMORY_CATEGORIES.includes(rawCat as PersonaMemoryCategory)) {
    return null;
  }
  const category = rawCat as PersonaMemoryCategory;

  // Content validation: non-empty trimmed string within reasonable size limits
  if (typeof obj.content !== 'string') {
    return null;
  }
  const content = obj.content.trim();
  if (content.length === 0 || content.length > 1000) {
    return null;
  }

  // Priority validation: integer 1-5, or canonical category default
  let priority: number;
  if (typeof obj.priority === 'number' && Number.isInteger(obj.priority) && obj.priority >= 1 && obj.priority <= 5) {
    priority = obj.priority;
  } else {
    const defaultPriority: Record<PersonaMemoryCategory, number> = {
      correction: 5,
      preference: 4,
      opinion: 3,
      feedback: 2,
    };
    priority = defaultPriority[category];
  }

  return {
    category,
    content,
    priority,
  };
}

/**
 * Pure function: parses and validates model JSON text into validated memory candidates.
 */
export function parseExtractedMemories(rawJsonText: string): ExtractedMemoryCandidate[] {
  if (!rawJsonText || typeof rawJsonText !== 'string') return [];

  const cleaned = rawJsonText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      try {
        parsed = JSON.parse(arrayMatch[0]);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const valid: ExtractedMemoryCandidate[] = [];
  for (const item of parsed) {
    const candidate = validateAndNormalizeMemory(item);
    if (candidate) {
      // Deduplicate by category + content
      const isDuplicate = valid.some(
        (v) => v.category === candidate.category && v.content.toLowerCase() === candidate.content.toLowerCase()
      );
      if (!isDuplicate) {
        valid.push(candidate);
      }
    }
  }

  return valid;
}

class MemoryService {
  /**
   * Analyze the latest interaction using the active AI provider to extract
   * explicit personal traits, preferences, and corrections.
   */
  public async extractMemoriesFromInteraction(
    userMessage: string,
    assistantMessage: string,
    options?: ExtractMemoriesOptions | string
  ): Promise<ExtractedMemoryCandidate[]> {
    if (!userMessage || userMessage.trim().length < 5) return [];

    const opts: ExtractMemoriesOptions = typeof options === 'string'
      ? { model: options }
      : (options || {});

    const s = settingsManager.getSettings();
    const effectiveProvider = (opts.provider || s.activeProvider || 'gemini').toLowerCase() as 'gemini' | 'groq' | 'mistral';
    const effectiveModel = opts.model || s.providerModels[effectiveProvider] || s.activeModel;
    const effectiveUser = (opts.userName || s.nickname || s.userName || '').trim();

    const extractionPrompt = buildMemoryExtractionPrompt(userMessage, assistantMessage, effectiveUser);

    try {
      const { twinAgentService } = await import('./twinAgentService.ts');
      const responseText = await twinAgentService.generateCompletion({
        prompt: extractionPrompt,
        systemInstruction: 'You are an objective persona memory extraction engine. Return only a valid JSON array of extracted traits without commentary.',
        provider: effectiveProvider,
        model: effectiveModel,
        temperature: 0.1,
        jsonMode: true,
        signal: opts.signal,
      });

      const memories = parseExtractedMemories(responseText);
      if (memories.length > 0) {
        for (const memory of memories) {
          await neonDb.savePersonaMemory({
            category: memory.category,
            content: memory.content,
            priority: memory.priority,
            metadata: {
              source_user_msg: userMessage.slice(0, 200),
              extracted_by_provider: effectiveProvider,
              extracted_by_model: effectiveModel || 'unspecified',
            },
          });
          console.log(`[MemoryService] Learned new trait: [${memory.category}] ${memory.content}`);
        }
      }
      return memories;
    } catch (err) {
      console.warn('[MemoryService] Memory extraction failed (skipping):', err);
      return [];
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
      feedback: [] as string[],
    };

    memories.forEach((m) => {
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
