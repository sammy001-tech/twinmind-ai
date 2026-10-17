import React, { useState, useEffect } from 'react';
import {
  X,
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Key,
  Volume2,
  Check,
  Search,
  Sparkles,
  Zap,
  Flame,
  Database,
  Eye,
  EyeOff,
  Server,
  Sun,
  Moon,
  Monitor,
  Globe,
  Send,
  Radio,
} from 'lucide-react';
import { LiveModelInfo } from '../types/index.ts';
import { ThemeMode } from '../hooks/useTheme.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProvider: string;
  onProviderChange: (provider: string) => void;
  providerModels: {
    gemini: string;
    groq: string;
    mistral: string;
  };
  onSelectProviderModel: (provider: string, model: string) => void;
  onSelectModelAndActivate?: (provider: 'gemini' | 'groq' | 'mistral', model: string) => void;
  voice: string;
  onVoiceChange: (voice: string) => void;
  customGeminiKey: string;
  onSaveGeminiKey: (key: string) => void | Promise<void>;
  customGroqKey: string;
  onSaveGroqKey: (key: string) => void | Promise<void>;
  customMistralKey: string;
  onSaveMistralKey: (key: string) => void | Promise<void>;
  customTavilyKey?: string;
  onSaveTavilyKey?: (key: string) => void | Promise<void>;
  themeMode?: ThemeMode;
  onThemeModeChange?: (mode: ThemeMode) => void;
  autoPlayVoice?: boolean;
  onAutoPlayVoiceChange?: (autoPlay: boolean) => void;
  voiceSpeed?: number;
  onVoiceSpeedChange?: (speed: number) => void;
  brandName?: string;
  onSaveBrandName?: (brand: string) => void;
  userName?: string;
  nickname?: string;
  onSaveName?: (name: string, nick: string) => void;
  isEmbedded?: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  activeProvider,
  onProviderChange,
  providerModels,
  onSelectProviderModel,
  onSelectModelAndActivate,
  voice,
  onVoiceChange,
  customGeminiKey,
  onSaveGeminiKey,
  customGroqKey,
  onSaveGroqKey,
  customMistralKey,
  onSaveMistralKey,
  customTavilyKey = '',
  onSaveTavilyKey,
  themeMode = 'dark',
  onThemeModeChange,
  autoPlayVoice = false,
  onAutoPlayVoiceChange,
  voiceSpeed = 1,
  onVoiceSpeedChange,
  brandName = '',
  onSaveBrandName,
  userName = '',
  nickname = '',
  onSaveName,
  isEmbedded = false,
}) => {
  const [selectedProviderTab, setSelectedProviderTab] = useState<'gemini' | 'groq' | 'mistral' | ''>(
    activeProvider === 'gemini' || activeProvider === 'groq' || activeProvider === 'mistral'
      ? activeProvider
      : ''
  );

  const [modelsByProvider, setModelsByProvider] = useState<{
    gemini: LiveModelInfo[];
    groq: LiveModelInfo[];
    mistral: LiveModelInfo[];
  }>({
    gemini: [],
    groq: [],
    mistral: [],
  });

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [customModelInput, setCustomModelInput] = useState('');
  const [brandInput, setBrandInput] = useState(brandName);
  const [nameInput, setNameInput] = useState(userName);
  const [nickInput, setNickInput] = useState(nickname);
  const [isSavingIdentity, setIsSavingIdentity] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [groqKeyInput, setGroqKeyInput] = useState('');
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [mistralKeyInput, setMistralKeyInput] = useState('');
  const [showMistralKey, setShowMistralKey] = useState(false);
  const [tavilyKeyInput, setTavilyKeyInput] = useState('');
  const [showTavilyKey, setShowTavilyKey] = useState(false);
  const [showTwilioSid, setShowTwilioSid] = useState(false);
  const [isTestingTavily, setIsTestingTavily] = useState(false);
  const [isSavingTavily, setIsSavingTavily] = useState(false);
  const [savingProviderKey, setSavingProviderKey] = useState<'gemini' | 'groq' | 'mistral' | null>(null);
  const [providerKeySaveFeedback, setProviderKeySaveFeedback] = useState<Record<string, { type: 'success' | 'error'; text: string }>>({});
  const [tavilyFeedback, setTavilyFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Dynamic Key Test Status State (dynamically loaded and persisted via Neon DB /api/settings)
  const [keyTestMap, setKeyTestMap] = useState<Record<string, {
    status: 'idle' | 'testing' | 'success' | 'error';
    message: string;
    testedAt: string;
  }>>({});

  const updateKeyTestStatus = (keyId: string, result: {
    status: 'idle' | 'testing' | 'success' | 'error';
    message: string;
    testedAt: string;
  }) => {
    setKeyTestMap((prev) => {
      const next = { ...prev, [keyId]: result };
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyTestStatuses: next }),
      }).catch((err) => {
        console.warn('Failed to sync key test status to database:', err);
      });
      return next;
    });
  };

  const [tavilyStatus, setTavilyStatus] = useState<{
    configured: boolean;
    source: string;
    maskedKey: string | null;
  } | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<{
    gemini: boolean;
    groq: boolean;
    mistral: boolean;
  }>({ gemini: false, groq: false, mistral: false });
  type CredentialSource = 'environment' | 'settings' | 'none';
  const [credentialSources, setCredentialSources] = useState<Record<'gemini' | 'groq' | 'mistral' | 'tavily' | 'telegram' | 'twilio', CredentialSource>>({
    gemini: 'none', groq: 'none', mistral: 'none', tavily: 'none', telegram: 'none', twilio: 'none',
  });
  const [catalogueDiagnostics, setCatalogueDiagnostics] = useState<Record<string, { status?: string; errorCode?: string; httpStatus?: number }>>({});


  // Neon PostgreSQL Database State
  const [dbStatus, setDbStatus] = useState<{
    configured: boolean;
    connected: boolean;
    source: 'environment' | 'none';
    maskedUrl: string | null;
    tables: { conversations: number | null; decisions: number | null; twin_events: number | null };
    error: string | null;
  } | null>(null);
  const [dbUrlInput, setDbUrlInput] = useState('');
  const [showDbUrl, setShowDbUrl] = useState(false);
  const [isTestingDb, setIsTestingDb] = useState(false);
  const [dbFeedback, setDbFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Telegram Bot Integration State
  const [telegramStatus, setTelegramStatus] = useState<{
    isRunning: boolean;
    hasToken: boolean;
    tokenMasked: string | null;
    botUsername: string | null;
    botFirstName: string | null;
    mode: 'polling' | 'webhook';
    webhookUrl: string;
    isPaired: boolean;
    ownerId: number | null;
    ownerUsername: string | null;
    pairingCode: string;
    activeProvider: string;
    activeModel: string;
  } | null>(null);
  const [tgTokenInput, setTgTokenInput] = useState('');
  const [showTgToken, setShowTgToken] = useState(false);
  const [tgModeInput, setTgModeInput] = useState<'polling' | 'webhook'>('polling');
  const [tgWebhookUrlInput, setTgWebhookUrlInput] = useState('');
  const [isTestingTgToken, setIsTestingTgToken] = useState(false);
  const [tgFeedback, setTgFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSavingTg, setIsSavingTg] = useState(false);

  // Twilio WhatsApp State
  const [twilioAccountSid, setTwilioAccountSid] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [showTwilioToken, setShowTwilioToken] = useState(false);
  const [twilioWhatsAppNumber, setTwilioWhatsAppNumber] = useState('');
  const [userPhoneNumber, setUserPhoneNumber] = useState('');
  const [enableWhatsAppAlerts, setEnableWhatsAppAlerts] = useState(false);
  const [enforceTwilioSignature, setEnforceTwilioSignature] = useState(true);
  const [twilioTokenConfigured, setTwilioTokenConfigured] = useState(false);
  const [proactiveAlertChannel, setProactiveAlertChannel] = useState<'whatsapp' | 'telegram' | 'none'>('whatsapp');

  const [isTestingTwilio, setIsTestingTwilio] = useState(false);
  const [twilioDiagnostic, setTwilioDiagnostic] = useState<{
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
  } | null>(null);
  const [twilioFeedback, setTwilioFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSavingTwilio, setIsSavingTwilio] = useState(false);

  const loadTwilioSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setTwilioAccountSid(data.settings.twilioAccountSid || '');
          setTwilioWhatsAppNumber(data.settings.twilioWhatsAppNumber || '');
          setUserPhoneNumber(data.settings.userPhoneNumber || '');
          setEnableWhatsAppAlerts(Boolean(data.settings.enableWhatsAppAlerts));
          setEnforceTwilioSignature(data.settings.enforceTwilioSignature !== false);
          setTwilioTokenConfigured(Boolean(data.settings.twilioTokenConfigured));
          setProactiveAlertChannel(data.settings.proactiveAlertChannel || 'whatsapp');
          if (data.settings.keyTestStatuses && typeof data.settings.keyTestStatuses === 'object') {
            setKeyTestMap(data.settings.keyTestStatuses);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to load settings in SettingsModal:', err);
    }
  };

  const handleRunTwilioDiagnostic = async () => {
    setIsTestingTwilio(true);
    setTwilioFeedback(null);
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    updateKeyTestStatus('twilio', {
      status: 'testing',
      message: 'Running 3-stage Twilio WhatsApp diagnostic...',
      testedAt: nowTime,
    });
    try {
      const res = await fetch('/api/twilio/test');
      const data = await res.json();
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (data.success && data.diagnostic) {
        setTwilioDiagnostic(data.diagnostic);
        if (data.diagnostic.stage3DeliverySuccess) {
          const msg = 'All 3 Diagnostic Stages Passed! WhatsApp connection fully verified.';
          setTwilioFeedback({ type: 'success', text: msg });
          updateKeyTestStatus('twilio', {
            status: 'success',
            message: msg,
            testedAt: timeStr,
          });
        } else if (data.diagnostic.stage2AuthSuccess) {
          const msg = `Stage 2 Verified (Account: ${data.diagnostic.details.accountName}). Outbound ready.`;
          setTwilioFeedback({ type: 'success', text: msg });
          updateKeyTestStatus('twilio', {
            status: 'success',
            message: msg,
            testedAt: timeStr,
          });
        } else {
          const msg = data.diagnostic.details.error || 'Twilio verification failed.';
          setTwilioFeedback({ type: 'error', text: msg });
          updateKeyTestStatus('twilio', {
            status: 'error',
            message: msg,
            testedAt: timeStr,
          });
        }
      } else {
        const msg = data.error || 'Diagnostic check failed.';
        setTwilioFeedback({ type: 'error', text: msg });
        updateKeyTestStatus('twilio', {
          status: 'error',
          message: msg,
          testedAt: timeStr,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Diagnostic network error';
      setTwilioFeedback({ type: 'error', text: msg });
      updateKeyTestStatus('twilio', {
        status: 'error',
        message: msg,
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } finally {
      setIsTestingTwilio(false);
    }
  };

  const handleSaveTwilioSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingTwilio(true);
    setTwilioFeedback(null);

    const payload: any = {
      twilioAccountSid: twilioAccountSid.trim(),
      twilioWhatsAppNumber: twilioWhatsAppNumber.trim(),
      userPhoneNumber: userPhoneNumber.trim(),
      enableWhatsAppAlerts,
      enforceTwilioSignature,
      proactiveAlertChannel,
    };

    if (twilioAuthToken.trim()) {
      payload.twilioAuthToken = twilioAuthToken.trim();
    }

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && data.settings) {
        setTwilioTokenConfigured(Boolean(data.settings.twilioTokenConfigured));
        setTwilioAuthToken('');
        setTwilioFeedback({ type: 'success', text: 'Twilio WhatsApp settings saved & synchronized.' });
        setFeedbackToast('WhatsApp configuration updated.');
        setTimeout(() => setFeedbackToast(null), 3000);
      } else {
        setTwilioFeedback({ type: 'error', text: data.error || 'Failed to save Twilio settings.' });
      }
    } catch (err: unknown) {
      setTwilioFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Network error saving settings' });
    } finally {
      setIsSavingTwilio(false);
    }
  };

  const loadTelegramStatus = async () => {
    try {
      const res = await fetch('/api/telegram/status');
      if (res.ok) {
        const data = await res.json();
        setTelegramStatus(data);
        setTgModeInput(data.mode || 'polling');
        setTgWebhookUrlInput(data.webhookUrl || '');
      }
    } catch (err) {
      console.warn('Failed to fetch Telegram status in Settings:', err);
    }
  };

  const handleTestTgToken = async () => {
    const tokenToTest = tgTokenInput.trim();
    if (!tokenToTest) {
      setTgFeedback({ type: 'error', text: 'Please enter a Telegram bot token to test.' });
      updateKeyTestStatus('telegram', {
        status: 'error',
        message: 'Please enter a Telegram bot token to test.',
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return;
    }
    setIsTestingTgToken(true);
    setTgFeedback(null);
    updateKeyTestStatus('telegram', {
      status: 'testing',
      message: 'Connecting to Telegram Bot API (@BotFather)...',
      testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    try {
      const res = await fetch('/api/telegram/test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenToTest }),
      });
      const data = await res.json();
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (data.ok) {
        const msg = `Verified: @${data.botInfo?.username} (${data.botInfo?.first_name || 'Bot'})`;
        setTgFeedback({
          type: 'success',
          text: msg,
        });
        updateKeyTestStatus('telegram', {
          status: 'success',
          message: msg,
          testedAt: timeStr,
        });
      } else {
        const msg = data.error || 'Token test failed.';
        setTgFeedback({ type: 'error', text: msg });
        updateKeyTestStatus('telegram', {
          status: 'error',
          message: msg,
          testedAt: timeStr,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error testing token';
      setTgFeedback({ type: 'error', text: msg });
      updateKeyTestStatus('telegram', {
        status: 'error',
        message: msg,
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } finally {
      setIsTestingTgToken(false);
    }
  };

  const handleSaveTelegram = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (tgModeInput === 'webhook') {
      const trimmedUrl = tgWebhookUrlInput.trim();
      if (!trimmedUrl) {
        setTgFeedback({ type: 'error', text: 'Webhook mode requires a valid HTTPS webhook URL.' });
        return;
      }
      if (!trimmedUrl.startsWith('https://')) {
        setTgFeedback({ type: 'error', text: 'Webhook URL must start with https://' });
        return;
      }
    }

    setIsSavingTg(true);
    setTgFeedback(null);
    try {
      const res = await fetch('/api/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(tgTokenInput.trim() ? { token: tgTokenInput.trim() } : {}),
          mode: tgModeInput,
          webhookUrl: tgWebhookUrlInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTgFeedback({ type: 'success', text: data.message || 'Telegram settings saved.' });
        setFeedbackToast('Telegram configuration updated.');
        setTimeout(() => setFeedbackToast(null), 3000);
        setTgTokenInput('');
        await loadTelegramStatus();
      } else {
        setTgFeedback({ type: 'error', text: data.message || 'Failed to save Telegram config.' });
      }
    } catch (err: unknown) {
      setTgFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save Telegram config.' });
    } finally {
      setIsSavingTg(false);
    }
  };

  const handleResetTgPairing = async () => {
    if (!confirm('Generate a new pairing code? Current paired owner will be disconnected until they send /start.')) {
      return;
    }
    try {
      const res = await fetch('/api/telegram/reset-pairing', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setTgFeedback({ type: 'success', text: `New pairing code generated: ${data.pairingCode}` });
        await loadTelegramStatus();
      } else {
        setTgFeedback({
          type: 'error',
          text: data.error || data.message || 'Pairing changes could not be saved. Verify that Neon PostgreSQL is connected.',
        });
      }
    } catch (err) {
      setTgFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Pairing changes could not be saved.',
      });
    }
  };

  const loadTavilyStatus = async () => {
    try {
      const res = await fetch('/api/tavily/status');
      if (res.ok) {
        const data = await res.json();
        setTavilyStatus(data);
      }
    } catch (err) {
      console.warn('Failed to fetch Tavily status:', err);
    }
  };

  const handleTestTavily = async () => {
    const keyToTest = tavilyKeyInput.trim() || customTavilyKey;
    if (!keyToTest) {
      const msg = 'Please enter a Tavily API key first (e.g. tvly-...).';
      setTavilyFeedback({ type: 'error', text: msg });
      updateKeyTestStatus('tavily', {
        status: 'error',
        message: msg,
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return;
    }
    setIsTestingTavily(true);
    setTavilyFeedback(null);
    updateKeyTestStatus('tavily', {
      status: 'testing',
      message: 'Connecting to Tavily AI Search API...',
      testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    try {
      const res = await fetch('/api/tavily/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: keyToTest }),
      });
      const data = await res.json();
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (data.success) {
        const message = credentialSources.tavily === 'environment'
          ? `${data.message} The Render TAVILY_API_KEY remains authoritative for app execution.`
          : data.message;
        setTavilyFeedback({ type: 'success', text: message });
        updateKeyTestStatus('tavily', {
          status: 'success',
          message,
          testedAt: timeStr,
        });
      } else {
        const msg = data.error || 'Verification failed.';
        setTavilyFeedback({ type: 'error', text: msg });
        updateKeyTestStatus('tavily', {
          status: 'error',
          message: msg,
          testedAt: timeStr,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network test error';
      setTavilyFeedback({
        type: 'error',
        text: msg,
      });
      updateKeyTestStatus('tavily', {
        status: 'error',
        message: msg,
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } finally {
      setIsTestingTavily(false);
    }
  };

  const handleSaveTavily = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = tavilyKeyInput.trim();
    if (!trimmed || trimmed.includes('...') || trimmed === '********') {
      setTavilyFeedback({ type: 'error', text: 'Enter a new Tavily key before saving. Blank inputs keep the stored credential unchanged.' });
      return;
    }

    setIsSavingTavily(true);
    setTavilyFeedback(null);
    try {
      if (onSaveTavilyKey) {
        await onSaveTavilyKey(trimmed);
      } else {
        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customTavilyKey: trimmed }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.success !== true) {
          throw new Error(typeof data?.error === 'string' ? data.error : 'Unable to persist the Tavily key.');
        }
      }
      setTavilyKeyInput('');
      const environmentIsAuthoritative = credentialSources.tavily === 'environment';
      setTavilyFeedback({
        type: 'success',
        text: environmentIsAuthoritative
          ? 'Tavily key saved to Neon. Render TAVILY_API_KEY is still authoritative; update or remove it to use the saved key.'
          : 'Tavily API key saved and persisted. The raw key remains hidden.',
      });
      await loadCredentialSources();
      setFeedbackToast('Tavily API key saved.');
      setTimeout(() => setFeedbackToast(null), 3000);
      await loadTavilyStatus();
    } catch (err: unknown) {
      setTavilyFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save the Tavily key.' });
    } finally {
      setIsSavingTavily(false);
    }
  };

  const loadDbStatus = async () => {
    try {
      const res = await fetch('/api/db/status');
      if (res.ok) {
        const data = await res.json();
        setDbStatus(data);
      }
    } catch (err) {
      console.warn('Failed to fetch DB status:', err);
    }
  };

  const loadCredentialSources = async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      if (!response.ok || !data?.settings?.apiKeySources) return;
      const sources = data.settings.apiKeySources as Record<string, unknown>;
      const normalizeSource = (value: unknown): CredentialSource =>
        value === 'environment' || value === 'settings' ? value : 'none';
      setCredentialSources({
        gemini: normalizeSource(sources.gemini),
        groq: normalizeSource(sources.groq),
        mistral: normalizeSource(sources.mistral),
        tavily: normalizeSource(sources.tavily),
        telegram: normalizeSource(sources.telegram),
        twilio: normalizeSource(sources.twilio),
      });
    } catch (err) {
      console.warn('Unable to load safe credential-source status:', err);
    }
  };

  const handleTestDb = async () => {
    if (!dbUrlInput.trim()) {
      const msg = 'Please enter a PostgreSQL connection string first.';
      setDbFeedback({ type: 'error', text: msg });
      updateKeyTestStatus('neon_db', {
        status: 'error',
        message: msg,
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return;
    }
    setIsTestingDb(true);
    setDbFeedback(null);
    updateKeyTestStatus('neon_db', {
      status: 'testing',
      message: 'Connecting to Neon PostgreSQL serverless database...',
      testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    try {
      const res = await fetch('/api/db/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseUrl: dbUrlInput.trim() }),
      });
      const data = await res.json();
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (data.success) {
        setDbFeedback({ type: 'success', text: data.message });
        updateKeyTestStatus('neon_db', {
          status: 'success',
          message: data.message,
          testedAt: timeStr,
        });
      } else {
        const msg = data.message || 'Database test failed.';
        setDbFeedback({ type: 'error', text: msg });
        updateKeyTestStatus('neon_db', {
          status: 'error',
          message: msg,
          testedAt: timeStr,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network test error';
      setDbFeedback({
        type: 'error',
        text: msg,
      });
      updateKeyTestStatus('neon_db', {
        status: 'error',
        message: msg,
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } finally {
      setIsTestingDb(false);
    }
  };

  // Load models for all providers from backend
  const loadAllModels = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const headers: Record<string, string> = {};
      const gKey = customGroqKey || groqKeyInput;
      const mKey = customMistralKey || mistralKeyInput;
      if (gKey) headers['x-groq-key'] = gKey;
      if (mKey) headers['x-mistral-key'] = mKey;

      // Query models from backend (returns live Gemini from Google GenAI + live Groq/Mistral if keys exist)
      const res = await fetch('/api/models/all', { headers });
      if (!res.ok) {
        throw new Error('Failed to load models list from server.');
      }
      const data = await res.json();
      setModelsByProvider({
        gemini: data.gemini || [],
        groq: data.groq || [],
        mistral: data.mistral || [],
      });
      if (data.diagnostics) setCatalogueDiagnostics(data.diagnostics);
      if (data.isLive) {
        setLiveStatus(data.isLive);
      }
    } catch (err: unknown) {
      console.warn('Error loading all models:', err);
      // Query live single provider endpoint
      try {
        const singleHeaders: Record<string, string> = {};
        if (selectedProviderTab === 'groq' && (customGroqKey || groqKeyInput)) {
          singleHeaders['x-api-key'] = customGroqKey || groqKeyInput;
        } else if (selectedProviderTab === 'mistral' && (customMistralKey || mistralKeyInput)) {
          singleHeaders['x-api-key'] = customMistralKey || mistralKeyInput;
        }
        if (!selectedProviderTab) throw new Error('Select a provider tab before requesting its individual catalogue.');
        const singleRes = await fetch(`/api/models/live?provider=${selectedProviderTab}`, {
          headers: singleHeaders,
        });
        const singleData = await singleRes.json();
        if (singleData.models) {
          setModelsByProvider((prev) => ({
            ...prev,
            [selectedProviderTab]: singleData.models,
          }));
          if (typeof singleData.isLiveApi === 'boolean') {
            setLiveStatus((prev) => ({
              ...prev,
              [selectedProviderTab]: singleData.isLiveApi,
            }));
          }
        }
      } catch (innerErr: unknown) {
        setErrorMsg(innerErr instanceof Error ? innerErr.message : 'Error fetching models');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      // Never prefill secret inputs with masks: a mask is status, not key material.
      setGeminiKeyInput('');
      setGroqKeyInput('');
      setMistralKeyInput('');
      setTavilyKeyInput('');
      loadCredentialSources();
      loadAllModels();
      loadDbStatus();
      loadTavilyStatus();
      loadTelegramStatus();
      loadTwilioSettings();
    }
  }, [isOpen]);

  useEffect(() => {
    // When tab changes, update custom input placeholder with current model of that provider
    const currentModelForTab = selectedProviderTab ? (providerModels[selectedProviderTab] || '') : '';
    setCustomModelInput(currentModelForTab);
    setSearchFilter('');
  }, [selectedProviderTab, providerModels]);

  if (!isOpen) return null;

  const credentialSourceDescription = (provider: 'gemini' | 'groq' | 'mistral') => {
    const source = credentialSources[provider];
    if (source === 'environment') {
      return 'Active source: Render environment variable. It takes precedence over any saved Settings key during app execution.';
    }
    if (source === 'settings') {
      return 'Saved credential detected in Neon. The raw key is hidden; enter a new key only to replace it.';
    }
    return 'No credential detected in the deployment environment or saved Settings. Enter a key and save it to Neon.';
  };

  const handleSelectModel = (provider: 'gemini' | 'groq' | 'mistral', modelId: string) => {
    const liveModels = modelsByProvider[provider];
    if (!liveStatus[provider] || !liveModels.some((candidate) => candidate.id === modelId)) {
      setErrorMsg(`Cannot activate "${modelId}": this identifier is not present in the current live ${provider.toUpperCase()} catalogue.`);
      return;
    }

    if (onSelectModelAndActivate) {
      onSelectModelAndActivate(provider, modelId);
    } else {
      onSelectProviderModel(provider, modelId);
      onProviderChange(provider);
    }
    setFeedbackToast(`Selected live model "${modelId}" for ${provider.toUpperCase()}`);
    setTimeout(() => setFeedbackToast(null), 3000);
  };

  const handleApplyCustomModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProviderTab) {
      setErrorMsg('Select a provider tab before choosing a model.');
      return;
    }
    if (customModelInput.trim()) {
      handleSelectModel(selectedProviderTab, customModelInput.trim());
    }
  };

  const handleSaveProviderKey = async (provider: 'gemini' | 'groq' | 'mistral', value: string): Promise<boolean> => {
    const key = value.trim();
    if (!key || key.includes('...') || key === '********') {
      setProviderKeySaveFeedback((prev) => ({
        ...prev,
        [provider]: { type: 'error', text: 'Enter a new key before saving. Blank inputs keep the stored credential unchanged.' },
      }));
      return false;
    }

    setSavingProviderKey(provider);
    setProviderKeySaveFeedback((prev) => ({ ...prev, [provider]: { type: 'success', text: '' } }));
    try {
      if (provider === 'gemini') await onSaveGeminiKey(key);
      else if (provider === 'groq') await onSaveGroqKey(key);
      else await onSaveMistralKey(key);

      if (provider === 'gemini') setGeminiKeyInput('');
      else if (provider === 'groq') setGroqKeyInput('');
      else setMistralKeyInput('');

      const activeSource = credentialSources[provider];
      setProviderKeySaveFeedback((prev) => ({
        ...prev,
        [provider]: {
          type: 'success',
          text: activeSource === 'environment'
            ? 'Key saved to Neon PostgreSQL. The Render environment variable remains authoritative at runtime; update or remove it to use the saved Settings key.'
            : 'Key saved to Neon PostgreSQL. The raw key is hidden and will not be redisplayed.',
        },
      }));
      await loadCredentialSources();
      await loadAllModels();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to save this provider key.';
      setProviderKeySaveFeedback((prev) => ({ ...prev, [provider]: { type: 'error', text: message } }));
      return false;
    } finally {
      setSavingProviderKey(null);
    }
  };

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    const results: boolean[] = [];
    if (geminiKeyInput.trim()) results.push(await handleSaveProviderKey('gemini', geminiKeyInput));
    if (groqKeyInput.trim()) results.push(await handleSaveProviderKey('groq', groqKeyInput));
    if (mistralKeyInput.trim()) results.push(await handleSaveProviderKey('mistral', mistralKeyInput));

    if (!results.length) {
      setFeedbackToast('Enter a new provider key, then use its Save Key button.');
      setTimeout(() => setFeedbackToast(null), 3000);
      return;
    }
    if (results.every(Boolean)) {
      setFeedbackToast('Entered provider keys were saved. Refreshing live catalogs...');
      setTimeout(() => setFeedbackToast(null), 3000);
      await loadAllModels();
    }
  };

  const handleTestGemini = async () => {
    const keyToTest = geminiKeyInput.trim() || customGeminiKey;
    updateKeyTestStatus('gemini', {
      status: 'testing',
      message: 'Connecting to Google GenAI with Gemini API key...',
      testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    try {
      const res = await fetch('/api/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'gemini', apiKey: keyToTest }),
      });
      const data = await res.json();
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (res.ok && data.success) {
        updateKeyTestStatus('gemini', {
          status: 'success',
          message: data.message || 'Gemini API key verified successfully! Connected to Google GenAI.',
          testedAt: timeStr,
        });
        setFeedbackToast('Gemini API key verified successfully');
        setTimeout(() => setFeedbackToast(null), 3000);
      } else {
        updateKeyTestStatus('gemini', {
          status: 'error',
          message: data.error || 'Gemini API authentication failed.',
          testedAt: timeStr,
        });
      }
    } catch (err: unknown) {
      updateKeyTestStatus('gemini', {
        status: 'error',
        message: err instanceof Error ? err.message : 'Network error testing Gemini key',
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }
  };

  const handleTestGroq = async () => {
    const keyToTest = groqKeyInput.trim() || customGroqKey;
    if (!keyToTest) {
      updateKeyTestStatus('groq', {
        status: 'error',
        message: 'Please enter a Groq API key to test (starting with gsk_).',
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return;
    }
    updateKeyTestStatus('groq', {
      status: 'testing',
      message: 'Connecting to Groq API endpoint...',
      testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    try {
      const res = await fetch('/api/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'groq', apiKey: keyToTest }),
      });
      const data = await res.json();
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (res.ok && data.success) {
        updateKeyTestStatus('groq', {
          status: 'success',
          message: data.message || 'Groq API key verified! Access confirmed.',
          testedAt: timeStr,
        });
        setFeedbackToast('Groq API key verified successfully');
        setTimeout(() => setFeedbackToast(null), 3000);
      } else {
        updateKeyTestStatus('groq', {
          status: 'error',
          message: data.error || 'Groq API verification failed.',
          testedAt: timeStr,
        });
      }
    } catch (err: unknown) {
      updateKeyTestStatus('groq', {
        status: 'error',
        message: err instanceof Error ? err.message : 'Network error testing Groq key',
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }
  };

  const handleTestMistral = async () => {
    const keyToTest = mistralKeyInput.trim() || customMistralKey;
    if (!keyToTest) {
      updateKeyTestStatus('mistral', {
        status: 'error',
        message: 'Please enter a Mistral API key to test.',
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return;
    }
    updateKeyTestStatus('mistral', {
      status: 'testing',
      message: 'Connecting to Mistral AI endpoint...',
      testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    try {
      const res = await fetch('/api/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'mistral', apiKey: keyToTest }),
      });
      const data = await res.json();
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (res.ok && data.success) {
        updateKeyTestStatus('mistral', {
          status: 'success',
          message: data.message || 'Mistral API key verified! Access confirmed.',
          testedAt: timeStr,
        });
        setFeedbackToast('Mistral API key verified successfully');
        setTimeout(() => setFeedbackToast(null), 3000);
      } else {
        updateKeyTestStatus('mistral', {
          status: 'error',
          message: data.error || 'Mistral API verification failed.',
          testedAt: timeStr,
        });
      }
    } catch (err: unknown) {
      updateKeyTestStatus('mistral', {
        status: 'error',
        message: err instanceof Error ? err.message : 'Network error testing Mistral key',
        testedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }
  };

  const renderKeyStatusBadge = (keyId: string, customTesting?: boolean) => {
    const item = keyTestMap[keyId];
    const isTesting = customTesting || item?.status === 'testing';

    if (isTesting) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
          <RefreshCw className="w-3 h-3 animate-spin text-amber-500" />
          <span>Testing...</span>
        </span>
      );
    }

    if (item?.status === 'success') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>Verified{item.testedAt ? ` · ${item.testedAt}` : ''}</span>
        </span>
      );
    }

    if (item?.status === 'error') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
          <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
          <span>Failed{item.testedAt ? ` · ${item.testedAt}` : ''}</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
        <Key className="w-3 h-3 text-slate-400" />
        <span>Untested</span>
      </span>
    );
  };

  const renderKeyTestButtonIcon = (keyId: string, customTesting?: boolean) => {
    const item = keyTestMap[keyId];
    const isTesting = customTesting || item?.status === 'testing';

    if (isTesting) {
      return <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500" />;
    }
    if (item?.status === 'success') {
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    }
    if (item?.status === 'error') {
      return <AlertCircle className="w-3.5 h-3.5 text-rose-500" />;
    }
    return <Zap className="w-3.5 h-3.5 text-slate-400" />;
  };

  const currentModelsList = selectedProviderTab ? (modelsByProvider[selectedProviderTab] || []) : [];

  const filteredModels = currentModelsList.filter(
    (m) =>
      m.id.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (m.displayName && m.displayName.toLowerCase().includes(searchFilter.toLowerCase())) ||
      (m.description && m.description.toLowerCase().includes(searchFilter.toLowerCase()))
  );

  const activeModel = providerModels[activeProvider as keyof typeof providerModels] || '';

  const modalInner = (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100 ${
        isEmbedded ? 'my-2' : 'max-h-[92vh]'
      }`}
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-400">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white text-base">
              Multi-Model Brain &amp; Provider Selection
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Choose or set the exact model for each provider in real time
            </p>
          </div>
        </div>
        {!isEmbedded && (
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Feedback Notification Toast if model selected */}
      {feedbackToast && (
        <div className="bg-emerald-500/15 border-b border-emerald-500/30 px-4 py-2 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-medium">{feedbackToast}</span>
          </div>
          <button
            onClick={() => setFeedbackToast(null)}
            className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="p-4 sm:p-5 overflow-y-auto space-y-5">
        {/* App Branding & Identity Section (Database Stored) */}
        <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                App Branding &amp; Identity Configuration
              </h3>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-mono">
              Database Synced
            </span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Configure the application brand name displayed in the header and workspace, along with your user identity. All changes persist to the backend database.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                App Brand Name (Header Title)
              </label>
              <input
                type="text"
                value={brandInput}
                onChange={(e) => setBrandInput(e.target.value)}
                placeholder="TwinMind"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                User Full Name
              </label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Your Name"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Preferred Nickname
              </label>
              <input
                type="text"
                value={nickInput}
                onChange={(e) => setNickInput(e.target.value)}
                placeholder="e.g. Call Sign"
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={isSavingIdentity}
              onClick={async () => {
                setIsSavingIdentity(true);
                try {
                  const trimmedBrand = brandInput.trim() || 'TwinMind AI';
                  const trimmedName = nameInput.trim();
                  const trimmedNick = nickInput.trim();
                  onSaveBrandName?.(trimmedBrand);
                  onSaveName?.(trimmedName, trimmedNick);
                  const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      brandName: trimmedBrand,
                      userName: trimmedName,
                      nickname: trimmedNick,
                    }),
                  });
                  if (res.ok) {
                    setFeedbackToast('Brand & identity saved to database successfully');
                    setTimeout(() => setFeedbackToast(null), 3500);
                  }
                } catch (err) {
                  console.warn('Failed to save brand to database:', err);
                } finally {
                  setIsSavingIdentity(false);
                }
              }}
              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{isSavingIdentity ? 'Saving to Database...' : 'Save Brand & Identity to Database'}</span>
            </button>
          </div>
        </div>

        {/* Appearance & Visual Theme Section */}
        <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sun className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                Appearance &amp; Visual Theme
              </h3>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono capitalize">
              {themeMode === 'system' ? 'System Default' : `${themeMode} Mode`}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Customize ambient lighting for {brandName || 'TwinMind AI'}'s digital twin workspace. Seamlessly switches between Dark, Light, and System OS preference.
          </p>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              onClick={() => onThemeModeChange?.('dark')}
              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 text-xs transition ${
                themeMode === 'dark'
                  ? 'bg-amber-500/20 border-amber-500 text-slate-900 dark:text-white font-bold ring-1 ring-amber-500/30'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Moon className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <span>Dark Mode</span>
            </button>
            <button
              type="button"
              onClick={() => onThemeModeChange?.('light')}
              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 text-xs transition ${
                themeMode === 'light'
                  ? 'bg-amber-500/20 border-amber-500 text-slate-900 dark:text-white font-bold ring-1 ring-amber-500/30'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Sun className="w-4 h-4 text-amber-500" />
              <span>Light Mode</span>
            </button>
            <button
              type="button"
              onClick={() => onThemeModeChange?.('system')}
              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 text-xs transition ${
                themeMode === 'system'
                  ? 'bg-amber-500/20 border-amber-500 text-slate-900 dark:text-white font-bold ring-1 ring-amber-500/30'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Monitor className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
              <span>System</span>
            </button>
          </div>
        </div>

        {/* Active Model Summary Banner */}
        <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-slate-100 dark:from-amber-950/40 dark:via-indigo-950/30 dark:to-slate-950/40 border border-amber-300 dark:border-amber-500/40 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 block mb-0.5">
                Currently Active Brain Engine
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  {activeModel}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 uppercase font-semibold">
                  {activeProvider}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg p-1 text-xs">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 px-1">Switch Provider:</span>
              <button
                onClick={() => onProviderChange('gemini')}
                className={`px-2 py-1 rounded text-xs font-medium transition ${
                  activeProvider === 'gemini'
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Gemini
              </button>
              <button
                onClick={() => onProviderChange('groq')}
                className={`px-2 py-1 rounded text-xs font-medium transition ${
                  activeProvider === 'groq'
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Groq
              </button>
              <button
                onClick={() => onProviderChange('mistral')}
                className={`px-2 py-1 rounded text-xs font-medium transition ${
                  activeProvider === 'mistral'
                    ? 'bg-amber-600 text-slate-950 font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Mistral
              </button>
            </div>
          </div>

          {/* Provider Configuration Summary Table */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/80 text-xs">
            <div
              onClick={() => setSelectedProviderTab('gemini')}
              className={`p-2 rounded-lg border cursor-pointer transition ${
                selectedProviderTab === 'gemini'
                  ? 'bg-white dark:bg-indigo-950/30 border-indigo-400 dark:border-indigo-500/60 shadow-xs'
                  : 'bg-white/80 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Gemini Model</span>
                {activeProvider === 'gemini' && (
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">● Active Brain</span>
                )}
              </div>
              <div className="font-mono text-xs font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                {providerModels.gemini}
              </div>
            </div>

            <div
              onClick={() => setSelectedProviderTab('groq')}
              className={`p-2 rounded-lg border cursor-pointer transition ${
                selectedProviderTab === 'groq'
                  ? 'bg-white dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-500/60 shadow-xs'
                  : 'bg-white/80 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Groq Model</span>
                {activeProvider === 'groq' && (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">● Active Brain</span>
                )}
              </div>
              <div className="font-mono text-xs font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                {providerModels.groq}
              </div>
            </div>

            <div
              onClick={() => setSelectedProviderTab('mistral')}
              className={`p-2 rounded-lg border cursor-pointer transition ${
                selectedProviderTab === 'mistral'
                  ? 'bg-white dark:bg-amber-950/30 border-amber-400 dark:border-amber-500/60 shadow-xs'
                  : 'bg-white/80 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Mistral Model</span>
                {activeProvider === 'mistral' && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">● Active Brain</span>
                )}
              </div>
              <div className="font-mono text-xs font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                {providerModels.mistral}
              </div>
            </div>
          </div>
        </div>

        {/* Provider Model Selection Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-amber-600 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Select Model from Provider List</span>
            </h3>
            <button
              onClick={loadAllModels}
              disabled={isLoading}
              className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 flex items-center gap-1 font-medium transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Live Catalog</span>
            </button>
          </div>

          {/* Provider Tabs with Model Counts */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-1 gap-1 text-xs">
            <button
              type="button"
              onClick={() => setSelectedProviderTab('gemini')}
              className={`flex-1 py-2 px-2.5 rounded-lg font-medium transition flex items-center justify-center gap-1.5 ${
                selectedProviderTab === 'gemini'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>Google Gemini</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/20 dark:bg-black/30 font-mono flex items-center gap-1">
                {liveStatus.gemini && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />}
                {modelsByProvider.gemini.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedProviderTab('groq')}
              className={`flex-1 py-2 px-2.5 rounded-lg font-medium transition flex items-center justify-center gap-1.5 ${
                selectedProviderTab === 'groq'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>Groq LPUs</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/20 dark:bg-black/30 font-mono flex items-center gap-1">
                {liveStatus.groq && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                )}
                {modelsByProvider.groq.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedProviderTab('mistral')}
              className={`flex-1 py-2 px-2.5 rounded-lg font-medium transition flex items-center justify-center gap-1.5 ${
                selectedProviderTab === 'mistral'
                  ? 'bg-amber-600 text-slate-950 font-semibold shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>Mistral AI</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/20 dark:bg-black/30 font-mono flex items-center gap-1">
                {liveStatus.mistral && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                )}
                {modelsByProvider.mistral.length}
              </span>
            </button>
          </div>
          {selectedProviderTab === 'gemini' && catalogueDiagnostics.gemini?.errorCode && (
            <div role="status" className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-700 dark:text-rose-300">
              <strong>Live Gemini catalogue unavailable:</strong> {catalogueDiagnostics.gemini.errorCode}.
              {' '}Credential source: {credentialSources.gemini}. Review Render's GEMINI_API_KEY value and its Google API access; saved Settings keys do not override that environment variable.
            </div>
          )}

          {/* Direct Input Override for this provider */}
          <form onSubmit={handleApplyCustomModel} className="flex items-center gap-2">
            <input
              type="text"
              value={customModelInput}
              onChange={(e) => setCustomModelInput(e.target.value)}
              placeholder={selectedProviderTab ? `Search or select a live ${selectedProviderTab.toUpperCase()} model` : 'Select a provider tab first'}
              className="flex-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="submit"
              className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shrink-0"
            >
              Set for {selectedProviderTab ? selectedProviderTab.toUpperCase() : 'no selected provider'}
            </button>
          </form>

          {/* Search Filter for models list */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder={selectedProviderTab ? `Filter ${selectedProviderTab.toUpperCase()} models by name or keyword...` : 'Select a provider tab to view its live catalogue'}
              className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Models List for the selected provider */}
          {isLoading ? (
            <div className="p-8 text-center space-y-2 text-slate-500 dark:text-slate-400 text-xs">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto text-amber-500 dark:text-amber-400" />
              <p>Loading available models for {selectedProviderTab ? selectedProviderTab.toUpperCase() : 'the selected provider'}...</p>
            </div>
          ) : errorMsg ? (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
              <div className="space-y-1">
                <p className="font-semibold">Query Failed</p>
                <p className="opacity-90">{errorMsg}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 sm:max-h-80 overflow-y-auto pr-1 border border-slate-200 dark:border-slate-800/80 rounded-xl p-2 bg-slate-50/70 dark:bg-slate-950/60">
              <div className="text-[11px] text-slate-600 dark:text-slate-400 px-1 mb-1 flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span>
                    Available {selectedProviderTab ? selectedProviderTab.toUpperCase() : 'provider'} Models ({filteredModels.length}):
                  </span>
                  {selectedProviderTab && liveStatus[selectedProviderTab] ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 inline-block animate-pulse" />
                      Live API
                    </span>
                  ) : selectedProviderTab ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/30 font-medium">
                      Live catalogue unavailable
                    </span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/30 font-medium">
                      Select a provider to inspect its live catalogue
                    </span>
                  )}
                </div>
                <span className="text-amber-600 dark:text-amber-400 text-[10px]">
                  Current: <strong className="text-slate-900 dark:text-white font-mono">{selectedProviderTab ? providerModels[selectedProviderTab] : ''}</strong>
                </span>
              </div>

              {filteredModels.length === 0 ? (
                <div className="p-6 text-center space-y-2 text-slate-500 dark:text-slate-400 text-xs">
                  {!selectedProviderTab ? (
                    <p>Select a provider tab to inspect its live model catalogue.</p>
                  ) : !liveStatus[selectedProviderTab] ? (
                    <div className="space-y-1.5 max-w-sm mx-auto">
                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                        No live models loaded for {selectedProviderTab.toUpperCase()}
                      </p>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        To fetch verified live models directly from {selectedProviderTab.toUpperCase()}, configure its API key and retry the live catalogue request.
                      </p>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        A model must appear in the provider's current live catalogue before it can be activated.
                      </p>
                    </div>
                  ) : (
                    <p>No models matched your search filter.</p>
                  )}
                </div>
              ) : (
                filteredModels.map((m) => {
                  const isSelected = selectedProviderTab ? providerModels[selectedProviderTab] === m.id : false;
                  const isOverallActive = Boolean(selectedProviderTab && activeProvider === selectedProviderTab && isSelected);

                  return (
                    <div
                      key={m.id}
                      onClick={() => { if (selectedProviderTab) handleSelectModel(selectedProviderTab, m.id); }}
                      role="button"
                      tabIndex={0}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-500/70 shadow-sm ring-1 ring-amber-500/30'
                          : 'bg-white dark:bg-slate-900/70 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100/60 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                            {m.id}
                          </span>
                          {m.displayName && m.displayName !== m.id && (
                            <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate font-medium">
                              ({m.displayName})
                            </span>
                          )}
                          {isOverallActive && (
                            <span className="text-[10px] px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-semibold">
                              Live Active Brain
                            </span>
                          )}
                        </div>

                        {m.description && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                            {m.description}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (selectedProviderTab) handleSelectModel(selectedProviderTab, m.id);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition flex items-center gap-1 ${
                          isSelected
                            ? 'bg-amber-500 text-slate-950 shadow-xs'
                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {isSelected ? (
                          <>
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            <span>Active</span>
                          </>
                        ) : (
                          <span>Select</span>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Provider API Credentials */}
        <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                API Credentials (Gemini / Groq / Mistral)
              </h3>
            </div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
              Zero-Fallback Live Verified
            </span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Configure saved Gemini, Groq, and Mistral credentials. A configured <code>GEMINI_API_KEY</code>, <code>GROQ_API_KEY</code>, or <code>MISTRAL_API_KEY</code> environment variable takes precedence during app execution; Test Connection checks the key entered here when one is provided. Leave fields blank to keep existing keys.
          </p>

          <form onSubmit={handleSaveKeys} className="space-y-4">
            {/* Gemini Key */}
            <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <span>Google Gemini API Key (Core Brain)</span>
                  <span className="text-[10px] text-slate-400">(Saved credential)</span>
                </label>
                {renderKeyStatusBadge("gemini")}
              </div>

              <div className="relative">
                <input
                  type={showGeminiKey ? "text" : "password"}
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  placeholder={credentialSources.gemini === "settings" ? "Saved key hidden — enter replacement" : credentialSources.gemini === "environment" ? "Render key is active — enter replacement only if needed" : "Paste Gemini API key"}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg pl-3 pr-10 py-1.5 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  title={showGeminiKey ? "Hide key" : "Show key"}
                >
                  {showGeminiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">{credentialSourceDescription('gemini')}</p>

              {keyTestMap["gemini"]?.message && (
                <div
                  className={`p-2 rounded-lg text-xs flex items-start gap-2 ${
                    keyTestMap["gemini"].status === "success"
                      ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                      : keyTestMap["gemini"].status === "error"
                      ? "bg-rose-500/10 border border-rose-500/30 text-rose-800 dark:text-rose-300"
                      : "bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300"
                  }`}
                >
                  {keyTestMap["gemini"].status === "success" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : keyTestMap["gemini"].status === "error" ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 animate-spin shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="leading-snug">{keyTestMap["gemini"].message}</p>
                    {keyTestMap["gemini"].testedAt && (
                      <span className="text-[10px] opacity-75 font-mono block mt-0.5">
                        Verified at: {keyTestMap["gemini"].testedAt}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => { void handleSaveProviderKey('gemini', geminiKeyInput); }}
                  disabled={savingProviderKey === 'gemini' || !geminiKeyInput.trim()}
                  className="px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 text-xs font-medium border border-amber-500/30 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{savingProviderKey === 'gemini' ? 'Saving...' : 'Save Key'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestGemini}
                  disabled={keyTestMap["gemini"]?.status === "testing"}
                  className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-300 dark:border-slate-700 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {renderKeyTestButtonIcon("gemini")}
                  <span>{keyTestMap["gemini"]?.status === "testing" ? "Testing Key..." : "Test Connection"}</span>
                </button>
              </div>
              {providerKeySaveFeedback.gemini?.text && (
                <p role="status" className={`text-xs ${providerKeySaveFeedback.gemini.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {providerKeySaveFeedback.gemini.text}
                </p>
              )}
            </div>

            {/* Groq Key */}
            <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <span>Groq API Key (Fast Reflex LPUs)</span>
                  <span className="text-[10px] text-slate-400">(Optional)</span>
                </label>
                {renderKeyStatusBadge("groq")}
              </div>

              <div className="relative">
                <input
                  type={showGroqKey ? "text" : "password"}
                  value={groqKeyInput}
                  onChange={(e) => setGroqKeyInput(e.target.value)}
                  placeholder={credentialSources.groq === "settings" ? "Saved key hidden — enter replacement" : credentialSources.groq === "environment" ? "Render key is active — enter replacement only if needed" : "Paste Groq API key"}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg pl-3 pr-10 py-1.5 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowGroqKey(!showGroqKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  title={showGroqKey ? "Hide key" : "Show key"}
                >
                  {showGroqKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">{credentialSourceDescription('groq')}</p>

              {keyTestMap["groq"]?.message && (
                <div
                  className={`p-2 rounded-lg text-xs flex items-start gap-2 ${
                    keyTestMap["groq"].status === "success"
                      ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                      : keyTestMap["groq"].status === "error"
                      ? "bg-rose-500/10 border border-rose-500/30 text-rose-800 dark:text-rose-300"
                      : "bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300"
                  }`}
                >
                  {keyTestMap["groq"].status === "success" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : keyTestMap["groq"].status === "error" ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 animate-spin shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="leading-snug">{keyTestMap["groq"].message}</p>
                    {keyTestMap["groq"].testedAt && (
                      <span className="text-[10px] opacity-75 font-mono block mt-0.5">
                        Verified at: {keyTestMap["groq"].testedAt}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => { void handleSaveProviderKey('groq', groqKeyInput); }}
                  disabled={savingProviderKey === 'groq' || !groqKeyInput.trim()}
                  className="px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 text-xs font-medium border border-amber-500/30 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{savingProviderKey === 'groq' ? 'Saving...' : 'Save Key'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestGroq}
                  disabled={keyTestMap["groq"]?.status === "testing"}
                  className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-300 dark:border-slate-700 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {renderKeyTestButtonIcon("groq")}
                  <span>{keyTestMap["groq"]?.status === "testing" ? "Testing Key..." : "Test Connection"}</span>
                </button>
              </div>
              {providerKeySaveFeedback.groq?.text && (
                <p role="status" className={`text-xs ${providerKeySaveFeedback.groq.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {providerKeySaveFeedback.groq.text}
                </p>
              )}
            </div>

            {/* Mistral Key */}
            <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <span>Mistral API Key (Challenger &amp; Debates)</span>
                  <span className="text-[10px] text-slate-400">(Optional)</span>
                </label>
                {renderKeyStatusBadge("mistral")}
              </div>

              <div className="relative">
                <input
                  type={showMistralKey ? "text" : "password"}
                  value={mistralKeyInput}
                  onChange={(e) => setMistralKeyInput(e.target.value)}
                  placeholder={credentialSources.mistral === "settings" ? "Saved key hidden — enter replacement" : credentialSources.mistral === "environment" ? "Render key is active — enter replacement only if needed" : "Paste Mistral API key"}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg pl-3 pr-10 py-1.5 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={() => setShowMistralKey(!showMistralKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  title={showMistralKey ? "Hide key" : "Show key"}
                >
                  {showMistralKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">{credentialSourceDescription('mistral')}</p>

              {keyTestMap["mistral"]?.message && (
                <div
                  className={`p-2 rounded-lg text-xs flex items-start gap-2 ${
                    keyTestMap["mistral"].status === "success"
                      ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                      : keyTestMap["mistral"].status === "error"
                      ? "bg-rose-500/10 border border-rose-500/30 text-rose-800 dark:text-rose-300"
                      : "bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300"
                  }`}
                >
                  {keyTestMap["mistral"].status === "success" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : keyTestMap["mistral"].status === "error" ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 animate-spin shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="leading-snug">{keyTestMap["mistral"].message}</p>
                    {keyTestMap["mistral"].testedAt && (
                      <span className="text-[10px] opacity-75 font-mono block mt-0.5">
                        Verified at: {keyTestMap["mistral"].testedAt}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => { void handleSaveProviderKey('mistral', mistralKeyInput); }}
                  disabled={savingProviderKey === 'mistral' || !mistralKeyInput.trim()}
                  className="px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 text-xs font-medium border border-amber-500/30 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{savingProviderKey === 'mistral' ? 'Saving...' : 'Save Key'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestMistral}
                  disabled={keyTestMap["mistral"]?.status === "testing"}
                  className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-300 dark:border-slate-700 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {renderKeyTestButtonIcon("mistral")}
                  <span>{keyTestMap["mistral"]?.status === "testing" ? "Testing Key..." : "Test Connection"}</span>
                </button>
              </div>
              {providerKeySaveFeedback.mistral?.text && (
                <p role="status" className={`text-xs ${providerKeySaveFeedback.mistral.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {providerKeySaveFeedback.mistral.text}
                </p>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-xs flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Save API Keys &amp; Refresh</span>
              </button>
            </div>
          </form>
        </div>

        {/* Tavily AI Real-Time Search & Web Scraper */}
        <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-sky-500 dark:text-sky-400" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                Tavily AI Real-Time Search &amp; Web Scraper
              </h3>
            </div>
            {renderKeyStatusBadge("tavily", isTestingTavily)}
          </div>

          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
            Powers real-time web search grounding (<code className="text-sky-600 dark:text-sky-300 font-mono">/api/search</code>) and URL markdown scraping (<code className="text-sky-600 dark:text-sky-300 font-mono">/api/scrape</code>) with 3-retry network resilience under the Strict Zero-Fallback Policy.
          </p>

          <form onSubmit={handleSaveTavily} className="space-y-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  Tavily API Key (<code className="text-sky-600 dark:text-sky-300 font-mono">tvly-...</code>)
                </label>
                <a
                  href="https://tavily.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 underline font-medium"
                >
                  Get Free Key at tavily.com &rarr;
                </a>
              </div>
              <div className="relative">
                <input
                  type={showTavilyKey ? 'text' : 'password'}
                  value={tavilyKeyInput}
                  onChange={(e) => setTavilyKeyInput(e.target.value)}
                  placeholder="tvly-xxxxxxxxxxxxxxxxxxxx"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg pl-3 pr-10 py-1.5 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={() => setShowTavilyKey((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  {showTavilyKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {(tavilyFeedback || keyTestMap["tavily"]?.message) && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                  (tavilyFeedback ? tavilyFeedback.type === 'success' : keyTestMap["tavily"]?.status === 'success')
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                    : 'bg-rose-500/10 border border-rose-500/30 text-rose-800 dark:text-rose-300'
                }`}
              >
                {(tavilyFeedback ? tavilyFeedback.type === 'success' : keyTestMap["tavily"]?.status === 'success') ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="leading-snug">{tavilyFeedback?.text || keyTestMap["tavily"]?.message}</span>
                  {keyTestMap["tavily"]?.testedAt && !tavilyFeedback && (
                    <span className="text-[10px] opacity-75 font-mono block mt-0.5">
                      Last verified at: {keyTestMap["tavily"].testedAt}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleTestTavily}
                disabled={isTestingTavily}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium border border-slate-300 dark:border-slate-700 transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {renderKeyTestButtonIcon("tavily", isTestingTavily)}
                <span>{isTestingTavily ? "Testing Key..." : "Test Connection"}</span>
              </button>

              <button
                type="submit"
                disabled={isSavingTavily || !tavilyKeyInput.trim()}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
              >
                {isSavingTavily ? 'Saving...' : 'Save Tavily Key'}
              </button>
            </div>
          </form>
        </div>

        {/* Neon Serverless PostgreSQL Database */}
        <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                Database Persistence (Neon PostgreSQL)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {dbStatus?.connected && (
                <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse"></span>
                  Connected ({dbStatus.source === 'environment' ? 'DATABASE_URL environment setting' : 'source unavailable'})
                </span>
              )}
              {renderKeyStatusBadge("neon_db", isTestingDb)}
            </div>
          </div>

          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Database connections are managed only through the server-side <code className="text-amber-700 dark:text-amber-300 font-mono">DATABASE_URL</code> deployment secret. The field below tests a candidate connection temporarily; it does not save, replace, or clear deployment configuration.
          </p>

          {dbStatus?.connected && (
            <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 text-xs space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">Active Database:</span>
                <span className="font-mono text-slate-800 dark:text-slate-300 truncate max-w-[260px]">
                  {dbStatus.maskedUrl}
                </span>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-slate-600 dark:text-slate-400 pt-1 border-t border-emerald-200 dark:border-emerald-900/40">
                <span>💬 Messages: <strong className="text-slate-900 dark:text-white">{dbStatus.tables.conversations ?? 'Unavailable'}</strong></span>
                <span>⚖️ Decisions: <strong className="text-slate-900 dark:text-white">{dbStatus.tables.decisions ?? 'Unavailable'}</strong></span>
                <span>📡 Events: <strong className="text-slate-900 dark:text-white">{dbStatus.tables.twin_events ?? 'Unavailable'}</strong></span>
              </div>
            </div>
          )}

          {(dbFeedback || keyTestMap["neon_db"]?.message) && (
            <div
              className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                (dbFeedback ? dbFeedback.type === 'success' : keyTestMap["neon_db"]?.status === 'success')
                  ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-500/10 border border-rose-500/40 text-rose-800 dark:text-rose-300'
              }`}
            >
              {(dbFeedback ? dbFeedback.type === 'success' : keyTestMap["neon_db"]?.status === 'success') ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <span className="leading-snug">{dbFeedback?.text || keyTestMap["neon_db"]?.message}</span>
                {keyTestMap["neon_db"]?.testedAt && !dbFeedback && (
                  <span className="text-[10px] opacity-75 font-mono block mt-0.5">
                    Last verified at: {keyTestMap["neon_db"].testedAt}
                  </span>
                )}
              </div>
            </div>
          )}

          <form onSubmit={(event) => { event.preventDefault(); void handleTestDb(); }} className="space-y-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Neon Connection String (postgresql://...)
              </label>
              <div className="relative">
                <input
                  type={showDbUrl ? 'text' : 'password'}
                  value={dbUrlInput}
                  onChange={(e) => setDbUrlInput(e.target.value)}
                  placeholder={
                    dbStatus?.maskedUrl
                      ? `Active connection: ${dbStatus.maskedUrl} (read-only)`
                      : 'Enter a candidate URL for a temporary connection test'
                  }
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg pl-3 pr-10 py-1.5 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowDbUrl(!showDbUrl)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  title={showDbUrl ? 'Hide URL' : 'Show URL'}
                >
                  {showDbUrl ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">


              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestDb}
                  disabled={isTestingDb || !dbUrlInput.trim()}
                  className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-300 dark:border-slate-700 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {renderKeyTestButtonIcon("neon_db", isTestingDb)}
                  <span>{isTestingDb ? "Testing..." : "Test Connection"}</span>
                </button>

              </div>
            </div>
          </form>
        </div>

        {/* Telegram Bot Management Section */}
        <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-[#2AABEE]" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                Telegram Bot Integration &amp; Webhook
              </h3>
            </div>
            {telegramStatus?.isRunning ? (
              <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse"></span>
                {telegramStatus.mode === 'webhook' ? 'Webhook Active' : 'Long-Polling Active'}
                {telegramStatus.botUsername ? ` (@${telegramStatus.botUsername})` : ''}
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 font-mono">
                {telegramStatus?.hasToken ? 'Configured (Stopped)' : 'Unconfigured'}
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Connect your digital twin to Telegram. Enter your Telegram Bot Token from <code className="text-sky-600 dark:text-sky-400 font-mono">@BotFather</code>, select polling or HTTPS webhook mode, and pair with your phone using <code className="text-amber-600 dark:text-amber-400 font-mono">/start {telegramStatus?.pairingCode || 'LKN-...'}</code>.
          </p>

          {telegramStatus?.hasToken && (
            <div className="p-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800/40 text-xs space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-sky-700 dark:text-sky-400 font-medium">Bot Handle &amp; Token:</span>
                <span className="font-mono text-slate-800 dark:text-slate-300">
                  {telegramStatus.botUsername ? `@${telegramStatus.botUsername}` : telegramStatus.tokenMasked}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-sky-200 dark:border-sky-900/40">
                <span className="text-slate-600 dark:text-slate-400">Owner Pairing Status:</span>
                <span className={`font-semibold ${telegramStatus.isPaired ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {telegramStatus.isPaired ? `Paired (ID: ${telegramStatus.ownerId})` : `Unpaired (Code: ${telegramStatus.pairingCode})`}
                </span>
              </div>
            </div>
          )}

          {(tgFeedback || keyTestMap["telegram"]?.message) && (
            <div
              className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                (tgFeedback ? tgFeedback.type === 'success' : keyTestMap["telegram"]?.status === 'success')
                  ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-500/10 border border-rose-500/40 text-rose-800 dark:text-rose-300'
              }`}
            >
              {(tgFeedback ? tgFeedback.type === 'success' : keyTestMap["telegram"]?.status === 'success') ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <span className="leading-snug">{tgFeedback?.text || keyTestMap["telegram"]?.message}</span>
                {keyTestMap["telegram"]?.testedAt && !tgFeedback && (
                  <span className="text-[10px] opacity-75 font-mono block mt-0.5">
                    Last verified at: {keyTestMap["telegram"].testedAt}
                  </span>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSaveTelegram} className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  Telegram Bot Token (from @BotFather)
                </label>
                {renderKeyStatusBadge("telegram", isTestingTgToken)}
              </div>
              <div className="relative">
                <input
                  type={showTgToken ? 'text' : 'password'}
                  value={tgTokenInput}
                  onChange={(e) => setTgTokenInput(e.target.value)}
                  placeholder={telegramStatus?.hasToken ? '••••••••••••••••••••••••' : '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ'}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg pl-3 pr-10 py-1.5 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={() => setShowTgToken(!showTgToken)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  title={showTgToken ? 'Hide Token' : 'Show Token'}
                >
                  {showTgToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Delivery Mode
                </label>
                <select
                  value={tgModeInput}
                  onChange={(e) => setTgModeInput(e.target.value as 'polling' | 'webhook')}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="polling">Long-Polling (Reliable development)</option>
                  <option value="webhook">Webhook (Production / HTTPS)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  HTTPS Webhook URL (if Webhook mode)
                </label>
                <input
                  type="url"
                  value={tgWebhookUrlInput}
                  onChange={(e) => setTgWebhookUrlInput(e.target.value)}
                  placeholder="https://your-domain.com"
                  disabled={tgModeInput !== 'webhook'}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              {telegramStatus?.isPaired ? (
                <button
                  type="button"
                  onClick={handleResetTgPairing}
                  className="text-[11px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:text-amber-300 underline font-medium"
                >
                  Unpair / Reset Code
                </button>
              ) : (
                <div className="text-[11px] text-slate-500 font-mono">
                  Pairing Code: <strong className="text-amber-600 dark:text-amber-400">{telegramStatus?.pairingCode || 'LKN-...'}</strong>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestTgToken}
                  disabled={isTestingTgToken || (!tgTokenInput.trim() && !telegramStatus?.hasToken)}
                  className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-300 dark:border-slate-700 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {renderKeyTestButtonIcon("telegram", isTestingTgToken)}
                  <span>{isTestingTgToken ? "Testing..." : "Test Token"}</span>
                </button>
                <button
                  type="submit"
                  disabled={isSavingTg}
                  className="px-3.5 py-1 rounded-lg bg-[#2AABEE] hover:bg-[#229ED9] text-white text-xs font-semibold transition disabled:opacity-50"
                >
                  {isSavingTg ? 'Saving...' : 'Save &amp; Start Bot'}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Twilio WhatsApp Integration */}
        <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-500" />
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white">Twilio WhatsApp Integration</h3>
              {renderKeyStatusBadge("twilio", isTestingTwilio)}
            </div>
            {twilioTokenConfigured && twilioAccountSid ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Configured (Active)
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 font-mono">
                Unconfigured
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Connect TwinMind to WhatsApp via Twilio. Enter your Account SID, Auth Token, and WhatsApp Number. Chat naturally, trigger debates, and confirm decision outcomes from your phone.
          </p>

          {/* Dynamic Webhook URL Card */}
          <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-700 dark:text-slate-300">
              <span>Dynamic Twilio Webhook URL:</span>
              <button
                type="button"
                onClick={() => {
                  const dynamicUrl = `${window.location.origin}/api/twilio/whatsapp`;
                  navigator.clipboard.writeText(dynamicUrl);
                  setFeedbackToast('Dynamic Webhook URL copied to clipboard!');
                  setTimeout(() => setFeedbackToast(null), 2500);
                }}
                className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline font-semibold"
              >
                Copy URL
              </button>
            </div>
            <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200 break-all bg-white dark:bg-slate-950 p-1.5 rounded border border-slate-200 dark:border-slate-800">
              {typeof window !== 'undefined' ? `${window.location.origin}/api/twilio/whatsapp` : '/api/twilio/whatsapp'}
            </div>
          </div>

          {/* 3-Stage Diagnostic Results Card */}
          {twilioDiagnostic && (
            <div className="p-2.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 text-xs space-y-2">
              <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                3-Stage Diagnostic Results:
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                <div className={`p-1.5 rounded border text-center ${twilioDiagnostic.stage1Configured ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-700'}`}>
                  Stage 1: Configured {twilioDiagnostic.stage1Configured ? '✓' : '✗'}
                </div>
                <div className={`p-1.5 rounded border text-center ${twilioDiagnostic.stage2AuthSuccess ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-700'}`}>
                  Stage 2: Auth {twilioDiagnostic.stage2AuthSuccess ? '✓' : '✗'}
                </div>
                <div className={`p-1.5 rounded border text-center ${twilioDiagnostic.stage3DeliverySuccess ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/10 border-slate-500/30 text-slate-500'}`}>
                  Stage 3: Delivery {twilioDiagnostic.stage3DeliverySuccess ? '✓' : '-'}
                </div>
              </div>
            </div>
          )}

          {(twilioFeedback || keyTestMap["twilio"]?.message) && (
            <div
              className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                (twilioFeedback ? twilioFeedback.type === 'success' : keyTestMap["twilio"]?.status === 'success')
                  ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-500/10 border border-rose-500/40 text-rose-800 dark:text-rose-300'
              }`}
            >
              {(twilioFeedback ? twilioFeedback.type === 'success' : keyTestMap["twilio"]?.status === 'success') ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <span className="leading-snug">{twilioFeedback?.text || keyTestMap["twilio"]?.message}</span>
                {keyTestMap["twilio"]?.testedAt && !twilioFeedback && (
                  <span className="text-[10px] opacity-75 font-mono block mt-0.5">
                    Last verified at: {keyTestMap["twilio"].testedAt}
                  </span>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSaveTwilioSettings} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Twilio Account SID
                </label>
                <div className="relative">
                  <input
                    type={showTwilioSid ? "text" : "password"}
                    value={twilioAccountSid}
                    onChange={(e) => setTwilioAccountSid(e.target.value)}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg pl-2.5 pr-9 py-1.5 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTwilioSid(!showTwilioSid)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                    title={showTwilioSid ? "Hide SID" : "Show SID"}
                  >
                    {showTwilioSid ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Twilio Auth Token
                </label>
                <div className="relative">
                  <input
                    type={showTwilioToken ? 'text' : 'password'}
                    value={twilioAuthToken}
                    onChange={(e) => setTwilioAuthToken(e.target.value)}
                    placeholder={twilioTokenConfigured ? '••••••••••••••••••••••••' : 'Enter Auth Token'}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg pl-2.5 pr-9 py-1.5 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTwilioToken(!showTwilioToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  >
                    {showTwilioToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Twilio WhatsApp Sender Number
                </label>
                <input
                  type="text"
                  value={twilioWhatsAppNumber}
                  onChange={(e) => setTwilioWhatsAppNumber(e.target.value)}
                  placeholder="whatsapp:+14155238886"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Your Phone Number (Authorized Sender)
                </label>
                <input
                  type="text"
                  value={userPhoneNumber}
                  onChange={(e) => setUserPhoneNumber(e.target.value)}
                  placeholder="+1234567890"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="enforce-twilio-sig"
                checked={enforceTwilioSignature}
                onChange={(e) => setEnforceTwilioSignature(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-emerald-500 focus:ring-emerald-500 w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
              />
              <label htmlFor="enforce-twilio-sig" className="text-[11px] text-slate-700 dark:text-slate-300 font-medium cursor-pointer">
                Enforce Mandatory X-Twilio-Signature Webhook Validation
              </label>
            </div>
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800/60 space-y-2">
              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Proactive Strategic Alert Channel
              </label>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2">
                Choose where you want to receive autonomous red-teaming alerts and calibration reminders.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setProactiveAlertChannel('whatsapp')}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-semibold transition ${proactiveAlertChannel === 'whatsapp' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-400 shadow-xs' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500'}`}
                >
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => setProactiveAlertChannel('telegram')}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-semibold transition ${proactiveAlertChannel === 'telegram' ? 'bg-indigo-500/10 border-indigo-500 text-indigo-700 dark:text-indigo-400 shadow-xs' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500'}`}
                >
                  Telegram
                </button>
                <button
                  type="button"
                  onClick={() => setProactiveAlertChannel('none')}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-semibold transition ${proactiveAlertChannel === 'none' ? 'bg-slate-500/10 border-slate-500 text-slate-700 dark:text-slate-400 shadow-xs' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500'}`}
                >
                  None
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleRunTwilioDiagnostic}
                disabled={isTestingTwilio}
                className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-300 dark:border-slate-700 transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {renderKeyTestButtonIcon("twilio", isTestingTwilio)}
                <span>{isTestingTwilio ? "Running Diagnostic..." : "3-Stage Diagnostic Test"}</span>
              </button>
              <button
                type="submit"
                disabled={isSavingTwilio}
                className="px-3.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition disabled:opacity-50"
              >
                {isSavingTwilio ? 'Saving...' : 'Save & Sync WhatsApp'}
              </button>
            </div>
          </form>
        </div>

        {/* Voice Selection */}
        <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white">Voice Note Persona (TTS)</h3>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            Configure the voice identifier accepted by the selected speech model:
          </p>

          <div className="space-y-1.5">
            <label htmlFor="tts-voice-id" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Provider voice identifier
            </label>
            <input
              id="tts-voice-id"
              type="text"
              value={voice}
              onChange={(event) => onVoiceChange(event.target.value)}
              placeholder="Enter a voice ID supported by the configured TTS model"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-amber-500"
            />
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Voice IDs are not preselected. The provider validates the configured ID when audio is generated.
            </p>
          </div>

          {/* Voice Note Auto-Play & Speed Settings */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoplay-voice-toggle"
                checked={autoPlayVoice}
                onChange={(e) => onAutoPlayVoiceChange?.(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 w-3.5 h-3.5 accent-amber-500 cursor-pointer"
              />
              <label htmlFor="autoplay-voice-toggle" className="text-slate-700 dark:text-slate-300 font-medium cursor-pointer text-xs">
                Auto-play incoming voice notes
              </label>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Default Speed:</span>
              {[0.75, 1, 1.25, 1.5, 2].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onVoiceSpeedChange?.(s)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono transition ${
                    voiceSpeed === s
                      ? 'bg-amber-500 text-slate-950 font-bold'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between text-xs">
        <div className="text-slate-500 dark:text-slate-400">
          Active: <span className="font-mono text-slate-900 dark:text-white font-semibold">{activeModel}</span> ({activeProvider})
        </div>
        <button
          onClick={onClose}
          className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition shadow-xs"
        >
          Done
        </button>
      </div>
    </div>
  );

  if (isEmbedded) {
    return (
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 max-w-3xl w-full mx-auto pb-24">
        {modalInner}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      {modalInner}
    </div>
  );
};
