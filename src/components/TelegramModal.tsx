import React, { useState, useEffect } from 'react';
import {
  X,
  Send,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  Mic,
  Zap,
  Lock,
  Radio,
  Sliders,
  Terminal,
  MessageSquare,
  Key,
} from 'lucide-react';

interface TelegramStatus {
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
  logs: { timestamp: string; type: string; message: string }[];
  syncedMessagesCount: number;
}

interface TelegramModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName?: string;
  nickname?: string;
  brandName?: string;
}

export const TelegramModal: React.FC<TelegramModalProps> = ({
  isOpen,
  onClose,
  userName = '',
  nickname = '',
  brandName = 'TwinMind AI',
}) => {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [modeInput, setModeInput] = useState<'polling' | 'webhook'>('polling');
  const [webhookUrlInput, setWebhookUrlInput] = useState('');
  const [botInfo, setBotInfo] = useState<{ username?: string; first_name?: string } | null>(null);
  const [testingToken, setTestingToken] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeTab, setActiveTab] = useState<'setup' | 'owner' | 'commands' | 'logs'>('setup');
  const [syncedMessages, setSyncedMessages] = useState<any[]>([]);
  const [commandsList, setCommandsList] = useState<any[]>([]);
  const [syncingCommands, setSyncingCommands] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const displayName = nickname.trim() || userName.trim();

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/telegram/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setModeInput(data.mode || 'polling');
        setWebhookUrlInput(data.webhookUrl || '');
      }
    } catch (err) {
      console.warn('Failed to fetch Telegram status:', err);
    }
  };

  const fetchSyncedMessages = async () => {
    try {
      const res = await fetch('/api/telegram/messages');
      if (res.ok) {
        const data = await res.json();
        setSyncedMessages(data.messages || []);
      }
    } catch (err) {
      console.warn('Failed to fetch Telegram messages:', err);
    }
  };

  const fetchCommands = async () => {
    try {
      const res = await fetch('/api/telegram/commands');
      if (res.ok) {
        const data = await res.json();
        setCommandsList(data.commands || []);
      }
    } catch (err) {
      console.warn('Failed to fetch Telegram commands:', err);
    }
  };

  const handleSyncCommands = async () => {
    setSyncingCommands(true);
    setSyncFeedback(null);
    try {
      const res = await fetch('/api/telegram/sync-commands', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSyncFeedback(`Successfully synchronized ${data.syncedCount} active commands to Telegram menu!`);
        fetchCommands();
        fetchStatus();
      } else {
        setSyncFeedback('Could not sync commands. Verify bot token is active.');
      }
    } catch (err: unknown) {
      setSyncFeedback(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingCommands(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      fetchSyncedMessages();
      fetchCommands();
      const interval = setInterval(() => {
        fetchStatus();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const handleTestToken = async () => {
    setTestingToken(true);
    setTestResult(null);
    try {
      const tokenToTest = tokenInput.trim();
      const res = await fetch('/api/telegram/test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenToTest }),
      });
      const data = await res.json();
      if (data.ok) {
        setBotInfo(data.botInfo);
        setTestResult({
          ok: true,
          message: `Verified! Bot is @${data.botInfo.username} (${data.botInfo.first_name})`,
        });
      } else {
        setTestResult({
          ok: false,
          message: data.error || 'Failed to authenticate token with Telegram API.',
        });
      }
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Network test error',
      });
    } finally {
      setTestingToken(false);
    }
  };

  const handleSaveConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: tokenInput.trim() || undefined,
          mode: modeInput,
          webhookUrl: webhookUrlInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.status) {
        setStatus(data.status);
      }
      setTestResult({
        ok: data.success,
        message: data.message || 'Settings saved successfully',
      });
      setTokenInput('');
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Save error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPairing = async () => {
    if (!confirm('Are you sure you want to unpair the current Telegram account? A new pairing code will be generated.')) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/reset-pairing', { method: 'POST' });
      const data = await res.json();
      if (data.status) {
        setStatus(data.status);
      }
    } catch (err) {
      console.error('Reset pairing error:', err);
    } finally {
      setLoading(false);
    }
  };

  const copyPairingCode = () => {
    if (status?.pairingCode) {
      navigator.clipboard.writeText(status.pairingCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const botHandle = botInfo?.username || status?.botUsername;
  const deepLink = botHandle
    ? `https://t.me/${botHandle}?start=${status?.pairingCode?.replace('-', '') || ''}`
    : null;

  const copyDeepLink = () => {
    if (deepLink) {
      navigator.clipboard.writeText(deepLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-900 dark:text-white">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#2AABEE] to-[#229ED9] flex items-center justify-center text-white shadow-md">
              <Send className="w-5 h-5 -rotate-12 translate-x-0.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Real Telegram Bot Integration
                </h3>
                {status?.isRunning && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                    Online
                  </span>
                )}
                {status?.hasToken && !status.isRunning && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                    Connecting...
                  </span>
                )}
                {!status?.hasToken && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                    Setup Needed
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Chat directly with {displayName} from your phone via Telegram
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-5 bg-slate-50/70 dark:bg-slate-950/40 text-xs">
          <button
            onClick={() => setActiveTab('setup')}
            className={`py-2.5 px-3 font-medium border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'setup'
                ? 'border-[#2AABEE] text-[#2AABEE] font-semibold'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Connection & Mode</span>
          </button>
          <button
            onClick={() => setActiveTab('owner')}
            className={`py-2.5 px-3 font-medium border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'owner'
                ? 'border-[#2AABEE] text-[#2AABEE] font-semibold'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Owner Guard & Pairing</span>
            {status?.isPaired && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 inline-block" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('commands')}
            className={`py-2.5 px-3 font-medium border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'commands'
                ? 'border-[#2AABEE] text-[#2AABEE] font-semibold'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Phone Commands & Voice</span>
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`py-2.5 px-3 font-medium border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'logs'
                ? 'border-[#2AABEE] text-[#2AABEE] font-semibold'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Live Logs ({status?.logs?.length || 0})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-sm">
          {/* TAB 1: SETUP & ENGINE MODE */}
          {activeTab === 'setup' && (
            <div className="space-y-4">
              {/* Verified Bot Info */}
              {botInfo && (
                <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <div>
                    <h4 className="text-sm font-bold text-emerald-300">@{botInfo.username}</h4>
                    <p className="text-xs text-emerald-600/80">Verified Bot Identity: {botInfo.first_name}</p>
                  </div>
                </div>
              )}

              {/* Bot Setup Instructions */}
              <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-[#2AABEE]" />
                  <span>3-Step Bot Setup via @BotFather</span>
                </h4>
                <ol className="text-xs text-slate-700 dark:text-slate-300 space-y-1.5 list-decimal list-inside leading-relaxed">
                  <li>
                    Open Telegram on your phone and search for <strong className="text-slate-900 dark:text-white">@BotFather</strong>.
                  </li>
                  <li>
                    Send <code className="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded text-amber-700 dark:text-amber-300 font-mono">/newbot</code>.
                  </li>
                  <li>
                    Copy the HTTP API token provided by BotFather and paste it below:
                  </li>
                </ol>

                <div className="space-y-2 pt-1">
                  <label className="text-xs text-slate-600 dark:text-slate-400 block font-medium">
                    Telegram Bot Token:
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder={status?.tokenMasked || '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'}
                      className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 font-mono focus:outline-none focus:border-[#2AABEE]"
                    />
                    <button
                      onClick={handleTestToken}
                      disabled={testingToken || (!tokenInput.trim() && !status?.hasToken)}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-medium rounded-xl transition flex items-center gap-1.5 shrink-0"
                    >
                      {testingToken ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#2AABEE]" />
                      )}
                      <span>Verify</span>
                    </button>
                  </div>
                </div>

                {testResult && (
                  <div
                    className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                      testResult.ok
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                        : 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-500/30 text-red-800 dark:text-red-300'
                    }`}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                    )}
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>

              {/* Mode Selection */}
              <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                  Engine Connection Mode:
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setModeInput('polling')}
                    className={`p-3 rounded-xl border text-left transition ${
                      modeInput === 'polling'
                        ? 'bg-[#2AABEE]/10 border-[#2AABEE] text-slate-900 dark:text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5 text-[#2AABEE]" />
                        Long-Polling
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Zero-configuration outbound polling.
                    </p>
                  </button>

                  <button
                    onClick={() => setModeInput('webhook')}
                    className={`p-3 rounded-xl border text-left transition ${
                      modeInput === 'webhook'
                        ? 'bg-[#2AABEE]/10 border-[#2AABEE] text-slate-900 dark:text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs flex items-center gap-1.5">
                        <ExternalLink className="w-3.5 h-3.5 text-[#2AABEE]" />
                        Webhook
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Direct HTTPS webhook push.
                    </p>
                  </button>
                </div>

                {modeInput === 'webhook' && (
                  <div className="pt-2 space-y-1.5">
                    <label className="text-xs text-slate-600 dark:text-slate-400">Public Webhook URL Base:</label>
                    <input
                      type="text"
                      value={webhookUrlInput}
                      onChange={(e) => setWebhookUrlInput(e.target.value)}
                      placeholder="https://your-domain.com"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 font-mono focus:outline-none focus:border-[#2AABEE]"
                    />
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={handleSaveConfig}
                    disabled={loading}
                    className="px-4 py-2 bg-gradient-to-r from-[#2AABEE] to-[#229ED9] hover:opacity-90 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md transition flex items-center gap-1.5"
                  >
                    {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    <span>Save & Apply Engine Settings</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: OWNER GUARD & PAIRING */}
          {activeTab === 'owner' && (
            <div className="space-y-4">
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
                      Owner Guard Protocol (Strict Single-User Access)
                    </h4>
                  </div>
                  {status?.isPaired ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-medium">
                      🔒 Paired & Locked
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-medium">
                      Ready for Pairing
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Because this is strictly your private digital twin ({brandName}), anyone else who attempts to message your bot receives an automatic rejection.
                </p>

                {status?.isPaired ? (
                  <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Locked Telegram ID:</span>
                      <span className="font-mono text-emerald-300 font-bold text-xs">
                        {status.ownerId}
                      </span>
                    </div>
                    {status.ownerUsername && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Paired Username:</span>
                        <span className="text-slate-200 text-xs">@{status.ownerUsername}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-slate-800 flex justify-end">
                      <button
                        onClick={handleResetPairing}
                        className="text-xs text-red-400 hover:text-red-300 hover:underline transition"
                      >
                        Unpair Account & Reset Code
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-slate-400 block">Your Secret Pairing Code:</span>
                        <span className="text-lg font-mono font-bold text-amber-400 tracking-wider">
                          {status?.pairingCode || 'LKN-XXXX'}
                        </span>
                      </div>
                      <button
                        onClick={copyPairingCode}
                        className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1.5 text-xs font-medium"
                      >
                        {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedCode ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>

                    {deepLink && (
                      <div className="pt-2 flex items-center gap-2">
                        <a
                          href={deepLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 py-2 px-3 bg-[#2AABEE] hover:bg-[#229ED9] text-white font-medium text-xs rounded-xl flex items-center justify-center gap-1.5 transition"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>One-Click Pair on Phone</span>
                        </a>
                        <button
                          onClick={copyDeepLink}
                          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition"
                          title="Copy pairing link"
                        >
                          {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: DYNAMIC COMMANDS & FREE CONVERSATION */}
          {activeTab === 'commands' && (
            <div className="space-y-4">
              {/* Free Chatting Banner */}
              <div className="bg-gradient-to-r from-emerald-500/10 via-cyan-500/10 to-blue-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
                    Free Conversational Chatting (No Commands Required)
                  </h4>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium ml-auto">
                    Active & Unrestricted
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  You are not limited to command syntax! You can chat with your twin completely freely on Telegram — just like texting a thinking partner. Ask strategic dilemmas, debate product ideas, analyze problems, or brainstorm solutions in natural texting cadence.
                </p>
              </div>

              {/* Dynamic Command Registry Card */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-amber-400" />
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-white">
                        Dynamic Telegram Command Generator (/setMyCommands)
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Built dynamically by inspecting registered command handlers — only ready handlers are advertised in Telegram.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleSyncCommands}
                    disabled={syncingCommands}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingCommands ? 'animate-spin' : ''}`} />
                    <span>Sync /setMyCommands</span>
                  </button>
                </div>

                {syncFeedback && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{syncFeedback}</span>
                  </div>
                )}

                <div className="space-y-2 text-xs">
                  {commandsList.length > 0 ? (
                    commandsList.map((cmd, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5 transition hover:border-slate-700"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <code className="font-mono text-amber-300 font-bold text-xs">
                              /{cmd.command}
                            </code>
                            {cmd.usage && cmd.usage !== `/${cmd.command}` && (
                              <span className="font-mono text-[10px] text-slate-500">
                                {cmd.usage}
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              cmd.isReady
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {cmd.isReady ? 'READY' : 'UNINITIALIZED'}
                          </span>
                        </div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          {cmd.description}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      Loading registered commands...
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: LIVE LOGS & SYNCED TELEGRAM FEED */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2 font-mono text-xs max-h-60 overflow-y-auto">
                <div className="flex items-center justify-between text-slate-400 pb-2 border-b border-slate-800">
                  <span>Connection & Auth Logs</span>
                  <button
                    onClick={fetchStatus}
                    className="p-1 hover:text-white transition"
                    title="Refresh logs"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
                {status?.logs && status.logs.length > 0 ? (
                  status.logs.map((log, idx) => (
                    <div key={idx} className="flex gap-2 text-[11px] leading-relaxed">
                      <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                      <span
                        className={`font-semibold shrink-0 ${
                          log.type === 'auth'
                            ? 'text-emerald-400'
                            : log.type === 'chat'
                            ? 'text-indigo-400'
                            : log.type === 'error'
                            ? 'text-red-400'
                            : 'text-slate-400'
                        }`}
                      >
                        [{log.type.toUpperCase()}]
                      </span>
                      <span className="text-slate-300">{log.message}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500 italic">No events recorded yet.</p>
                )}
              </div>

              {syncedMessages.length > 0 && (
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5 text-[#2AABEE]" />
                    <span>Recent Synced Messages via Telegram</span>
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {syncedMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`p-2.5 rounded-xl text-xs ${
                          msg.sender === 'user'
                            ? 'bg-slate-800 ml-6 text-white'
                            : 'bg-indigo-950/40 border border-indigo-500/20 mr-6 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                          <span>{msg.sender === 'user' ? `${displayName || 'Owner'} (Telegram)` : `${brandName} (Telegram)`}</span>
                          <span>{msg.timestamp}</span>
                        </div>
                        <p className="text-xs leading-relaxed">{msg.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Dual Engine: Polling & Webhook Ready</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
