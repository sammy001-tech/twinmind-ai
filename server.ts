import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { buildSystemPrompt } from './src/prompt/masterPrompt.ts';
import { telegramBotManager } from './server/telegram/telegramService.ts';
import { neonDb } from './server/db/neonService.ts';
import { settingsManager } from './server/db/settingsService.ts';
import { knowledgeService } from './server/db/knowledgeService.ts';
import { twinAgentService } from './server/services/twinAgentService.ts';
import { specialistSwarmService } from './server/services/specialistSwarmService.ts';
import { swarmSessionRegistry } from './server/utils/swarmResourceManager.ts';
import { twilioService } from './server/services/twilioService.ts';
import { jobQueueService } from './server/services/jobQueueService.ts';
import { whatsAppWorker } from './server/services/whatsappWorker.ts';
import { calibrationService } from './server/services/calibrationService.ts';
import { sentinelService } from './server/services/sentinelService.ts';
import { modelCatalogService } from './server/services/modelCatalogService.ts';
import { ownerAuthService } from './server/services/authService.ts';
import { artifactAccessService } from './server/services/artifactAccessService.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function secretsMatch(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

const app = express();
// Trust forwarded headers only when the deployment explicitly states its trusted proxy hop count.
const configuredProxyHops = process.env.TRUST_PROXY_HOPS?.trim();
if (configuredProxyHops) {
  const proxyHops = Number(configuredProxyHops);
  if (!Number.isSafeInteger(proxyHops) || proxyHops < 0) {
    throw new Error('INVALID_TRUST_PROXY_HOPS: set TRUST_PROXY_HOPS to a non-negative integer or leave it unset');
  }
  app.set('trust proxy', proxyHops);
}
const isProduction = process.env.NODE_ENV === 'production';
// In development, the dev server must always listen on port 3000; in production, use PORT provided by host (e.g. Render)
const PORT = isProduction ? (Number(process.env.PORT) || 3000) : 3000;

// Ensure local artifact storage directory exists
const artifactsDir = path.join(process.cwd(), 'public', 'artifacts');
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Owner-only API boundary. Signed webhooks are validated by their individual handlers.
const publicApiPaths = new Set([
  '/health',
  '/auth/session',
  '/auth/login',
  '/auth/logout',
  '/twilio/whatsapp',
  '/telegram/webhook',
]);
app.use('/api', (req: Request, res: Response, next) => {
  if (publicApiPaths.has(req.path)) {
    next();
    return;
  }

  if (!ownerAuthService.isConfigured()) {
    res.status(503).json({
      success: false,
      code: 'AUTH_CONFIGURATION_MISSING',
      error: 'Owner authentication is not configured.',
      requiredEnvironment: ownerAuthService.missingConfiguration(),
    });
    return;
  }

  if (!ownerAuthService.isAuthenticated(req)) {
    res.status(401).json({ success: false, code: 'AUTHORIZATION_REQUIRED', error: 'Owner sign-in is required.' });
    return;
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    const host = req.get('host');
    if (origin && host) {
      try {
        if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) {
          res.status(403).json({ success: false, code: 'INVALID_ORIGIN', error: 'Cross-origin request rejected.' });
          return;
        }
      } catch {
        res.status(403).json({ success: false, code: 'INVALID_ORIGIN', error: 'Invalid request origin.' });
        return;
      }
    }
  }

  next();
});

// Authentication endpoints are intentionally public; protected APIs require the signed HttpOnly session cookie.
app.get('/api/auth/session', (req: Request, res: Response) => {
  res.json({ configured: ownerAuthService.isConfigured(), authenticated: ownerAuthService.isAuthenticated(req) });
});

const loginAttempts = new Map<string, { windowStartedAt: number; count: number; blockedUntil: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
app.post('/api/auth/login', (req: Request, res: Response) => {
  if (!ownerAuthService.isConfigured()) {
    res.status(503).json({
      success: false,
      code: 'AUTH_CONFIGURATION_MISSING',
      error: 'Owner authentication is not configured.',
      requiredEnvironment: ownerAuthService.missingConfiguration(),
    });
    return;
  }

  const now = Date.now();
  const ipKey = req.ip || 'unknown';
  let attempt = loginAttempts.get(ipKey);
  if (!attempt || now - attempt.windowStartedAt >= LOGIN_WINDOW_MS) {
    attempt = { windowStartedAt: now, count: 0, blockedUntil: 0 };
    loginAttempts.set(ipKey, attempt);
  }
  if (attempt.blockedUntil > now) {
    res.status(429).json({ success: false, code: 'LOGIN_RATE_LIMITED', error: 'Too many sign-in attempts. Try again later.' });
    return;
  }

  if (!ownerAuthService.verifyPassword(req.body?.password)) {
    attempt.count += 1;
    if (attempt.count >= LOGIN_MAX_ATTEMPTS) attempt.blockedUntil = now + LOGIN_WINDOW_MS;
    res.status(401).json({ success: false, code: 'INVALID_CREDENTIALS', error: 'The owner password was not accepted.' });
    return;
  }

  loginAttempts.delete(ipKey);
  ownerAuthService.setSessionCookie(res);
  res.json({ success: true, expiresInSeconds: 12 * 60 * 60 });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  ownerAuthService.clearSessionCookie(res);
  res.json({ success: true });
});

// Artifacts are no longer anonymously served. A valid owner session or a short-lived signed URL is required.
app.get('/artifacts/:filename', (req: Request, res: Response) => {
  const fileName = req.params.filename || '';
  if (!fileName || fileName !== path.basename(fileName) || fileName === '.' || fileName === '..') {
    res.status(400).json({ success: false, code: 'INVALID_ARTIFACT_NAME' });
    return;
  }

  const isOwner = ownerAuthService.isAuthenticated(req);
  const isSigned = artifactAccessService.verifySignedRequest(fileName, req.query.expires, req.query.signature);
  if (!isOwner && !isSigned) {
    res.status(401).json({ success: false, code: 'ARTIFACT_ACCESS_REQUIRED' });
    return;
  }

  const artifactsRoot = path.resolve(process.cwd(), 'public', 'artifacts');
  const filePath = path.resolve(artifactsRoot, fileName);
  if (!filePath.startsWith(artifactsRoot + path.sep)) {
    res.status(400).json({ success: false, code: 'INVALID_ARTIFACT_PATH' });
    return;
  }

  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ success: false, code: 'ARTIFACT_NOT_FOUND' });
    }
  });
});

// Shared server-side dynamic Gemini client supporting customGeminiKey override
function getAiClient(req?: Request): GoogleGenAI {
  const customKey = (req
    ? ((req.headers['x-gemini-key'] as string) ||
       (req.headers['x-api-key'] as string) ||
       (req.body?.customGeminiKey as string))
    : '')?.trim().replace(/^["']|["']$/g, '');

  const settingsKey = (settingsManager.getSettings().customGeminiKey || '').trim().replace(/^["']|["']$/g, '');
  const envKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');

  const apiKey = customKey || settingsKey || envKey;

  return new GoogleGenAI({
    apiKey: apiKey || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Helper for retrying transient model unavailability spikes (503 / 429)
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 1000): Promise<T> {
  let attempt = 0;
  let delay = initialDelay;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      attempt++;
      const errStr = String(err);
      const isTransient =
        errStr.includes('503') ||
        errStr.includes('429') ||
        errStr.includes('UNAVAILABLE') ||
        errStr.includes('high demand');
      if (attempt < maxRetries && isTransient) {
        console.warn(`Gemini call encountered transient issue (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 1.5;
      } else {
        throw err;
      }
    }
  }
}

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', authConfigured: ownerAuthService.isConfigured() });
});

// Settings GET endpoint with dynamic database synchronization and comprehensive secret sanitization
app.get('/api/settings', async (_req: Request, res: Response) => {
  await settingsManager.syncFromDatabase();
  const sanitized = settingsManager.getSanitizedSettings();
  res.json({ success: true, settings: sanitized });
});

// Settings POST endpoint
app.post('/api/settings', async (req: Request, res: Response) => {
  try {
    await settingsManager.updateSettings(req.body);
    const sanitized = settingsManager.getSanitizedSettings();
    res.json({ success: true, settings: sanitized });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to update settings' });
  }
});

// Twilio Diagnostic Connection Test Endpoint
app.all('/api/twilio/test', async (_req: Request, res: Response) => {
  try {
    const diagnostic = await twilioService.runDiagnosticTest();
    res.json({ success: true, diagnostic });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Twilio diagnostic test failed' });
  }
});

// Twilio WhatsApp Inbound Webhook Endpoint
// Processing order: (1) Signature check -> (2) Sender auth -> (3) Persist job -> (4) TwiML ACK -> (5) Async process
app.post('/api/twilio/whatsapp', async (req: Request, res: Response): Promise<void> => {
  try {
    const config = twilioService.getResolvedConfig();
    if (!config) {
      res.status(503).json({ success: false, code: 'TWILIO_CONFIGURATION_MISSING' });
      return;
    }

    // Production inbound webhooks always require a valid signature against TWILIO_WEBHOOK_URL.
    if (process.env.NODE_ENV === 'production' && !config.enforceSignature) {
      res.status(503).json({ success: false, code: 'TWILIO_SIGNATURE_ENFORCEMENT_REQUIRED' });
      return;
    }
    if (config.enforceSignature) {
      const isValidSig = twilioService.validateSignature(req);
      if (!isValidSig) {
        console.warn('[Twilio Webhook] Rejected request with invalid or unverifiable signature.');
        res.status(403).type('text/xml').send('<Response><Message>Forbidden: invalid webhook signature</Message></Response>');
        return;
      }
    }

    if (!config.userPhoneNumber) {
      res.status(503).json({ success: false, code: 'TWILIO_SENDER_ALLOWLIST_MISSING' });
      return;
    }
    const fromHeader = (req.body?.From || '').trim();

    // 2. Sender Auth: Verify From against authorized user phone
    const isAuthorized = twilioService.isAuthorizedSender(fromHeader);
    if (!isAuthorized) {
      console.warn('[Twilio Webhook] Rejected request from unauthorized sender.');
      res.status(401).type('text/xml').send('<Response><Message>Unauthorized sender</Message></Response>');
      return;
    }

    const messageSid = typeof req.body?.MessageSid === 'string' ? req.body.MessageSid.trim() : '';
    if (!messageSid) {
      res.status(400).json({ success: false, code: 'TWILIO_MESSAGE_SID_MISSING' });
      return;
    }
    const senderPhone = twilioService.normalizePhoneNumber(fromHeader);

    // 3. Atomic Persist: Record MessageSid & Job in Neon DB BEFORE returning ACK
    const { isDuplicate } = await jobQueueService.enqueueInboundJob(messageSid, senderPhone, req.body || {});

    // 4. Return TwiML ACK (HTTP 200) immediately
    res.status(200).type('text/xml').send('<Response></Response>');

    // 5. Async Dispatch: Hand off to background worker if not duplicate
    if (!isDuplicate) {
      whatsAppWorker.triggerImmediateProcessing();
    }
  } catch (err) {
    console.error('[Twilio Webhook] Error handling webhook:', err);
    if (!res.headersSent) {
      res.status(500).type('text/xml').send('<Response></Response>');
    }
  }
});

// Live Multi-Model Status & Capabilities probe (Strict Zero-Fallback Policy)
app.get('/api/models/status', async (_req: Request, res: Response) => {
  const settings = settingsManager.getSettings();
  const keys = {
    gemini: (settings.customGeminiKey || process.env.GEMINI_API_KEY || '').trim(),
    groq: (settings.customGroqKey || process.env.GROQ_API_KEY || '').trim(),
    mistral: (settings.customMistralKey || process.env.MISTRAL_API_KEY || '').trim(),
  };

  const [geminiModels, groqModels, mistralModels] = await Promise.all([
    modelCatalogService.getLiveModels('gemini', keys.gemini),
    modelCatalogService.getLiveModels('groq', keys.groq),
    modelCatalogService.getLiveModels('mistral', keys.mistral),
  ]);

  const catalogueStatus = (key: string, models: unknown[]) =>
    !key ? 'unconfigured' : models.length ? 'available' : 'unavailable';
  const providerModel = (provider: 'gemini' | 'groq' | 'mistral', models: Array<{id:string}>) => {
    const configured = settings.providerModels?.[provider] ||
      (settings.activeProvider === provider ? settings.activeModel : '');
    return {
      configuredModel: configured || null,
      configuredModelAvailable: configured ? models.some((item) => item.id === configured) : false,
    };
  };

  res.json({
    checkedAt: new Date().toISOString(),
    providers: [
      {
        id: 'gemini',
        name: 'Google Gemini',
        hasKey: Boolean(keys.gemini),
        enabled: Boolean(keys.gemini && geminiModels.length),
        catalogueStatus: catalogueStatus(keys.gemini, geminiModels),
        liveModelCount: geminiModels.length,
        ...providerModel('gemini', geminiModels),
      },
      {
        id: 'groq',
        name: 'Groq',
        hasKey: Boolean(keys.groq),
        enabled: Boolean(keys.groq && groqModels.length),
        catalogueStatus: catalogueStatus(keys.groq, groqModels),
        liveModelCount: groqModels.length,
        ...providerModel('groq', groqModels),
      },
      {
        id: 'mistral',
        name: 'Mistral AI',
        hasKey: Boolean(keys.mistral),
        enabled: Boolean(keys.mistral && mistralModels.length),
        catalogueStatus: catalogueStatus(keys.mistral, mistralModels),
        liveModelCount: mistralModels.length,
        ...providerModel('mistral', mistralModels),
      },
    ],
  });
});

// Diagnostic endpoint to verify Environment Key format and basic connectivity
app.get('/api/keys/verify-env', async (_req: Request, res: Response) => {
  const envKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!envKey) {
    res.status(503).json({ success: false, code: 'PROVIDER_CREDENTIALS_MISSING', provider: 'gemini' });
    return;
  }

  const models = await modelCatalogService.getLiveGeminiModels(envKey);
  if (!models.length) {
    res.status(502).json({
      success: false,
      code: 'LIVE_MODEL_CATALOG_UNAVAILABLE',
      provider: 'gemini',
      checkedAt: new Date().toISOString(),
    });
    return;
  }

  res.json({
    success: true,
    provider: 'gemini',
    liveModelCount: models.length,
    checkedAt: new Date().toISOString(),
  });
});

// Real-Time Live API Key Verification Endpoint (Strict Zero-Fallback Policy)
app.post('/api/keys/test', async (req: Request, res: Response): Promise<void> => {
  const { provider, apiKey } = req.body;
  if (!provider) {
    res.status(400).json({ success: false, error: 'Provider is required' });
    return;
  }

  const cleanKey = (typeof apiKey === 'string' ? apiKey : '').trim().replace(/^["']|["']$/g, '');
  const isMasked = (val?: string) => typeof val === 'string' && (val.includes('...') || val === '********');
  const userProvidedKey = isMasked(cleanKey) ? '' : cleanKey;

  if (provider === 'gemini') {
    const sKey = (settingsManager.getSettings().customGeminiKey || '').trim().replace(/^["']|["']$/g, '');
    const eKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    const effectiveKey = userProvidedKey || sKey || eKey;

    if (!effectiveKey) {
      res.status(400).json({ success: false, error: 'Please enter a Gemini API key (starting with AIza or AQ.) or configure GEMINI_API_KEY.' });
      return;
    }

    try {
      const startTime = Date.now();
      const testClient = new GoogleGenAI({
        apiKey: effectiveKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      // Verify live access with Google GenAI
      const pager = await testClient.models.list();
      let count = 0;
      for await (const m of pager) {
        if (m.name) count++;
        if (count >= 3) break;
      }
      const latencyMs = Date.now() - startTime;
      res.json({
        success: true,
        message: `Gemini API key verified in ${latencyMs}ms! Connected to Google GenAI.`,
        latencyMs,
      });
    } catch (err: any) {
      console.warn('Gemini test key error:', err);
      let errorMsg = err?.message || 'Gemini API authentication failed.';
      
      // Try to parse clean message from raw Google RPC JSON if present
      try {
        if (errorMsg.includes('{')) {
          const parsed = JSON.parse(errorMsg.substring(errorMsg.indexOf('{')));
          if (parsed.error?.message) {
            errorMsg = parsed.error.message;
          }
        }
      } catch {}

      res.status(401).json({ success: false, error: errorMsg });
    }
    return;
  }

  if (provider === 'groq') {
    const sKey = (settingsManager.getSettings().customGroqKey || '').trim();
    const eKey = (process.env.GROQ_API_KEY || '').trim();
    const effectiveKey = userProvidedKey || sKey || eKey;

    if (!effectiveKey) {
      res.status(400).json({ success: false, error: 'Please enter a Groq API key to test (starting with gsk_).' });
      return;
    }

    try {
      const startTime = Date.now();
      const gRes = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${effectiveKey}` },
      });
      const latencyMs = Date.now() - startTime;
      if (gRes.ok) {
        const data = await gRes.json();
        const modelCount = Array.isArray(data.data) ? data.data.length : 0;
        res.json({
          success: true,
          message: `Groq API key verified in ${latencyMs}ms! Connected to Groq LPUs (${modelCount} models available).`,
          latencyMs,
        });
      } else {
        const errData = await gRes.json().catch(() => ({}));
        res.status(gRes.status).json({
          success: false,
          error: errData.error?.message || `Groq API verification failed (HTTP ${gRes.status}).`,
        });
      }
    } catch (err: any) {
      res.status(502).json({ success: false, error: err?.message || 'Failed to connect to Groq API endpoint.' });
    }
    return;
  }

  if (provider === 'mistral') {
    const sKey = (settingsManager.getSettings().customMistralKey || '').trim();
    const eKey = (process.env.MISTRAL_API_KEY || '').trim();
    const effectiveKey = userProvidedKey || sKey || eKey;

    if (!effectiveKey) {
      res.status(400).json({ success: false, error: 'Please enter a Mistral API key to test.' });
      return;
    }

    try {
      const startTime = Date.now();
      const mRes = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${effectiveKey}` },
      });
      const latencyMs = Date.now() - startTime;
      if (mRes.ok) {
        const data = await mRes.json();
        const modelCount = Array.isArray(data.data) ? data.data.length : 0;
        res.json({
          success: true,
          message: `Mistral API key verified in ${latencyMs}ms! Connected to Mistral AI (${modelCount} models available).`,
          latencyMs,
        });
      } else {
        const errData = await mRes.json().catch(() => ({}));
        res.status(mRes.status).json({
          success: false,
          error: errData.message || `Mistral API verification failed (HTTP ${mRes.status}).`,
        });
      }
    } catch (err: any) {
      res.status(502).json({ success: false, error: err?.message || 'Failed to connect to Mistral AI endpoint.' });
    }
    return;
  }

  res.status(400).json({ success: false, error: `Unknown provider: ${provider}` });
});

// Live Dynamic Models Query Endpoint (Queries live API or catalog)
app.get('/api/models/live', async (req: Request, res: Response): Promise<void> => {
  const provider = req.query.provider as string;
  if (provider !== 'gemini' && provider !== 'groq' && provider !== 'mistral') {
    res.status(400).json({ success: false, code: 'PROVIDER_REQUIRED', error: 'Specify a supported provider to query its live model catalogue.' });
    return;
  }

  const settings = settingsManager.getSettings();
  const key = (
    req.get(`x-${provider}-key`) ||
    req.get('x-api-key') ||
    (provider === 'gemini' ? settings.customGeminiKey || process.env.GEMINI_API_KEY :
      provider === 'groq' ? settings.customGroqKey || process.env.GROQ_API_KEY :
        settings.customMistralKey || process.env.MISTRAL_API_KEY) ||
    ''
  ).trim().replace(/^["']|["']$/g, '');

  if (!key) {
    res.status(503).json({ success: false, provider, code: 'PROVIDER_CREDENTIALS_MISSING', models: [], isLiveApi: false });
    return;
  }

  const models = await modelCatalogService.getLiveModels(provider, key);
  if (!models.length) {
    res.status(502).json({
      success: false,
      provider,
      code: 'LIVE_MODEL_CATALOG_UNAVAILABLE',
      models: [],
      isLiveApi: false,
      checkedAt: new Date().toISOString(),
    });
    return;
  }

  res.json({
    success: true,
    provider,
    models,
    isLiveApi: true,
    checkedAt: new Date().toISOString(),
  });
});

app.get('/api/models/all', async (req: Request, res: Response): Promise<void> => {
  const settings = settingsManager.getSettings();
  const keys = {
    gemini: (req.get('x-gemini-key') || req.get('x-api-key') || settings.customGeminiKey || process.env.GEMINI_API_KEY || '').trim(),
    groq: (req.get('x-groq-key') || req.get('x-api-key') || settings.customGroqKey || process.env.GROQ_API_KEY || '').trim(),
    mistral: (req.get('x-mistral-key') || req.get('x-api-key') || settings.customMistralKey || process.env.MISTRAL_API_KEY || '').trim(),
  };

  const [gemini, groq, mistral] = await Promise.all([
    modelCatalogService.getLiveModels('gemini', keys.gemini),
    modelCatalogService.getLiveModels('groq', keys.groq),
    modelCatalogService.getLiveModels('mistral', keys.mistral),
  ]);

  res.json({
    gemini,
    groq,
    mistral,
    checkedAt: new Date().toISOString(),
    isLive: {
      gemini: Boolean(keys.gemini && gemini.length),
      groq: Boolean(keys.groq && groq.length),
      mistral: Boolean(keys.mistral && mistral.length),
    },
    counts: { gemini: gemini.length, groq: groq.length, mistral: mistral.length },
    configured: {
      gemini: Boolean(keys.gemini),
      groq: Boolean(keys.groq),
      mistral: Boolean(keys.mistral),
    },
  });
});

// Live Streaming Chat endpoint with Server-Sent Events (SSE) and Router
app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      messages,
      channel = 'web',
      userName: requestedUserName,
      nickname = '',
      userContext, // User Context payload containing nickname, activeModel, and selectedVoice
      provider: requestedProvider,
      model,
      threadId, // Persistent multi-thread conversation ID
      threadTitle, // Optional title for this thread
      customGroqKey,
      customMistralKey,
      customTavilyKey,
    } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Messages array is required.' });
      return;
    }

    const effectiveThreadId = threadId || `thread-${Date.now()}`;
    const firstUserMsg = messages.find((m: { role: string }) => m.role === 'user');
    const effectiveThreadTitle =
      threadTitle || (firstUserMsg?.content ? firstUserMsg.content.slice(0, 48) : 'New Conversation');

    // Ensure thread exists in Neon database
    neonDb.saveThread({ id: effectiveThreadId, title: effectiveThreadTitle, channel }).catch(() => {});

    const currentSettings = settingsManager.getSettings();
    const userName = (typeof requestedUserName === 'string' && requestedUserName.trim())
      ? requestedUserName.trim()
      : (currentSettings.userName || '');
    const provider = requestedProvider || currentSettings.activeProvider;
    if (provider !== 'gemini' && provider !== 'groq' && provider !== 'mistral') {
      res.status(503).json({ success: false, code: 'PROVIDER_CONFIGURATION_REQUIRED', error: 'Configure an active AI provider in Settings.' });
      return;
    }

    // Resolve effective user configuration details for complete self-awareness
    const effectiveNickname = userContext?.nickname || nickname || currentSettings.nickname || '';
    const effectiveUserName = userContext?.userName || userName || currentSettings.userName || '';
    const effectiveVoice = userContext?.selectedVoice || currentSettings.voice || '';

    // Never reuse a model identifier saved for a different provider or silently select another model.
    const targetProvider = provider;
    const targetModel = model || currentSettings.providerModels[targetProvider] ||
      (currentSettings.activeProvider === targetProvider ? currentSettings.activeModel : '');

    if (!targetModel) {
      res.status(503).json({
        success: false,
        code: 'MODEL_CONFIGURATION_REQUIRED',
        error: `Configure an explicit model for provider "${targetProvider}" before starting a chat.`,
      });
      return;
    }

    // Semantic vector knowledge recall via Neon pgvector
    const queryUserMsg = [...messages].reverse().find((m: { role: string; content: string }) => m.role === 'user');
    let recalledKnowledge: Array<{ title: string; content: string; category?: string; similarity?: number }> = [];
    if (queryUserMsg && queryUserMsg.content) {
      try {
        recalledKnowledge = await knowledgeService.search(queryUserMsg.content, 3, 0.45);
      } catch (kErr) {
        console.warn('Vector knowledge recall warning in chat:', kErr);
      }
    }

    // Build system prompt with explicit User Context & recalled pgvector knowledge
    const systemInstruction = buildSystemPrompt({
      channel,
      userName: effectiveUserName,
      nickname: effectiveNickname,
      activeModel: targetModel,
      activeProvider: targetProvider,
      selectedVoice: effectiveVoice,
      recalledKnowledge,
      activeThreadTitle: effectiveThreadTitle,
    });

    const effectiveGroqKey = customGroqKey || process.env.GROQ_API_KEY;
    const effectiveMistralKey = customMistralKey || process.env.MISTRAL_API_KEY;

    // Setup SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Emit initial metadata about which brain model is active and recalled vector knowledge
    res.write(
      `data: ${JSON.stringify({
        meta: {
          provider: targetProvider,
          model: targetModel,
          threadId: effectiveThreadId,
          threadTitle: effectiveThreadTitle,
          userContext: {
            nickname: effectiveNickname,
            voice: effectiveVoice,
          },
          recalledNotes: recalledKnowledge.map((k) => ({ title: k.title, similarity: k.similarity })),
        },
      })}\n\n`
    );

    // Track full reply for database persistence
    let fullReply = '';

    // Handle client disconnection / cancellation
    const abortController = new AbortController();
    req.on('close', () => {
      abortController.abort();
    });

    // Keep-alive heartbeat every 10s to prevent proxy timeouts
    const heartbeatTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(':heartbeat\n\n');
      }
    }, 10000);

    const lastUserMsg = (messages as Array<any>).filter((m) => m.role === 'user').pop();
    const lastUserQuery = lastUserMsg?.content || '';
    const lastImageData = lastUserMsg?.imageData;
    const lastAudioData = lastUserMsg?.audioData;

    const conversationHistory = (messages as Array<any>).slice(0, -1).map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content || '',
      imageData: m.imageData,
      audioData: m.audioData,
    }));

    // Detect if Multi-Agent Specialist Swarm is requested
    const isSwarmRequested = Boolean(
      req.body.useSwarm ||
      /(\/swarm|\b(swarm|specialist\s+swarm|specialist\s+agents|deep\s+research\s+and\s+calculate|generate\s+file|create\s+pdf|export\s+csv|make\s+markdown)\b)/i.test(lastUserQuery)
    );

    if (isSwarmRequested) {
      const cleanPrompt = lastUserQuery.replace(/^\/swarm\s*/i, '').trim();
      const swarmSession = await specialistSwarmService.executeSwarmTurn({
        userPrompt: cleanPrompt,
        channel: (channel as any) || 'web',
        threadId: effectiveThreadId,
        customTavilyKey,
        providerOverride: targetProvider as any,
        modelOverride: targetModel,
        customGroqKey,
        customMistralKey,
        signal: abortController.signal,
        callbacks: {
          onSwarmInit: (data) => {
            res.write(`data: ${JSON.stringify({ swarmEvent: { type: 'init', ...data } })}\n\n`);
          },
          onSpecialistStart: (data) => {
            res.write(`data: ${JSON.stringify({ swarmEvent: { type: 'specialist_start', ...data } })}\n\n`);
          },
          onToolCall: (data) => {
            res.write(`data: ${JSON.stringify({ swarmEvent: { type: 'tool_call', ...data } })}\n\n`);
          },
          onToolResult: (data) => {
            res.write(`data: ${JSON.stringify({ swarmEvent: { type: 'tool_result', ...data } })}\n\n`);
          },
          onSpecialistDone: (data) => {
            res.write(`data: ${JSON.stringify({ swarmEvent: { type: 'specialist_done', ...data } })}\n\n`);
          },
          onSynthesisChunk: (text) => {
            fullReply = text;
          },
          onComplete: (session) => {
            res.write(`data: ${JSON.stringify({ swarmEvent: { type: 'complete', session } })}\n\n`);
          },
          onError: (error) => {
            res.write(`data: ${JSON.stringify({ swarmEvent: { type: 'error', error } })}\n\n`);
          },
        },
      });

      clearInterval(heartbeatTimer);
      fullReply = swarmSession.synthesis || fullReply;

      // Extract artifacts from session traces for persistence and client UI
      const artifacts: any[] = [];
      swarmSession.traces.forEach((trace) => {
        trace.tools.forEach((tool) => {
          if (tool.toolName === 'generateArtifact' && tool.status === 'success') {
            const res = tool.output as any;
            if (res.url) {
              artifacts.push({ name: res.fileName, url: res.url, type: res.type });
            }
          }
        });
      });

      // Pass artifacts to client via SSE for immediate display
      if (artifacts.length > 0) {
        res.write(`data: ${JSON.stringify({ meta: { artifacts } })}\n\n`);
      }

      const chunkSize = 28;
      for (let i = 0; i < fullReply.length; i += chunkSize) {
        const slice = fullReply.slice(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ text: slice })}\n\n`);
        // Add a small delay for the "screaming" (streaming) effect
        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      // Store artifacts for the save step
      (req as any)._artifacts = artifacts;
    } else {
      // Autonomous execution via multi-provider TwinAgentService (Gemini, Groq, Mistral)
      const turnResult = await twinAgentService.executeTurn({
        userPrompt: lastUserQuery,
        imageData: lastImageData,
        audioData: lastAudioData,
        channel: (channel as any) || 'web',
        conversationHistory,
        userName: effectiveUserName,
        nickname: effectiveNickname,
        selectedVoice: effectiveVoice,
        activeThreadTitle: effectiveThreadTitle,
        customGroqKey,
        customMistralKey,
        customTavilyKey,
        providerOverride: targetProvider as any,
        modelOverride: targetModel,
        onToolStart: (toolName, args) => {
          res.write(`data: ${JSON.stringify({ toolEvent: { type: 'start', toolName, args } })}\n\n`);
        },
        onToolComplete: (toolName, result) => {
          res.write(`data: ${JSON.stringify({ toolEvent: { type: 'complete', toolName, result } })}\n\n`);
        },
      });

      clearInterval(heartbeatTimer);
      fullReply = turnResult.reply;

      // Extract artifacts from executed tools for single-agent mode
      const artifacts: any[] = [];
      turnResult.toolsExecuted.forEach((tool) => {
        if (tool.toolName === 'generateArtifact' && (tool.result as any)?.status === 'success') {
          const res = tool.result as any;
          if (res.url) {
            artifacts.push({ name: res.fileName, url: res.url, type: res.type });
          }
        }
      });

      // Pass artifacts to client via SSE
      if (artifacts.length > 0) {
        res.write(`data: ${JSON.stringify({ meta: { artifacts } })}\n\n`);
      }

      const chunkSize = 24;
      for (let i = 0; i < fullReply.length; i += chunkSize) {
        const slice = fullReply.slice(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ text: slice })}\n\n`);
        // Add a small delay for the "screaming" (streaming) effect
        await new Promise((resolve) => setTimeout(resolve, 12));
      }

      // Store artifacts for saving
      (req as any)._artifacts = artifacts;
    }

    // Persist messages to Neon Postgres if configured
    let userDbId: number | undefined;
    let assistantDbId: number | undefined;

    const lastUserMsgToSave = messages[messages.length - 1];
    if (lastUserMsgToSave && (lastUserMsgToSave.content || lastUserMsgToSave.imageData)) {
      try {
        userDbId = await neonDb.saveMessage({
          session_id: effectiveThreadId,
          channel: (channel as 'web' | 'telegram' | 'whatsapp') || 'web',
          role: 'user',
          content: lastUserMsgToSave.content || '[Attached Photo/Image]',
          provider: targetProvider,
          model: targetModel,
        });
      } catch (dbErr) {
        console.warn('[NeonDB] Save user msg error:', dbErr);
      }
    }
    if (fullReply) {
      try {
        assistantDbId = await neonDb.saveMessage({
          session_id: effectiveThreadId,
          channel: (channel as 'web' | 'telegram' | 'whatsapp') || 'web',
          role: 'assistant',
          content: fullReply,
          provider: targetProvider,
          model: targetModel,
          metadata: { artifacts: (req as any)._artifacts || [] },
        });
      } catch (dbErr) {
        console.warn('[NeonDB] Save assistant msg error:', dbErr);
      }
    }

    // Refresh thread record in chat_threads
    neonDb.saveThread({ id: effectiveThreadId, title: effectiveThreadTitle, channel }).catch(() => {});

    // Emit saved IDs so client can attach real database IDs immediately
    res.write(
      `data: ${JSON.stringify({
        savedMeta: {
          userDbId,
          assistantDbId,
          threadId: effectiveThreadId,
          threadTitle: effectiveThreadTitle,
        },
      })}\n\n`
    );

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: unknown) {
    console.error('Chat error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown generation error occurred.';
    if (!res.headersSent) {
      res.status(500).json({ error: errorMessage });
    } else {
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
    }
  }
});

// ==========================================
// Multi-Agent Specialist Swarm Direct API Endpoint
// ==========================================
app.post('/api/swarm/execute', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, provider, model, customTavilyKey, customGroqKey, customMistralKey, channel = 'web' } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'Prompt string is required' });
      return;
    }

    const session = await specialistSwarmService.executeSwarmTurn({
      userPrompt: prompt.trim(),
      channel,
      customTavilyKey,
      providerOverride: provider || settingsManager.getSettings().activeProvider,
      modelOverride: model || settingsManager.getSettings().activeModel,
      customGroqKey,
      customMistralKey,
    });

    res.json({ success: true, session });
  } catch (err: unknown) {
    console.error('Swarm execution error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Swarm execution failed' });
  }
});

app.post('/api/swarm/cancel', (req: Request, res: Response): void => {
  try {
    const { sessionId, userId } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required to cancel' });
      return;
    }
    const cancelled = swarmSessionRegistry.cancelSession(sessionId, userId);
    res.json({ success: cancelled, sessionId, message: cancelled ? 'Session cancelled' : 'Session not found or already completed' });
  } catch (err: unknown) {
    res.status(403).json({ error: err instanceof Error ? err.message : 'Cancellation failed' });
  }
});

// ==========================================
// Multi-Thread Conversations API Endpoints
// ==========================================

// Get all threads
app.get('/api/threads', async (req: Request, res: Response): Promise<void> => {
  try {
    const channel = (req.query.channel as string) || undefined;
    const threads = await neonDb.getThreads(channel);
    res.json({ success: true, threads });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to retrieve threads' });
  }
});

// Create or update a thread
app.post('/api/threads', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, title, channel = 'web' } = req.body;
    if (!id || !title) {
      res.status(400).json({ error: 'Thread ID and title are required.' });
      return;
    }
    await neonDb.saveThread({ id, title, channel });
    res.json({ success: true, message: 'Thread saved.' });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to save thread' });
  }
});

// Update thread title
app.put('/api/threads/:id/title', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    if (!title || !title.trim()) {
      res.status(400).json({ error: 'Title cannot be empty.' });
      return;
    }
    await neonDb.saveThread({ id, title: title.trim() });
    res.json({ success: true, message: 'Thread renamed.' });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to rename thread' });
  }
});

// Clear all conversation threads and messages
app.delete('/api/threads', async (_req: Request, res: Response): Promise<void> => {
  try {
    await neonDb.clearAllThreads();
    res.json({ success: true, message: 'All conversation threads cleared from database.' });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to clear all threads' });
  }
});

// Delete a single thread and its messages
app.delete('/api/threads/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await neonDb.deleteThread(id);
    res.json({ success: true, message: 'Thread deleted successfully.' });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to delete thread' });
  }
});

// Get all messages for a thread
app.get('/api/threads/:id/messages', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const messages = await neonDb.getThreadMessages(id);
    res.json({ success: true, messages });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to retrieve thread messages' });
  }
});

// Edit/update a message
app.put('/api/messages/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const { content, threadId } = req.body;
    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Message content cannot be empty.' });
      return;
    }
    const success = await neonDb.updateMessage(rawId, content.trim(), threadId);
    res.json({ success, message: success ? 'Message updated.' : 'Message not found.' });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// Delete a single message
app.delete('/api/messages/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const threadId = (req.query.threadId as string) || (req.body?.threadId as string);
    const success = await neonDb.deleteMessage(rawId, threadId);
    res.json({ success, message: success ? 'Message deleted.' : 'Message not found.' });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Live Decision & Advice Framework Analyzer with optional Challenger Second Opinion
app.post('/api/analyze-decision', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      dilemma,
      channel = 'web',
      userName: requestedUserName,
      nickname: requestedNickname,
      model,
      provider: requestedProvider,
      includeChallenger,
      customMistralKey,
    } = req.body;

    if (typeof dilemma !== 'string' || !dilemma.trim()) {
      res.status(400).json({ success: false, code: 'INVALID_DECISION_INPUT', error: 'A non-empty decision prompt is required.' });
      return;
    }

    const currentSettings = settingsManager.getSettings();
    const provider = requestedProvider || currentSettings.activeProvider;
    if (provider !== 'gemini') {
      res.status(409).json({
        success: false,
        code: 'PROVIDER_UNSUPPORTED_FOR_ENDPOINT',
        error: 'This endpoint currently implements Gemini analysis only. Select Gemini explicitly or use the multi-provider chat endpoint.',
      });
      return;
    }

    const geminiKey = (
      req.get('x-gemini-key') ||
      req.get('x-api-key') ||
      req.body?.customGeminiKey ||
      currentSettings.customGeminiKey ||
      process.env.GEMINI_API_KEY ||
      ''
    ).trim().replace(/^["']|["']$/g, '');

    if (!geminiKey) {
      res.status(503).json({ success: false, code: 'PROVIDER_CREDENTIALS_MISSING:gemini' });
      return;
    }

    const configuredModel = model ||
      currentSettings.providerModels?.gemini ||
      (currentSettings.activeProvider === 'gemini' ? currentSettings.activeModel : '');

    if (!configuredModel) {
      res.status(503).json({ success: false, code: 'MODEL_CONFIGURATION_REQUIRED:gemini' });
      return;
    }

    const primaryModel = await modelCatalogService.resolveModelForProvider('gemini', configuredModel, geminiKey);
    const userName = typeof requestedUserName === 'string' && requestedUserName.trim()
      ? requestedUserName.trim()
      : (currentSettings.userName || '');
    const nickname = typeof requestedNickname === 'string' && requestedNickname.trim()
      ? requestedNickname.trim()
      : (currentSettings.nickname || '');

    const systemInstruction = buildSystemPrompt({
      channel,
      userName,
      nickname,
      activeModel: primaryModel,
      activeProvider: 'gemini',
      selectedVoice: currentSettings.voice || '',
    });

    const analysisPrompt = \`Analyze the following decision using evidence-bound reasoning.
Separate facts from assumptions, compare realistic options and trade-offs, and identify practical next steps.
Do not invent personal facts, sources, historical data, or user preferences.
Return only one valid JSON object with these keys:
{
  "actualSituation": "string",
  "confidenceLevel": "High" | "Medium" | "Low",
  "confidenceScore": "integer from 0 to 100, or null when a defensible estimate is not possible",
  "confidenceReason": "string describing verified evidence and unresolved assumptions",
  "whatMattersMost": "string",
  "realisticOptions": ["string"],
  "tradeOffs": "string",
  "principalRisks": "string",
  "recommendedAction": "string",
  "nextPracticalStep": "string",
  "clarifyingQuestion": "string; empty only when no critical fact is missing"
}
confidenceScore is a model estimate, not an empirically calibrated probability. Do not map confidenceLevel to a numeric score.
Decision to analyze:
\${dilemma}\`;

    const response = await callWithRetry(() =>
      getAiClient(req).models.generateContent({
        model: primaryModel,
        contents: analysisPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
        },
      })
    );

    const jsonText = response.text?.trim() || '';
    if (!jsonText) throw new Error('AI_OUTPUT_EMPTY: decision model returned no usable output');

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error('AI_OUTPUT_INVALID_JSON: decision model did not return a valid JSON object');
    }

    const requiredStrings = [
      'actualSituation',
      'confidenceLevel',
      'confidenceReason',
      'whatMattersMost',
      'tradeOffs',
      'principalRisks',
      'recommendedAction',
      'nextPracticalStep',
      'clarifyingQuestion',
    ];
    const validConfidence = ['High', 'Medium', 'Low'].includes(parsed.confidenceLevel);
    const validScore = parsed.confidenceScore === null ||
      (Number.isInteger(parsed.confidenceScore) && parsed.confidenceScore >= 0 && parsed.confidenceScore <= 100);
    if (!parsed || typeof parsed !== 'object' ||
        requiredStrings.some((key) => typeof parsed[key] !== 'string') ||
        !Array.isArray(parsed.realisticOptions) ||
        !parsed.realisticOptions.every((item: unknown) => typeof item === 'string') ||
        !validConfidence || !validScore) {
      throw new Error('AI_OUTPUT_SCHEMA_INVALID: decision model output failed schema validation');
    }

    // The challenger is optional and only runs when explicitly requested. It never silently
    // substitutes a second Gemini call and labels it an independent provider.
    if (includeChallenger === true) {
      const mistralKey = (customMistralKey || currentSettings.customMistralKey || process.env.MISTRAL_API_KEY || '').trim();
      const challengerConfiguredModel = req.body?.challengerModel ||
        currentSettings.providerModels?.mistral ||
        (currentSettings.activeProvider === 'mistral' ? currentSettings.activeModel : '');

      if (!mistralKey || !challengerConfiguredModel) {
        parsed.challengerStatus = {
          status: 'unavailable',
          code: 'CHALLENGER_CONFIGURATION_MISSING',
        };
      } else {
        try {
          const challengerModel = await modelCatalogService.resolveModelForProvider('mistral', challengerConfiguredModel, mistralKey);
          const challengerPrompt = \`Critically review this decision analysis using only the supplied text. Do not invent facts or evidence.
Decision: \${dilemma}
Primary analysis: \${JSON.stringify(parsed)}
Return JSON with "agreementLevel" (one of "High Agreement", "Partial Disagreement", "Alternative Perspective") and "points" (array of evidence-based strings).\`;
          const challengerResponse = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: \`Bearer \${mistralKey}\`,
            },
            body: JSON.stringify({
              model: challengerModel,
              messages: [{ role: 'user', content: challengerPrompt }],
              response_format: { type: 'json_object' },
            }),
          });

          if (!challengerResponse.ok) {
            parsed.challengerStatus = {
              status: 'unavailable',
              code: 'CHALLENGER_PROVIDER_ERROR',
              httpStatus: challengerResponse.status,
            };
          } else {
            const challengerData: any = await challengerResponse.json();
            const challengerText = challengerData.choices?.[0]?.message?.content?.trim() || '';
            if (!challengerText) {
              parsed.challengerStatus = { status: 'failed', code: 'CHALLENGER_OUTPUT_EMPTY' };
            } else {
              const critique = JSON.parse(challengerText);
              const allowedAgreement = ['High Agreement', 'Partial Disagreement', 'Alternative Perspective'];
              if (!allowedAgreement.includes(critique.agreementLevel) ||
                  !Array.isArray(critique.points) ||
                  !critique.points.every((point: unknown) => typeof point === 'string')) {
                parsed.challengerStatus = { status: 'failed', code: 'CHALLENGER_OUTPUT_SCHEMA_INVALID' };
              } else {
                parsed.challengerCritique = { model: challengerModel, points: critique.points, agreementLevel: critique.agreementLevel };
                parsed.challengerStatus = { status: 'complete' };
              }
            }
          }
        } catch (challengerError) {
          parsed.challengerStatus = {
            status: 'unavailable',
            code: 'CHALLENGER_RESOLUTION_FAILED',
            error: challengerError instanceof Error ? challengerError.message : 'Challenger resolution failed',
          };
        }
      }
    } else {
      parsed.challengerStatus = { status: 'not_requested' };
    }

    const decisionId = await neonDb.saveDecision({
      title: dilemma.slice(0, 100),
      situation: parsed.actualSituation,
      options: parsed.realisticOptions,
      recommendation: parsed.recommendedAction,
      confidence: parsed.confidenceScore,
      full_analysis: parsed,
      channel,
    });

    res.json({
      success: true,
      analysis: parsed,
      persistence: decisionId === null
        ? { status: 'failed', code: 'PERSISTENCE_FAILED' }
        : { status: 'persisted', decisionId },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Decision analysis failed';
    console.error('[DecisionAnalysis] Request failed:', message);
    res.status(502).json({
      success: false,
      code: message.split(':')[0] || 'DECISION_ANALYSIS_FAILED',
      error: message,
    });
  }
});

// Text-to-Speech (Voice Note generation) using dynamic model resolution
app.post('/api/tts', async (req: Request, res: Response): Promise<void> => {
  try {
    const { text, voice = 'Fenrir' } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text string is required.' });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
      return;
    }

    // Clean markdown symbols for smooth reading and process real-time message dynamically
    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' code block snippet ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/[*_#>-]/g, ' ');

    // Fully dynamic output token budget based on real-time message length
    const dynamicOutputTokens = Math.min(8192, Math.max(1024, Math.ceil(text.length * 2.5)));

    const response = await callWithRetry(async () => {
      const model = await modelCatalogService.resolveSpecializedModel('tts');
      return getAiClient(req).models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [{ text: cleanText }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          maxOutputTokens: dynamicOutputTokens,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice }, // 'Fenrir', 'Puck', 'Charon', 'Kore', 'Zephyr'
            },
          },
        },
      });
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      res.status(500).json({ error: 'No audio returned from speech model.' });
      return;
    }

    res.json({
      audioDataUrl: `data:audio/wav;base64,${base64Audio}`,
    });
  } catch (err: unknown) {
    console.error('TTS error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Speech synthesis failed.';
    res.status(500).json({ error: errorMessage });
  }
});

// =========================================================================
// Unified App Settings Persistence (Zero hardcoding, survives restarts & Neon)
// =========================================================================
// The canonical settings GET/POST handlers are defined near the top of this file.

// Voice Note Audio Transcription & Executive Summary Generation
app.post('/api/audio/transcribe-and-summarize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { audioBase64, mimeType, prompt } = req.body;
    if (!audioBase64) {
      res.status(400).json({ success: false, error: 'audioBase64 data is required.' });
      return;
    }

    const settings = settingsManager.getSettings();
    const provider = settings.activeProvider || 'gemini';
    const model = settings.activeModel || settings.providerModels?.[provider] || '';

    const effectivePrompt =
      prompt ||
      'Listen to this voice memo / audio recording, transcribe it accurately, extract key action items and strategic takeaways, and generate a professional PDF meeting notes document or financial forecast.';

    const turnResult = await twinAgentService.executeTurn({
      userPrompt: effectivePrompt,
      audioData: {
        mimeType: mimeType || 'audio/webm',
        data: audioBase64,
      },
      channel: 'web',
      providerOverride: provider as any,
      modelOverride: model,
    });

    res.json({
      success: true,
      reply: turnResult.reply,
      toolsExecuted: turnResult.toolsExecuted,
      suggestedActions: turnResult.suggestedActions,
      provider: turnResult.provider,
      model: turnResult.model,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});


// =========================================================================
// Real Telegram Bot Integration Endpoints (Owner Guard & Dual-Mode Engine)
// =========================================================================

// Get status of Telegram bot engine
app.get('/api/telegram/status', (req: Request, res: Response) => {
  res.json(telegramBotManager.getStatus());
});

// Update Telegram bot configuration (token, mode, webhookUrl)
app.post('/api/telegram/config', async (req: Request, res: Response) => {
  const { token, mode, webhookUrl, activeProvider, activeModel } = req.body;
  const result = await telegramBotManager.updateConfig({
    ...(token !== undefined ? { token: token.trim() } : {}),
    ...(mode ? { mode } : {}),
    ...(webhookUrl !== undefined ? { webhookUrl: webhookUrl.trim() } : {}),
    ...(activeProvider ? { activeProvider } : {}),
    ...(activeModel ? { activeModel } : {}),
  });
  res.json({ ...result, status: telegramBotManager.getStatus() });
});

// Reset owner pairing and generate new code
app.post('/api/telegram/reset-pairing', (req: Request, res: Response) => {
  const newCode = telegramBotManager.resetPairing();
  res.json({ success: true, pairingCode: newCode, status: telegramBotManager.getStatus() });
});

// Test bot token with Telegram getMe API
app.post('/api/telegram/test-token', async (req: Request, res: Response) => {
  const { token } = req.body;
  const result = await telegramBotManager.testToken(token);
  res.json(result);
});

// Get synced Telegram messages
app.get('/api/telegram/messages', (req: Request, res: Response) => {
  res.json({ messages: telegramBotManager.getSyncedMessages() });
});

// Dynamic commands: list registered command handlers and runtime readiness
app.get('/api/telegram/commands', (req: Request, res: Response) => {
  res.json({ commands: telegramBotManager.getRegisteredCommands() });
});

// Dynamic command generator: synchronize /setMyCommands with Telegram
app.post('/api/telegram/sync-commands', async (req: Request, res: Response) => {
  const result = await telegramBotManager.syncTelegramCommandMenu();
  res.json(result);
});

// Webhook endpoint (used when mode is set to 'webhook')
app.post('/api/telegram/webhook', (req: Request, res: Response, next) => {
  const expectedSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  const suppliedSecret = req.get('x-telegram-bot-api-secret-token') || '';
  if (!expectedSecret || !suppliedSecret || !secretsMatch(expectedSecret, suppliedSecret)) {
    res.status(403).json({ success: false, code: 'TELEGRAM_WEBHOOK_UNAUTHORIZED' });
    return;
  }
  return telegramBotManager.getWebhookCallback()(req, res, next);
});

// --- Neon Serverless PostgreSQL Database Endpoints (Hybrid: .env or Settings UI) ---
app.get('/api/db/status', async (_req: Request, res: Response) => {
  try {
    const status = await neonDb.getStatus();
    res.json(status);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Database status check failed' });
  }
});

app.post('/api/db/test', async (req: Request, res: Response) => {
  try {
    const { databaseUrl } = req.body;
    const result = await neonDb.testCustomUrl(databaseUrl);
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Test connection error' });
  }
});

app.post('/api/db/config', async (req: Request, res: Response) => {
  try {
    const { databaseUrl } = req.body;
    const result = await neonDb.saveConfigUrl(databaseUrl);
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Save DB config error' });
  }
});

app.get('/api/db/messages', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const channel = req.query.channel as string | undefined;
    const messages = await neonDb.getRecentMessages(limit, channel);
    res.json({ messages });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error fetching messages' });
  }
});

app.get('/api/db/decisions', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const decisions = await neonDb.getDecisions(limit);
    res.json({ decisions });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error fetching decisions' });
  }
});

// Single decision lookup
app.get('/api/decisions/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const decId = parseInt(req.params.id, 10);
    if (isNaN(decId)) {
      res.status(400).json({ error: 'Invalid decision ID' });
      return;
    }
    const decision = await neonDb.getDecisionById(decId);
    if (!decision) {
      res.status(404).json({ error: 'Decision record not found' });
      return;
    }
    res.json({ success: true, decision });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Error retrieving decision' });
  }
});

// Post-decision outcome observation submission (Append-only & Idempotent)
app.post('/api/decisions/:id/reviews', async (req: Request, res: Response): Promise<void> => {
  try {
    const decId = parseInt(req.params.id, 10);
    if (isNaN(decId)) {
      res.status(400).json({ error: 'Invalid decision ID' });
      return;
    }

    // 1. Authorization check at server boundary
    const userEmail = (req.headers['x-user-email'] as string) || req.body.userEmail || '';
    if (!userEmail || !userEmail.trim()) {
      res.status(401).json({
        error: 'Unauthorized review request. Valid user identity header (x-user-email) is required.',
      });
      return;
    }

    // 2. Check if original decision exists
    const decision = await neonDb.getDecisionById(decId);
    if (!decision) {
      res.status(404).json({ error: 'Target decision record not found for review.' });
      return;
    }

    const { observation, actualOutcome, idempotencyKey, reviewData } = req.body;
    if (!observation || typeof observation !== 'string' || !observation.trim()) {
      res.status(400).json({ error: 'Observation string is required.' });
      return;
    }

    // 3. Generate idempotency key if not provided
    const effectiveKey =
      idempotencyKey ||
      `rev-${decId}-${userEmail.trim().toLowerCase()}-${Buffer.from(observation.trim().slice(0, 32)).toString('hex')}`;

    // 4. Save review observation without mutating original decision row
    const result = await neonDb.saveDecisionReview({
      decisionId: decId,
      idempotencyKey: effectiveKey,
      userEmail: userEmail.trim(),
      observation: observation.trim(),
      actualOutcome: actualOutcome || 'Pending Verification',
      reviewData: reviewData || {},
    });

    if (result.conflict) {
      res.status(409).json({
        success: false,
        error: '409 Conflict: Idempotency key reused with a different observation payload.',
      });
      return;
    }

    res.json({
      success: true,
      reviewId: result.reviewId,
      isDuplicate: result.isDuplicate,
      message: result.isDuplicate
        ? 'Duplicate review submission detected (idempotent response returned).'
        : 'Outcome observation successfully appended to decision history.',
    });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to record decision review observation.' });
  }
});

// Retrieve immutable decision review outcome history
app.get('/api/decisions/:id/reviews', async (req: Request, res: Response): Promise<void> => {
  try {
    const decId = parseInt(req.params.id, 10);
    if (isNaN(decId)) {
      res.status(400).json({ error: 'Invalid decision ID' });
      return;
    }

    const decision = await neonDb.getDecisionById(decId);
    if (!decision) {
      res.status(404).json({ error: 'Decision record not found.' });
      return;
    }

    const reviews = await neonDb.getDecisionReviews(decId);
    res.json({ success: true, reviews });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Error fetching decision reviews' });
  }
});

// Calibration analytics metrics endpoint (Unbundled Brier score & sample size gated)
app.get('/api/calibration', async (req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await neonDb.getCalibrationMetrics();
    res.json({ success: true, metrics });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Error computing calibration metrics' });
  }
});

// Register or update decision experiment
app.post('/api/decisions/:id/experiments', async (req: Request, res: Response): Promise<void> => {
  try {
    const decId = parseInt(req.params.id, 10);
    if (isNaN(decId)) {
      res.status(400).json({ error: 'Invalid decision ID' });
      return;
    }

    const userEmail = (req.headers['x-user-email'] as string) || req.body.userEmail || '';
    if (!userEmail) {
      res.status(401).json({ error: 'Unauthorized: User identity header (x-user-email) is required.' });
      return;
    }

    const { baselineMetric, targetMetric, units, thresholdValue, measurementDirection, status, targetDate } = req.body;

    const result = await neonDb.saveDecisionExperiment({
      decisionId: decId,
      userEmail: userEmail.trim(),
      baselineMetric,
      targetMetric,
      units,
      thresholdValue: typeof thresholdValue === 'number' ? thresholdValue : undefined,
      measurementDirection,
      status: status || (baselineMetric ? 'Active' : 'Proposed'),
      targetDate,
    });

    res.json({
      success: true,
      experimentId: result.id,
      message: 'Decision experiment registered successfully.',
    });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Error registering decision experiment' });
  }
});

// Get experiments for a specific decision
app.get('/api/decisions/:id/experiments', async (req: Request, res: Response): Promise<void> => {
  try {
    const decId = parseInt(req.params.id, 10);
    if (isNaN(decId)) {
      res.status(400).json({ error: 'Invalid decision ID' });
      return;
    }

    const experiments = await neonDb.getDecisionExperiments(decId);
    res.json({ success: true, experiments });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Error fetching experiments' });
  }
});

// Get all experiments across decisions
app.get('/api/experiments', async (req: Request, res: Response): Promise<void> => {
  try {
    const experiments = await neonDb.getDecisionExperiments();
    res.json({ success: true, experiments });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Error fetching all experiments' });
  }
});

// Automated checks live in the test runner and CI; no endpoint reports unexecuted checks as passed.

// =========================================================================
// Vector-Based Knowledge Storage Endpoints (Neon pgvector & Gemini Embedding)
// =========================================================================

app.get('/api/knowledge', async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const query = req.query.query as string | undefined;
    const docs = await knowledgeService.listDocuments(category, query);
    res.json({ success: true, documents: docs });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to list knowledge docs' });
  }
});

app.post('/api/knowledge', async (req: Request, res: Response) => {
  try {
    const { title, content, category, tags } = req.body;
    if (!title || !content) {
      res.status(400).json({ error: 'Title and content are required' });
      return;
    }
    const result = await knowledgeService.addDocument({ title, content, category, tags });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to save knowledge document' });
  }
});

app.delete('/api/knowledge/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await knowledgeService.deleteDocument(id);
    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to delete knowledge document' });
  }
});

app.post('/api/knowledge/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = 5, threshold = 0.4 } = req.body;
    if (!query) {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }
    const results = await knowledgeService.search(query, Number(limit), Number(threshold));
    res.json({ success: true, results });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Vector search failed' });
  }
});

app.get('/api/knowledge/status', async (_req: Request, res: Response) => {
  try {
    const status = await knowledgeService.getStatus();
    res.json(status);
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to get knowledge status' });
  }
});

// Dynamic Categories with counts & management
app.get('/api/knowledge/categories', async (_req: Request, res: Response) => {
  try {
    const categories = await knowledgeService.getCategoriesWithCounts();
    res.json({ success: true, categories });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch categories' });
  }
});

app.post('/api/knowledge/categories/rename', async (req: Request, res: Response) => {
  try {
    const { oldCategory, newCategory } = req.body;
    if (!oldCategory || !newCategory) {
      res.status(400).json({ success: false, error: 'oldCategory and newCategory are required' });
      return;
    }
    const modified = await knowledgeService.renameCategory(oldCategory, newCategory);
    res.json({ success: true, modified });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to rename category' });
  }
});

app.post('/api/knowledge/categories/delete', async (req: Request, res: Response) => {
  try {
    const { category, fallbackCategory = 'personal_note' } = req.body;
    if (!category) {
      res.status(400).json({ success: false, error: 'Category is required' });
      return;
    }
    const modified = await knowledgeService.deleteCategory(category, fallbackCategory);
    res.json({ success: true, modified });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Failed to delete category' });
  }
});

// Dynamic context-driven suggested prompts generated via active brain model (zero static/hardcoded fallbacks)
app.get('/api/suggested-prompts', async (_req: Request, res: Response) => {
  try {
    const docs = await knowledgeService.listDocuments();
    if (!docs.length) {
      res.status(409).json({
        success: false,
        code: 'KNOWLEDGE_CONTEXT_UNAVAILABLE',
        error: 'No stored knowledge records are available to ground suggested prompts.',
      });
      return;
    }

    const settings = settingsManager.getSettings();
    const provider = settings.activeProvider;
    const model = settings.activeModel || (provider ? settings.providerModels?.[provider] : '');
    if ((provider !== 'gemini' && provider !== 'groq' && provider !== 'mistral') || !model) {
      res.status(503).json({
        success: false,
        code: 'MODEL_CONFIGURATION_REQUIRED',
        error: 'Configure an active provider and explicit model to generate suggested prompts.',
      });
      return;
    }

    const docTitles = docs.map((doc) => doc.title).filter((title) => typeof title === 'string' && title.trim());
    if (!docTitles.length) {
      res.status(409).json({
        success: false,
        code: 'KNOWLEDGE_CONTEXT_UNAVAILABLE',
        error: 'Stored knowledge records have no usable titles to ground suggested prompts.',
      });
      return;
    }

    const identityContext = [settings.brandName?.trim(), settings.userName?.trim()]
      .filter((value) => Boolean(value))
      .join(' / ');
    const promptText = `Generate 4 useful suggested chat prompts grounded strictly in the following stored knowledge record titles.
${identityContext ? `Configured workspace identity: ${identityContext}.\\n` : ''}Knowledge record titles: ${JSON.stringify(docTitles)}.
Do not invent facts about the user or assume details absent from these records. Return a JSON object with a "prompts" array of exactly 4 objects. Each object must contain "badge", "title", "prompt", and "description".`;

    const resText = await twinAgentService.generateCompletion({
      prompt: promptText,
      provider,
      model,
      jsonMode: true,
    });

    if (!resText.trim()) throw new Error('AI_OUTPUT_EMPTY: suggested prompt model returned no usable content');
    const parsed = JSON.parse(resText);
    if (!Array.isArray(parsed.prompts) || parsed.prompts.length !== 4 ||
        parsed.prompts.some((item: any) => !item || typeof item.badge !== 'string' ||
          typeof item.title !== 'string' || typeof item.prompt !== 'string' ||
          typeof item.description !== 'string')) {
      throw new Error('AI_OUTPUT_SCHEMA_INVALID: suggested prompts response did not match the required schema');
    }

    res.json({ success: true, prompts: parsed.prompts });
  } catch (err: unknown) {
    res.status(502).json({
      success: false,
      code: 'SUGGESTED_PROMPTS_GENERATION_FAILED',
      error: err instanceof Error ? err.message : 'Suggested prompts generation failed',
    });
  }
});

// Tavily AI Key Status & Verification Endpoints (Strict Zero-Fallback Policy)
app.get('/api/tavily/status', (req: Request, res: Response): void => {
  const configured = !!(process.env.TAVILY_API_KEY || settingsManager.getSettings().customTavilyKey);
  const source = process.env.TAVILY_API_KEY ? 'environment' : settingsManager.getSettings().customTavilyKey ? 'settings' : 'none';
  res.json({
    configured,
    source,
    maskedKey: configured ? 'tvly-••••••••••••' : null,
  });
});

app.post('/api/tavily/test', async (req: Request, res: Response): Promise<void> => {
  const apiKey = req.body.apiKey || settingsManager.getSettings().customTavilyKey || process.env.TAVILY_API_KEY;
  if (!apiKey) {
    res.status(400).json({
      success: false,
      error: 'Tavily API Key is not configured. Please enter your Tavily key (starting with tvly-) in Settings or set TAVILY_API_KEY.',
    });
    return;
  }

  try {
    const startTime = Date.now();
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: 'ping test',
        max_results: 1,
      }),
    });
    const latencyMs = Date.now() - startTime;
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      res.status(400).json({
        success: false,
        error: `Tavily API error (${response.status}): ${errText || 'Invalid API key or quota exceeded'}`,
      });
      return;
    }
    const data = await response.json();
    res.json({
      success: true,
      message: `Tavily API connection verified in ${latencyMs}ms. Real-time search is active.`,
      latencyMs,
    });
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to reach Tavily API endpoint.',
    });
  }
});

// Tavily AI Live Search Endpoint (Strict Zero-Fallback Policy)
app.post('/api/search', async (req: Request, res: Response): Promise<void> => {
  const { query, maxResults = 5 } = req.body;
  if (!query) {
    res.status(400).json({ success: false, error: 'Search query is required' });
    return;
  }
  const tavilyApiKey =
    req.body.customTavilyKey ||
    (req.headers['x-tavily-api-key'] as string) ||
    settingsManager.getSettings().customTavilyKey ||
    process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    res.status(500).json({ success: false, error: 'TAVILY_API_KEY is not configured on the server or in request. Live search requires a valid Tavily API key.' });
    return;
  }

  let attempt = 0;
  while (attempt < 3) {
    try {
      attempt++;
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query,
          max_results: maxResults,
          include_answer: true,
          include_raw_content: false,
        }),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Tavily API error (${response.status}): ${errText}`);
      }
      const data = await response.json();
      res.json({ success: true, results: data.results || [], answer: data.answer || '' });
      return;
    } catch (err: unknown) {
      if (attempt >= 3) {
        res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Tavily search failed after 3 attempts' });
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
});

// Tavily Web Scraper Endpoint (Strict Zero-Fallback Policy)
app.post('/api/scrape', async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;
  if (!url) {
    res.status(400).json({ success: false, error: 'Target URL is required' });
    return;
  }
  const tavilyApiKey =
    req.body.customTavilyKey ||
    (req.headers['x-tavily-api-key'] as string) ||
    settingsManager.getSettings().customTavilyKey ||
    process.env.TAVILY_API_KEY;
  if (!tavilyApiKey) {
    res.status(500).json({ success: false, error: 'TAVILY_API_KEY is not configured on the server or in request.' });
    return;
  }

  let attempt = 0;
  while (attempt < 3) {
    try {
      attempt++;
      const response = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          urls: [url],
        }),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Tavily Extract error (${response.status}): ${errText}`);
      }
      const data = await response.json();
      const extracted = data.results?.[0] || data.extract_results?.[0];
      if (!extracted) {
        throw new Error('No content could be extracted from the provided URL.');
      }
      res.json({ success: true, url, title: extracted.title || url, content: extracted.raw_content || extracted.content || '' });
      return;
    } catch (err: unknown) {
      if (attempt >= 3) {
        res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Scraping failed after 3 attempts' });
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
});

// Multi-Agent Debate & Devil's Advocate Endpoint (Strict Zero-Fallback & Evidence-Audited)
app.post('/api/debate', async (req: Request, res: Response): Promise<void> => {
  const { topic } = req.body;
  if (!topic) {
    res.status(400).json({ success: false, error: 'Debate topic is required' });
    return;
  }
  try {
    const s = settingsManager.getSettings();
    const effectiveMistralKey = req.body.customMistralKey || s.customMistralKey || process.env.MISTRAL_API_KEY;
    const effectiveGroqKey = req.body.customGroqKey || s.customGroqKey || process.env.GROQ_API_KEY;

    const [geminiModel, groqModel, mistralModel] = await Promise.all([
      modelCatalogService.resolveModelForProvider('gemini', s.providerModels.gemini),
      modelCatalogService.resolveModelForProvider('groq', s.providerModels.groq, effectiveGroqKey),
      modelCatalogService.resolveModelForProvider('mistral', s.providerModels.mistral, effectiveMistralKey),
    ]);

    // Pass 1: Search Knowledge Vault for verified evidence
    let knowledgeDocs: Array<{ id?: string | number; title: string; content: string }> = [];
    let contextStatus: 'available' | 'unavailable' = 'unavailable';

    try {
      knowledgeDocs = await knowledgeService.search(topic, 3, 0.35);
      if (knowledgeDocs.length > 0) {
        contextStatus = 'available';
      }
    } catch (kErr) {
      console.warn('Knowledge Vault search warning for debate:', kErr);
      contextStatus = 'unavailable';
    }

    const groundTruthContext = contextStatus === 'available'
      ? `VERIFIED KNOWLEDGE VAULT RECORDS:\n${knowledgeDocs.map((d) => `- [Source ID: ${d.id || 'doc'}] "${d.title}": ${d.content.slice(0, 300)}`).join('\n')}\n`
      : 'EXPLICIT STATUS: Knowledge Vault returned 0 matching documents or was unavailable. NO PRE-EXISTING VERIFIED RECORDS EXIST FOR THIS TOPIC.\n';

    const evidenceRules = `
EVIDENCE STANDARDS & CLAIM VALIDATION CONTRACTS:
1. Every claim MUST be explicitly tagged with one of: [Verified], [Inferred], [Hypothesis], [Unknown].
2. [Verified] requires referencing a specific matching record from the VERIFIED KNOWLEDGE VAULT RECORDS above.
${contextStatus === 'unavailable' ? '3. CRITICAL: Zero Knowledge Vault records were retrieved. You MUST NOT label any statement or numerical metric as [Verified]. Tag claims as [Hypothesis] or [Unknown].' : ''}
4. DO NOT invent or simulate unverified figures (user counts, revenue, conversion rates) as verified facts.
5. If no baseline metric exists in the sources, label proposed targets as [Conditional Hypothesis - Missing Baseline].
`;

    // Server-Side Claim Downgrade Validator
    const enforceClaimValidation = (text: string): string => {
      if (contextStatus === 'unavailable') {
        // Downgrade any ungrounded [Verified] tags to [Hypothesis - Source Unverified]
        return text.replace(/\[Verified\]/g, '[Hypothesis - Source Unverified]');
      }
      return text;
    };

    let partialRun = false;
    const targetProvider = req.body.provider || s.activeProvider || 'gemini';
    const targetModel = req.body.model || s.activeModel;

    // Pass 2: Pro Advocate (Uses user active provider/model or Gemini)
    const proPrompt = `You are the Pro / Optimist Advocate in a multi-agent decision debate.
Debate Topic: "${topic}"

${groundTruthContext}
${evidenceRules}

Present a strong, structured, evidence-backed argument supporting this topic or direction.
Include:
1. Core Strategic Thesis (with explicit evidence tags)
2. Key Value Drivers & Evidence
3. Proposed Validation Plan & Minimum Success Thresholds
Be rigorous, concise, and honest about assumptions.`;

    let proArg = '';
    let proAgentName = `${targetProvider.toUpperCase()} Pro Advocate`;
    try {
      const proResText = await twinAgentService.generateCompletion({
        prompt: proPrompt,
        provider: targetProvider,
        model: targetModel,
        customGeminiKey: req.body.customGeminiKey,
        customGroqKey: req.body.customGroqKey,
        customMistralKey: req.body.customMistralKey,
      });
      proArg = enforceClaimValidation(proResText || 'No argument generated.');
    } catch (err) {
      partialRun = true;
      proArg = `[Provider Error] Pro Advocate pass unavailable: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Pass 3: Mistral / Independent Devil's Advocate (Rigorous Cross-Examination & Challenge)
    const contrarianPrompt = `You are the Contrarian / Devil's Advocate in a multi-agent decision debate.
Debate Topic: "${topic}"

Pro Advocate Position:
${proArg}

${groundTruthContext}
${evidenceRules}

Conduct a rigorous cross-examination of the Pro Advocate's argument:
1. Identify Pro Advocate's strongest UNSUPPORTED claim or assumption and directly challenge it.
2. Identify hidden risks, second-order downsides, and potential points of failure.
3. State what testable evidence or data would be required to prove or disprove the Pro Advocate's hypothesis.
Tag every claim as [Verified], [Inferred], [Hypothesis], or [Unknown]. Be incisive and candid.`;

    let mistralArg = '';
    let mistralAgentName = 'Mistral Devil\'s Advocate';
    let mistralModelUsed = mistralModel;
    if (effectiveMistralKey) {
      try {
        const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveMistralKey}` },
          body: JSON.stringify({
            model: mistralModel,
            messages: [{ role: 'user', content: contrarianPrompt }],
            temperature: 0.7,
            max_tokens: 500,
          }),
        });
        if (mistralRes.ok) {
          const data = await mistralRes.json();
          mistralArg = enforceClaimValidation(data.choices?.[0]?.message?.content?.trim() || '');
        }
      } catch (mErr) {
        console.warn('Mistral round error:', mErr);
      }
    }
    if (!mistralArg) {
      try {
        const contrarianResText = await twinAgentService.generateCompletion({
          prompt: contrarianPrompt,
          provider: targetProvider,
          model: targetModel,
          customGeminiKey: req.body.customGeminiKey,
          customGroqKey: req.body.customGroqKey,
          customMistralKey: req.body.customMistralKey,
        });
        mistralArg = enforceClaimValidation(contrarianResText || 'No contrarian critique generated.');
        mistralAgentName = effectiveMistralKey ? 'Mistral Devil\'s Advocate' : `Independent Devil's Advocate (${targetProvider.toUpperCase()})`;
        mistralModelUsed = effectiveMistralKey ? mistralModel : `${targetModel || targetProvider}`;
      } catch (err) {
        partialRun = true;
        mistralArg = '[Provider Error] Devil\'s Advocate pass unavailable due to API rate limit or outage.';
      }
    }

    // Pass 4: Groq / Independent Realist Cross-Examiner (Pragmatic Execution & Commitments Check)
    const realistPrompt = `You are the Pragmatic Realist & Execution Cross-Examiner in a multi-agent decision debate.
Debate Topic: "${topic}"

Pro Advocate Case:
${proArg}

Contrarian Challenge:
${mistralArg}

${groundTruthContext}
${evidenceRules}

Cross-examine both positions on real-world execution realities:
1. Operational Bottlenecks: Time sinks, complexity, resource requirements, and distraction risks.
2. Baseline & Threshold Definition: How should baseline metrics and realistic minimum success thresholds be established?
3. Impact on Existing Commitments: Evaluate trade-offs against current active projects, learning obligations, and ongoing tasks.
Tag every claim as [Verified], [Inferred], [Hypothesis], or [Unknown].`;

    let groqArg = '';
    let groqAgentName = 'Groq Realist Cross-Examiner';
    let groqModelUsed = groqModel;
    if (effectiveGroqKey) {
      try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${effectiveGroqKey}` },
          body: JSON.stringify({
            model: groqModel,
            messages: [{ role: 'user', content: realistPrompt }],
            temperature: 0.7,
            max_tokens: 500,
          }),
        });
        if (groqRes.ok) {
          const data = await groqRes.json();
          groqArg = enforceClaimValidation(data.choices?.[0]?.message?.content?.trim() || '');
        }
      } catch (gErr) {
        console.warn('Groq round error:', gErr);
      }
    }
    if (!groqArg) {
      try {
        const realistResText = await twinAgentService.generateCompletion({
          prompt: realistPrompt,
          provider: targetProvider,
          model: targetModel,
          customGeminiKey: req.body.customGeminiKey,
          customGroqKey: req.body.customGroqKey,
          customMistralKey: req.body.customMistralKey,
        });
        groqArg = enforceClaimValidation(realistResText || 'No execution reality check generated.');
        groqAgentName = effectiveGroqKey ? 'Groq Realist Cross-Examiner' : `Pragmatic Realist Cross-Examiner (${targetProvider.toUpperCase()})`;
        groqModelUsed = effectiveGroqKey ? groqModel : `${targetModel || targetProvider}`;
      } catch (err) {
        partialRun = true;
        groqArg = '[Provider Error] Realist Cross-Examiner pass unavailable due to API rate limit or outage.';
      }
    }

    // Pass 5: Digital Twin Chief Arbiter (Synthesis Verdict with Evidence Audit & 3-Horizon Breakdown)
    const synthesisPrompt = `You are Olalekan's Digital Twin acting as Chief Arbiter. Review all debate perspectives:

[PRO ADVOCATE]
${proArg}

[CONTRARIAN DEVIL'S ADVOCATE]
${mistralArg}

[PRAGMATIC REALIST]
${groqArg}

Debate Topic: "${topic}"

Synthesize a provisional, evidence-driven verdict following this EXACT STRUCTURE:

### 1. EVIDENCE AUDIT & CLAIM VERIFICATION
- Context Status: ${contextStatus}
- Identify key claims and distinguish [Verified] facts from [Inferred] logic, [Hypothesis] assumptions, and [Unknown] missing variables.
- Address the Contrarian's primary challenge and state what missing information would change this verdict.

### 2. 3-DIMENSIONAL CONFIDENCE ASSESSMENT
- Evidence Sufficiency: [High / Moderate / Insufficient] — Explain why based on verified data vs assumptions.
- Recommendation Confidence: [High / Moderate / Low] — Explain given trade-offs, reversibility, and costs.
- Prediction Confidence: [High / Moderate / Low] — Explain likelihood of experiment outcome. Note: If Evidence Sufficiency is Insufficient, Prediction Confidence MUST be Low.

### 3. THREE-HORIZON DECISION BREAKDOWN
- Horizon 1 (Immediate Focus: Next 7-14 Days): What requires urgent operational attention now.
- Horizon 2 (30-Day Commercial Experiment): What deserves focused validation/investment for the next 30 days, including baseline metrics & success thresholds.
- Horizon 3 (Long-Term Strategic Value): Which initiative possesses the highest long-term potential and core platform value.

### 4. EXISTING COMMITMENTS & RISK MATRIX
- Explain how existing obligations (e.g. active projects, learning goals, operational tools) are prioritized or maintained rather than erased.
- Actionable Immediate Next Practical Step.`;

    let verdict = '';
    try {
      const synthesisResText = await twinAgentService.generateCompletion({
        prompt: synthesisPrompt,
        provider: targetProvider,
        model: targetModel,
        customGeminiKey: req.body.customGeminiKey,
        customGroqKey: req.body.customGroqKey,
        customMistralKey: req.body.customMistralKey,
      });
      verdict = enforceClaimValidation(synthesisResText || 'No synthesis generated.');
    } catch (err) {
      verdict = `Chief Arbiter synthesis error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const rounds = [
      { agent: proAgentName, model: targetModel || geminiModel, role: 'Pro / Optimist Advocate', text: proArg },
      { agent: mistralAgentName, model: mistralModelUsed, role: 'Contrarian / Skeptic', text: mistralArg },
      { agent: groqAgentName, model: groqModelUsed, role: 'Execution Realist', text: groqArg },
      { agent: `Digital Twin Chief Arbiter (${targetProvider.toUpperCase()})`, model: targetModel || geminiModel, role: 'Chief Arbiter Verdict', text: verdict },
    ];

    // Persist immutable decision record to Neon DB
    const savedId = await neonDb.saveDecision({
      title: topic.slice(0, 100),
      situation: groundTruthContext,
      recommendation: verdict.slice(0, 500),
      confidence: contextStatus === 'available' ? 85 : 50,
      full_analysis: { topic, contextStatus, partialRun, rounds },
      channel: 'web',
    });

    res.json({
      success: true,
      decisionId: savedId,
      topic,
      contextStatus,
      partialRun,
      rounds,
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Multi-agent debate failed' });
  }
});

// Download endpoints for generated app assets
app.get('/api/download/icon', (req: Request, res: Response) => {
  const iconPath = path.resolve(__dirname, 'src/assets/images/android_app_icon_1791711136312.jpg');
  if (fs.existsSync(iconPath)) {
    res.download(iconPath, 'TwinMind_Android_App_Icon.jpg');
  } else {
    res.status(404).send('App icon not found');
  }
});

app.get('/api/download/splash', (req: Request, res: Response) => {
  const splashPath = path.resolve(__dirname, 'src/assets/images/android_splash_image_1791710986488.jpg');
  if (fs.existsSync(splashPath)) {
    res.download(splashPath, 'TwinMind_Android_Splash_Screen.jpg');
  } else {
    res.status(404).send('Splash image not found');
  }
});


// Mount Vite middleware in development or static in production
if (isProduction) {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (req: Request, res: Response) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Olalekan Digital Twin server running on http://0.0.0.0:${PORT}`);
  // Start background WhatsApp job worker and lease recovery daemon
  whatsAppWorker.startWorker();

  // Start proactive calibration monitor (Checks every 4 hours)
  calibrationService.monitorOverdueExperiments().catch(err => console.error('Initial calibration check error:', err));
  setInterval(() => {
    calibrationService.monitorOverdueExperiments().catch(err => console.error('Periodic calibration check error:', err));
  }, 1000 * 60 * 60 * 4);

  // Start Adversarial Sentinel Red-Teaming (Checks every 6 hours)
  sentinelService.runCognitiveRedTeamScan().catch(err => console.error('Initial sentinel scan error:', err));
  setInterval(() => {
    sentinelService.runCognitiveRedTeamScan().catch(err => console.error('Periodic sentinel scan error:', err));
  }, 1000 * 60 * 60 * 6);

  // Hydrate settings from Neon DB if available
  settingsManager.syncFromDatabase().catch((dbErr) => {
    console.warn('Neon DB settings sync deferred:', dbErr);
  });
  // Attempt background startup of Telegram bot listener
  try {
    await telegramBotManager.start();
  } catch (tgErr) {
    console.warn('Initial Telegram bot startup deferred (waiting for token configuration):', tgErr);
  }
});
