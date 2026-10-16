import { neonDb } from '../db/neonService.ts';
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

class AdversarialSentinelService {
  private isScanning = false;

  /**
   * Main red-teaming loop: scans active decisions for cognitive blind spots.
   */
  public async runCognitiveRedTeamScan(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;
    console.log('[Sentinel] Starting proactive cognitive red-team scan...');

    try {
      const s = settingsManager.getSettings();
      // Only scan if we have an alert channel configured
      if (!s.proactiveAlertChannel || s.proactiveAlertChannel === 'none') {
        console.log('[Sentinel] Proactive alerts disabled in settings. Skipping scan.');
        return;
      }

      // 1. Get active decisions (those without reviews or marked active)
      const decisions = await neonDb.getDecisions(15);
      const activeDecisions = decisions.filter(d => d.confidence > 70); // High confidence decisions are the best targets for red-teaming

      for (const decision of activeDecisions) {
        await this.performRedTeamAudit(decision);
      }
    } catch (err) {
      console.error('[Sentinel] Scan error:', err);
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Perform a deep adversarial audit of a specific decision.
   */
  private async performRedTeamAudit(decision: any): Promise<void> {
    const s = settingsManager.getSettings();
    const apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!apiKey) return;

    console.log(`[Sentinel] Auditing decision #${decision.id}: "${decision.title}"`);

    try {
      // 1. Research for counter-evidence using DeepResearcher tool
      const searchQuery = `risks and failure modes of "${decision.title}" ${decision.recommendation}`;
      const research = await specialistSwarmService.executeSearchWeb(searchQuery);

      if (research.status !== 'success' || research.results.length === 0) {
        return;
      }

      const evidence = research.results.map(r => `Source: ${r.title}\nContent: ${r.content}`).join('\n\n');

      // 2. Use LLM to find the "Blind Spot"
      const genAI = new GoogleGenAI({ apiKey });
      const modelId = await modelCatalogService.resolveModelForProvider('gemini', s.providerModels?.gemini, apiKey);

      const auditPrompt = `
        You are the ADVERSARIAL SENTINEL for the configured Digital Twin owner. 
        Your goal is to find COGNITIVE BLIND SPOTS and STRATEGIC RISKS in Lekzy's decisions.

        DECISION: "${decision.title}"
        RECOMMENDATION: "${decision.recommendation}"
        OWNER CONFIDENCE RECORDED IN DATABASE: ${decision.confidence}%

        VERIFIED WEB EVIDENCE:
        ${evidence}

        TASK:
        1. Compare the recommendation with the evidence.
        2. Identify if Lekzy is ignoring a critical risk or if there is a "Black Swan" event he missed.
        3. If you find a SIGNIFICANT contradiction or risk, formulate a punchy alert.
        4. If the decision looks solid and evidence supports it, return NO_BLIND_SPOT.

        ALERT FORMAT:
        🚨 SENTINEL ALERT: [Short Title]
        The recorded confidence for this decision is ${decision.confidence}%, but a blind spot may remain.
        RISK: [1 sentence]
        EVIDENCE: [1 sentence citing source]
        NEXT STEP: [Actionable mitigation]

        ONLY return the alert text or NO_BLIND_SPOT.
      `;

      const result = await callWithBoundedRetry(async () => {
        const response = await genAI.models.generateContent({
          model: modelId,
          contents: [{ role: 'user', parts: [{ text: auditPrompt }] }],
          config: { temperature: 0.4 }
        });
        const text = response.text?.trim() || '';
        if (!text) throw new Error('AI_OUTPUT_EMPTY: Sentinel provider returned no audit result');
        return text;
      }, { operationName: 'SentinelAudit' });

      if (result.includes('NO_BLIND_SPOT')) {
        console.log(`[Sentinel] Decision #${decision.id} passed audit.`);
        return;
      }

      // 3. Trigger Alert via preferred channel
      await this.triggerAlert(result, decision.id);

    } catch (err) {
      console.warn(`[Sentinel] Audit failed for decision #${decision.id}:`, err);
    }
  }

  /**
   * Route alert to preferred channel.
   */
  private async triggerAlert(message: string, decisionId: number): Promise<void> {
    const s = settingsManager.getSettings();
    const channel = s.proactiveAlertChannel;

    if (channel === 'whatsapp') {
      const targetPhone = process.env.USER_PHONE_NUMBER || s.userPhoneNumber;
      if (targetPhone) {
        await twilioService.sendWhatsAppMessage(targetPhone, message);
        console.log(`[Sentinel] WhatsApp alert triggered for decision #${decisionId}`);
      }
    } else if (channel === 'telegram') {
      try {
        await telegramBotManager.sendProactiveMessage(message);
        console.log(`[Sentinel] Telegram alert triggered for decision #${decisionId}`);
      } catch (err) {
        console.error('[Sentinel] Telegram alert failed:', err);
      }
    }
  }
}

export const sentinelService = new AdversarialSentinelService();
