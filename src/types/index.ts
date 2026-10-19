export type ChannelType = 'web' | 'telegram' | 'whatsapp';

export const APP_TYPES = true;

export interface LiveModelInfo {
  id: string;
  displayName: string;
  description?: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  role: string;
  enabled: boolean;
  hasKey: boolean;
  models: LiveModelInfo[];
  selectedModel: string;
}

export interface GeneratedArtifact {
  /** Storage identifier used only to resolve the protected download route. */
  name: string;
  /** Signed, time-limited application download path returned by the server. */
  url: string;
  type: string;
  displayName?: string;
  mimeType?: string;
  sizeBytes?: number;
  generatedAt?: string;
  validationStatus?: 'validated';
}

export interface LiveResearchActivity {
  toolId: string;
  toolName: 'searchWeb' | 'extractWebPages';
  status: 'running' | 'completed' | 'error';
  input?: Record<string, unknown>;
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  dbId?: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  createdAt?: number;
  channel?: ChannelType;
  audioUrl?: string;
  audioData?: { mimeType: string; data: string };
  imageData?: { mimeType: string; data: string; name?: string };
  isGeneratingAudio?: boolean;
  status?: 'pending' | 'accepted' | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'undelivered' | 'error';
  processingStatus?: 'processing' | 'completed' | 'failed';
  modelInfo?: {
    provider: string;
    model: string;
  };
  reactions?: string[];
  swarmTrace?: SwarmSessionState;
  researchActivity?: LiveResearchActivity[];
  artifacts?: GeneratedArtifact[];
}

export interface SwarmToolCall {
  toolName: string;
  specialist: string;
  status: 'pending' | 'success' | 'error';
  durationMs?: number;
  input?: Record<string, unknown>;
  outputSummary?: string;
  result?: unknown;
}

export interface SwarmSpecialistProgress {
  specialist: string;
  role: string;
  taskDescription: string;
  status: 'pending' | 'active' | 'done' | 'error';
  durationMs?: number;
  summaryPreview?: string;
  tools: SwarmToolCall[];
}

export interface SwarmSessionState {
  sessionId: string;
  goal: string;
  specialists: string[];
  activeSpecialist?: string;
  specialistProgress: SwarmSpecialistProgress[];
  status: 'running' | 'completed' | 'aborted' | 'error';
  totalDurationMs?: number;
}

export interface ChatThread {
  id: string;
  title: string;
  channel?: ChannelType;
  created_at?: string;
  updated_at?: string;
  message_count?: number;
  last_message?: string;
}

export interface UserContext {
  nickname?: string;
  userName?: string;
  activeModel?: string;
  activeProvider?: string;
  selectedVoice?: string;
  channel?: ChannelType;
}

export interface KnowledgeItem {
  id: number | string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  similarity?: number;
  hasEmbedding?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DecisionAnalysis {
  actualSituation: string;
  confidenceLevel: 'High' | 'Medium' | 'Low';
  confidenceReason: string;
  whatMattersMost: string;
  realisticOptions: string[];
  tradeOffs: string;
  principalRisks: string;
  recommendedAction: string;
  nextPracticalStep: string;
  clarifyingQuestion?: string;
  challengerCritique?: {
    model: string;
    points: string[];
    agreementLevel: 'High Agreement' | 'Partial Disagreement' | 'Alternative Perspective';
  };
}

export interface PromptTemplate {
  title: string;
  prompt: string;
  badge?: string;
  category?: string;
  description?: string;
  desc?: string;
}

export interface KeyTestResult {
  status: 'idle' | 'testing' | 'success' | 'error';
  message?: string;
  testedAt?: string;
}

export type KeyTestStatusMap = Record<string, KeyTestResult>;

export interface SoulTuningConfig {
  tone: number; // 0 (analytical/empirical) to 100 (empathetic/warm)
  directness: number; // 0 (concise/bulleted) to 100 (comprehensive/deep dive)
  perspective: number; // 0 (skeptical/devil's advocate) to 100 (visionary/optimistic)
}

export interface AppSettings {
  brandName?: string;
  activeProvider: 'gemini' | 'groq' | 'mistral' | '';
  activeModel: string;
  providerModels: {
    gemini: string;
    groq: string;
    mistral: string;
  };
  voice: string;
  ttsModel?: string;
  userName: string;
  nickname: string;
  customGeminiKey?: string;
  customGroqKey?: string;
  customMistralKey?: string;
  customTavilyKey?: string;
  autoPlayVoice?: boolean;
  voiceSpeed?: number;
  customPrompts?: PromptTemplate[];
  activeThreadId?: string | null;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  telegramToken?: string;
  telegramMode?: 'polling' | 'webhook';
  telegramWebhookUrl?: string;
  telegramOwnerId?: string;
  twilioWhatsAppNumber?: string;
  userPhoneNumber?: string;
  enableWhatsAppAlerts?: boolean;
  enforceTwilioSignature?: boolean;
  proactiveAlertChannel?: 'whatsapp' | 'telegram' | 'none';
  keyTestStatuses?: KeyTestStatusMap;
  themeMode?: 'dark' | 'light' | 'system';
  soulTuning?: SoulTuningConfig;
  webGroundingEnabled?: boolean;
}


