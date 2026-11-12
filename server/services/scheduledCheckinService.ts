import { neonDb, type ScheduledCheckinRecord } from '../db/neonService.ts';
import { telegramBotManager } from '../telegram/telegramService.ts';
import { twilioService } from './twilioService.ts';

export interface CreateCheckinInput {
  title?: unknown;
  prompt?: unknown;
  channel?: unknown;
  dueAt?: unknown;
  delayMinutes?: unknown;
  threadId?: unknown;
  journeyId?: unknown;
  decisionId?: unknown;
}

export interface ValidatedCheckinInput {
  title: string;
  prompt: string;
  channel: 'telegram' | 'whatsapp';
  dueAt: string;
  threadId: string | null;
  journeyId: number | null;
  decisionId: number | null;
}

export function validateScheduledCheckinInput(
  raw: CreateCheckinInput,
  nowMs = Date.now()
): { valid: true; value: ValidatedCheckinInput } | { valid: false; code: string; error: string } {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  const rawChannel = typeof raw.channel === 'string' ? raw.channel.trim().toLowerCase() : '';

  if (!title) {
    return { valid: false, code: 'CHECKIN_TITLE_REQUIRED', error: 'A clear check-in title is required.' };
  }
  if (!prompt) {
    return { valid: false, code: 'CHECKIN_PROMPT_REQUIRED', error: 'A check-in message or prompt is required.' };
  }
  if (rawChannel !== 'telegram' && rawChannel !== 'whatsapp') {
    return {
      valid: false,
      code: 'CHECKIN_CHANNEL_INVALID',
      error: 'Scheduled check-ins require an explicit delivery channel: "telegram" or "whatsapp".',
    };
  }

  let dueMs: number | null = null;
  if (raw.delayMinutes !== undefined && raw.delayMinutes !== null && raw.delayMinutes !== '') {
    const mins = Number(raw.delayMinutes);
    if (!Number.isFinite(mins) || mins < 1 || mins > 43200) {
      return {
        valid: false,
        code: 'CHECKIN_DELAY_INVALID',
        error: 'delayMinutes must be between 1 and 43200 minutes (30 days).',
      };
    }
    dueMs = nowMs + Math.round(mins * 60_000);
  } else if (typeof raw.dueAt === 'string' && raw.dueAt.trim()) {
    const parsed = Date.parse(raw.dueAt.trim());
    if (!Number.isFinite(parsed)) {
      return { valid: false, code: 'CHECKIN_DUE_AT_INVALID', error: 'dueAt must be a valid ISO timestamp.' };
    }
    if (parsed < nowMs - 60_000) {
      return { valid: false, code: 'CHECKIN_DUE_AT_IN_PAST', error: 'dueAt must not be in the past.' };
    }
    dueMs = parsed;
  } else {
    return {
      valid: false,
      code: 'CHECKIN_SCHEDULE_TIME_REQUIRED',
      error: 'Provide either a valid future dueAt ISO timestamp or delayMinutes.',
    };
  }

  const threadId = typeof raw.threadId === 'string' && raw.threadId.trim() ? raw.threadId.trim() : null;
  const journeyIdNum = raw.journeyId !== undefined && raw.journeyId !== null && raw.journeyId !== '' ? Number(raw.journeyId) : NaN;
  const decisionIdNum = raw.decisionId !== undefined && raw.decisionId !== null && raw.decisionId !== '' ? Number(raw.decisionId) : NaN;

  return {
    valid: true,
    value: {
      title: title.slice(0, 255),
      prompt: prompt.slice(0, 2000),
      channel: rawChannel,
      dueAt: new Date(dueMs).toISOString(),
      threadId,
      journeyId: Number.isSafeInteger(journeyIdNum) && journeyIdNum > 0 ? journeyIdNum : null,
      decisionId: Number.isSafeInteger(decisionIdNum) && decisionIdNum > 0 ? decisionIdNum : null,
    },
  };
}

export function formatCheckinMessage(checkin: Pick<ScheduledCheckinRecord, 'title' | 'prompt'>): string {
  return `⏰ Scheduled TwinMind Check-In: ${checkin.title}\n\n${checkin.prompt}`;
}

class ScheduledCheckinService {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;

  public async dispatchCheckin(
    checkin: ScheduledCheckinRecord
  ): Promise<{ success: boolean; status: 'sent' | 'failed'; deliverySid?: string; error?: string }> {
    const messageBody = formatCheckinMessage(checkin);

    try {
      if (checkin.channel === 'telegram') {
        const tgStatus = telegramBotManager.getStatus();
        if (!tgStatus.isRunning || !tgStatus.isPaired) {
          const reason = 'TELEGRAM_CHANNEL_UNAVAILABLE: Telegram bot is not online and paired with the owner.';
          await neonDb.completeScheduledCheckin(checkin.id, { status: 'failed', error: reason });
          return { success: false, status: 'failed', error: reason };
        }

        const delivered = await telegramBotManager.sendProactiveMessage(messageBody);
        if (!delivered) {
          const reason = 'TELEGRAM_DELIVERY_FAILED: Telegram rejected or failed to deliver the check-in message.';
          await neonDb.completeScheduledCheckin(checkin.id, { status: 'failed', error: reason });
          return { success: false, status: 'failed', error: reason };
        }

        await neonDb.completeScheduledCheckin(checkin.id, { status: 'sent', error: null });
        return { success: true, status: 'sent' };
      }

      if (checkin.channel === 'whatsapp') {
        const twilioConfig = twilioService.getResolvedConfig();
        const targetPhone = twilioConfig?.userPhoneNumber?.trim();
        if (!twilioConfig || !targetPhone) {
          const reason = 'WHATSAPP_CONFIGURATION_MISSING: Twilio credentials or recipient WhatsApp phone number are not configured.';
          await neonDb.completeScheduledCheckin(checkin.id, { status: 'failed', error: reason });
          return { success: false, status: 'failed', error: reason };
        }

        const result = await twilioService.sendWhatsAppMessage(targetPhone, messageBody);
        if (!result.success) {
          const reason = result.error || 'WHATSAPP_DELIVERY_FAILED: Twilio did not accept the outbound message.';
          await neonDb.completeScheduledCheckin(checkin.id, { status: 'failed', error: reason });
          return { success: false, status: 'failed', error: reason };
        }

        await neonDb.completeScheduledCheckin(checkin.id, {
          status: 'sent',
          deliverySid: result.messageSid || null,
          error: null,
        });
        return { success: true, status: 'sent', deliverySid: result.messageSid };
      }

      const unsupportedReason = `CHECKIN_CHANNEL_UNSUPPORTED: "${String(checkin.channel)}"`;
      await neonDb.completeScheduledCheckin(checkin.id, { status: 'failed', error: unsupportedReason });
      return { success: false, status: 'failed', error: unsupportedReason };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'CHECKIN_DISPATCH_EXCEPTION';
      await neonDb.completeScheduledCheckin(checkin.id, { status: 'failed', error: reason }).catch(() => {});
      return { success: false, status: 'failed', error: reason };
    }
  }

  public async processDueCheckins(): Promise<{ claimed: number; sent: number; failed: number }> {
    if (this.isPolling || !neonDb.isDatabaseConnected()) {
      return { claimed: 0, sent: 0, failed: 0 };
    }
    this.isPolling = true;
    let sent = 0;
    let failed = 0;
    try {
      const due = await neonDb.claimDueCheckins(5);
      for (const item of due) {
        const outcome = await this.dispatchCheckin(item);
        if (outcome.success) sent++;
        else failed++;
      }
      return { claimed: due.length, sent, failed };
    } finally {
      this.isPolling = false;
    }
  }

  public startScheduler(intervalMs = 30_000): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.processDueCheckins().catch((err) =>
        console.warn('[ScheduledCheckins] Poll warning:', err instanceof Error ? err.message : err)
      );
    }, intervalMs);
    this.pollTimer.unref?.();
    void this.processDueCheckins().catch(() => {});
  }
}

export const scheduledCheckinService = new ScheduledCheckinService();
