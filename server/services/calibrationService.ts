import { neonDb } from '../db/neonService.ts';
import { twilioService } from './twilioService.ts';
import { telegramBotManager } from '../telegram/telegramService.ts';
import { settingsManager } from '../db/settingsService.ts';

export interface CalibrationStats {
  brierScore: number | null;
  totalReviewed: number | null;
  available: boolean;
  accuracyTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  overconfidenceLevel: number | null; // null until enough valid observed outcomes exist
}

class CalibrationService {
  /**
   * Scans for experiments that have reached their target date but haven't been reviewed.
   */
  public async monitorOverdueExperiments(): Promise<void> {
    const s = settingsManager.getSettings();
    const now = new Date();

    try {
      // Find experiments where target_date is in the past, status is 'Active' or 'Proposed', 
      // and no review exists for the parent decision.
      const experiments = await neonDb.getDecisionExperiments();
      const overdue = experiments.filter(e => 
        e.target_date && 
        new Date(e.target_date) < now && 
        (e.status === 'Active' || e.status === 'Proposed')
      );

      for (const exp of overdue) {
        // Check if a review already exists for this decision
        const reviews = await neonDb.getDecisionReviews(exp.decision_id);
        if (reviews.length === 0) {
          await this.triggerOutreach(exp);
        } else {
          // If a review exists, mark experiment as 'Completed' or similar to avoid re-monitoring
          // Note: In a real implementation we might update status here. 
          // For now we'll just skip to outreach if no review.
        }
      }
    } catch (err) {
      console.warn('[CalibrationService] Error monitoring experiments:', err);
    }
  }

  /**
   * Sends proactive messages to the user to close the loop on a decision.
   */
  private async triggerOutreach(exp: any): Promise<void> {
    const s = settingsManager.getSettings();
    const decision = await neonDb.getDecisionById(exp.decision_id);
    if (!decision) return;

    const configuredName = s.userName?.trim() || '';
    const greeting = configuredName ? `${configuredName}, ` : '';
    const brand = s.brandName?.trim() || '';
    const alertTitle = brand ? `${brand} Calibration Alert` : 'Calibration Alert';
    const message = `🚨 *${alertTitle}*\n\n${greeting}the target date for your decision "*${decision.title}*" has passed.\n\nTarget Metric: ${exp.target_metric}\nBaseline: ${exp.baseline_metric}\n\nDid you meet the success threshold? Reply with the observed outcome so the decision history can be updated.`;

    const channel = s.proactiveAlertChannel || 'none';

    if (channel === 'whatsapp') {
      if (s.twilioAccountSid && s.twilioAuthToken && s.twilioWhatsAppNumber) {
        const targetPhone = process.env.USER_PHONE_NUMBER || s.userPhoneNumber;
        if (targetPhone) {
          await twilioService.sendWhatsAppMessage(targetPhone, message);
          console.log(`[CalibrationService] Proactive WhatsApp outreach sent for decision #${exp.decision_id}`);
        }
      }
    } else if (channel === 'telegram') {
      try {
        await telegramBotManager.sendProactiveMessage(message);
        console.log(`[CalibrationService] Proactive Telegram outreach sent for decision #${exp.decision_id}`);
      } catch (tgErr) {
        console.warn('[CalibrationService] Telegram outreach failed:', tgErr);
      }
    } else {
      console.log(`[CalibrationService] Proactive alert suppressed (Channel: ${channel}) for decision #${exp.decision_id}`);
    }
  }

  /**
   * Calculates calibration metrics using Brier Score.
   */
  public async getCalibrationSummary(): Promise<CalibrationStats> {
    const metrics = await neonDb.getCalibrationMetrics();

    return {
      available: metrics.available,
      brierScore: metrics.available ? metrics.brierScore : null,
      totalReviewed: metrics.available ? metrics.eligibleCount : null,
      // The query returns one aggregate, not a time series; directional trends are unavailable.
      accuracyTrend: 'insufficient_data',
      overconfidenceLevel: metrics.available ? metrics.overconfidenceLevel : null,
    };
  }

  /**
   * Formats calibration data for the Digital Twin's system prompt meta-context.
   */
  public async getCalibrationContext(): Promise<string> {
    const summary = await this.getCalibrationSummary();
    if (!summary.available || summary.brierScore === null || summary.totalReviewed === null || summary.totalReviewed < 5) return '';

    const measuredBias = summary.overconfidenceLevel;
    let insight = 'The observed sample does not indicate a directional mean calibration bias.';
    if (measuredBias !== null && measuredBias > 0.55) {
      insight = 'Observed mean predicted probability exceeded the observed success rate in the eligible sample.';
    } else if (measuredBias !== null && measuredBias < 0.45) {
      insight = 'Observed mean predicted probability was below the observed success rate in the eligible sample.';
    }

    return `\n\nDECISION CALIBRATION METRICS\n` +
      `- Empirical Brier score: ${summary.brierScore} (0 is perfect; 1 is worst for binary outcomes)\n` +
      `- Eligible decisions evaluated: ${summary.totalReviewed}\n` +
      `- Measured mean calibration level: ${measuredBias === null ? 'unavailable' : measuredBias}\n` +
      `- Empirical observation: ${insight}\n` +
      'Use only this measured history; do not infer a time trend from this aggregate.';
  }
}

export const calibrationService = new CalibrationService();
