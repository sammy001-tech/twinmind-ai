import { GoogleGenAI } from '@google/genai';

export interface LiveModelInfo {
  id: string;
  displayName: string;
  description?: string;
  contextWindow?: number;
}

// Live catalog alignment targets (preferred identifiers)
const PREFERENCE_TARGETS = {
  gemini: 'gemini-3.5-flash-lite',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-large-latest',
  embedding: 'gemini-embedding-001',
  tts: 'gemini-3.8-flash-lite-tts',
} as const;

export type ProviderId = 'gemini' | 'groq' | 'mistral';

class ModelCatalogService {
  private cache: Record<ProviderId | 'specialized', { models: LiveModelInfo[]; timestamp: number }> = {
    gemini: { models: [], timestamp: 0 },
    groq: { models: [], timestamp: 0 },
    mistral: { models: [], timestamp: 0 },
    specialized: { models: [], timestamp: 0 },
  };

  private readonly CACHE_TTL_MS = 1000 * 60 * 15; // 15 minutes live cache

  /**
   * Dynamically fetch live Gemini models from Google GenAI
   */
  public async getLiveGeminiModels(apiKey?: string): Promise<LiveModelInfo[]> {
    const key = (apiKey || process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!key) return [];

    const now = Date.now();
    if (this.cache.gemini.models.length > 0 && now - this.cache.gemini.timestamp < this.CACHE_TTL_MS) {
      return this.cache.gemini.models;
    }

    try {
      if (key.startsWith('AIza') || key.startsWith('AQ.') || key.length > 30) {
        const client = new GoogleGenAI({ apiKey: key });
        const pager = await client.models.list();
        const models: LiveModelInfo[] = [];

        for await (const m of pager) {
          const id = m.name?.replace(/^models\//, '') || '';
          if (id && !id.includes('embedding') && !id.includes('aqa') && !id.includes('imagen')) {
            models.push({
              id,
              displayName: m.displayName || id,
              description: m.description,
            });
          }
        }

        if (models.length > 0) {
          this.cache.gemini = { models, timestamp: now };
          return models;
        }
      }
    } catch (err) {
      console.warn('[ModelCatalogService] Live Gemini query error:', err);
    }

    return this.cache.gemini.models;
  }

  /**
   * Dynamically fetch live Groq models
   */
  public async getLiveGroqModels(apiKey?: string): Promise<LiveModelInfo[]> {
    const key = (apiKey || process.env.GROQ_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!key) return [];

    const now = Date.now();
    if (this.cache.groq.models.length > 0 && now - this.cache.groq.timestamp < this.CACHE_TTL_MS) {
      return this.cache.groq.models;
    }

    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.data) && data.data.length > 0) {
          const models: LiveModelInfo[] = data.data.map((m: { id: string }) => ({
            id: m.id,
            displayName: m.id,
            description: `Live Groq LPU model (${m.id})`,
          }));
          this.cache.groq = { models, timestamp: now };
          return models;
        }
      }
    } catch (err) {
      console.warn('[ModelCatalogService] Live Groq query error:', err);
    }

    return this.cache.groq.models;
  }

  /**
   * Dynamically fetch live Mistral models
   */
  public async getLiveMistralModels(apiKey?: string): Promise<LiveModelInfo[]> {
    const key = (apiKey || process.env.MISTRAL_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!key) return [];

    const now = Date.now();
    if (this.cache.mistral.models.length > 0 && now - this.cache.mistral.timestamp < this.CACHE_TTL_MS) {
      return this.cache.mistral.models;
    }

    try {
      const res = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.data) && data.data.length > 0) {
          const models: LiveModelInfo[] = data.data.map((m: { id: string }) => ({
            id: m.id,
            displayName: m.id,
            description: `Live Mistral model (${m.id})`,
          }));
          this.cache.mistral = { models, timestamp: now };
          return models;
        }
      }
    } catch (err) {
      console.warn('[ModelCatalogService] Live Mistral query error:', err);
    }

    return this.cache.mistral.models;
  }

  /**
   * Dynamically resolve the active model for a provider from the live catalog
   * Aligns with live catalog identifiers (gemini-3.5-flash-lite, llama-3.3-70b-versatile, mistral-large-latest)
   */
  public async resolveModelForProvider(
    provider: ProviderId,
    configuredModel?: string,
    apiKey?: string
  ): Promise<string> {
    if (configuredModel && configuredModel.trim()) {
      return configuredModel.trim();
    }

    const targetIdentifier = PREFERENCE_TARGETS[provider];

    // Query live catalog for the provider
    let liveModels: LiveModelInfo[] = [];
    if (provider === 'gemini') {
      liveModels = await this.getLiveGeminiModels(apiKey);
    } else if (provider === 'groq') {
      liveModels = await this.getLiveGroqModels(apiKey);
    } else if (provider === 'mistral') {
      liveModels = await this.getLiveMistralModels(apiKey);
    }

    // Match exact live catalog target identifier if available in registry
    const exactMatch = liveModels.find((m) => m.id.toLowerCase() === targetIdentifier.toLowerCase());
    if (exactMatch) {
      return exactMatch.id;
    }

    // Match by prefix or family in live registry
    if (provider === 'gemini') {
      const flashLite = liveModels.find((m) => m.id.toLowerCase().includes('flash-lite'));
      if (flashLite) return flashLite.id;
      const flash = liveModels.find((m) => m.id.toLowerCase().includes('flash') && !m.id.toLowerCase().includes('image'));
      if (flash) return flash.id;
    } else if (provider === 'groq') {
      const llama = liveModels.find((m) => m.id.toLowerCase().includes('llama'));
      if (llama) return llama.id;
    } else if (provider === 'mistral') {
      const large = liveModels.find((m) => m.id.toLowerCase().includes('large'));
      if (large) return large.id;
    }

    // Return first available live model if present
    if (liveModels.length > 0) {
      return liveModels[0].id;
    }

    // Aligned live catalog identifier
    return targetIdentifier;
  }

  /**
   * Resolve specialized technical models (Embedding, TTS) from live catalog
   */
  public async resolveSpecializedModel(type: 'embedding' | 'tts', apiKey?: string): Promise<string> {
    const target = PREFERENCE_TARGETS[type];
    
    // For specialized models, we primarily rely on the preferred target but can probe the live catalog
    if (type === 'embedding' || type === 'tts') {
      const geminiModels = await this.getLiveGeminiModels(apiKey);
      const match = geminiModels.find(m => m.id.includes(type === 'embedding' ? 'embedding' : 'tts'));
      if (match) return match.id;
    }

    return target;
  }

  /**
   * Synchronize and dynamically resolve all provider models dynamically
   */
  public async resolveAllProviderModels(
    current?: Partial<Record<ProviderId, string>>,
    keys?: { gemini?: string; groq?: string; mistral?: string }
  ): Promise<Record<ProviderId, string>> {
    const gemini = await this.resolveModelForProvider('gemini', current?.gemini, keys?.gemini);
    const groq = await this.resolveModelForProvider('groq', current?.groq, keys?.groq);
    const mistral = await this.resolveModelForProvider('mistral', current?.mistral, keys?.mistral);

    return { gemini, groq, mistral };
  }
}

export const modelCatalogService = new ModelCatalogService();
