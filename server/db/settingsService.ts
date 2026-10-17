import fs from 'fs';
import path from 'path';
import type { AppSettings } from '../../src/types/index.ts';
import { neonDb } from './neonService.ts';

const SETTINGS_FILE_PATH = path.join(process.cwd(), 'twin-settings.json');

const DEFAULT_SETTINGS: AppSettings = {
  brandName: process.env.APP_BRAND_NAME || process.env.VITE_APP_BRAND_NAME || '',
  activeProvider: (process.env.ACTIVE_PROVIDER as 'gemini' | 'groq' | 'mistral' | '') || '',
  activeModel: process.env.ACTIVE_MODEL || process.env.GEMINI_MODEL || '',
  providerModels: {
    gemini: process.env.GEMINI_MODEL || '',
    groq: process.env.GROQ_MODEL || '',
    mistral: process.env.MISTRAL_MODEL || '',
  },
  voice: process.env.TTS_VOICE || '',
  userName: process.env.USER_NAME || '',
  nickname: process.env.USER_NICKNAME || '',
  customGeminiKey: process.env.GEMINI_API_KEY || '',
  customGroqKey: process.env.GROQ_API_KEY || '',
  customMistralKey: process.env.MISTRAL_API_KEY || '',
  customTavilyKey: process.env.TAVILY_API_KEY || '',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramOwnerId: process.env.TELEGRAM_OWNER_ID || '',
  telegramMode: process.env.TELEGRAM_MODE === 'webhook' ? 'webhook' : 'polling',
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
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
  proactiveAlertChannel: (process.env.PROACTIVE_ALERT_CHANNEL as 'whatsapp' | 'telegram' | 'none') || 'none',
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
            const prov = this.currentSettings.activeProvider;
            this.currentSettings.activeModel = prov
              ? (this.currentSettings.providerModels[prov as keyof typeof this.currentSettings.providerModels] || '')
              : '';
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

    const nextSettings: AppSettings = {
      ...this.currentSettings,
      ...filteredPatch,
      activeModel,
      providerModels: updatedProviderModels,
    };
    const credentialFields = [
      'customGeminiKey',
      'customGroqKey',
      'customMistralKey',
      'customTavilyKey',
      'twilioAuthToken',
      'telegramToken',
    ] as const;
    const isCredentialUpdate = credentialFields.some((field) =>
      Object.prototype.hasOwnProperty.call(filteredPatch, field)
    );

    // Credentials are intentionally excluded from the local settings file. Do not acknowledge a
    // credential update unless Neon confirms the durable write, and do not commit it to memory first.
    if (isCredentialUpdate) {
      const persisted = await neonDb.saveSettings(nextSettings as unknown as Record<string, unknown>);
      if (!persisted) {
        throw new Error(
          'CREDENTIAL_PERSISTENCE_UNAVAILABLE: Provider API keys require a healthy Neon PostgreSQL connection; no credential change was applied.',
        );
      }
      this.currentSettings = nextSettings;
      this.saveToDisk();
      return this.getSettings();
    }

    this.currentSettings = nextSettings;
    this.saveToDisk();

    // Non-secret preferences may still be saved locally when Neon is unavailable.
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

    const normalizeCredential = (value?: string): string => {
      if (typeof value !== 'string') return '';
      const key = value.trim().replace(/^["']|["']$/g, '');
      return !key || key.includes('...') || key === '********' ? '' : key;
    };
    const mask = (value?: string) => {
      const key = normalizeCredential(value);
      if (!key) return '';
      if (key.length < 8) return '********';
      return `${key.slice(0, 4)}...${key.slice(-4)}`;
    };
    const credentialSource = (environmentValue?: string, savedValue?: string) =>
      normalizeCredential(environmentValue) ? 'environment' : normalizeCredential(savedValue) ? 'settings' : 'none';

    // Explicit client DTO: unknown persisted properties and raw secrets are never spread into responses.
    return {
      brandName: s.brandName || '',
      activeProvider: s.activeProvider,
      activeModel: s.activeModel || '',
      providerModels: { ...s.providerModels },
      voice: s.voice || '',
      userName: s.userName || '',
      nickname: s.nickname || '',
      // Display the saved Settings credential, not the environment key; source/precedence is exposed separately.\n      customGeminiKey: mask(s.customGeminiKey),
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
      telegramToken: mask(runtime.telegramToken),
      telegramMode: runtime.telegramMode || '',
      telegramWebhookUrl: runtime.telegramWebhookUrl || '',
      hasTelegramToken: Boolean(normalizeCredential(process.env.TELEGRAM_BOT_TOKEN) || normalizeCredential(runtime.telegramToken)),
      hasGeminiKey: Boolean(normalizeCredential(process.env.GEMINI_API_KEY) || normalizeCredential(s.customGeminiKey)),
      hasGroqKey: Boolean(normalizeCredential(process.env.GROQ_API_KEY) || normalizeCredential(s.customGroqKey)),
      hasMistralKey: Boolean(normalizeCredential(process.env.MISTRAL_API_KEY) || normalizeCredential(s.customMistralKey)),
      hasTavilyKey: Boolean(normalizeCredential(process.env.TAVILY_API_KEY) || normalizeCredential(s.customTavilyKey)),
      apiKeySources: {
        gemini: credentialSource(process.env.GEMINI_API_KEY, s.customGeminiKey),
        groq: credentialSource(process.env.GROQ_API_KEY, s.customGroqKey),
        mistral: credentialSource(process.env.MISTRAL_API_KEY, s.customMistralKey),
        tavily: credentialSource(process.env.TAVILY_API_KEY, s.customTavilyKey),
        telegram: credentialSource(process.env.TELEGRAM_BOT_TOKEN, runtime.telegramToken),
        twilio: credentialSource(process.env.TWILIO_AUTH_TOKEN, s.twilioAuthToken),
      },
      twilioTokenConfigured: Boolean(normalizeCredential(s.twilioAuthToken) || normalizeCredential(process.env.TWILIO_AUTH_TOKEN)),
    };
  }
}

export const settingsManager = new SettingsManager();

