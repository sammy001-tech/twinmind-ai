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
        let userFacingError = `⚠️ TwinMind encountered an issue: ${errorMsg}`;
        if (errorMsg.includes('401') || errorMsg.includes('API_KEY_INVALID') || errorMsg.includes('unauthorized') || errorMsg.includes('API key')) {
          userFacingError = `⚠️ TwinMind could not generate an AI response because the Gemini API key was rejected (401 Unauthorized). Please check or update your Gemini API key in TwinMind Settings.`;
        }
        await twilioService.sendWhatsAppMessage(job.senderPhone, userFacingError);
      }
    }
  }

  private async executeJobPayload(job: JobRecord) {
    const userMessage = (job.payload.body || job.payload.Body || '').trim();
    const senderPhone = job.senderPhone;

    // Check for incoming WhatsApp photo or media attachment (Multimodal photo & audio support)
    let incomingImageData: { mimeType: string; data: string; name?: string } | undefined;
    let incomingAudioData: { mimeType: string; data: string; name?: string } | undefined;
    const mediaUrl0 = job.payload.MediaUrl0 || job.payload.mediaUrl0;
    const mediaContentType0 = job.payload.MediaContentType0 || job.payload.mediaContentType0 || 'image/jpeg';

    if (mediaUrl0) {
      try {
        const twilioCfg = twilioService.getResolvedConfig();
        const headers: Record<string, string> = {};
        if (twilioCfg) {
          const auth = Buffer.from(`${twilioCfg.accountSid}:${twilioCfg.authToken}`).toString('base64');
          headers['Authorization'] = `Basic ${auth}`;
        }
        const mediaRes = await fetch(mediaUrl0, { headers });
        if (mediaRes.ok) {
          const arrayBuf = await mediaRes.arrayBuffer();
          const base64Data = Buffer.from(arrayBuf).toString('base64');
          if (mediaContentType0.startsWith('audio/')) {
            incomingAudioData = {
              mimeType: mediaContentType0,
              data: base64Data,
              name: 'whatsapp_audio.ogg',
            };
            console.log(`[WhatsAppWorker] Fetched incoming WhatsApp audio attachment (${mediaContentType0})`);
          } else {
            incomingImageData = {
              mimeType: mediaContentType0,
              data: base64Data,
              name: 'whatsapp_photo.jpg',
            };
            console.log(`[WhatsAppWorker] Fetched incoming WhatsApp photo attachment (${mediaContentType0})`);
          }
        }
      } catch (mErr) {
        console.warn('[WhatsAppWorker] Error fetching incoming WhatsApp media attachment:', mErr);
      }
    }

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

    // 2. If photo is present or message is general text, route to multimodal reasoning
    const s = settingsManager.getSettings();
    const activeProvider = s.activeProvider || 'gemini';
    const activeModel = s.activeModel || s.providerModels[activeProvider] || '';

    if (!incomingImageData) {
      // Dynamic NLP Intent Classification using active LLM provider
      const classification = await intentClassifierService.classifyNaturalIntent(userMessage);
      console.log(`[WhatsAppWorker] Classified intent: ${classification.intent} (Confidence: ${classification.confidence})`);

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
          return;
        }

        case 'OUTCOME_LOGGING': {
          const targetIdStr = classification.extractedParams.targetDecisionId;
          const reportedStatus = classification.extractedParams.reportedStatus || 'Met Success Threshold';
          const reportedNotes = classification.extractedParams.reportedNotes || userMessage;

          let targetDecisionId: number | null = targetIdStr ? parseInt(targetIdStr, 10) : null;

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
          return;
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
          return;
        }

        case 'STATUS_QUERY': {
          const summary = await twinAgentService.executeExecutiveSummary('all');
          const count = summary.totalRecordedDecisions || 0;
          const notesCount = summary.totalIndexedKnowledgeNotes || 0;

          const reply = `📊 *TwinMind System Status*\n\n• *Recorded Decisions*: ${count}\n• *Vault Notes*: ${notesCount}\n• *Active Provider*: ${activeProvider.toUpperCase()} (${activeModel})\n\nHow can I assist your decision-making today?`;
          await twilioService.sendWhatsAppMessage(senderPhone, reply);
          return;
        }
      }
    }

    // Multimodal & General Conversational Turn Processing with Autonomous Tool Execution
    const turnResult = await twinAgentService.executeTurn({
      userPrompt: incomingAudioData
        ? 'Listen to this voice note, transcribe it accurately, extract key action items, and generate a professional PDF meeting notes document or financial forecast if applicable.'
        : userMessage,
      imageData: incomingImageData,
      audioData: incomingAudioData,
      channel: 'whatsapp',
    });

    const reply = turnResult?.reply?.trim() || 'Request processed.';
    await twilioService.sendWhatsAppMessage(senderPhone, reply);

    // Deliver generated artifacts (PDF, Excel .xlsx, CSV, Markdown) directly via WhatsApp mediaUrl
    if (turnResult?.toolsExecuted && Array.isArray(turnResult.toolsExecuted)) {
      for (const tool of turnResult.toolsExecuted) {
        const res: any = tool.result || {};
        if (tool.toolName === 'generateArtifact' && res.fileName) {
          try {
            const fileName = res.fileName;
            const publicBaseUrl = (process.env.PUBLIC_APP_URL || process.env.VITE_APP_URL || '').trim().replace(/\/+$/, '');
            if (publicBaseUrl) {
              const mediaUrl = `${publicBaseUrl}/artifacts/${encodeURIComponent(fileName)}`;
              await twilioService.sendWhatsAppMessage(
                senderPhone,
                `📄 *Generated Document*: ${fileName}`,
                mediaUrl
              );
            }
          } catch (artErr) {
            console.warn('[WhatsAppWorker] Error sending generated artifact over WhatsApp:', artErr);
          }
        }
      }
    }
  }
}

export const whatsAppWorker = new WhatsAppWorker();
