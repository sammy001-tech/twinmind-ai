import { z } from 'zod';
import { twinAgentService } from './twinAgentService.ts';

export const IntentTypeSchema = z.enum([
  'DEBATE_REQUEST',
  'OUTCOME_LOGGING',
  'DECISION_LOOKUP',
  'STATUS_QUERY',
  'GENERAL_CHAT',
]);

export type IntentType = z.infer<typeof IntentTypeSchema>;

export const ClassifiedIntentSchema = z.object({
  intent: IntentTypeSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  extractedParams: z.object({
    debateTopic: z.string().optional(),
    targetDecisionId: z.string().optional(),
    reportedStatus: z.string().optional(),
    reportedNotes: z.string().optional(),
    searchQuery: z.string().optional(),
  }),
  requiresClarification: z.boolean(),
  clarificationPrompt: z.string().optional(),
});

export type ClassifiedIntent = z.infer<typeof ClassifiedIntentSchema>;

export class IntentClassifierService {
  /**
   * Classify inbound natural language message using active LLM provider & Zod schema validation
   */
  public async classifyNaturalIntent(userMessage: string): Promise<ClassifiedIntent> {
    const trimmed = typeof userMessage === 'string' ? userMessage.trim() : '';
    if (!trimmed) {
      throw new Error('INTENT_INPUT_EMPTY: a non-empty inbound message is required for classification');
    }

    const systemInstruction = `You classify inbound natural-language requests into the application's declared intent schema.
Analyze the user's inbound message and classify it into EXACTLY ONE of the following intent types:

1. "DEBATE_REQUEST":
   - The user wants to start a multi-agent debate, stress-test a strategic dilemma, compare options, or evaluate trade-offs (e.g. "Should I migrate to PostgreSQL?", "Debate: AWS vs GCP", "Help me decide whether to raise capital or bootstrap").
   - Extract "debateTopic" (the core question/dilemma).

2. "OUTCOME_LOGGING":
   - The user is reporting an actual real-world outcome, result, completion, failure, or status update regarding a past decision (e.g. "We finished the cloud migration and it was a success", "Outcome for decision #12: completed with minor delay").
   - Extract "targetDecisionId" if referenced, "reportedStatus" (e.g. "Success", "Failed", "In Progress"), and "reportedNotes".

3. "DECISION_LOOKUP":
   - The user wants to retrieve, look up, or check details/verdicts of a past decision (e.g. "What did we decide about marketing budget?", "Show verdict for decision #5", "Find decision on hiring").
   - Extract "targetDecisionId" or "searchQuery".

4. "STATUS_QUERY":
   - The user is asking for system status, recent activity, list of open decisions, or summary (e.g. "What are my recent decisions?", "Status", "Executive summary").

5. "GENERAL_CHAT":
   - Conversational chat, questions, thoughts, ideas, or greetings to their AI Twin.

CONFIDENCE & CLARIFICATION RULES:
- Set "confidence" to a float between 0.0 and 1.0 based on how unambiguous the intent is.
- If confidence < 0.75 or the request is missing key details (e.g. user says "Log outcome" without saying what happened), set "requiresClarification" = true and provide a polite "clarificationPrompt".
- DO NOT invent decision IDs. Only extract explicit IDs mentioned in the message.

Respond strictly in valid JSON matching this structure:
{
  "intent": "DEBATE_REQUEST" | "OUTCOME_LOGGING" | "DECISION_LOOKUP" | "STATUS_QUERY" | "GENERAL_CHAT",
  "confidence": 0.9,
  "reasoning": "brief explanation",
  "extractedParams": {
    "debateTopic": "string or undefined",
    "targetDecisionId": "string or undefined",
    "reportedStatus": "string or undefined",
    "reportedNotes": "string or undefined",
    "searchQuery": "string or undefined"
  },
  "requiresClarification": false,
  "clarificationPrompt": "string or undefined"
}`;

    try {
      const rawRes = await twinAgentService.generateCompletion({
        prompt: `Inbound Message: "${trimmed}"`,
        systemInstruction,
        jsonMode: true,
        temperature: 0.1,
      });

      if (typeof rawRes !== 'string' || !rawRes.trim()) {
        throw new Error('AI_OUTPUT_EMPTY: intent model returned no usable classification');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawRes);
      } catch {
        throw new Error('AI_OUTPUT_INVALID_JSON: intent model did not return valid JSON');
      }

      const validated = ClassifiedIntentSchema.safeParse(parsed);
      if (!validated.success) {
        throw new Error('AI_OUTPUT_SCHEMA_INVALID: intent classification failed schema validation');
      }
      if (validated.data.requiresClarification &&
          (typeof validated.data.clarificationPrompt !== 'string' || !validated.data.clarificationPrompt.trim())) {
        throw new Error('AI_OUTPUT_SCHEMA_INVALID: clarification was required but no clarification prompt was provided');
      }

      return validated.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Intent classification failed';
      console.warn('[IntentClassifier] Live classification unavailable:', message);
      throw new Error(`INTENT_CLASSIFICATION_FAILED:${message}`);
    }
  }
}

export const intentClassifierService = new IntentClassifierService();
