import type { PromptTemplate } from '../types/index.ts';

/** Accept only prompt records returned by the live prompt endpoint. */
export function normalizeDynamicPromptTemplates(value: unknown): PromptTemplate[] {
  if (!Array.isArray(value)) return [];

  const prompts: PromptTemplate[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (typeof record.title !== 'string' || !record.title.trim()) continue;
    if (typeof record.prompt !== 'string' || !record.prompt.trim()) continue;

    const prompt: PromptTemplate = {
      title: record.title.trim(),
      prompt: record.prompt.trim(),
    };
    for (const key of ['badge', 'category', 'description', 'desc'] as const) {
      const fieldValue = record[key];
      if (typeof fieldValue === 'string' && fieldValue.trim()) {
        prompt[key] = fieldValue.trim();
      }
    }
    prompts.push(prompt);
  }
  return prompts;
}
