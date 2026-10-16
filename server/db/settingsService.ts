import fs from 'fs';
import path from 'path';
import type { AppSettings } from '../../src/types/index.ts';
import { neonDb } from './neonService.ts';

const SETTINGS_FILE_PATH = path.join(process.cwd(), 'twin-settings.json');

const DEFAULT_SETTINGS: AppSettings = {
  brandName: process.env.APP_BRAND_NAME || process.env.VITE_APP_BRAND_NAME || 'TwinMind AI',
  activeProvider: (process.env.ACTIVE_PROVIDER as 'gemini' | 'groq' | 'mistral') || 'gemini',
  activeModel: process.env.ACTIVE_MODEL || process.env.GEMINI_MODEL || '',
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
  proactiveAlertChannel: (process.env.PROACTIVE_ALERT_CHANNEL as 'whatsapp' | 'telegram' | 'none') || 'whatsapp',
  themeMode: 'system',
};

class SettingsManager {
  private currentSettings: AppSettings;
  private isLoaded = false;

  constructor() {
    this.currentSettings = { ...DEFAULT_SETTINGS };
    this.loadFromDisk();
    this.isLoaded = true;
  }

  /**
   * Load settings synchronously from local disk file
   */
  private loadFromDisk() {
    try {
      if (fs.existsSync(SETTINGS_FILE_PATH)) {
        const raw = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
        const diskSettings = JSON.parse(raw);
        if (diskSettings && typeof diskSettings === 'object') {
          this.currentSettings = {
            ...this.currentSettings,
            ...diskSettings,
            providerModels: {
              ...this.currentSettings.providerModels,
              ...(diskSettings.providerModels || {}),
            },
          };
          // Ensure activeModel matches current provider if not explicitly set
          if (!this.currentSettings.activeModel) {
            const prov = this.currentSettings.activeProvider || 'gemini';
            this.currentSettings.activeModel = this.currentSettings.providerModels[prov as keyof typeof this.currentSettings.providerModels] || '';
          }
        }
      }
    } catch (err) {
      console.warn('[SettingsManager] Failed to load settings from disk:', err);
    }
  }

  /**
   * Save current settings synchronously to local disk file
   * Excludes sensitive API keys to prevent exposure in local files
   */
  private saveToDisk() {
    try {
      const {
        customGeminiKey,
        customGroqKey,
        customMistralKey,
        customTavilyKey,
        twilioAuthToken,
        telegramToken,
        ...safeSettings
      } = this.currentSettings as AppSettings & { telegramToken?: string };

      fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(safeSettings, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[SettingsManager] Failed to save settings to disk:', err);
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
        this.saveToDisk();
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

    // Ignore client-sent masks so an unchanged secret cannot be replaced with its display placeholder.
    const filteredPatch = { ...patch } as Partial<AppSettings> & { telegramToken?: string };
    const isMasked = (val?: string) => typeof val === 'string' && (val.includes('...') || val === '********');

    if (isMasked(filteredPatch.customGeminiKey)) delete filteredPatch.customGeminiKey;
    if (isMasked(filteredPatch.customGroqKey)) delete filteredPatch.customGroqKey;
    if (isMasked(filteredPatch.customMistralKey)) delete filteredPatch.customMistralKey;
    if (isMasked(filteredPatch.customTavilyKey)) delete filteredPatch.customTavilyKey;
    if (isMasked(filteredPatch.twilioAuthToken)) delete filteredPatch.twilioAuthToken;
    if (isMasked(filteredPatch.telegramToken)) delete filteredPatch.telegramToken;

    this.currentSettings = {
      ...this.currentSettings,
      ...filteredPatch,
      activeModel,
      providerModels: updatedProviderModels,
    };

    // Save to Disk immediately
    this.saveToDisk();

    // Save to Neon PostgreSQL if connected (synchronously persisted)
    try {
      await neonDb.saveSettings(this.currentSettings as unknown as Record<string, unknown>);
    } catch (err) {
      console.warn('[SettingsManager] Neon DB save error:', err);
    }

    return this.getSettings();
  }

  /**
   * Return sanitized settings for client-side use (masks sensitive keys)
   * Includes environment variable fallbacks for display in UI when settings are empty.
   */
  public getSanitizedSettings(overrides: Partial<AppSettings> = {}) {
    const s = { ...this.getSettings(), ...overrides };
    const runtime = s as AppSettings & {
      telegramToken?: string;
      telegramMode?: string;
      telegramWebhookUrl?: string;
      telegramOwnerId?: string;
    };

    const mask = (key?: string) => {
      if (!key) return '';
      if (key.length < 8) return '********';
      return `${key.slice(0, 4)}...${key.slice(-4)}`;
    };

    // Explicit client DTO: unknown persisted properties and raw secrets are never spread into responses.
    return {
      brandName: s.brandName || '',
      activeProvider: s.activeProvider,
      activeModel: s.activeModel || '',
      providerModels: { ...s.providerModels },
      voice: s.voice || '',
      userName: s.userName || '',
      nickname: s.nickname || '',
      customGeminiKey: mask(s.customGeminiKey),
      customGroqKey: mask(s.customGroqKey),
      customMistralKey: mask(s.customMistralKey),
      customTavilyKey: mask(s.customTavilyKey),
      autoPlayVoice: s.autoPlayVoice,
      voiceSpeed: s.voiceSpeed,
      customPrompts: s.customPrompts || [],
      activeThreadId: s.activeThreadId ?? null,
      twilioAccountSid: s.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || '',
      twilioAuthToken: s.twilioAuthToken ? '********' : '',
      twilioWhatsAppNumber: s.twilioWhatsAppNumber || process.env.TWILIO_WHATSAPP_NUMBER || '',
      userPhoneNumber: s.userPhoneNumber || process.env.TWILIO_USER_PHONE_NUMBER || process.env.USER_PHONE_NUMBER || '',
      enableWhatsAppAlerts: s.enableWhatsAppAlerts,
      enforceTwilioSignature: s.enforceTwilioSignature,
      proactiveAlertChannel: s.proactiveAlertChannel,
      keyTestStatuses: s.keyTestStatuses,
      themeMode: s.themeMode,
      telegramToken: runtime.telegramToken ? '********' : '',
      telegramMode: runtime.telegramMode || '',
      telegramWebhookUrl: runtime.telegramWebhookUrl || '',
      hasTelegramToken: Boolean(runtime.telegramToken || process.env.TELEGRAM_BOT_TOKEN),
      hasGeminiKey: Boolean(s.customGeminiKey || process.env.GEMINI_API_KEY),
      hasGroqKey: Boolean(s.customGroqKey || process.env.GROQ_API_KEY),
      hasMistralKey: Boolean(s.customMistralKey || process.env.MISTRAL_API_KEY),
      hasTavilyKey: Boolean(s.customTavilyKey || process.env.TAVILY_API_KEY),
      twilioTokenConfigured: Boolean(s.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN),
    };
  }
}

export const settingsManager = new SettingsManager();

