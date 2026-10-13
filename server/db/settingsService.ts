import fs from 'fs';
import path from 'path';
import type { AppSettings } from '../../src/types/index.ts';
import { neonDb } from './neonService.ts';

const SETTINGS_FILE = path.resolve(process.cwd(), 'twin-settings.json');

const DEFAULT_SETTINGS: AppSettings = {
  brandName: process.env.APP_BRAND_NAME || process.env.VITE_APP_BRAND_NAME || 'TwinMind AI',
  activeProvider: (process.env.ACTIVE_PROVIDER as 'gemini' | 'groq' | 'mistral') || 'gemini',
  activeModel: process.env.ACTIVE_MODEL || '',
  providerModels: {
    gemini: process.env.GEMINI_MODEL || '',
    groq: process.env.GROQ_MODEL || '',
    mistral: process.env.MISTRAL_MODEL || '',
  },
  voice: process.env.TTS_VOICE || 'Fenrir',
  userName: process.env.USER_NAME || '',
  nickname: process.env.USER_NICKNAME || '',
  customGeminiKey: process.env.GEMINI_API_KEY || '',
  customGroqKey: process.env.GROQ_API_KEY || '',
  customMistralKey: process.env.MISTRAL_API_KEY || '',
  customTavilyKey: process.env.TAVILY_API_KEY || '',
  autoPlayVoice: false,
  voiceSpeed: 1,
  customPrompts: [],
  activeThreadId: null,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioWhatsAppNumber: process.env.TWILIO_WHATSAPP_NUMBER || '',
  userPhoneNumber: process.env.TWILIO_USER_PHONE_NUMBER || process.env.USER_PHONE_NUMBER || '',
  enableWhatsAppAlerts: false,
  enforceTwilioSignature: true,
};

class SettingsManager {
  private currentSettings: AppSettings;
  private isLoaded = false;

  constructor() {
    this.currentSettings = this.loadInitialSettings();
  }

  private loadInitialSettings(): AppSettings {
    let settings: AppSettings = { ...DEFAULT_SETTINGS };

    // 1. Check if twin-settings.json exists
    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        settings = {
          ...settings,
          ...parsed,
          providerModels: {
            ...settings.providerModels,
            ...(parsed.providerModels || {}),
          },
        };
        this.isLoaded = true;
        return settings;
      } catch (err) {
        console.warn('[SettingsManager] Failed reading twin-settings.json:', err);
      }
    }

    this.isLoaded = true;
    return settings;
  }

  private persistToDisk(settings: AppSettings) {
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SettingsManager] Failed writing twin-settings.json:', err);
    }
  }

  /**
   * Return current in-memory settings
   */
  public getSettings(): AppSettings {
    return {
      ...this.currentSettings,
      providerModels: { ...this.currentSettings.providerModels },
    };
  }

  /**
   * Asynchronously hydrate settings from Neon PostgreSQL if connected
   */
  public async syncFromDatabase(): Promise<AppSettings> {
    try {
      const dbSettings = await neonDb.getSettings();
      if (dbSettings && typeof dbSettings === 'object') {
        const typedDb = dbSettings as unknown as Partial<AppSettings>;
        this.currentSettings = {
          ...this.currentSettings,
          ...typedDb,
          providerModels: {
            ...this.currentSettings.providerModels,
            ...(typedDb.providerModels || {}),
          },
        };
        if (typedDb.activeModel) {
          this.currentSettings.activeModel = typedDb.activeModel;
        }
        this.persistToDisk(this.currentSettings);
      }
    } catch (err) {
      console.warn('[SettingsManager] Could not sync settings from Neon DB:', err);
    }
    return this.getSettings();
  }

  /**
   * Atomic update of settings across Memory, Disk, and Neon DB
   */
  public async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const updatedProviderModels = {
      ...this.currentSettings.providerModels,
      ...(patch.providerModels || {}),
    };

    // If an activeModel was specified for a specific provider
    if (patch.activeModel) {
      const targetProvider = patch.activeProvider || this.currentSettings.activeProvider;
      if (targetProvider === 'gemini' || targetProvider === 'groq' || targetProvider === 'mistral') {
        updatedProviderModels[targetProvider] = patch.activeModel;
      }
    }

    // If activeProvider changed but activeModel was not provided, sync activeModel from providerModels
    let activeModel = patch.activeModel || this.currentSettings.activeModel;
    if (patch.activeProvider && !patch.activeModel) {
      const prov = patch.activeProvider;
      if (prov === 'gemini' || prov === 'groq' || prov === 'mistral') {
        activeModel = updatedProviderModels[prov] || activeModel;
      }
    }

    this.currentSettings = {
      ...this.currentSettings,
      ...patch,
      activeModel,
      providerModels: updatedProviderModels,
    };

    // 1. Save to local disk (zero chance of losing on restart)
    this.persistToDisk(this.currentSettings);

    // 2. Save to Neon PostgreSQL if connected
    neonDb.saveSettings(this.currentSettings as unknown as Record<string, unknown>).catch((err) => {
      console.warn('[SettingsManager] Background Neon DB save error:', err);
    });

    return this.getSettings();
  }
}

export const settingsManager = new SettingsManager();
