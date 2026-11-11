import { neonDb } from '../db/neonService.ts';

export interface HistoricalInteractionMetadata {
  lastActivityDate: string | null;
  lastThreadTitle: string | null;
  recentThreads: Array<{ title: string; updatedAt: string }>;
  totalThreads: number;
}

class HistoricalAwarenessService {
  /**
   * Retrieves lightweight metadata about the user's past interactions.
   * Scoped to the single-user owner context of the application.
   */
  public async getLastInteractionMetadata(): Promise<HistoricalInteractionMetadata> {
    try {
      const threads = await neonDb.getThreads();
      
      if (threads.length === 0) {
        return {
          lastActivityDate: null,
          lastThreadTitle: null,
          recentThreads: [],
          totalThreads: 0,
        };
      }

      const mostRecent = threads[0];
      const recentThreads = threads.slice(0, 3).map(t => ({
        title: t.title,
        updatedAt: t.updated_at,
      }));

      return {
        lastActivityDate: mostRecent.updated_at,
        lastThreadTitle: mostRecent.title,
        recentThreads,
        totalThreads: threads.length,
      };
    } catch (err) {
      console.error('[HistoricalAwareness] Error fetching metadata:', err);
      return {
        lastActivityDate: null,
        lastThreadTitle: null,
        recentThreads: [],
        totalThreads: 0,
      };
    }
  }

  /**
   * Formats the historical metadata into a concise string for prompt injection.
   * Adheres to the ZeroMock policy: if no history exists, it clearly states it's the first conversation.
   */
  public formatHistoricalContext(metadata: HistoricalInteractionMetadata): string {
    if (metadata.totalThreads === 0) {
      return 'HISTORICAL AWARENESS: This is our first recorded conversation. No prior interaction history exists.';
    }

    const lastDate = metadata.lastActivityDate ? new Date(metadata.lastActivityDate).toLocaleString() : 'unknown';
    let context = `HISTORICAL AWARENESS:
- Total threads in history: ${metadata.totalThreads}
- Last activity recorded: ${lastDate}
- Last discussion topic: "${metadata.lastThreadTitle || 'Untitled'}"`;

    if (metadata.recentThreads.length > 1) {
      context += '\n- Other recent threads:';
      metadata.recentThreads.slice(1).forEach(t => {
        context += `\n  • "${t.title}" (${new Date(t.updatedAt).toLocaleDateString()})`;
      });
    }

    context += '\n\nNote: This is lightweight metadata. Detailed recall requires using historical search tools.';
    
    return context;
  }

  /**
   * Performs a text-based search across historical conversations.
   * This allows the Twin to recall specific details from past threads on demand.
   */
  public async searchConversationHistory(query: string): Promise<Record<string, unknown>> {
    if (!query || !query.trim()) {
      return { error: 'SEARCH_QUERY_REQUIRED', status: 'invalid_args' };
    }

    try {
      // Use ILIKE for a simple but effective text search across content and titles
      const results = await neonDb.searchMessages(query, 10);
      
      if (results.length === 0) {
        return {
          status: 'success',
          query,
          results: [],
          message: 'No matching historical records found for this query.',
        };
      }

      return {
        status: 'success',
        query,
        results: results.map(r => ({
          role: r.role,
          content: r.content,
          threadId: r.session_id,
          date: r.created_at,
        })),
        evidenceNotice: 'These results are retrieved from past conversations and should be used to ground the current response.',
      };
    } catch (err) {
      console.error('[HistoricalAwareness] Search error:', err);
      return {
        error: 'HISTORICAL_SEARCH_FAILED',
        status: 'execution_failed',
      };
    }
  }

  /**
   * Retrieves a summary for a specific thread if it exists.
   */
  public async getThreadSummary(threadId: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await neonDb.query(
        'SELECT * FROM thread_summaries WHERE thread_id = $1 LIMIT 1',
        [threadId]
      );
      return res?.rows[0] || null;
    } catch (err) {
      console.error('[HistoricalAwareness] Error fetching thread summary:', err);
      return null;
    }
  }

  /**
   * Generates and persists a summary for a conversation thread.
   * Extracts key decisions and unresolved tasks.
   */
  public async updateThreadSummary(threadId: string, messages: any[], completionFn: (prompt: string, systemInstruction: string) => Promise<string>): Promise<boolean> {
    if (messages.length < 2) return false;

    const conversationText = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    
    const systemInstruction = `You are a conversation analyst. Summarize the provided conversation thread.
Extract:
1. A concise summary of the discussion.
2. Key decisions made.
3. Unresolved tasks or follow-ups.

Respond in valid JSON:
{
  "summary": "string",
  "decisions": ["string"],
  "unresolvedTasks": ["string"]
}`;

    try {
      const resultJson = await completionFn(conversationText, systemInstruction);
      const parsed = JSON.parse(resultJson);

      await neonDb.query(
        `INSERT INTO thread_summaries (thread_id, summary, decisions, unresolved_tasks, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (thread_id) DO UPDATE SET
           summary = $2,
           decisions = $3,
           unresolved_tasks = $4,
           updated_at = CURRENT_TIMESTAMP`,
        [threadId, parsed.summary, JSON.stringify(parsed.decisions), JSON.stringify(parsed.unresolvedTasks)]
      );
      
      return true;
    } catch (err) {
      console.error('[HistoricalAwareness] Error updating thread summary:', err);
      return false;
    }
  }

  /**
   * Specifically retrieves recent decisions and unresolved tasks across history.
   * This provides a high-level view of the "state of play" for the user.
   */
  public async recallDecisionsAndTasks(): Promise<Record<string, unknown>> {
    try {
      const [decisions, summaries] = await Promise.all([
        neonDb.getDecisions(10),
        neonDb.query('SELECT * FROM thread_summaries ORDER BY updated_at DESC LIMIT 5')
      ]);

      const unresolvedTasks = (summaries?.rows || []).flatMap(s => s.unresolved_tasks || []);
      const historicalDecisions = (summaries?.rows || []).flatMap(s => s.decisions || []);

      return {
        status: 'success',
        recordedDecisions: decisions.map(d => ({ title: d.title, recommendation: d.recommendation, date: d.created_at })),
        inferredDecisions: historicalDecisions,
        unresolvedTasks,
        evidenceNotice: 'These items represent unfinished business or recent conclusions from your history.',
      };
    } catch (err) {
      console.error('[HistoricalAwareness] Recall error:', err);
      return {
        error: 'DECISION_RECALL_FAILED',
        status: 'execution_failed',
      };
    }
  }

  /**
   * Background worker to process idle threads and generate summaries.
   */
  public async runBackgroundSummarization(completionFn: (prompt: string, systemInstruction: string) => Promise<string>): Promise<void> {
    try {
      const threadIds = await neonDb.getThreadsNeedingSummary();
      if (threadIds.length === 0) return;

      console.log(`[HistoricalAwareness] Found ${threadIds.length} threads needing summarization.`);

      for (const threadId of threadIds) {
        const messages = await neonDb.getThreadMessages(threadId);
        if (messages.length >= 2) {
          await this.updateThreadSummary(threadId, messages, completionFn);
        }
      }
    } catch (err) {
      console.error('[HistoricalAwareness] Background worker error:', err);
    }
  }
}

export const historicalAwarenessService = new HistoricalAwarenessService();
