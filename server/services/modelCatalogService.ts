import { GoogleGenAI } from '@google/genai';

export interface LiveModelInfo {
  id: string;
  displayName: string;
  description?: string;
  contextWindow?: number;
  supportedGenerationMethods?: string[];
}

export type ProviderId = 'gemini' | 'groq' | 'mistral';

export interface LiveCatalogueResult {
  models: LiveModelInfo[];
  status: 'available' | 'unconfigured' | 'unavailable';
  errorCode?: string;
  httpStatus?: number;
}

/** Convert provider/network failures into safe diagnostics without exposing raw provider errors or credentials. */
export function classifyGeminiCatalogueFailure(error: unknown): { errorCode: string; httpStatus?: number } {
  const candidate = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const statusValue = candidate.status ?? candidate.statusCode ?? candidate.code;
  const parsedStatus = typeof statusValue === 'number'
    ? statusValue
    : typeof statusValue === 'string' && /^\d{3}$/.test(statusValue)
      ? Number(statusValue)
      : undefined;
  if (parsedStatus === 401) return { errorCode: 'GEMINI_AUTHENTICATION_REJECTED', httpStatus: parsedStatus };
  if (parsedStatus === 403) return { errorCode: 'GEMINI_ACCESS_FORBIDDEN', httpStatus: parsedStatus };
  if (parsedStatus === 429) return { errorCode: 'GEMINI_RATE_LIMITED', httpStatus: parsedStatus };
  if (parsedStatus === 400) return { errorCode: 'GEMINI_REQUEST_REJECTED', httpStatus: parsedStatus };
  if (parsedStatus !== undefined && parsedStatus >= 500) return { errorCode: 'GEMINI_PROVIDER_UNAVAILABLE', httpStatus: parsedStatus };

  const codeText = String(candidate.code ?? '').toUpperCase();
  const messageText = error instanceof Error ? error.message.toLowerCase() : '';
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT/.test(codeText) ||
      /fetch failed|network|timeout|socket hang up/.test(messageText)) {
    return { errorCode: 'GEMINI_NETWORK_REQUEST_FAILED' };
  }
  return { errorCode: 'GEMINI_CATALOG_REQUEST_FAILED' };
}

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
  public async getLiveGeminiModelsDiagnostic(apiKey?: string): Promise<LiveCatalogueResult> {
    const key = this.normalizeKey(apiKey || process.env.GEMINI_API_KEY);
    if (!key) return { models: [], status: 'unconfigured', errorCode: 'PROVIDER_CREDENTIALS_MISSING' };

    const models: LiveModelInfo[] = [];
    let pageToken: string | undefined;
    let pagesFetched = 0;
    try {
      // Use Google's documented REST resource so provider capability metadata is inspected directly,
      // rather than relying on an SDK object type that may omit supportedGenerationMethods.
      do {
        const params = new URLSearchParams();
        if (pageToken) params.set('pageToken', pageToken);
        const query = params.toString();
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models${query ? `?${query}` : ''}`, {
          headers: { 'x-goog-api-key': key, Accept: 'application/json' },
        });
        if (!response.ok) {
          const failure = classifyGeminiCatalogueFailure({ status: response.status });
          return { models: [], status: 'unavailable', ...failure };
        }

        const payload: unknown = await response.json();
        if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { models?: unknown }).models)) {
          return { models: [], status: 'unavailable', errorCode: 'GEMINI_CATALOG_RESPONSE_INVALID' };
        }
        const page = payload as {
          models: Array<{ name?: unknown; displayName?: unknown; description?: unknown; supportedGenerationMethods?: unknown }>;
          nextPageToken?: unknown;
        };

        for (const model of page.models) {
          const id = typeof model.name === 'string' ? model.name.replace(/^models\//, '') : '';
          const methods = Array.isArray(model.supportedGenerationMethods)
            ? model.supportedGenerationMethods.filter((item): item is string => typeof item === 'string')
            : [];
          if (!id || !methods.includes('generateContent')) continue;
          models.push({
            id,
            displayName: typeof model.displayName === 'string' && model.displayName ? model.displayName : id,
            ...(typeof model.description === 'string' ? { description: model.description } : {}),
            supportedGenerationMethods: methods,
          });
        }

        pageToken = typeof page.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : undefined;
        pagesFetched += 1;
        if (pageToken && pagesFetched >= 20) {
          return { models: [], status: 'unavailable', errorCode: 'GEMINI_CATALOG_PAGINATION_LIMIT' };
        }
      } while (pageToken);

      if (!models.length) {
        return { models: [], status: 'unavailable', errorCode: 'GEMINI_NO_CHAT_CAPABLE_MODELS' };
      }
      return { models, status: 'available' };
    } catch (err) {
      const failure = classifyGeminiCatalogueFailure(err);
      console.warn('[ModelCatalogService] Live Gemini catalogue query failed:', failure.errorCode, failure.httpStatus ?? '');
      return { models: [], status: 'unavailable', ...failure };
    }
  }

  public async getLiveGeminiModels(apiKey?: string): Promise<LiveModelInfo[]> {
    const result = await this.getLiveGeminiModelsDiagnostic(apiKey);
    return result.models;
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
