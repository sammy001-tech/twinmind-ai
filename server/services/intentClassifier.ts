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
    const trimmed = (userMessage || '').trim();
    if (!trimmed) {
      return {
        intent: 'GENERAL_CHAT',
        confidence: 1.0,
        reasoning: 'Empty message',
        extractedParams: {},
        requiresClarification: false,
      };
    }

    const systemInstruction = `You are TwinMind's Natural Language Intent Classifier.
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
        temperature: 0.1, // Low temperature for consistent classification
      });

      const parsed = JSON.parse(rawRes || '{}');
      const validated = ClassifiedIntentSchema.safeParse(parsed);

      if (validated.success) {
        return validated.data;
      }

      console.warn('[IntentClassifier] Zod validation failed for LLM classification output:', validated.error.format());
      
      // Secondary fallback attempt if schema validation failed on minor type details
      return {
        intent: (parsed.intent as IntentType) || 'GENERAL_CHAT',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
        reasoning: parsed.reasoning || 'Unvalidated output structure',
        extractedParams: {
          debateTopic: parsed.extractedParams?.debateTopic || (parsed.intent === 'DEBATE_REQUEST' ? trimmed : undefined),
          targetDecisionId: parsed.extractedParams?.targetDecisionId,
          reportedStatus: parsed.extractedParams?.reportedStatus,
          reportedNotes: parsed.extractedParams?.reportedNotes,
          searchQuery: parsed.extractedParams?.searchQuery,
        },
        requiresClarification: Boolean(parsed.requiresClarification) || (typeof parsed.confidence === 'number' && parsed.confidence < 0.75),
        clarificationPrompt: parsed.clarificationPrompt,
      };
    } catch (err) {
      console.error('[IntentClassifier] Intent classification error:', err);
      return {
        intent: 'GENERAL_CHAT',
        confidence: 0.7,
        reasoning: 'Fallback due to classification exception',
        extractedParams: {},
        requiresClarification: false,
      };
    }
  }
}

export const intentClassifierService = new IntentClassifierService();
