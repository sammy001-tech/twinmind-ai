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
  beliefConflict?: BeliefConflict;
  autonomousMemory?: AutonomousMemoryEvent;
  verificationEnvelope?: VerificationEnvelope;
  instructionManifest?: InstructionResolutionManifest;
}

export interface AutonomousMemoryEvent {
  id: string;
  action: 'update_existing' | 'create_new' | 'remove_rule' | 'delete_doc';
  target?: 'vault' | 'rule';
  ruleId?: number;
  docId: number | string;
  docTitle: string;
  category: string;
  confidenceScore: number; // 0 to 100
  tier: 'architectural' | 'preference' | 'workflow';
  summary: string;
  updatedContent?: string;
  previousContent?: string;
  userStatementSnippet: string;
  timestamp: string;
}

export interface BeliefConflict {
  id: string;
  existingDocId: number | string;
  existingTitle: string;
  existingExcerpt: string;
  conflictType: 'direct_contradiction' | 'policy_pivot' | 'preference_update';
  explanation: string;
  userStatement: string;
  suggestedAction: 'update_record' | 'retire_record' | 'mark_evolution';
  status?: 'pending' | 'resolved' | 'dismissed';
  resolutionAction?: 'update' | 'retire' | 'evolve';
}

export interface GraphNode {
  id: string;
  dbId: number | string;
  title: string;
  category: string;
  tags: string[];
  snippet: string;
  wordCount: number;
  hasEmbedding: boolean;
  createdAt: string;
  clusterGroup?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  radius?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'shared_tag' | 'shared_category' | 'semantic_similarity';
  weight: number;
  label?: string;
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  categories: Array<{ name: string; count: number; color: string }>;
  totalNodes: number;
  totalEdges: number;
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
  journey_id?: number | null;
  journey_title?: string | null;
  project_key?: string | null;
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

export type MemorySourceType =
  | 'direct_directive'
  | 'imported_doc'
  | 'in_turn_synthesis'
  | 'web_research'
  | 'legacy_import';

export type MemoryConfidenceStatus = 'confirmed' | 'provisional' | 'inferred';
export type MemoryImpactLevel = 'low' | 'medium' | 'high';
export type MemoryLifecycleStatus = 'active' | 'superseded' | 'conflicted' | 'unconfirmed';

export interface KnowledgeItem {
  id: number | string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  similarity?: number;
  hasEmbedding?: boolean;
  sourceType?: MemorySourceType;
  sourceRef?: string | null;
  confidenceStatus?: MemoryConfidenceStatus;
  impactLevel?: MemoryImpactLevel;
  lifecycleStatus?: MemoryLifecycleStatus;
  supersededById?: number | string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  lastVerifiedAt?: string | null;
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

export type ThinkingLevel = 'low' | 'medium' | 'high';

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
  telegramOwnerUsername?: string;
  telegramPairingCode?: string;
  twilioWhatsAppNumber?: string;
  userPhoneNumber?: string;
  enableWhatsAppAlerts?: boolean;
  enforceTwilioSignature?: boolean;
  proactiveAlertChannel?: 'whatsapp' | 'telegram' | 'none';
  keyTestStatuses?: KeyTestStatusMap;
  themeMode?: 'dark' | 'light' | 'system';
  soulTuning?: SoulTuningConfig;
  thinkingLevel?: ThinkingLevel;
  webGroundingEnabled?: boolean;
}

export interface SentimentDataPoint {
  messageIndex: number;
  timestamp: string;
  userSnippet: string;
  sentiment: 'positive' | 'neutral' | 'analytical' | 'frustrated' | 'enthusiastic' | 'direct';
  score: number; // -1.0 to +1.0
  urgency: number; // 0 to 10
  formality: number; // 0 to 10
  technicalDepth: number; // 0 to 10
  dominantEmotion: string;
}

export interface ToneBreakdown {
  label: string;
  percentage: number;
  color: string;
}

export interface PerceivedTrait {
  trait: string; // e.g. 'Empathetic', 'Analytical', 'Concise', 'Diagnostic', 'Transparent'
  score: number; // 0 to 100
  description: string;
  badgeColor?: string;
}

export interface TwinPersonaAdaptation {
  activeToneMode: string;
  recommendedPacing: 'concise_fast' | 'balanced' | 'empathetic_thorough' | 'deep_technical';
  empathyLevel: number; // 0 to 100
  formalityTarget: number; // 0 to 100
  adaptedBehaviors: string[];
  explanation: string;
  perceivedTraits?: PerceivedTrait[];
}

export interface CommunicationStyleAnalysis {
  totalAnalyzedMessages: number;
  overallSentiment: string;
  averageScore: number;
  toneBreakdown: ToneBreakdown[];
  timeline: SentimentDataPoint[];
  personaAdaptation: TwinPersonaAdaptation;
  perceivedTraits: PerceivedTrait[];
  keyEmotionalInsights: string[];
  analysisSource?: 'live_model' | 'deterministic_heuristic';
  analyzedProvider?: string;
  analyzedModel?: string;
}

export interface HistoricalInteractionMetadata {
  lastActivityDate: string | null;
  lastThreadTitle: string | null;
  recentThreads: Array<{ title: string; updatedAt: string }>;
  totalThreads: number;
}

export interface ThreadPinnedDoc {
  id: number;
  thread_id: string;
  file_name: string;
  format: string;
  content: string;
  char_count: number;
  created_at: string;
}

export type InstructionScope = 'permanent' | 'project' | 'temporary';

export interface PersonaMemoryRecord {
  id: number;
  category: 'preference' | 'opinion' | 'correction' | 'feedback' | string;
  content: string;
  priority: number;
  scope?: InstructionScope;
  project_key?: string | null;
  thread_id?: string | null;
  expires_at?: string | null;
  is_active?: boolean;
  superseded_by_id?: number | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

export type InstructionExclusionReason =
  | 'expired'
  | 'inactive'
  | 'superseded'
  | 'wrong_project_scope'
  | 'wrong_thread_scope'
  | 'overridden_by_higher_precedence'
  | 'overridden_by_priority';

export interface ResolvedInstructionEntry {
  id: number;
  category: string;
  content: string;
  priority: number;
  scope: InstructionScope;
  project_key?: string | null;
  thread_id?: string | null;
  expires_at?: string | null;
  precedenceRank: number;
  sourceLabel: string;
}

export interface ExcludedInstructionEntry {
  id: number;
  category: string;
  content: string;
  priority: number;
  scope: InstructionScope;
  project_key?: string | null;
  thread_id?: string | null;
  expires_at?: string | null;
  reason: InstructionExclusionReason;
  explanation: string;
  overriddenByRuleId?: number;
}

export interface InstructionResolutionManifest {
  resolvedAt: string;
  threadId?: string | null;
  projectKey?: string | null;
  precedenceOrder: ['system_safety', 'permanent', 'project', 'temporary'];
  applied: ResolvedInstructionEntry[];
  overridden: ExcludedInstructionEntry[];
  excluded: ExcludedInstructionEntry[];
  scopeCounts: {
    permanent: number;
    project: number;
    temporary: number;
  };
}

export type ClaimEvidenceStatus = 'verified' | 'partial' | 'inferred' | 'unverified';

export type ToolExecutionStatus =
  | 'succeeded_usable'
  | 'succeeded_insufficient'
  | 'failed'
  | 'not_attempted';

export type VerificationOverallPosture =
  | 'verified'
  | 'mixed'
  | 'partial'
  | 'unverified'
  | 'unassisted_reasoning';

export interface EvidenceClaimRecord {
  id: string;
  statement: string;
  status: ClaimEvidenceStatus;
  basisSummary: string;
  sourceType: 'vault_memory' | 'web_research' | 'tool_output' | 'thread_document' | 'reasoning' | 'conflict_unresolved';
  sourceRefs: Array<{
    kind: 'memory' | 'url' | 'tool' | 'pinned_doc';
    id?: string | number;
    label: string;
    url?: string;
    timestamp?: string | null;
    confidenceStatus?: MemoryConfidenceStatus;
    lifecycleStatus?: MemoryLifecycleStatus;
  }>;
  gapOrConflictNote?: string;
}

export interface ToolExecutionLedgerEntry {
  toolName: string;
  executionStatus: ToolExecutionStatus;
  summary: string;
  errorCode?: string;
  errorMessage?: string;
  resultCount?: number;
  urls?: string[];
  timestamp: string;
}

export interface RetrievedMemoryDiagnostic {
  id: number | string;
  title: string;
  category: string;
  similarity?: number;
  sourceType: MemorySourceType;
  confidenceStatus: MemoryConfidenceStatus;
  impactLevel: MemoryImpactLevel;
  lifecycleStatus: MemoryLifecycleStatus;
  supersededById?: number | string | null;
  validFrom?: string | null;
  lastVerifiedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  includedInPrompt: boolean;
  reason: string;
}

export interface VerificationEnvelope {
  generatedAt: string;
  overallPosture: VerificationOverallPosture;
  summaryLabel: string;
  hasToolFailures: boolean;
  hasInsufficientTools: boolean;
  hasUnverifiedMaterialClaims: boolean;
  hasMemoryConflicts: boolean;
  bannerMessages: Array<{
    severity: 'error' | 'warning';
    code: string;
    message: string;
  }>;
  claims: EvidenceClaimRecord[];
  toolLedger: ToolExecutionLedgerEntry[];
  memoryDiagnostics: RetrievedMemoryDiagnostic[];
  conflictsDetected: Array<{
    existingDocId?: number | string;
    title: string;
    explanation: string;
    impactLevel?: MemoryImpactLevel;
  }>;
}

export interface LearningJourney {
  id: number;
  title: string;
  description: string;
  next_step: string;
  status: 'active' | 'paused' | 'completed';
  thread_count: number;
  latest_thread_id: string | null;
  latest_thread_title: string | null;
  latest_thread_updated_at: string | null;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduledCheckin {
  id: number;
  title: string;
  prompt: string;
  channel: 'telegram' | 'whatsapp';
  due_at: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  thread_id?: string | null;
  journey_id?: number | null;
  decision_id?: number | null;
  last_error?: string | null;
  delivery_sid?: string | null;
  sent_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VaultDuplicateMatch {
  id: number | string;
  title: string;
  category: string;
  contentPreview: string;
  similarityScore: number;
  sharedTokens: string[];
}

export interface VaultDuplicateCluster {
  primaryId: number | string;
  primaryTitle: string;
  primaryCategory: string;
  primaryContentPreview: string;
  matches: VaultDuplicateMatch[];
}

export interface ArtifactPreviewSheet {
  name: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

export interface ArtifactPreviewArchiveEntry {
  name: string;
  sizeBytes: number;
  compressedBytes?: number;
  directory?: boolean;
}

export interface ArtifactPreviewData {
  fileName: string;
  displayName: string;
  type: 'pdf' | 'md' | 'csv' | 'xlsx' | 'zip';
  mimeType: string;
  sizeBytes: number;
  previewKind: 'markdown' | 'table' | 'workbook' | 'pdf' | 'archive';
  markdownText?: string;
  headers?: string[];
  rows?: string[][];
  totalRows?: number;
  truncated?: boolean;
  sheets?: ArtifactPreviewSheet[];
  archiveEntries?: ArtifactPreviewArchiveEntry[];
  inlineUrl?: string;
}

export type VaultEntityType = 'knowledge_doc' | 'active_rule';

export type VaultRevisionOperation =
  | 'create'
  | 'update'
  | 'supersede'
  | 'remove_rule'
  | 'rollback'
  | 'retire';

export interface VaultDiffLine {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface VaultRevisionEntry {
  id: number;
  entityType: VaultEntityType;
  entityId: number;
  versionNumber: number;
  operation: VaultRevisionOperation;
  snapshot: Record<string, unknown>;
  diffSummary: string;
  diffLines: VaultDiffLine[];
  changedFields: string[];
  reason: string | null;
  channel: string | null;
  createdAt: string;
}

export interface BatchIngestFileResult {
  filename: string;
  archiveSource?: string;
  status: 'ingested' | 'failed';
  documentsCreated: number;
  totalCharacters: number;
  totalChunks: number;
  format?: string;
  title?: string;
  code?: string;
  error?: string;
}

export interface BatchIngestResponse {
  success: boolean;
  overallStatus: 'success' | 'partial' | 'failed';
  totalFilesProcessed: number;
  succeededCount: number;
  failedCount: number;
  totalDocumentsCreated: number;
  results: BatchIngestFileResult[];
}


