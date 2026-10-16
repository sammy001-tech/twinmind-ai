import { neonDb, type DecisionRecord } from '../db/neonService.ts';
import { settingsManager } from '../db/settingsService.ts';
import { specialistSwarmService } from './specialistSwarmService.ts';
import { twilioService } from './twilioService.ts';
import { telegramBotManager } from '../telegram/telegramService.ts';
import { callWithBoundedRetry } from '../utils/retryHelper.ts';
import { GoogleGenAI } from '@google/genai';
import { modelCatalogService } from './modelCatalogService.ts';

export interface SentinelFinding {
  decisionId: number;
  decisionTitle: string;
  riskDetected: string;
  evidenceSource: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigationSuggestion: string;
}

type SentinelAuditStatus = 'completed' | 'deferred';

interface SentinelAuditResult {
  status: SentinelAuditStatus;
  reason?: string;
}

class AdversarialSentinelService {
  private isScanning = false;
  private readonly batchSize = 15;

  private resolveUsableCredential(...values: Array<string | undefined>): string {
    for (const value of values) {
      const credential = (value || '').trim().replace(/^["']|["']$/g, '');
      if (!credential || credential.includes('...') || credential === '********') continue;
      return credential;
    }
    return '';
  }

  /**
   * Process a deterministic, database-backed batch. Completed items are excluded
   * by persisted audit state; deferred items are eligible for retry after a
   * bounded cooldown. The summary records the actual remaining backlog.
   */
  public async runCognitiveRedTeamScan(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const settings = settingsManager.getSettings();
      const apiKey = this.resolveUsableCredential(settings.customGeminiKey, process.env.GEMINI_API_KEY);
      const pendingBefore = await neonDb.getSentinelPendingDecisionCount();

      if (pendingBefore === null) {
        console.warn('[Sentinel] Scan blocked: durable decision backlog could not be read from the database.');
        return;
      }

      if (pendingBefore === 0) {
        await neonDb.logEvent('sentinel_scan_summary', {
          status: 'idle',
          selected: 0,
          completed: 0,
          deferred: 0,
          pendingRemaining: 0,
        });
        console.log('[Sentinel] No eligible, unaudited decisions remain.');
        return;
      }

      if (!apiKey) {
        await neonDb.logEvent('sentinel_scan_summary', {
          status: 'blocked',
          reason: 'GEMINI_CREDENTIALS_MISSING',
          selected: 0,
          completed: 0,
          deferred: 0,
          pendingRemaining: pendingBefore,
        });
        console.warn(`[Sentinel] Scan blocked: Gemini credentials are not configured. Pending decisions: ${pendingBefore}.`);
        return;
      }

      const batch = await neonDb.getPendingSentinelDecisions(this.batchSize);
      if (batch === null) {
        console.warn('[Sentinel] Scan blocked: pending audit batch could not be read from the database.');
        return;
      }

      if (batch.length === 0) {
        await neonDb.logEvent('sentinel_scan_summary', {
          status: 'deferred_cooldown',
          selected: 0,
          completed: 0,
          deferred: 0,
          pendingRemaining: pendingBefore,
        });
        console.log(`[Sentinel] No batch is eligible during the deferred retry window. Pending decisions: ${pendingBefore}.`);
        return;
      }

      let completed = 0;
      let deferred = 0;

      for (const decision of batch) {
        const result = await this.performRedTeamAudit(decision, apiKey);
        if (result.status === 'completed') completed++;
        else deferred++;
      }

      const pendingAfter = await neonDb.getSentinelPendingDecisionCount();
      await neonDb.logEvent('sentinel_scan_summary', {
        status: 'processed',
        batchSize: batch.length,
        completed,
        deferred,
        pendingRemaining: pendingAfter,
      });
      console.log(
        `[Sentinel] Batch finished: selected=${batch.length}, completed=${completed}, deferred=${deferred}, pendingRemaining=${pendingAfter === null ? 'unavailable' : pendingAfter}.`
      );
    } catch (err) {
      console.error('[Sentinel] Scan failed:', err instanceof Error ? err.message : 'unknown error');
    } finally {
      this.isScanning = false;
    }
  }

  private async deferAudit(decisionId: number, reason: string): Promise<SentinelAuditResult> {
    const persisted = await neonDb.recordSentinelDecisionAudit(decisionId, 'deferred', { reason });
    if (!persisted) {
      console.warn(`[Sentinel] Deferred audit state for decision #${decisionId} could not be persisted.`);
    }
    return { status: 'deferred', reason };
  }

  /**
   * Perform a live evidence search and current-model adversarial review. A result
   * is marked completed only after its audit state is durably written.
   */
  private async performRedTeamAudit(decision: DecisionRecord, apiKey: string): Promise<SentinelAuditResult> {
    if (typeof decision.id !== 'number' || !Number.isSafeInteger(decision.id)) {
      return { status: 'deferred', reason: 'DECISION_ID_UNAVAILABLE' };
    }

    try {
      const configuredModel = settingsManager.getSettings().providerModels?.gemini ||
        (settingsManager.getSettings().activeProvider === 'gemini'
          ? settingsManager.getSettings().activeModel
          : '');
      const modelId = await modelCatalogService.resolveModelForProvider('gemini', configuredModel, apiKey);
      const title = typeof decision.title === 'string' ? decision.title.trim() : '';
      const recommendation = typeof decision.recommendation === 'string' ? decision.recommendation.trim() : '';

      if (!title || !recommendation) {
        return this.deferAudit(decision.id, 'REQUIRED_DECISION_FIELDS_MISSING');
      }

      const searchQuery = `risks and failure modes of "${title}" ${recommendation}`;
      const searchKey = this.resolveUsableCredential(
        settingsManager.getSettings().customTavilyKey,
        process.env.TAVILY_API_KEY
      );
      const research = await specialistSwarmService.executeSearchWeb(searchQuery, {
        customTavilyKey: searchKey,
      });

      if (research.status !== 'success' || research.results.length === 0) {
        return this.deferAudit(decision.id, 'LIVE_COUNTEREVIDENCE_SEARCH_UNAVAILABLE');
      }

      const evidence = research.results.map((item: any) => {
        const sourceTitle = typeof item.title === 'string' ? item.title : '';
        const sourceUrl = typeof item.url === 'string' ? item.url : '';
        const sourceContent = typeof item.content === 'string' ? item.content : '';
        return `Source: ${sourceTitle}\nURL: ${sourceUrl}\nContent: ${sourceContent}`;
      }).join('\n\n');

      const genAI = new GoogleGenAI({ apiKey });
      const auditPrompt = `
        You are an adversarial reviewer of a stored decision.
        Separate retrieved external claims from independently verified facts, inferences, and unknowns.
        Do not invent evidence, sources, metrics, events, or user traits.

        DECISION: "${title}"
        RECOMMENDATION: "${recommendation}"
        RECORDED CONFIDENCE VALUE: ${typeof decision.confidence === 'number' && Number.isFinite(decision.confidence) ? decision.confidence : 'not recorded'} (database value; not assumed to be calibrated probability).

        RETRIEVED EXTERNAL SOURCES (not independently verified merely by retrieval):
        ${evidence}

        TASK:
        1. Compare the recommendation with the retrieved sources, noting source limitations.
        2. Identify a material contradiction or strategic risk only when supported by the supplied evidence.
        3. If no material blind spot is supported, return exactly NO_BLIND_SPOT.
        4. Otherwise return a concise alert containing risk, cited source URL/title, and a practical mitigation.
        Do not output a fabricated certainty score.
      `;

      const result = await callWithBoundedRetry(async () => {
        const response = await genAI.models.generateContent({
          model: modelId,
          contents: [{ role: 'user', parts: [{ text: auditPrompt }] }],
          config: { temperature: 0.4 },
        });
        const output = response.text?.trim() || '';
        if (!output) throw new Error('AI_OUTPUT_EMPTY: Sentinel provider returned no audit result');
        return output;
      }, { operationName: 'SentinelAudit' });

      if (result.includes('NO_BLIND_SPOT')) {
        const persisted = await neonDb.recordSentinelDecisionAudit(decision.id, 'completed', {
          model: modelId,
          conclusion: 'NO_BLIND_SPOT',
          evidenceSources: research.results.length,
        });
        if (!persisted) return { status: 'deferred', reason: 'AUDIT_STATE_PERSISTENCE_FAILED' };
        return { status: 'completed' };
      }

      const delivery = await this.triggerAlert(result, decision.id);
      const persisted = await neonDb.recordSentinelDecisionAudit(decision.id, 'completed', {
        model: modelId,
        conclusion: 'ALERT_RAISED',
        evidenceSources: research.results.length,
        alertDelivery: delivery.status,
        ...(delivery.reason ? { alertDeliveryReason: delivery.reason } : {}),
        outputExcerpt: result.slice(0, 1200),
      });
      if (!persisted) return { status: 'deferred', reason: 'AUDIT_STATE_PERSISTENCE_FAILED' };
      return { status: 'completed' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'SENTINEL_AUDIT_FAILED';
      console.warn(`[Sentinel] Audit deferred for decision #${decision.id}:`, reason);
      return this.deferAudit(decision.id, reason);
    }
  }

  /**
   * Route an alert to a configured outbound channel and return its actual result.
   */
  private async triggerAlert(
    message: string,
    decisionId: number
  ): Promise<{ status: 'sent' | 'not_configured' | 'failed'; reason?: string }> {
    const settings = settingsManager.getSettings();
    const channel = settings.proactiveAlertChannel;

    if (channel === 'whatsapp') {
      const targetPhone = this.resolveUsableCredential(process.env.USER_PHONE_NUMBER, settings.userPhoneNumber);
      if (!targetPhone) return { status: 'not_configured', reason: 'WHATSAPP_OWNER_PHONE_MISSING' };

      const delivery = await twilioService.sendWhatsAppMessage(targetPhone, message);
      if (!delivery.success) {
        console.warn(`[Sentinel] WhatsApp alert delivery failed for decision #${decisionId}.`);
        return { status: 'failed', reason: delivery.error || 'WHATSAPP_DELIVERY_FAILED' };
      }
      return { status: 'sent' };
    }

    if (channel === 'telegram') {
      const delivered = await telegramBotManager.sendProactiveMessage(message);
      if (!delivered) {
        console.warn(`[Sentinel] Telegram alert delivery failed for decision #${decisionId}.`);
        return { status: 'failed', reason: 'TELEGRAM_DELIVERY_FAILED' };
      }
      return { status: 'sent' };
    }

    return { status: 'not_configured', reason: 'OUTBOUND_ALERT_CHANNEL_NOT_CONFIGURED' };
  }
}

export const sentinelService = new AdversarialSentinelService();
