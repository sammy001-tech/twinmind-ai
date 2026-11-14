import { GoogleGenAI } from '@google/genai';
import { settingsManager } from '../db/settingsService.ts';
import { modelCatalogService, type ProviderId } from './modelCatalogService.ts';
import { callWithBoundedRetry } from '../utils/retryHelper.ts';
import type {
  CommunicationStyleAnalysis,
  SentimentDataPoint,
  ToneBreakdown,
  TwinPersonaAdaptation,
  PerceivedTrait,
} from '../../src/types/index.ts';

interface RawMessage {
  role: string;
  content: string;
  created_at?: string;
}

export interface AnalyzeStyleOptions {
  provider?: string;
  model?: string;
  customGeminiKey?: string;
  customGroqKey?: string;
  customMistralKey?: string;
  mode?: 'fast' | 'full';
  signal?: AbortSignal;
}

class CommunicationStyleService {
  private resolveProviderKey(
    provider: ProviderId,
    options: AnalyzeStyleOptions,
  ): string {
    const s = settingsManager.getSettings();
    const candidate = provider === 'gemini'
      ? (options.customGeminiKey || s.customGeminiKey || process.env.GEMINI_API_KEY)
      : provider === 'groq'
        ? (options.customGroqKey || s.customGroqKey || process.env.GROQ_API_KEY)
        : (options.customMistralKey || s.customMistralKey || process.env.MISTRAL_API_KEY);
    if (!candidate || typeof candidate !== 'string') return '';
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.includes('your_') || trimmed.includes('_here')) return '';
    return trimmed;
  }

  private resolveActiveStyleProvider(options: AnalyzeStyleOptions): {
    provider: ProviderId;
    apiKey: string;
    configuredModel: string;
  } | null {
    const s = settingsManager.getSettings();
    const preferredOrder: ProviderId[] = [];
    const candidateProvider = (options.provider || s.activeProvider || '').toLowerCase();
    if (candidateProvider === 'gemini' || candidateProvider === 'groq' || candidateProvider === 'mistral') {
      preferredOrder.push(candidateProvider);
    }
    for (const fallback of ['gemini', 'groq', 'mistral'] as const) {
      if (!preferredOrder.includes(fallback)) preferredOrder.push(fallback);
    }

    for (const provider of preferredOrder) {
      const apiKey = this.resolveProviderKey(provider, options);
      if (!apiKey) continue;
      const configuredModel =
        (provider === candidateProvider && options.model) ||
        s.providerModels?.[provider] ||
        (s.activeProvider === provider ? s.activeModel : '') ||
        '';
      return { provider, apiKey, configuredModel };
    }
    return null;
  }

  /**
   * Deterministic NLP heuristic analyzer for user text messages.
   * Derives real metrics dynamically with zero external latency when fast mode is selected
   * or when no live provider is configured.
   */
  public analyzeMessageHeuristically(text: string, index: number, timestamp: string): SentimentDataPoint {
    const lower = text.toLowerCase();

    // Frustration signals
    const frustKeywords = [
      'annoyed', 'frustrated', 'broken', 'error', 'wrong', 'hate', 'terrible',
      'fail', 'stuck', 'issue', 'bad', 'angry', 'slow', 'doesnt work', "doesn't work",
      'hardcoded', 'parch', 'bug', 'crash', 'useless',
    ];
    const frustMatches = frustKeywords.filter((k) => lower.includes(k)).length;
    const exclamationCount = (text.match(/!/g) || []).length;
    const angryEmojiCount = (text.match(/😠|😡|🤬|😒|😤|👿|❌|💣/g) || []).length;

    // Positive / Enthusiastic signals
    const posKeywords = [
      'great', 'awesome', 'excellent', 'love', 'perfect', 'amazing', 'thanks',
      'thank you', 'good', 'super', 'wonderful', 'nicely', 'clean', 'helpful',
    ];
    const posMatches = posKeywords.filter((k) => lower.includes(k)).length;
    const happyEmojiCount = (text.match(/😊|😄|🚀|❤️|👍|🎉|✨|🔥|👏/g) || []).length;

    // Analytical / Technical / Deep Learning signals
    const techKeywords = [
      'architecture', 'vector', 'database', 'endpoint', 'schema', 'api', 'function',
      'async', 'typescript', 'component', 'optimis', 'query', 'postgres', 'service',
      'class', 'algorithm', 'benchmark', 'protocol', 'sql', 'graphql', 'ocr',
    ];
    const techMatches = techKeywords.filter((k) => lower.includes(k)).length;
    const codeBlockCount = (text.match(/```/g) || []).length / 2;
    const questionMarkCount = (text.match(/\?/g) || []).length;

    // Urgency signals
    const urgentKeywords = [
      'urgent', 'asap', 'immediately', 'now', 'quick', 'fast', 'fix',
      'broken', 'critical', 'root', 'emergency', 'concise', 'brief',
    ];
    const urgentMatches = urgentKeywords.filter((k) => lower.includes(k)).length;

    // Politeness / Formality
    const formalKeywords = [
      'please', 'kindly', 'regards', 'ensure', 'appreciate', 'furthermore',
      'accordingly', 'solution', 'explain', 'overview',
    ];
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
    } else if (text.length < 40 && (exclamationCount > 0 || questionMarkCount > 0 || urgentMatches > 0)) {
      sentiment = 'direct';
      score = -0.05;
      dominantEmotion = 'Direct & Concise Request';
    }

    const urgency = Math.min(
      10,
      Math.round(urgentMatches * 3 + angryEmojiCount * 2 + exclamationCount * 1.5 + (sentiment === 'frustrated' ? 3 : 0)),
    );
    const formality = Math.min(
      10,
      Math.round(formalMatches * 2.5 + (techMatches > 0 ? 2 : 0) + (angryEmojiCount > 0 ? -2 : 1) + 4),
    );
    const technicalDepth = Math.min(
      10,
      Math.round(techMatches * 2.5 + codeBlockCount * 4 + (text.length > 200 ? 2 : 0)),
    );

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

  private async runModelToneEvaluation(
    provider: ProviderId,
    model: string,
    apiKey: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (provider === 'gemini') {
      const aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build-communication-style' },
        },
      });
      const res = await callWithBoundedRetry(
        () =>
          aiClient.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
        { operationName: `StyleAnalysis(${provider}:${model})`, maxRetries: 1, signal },
      );
      return res.text || '';
    }

    const endpoint = provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://api.mistral.ai/v1/chat/completions';

    const res = await callWithBoundedRetry(
      async () => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            response_format: { type: 'json_object' },
          }),
          signal,
        });
        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`${provider} API error (${response.status}): ${errText}`);
        }
        return await response.json();
      },
      { operationName: `StyleAnalysis(${provider}:${model})`, maxRetries: 1, signal },
    );

    return res.choices?.[0]?.message?.content || '';
  }

  /**
   * Analyze user communication style over time using either fast zero-latency deterministic NLP
   * or live model evaluation dynamically routed through whichever provider (Gemini/Groq/Mistral) is configured.
   */
  public async analyzeCommunicationStyle(
    messages: RawMessage[],
    options: AnalyzeStyleOptions = {},
  ): Promise<CommunicationStyleAnalysis> {
    const userMessages = messages.filter((m) => m.role === 'user' && m.content && m.content.trim());

    if (userMessages.length === 0) {
      return {
        totalAnalyzedMessages: 0,
        overallSentiment: 'Neutral & Observant',
        averageScore: 0.0,
        toneBreakdown: [{ label: 'Neutral', percentage: 100, color: '#94a3b8' }],
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
        analysisSource: 'deterministic_heuristic',
      };
    }

    const mode = options.mode || 'full';
    let aiTimeline: SentimentDataPoint[] | null = null;
    let aiPersona: TwinPersonaAdaptation | null = null;
    let aiInsights: string[] | null = null;
    let analysisSource: 'live_model' | 'deterministic_heuristic' = 'deterministic_heuristic';
    let analyzedProvider: string | undefined;
    let analyzedModel: string | undefined;

    if (mode === 'full') {
      const activeTarget = this.resolveActiveStyleProvider(options);
      if (activeTarget) {
        try {
          const liveModel = await modelCatalogService.resolveModelForProvider(
            activeTarget.provider,
            activeTarget.configuredModel,
            activeTarget.apiKey,
          );

          if (liveModel) {
            const sampleMessages = userMessages.slice(-15).map((m, idx) => ({
              index: idx + 1,
              time: m.created_at || new Date().toISOString(),
              content: m.content.slice(0, 300),
            }));

            const prompt = `You are an expert psycholinguist analyzing user communication style in an AI assistant chat.
Analyze the following user messages chronologically:
${JSON.stringify(sampleMessages, null, 2)}

Return ONLY a valid JSON object matching this exact schema:
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
      "dominantEmotion": "string"
    }
  ],
  "overallSentiment": "string description",
  "personaAdaptation": {
    "activeToneMode": "string",
    "recommendedPacing": "concise_fast" | "balanced" | "empathetic_thorough" | "deep_technical",
    "empathyLevel": number 0 to 100,
    "formalityTarget": number 0 to 100,
    "adaptedBehaviors": ["string guideline 1", "string guideline 2", "string guideline 3"],
    "explanation": "string explanation of why persona is tuned to match user emotional state"
  },
  "keyEmotionalInsights": ["insight 1", "insight 2"]
}`;

            const rawJson = await this.runModelToneEvaluation(
              activeTarget.provider,
              liveModel,
              activeTarget.apiKey,
              prompt,
              options.signal,
            );

            if (rawJson) {
              const parsed = JSON.parse(rawJson);
              if (Array.isArray(parsed.timeline) && parsed.timeline.length > 0) {
                analysisSource = 'live_model';
                analyzedProvider = activeTarget.provider;
                analyzedModel = liveModel;
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
          console.warn('[CommunicationStyleService] Live model evaluation fell back to deterministic NLP:', err);
        }
      }
    }

    const timeline: SentimentDataPoint[] = aiTimeline || userMessages.map((msg, i) =>
      this.analyzeMessageHeuristically(
        msg.content,
        i,
        msg.created_at || new Date().toISOString(),
      ),
    );

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

    let overallSentiment = 'Balanced & Collaborative';
    if (avgScore < -0.3) overallSentiment = 'Critique-Focused & Urgent';
    else if (avgScore > 0.4) overallSentiment = 'Enthusiastic & High-Satisfaction';
    else if (sentimentCounts['frustrated'] > 0) overallSentiment = 'Demanding Root-Cause Directness';
    else if (sentimentCounts['analytical'] > 0) overallSentiment = 'Deeply Analytical & Technical';
    else if (sentimentCounts['direct'] > 0) overallSentiment = 'Direct & Action-Oriented';

    let personaAdaptation: TwinPersonaAdaptation = aiPersona || {
      activeToneMode: 'Balanced, Clear & Evidence-Led',
      recommendedPacing: 'balanced',
      empathyLevel: 60,
      formalityTarget: 55,
      adaptedBehaviors: [
        'Match complexity proportionally to the question',
        'Keep formatting scannable without unnecessary preamble',
        'Cite verified evidence transparently when tools run',
      ],
      explanation: 'Balanced communication profile calibrated dynamically from conversational turns.',
    };

    if (!aiPersona) {
      const avgUrgencyCheck = timeline.length > 0 ? timeline.reduce((acc, t) => acc + t.urgency, 0) / timeline.length : 0;
      const isFrustrated = (sentimentCounts['frustrated'] || 0) > 0 || avgScore < -0.2;
      const isAnalytical = (sentimentCounts['analytical'] || 0) > 0;
      const isEnthusiastic = (sentimentCounts['enthusiastic'] || 0) > 0;
      const isDirectUrgent = !isFrustrated && (avgUrgencyCheck >= 4 || (sentimentCounts['direct'] || 0) > timeline.length * 0.5);

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
      } else if (isDirectUrgent) {
        personaAdaptation = {
          activeToneMode: 'High-Velocity Operational Directness',
          recommendedPacing: 'concise_fast',
          empathyLevel: 50,
          formalityTarget: 45,
          adaptedBehaviors: [
            'Lead immediately with the bottom-line answer and actionable step',
            'Skip introductory filler and background recap unless asked',
          ],
          explanation: 'User inputs reflect high urgency or direct command phrasing requiring fast turnaround.',
        };
      } else if (isAnalytical) {
        personaAdaptation = {
          activeToneMode: 'Empirical, Structural & Architectural',
          recommendedPacing: 'deep_technical',
          empathyLevel: 45,
          formalityTarget: 70,
          adaptedBehaviors: [
            'Provide explicit schema definitions and data flow breakdowns',
            'Expose architectural rationale alongside code or analysis',
            'Use precise technical terminology without oversimplification',
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
      analysisSource,
      ...(analyzedProvider ? { analyzedProvider } : {}),
      ...(analyzedModel ? { analyzedModel } : {}),
    };
  }

  /**
   * Generates system prompt instruction directive for TwinAgent execution.
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
