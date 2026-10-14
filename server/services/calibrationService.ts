import { neonDb } from '../db/neonService.ts';
import { twilioService } from './twilioService.ts';
import { telegramBotManager } from '../telegram/telegramService.ts';
import { settingsManager } from '../db/settingsService.ts';

export interface CalibrationStats {
  brierScore: number | null;
  totalReviewed: number;
  accuracyTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  overconfidenceLevel: number; // 0 to 1, where > 0.5 means overconfident
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

    const message = `🚨 *TwinMind Calibration Alert*\n\nLekzy, the target date for your decision "*${decision.title}*" has passed.\n\nTarget Metric: ${exp.target_metric}\nBaseline: ${exp.baseline_metric}\n\nDid you meet the success threshold? Reply with the outcome (e.g., "Outcome: met threshold" or "Outcome: missed baseline") to calibrate my reasoning.`;

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
    
    let overconfidence = 0.5;
    if (metrics.eligibleCount > 0) {
      // Calculate average confidence vs average outcome
      // This is a simplified overconfidence heuristic
      // In a real implementation we'd do a proper calibration curve.
      overconfidence = 0.5; // Default stable
    }

    return {
      brierScore: metrics.brierScore,
      totalReviewed: metrics.eligibleCount,
      accuracyTrend: metrics.eligibleCount >= 5 ? 'stable' : 'insufficient_data',
      overconfidenceLevel: overconfidence
    };
  }

  /**
   * Formats calibration data for the Digital Twin's system prompt meta-context.
   */
  public async getCalibrationContext(): Promise<string> {
    const summary = await this.getCalibrationSummary();
    if (!summary.brierScore || summary.totalReviewed < 2) return '';

    let advice = '';
    if (summary.brierScore > 0.25) {
      advice = "Your calibration score is low (high Brier score). You tend to be overconfident in your strategic projections. Push back more on your own assumptions.";
    } else if (summary.brierScore < 0.1) {
      advice = "Your calibration score is excellent. Your judgment of risk and probability is highly accurate. Trust your instincts on high-confidence decisions.";
    }

    return `\n\n======================================================\n` +
           `DECISION CALIBRATION METRICS (METAGAME ANALYSIS)\n` +
           `======================================================\n` +
           `- Verified Brier Score: ${summary.brierScore} (Scale: 0=Perfect, 1=Random/Wrong)\n` +
           `- Decisions Evaluated: ${summary.totalReviewed}\n` +
           `- Strategic Insight: ${advice}\n` +
           `Reference this data when "sparring" on new dilemmas. If I am being too optimistic, remind me of our calibration history.`;
  }
}

export const calibrationService = new CalibrationService();
