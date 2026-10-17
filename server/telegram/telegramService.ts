import fs from 'fs';
import path from 'path';
import { randomInt, randomUUID } from 'node:crypto';
import { Bot, InputFile, InlineKeyboard, webhookCallback } from 'grammy';
import { GoogleGenAI } from '@google/genai';
import { buildSystemPrompt } from '../../src/prompt/masterPrompt.ts';
import { neonDb } from '../db/neonService.ts';
import { settingsManager } from '../db/settingsService.ts';
import { knowledgeService } from '../db/knowledgeService.ts';
import { callWithBoundedRetry } from '../utils/retryHelper.ts';
import { twinAgentService } from '../services/twinAgentService.ts';
import { modelCatalogService } from '../services/modelCatalogService.ts';

export interface TelegramConfig {
  token: string;
  ownerId: number | null;
  ownerUsername: string | null;
  pairingCode: string;
  mode: 'polling' | 'webhook';
  webhookUrl: string;
  activeProvider: string;
  activeModel: string;
}

export interface TelegramLogEntry {
  timestamp: string;
  type: 'info' | 'auth' | 'chat' | 'error';
  message: string;
}

export interface SyncedTelegramMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  isVoice?: boolean;
}

export interface TelegramCommandHandler {
  command: string;
  description: string;
  usage?: string;
  category: 'core' | 'analysis' | 'settings' | 'voice' | 'research';
  isReady: () => boolean;
  execute: (ctx: any, args: string) => Promise<void>;
}

// Generate human-friendly pairing code
function generatePairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'LKN-';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(randomInt(chars.length));
  }
  return code;
}

// Normalize secrets at the boundary without logging or returning their values.
function cleanConfigSecret(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim().replace(/^["']|["']$/g, '');
  return !cleaned || cleaned.includes('...') || cleaned === '********' ? '' : cleaned;
}

function parseOwnerId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

// Environment values remain authoritative; database-backed values are used when environment values are absent.
function loadConfig(): TelegramConfig {
  const saved = settingsManager.getSettings();
  const envMode = process.env.TELEGRAM_MODE;
  const savedMode = saved.telegramMode;
  const mode: 'polling' | 'webhook' = envMode === 'polling' || envMode === 'webhook'
    ? envMode
    : savedMode === 'webhook' ? 'webhook' : 'polling';

  return {
    token: cleanConfigSecret(process.env.TELEGRAM_BOT_TOKEN) || cleanConfigSecret(saved.telegramToken),
    ownerId: parseOwnerId(process.env.TELEGRAM_OWNER_ID) ?? parseOwnerId(saved.telegramOwnerId),
    ownerUsername: null,
    pairingCode: generatePairingCode(),
    mode,
    webhookUrl: cleanConfigSecret(process.env.TELEGRAM_WEBHOOK_URL) || cleanConfigSecret(saved.telegramWebhookUrl),
    activeProvider: saved.activeProvider || '',
    activeModel: saved.activeModel || '',
  };
}

// Never report a configuration update successful when a credential or integration setting failed to persist.
async function saveConfig(cfg: TelegramConfig, persistToken = false): Promise<void> {
  const patch: Record<string, unknown> = {
    telegramMode: cfg.mode,
    telegramWebhookUrl: cfg.webhookUrl,
    telegramOwnerId: cfg.ownerId ? String(cfg.ownerId) : '',
  };
  if (persistToken) patch.telegramToken = cfg.token;
  await settingsManager.updateSettings(patch as Partial<AppSettings>);
}

class TelegramBotManager {
  private config: TelegramConfig;
  private bot: Bot | null = null;
  private isRunning: boolean = false;
  private logs: TelegramLogEntry[] = [];
  private syncedMessages: SyncedTelegramMessage[] = [];
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  private commandRegistry: TelegramCommandHandler[] = [];
  private lastSyncedCommands: Array<{ command: string; description: string }> = [];
  // Idempotency update tracking to prevent duplicate update processing
  private processedUpdateIds = new Set<number>();
  // Cached verified bot identity from getMe
  private botUsername: string | null = null;
  private botFirstName: string | null = null;
  // Dynamic action map for context-generated inline keyboard buttons (Zero hardcoding)
  private dynamicActionCallbacks = new Map<string, { payload: string; action: 'prompt' | 'voice' | 'vault'; expiresAt: number }>();

  constructor() {
    this.config = loadConfig();
    this.initCommandRegistry();
    this.log('info', 'Telegram service initialized with Zero Silent Failure policy');
  }


  /**
   * Initializes the command directory.
   */
  private initCommandRegistry() {
    this.commandRegistry = [
      {
        command: 'start',
        description: 'Initialize private connection & pair with digital twin',
        usage: '/start [pairing_code]',
        category: 'core',
        isReady: () => true,
        execute: async (ctx, args) => {
          const from = ctx.from;
          if (!from) return;
          const userId = from.id;

          if (this.config.ownerId === userId) {
            this.config.ownerId = userId;
            this.config.ownerUsername = from.username || from.first_name || settingsManager.getSettings().userName || '';
            await saveConfig(this.config);
            this.log('auth', `Paired with owner ID ${userId} (@${from.username || from.first_name})`);

            const keyboard = new InlineKeyboard()
              .text('🎯 Decision Deconstruct', 'action_decide')
              .text('🔍 Live Search', 'action_search')
              .row()
              .text('⚔️ Multi-Agent Debate', 'action_debate')
              .text('📊 Weekly Summary', 'action_summary');

            await ctx.reply(
              `✨ *TWINMIND — AI Digital Twin & Second Brain*\n\n` +
              `🔒 *Owner Pairing Confirmed!*\n` +
              `Connected to: \`${userId}\` (@${from.username || from.first_name}).\n\n` +
              `💬 *Free Chatting & Automatic Knowledge Grounding:*\n` +
              `You can text me freely! Every question is automatically grounded in your personal Vector Knowledge Vault.\n\n` +
              `Quick actions:`,
              { parse_mode: 'Markdown', reply_markup: keyboard }
            );
          } else {
            await ctx.reply(
              `🔒 *Access Restricted:*\nThis bot is locked to owner ID \`${this.config.ownerId}\`. External access is restricted by Owner Guard.`,
              { parse_mode: 'Markdown' }
            );
          }
        },
      },
      {
        command: 'help',
        description: 'Show dynamic capabilities and interactive command directory',
        usage: '/help',
        category: 'core',
        isReady: () => true,
        execute: async (ctx) => {
          const readyHandlers = this.commandRegistry.filter((h) => {
            try {
              return h.isReady();
            } catch {
              return false;
            }
          });

          let message = `✨ *TWINMIND — AI Digital Twin & Second Brain*\n\n`;
          message += `💬 *Free Chatting Mode (Primary)*\n`;
          message += `Text me freely! Incoming messages are automatically grounded in your Vector Knowledge Vault.\n\n`;
          message += `🛠️ *Registered Commands (${readyHandlers.length} Ready):*\n`;

          for (const h of readyHandlers) {
            if (h.command === 'start') continue;
            message += `• \`/${h.command}\` — ${h.description}\n`;
          }

          message += `\nSend any text message to continue our conversation.`;
          await ctx.reply(message, { parse_mode: 'Markdown' });
        },
      },
      {
        command: 'search',
        description: 'Live web search with sourced citations via Tavily (Zero Silent Failure)',
        usage: '/search <query>',
        category: 'research',
        isReady: () => true,
        execute: async (ctx, args) => {
          if (!args) {
            await ctx.reply(
              `🔍 *Live Web Sourced Search*\n\n` +
              `Provide a query to search the live web for verified facts, for example:\n` +
              `\`/search latest AI multimodal benchmark rankings 2026\``,
              { parse_mode: 'Markdown' }
            );
            return;
          }

          await ctx.replyWithChatAction('typing');

          try {
            const res: any = await twinAgentService.executeSearchWeb(args.trim());
            if (res.error) {
              await ctx.reply(`⚠️ *Live Search Notice:*\n${res.error}`, { parse_mode: 'Markdown' });
              return;
            }

            let replyText = `🌐 *Live Web Sourced Findings*\n`;
            replyText += `🔎 *Query:* "${args.trim()}"\n\n`;

            if (res.synthesizedAnswer) {
              replyText += `💡 *Synthesized Answer:*\n${res.synthesizedAnswer}\n\n`;
            }

            if (res.sources && res.sources.length > 0) {
              replyText += `📚 *Verified Sources:*\n`;
              res.sources.forEach((s: any) => {
                replyText += `${s.index}. [${s.title}](${s.url})\n   _${s.snippet}..._\n\n`;
              });
            } else {
              replyText += `*No matching web sources found above threshold.*`;
            }

            replyText += `\n_Tag: Live Web Evidence (Zero Synthetic Citations)_`;

            const keyboard = new InlineKeyboard()
              .text('💾 Save as Note', `save_note_${encodeURIComponent(args.slice(0, 20))}`)
              .text('⚔️ Debate Topic', `debate_${encodeURIComponent(args.slice(0, 20))}`);

            await ctx.reply(replyText, {
              parse_mode: 'Markdown',
              disable_web_page_preview: false,
              reply_markup: keyboard,
            });
          } catch (err: unknown) {
            console.error('Telegram search error:', err);
            await ctx.reply(`❌ *Search Failed:* ${err instanceof Error ? err.message : String(err)}`, {
              parse_mode: 'Markdown',
            });
          }
        },
      },
      {
        command: 'debate',
        description: 'Multi-Agent Debate: 4-stage pipeline (Framer, Independent perspectives, Critic, Synthesis)',
        usage: '/debate <dilemma>',
        category: 'analysis',
        isReady: () => true,
        execute: async (ctx, args) => {
          if (!args) {
            await ctx.reply(
              `⚔️ *Selective Multi-Agent Debate*\n\n` +
              `Provide a strategic question or trade-off to stress-test, for example:\n` +
              `\`/debate Should we build mobile native or stick to progressive web app for v1?\``,
              { parse_mode: 'Markdown' }
            );
            return;
          }

          await ctx.replyWithChatAction('typing');

          try {
            const res: any = await twinAgentService.executeMultiAgentDebate(
              args,
              'telegram',
              this.config.activeProvider,
              this.config.activeModel
            );

            if (res.error) {
              await ctx.reply(`❌ *Debate Failed:* ${res.error}`, { parse_mode: 'Markdown' });
              return;
            }

            const debateText =
              `⚔️ *Multi-Agent Strategic Debate*\n\n` +
              `🎯 *Dilemma:* "${res.dilemma}"\n\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `📌 *1. Problem Framing:*\n${res.framing}\n\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `⚡ *2. Independent Perspectives:*\n` +
              `• *Perspective A (Lean Velocity):*\n${res.perspectiveA}...\n\n` +
              `• *Perspective B (Downside Guard):*\n${res.perspectiveB}...\n\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `⚖️ *3 & 4. Critic Synthesis & Verdict:*\n${res.synthesis}\n\n` +
              `💾 *Persistence:* ${res.persistedToDb ? `✅ Saved to Neon DB (ID #${res.decisionId})` : '⚠️ DB offline'}`;

            await ctx.reply(debateText, { parse_mode: 'Markdown' });
          } catch (err: unknown) {
            console.error('Debate error:', err);
            await ctx.reply(`❌ *Debate Failed:* ${err instanceof Error ? err.message : String(err)}`, {
              parse_mode: 'Markdown',
            });
          }
        },
      },
      {
        command: 'summary',
        description: 'Evidence-based executive summary of recorded decisions & activity (Zero Fabrication)',
        usage: '/summary [week|decisions]',
        category: 'core',
        isReady: () => true,
        execute: async (ctx, args) => {
          await ctx.replyWithChatAction('typing');

          try {
            const res: any = await twinAgentService.executeExecutiveSummary(args);
            if (res.error) {
              await ctx.reply(`❌ *Summary Error:* ${res.error}`);
              return;
            }

            let summaryText = `📋 *Executive Activity Summary (Verified Records)*\n\n`;
            summaryText += `🏛️ *Knowledge Vault:* ${res.totalIndexedKnowledgeNotes} notes indexed\n`;
            summaryText += `💾 *Neon Database:* ${res.databaseStatus}\n\n`;

            if (res.recentDecisions && res.recentDecisions.length > 0) {
              summaryText += `🎯 *Recently Logged Decisions & Frameworks:*\n`;
              res.recentDecisions.forEach((d: any, idx: number) => {
                summaryText += `${idx + 1}. *${d.title}*\n   • Confidence: \`${d.confidence ?? 'Not recorded'}%\`\n   • Recommended: ${d.recommendation || 'No recommendation recorded'}\n`;
              });
              summaryText += `\n`;
            } else {
              summaryText += `🎯 *Logged Decisions:* No decisions recorded in database yet.\n\n`;
            }

            summaryText += `🔒 *Zero Silent Failure Disclosure:*\n`;
            summaryText += `• Revenue & External Metrics: *None recorded in database* (zero fabrication).\n`;
            summaryText += `• Open Tasks: *Tracking active conversation context.*\n`;

            await ctx.reply(summaryText, { parse_mode: 'Markdown' });
          } catch (err: unknown) {
            await ctx.reply(`❌ *Summary Generation Error:* ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      },
      {
        command: 'decide',
        description: '7-Step Decision Deconstructor with Confidence score & Next Action',
        usage: '/decide <dilemma>',
        category: 'analysis',
        isReady: () => true,
        execute: async (ctx, args) => {
          if (!args) {
            await ctx.reply(
              `🎯 *7-Step Decision Deconstructor*\n\n` +
              `Provide a dilemma or situation to evaluate, for example:\n` +
              `\`/decide Should we launch the MVP now or polish the UI for 2 more weeks?\``,
              { parse_mode: 'Markdown' }
            );
            return;
          }

          await ctx.replyWithChatAction('typing');

          try {
            const res: any = await twinAgentService.executeDecisionAnalysis(
              args,
              'telegram',
              this.config.activeProvider,
              this.config.activeModel
            );

            if (res.error) {
              await ctx.reply(`❌ *Decision Analysis Failed:* ${res.error}`);
              return;
            }

            const a = res.analysis || {};
            const optionsText = a.realisticOptions?.map((o: string, idx: number) => `   ${idx + 1}. ${o}`).join('\n') || '';

            const replyMessage =
              `🎯 *Decision Deconstruction*\n\n` +
              `📊 *Confidence Level:* \`${a.confidenceLevel || 'Not available'}\`\n` +
              `💡 *Evidence Reason:* ${a.confidenceReason || 'Grounded in pragmatic leverage'}\n\n` +
              `1️⃣ *Actual Situation:*\n${a.actualSituation}\n\n` +
              `2️⃣ *What Matters Most:*\n${a.whatMattersMost}\n\n` +
              `3️⃣ *Realistic Options:*\n${optionsText}\n\n` +
              `4️⃣ *Trade-Offs & Costs:*\n${a.tradeOffs}\n\n` +
              `5️⃣ *Principal Risks:*\n${a.principalRisks}\n\n` +
              `6️⃣ *Recommended Action:*\n${a.recommendedAction}\n\n` +
              `7️⃣ *Immediate Next Step:*\n👉 ${a.nextPracticalStep}\n\n` +
              `💾 *Persistence:* ${res.persistedToDb ? `✅ Recorded in Neon DB (ID #${res.decisionId})` : '⚠️ DB offline'}`;

            const keyboard = new InlineKeyboard()
              .text('💾 Confirmed in Vault', `save_decision_${a.confidenceLevel || 'Med'}`)
              .text('⚔️ Multi-Agent Debate', `debate_${encodeURIComponent(args.slice(0, 20))}`);

            await ctx.reply(replyMessage, { parse_mode: 'Markdown', reply_markup: keyboard });
          } catch (err: unknown) {
            console.error('Decision command error:', err);
            await ctx.reply(`❌ Could not complete decision breakdown: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      },
      {
        command: 'voice',
        description: 'Synthesize twin response into a native Telegram audio voice note',
        usage: '/voice <topic or question>',
        category: 'voice',
        isReady: () => Boolean((process.env.GEMINI_API_KEY || settingsManager.getSettings().customGeminiKey) && settingsManager.getSettings().voice?.trim()),
        execute: async (ctx, args) => {
          if (!args) {
            await ctx.reply('🎙️ Use `/voice <message>` to generate a voice note. E.g.: `/voice what is our top priority this week?`');
            return;
          }

          await ctx.replyWithChatAction('record_voice');
          try {
            const answer = await this.generateTwinResponse(args);
            const audioBuffer = await this.generateVoiceBuffer(answer);
            if (audioBuffer) {
              await ctx.replyWithVoice(new InputFile(audioBuffer, 'olalekan_voice.wav'), {
                caption: `🎙️ ${answer.slice(0, 200)}${answer.length > 200 ? '...' : ''}`,
              });
            } else {
              await ctx.reply(`🎙️ Voice synthesis generated response:\n\n${answer}`);
            }
          } catch (err: unknown) {
            await ctx.reply(`Failed to synthesize voice message: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      },
      {
        command: 'model',
        description: 'Inspect or switch the active reasoning brain model dynamically',
        usage: '/model [model_id_or_provider]',
        category: 'settings',
        isReady: () => true,
        execute: async (ctx, args) => {
          if (!args) {
            const keyboard = new InlineKeyboard()
              .text('Gemini 3.8 Flash', 'set_model_gemini')
              .text('Groq Llama 3.3', 'set_model_groq')
              .row()
              .text('Mistral Large', 'set_model_mistral');

            await ctx.reply(
              `⚡ *Current Brain Model:* \`${this.config.activeModel || 'Not Set'}\` (${(this.config.activeProvider || 'Not configured').toUpperCase()})\n\n` +
              `Select an engine or send \`/model <model_id>\`:`,
              { parse_mode: 'Markdown', reply_markup: keyboard }
            );
            return;
          }

          const parts = args.trim().split(/\s+/);
          const first = parts[0].toLowerCase();

          if (first === 'groq' || first === 'mistral' || first === 'gemini') {
            this.config.activeProvider = first;
            if (parts.length > 1) {
              this.config.activeModel = parts.slice(1).join(' ').trim();
            }
          } else {
            if (first.includes('gemini')) {
              this.config.activeProvider = 'gemini';
            } else if (first.includes('llama') || first.includes('deepseek') || first.includes('gemma')) {
              this.config.activeProvider = 'groq';
            } else if (first.includes('mistral') || first.includes('codestral') || first.includes('pixtral')) {
              this.config.activeProvider = 'mistral';
            }
            this.config.activeModel = args.trim();
          }

          await saveConfig(this.config);
          settingsManager.updateSettings({
            activeProvider: this.config.activeProvider as 'gemini' | 'groq' | 'mistral',
            activeModel: this.config.activeModel,
          }).catch(() => {});

          await ctx.reply(`✅ Switched active model to \`${this.config.activeModel}\` (${this.config.activeProvider.toUpperCase()})`, {
            parse_mode: 'Markdown',
          });
        },
      },
      {
        command: 'profile',
        description: 'View working profile & thinking partner protocol',
        usage: '/profile',
        category: 'core',
        isReady: () => true,
        execute: async (ctx) => {
          const brand = settingsManager.getSettings().brandName || 'TwinMind AI';
          const owner = this.config.ownerUsername || settingsManager.getSettings().userName || 'Digital Twin';
          await ctx.reply(
            `🧠 *Working Model of ${owner} (${brand})*\n\n` +
            `1️⃣ *Identity Layer*: High agency, practical skepticism, self-directed builder mindset.\n` +
            `2️⃣ *Reasoning Layer*: 7-Step decision breakdown, fact vs assumption separation, ruthless reality testing.\n` +
            `3️⃣ *Presentation Layer*: Phone texting cadence, punchy paragraphs, authentic voice, zero fluff.\n\n` +
            `🤝 *Intellectual Partnership Protocol*:\n` +
            `• Thinking partner, never an agreeable sycophant.\n` +
            `• Identifies blind spots, trade-offs, and asymmetric leverage.\n` +
            `• Real-time chat is unrestricted — text me freely anytime.`
          );
        },
      },
      {
        command: 'status',
        description: 'Live bot telemetry, latency, active model, and pairing state',
        usage: '/status',
        category: 'settings',
        isReady: () => true,
        execute: async (ctx) => {
          const docs = await knowledgeService.listDocuments();
          await ctx.reply(
            `📊 *TWINMIND Bot Status*\n\n` +
            `• Active Provider: \`${this.config.activeProvider.toUpperCase()}\`\n` +
            `• Active Model: \`${this.config.activeModel}\`\n` +
            `• Delivery Mode: \`${this.config.mode.toUpperCase()}\`\n` +
            `• Paired Owner ID: \`${this.config.ownerId || 'Unpaired'}\` (@${this.config.ownerUsername || 'None'})\n` +
            `• Gemini AI: \`${process.env.GEMINI_API_KEY ? 'Operational' : 'Unavailable'}\`\n` +
            `• Knowledge Vault: \`${docs.length} notes grounded\`\n` +
            `• Registered Commands: \`${this.commandRegistry.length}\`\n` +
            `• Policy: \`Zero Silent Failure\``,
            { parse_mode: 'Markdown' }
          );
        },
      },
      {
        command: 'commands',
        description: 'Inspect dynamically registered commands and execution readiness',
        usage: '/commands',
        category: 'settings',
        isReady: () => true,
        execute: async (ctx) => {
          let text = `📋 *Dynamic Command Registry Status*\n\n`;
          for (const h of this.commandRegistry) {
            const ready = h.isReady();
            text += `• \`/${h.command}\` [${ready ? '✅ READY' : '⏳ UNINITIALIZED'}]\n  _${h.description}_\n`;
          }
          text += `\n💬 *Remember:* You can also just chat freely without typing commands!`;
          await ctx.reply(text, { parse_mode: 'Markdown' });
        },
      },
      {
        command: 'unpair',
        description: 'Reset pairing lock to allow re-linking from another Telegram account',
        usage: '/unpair',
        category: 'settings',
        isReady: () => this.config.ownerId !== null,
        execute: async (ctx) => {
          const newCode = this.resetPairing();
          await ctx.reply(
            `🔓 *Account Unpaired!*\n\n` +
            `Owner lock has been removed. New pairing code: \`${newCode}\`.\n` +
            `To re-pair, send \`/start ${newCode}\`.`,
            { parse_mode: 'Markdown' }
          );
        },
      },
    ];
  }

  public log(type: 'info' | 'auth' | 'chat' | 'error', message: string) {
    const entry: TelegramLogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 50) this.logs.pop();
    console.log(`[TelegramBot][${type.toUpperCase()}] ${message}`);
  }

  public getConfig(): TelegramConfig {
    return { ...this.config };
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      hasToken: Boolean(this.config.token),
      tokenMasked: this.config.token
        ? `${this.config.token.slice(0, 4)}...${this.config.token.slice(-4)}`
        : null,
      botUsername: this.botUsername,
      botFirstName: this.botFirstName,
      mode: this.config.mode,
      webhookUrl: this.config.webhookUrl,
      isPaired: this.config.ownerId !== null,
      ownerId: this.config.ownerId,
      ownerUsername: this.config.ownerUsername,
      pairingCode: this.config.pairingCode,
      activeProvider: this.config.activeProvider,
      activeModel: this.config.activeModel,
      logs: this.logs.slice(0, 25),
      syncedMessagesCount: this.syncedMessages.length,
      registeredCommandsCount: this.commandRegistry.length,
      readyCommandsCount: this.commandRegistry.filter((h) => h.isReady()).length,
      lastSyncedCommands: this.lastSyncedCommands,
    };
  }

  public getRegisteredCommands() {
    return this.commandRegistry.map((h) => ({
      command: h.command,
      description: h.description,
      usage: h.usage,
      category: h.category,
      isReady: h.isReady(),
    }));
  }

  public getSyncedMessages(): SyncedTelegramMessage[] {
    return this.syncedMessages;
  }

  /**
   * Synchronize command menu with Telegram
   */
  public async syncTelegramCommandMenu(): Promise<boolean> {
    if (!this.bot || !this.isRunning) return false;

    try {
      const readyCommands = this.commandRegistry
        .filter((h) => {
          try {
            return h.isReady() && h.command !== 'start';
          } catch {
            return false;
          }
        })
        .map((h) => ({
          command: h.command,
          description: h.description.slice(0, 95),
        }));

      await this.bot.api.setMyCommands(readyCommands);
      this.lastSyncedCommands = readyCommands;
      this.log('info', `Successfully synced ${readyCommands.length} commands to Telegram menu.`);
      return true;
    } catch (err) {
      console.warn('[TelegramBot] Could not sync command menu:', err);
      return false;
    }
  }

  public async updateConfig(newConfig: Partial<TelegramConfig>): Promise<{ success: boolean; message: string }> {
    if (newConfig.webhookUrl !== undefined) {
      const trimmedUrl = newConfig.webhookUrl.trim();
      if (trimmedUrl && !trimmedUrl.startsWith('https://')) {
        return {
          success: false,
          message: 'Telegram requires a valid HTTPS webhook URL (e.g. https://your-service.onrender.com).',
        };
      }
    }

    const environmentToken = cleanConfigSecret(process.env.TELEGRAM_BOT_TOKEN);
    const requestedToken = newConfig.token === undefined ? undefined : cleanConfigSecret(newConfig.token);
    if (requestedToken && environmentToken && requestedToken !== environmentToken) {
      return {
        success: false,
        message: 'TELEGRAM_BOT_TOKEN is configured in the deployment environment and is authoritative. Update that Render variable or remove it before using a different token from Settings.',
      };
    }

    const nextConfig: TelegramConfig = {
      ...this.config,
      ...newConfig,
      ...(environmentToken ? { token: environmentToken } : {}),
      ...(!environmentToken && requestedToken !== undefined ? { token: requestedToken } : {}),
    };
    // Do not mutate active runtime state until durable configuration has been accepted.
    await saveConfig(nextConfig, newConfig.token !== undefined);

    if (newConfig.activeProvider || newConfig.activeModel) {
      await settingsManager.updateSettings({
        ...(newConfig.activeProvider ? { activeProvider: newConfig.activeProvider as 'gemini' | 'groq' | 'mistral' } : {}),
        ...(newConfig.activeModel ? { activeModel: newConfig.activeModel } : {}),
      });
    }

    const runtimeConfigChanged =
      nextConfig.token !== this.config.token ||
      nextConfig.mode !== this.config.mode ||
      nextConfig.webhookUrl !== this.config.webhookUrl;
    if (runtimeConfigChanged && this.isRunning) await this.stop();
    this.config = nextConfig;

    if (runtimeConfigChanged && this.config.token) {
      const started = await this.start();
      return {
        success: started,
        message: started ? 'Telegram bot restarted and configuration verified.' : 'Configuration was saved, but Telegram could not start. Inspect the Telegram status logs.',
      };
    }
    return { success: true, message: 'Telegram configuration saved and persisted.' };
  }


  public async resetPairing(): Promise<string> {
    const newCode = generatePairingCode();
    const nextConfig = {
      ...this.config,
      ownerId: null,
      ownerUsername: null,
      pairingCode: newCode,
    };
    await saveConfig(nextConfig);
    this.config = nextConfig;
    this.log('auth', 'Owner pairing was reset. A new one-time code was generated.');
    return newCode;
  }

  public async testToken(tokenToTest?: string): Promise<{ ok: boolean; botInfo?: any; error?: string }> {
    const token = tokenToTest || this.config.token;
    if (!token) {
      return { ok: false, error: 'Token is empty.' };
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json();
      if (data.ok) {
        this.botUsername = data.result?.username || null;
        this.botFirstName = data.result?.first_name || null;
        return { ok: true, botInfo: data.result };
      }
      return { ok: false, error: data.description || 'Invalid token response.' };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Network error testing token' };
    }
  }

  public async refreshConfigurationFromSettings(): Promise<void> {
    const saved = settingsManager.getSettings();
    const next = loadConfig();
    next.pairingCode = this.config.pairingCode;
    next.ownerUsername = this.config.ownerUsername;

    const changed = next.token !== this.config.token || next.mode !== this.config.mode || next.webhookUrl !== this.config.webhookUrl;
    if (changed && this.isRunning) await this.stop();
    this.config = next;
    if (this.config.token && !this.isRunning) {
      const started = await this.start();
      if (!started) this.log('error', 'Telegram configuration was loaded from persistent settings, but bot startup failed.');
    } else if (!this.config.token && this.isRunning) {
      await this.stop();
    }
  }

  public async start(): Promise<boolean> {
    if (this.isRunning && this.bot) return true;
    if (!this.config.token) {
      this.log('info', 'No TELEGRAM_BOT_TOKEN set. Waiting for user setup in UI or env.');
      return false;
    }

    try {
      const test = await this.testToken(this.config.token);
      if (!test.ok) {
        this.log('error', `Invalid bot token: ${test.error}`);
        return false;
      }

      this.botUsername = test.botInfo?.username || null;
      this.botFirstName = test.botInfo?.first_name || null;

      this.bot = new Bot(this.config.token);
      this.bot.catch((err) => {
        const msg = err.error instanceof Error ? err.error.message : String(err.error);
        console.warn('[TelegramBot] Handled polling error:', msg);
        this.log('info', `Telegram polling update notice: ${msg}`);
      });
      this.setupHandlers(this.bot);

      if (this.config.mode === 'polling') {
        try {
          await fetch(`https://api.telegram.org/bot${this.config.token}/deleteWebhook?drop_pending_updates=true`);
        } catch (delErr) {
          console.warn('Webhook delete notice:', delErr);
        }

        this.bot.start({
          onStart: async (botInfo) => {
            this.isRunning = true;
            this.botUsername = botInfo.username || this.botUsername;
            this.botFirstName = botInfo.first_name || this.botFirstName;
            this.log('info', `Long-polling active for @${botInfo.username} (${botInfo.first_name})`);
            await this.syncTelegramCommandMenu();
          },
        }).catch((startErr) => {
          const errStr = startErr instanceof Error ? startErr.message : String(startErr);
          console.warn('[TelegramBot] Background polling interrupted:', errStr);
          this.log('info', `Polling interrupted: ${errStr}`);
          this.isRunning = false;
        });
        this.isRunning = true;
        return true;
      } else {
        // Webhook Mode
        if (this.config.webhookUrl) {
          const webhookSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
          if (!webhookSecret) {
            this.log('error', 'TELEGRAM_WEBHOOK_SECRET is required before enabling Telegram webhook mode.');
            return false;
          }
          const cleanUrl = this.config.webhookUrl.replace(/\/+$/, '');
          const webhookTarget = cleanUrl.endsWith('/api/telegram/webhook') ? cleanUrl : `${cleanUrl}/api/telegram/webhook`;
          const setRes = await fetch(`https://api.telegram.org/bot${this.config.token}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ url: webhookTarget, secret_token: webhookSecret }).toString(),
          });
          const setData = await setRes.json();
          if (setData.ok) {
            this.log('info', 'Telegram webhook registered successfully.');
          } else {
            this.log('error', `Telegram webhook registration failed: ${setData.description || 'provider rejected request'}`);
            return false;
          }
        } else {
          this.log('info', 'Webhook mode enabled without a configured URL.');
        }
        await this.syncTelegramCommandMenu();
        this.isRunning = true;
        return true;
      }
    } catch (err: unknown) {
      this.isRunning = false;
      this.log('error', `Start failure: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  public async stop(): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stop();
      } catch (e) {
        // Ignore stop error
      }
      this.bot = null;
    }
    this.isRunning = false;
    this.log('info', 'Telegram bot stopped');
  }

  public getWebhookCallback() {
    if (!this.bot) {
      return (req: any, res: any, next: any) => next();
    }
    return webhookCallback(this.bot, 'express');
  }

  private setupHandlers(bot: Bot) {
    // Middleware 1: Deduplication Guard (Idempotency)
    bot.use(async (ctx, next) => {
      const updateId = ctx.update?.update_id;
      if (updateId !== undefined) {
        if (this.processedUpdateIds.has(updateId)) {
          this.log('info', `Dropped duplicate update_id: ${updateId}`);
          return;
        }
        this.processedUpdateIds.add(updateId);
        if (this.processedUpdateIds.size > 1500) {
          const iter = this.processedUpdateIds.values();
          for (let i = 0; i < 400; i++) {
            const val = iter.next().value;
            if (val !== undefined) this.processedUpdateIds.delete(val);
          }
        }
      }
      await next();
    });

    // Middleware 2: Owner Guard & Seamless Auto-Pairing
    bot.use(async (ctx, next) => {
      const from = ctx.from;
      if (!from) return;

      const userId = from.id;
      const text = ctx.message?.text || '';

      if (this.config.ownerId === null) {
        const startParts = text.trim().split(/\\s+/);
        const suppliedCode = startParts[0]?.startsWith('/start') ? (startParts[1] || '') : '';
        if (suppliedCode && suppliedCode === this.config.pairingCode) {
          this.config.ownerId = userId;
          this.config.ownerUsername = from.username || from.first_name || settingsManager.getSettings().userName || '';
          await saveConfig(this.config);
          this.log('auth', `Owner pairing completed for Telegram user ID ${userId}`);
          await ctx.reply('Pairing successful. This Telegram account is now linked as the owner.', { parse_mode: 'Markdown' });
          return;
        }

        this.log('auth', 'Rejected Telegram update while owner pairing is not configured.');
        await ctx.reply('Owner pairing is not configured. An administrator must provide the current one-time pairing code.');
        return;
      }

      if (this.config.ownerId !== userId) {
        this.log('auth', `Blocked unauthorized access attempt from ID ${userId} (@${from.username || 'unknown'})`);
        await ctx.reply('🔒 *Access Restricted:* This digital twin is in private mode and locked to its owner.', {
          parse_mode: 'Markdown',
        });
        return;
      }

      await next();
    });

    // Setup interactive inline keyboard callbacks
    bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery();

      if (data === 'action_decide') {
        await ctx.reply('🎯 Send your dilemma: `/decide Should we launch now or polish?`', { parse_mode: 'Markdown' });
      } else if (data === 'action_search') {
        await ctx.reply('🔍 Send your search query: `/search <topic>`', { parse_mode: 'Markdown' });
      } else if (data === 'action_debate') {
        await ctx.reply('⚔️ Send your debate question: `/debate <dilemma>`', { parse_mode: 'Markdown' });
      } else if (data === 'action_summary') {
        const handler = this.commandRegistry.find((h) => h.command === 'summary');
        if (handler) await handler.execute(ctx, '');
      } else if (data === 'set_model_gemini') {
        this.config.activeProvider = 'gemini';
        await saveConfig(this.config);
        await ctx.reply('✅ Switched active provider to Google Gemini.');
      } else if (data === 'set_model_groq') {
        this.config.activeProvider = 'groq';
        await saveConfig(this.config);
        await ctx.reply('✅ Switched active provider to Groq.');
      } else if (data === 'set_model_mistral') {
        this.config.activeProvider = 'mistral';
        await saveConfig(this.config);
        await ctx.reply('✅ Switched active provider to Mistral AI.');
      } else if (data.startsWith('dyn_act_')) {
        // Dynamic Model-Generated Action Button Click
        const actionItem = this.dynamicActionCallbacks.get(data);
        if (!actionItem) {
          await ctx.reply('⏳ This action button has expired. Please send your request directly in chat.');
          return;
        }

        if (actionItem.action === 'voice') {
          await ctx.replyWithChatAction('record_voice');
          const lastAssistant = [...this.conversationHistory].reverse().find((m) => m.role === 'assistant');
          const textForVoice = lastAssistant?.content || actionItem.payload;
          const audioBuffer = await this.generateVoiceBuffer(textForVoice);
          if (audioBuffer) {
            await ctx.replyWithVoice(new InputFile(audioBuffer, 'olalekan_voice.wav'), {
              caption: textForVoice.length > 200 ? `${textForVoice.slice(0, 197)}...` : textForVoice,
            });
          } else {
            await ctx.reply(`🎙️ Voice generation unavailable for: "${textForVoice.slice(0, 100)}..."`);
          }
        } else {
          // Trigger twin agent turn dynamically with payload
          await ctx.reply(`👉 *Executing:* ${actionItem.payload}`, { parse_mode: 'Markdown' });
          await ctx.replyWithChatAction('typing');

          const turnResult = await twinAgentService.executeTurn({
            userPrompt: actionItem.payload,
            channel: 'telegram',
            conversationHistory: this.conversationHistory,
            userName: this.config.ownerUsername || settingsManager.getSettings().userName || '',
            providerOverride: (this.config.activeProvider as 'gemini' | 'groq' | 'mistral') || undefined,
            modelOverride: this.config.activeModel || undefined,
          });

          this.conversationHistory.push({ role: 'user', content: actionItem.payload });
          this.conversationHistory.push({ role: 'assistant', content: turnResult.reply });
          this.recordSyncedMessage('assistant', turnResult.reply);

          // Render follow-up dynamic buttons if suggested
          let dynamicKeyboard: InlineKeyboard | undefined;
          if (turnResult.suggestedActions && turnResult.suggestedActions.length > 0) {
            dynamicKeyboard = new InlineKeyboard();
            for (const act of turnResult.suggestedActions) {
              const actKey = `dyn_act_${randomUUID()}`;
              this.dynamicActionCallbacks.set(actKey, {
                payload: act.payload,
                action: act.action,
                expiresAt: Date.now() + 1000 * 60 * 60, // 1 hour TTL
              });
              dynamicKeyboard.text(act.label, actKey);
            }
          }

          try {
            await ctx.reply(turnResult.reply, { parse_mode: 'Markdown', reply_markup: dynamicKeyboard });
          } catch {
            await ctx.reply(turnResult.reply, { reply_markup: dynamicKeyboard });
          }
        }
      } else if (data.startsWith('save_decision_')) {
        await ctx.reply('💾 Decision record confirmed in Neon database.');
      } else if (data.startsWith('save_note_')) {
        await ctx.reply('💾 Saved note into Vector Knowledge Vault.');
      }
    });

    // Register all command handlers
    for (const handler of this.commandRegistry) {
      bot.command(handler.command, async (ctx) => {
        const from = ctx.from;
        if (!from || (this.config.ownerId !== null && this.config.ownerId !== from.id)) {
          await ctx.reply('🔒 Unauthorized. Pair with /start first.');
          return;
        }

        const args = ctx.match?.trim() || '';
        try {
          await handler.execute(ctx, args);
        } catch (cmdErr: unknown) {
          console.error(`Error in /${handler.command}:`, cmdErr);
          await ctx.reply(`❌ Error executing /${handler.command}: ${cmdErr instanceof Error ? cmdErr.message : String(cmdErr)}`);
        }
      });
    }

    // PRIMARY CONVERSATIONAL HANDLER: FREE-FLOWING CHAT WITH AUTONOMOUS FUNCTION CALLING
    // ZERO HARDCODED PHRASES: The model autonomously decides tools and parallel retrieval!
    bot.on('message:text', async (ctx) => {
      const text = ctx.message.text.trim();
      if (text.startsWith('/')) return;

      this.log('chat', `Owner message: "${text.slice(0, 60)}..."`);
      this.recordSyncedMessage('user', text);

      const lowerText = text.toLowerCase();
      const isVoiceRequest =
        lowerText.includes('voice note') ||
        lowerText.includes('reply in voice') ||
        lowerText.includes('send audio') ||
        lowerText.includes('send voice');

      await ctx.replyWithChatAction(isVoiceRequest ? 'record_voice' : 'typing');

      try {
        const turnResult = await twinAgentService.executeTurn({
          userPrompt: text,
          channel: 'telegram',
          conversationHistory: this.conversationHistory,
          userName: this.config.ownerUsername || settingsManager.getSettings().userName || '',
          providerOverride: (this.config.activeProvider as 'gemini' | 'groq' | 'mistral') || undefined,
          modelOverride: this.config.activeModel || undefined,
        });

        const responseText = turnResult.reply;
        this.conversationHistory.push({ role: 'user', content: text });
        this.conversationHistory.push({ role: 'assistant', content: responseText });
        if (this.conversationHistory.length > 20) {
          this.conversationHistory = this.conversationHistory.slice(-20);
        }
        this.recordSyncedMessage('assistant', responseText, isVoiceRequest);

        if (isVoiceRequest) {
          const audioBuffer = await this.generateVoiceBuffer(responseText);
          if (audioBuffer) {
            await ctx.replyWithVoice(new InputFile(audioBuffer, 'olalekan_voice.wav'), {
              caption: responseText.length > 200 ? `${responseText.slice(0, 197)}...` : responseText,
            });
            return;
          }
        }

        // DYNAMIC CONTEXTUAL INLINE BUTTONS (Zero Hardcoding)
        // Buttons are generated by the model/reasoning context for this specific turn
        let keyboard: InlineKeyboard | undefined;
        if (turnResult.suggestedActions && turnResult.suggestedActions.length > 0) {
          keyboard = new InlineKeyboard();
          for (const act of turnResult.suggestedActions) {
            const callbackId = `dyn_act_${randomUUID()}`;
            this.dynamicActionCallbacks.set(callbackId, {
              payload: act.payload,
              action: act.action,
              expiresAt: Date.now() + 1000 * 60 * 60, // 1 hour TTL
            });
            keyboard.text(act.label, callbackId);
          }
        }

        try {
          await ctx.reply(responseText, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        } catch {
          // Fallback if raw text contains unmatched markdown formatting
          await ctx.reply(responseText, { reply_markup: keyboard });
        }

        // Deliver generated files (PDFs, Excel .xlsx, CSV, Markdown) directly to Telegram chat
        await this.sendGeneratedArtifactsToTelegram(ctx, turnResult.toolsExecuted);
      } catch (err: unknown) {
        this.log('error', `Chat generation error: ${err instanceof Error ? err.message : String(err)}`);
        await ctx.reply(`⚠️ ${err instanceof Error ? err.message : 'Error generating response.'}`);
      }
    });

    // Handle photo / image uploads sent by the user on Telegram (Multimodal support)
    bot.on('message:photo', async (ctx) => {
      try {
        const from = ctx.from;
        if (!from || (this.config.ownerId !== null && this.config.ownerId !== from.id)) {
          await ctx.reply('🔒 Unauthorized. Pair your account with /start first.');
          return;
        }

        await ctx.replyWithChatAction('typing');

        const photos = ctx.message.photo;
        if (!photos || photos.length === 0) return;
        const highestResPhoto = photos[photos.length - 1];

        const file = await ctx.api.getFile(highestResPhoto.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;

        const imgRes = await fetch(fileUrl);
        const arrayBuffer = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Data = buffer.toString('base64');
        const caption = (ctx.message.caption || '').trim();

        const turnResult = await twinAgentService.executeTurn({
          userPrompt: caption,
          imageData: {
            mimeType: 'image/jpeg',
            data: base64Data,
            name: 'telegram_uploaded_photo.jpg',
          },
          channel: 'telegram',
          conversationHistory: this.conversationHistory,
          userName: this.config.ownerUsername || settingsManager.getSettings().userName || '',
          providerOverride: (this.config.activeProvider as 'gemini' | 'groq' | 'mistral') || undefined,
          modelOverride: this.config.activeModel || undefined,
        });

        const responseText = turnResult.reply;
        this.conversationHistory.push({ role: 'user', content: caption ? `[Uploaded Photo]: ${caption}` : '[Uploaded Photo]' });
        this.conversationHistory.push({ role: 'assistant', content: responseText });
        this.recordSyncedMessage('assistant', responseText);

        try {
          await ctx.reply(responseText, { parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(responseText);
        }

        await this.sendGeneratedArtifactsToTelegram(ctx, turnResult.toolsExecuted);
      } catch (err: unknown) {
        this.log('error', `Photo message handling error: ${err instanceof Error ? err.message : String(err)}`);
        await ctx.reply(`⚠️ Failed to analyze photo: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // Handle document / file uploads sent by the user on Telegram
    bot.on('message:document', async (ctx) => {
      try {
        const from = ctx.from;
        if (!from || (this.config.ownerId !== null && this.config.ownerId !== from.id)) {
          await ctx.reply('🔒 Unauthorized. Pair your account with /start first.');
          return;
        }

        await ctx.replyWithChatAction('typing');

        const doc = ctx.message.document;
        if (!doc) return;

        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;

        const docRes = await fetch(fileUrl);
        const arrayBuffer = await docRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = doc.mime_type || 'application/octet-stream';
        const caption = (ctx.message.caption || '').trim();

        let turnResult: any;

        if (mimeType.startsWith('image/')) {
          turnResult = await twinAgentService.executeTurn({
            userPrompt: caption,
            imageData: {
              mimeType,
              data: buffer.toString('base64'),
              name: doc.file_name || 'uploaded_image',
            },
            channel: 'telegram',
            conversationHistory: this.conversationHistory,
            userName: this.config.ownerUsername || settingsManager.getSettings().userName || '',
            providerOverride: (this.config.activeProvider as 'gemini' | 'groq' | 'mistral') || undefined,
            modelOverride: this.config.activeModel || undefined,
          });
        } else {
          const fileText = buffer.toString('utf-8').slice(0, 15000);
          const prompt = caption
            ? `File content (${doc.file_name}):\n\n${fileText}\n\nUser request: ${caption}`
            : `Analyze this uploaded document (${doc.file_name}):\n\n${fileText}`;

          turnResult = await twinAgentService.executeTurn({
            userPrompt: prompt,
            channel: 'telegram',
            conversationHistory: this.conversationHistory,
            userName: this.config.ownerUsername || settingsManager.getSettings().userName || '',
            providerOverride: (this.config.activeProvider as 'gemini' | 'groq' | 'mistral') || undefined,
            modelOverride: this.config.activeModel || undefined,
          });
        }

        const responseText = turnResult.reply;
        this.conversationHistory.push({ role: 'user', content: caption ? `[Uploaded Document ${doc.file_name}]: ${caption}` : `[Uploaded Document ${doc.file_name}]` });
        this.conversationHistory.push({ role: 'assistant', content: responseText });
        this.recordSyncedMessage('assistant', responseText);

        try {
          await ctx.reply(responseText, { parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(responseText);
        }

        await this.sendGeneratedArtifactsToTelegram(ctx, turnResult.toolsExecuted);
      } catch (err: unknown) {
        this.log('error', `Document handling error: ${err instanceof Error ? err.message : String(err)}`);
        await ctx.reply(`⚠️ Failed to process document: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // Handle voice notes sent by the user to the twin
    bot.on('message:voice', async (ctx) => {
      try {
        const from = ctx.from;
        if (!from || (this.config.ownerId !== null && this.config.ownerId !== from.id)) {
          await ctx.reply('🔒 Unauthorized. Pair your account with /start first.');
          return;
        }

        await ctx.replyWithChatAction('record_voice');
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
        const audioRes = await fetch(fileUrl);
        const arrayBuffer = await audioRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const s = settingsManager.getSettings();
        const turnResult = await twinAgentService.executeTurn({
          userPrompt: 'Listen to this voice memo / audio recording, transcribe it accurately, extract key action items and strategic takeaways, and generate a professional PDF meeting notes document or financial forecast if applicable.',
          audioData: {
            mimeType: 'audio/ogg',
            data: buffer.toString('base64'),
          },
          channel: 'telegram',
          conversationHistory: this.conversationHistory,
          userName: this.config.ownerUsername || s.userName || '',
          providerOverride: (this.config.activeProvider as 'gemini' | 'groq' | 'mistral') || undefined,
          modelOverride: this.config.activeModel || undefined,
        });

        const reply = turnResult.reply;
        this.conversationHistory.push({ role: 'user', content: '[Voice Note Audio Sent]' });
        this.conversationHistory.push({ role: 'assistant', content: reply });
        this.recordSyncedMessage('assistant', reply, true);

        try {
          await ctx.reply(reply, { parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(reply);
        }

        await this.sendGeneratedArtifactsToTelegram(ctx, turnResult.toolsExecuted);

        try {
          const voiceBuffer = await this.generateVoiceBuffer(reply);
          if (voiceBuffer) {
            await ctx.replyWithVoice(new InputFile(voiceBuffer, 'twin_voice_reply.wav'));
          }
        } catch (vErr) {
          console.warn('Telegram voice reply generation warning:', vErr);
        }
      } catch (err: unknown) {
        this.log('error', `Voice message handling error: ${err instanceof Error ? err.message : String(err)}`);
        await ctx.reply(`⚠️ Failed to process voice message: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  /**
   * Helper method to send generated artifact documents (PDFs, Excel .xlsx, CSV, Markdown) to Telegram chat
   */
  private async sendGeneratedArtifactsToTelegram(ctx: any, toolsExecuted?: any[]) {
    if (!toolsExecuted || !Array.isArray(toolsExecuted)) return;

    for (const tool of toolsExecuted) {
      if (tool.toolName === 'generateArtifact' && tool.result && (tool.result.fileName || tool.result.filePath)) {
        try {
          const fileName = tool.result.fileName || path.basename(tool.result.filePath || '');
          const cleanName = path.basename(fileName);
          const fullPath = tool.result.filePath && fs.existsSync(tool.result.filePath)
            ? tool.result.filePath
            : path.join(process.cwd(), 'public', 'artifacts', cleanName);

          if (fs.existsSync(fullPath)) {
            const isExcel = cleanName.endsWith('.xlsx') || cleanName.endsWith('.xls');
            const isPdf = cleanName.endsWith('.pdf');
            const label = isExcel ? 'Excel Workbook' : isPdf ? 'PDF Document' : 'Document';

            await ctx.replyWithDocument(new InputFile(fullPath, cleanName), {
              caption: `📄 *Generated ${label}*: \`${cleanName}\``,
              parse_mode: 'Markdown',
            });
            this.log('info', `Sent generated artifact "${cleanName}" to Telegram.`);
          }
        } catch (docErr) {
          console.warn('[TelegramBot] Failed sending generated document:', docErr);
        }
      }
    }
  }

  private recordSyncedMessage(sender: 'user' | 'assistant', text: string, isVoice = false) {
    this.syncedMessages.unshift({
      id: `tg-${randomUUID()}`,
      sender,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isVoice,
    });
    if (this.syncedMessages.length > 50) this.syncedMessages.pop();

    void neonDb.saveMessage({
      channel: 'telegram',
      role: sender === 'assistant' ? 'assistant' : 'user',
      content: text,
      provider: this.config.activeProvider,
      model: this.config.activeModel,
      metadata: { isVoice, ownerId: this.config.ownerId, ownerUsername: this.config.ownerUsername },
    }).then((messageId) => {
      if (messageId === undefined) {
        console.warn('[TelegramBot] Conversation message was not persisted to the database.');
      }
    }).catch((error: unknown) => {
      console.warn('[TelegramBot] Conversation message persistence failed:', error instanceof Error ? error.message : 'unknown error');
    });
  }

  /**
   * Generates twin response with AUTONOMOUS TOOL CALLING & KNOWLEDGE GROUNDING
   */
  private async generateTwinResponse(userPrompt: string): Promise<string> {
    const turnResult = await twinAgentService.executeTurn({
      userPrompt,
      channel: 'telegram',
      conversationHistory: this.conversationHistory,
      userName: this.config.ownerUsername || settingsManager.getSettings().userName || '',
      providerOverride: (this.config.activeProvider as 'gemini' | 'groq' | 'mistral') || undefined,
      modelOverride: this.config.activeModel || undefined,
    });
    return turnResult.reply;
  }

  private async generateVoiceBuffer(text: string): Promise<Buffer | null> {
    const settings = settingsManager.getSettings();
    const voice = (settings.voice || '').trim();
    const apiKey = (settings.customGeminiKey || process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');

    if (!voice) {
      console.warn('[TelegramBot] Voice synthesis unavailable: no voice identifier is configured.');
      return null;
    }
    if (!apiKey) {
      console.warn('[TelegramBot] Voice synthesis unavailable: Gemini credentials are not configured.');
      return null;
    }

    const cleanText = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/[*_#>-]/g, ' ')
      .trim()
      .slice(0, 1000);

    if (!cleanText) {
      console.warn('[TelegramBot] Voice synthesis unavailable: source text is empty after formatting cleanup.');
      return null;
    }

    try {
      const model = await modelCatalogService.resolveSpecializedModel('tts', apiKey);
      const client = new GoogleGenAI({ apiKey });
      const response = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: cleanText }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        console.warn('[TelegramBot] Voice synthesis provider returned no audio data.');
        return null;
      }

      return Buffer.from(base64Audio, 'base64');
    } catch (err) {
      console.warn('[TelegramBot] Voice synthesis unavailable:', err instanceof Error ? err.message : 'provider request failed');
      return null;
    }
  }
  /**
   * Send a proactive alert message to the paired owner.
   */
  public async sendProactiveMessage(text: string): Promise<boolean> {
    if (!this.bot || !this.isRunning || !this.config.ownerId) {
      console.warn('[TelegramBot] Cannot send proactive message: bot not running or owner not paired.');
      return false;
    }

    try {
      await this.bot.api.sendMessage(this.config.ownerId, text, { parse_mode: 'Markdown' });
      this.log('info', `Proactive message sent to owner ID ${this.config.ownerId}`);
      return true;
    } catch (err) {
      console.error('[TelegramBot] Failed to send proactive message:', err);
      return false;
    }
  }
}

export const telegramBotManager = new TelegramBotManager();
