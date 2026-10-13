import { jobQueueService, type JobRecord } from './jobQueueService.ts';
import { twilioService } from './twilioService.ts';
import { intentClassifierService } from './intentClassifier.ts';
import { confirmationService } from './confirmationService.ts';
import { twinAgentService } from './twinAgentService.ts';
import { neonDb } from '../db/neonService.ts';
import { settingsManager } from '../db/settingsService.ts';

export class WhatsAppWorker {
  private isRunning = false;
  private workerLeaseId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;

  /**
   * Start worker polling loop & heartbeat recovery daemon
   */
  public startWorker() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[WhatsAppWorker] Worker started with lease ID: ${this.workerLeaseId}`);

    // Poll queue every 2 seconds
    setInterval(() => this.processNextJob(), 2000);
  }

  public async triggerImmediateProcessing() {
    setImmediate(() => this.processNextJob());
  }

  private async processNextJob() {
    let job: JobRecord | null = null;
    try {
      job = await jobQueueService.claimNextJob(this.workerLeaseId);
      if (!job) return;

      console.log(`[WhatsAppWorker] Processing job ${job.jobId} for message from ${job.senderPhone}`);

      // Start 15s heartbeat timer
      const heartbeatInterval = setInterval(() => {
        jobQueueService.updateHeartbeat(job!.jobId, this.workerLeaseId);
      }, 15000);

      try {
        await this.executeJobPayload(job);
        await jobQueueService.completeJob(job.jobId, this.workerLeaseId);
      } finally {
        clearInterval(heartbeatInterval);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[WhatsAppWorker] Error processing job ${job?.jobId || 'unknown'}:`, errorMsg);
      if (job) {
        await jobQueueService.failJob(job.jobId, this.workerLeaseId, errorMsg);
        await twilioService.sendWhatsAppMessage(
          job.senderPhone,
          `⚠️ Sorry, TwinMind encountered an issue processing your request: "${errorMsg}". Please try again.`
        );
      }
    }
  }

  private async executeJobPayload(job: JobRecord) {
    const userMessage = (job.payload.body || '').trim();
    const senderPhone = job.senderPhone;

    // 1. Check for State-Bound Action Confirmation Reply (YES / NO)
    const pendingConfirmation = confirmationService.getPendingConfirmation(senderPhone);
    if (pendingConfirmation) {
      if (confirmationService.isAffirmative(userMessage)) {
        const commitRes = await confirmationService.commitConfirmation(pendingConfirmation.actionId, senderPhone);
        await twilioService.sendWhatsAppMessage(senderPhone, commitRes.replyMessage);
        return;
      }

      if (confirmationService.isNegative(userMessage)) {
        const cancelRes = confirmationService.cancelConfirmation(senderPhone);
        await twilioService.sendWhatsAppMessage(senderPhone, cancelRes);
        return;
      }
    }

    // 2. Dynamic NLP Intent Classification using active LLM provider
    const classification = await intentClassifierService.classifyNaturalIntent(userMessage);
    console.log(`[WhatsAppWorker] Classified intent: ${classification.intent} (Confidence: ${classification.confidence})`);

    const s = settingsManager.getSettings();
    const activeProvider = s.activeProvider || 'gemini';
    const activeModel = s.activeModel || s.providerModels[activeProvider] || '';

    // If classification needs clarification or confidence < 0.75
    if (classification.requiresClarification || classification.confidence < 0.75) {
      const prompt =
        classification.clarificationPrompt ||
        `I want to make sure I understand correctly. Did you want to start a debate, log a decision outcome, or ask a question? Please clarify!`;
      await twilioService.sendWhatsAppMessage(senderPhone, `🤔 ${prompt}`);
      return;
    }

    // 3. Route based on validated intent
    switch (classification.intent) {
      case 'DEBATE_REQUEST': {
        const topic = classification.extractedParams.debateTopic || userMessage;
        await twilioService.sendWhatsAppMessage(
          senderPhone,
          `🥊 *TwinMind Swarm Debate Initiated*\n\nTopic: "${topic}"\nExecuting multi-agent evidence gathering and stress-testing. Stand by for the Chief Arbiter verdict...`
        );

        const debateRes = await twinAgentService.executeMultiAgentDebate(topic, 'whatsapp', activeProvider, activeModel);

        if (debateRes.error) {
          await twilioService.sendWhatsAppMessage(senderPhone, `⚠️ Debate failed: ${debateRes.error}`);
          return;
        }

        const synthesis = String(debateRes.synthesis || debateRes.recommendation || 'Debate complete.');
        const replyText = `🎯 *CHIEF ARBITER DEBATE VERDICT*\n\n${synthesis}\n\n_Decision recorded in Knowledge Vault (#${debateRes.decisionId || 'saved'})_`;
        await twilioService.sendWhatsAppMessage(senderPhone, replyText);
        break;
      }

      case 'OUTCOME_LOGGING': {
        const targetIdStr = classification.extractedParams.targetDecisionId;
        const reportedStatus = classification.extractedParams.reportedStatus || 'Met Success Threshold';
        const reportedNotes = classification.extractedParams.reportedNotes || userMessage;

        let targetDecisionId: number | null = targetIdStr ? parseInt(targetIdStr, 10) : null;

        // If target decision ID not explicitly provided, search recent decisions to match
        if (!targetDecisionId || isNaN(targetDecisionId)) {
          const recentDecisions = await neonDb.getDecisions(5);
          if (recentDecisions.length > 0) {
            targetDecisionId = recentDecisions[0].id || null;
          }
        }

        if (!targetDecisionId) {
          await twilioService.sendWhatsAppMessage(
            senderPhone,
            `❓ Which decision outcome are you logging? Please specify the decision ID (e.g., "Outcome for decision #3: success").`
          );
          return;
        }

        const { promptMessage } = confirmationService.stageConfirmation(
          senderPhone,
          targetDecisionId,
          reportedStatus,
          reportedNotes
        );

        await twilioService.sendWhatsAppMessage(senderPhone, promptMessage);
        break;
      }

      case 'DECISION_LOOKUP': {
        const targetIdStr = classification.extractedParams.targetDecisionId;
        const targetId = targetIdStr ? parseInt(targetIdStr, 10) : NaN;

        if (!isNaN(targetId)) {
          const decision = await neonDb.getDecisionById(targetId);
          if (decision) {
            const reply = `📌 *Decision #${decision.id}: ${decision.title}*\n\n*Recommendation*: ${decision.recommendation || 'None'}\n*Confidence*: ${decision.confidence}%\n*Created*: ${decision.created_at?.slice(0, 10) || 'Recent'}`;
            await twilioService.sendWhatsAppMessage(senderPhone, reply);
            return;
          }
        }

        const recentDecisions = await neonDb.getDecisions(3);
        if (recentDecisions.length === 0) {
          await twilioService.sendWhatsAppMessage(senderPhone, `📂 No stored decisions found in your Knowledge Vault.`);
          return;
        }

        const listText = recentDecisions
          .map((d) => `• *#${d.id}*: ${d.title} (${d.confidence}% conf)`)
          .join('\n');
        await twilioService.sendWhatsAppMessage(
          senderPhone,
          `📚 *Recent Strategic Decisions*\n\n${listText}\n\nReply with a decision ID for full details!`
        );
        break;
      }

      case 'STATUS_QUERY': {
        const summary = await twinAgentService.executeExecutiveSummary('all');
        const count = summary.totalRecordedDecisions || 0;
        const notesCount = summary.totalIndexedKnowledgeNotes || 0;

        const reply = `📊 *TwinMind System Status*\n\n• *Recorded Decisions*: ${count}\n• *Vault Notes*: ${notesCount}\n• *Active Provider*: ${activeProvider.toUpperCase()} (${activeModel})\n\nHow can I assist your decision-making today?`;
        await twilioService.sendWhatsAppMessage(senderPhone, reply);
        break;
      }

      case 'GENERAL_CHAT':
      default: {
        const turnResult = await twinAgentService.executeTurn({
          userPrompt: userMessage,
          channel: 'whatsapp',
        });

        await twilioService.sendWhatsAppMessage(senderPhone, turnResult.reply);
        break;
      }
    }
  }
}

export const whatsAppWorker = new WhatsAppWorker();
