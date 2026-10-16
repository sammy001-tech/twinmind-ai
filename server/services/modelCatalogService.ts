import { GoogleGenAI } from '@google/genai';

export interface LiveModelInfo {
  id: string;
  displayName: string;
  description?: string;
  contextWindow?: number;
  supportedGenerationMethods?: string[];
}

export type ProviderId = 'gemini' | 'groq' | 'mistral';

/**
 * Pure validation boundary shared by production resolution and unit tests.
 * A configured model is executable only when the current live catalogue contains it.
 */
export function resolveConfiguredLiveModel(
  provider: ProviderId,
  configuredModel: string | undefined,
  liveModels: LiveModelInfo[]
): string {
  if (!liveModels.length) {
    throw new Error(`LIVE_MODEL_CATALOG_UNAVAILABLE:${provider}`);
  }

  const requested = configuredModel?.trim();
  if (!requested) {
    throw new Error(`MODEL_CONFIGURATION_REQUIRED:${provider}`);
  }

  const match = liveModels.find((model) => model.id === requested);
  if (!match) {
    throw new Error(`MODEL_NOT_CURRENTLY_AVAILABLE:${provider}:${requested}`);
  }

  return match.id;
}

class ModelCatalogService {
  private normalizeKey(value?: string): string {
    const key = (value || '').trim().replace(/^["']|["']$/g, '');
    if (!key || key.includes('...') || key === '********') return '';
    return key;
  }

  /**
   * Fetch models directly from Google's live catalogue. Only models whose API
   * metadata advertises generateContent are considered chat-capable.
   */
  public async getLiveGeminiModels(apiKey?: string): Promise<LiveModelInfo[]> {
    const key = this.normalizeKey(apiKey || process.env.GEMINI_API_KEY);
    if (!key) return [];

    try {
      const client = new GoogleGenAI({ apiKey: key });
      const pager = await client.models.list();
      const models: LiveModelInfo[] = [];

      for await (const model of pager) {
        // Validate provider-returned capabilities because the SDK Model type omits this API metadata.
        const rawModel = model as unknown as { name?: unknown; displayName?: unknown; description?: unknown; supportedGenerationMethods?: unknown };
        const id = typeof rawModel.name === 'string' ? rawModel.name.replace(/^models\//, '') : '';
        const methods = Array.isArray(rawModel.supportedGenerationMethods)
          ? rawModel.supportedGenerationMethods.filter((item): item is string => typeof item === 'string')
          : [];
        if (!id || !methods.includes('generateContent')) continue;

        models.push({
          id,
          displayName: model.displayName || id,
          description: model.description,
          supportedGenerationMethods: methods,
        });
      }

      return models;
    } catch (err) {
      console.warn('[ModelCatalogService] Live Gemini catalogue query failed:', err);
      return [];
    }
  }

  /** Fetch the currently listed models from Groq. No stale catalogue is returned on failure. */
  public async getLiveGroqModels(apiKey?: string): Promise<LiveModelInfo[]> {
    const key = this.normalizeKey(apiKey || process.env.GROQ_API_KEY);
    if (!key) return [];

    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!response.ok) {
        console.warn(`[ModelCatalogService] Live Groq catalogue returned HTTP ${response.status}`);
        return [];
      }

      const data: any = await response.json();
      if (!Array.isArray(data.data)) return [];
      return data.data
        .filter((model: any) => typeof model?.id === 'string' && model.id.trim() && model.active !== false)
        .map((model: any) => ({
          id: model.id,
          displayName: model.id,
          ...(typeof model.context_window === 'number' ? { contextWindow: model.context_window } : {}),
        }));
    } catch (err) {
      console.warn('[ModelCatalogService] Live Groq catalogue query failed:', err);
      return [];
    }
  }

  /** Fetch the currently listed models from Mistral. No stale catalogue is returned on failure. */
  public async getLiveMistralModels(apiKey?: string): Promise<LiveModelInfo[]> {
    const key = this.normalizeKey(apiKey || process.env.MISTRAL_API_KEY);
    if (!key) return [];

    try {
      const response = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!response.ok) {
        console.warn(`[ModelCatalogService] Live Mistral catalogue returned HTTP ${response.status}`);
        return [];
      }

      const data: any = await response.json();
      if (!Array.isArray(data.data)) return [];
      return data.data
        .filter((model: any) => typeof model?.id === 'string' && model.id.trim() && model.active !== false)
        .map((model: any) => ({
          id: model.id,
          displayName: model.id,
          ...(typeof model.context_length === 'number' ? { contextWindow: model.context_length } : {}),
        }));
    } catch (err) {
      console.warn('[ModelCatalogService] Live Mistral catalogue query failed:', err);
      return [];
    }
  }

  public async getLiveModels(provider: ProviderId, apiKey?: string): Promise<LiveModelInfo[]> {
    if (provider === 'gemini') return this.getLiveGeminiModels(apiKey);
    if (provider === 'groq') return this.getLiveGroqModels(apiKey);
    return this.getLiveMistralModels(apiKey);
  }

  /**
   * A configured model is never trusted merely because it was saved. Resolve it
   * against a fresh provider catalogue for every execution request.
   */
  public async resolveModelForProvider(
    provider: ProviderId,
    configuredModel?: string,
    apiKey?: string
  ): Promise<string> {
    const liveModels = await this.getLiveModels(provider, apiKey);
    return resolveConfiguredLiveModel(provider, configuredModel, liveModels);
  }

  /**
   * Resolve specialized model capabilities from a fresh Google catalogue.
   * IDs are discovered from provider metadata; no preferred model identifier is
   * embedded in application code.
   */
  public async resolveSpecializedModel(type: 'embedding' | 'tts', apiKey?: string): Promise<string> {
    const key = this.normalizeKey(apiKey || process.env.GEMINI_API_KEY);
    if (!key) throw new Error('MODEL_PROVIDER_CONFIGURATION_MISSING:gemini');

    const configuredModel = (type === 'embedding'
      ? process.env.GEMINI_EMBEDDING_MODEL
      : process.env.GEMINI_TTS_MODEL)?.trim();

    try {
      const client = new GoogleGenAI({ apiKey: key });
      const pager = await client.models.list();
      const eligible: string[] = [];

      for await (const model of pager) {
                // Validate provider-returned capabilities because the SDK Model type omits this API metadata.
                const rawModel = model as unknown as { name?: unknown; displayName?: unknown; description?: unknown; supportedGenerationMethods?: unknown };
                const id = typeof rawModel.name === 'string' ? rawModel.name.replace(/^models\//, '') : '';
                const methods = Array.isArray(rawModel.supportedGenerationMethods)
                  ? rawModel.supportedGenerationMethods.filter((item): item is string => typeof item === 'string')
                  : [];
                if (!id) continue;

        const matches = type === 'embedding'
          ? id.toLowerCase().includes('embedding') && methods.includes('embedContent')
          : id.toLowerCase().includes('tts') && methods.includes('generateContent');

        if (matches) eligible.push(id);
      }

      if (configuredModel) {
        if (!eligible.includes(configuredModel)) {
          throw new Error(`MODEL_NOT_CURRENTLY_AVAILABLE:gemini:${configuredModel}`);
        }
        return configuredModel;
      }

      if (!eligible.length) throw new Error(`MODEL_CAPABILITY_UNAVAILABLE:gemini:${type}`);
      if (eligible.length > 1) {
        throw new Error(`MODEL_CAPABILITY_SELECTION_REQUIRED:gemini:${type}:${eligible.join(',')}`);
      }
      return eligible[0];
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('MODEL_')) throw err;
      console.warn(`[ModelCatalogService] Live Gemini ${type} capability discovery failed:`, err);
      throw new Error(`MODEL_CAPABILITY_UNAVAILABLE:gemini:${type}`);
    }
  }

  public async resolveAllProviderModels(
    current?: Partial<Record<ProviderId, string>>,
    keys?: { gemini?: string; groq?: string; mistral?: string }
  ): Promise<Record<ProviderId, string>> {
    const [gemini, groq, mistral] = await Promise.all([
      this.resolveModelForProvider('gemini', current?.gemini, keys?.gemini),
      this.resolveModelForProvider('groq', current?.groq, keys?.groq),
      this.resolveModelForProvider('mistral', current?.mistral, keys?.mistral),
    ]);

    return { gemini, groq, mistral };
  }
}

export const modelCatalogService = new ModelCatalogService();
