import fs from 'fs';
import path from 'path';
import { neonDb } from '../db/neonService.ts';
import { twilioService } from './twilioService.ts';

export interface PendingConfirmation {
  actionId: string;
  senderPhone: string;
  targetDecisionId: number;
  proposedStatus: string;
  proposedNotes: string;
  expiresAt: string;
  createdAt: string;
}

const CONFIRMATIONS_FILE = path.resolve(process.cwd(), 'twin-confirmations.json');
const EXPIRATION_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export class ConfirmationService {
  private readConfirmations(): PendingConfirmation[] {
    try {
      if (!fs.existsSync(CONFIRMATIONS_FILE)) return [];
      const raw = fs.readFileSync(CONFIRMATIONS_FILE, 'utf-8');
      return JSON.parse(raw || '[]');
    } catch {
      return [];
    }
  }

  private writeConfirmations(list: PendingConfirmation[]) {
    try {
      fs.writeFileSync(CONFIRMATIONS_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[ConfirmationService] Error writing twin-confirmations.json:', err);
    }
  }

  /**
   * Stage a pending decision outcome confirmation for a specific authenticated user
   */
  public stageConfirmation(
    senderPhone: string,
    targetDecisionId: number,
    proposedStatus: string,
    proposedNotes: string
  ): { pending: PendingConfirmation; promptMessage: string } {
    const normalizedSender = twilioService.normalizePhoneNumber(senderPhone);
    const list = this.readConfirmations().filter(
      (c) => twilioService.normalizePhoneNumber(c.senderPhone) !== normalizedSender && new Date(c.expiresAt).getTime() > Date.now()
    );

    const now = Date.now();
    const actionId = `act-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const pending: PendingConfirmation = {
      actionId,
      senderPhone: normalizedSender,
      targetDecisionId,
      proposedStatus: proposedStatus || 'Met Success Threshold',
      proposedNotes: proposedNotes || 'Logged via WhatsApp natural message',
      expiresAt: new Date(now + EXPIRATION_WINDOW_MS).toISOString(),
      createdAt: new Date(now).toISOString(),
    };

    list.push(pending);
    this.writeConfirmations(list);

    const promptMessage = `⚠️ *Action Confirmation Required*\n\nDo you want to log outcome for Decision #${targetDecisionId}?\n• *Status*: ${pending.proposedStatus}\n• *Notes*: "${pending.proposedNotes}"\n\nReply *YES* to authorize and commit, or *NO* to cancel (expires in 15 mins).`;

    return { pending, promptMessage };
  }

  /**
   * Get active, unexpired confirmation for a sender
   */
  public getPendingConfirmation(senderPhone: string): PendingConfirmation | null {
    const normalizedSender = twilioService.normalizePhoneNumber(senderPhone);
    const list = this.readConfirmations();
    const nowMs = Date.now();

    const active = list.find((c) => {
      const match = twilioService.normalizePhoneNumber(c.senderPhone) === normalizedSender;
      const unexpired = new Date(c.expiresAt).getTime() > nowMs;
      return match && unexpired;
    });

    return active || null;
  }

  /**
   * Check if message text is an affirmative reply
   */
  public isAffirmative(text: string): boolean {
    const clean = (text || '').trim().toLowerCase();
    const affirmatives = ['yes', 'y', 'confirm', 'agree', 'ok', 'proceed', 'do it', 'authorize', 'yeah', 'yep', 'sure'];
    return affirmatives.includes(clean) || clean.startsWith('yes ') || clean.startsWith('confirm ');
  }

  /**
   * Check if message text is a negative reply
   */
  public isNegative(text: string): boolean {
    const clean = (text || '').trim().toLowerCase();
    const negatives = ['no', 'n', 'cancel', 'stop', 'abort', 'decline', 'don\'t', 'dont', 'nah'];
    return negatives.includes(clean) || clean.startsWith('no ') || clean.startsWith('cancel ');
  }

  /**
   * Commit pending confirmation exactly once
   */
  public async commitConfirmation(actionId: string, senderPhone: string): Promise<{ success: boolean; replyMessage: string }> {
    const normalizedSender = twilioService.normalizePhoneNumber(senderPhone);
    const list = this.readConfirmations();
    const idx = list.findIndex(
      (c) => c.actionId === actionId && twilioService.normalizePhoneNumber(c.senderPhone) === normalizedSender
    );

    if (idx === -1) {
      return { success: false, replyMessage: 'No matching pending confirmation found or it has already expired.' };
    }

    const item = list[idx];

    const allowedOutcomes = [
      'Met Success Threshold',
      'Missed Baseline',
      'Inconclusive',
      'Pivot Executed',
      'Cancelled',
      'Pending Verification',
    ];
    if (!allowedOutcomes.includes(item.proposedStatus)) {
      return {
        success: false,
        replyMessage: '⚠️ I could not record that outcome because its status is not supported. The confirmation remains pending.',
      };
    }

    // Save to the authoritative database before consuming the pending confirmation.
    let reviewRes: Awaited<ReturnType<typeof neonDb.saveDecisionReview>>;
    try {
      const binaryOutcome = item.proposedStatus === 'Met Success Threshold' || item.proposedStatus === 'Missed Baseline';
      reviewRes = await neonDb.saveDecisionReview({
        decisionId: item.targetDecisionId,
        idempotencyKey: `wa-${item.actionId}`,
        observation: item.proposedNotes,
        actualOutcome: item.proposedStatus,
        evidenceSource: 'Owner-confirmed WhatsApp observation',
        outcomeVerified: binaryOutcome,
        reviewData: { channel: 'whatsapp', confirmationActionId: item.actionId },
      });
    } catch {
      return {
        success: false,
        replyMessage: '⚠️ The database did not confirm this outcome was saved. The confirmation remains pending; please retry after the storage issue is resolved.',
      };
    }

    if (!reviewRes.reviewId || reviewRes.conflict) {
      return {
        success: false,
        replyMessage: '⚠️ The outcome was not confirmed as saved. The confirmation remains pending.',
      };
    }

    // Consume the confirmation only after the durable append succeeded.
    list.splice(idx, 1);
    this.writeConfirmations(list);

    const replyMessage = reviewRes.isDuplicate
      ? `✅ *Decision Outcome Already Recorded*\n\nDecision #${item.targetDecisionId} already has this observation.\nNotes: "${item.proposedNotes}"`
      : `✅ *Decision Outcome Logged Successfully!*\n\nDecision #${item.targetDecisionId} appended with status: *${item.proposedStatus}*.\nNotes: "${item.proposedNotes}"`;

    return { success: true, replyMessage };
  }

  /**
   * Cancel pending confirmation
   */
  public cancelConfirmation(senderPhone: string): string {
    const normalizedSender = twilioService.normalizePhoneNumber(senderPhone);
    const list = this.readConfirmations();
    const filtered = list.filter((c) => twilioService.normalizePhoneNumber(c.senderPhone) !== normalizedSender);
    this.writeConfirmations(filtered);

    return '🚫 Action cancelled. No changes were made to your decisions.';
  }
}

export const confirmationService = new ConfirmationService();
