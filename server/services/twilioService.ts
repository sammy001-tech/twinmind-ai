import type { Request } from 'express';
import twilio from 'twilio';
import { settingsManager } from '../db/settingsService.ts';
import type { AppSettings } from '../../src/types/index.ts';

export interface ResolvedTwilioConfig {
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
  userPhoneNumber: string;
  enforceSignature: boolean;
  source: 'settings' | 'env';
}

export interface SanitizedSettings extends Omit<AppSettings, 'twilioAuthToken'> {
  twilioTokenConfigured: boolean;
}

export class TwilioService {
  /**
   * Resolve Twilio credentials using unified single-source precedence.
   * Credentials must come entirely from Settings OR entirely from Environment Variables.
   */
  public getResolvedConfig(): ResolvedTwilioConfig | null {
    const settings = settingsManager.getSettings();

    const sAccountSid = (settings.twilioAccountSid || '').trim();
    const sAuthToken = (settings.twilioAuthToken || '').trim();
    const sWhatsAppNumber = (settings.twilioWhatsAppNumber || '').trim();
    const sUserPhone = (settings.userPhoneNumber || '').trim();

    const envAccountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const envAuthToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    const envWhatsAppNumber = (process.env.TWILIO_WHATSAPP_NUMBER || '').trim();
    const envUserPhone = (process.env.TWILIO_USER_PHONE_NUMBER || process.env.USER_PHONE_NUMBER || '').trim();

    // 1. Check Settings first
    const hasSettingsConfig = Boolean(sAccountSid && sAuthToken);
    if (hasSettingsConfig) {
      return {
        accountSid: sAccountSid,
        authToken: sAuthToken,
        whatsappNumber: this.formatWhatsAppNumber(sWhatsAppNumber || envWhatsAppNumber),
        userPhoneNumber: this.normalizePhoneNumber(sUserPhone || envUserPhone),
        enforceSignature: settings.enforceTwilioSignature !== false,
        source: 'settings',
      };
    }

    // 2. Check Environment Variables second
    const hasEnvConfig = Boolean(envAccountSid && envAuthToken);
    if (hasEnvConfig) {
      return {
        accountSid: envAccountSid,
        authToken: envAuthToken,
        whatsappNumber: this.formatWhatsAppNumber(envWhatsAppNumber || sWhatsAppNumber),
        userPhoneNumber: this.normalizePhoneNumber(envUserPhone || sUserPhone),
        enforceSignature: settings.enforceTwilioSignature !== false,
        source: 'env',
      };
    }

    // Partial or missing configuration across sources
    if (sAccountSid || sAuthToken || sWhatsAppNumber || envAccountSid || envAuthToken || envWhatsAppNumber) {
      console.warn('[TwilioService] Incomplete Twilio credentials detected across sources. Both Account SID, Auth Token, and WhatsApp Number must be provided together.');
    }

    return null;
  }

  /**
   * Normalize phone number format (returns +1234567890 without whatsapp: prefix)
   */
  public normalizePhoneNumber(phone: string): string {
    if (!phone) return '';
    return phone.replace(/^whatsapp:/i, '').trim();
  }

  /**
   * Format phone number with whatsapp: prefix
   */
  public formatWhatsAppNumber(phone: string): string {
    if (!phone) return '';
    const clean = phone.trim();
    if (clean.toLowerCase().startsWith('whatsapp:')) {
      return clean;
    }
    return `whatsapp:${clean}`;
  }

  /**
   * Validate incoming X-Twilio-Signature against current server credentials
   */
  public validateSignature(req: Request): boolean {
    const signature = req.headers['x-twilio-signature'] as string;
    if (!signature) {
      console.warn('[TwilioService] Missing X-Twilio-Signature header');
      return false;
    }

    const config = this.getResolvedConfig();
    if (!config) {
      console.warn('[TwilioService] Cannot validate signature: Twilio is unconfigured');
      return false;
    }

    if (!config.enforceSignature) {
      return true;
    }

    try {
      const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost';
      const url = `${protocol}://${host}${req.originalUrl || req.url}`;
      
      const params = req.body || {};
      const isValid = twilio.validateRequest(config.authToken, signature, url, params);
      
      if (!isValid) {
        console.warn(`[TwilioService] X-Twilio-Signature validation failed for URL: ${url}`);
      }
      return isValid;
    } catch (err) {
      console.error('[TwilioService] Error during signature validation:', err);
      return false;
    }
  }

  /**
   * Verify if sender's phone number matches authorized userPhoneNumber
   */
  public isAuthorizedSender(fromHeader: string): boolean {
    const config = this.getResolvedConfig();
    const sender = this.normalizePhoneNumber(fromHeader);

    if (!sender) return false;

    // If userPhoneNumber is configured, strictly enforce matching
    if (config?.userPhoneNumber) {
      const authorized = this.normalizePhoneNumber(config.userPhoneNumber);
      const matches = sender === authorized;
      if (!matches) {
        console.warn(`[TwilioService] Unauthorized WhatsApp sender: ${sender} (Expected: ${authorized})`);
      }
      return matches;
    }

    // If no explicit user phone number is locked down, permit for initial setup but log warning
    console.warn(`[TwilioService] No userPhoneNumber locked down in settings. Permitting message from ${sender}`);
    return true;
  }

  /**
   * Return client-safe settings object with boolean token indicator
   */
  public sanitizeSettingsForClient(settings: AppSettings): SanitizedSettings {
    const config = this.getResolvedConfig();
    const { twilioAuthToken, ...rest } = settings;

    return {
      ...rest,
      twilioAccountSid: settings.twilioAccountSid || (config?.source === 'env' ? config.accountSid : ''),
      twilioWhatsAppNumber: settings.twilioWhatsAppNumber || (config?.source === 'env' ? config.whatsappNumber : ''),
      userPhoneNumber: settings.userPhoneNumber || (config?.source === 'env' ? config.userPhoneNumber : ''),
      twilioTokenConfigured: Boolean(config?.authToken),
    };
  }

  /**
   * Helper to instantiate standard Twilio client
   */
  private getClient(config: ResolvedTwilioConfig) {
    return twilio(config.accountSid, config.authToken);
  }

  /**
   * Send outbound WhatsApp message via Twilio REST API
   */
  public async sendWhatsAppMessage(to: string, body: string): Promise<{ success: boolean; messageSid?: string; error?: string }> {
    const config = this.getResolvedConfig();
    if (!config) {
      return { success: false, error: 'Twilio is not configured.' };
    }

    try {
      const client = this.getClient(config);
      const formattedTo = this.formatWhatsAppNumber(to);

      const message = await client.messages.create({
        from: config.whatsappNumber,
        to: formattedTo,
        body,
      });

      console.log(`[TwilioService] Outbound WhatsApp message sent to ${formattedTo}. SID: ${message.sid}`);
      return { success: true, messageSid: message.sid };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[TwilioService] Failed to send WhatsApp message:', errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Execute 3-Stage Diagnostic Connection Test
   */
  public async runDiagnosticTest(): Promise<{
    stage1Configured: boolean;
    stage2AuthSuccess: boolean;
    stage3DeliverySuccess: boolean;
    details: {
      accountSid?: string;
      whatsappNumber?: string;
      userPhoneNumber?: string;
      accountName?: string;
      error?: string;
    };
  }> {
    const config = this.getResolvedConfig();

    if (!config) {
      return {
        stage1Configured: false,
        stage2AuthSuccess: false,
        stage3DeliverySuccess: false,
        details: { error: 'Twilio Account SID, Auth Token, or WhatsApp Number is missing.' },
      };
    }

    let stage2AuthSuccess = false;
    let stage3DeliverySuccess = false;
    let accountName = '';
    let lastError = '';

    // Stage 2: Validate API Auth against Twilio API
    try {
      const client = this.getClient(config);
      const account = await client.api.v2010.accounts(config.accountSid).fetch();
      stage2AuthSuccess = true;
      accountName = account.friendlyName || account.sid;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn('[TwilioService] Diagnostic Stage 2 Auth Failed:', lastError);
    }

    // Stage 3: Test Outbound Delivery if target phone provided & Auth succeeded
    if (stage2AuthSuccess && config.userPhoneNumber) {
      const testMsg = `[TwinMind Diagnostic] Test connection verified successfully! All systems operational.`;
      const sendRes = await this.sendWhatsAppMessage(config.userPhoneNumber, testMsg);
      stage3DeliverySuccess = sendRes.success;
      if (!sendRes.success && sendRes.error) {
        lastError = sendRes.error;
      }
    }

    return {
      stage1Configured: true,
      stage2AuthSuccess,
      stage3DeliverySuccess,
      details: {
        accountSid: config.accountSid,
        whatsappNumber: config.whatsappNumber,
        userPhoneNumber: config.userPhoneNumber,
        accountName,
        error: lastError || undefined,
      },
    };
  }
}

export const twilioService = new TwilioService();
