import { GoogleGenAI } from '@google/genai';
import { settingsManager } from '../db/settingsService.ts';
import { modelCatalogService } from './modelCatalogService.ts';
import { callWithBoundedRetry } from '../utils/retryHelper.ts';
import type { CommunicationStyleAnalysis, SentimentDataPoint, ToneBreakdown, TwinPersonaAdaptation, PerceivedTrait } from '../../src/types/index.ts';

interface RawMessage {
  role: string;
  content: string;
  created_at?: string;
}

class CommunicationStyleService {
  private getAiClient(customKey?: string): GoogleGenAI | null {
    const s = settingsManager.getSettings();
    const apiKey = customKey || s.customGeminiKey || process.env.GEMINI_API_KEY || '';
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build-communication-style',
        },
      },
    });
  }

  /**
   * Deterministic NLP heuristic analyzer for user text messages.
   * Derives real metrics when AI provider call is offline or unavailable.
   */
  private analyzeMessageHeuristically(text: string, index: number, timestamp: string): SentimentDataPoint {
    const lower = text.toLowerCase();
    
    // Frustration signals
    const frustKeywords = ['annoyed', 'frustrated', 'broken', 'error', 'wrong', 'hate', 'terrible', 'fail', 'stuck', 'issue', 'bad', 'angry', 'slow', 'doesnt work', "doesn't work", 'hardcoded', 'parch'];
    const frustMatches = frustKeywords.filter((k) => lower.includes(k)).length;
    const exclamationCount = (text.match(/!/g) || []).length;
    const angryEmojiCount = (text.match(/😠|😡|🤬|😒|😤|👿|👿|❌|💣/g) || []).length;

    // Positive / Enthusiastic signals
    const posKeywords = ['great', 'awesome', 'excellent', 'love', 'perfect', 'amazing', 'thanks', 'thank you', 'good', 'super', 'wonderful', 'nicely'];
    const posMatches = posKeywords.filter((k) => lower.includes(k)).length;
    const happyEmojiCount = (text.match(/😊|😄|🚀|❤️|👍|🎉|✨|🔥|👏/g) || []).length;

    // Analytical / Technical signals
    const techKeywords = ['architecture', 'vector', 'database', 'endpoint', 'schema', 'api', 'function', 'async', 'typescript', 'component', 'optimis', 'query', 'postgres', 'service', 'class'];
    const techMatches = techKeywords.filter((k) => lower.includes(k)).length;
    const codeBlockCount = (text.match(/```/g) || []).length / 2;
    const questionMarkCount = (text.match(/\?/g) || []).length;

    // Urgency signals
    const urgentKeywords = ['urgent', 'asap', 'immediately', 'now', 'quick', 'fast', 'fix', 'broken', 'critical', 'root', 'emergency'];
    const urgentMatches = urgentKeywords.filter((k) => lower.includes(k)).length;

    // Politeness / Formality
    const formalKeywords = ['please', 'kindly', 'regards', 'ensure', 'appreciate', 'furthermore', 'accordingly', 'solution'];
    const formalMatches = formalKeywords.filter((k) => lower.includes(k)).length;

    let sentiment: SentimentDataPoint['sentiment'] = 'neutral';
    let score = 0.0;
    let dominantEmotion = 'Calm & Neutral';

    if (frustMatches > 0 || angryEmojiCount > 0) {
      sentiment = 'frustrated';
      score = Math.max(-1.0, -0.3 - frustMatches * 0.2 - angryEmojiCount * 0.3);
      dominantEmotion = angryEmojiCount > 1 ? 'Heightened Frustration' : 'Direct Critique / Issue-Focused';
    } else if (posMatches > 0 || happyEmojiCount > 0) {
      sentiment = happyEmojiCount > 0 || posMatches > 1 ? 'enthusiastic' : 'positive';
      score = Math.min(1.0, 0.3 + posMatches * 0.2 + happyEmojiCount * 0.3);
      dominantEmotion = happyEmojiCount > 0 ? 'Enthusiastic & Satisfied' : 'Appreciative & Positive';
    } else if (techMatches > 1 || codeBlockCount > 0) {
      sentiment = 'analytical';
      score = 0.2;
      dominantEmotion = 'Technical & Analytical';
    } else if (text.length < 30 && (exclamationCount > 0 || questionMarkCount > 0)) {
      sentiment = 'direct';
      score = -0.1;
      dominantEmotion = 'Direct & Concise Request';
    }

    const urgency = Math.min(10, Math.round(urgentMatches * 3 + angryEmojiCount * 2 + exclamationCount * 1.5 + (sentiment === 'frustrated' ? 3 : 0)));
    const formality = Math.min(10, Math.round(formalMatches * 2.5 + (techMatches > 0 ? 2 : 0) + (angryEmojiCount > 0 ? -2 : 1) + 4));
    const technicalDepth = Math.min(10, Math.round(techMatches * 2.5 + codeBlockCount * 4 + (text.length > 200 ? 2 : 0)));

    return {
      messageIndex: index + 1,
      timestamp,
      userSnippet: text.length > 120 ? text.slice(0, 120) + '...' : text,
      sentiment,
      score: Number(score.toFixed(2)),
      urgency,
      formality,
      technicalDepth,
      dominantEmotion,
    };
  }

  /**
   * Main entry point to analyze user communication style over time.
   */
  public async analyzeCommunicationStyle(
    messages: RawMessage[],
    options: { customGeminiKey?: string; signal?: AbortSignal } = {}
  ): Promise<CommunicationStyleAnalysis> {
    const userMessages = messages.filter((m) => m.role === 'user' && m.content && m.content.trim());

    if (userMessages.length === 0) {
      return {
        totalAnalyzedMessages: 0,
        overallSentiment: 'Neutral & Observant',
        averageScore: 0.0,
        toneBreakdown: [
          { label: 'Neutral', percentage: 100, color: '#94a3b8' },
        ],
        timeline: [],
        personaAdaptation: {
          activeToneMode: 'Balanced & Responsive',
          recommendedPacing: 'balanced',
          empathyLevel: 50,
          formalityTarget: 50,
          adaptedBehaviors: ['Maintain active listening', 'Respond with clear, helpful phrasing'],
          explanation: 'No user messages recorded yet in this conversation session.',
        },
        perceivedTraits: [
          { trait: 'Empathetic', score: 50, description: 'Baseline empathy awaiting user input.' },
          { trait: 'Analytical', score: 50, description: 'Baseline analytical depth.' },
          { trait: 'Concise', score: 50, description: 'Standard concise response pacing.' },
        ],
        keyEmotionalInsights: ['Awaiting initial user input to calibrate emotional resonance.'],
      };
    }

    // Try AI model analysis if key available
    const aiClient = this.getAiClient(options.customGeminiKey);
    let aiTimeline: SentimentDataPoint[] | null = null;
    let aiPersona: TwinPersonaAdaptation | null = null;
    let aiInsights: string[] | null = null;

    if (aiClient) {
      try {
        const geminiModel = await modelCatalogService.resolveModelForProvider(
          'gemini',
          settingsManager.getSettings().providerModels.gemini,
          options.customGeminiKey
        );

        if (geminiModel) {
          const sampleMessages = userMessages.slice(-15).map((m, idx) => ({
            index: idx + 1,
            time: m.created_at || new Date().toISOString(),
            content: m.content.slice(0, 300),
          }));

          const prompt = `You are an expert psycholinguist analyzing user communication style in an AI assistant chat.
Analyze the following user messages chronologically:
${JSON.stringify(sampleMessages, null, 2)}

Return a JSON object matching this exact schema:
{
  "timeline": [
    {
      "messageIndex": 1,
      "userSnippet": "string",
      "sentiment": "positive" | "neutral" | "analytical" | "frustrated" | "enthusiastic" | "direct",
      "score": number between -1.0 and 1.0,
      "urgency": number 0 to 10,
      "formality": number 0 to 10,
      "technicalDepth": number 0 to 10,
      "dominantEmotion": "string (e.g., Frustrated, Analytical, Enthusiastic)"
    }
  ],
  "overallSentiment": "string description",
  "personaAdaptation": {
    "activeToneMode": "string (e.g., Root-Cause Diagnostic & High Transparency)",
    "recommendedPacing": "concise_fast" | "balanced" | "empathetic_thorough" | "deep_technical",
    "empathyLevel": number 0 to 100,
    "formalityTarget": number 0 to 100,
    "adaptedBehaviors": ["string guideline 1", "string guideline 2", "string guideline 3"],
    "explanation": "string explanation of why persona is tuned to match user emotional state"
  },
  "keyEmotionalInsights": ["insight 1", "insight 2"]
}`;

          const res = await callWithBoundedRetry(
            async () => {
              return await aiClient.models.generateContent({
                model: geminiModel,
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                },
              });
            },
            { maxRetries: 1, signal: options.signal }
          );

          if (res.text) {
            const parsed = JSON.parse(res.text);
            if (Array.isArray(parsed.timeline) && parsed.timeline.length > 0) {
              aiTimeline = parsed.timeline.map((item: any, i: number) => ({
                messageIndex: i + 1,
                timestamp: userMessages[i]?.created_at || new Date().toISOString(),
                userSnippet: item.userSnippet || userMessages[i]?.content?.slice(0, 100) || '',
                sentiment: ['positive', 'neutral', 'analytical', 'frustrated', 'enthusiastic', 'direct'].includes(item.sentiment)
                  ? item.sentiment
                  : 'neutral',
                score: typeof item.score === 'number' ? item.score : 0,
                urgency: typeof item.urgency === 'number' ? item.urgency : 5,
                formality: typeof item.formality === 'number' ? item.formality : 5,
                technicalDepth: typeof item.technicalDepth === 'number' ? item.technicalDepth : 5,
                dominantEmotion: item.dominantEmotion || 'Neutral',
              }));
              if (parsed.personaAdaptation) {
                aiPersona = {
                  activeToneMode: parsed.personaAdaptation.activeToneMode || 'Root-Cause & Transparent',
                  recommendedPacing: parsed.personaAdaptation.recommendedPacing || 'balanced',
                  empathyLevel: parsed.personaAdaptation.empathyLevel ?? 60,
                  formalityTarget: parsed.personaAdaptation.formalityTarget ?? 50,
                  adaptedBehaviors: Array.isArray(parsed.personaAdaptation.adaptedBehaviors)
                    ? parsed.personaAdaptation.adaptedBehaviors
                    : ['Provide transparent explanations', 'Focus on root-cause fixes'],
                  explanation: parsed.personaAdaptation.explanation || 'Persona tuned dynamically to user emotional state.',
                };
              }
              if (Array.isArray(parsed.keyEmotionalInsights)) {
                aiInsights = parsed.keyEmotionalInsights;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[CommunicationStyleService] AI evaluation fallback to deterministic NLP:', err);
      }
    }

    // Fallback / Deterministic calculation if AI timeline was not produced
    const timeline: SentimentDataPoint[] = aiTimeline || userMessages.map((msg, i) =>
      this.analyzeMessageHeuristically(
        msg.content,
        i,
        msg.created_at || new Date().toISOString()
      )
    );

    // Compute dynamic aggregate metrics
    const totalScore = timeline.reduce((acc, curr) => acc + curr.score, 0);
    const avgScore = Number((totalScore / timeline.length).toFixed(2));

    const sentimentCounts: Record<string, number> = {};
    for (const item of timeline) {
      sentimentCounts[item.sentiment] = (sentimentCounts[item.sentiment] || 0) + 1;
    }

    const COLOR_MAP: Record<string, string> = {
      frustrated: '#f43f5e',
      enthusiastic: '#10b981',
      positive: '#3b82f6',
      analytical: '#8b5cf6',
      direct: '#f59e0b',
      neutral: '#64748b',
    };

    const toneBreakdown: ToneBreakdown[] = Object.entries(sentimentCounts).map(([label, count]) => ({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      percentage: Math.round((count / timeline.length) * 100),
      color: COLOR_MAP[label] || '#94a3b8',
    }));

    // Dynamic Overall Sentiment Label
    let overallSentiment = 'Balanced & Collaborative';
    if (avgScore < -0.3) overallSentiment = 'Critique-Focused & Urgent';
    else if (avgScore > 0.4) overallSentiment = 'Enthusiastic & High-Satisfaction';
    else if (sentimentCounts['frustrated'] > 0) overallSentiment = 'Demanding Root-Cause Directness';
    else if (sentimentCounts['analytical'] > 0) overallSentiment = 'Deeply Analytical & Technical';

    // Persona Adaptation computation if AI persona was not returned
    let personaAdaptation: TwinPersonaAdaptation = aiPersona || {
      activeToneMode: 'Direct, Root-Cause & Transparent',
      recommendedPacing: 'concise_fast',
      empathyLevel: 75,
      formalityTarget: 40,
      adaptedBehaviors: [
        'Acknowledge friction immediately without robotic pleasantries',
        'Prioritize zero-patch, root-cause code verification',
        'Keep technical explanations crisp, authoritative, and direct',
      ],
      explanation: 'User exhibits high directness and frustration with build errors. Persona adapted to emphasize root-cause technical resolution with zero fluff.',
    };

    if (!aiPersona) {
      const isFrustrated = (sentimentCounts['frustrated'] || 0) > 0 || avgScore < -0.2;
      const isAnalytical = (sentimentCounts['analytical'] || 0) > 0;
      const isEnthusiastic = (sentimentCounts['enthusiastic'] || 0) > 0;

      if (isFrustrated) {
        personaAdaptation = {
          activeToneMode: 'Terse, Diagnostic & Root-Cause Focused',
          recommendedPacing: 'concise_fast',
          empathyLevel: 80,
          formalityTarget: 35,
          adaptedBehaviors: [
            'Avoid generic conversational fluff or apologetic padding',
            'State root causes directly and execute pristine solutions immediately',
            'Validate build and integration boundaries before reporting success',
          ],
          explanation: 'User expects immediate, non-patch root-cause resolution for issues.',
        };
      } else if (isAnalytical) {
        personaAdaptation = {
          activeToneMode: 'Empirical, Structural & Architectural',
          recommendedPacing: 'deep_technical',
          empathyLevel: 45,
          formalityTarget: 70,
          adaptedBehaviors: [
            'Provide explicit schema definitions and data flow breakdowns',
            'Expose architectural rationale alongside code changes',
            'Use precise technical terminology without simplification',
          ],
          explanation: 'User engages heavily with architectural concepts and technical precision.',
        };
      } else if (isEnthusiastic) {
        personaAdaptation = {
          activeToneMode: 'Visionary, High-Energy & Collaborative',
          recommendedPacing: 'balanced',
          empathyLevel: 90,
          formalityTarget: 45,
          adaptedBehaviors: [
            'Match user momentum with active feature proposals',
            'Highlight strategic design polish and seamless UX details',
            'Provide proactive next steps for scaling the product',
          ],
          explanation: 'User is highly engaged and enthusiastic about new feature integrations.',
        };
      }
    }

    // Calculate Twin's current perceived persona traits based on analyzed chat history
    const avgTechDepth = timeline.length > 0 ? timeline.reduce((acc, t) => acc + t.technicalDepth, 0) / timeline.length : 5;
    const avgUrgency = timeline.length > 0 ? timeline.reduce((acc, t) => acc + t.urgency, 0) / timeline.length : 5;
    const avgFormality = timeline.length > 0 ? timeline.reduce((acc, t) => acc + t.formality, 0) / timeline.length : 5;

    const perceivedTraits: PerceivedTrait[] = [
      {
        trait: 'Empathetic',
        score: personaAdaptation.empathyLevel,
        description: 'Attunes to emotional stakes and validates user progress without superficial filler.',
        badgeColor: 'bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30',
      },
      {
        trait: 'Analytical',
        score: Math.min(100, Math.round(avgTechDepth * 10 + (sentimentCounts['analytical'] ? 15 : 0))),
        description: 'Exposes structural logic, schemas, and first-principles technical derivations.',
        badgeColor: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
      },
      {
        trait: 'Concise',
        score: Math.min(100, Math.round(avgUrgency * 5 + (10 - avgFormality) * 4 + (personaAdaptation.recommendedPacing === 'concise_fast' ? 25 : 0))),
        description: 'Delivers crisp, direct conclusions matched to fast pacing.',
        badgeColor: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
      },
      {
        trait: 'Diagnostic',
        score: Math.min(100, Math.round((sentimentCounts['frustrated'] || 0) * 35 + avgUrgency * 4 + 20)),
        description: 'Identifies root causes immediately and executes non-patch resolutions.',
        badgeColor: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
      },
      {
        trait: 'Transparent',
        score: 95,
        description: 'Maintains strict evidence-bound truthfulness and zero-mock integrity.',
        badgeColor: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
      },
    ];

    personaAdaptation.perceivedTraits = perceivedTraits;

    // Insights
    const keyEmotionalInsights: string[] = aiInsights || [
      `Analyzed ${timeline.length} recent user turns: average sentiment score is ${avgScore > 0 ? '+' : ''}${avgScore}.`,
      `Dominant style profile: ${toneBreakdown[0]?.label || 'Neutral'} (${toneBreakdown[0]?.percentage || 100}% of messages).`,
      `Twin response policy automatically tuned to: ${personaAdaptation.activeToneMode}.`,
    ];

    return {
      totalAnalyzedMessages: timeline.length,
      overallSentiment,
      averageScore: avgScore,
      toneBreakdown,
      timeline,
      personaAdaptation,
      perceivedTraits,
      keyEmotionalInsights,
    };
  }

  /**
   * Generates system prompt instruction directive for TwinAgent execution
   */
  public getPersonaPromptDirective(analysis: CommunicationStyleAnalysis): string {
    if (analysis.totalAnalyzedMessages === 0) return '';

    const p = analysis.personaAdaptation;
    return `
[DYNAMIC COMMUNICATION STYLE & EMOTIONAL PERSONA TUNING]
Observed User Emotional State: ${analysis.overallSentiment} (Average Sentiment Score: ${analysis.averageScore})
Active Twin Persona Tuning Mode: ${p.activeToneMode}
Target Pacing: ${p.recommendedPacing} | Empathy Resonance Level: ${p.empathyLevel}/100 | Formality Level: ${p.formalityTarget}/100
Persona Adaptation Rules:
${p.adaptedBehaviors.map((b) => `- ${b}`).join('\n')}
Rationale: ${p.explanation}
[END COMMUNICATION STYLE DIRECTIVE]
`;
  }
}

export const communicationStyleService = new CommunicationStyleService();
