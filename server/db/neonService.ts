import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { validateStoredArtifact } from '../services/artifactStorageService.ts';
import fs from 'fs';
import path from 'path';
import { isRetryableDatabaseError, summarizeDatabaseConnectionError } from '../utils/databaseConnection.ts';

export interface DatabaseStatus {
  configured: boolean;
  connected: boolean;
  source: 'environment' | 'settings' | 'none';
  maskedUrl: string | null;
  tables: {
    conversations: number | null;
    decisions: number | null;
    twin_events: number | null;
  };
  error: string | null;
}

export interface ConversationMessage {
  id?: number;
  session_id?: string;
  channel: 'web' | 'telegram' | 'whatsapp';
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface DecisionRecord {
  id?: number;
  title: string;
  situation?: string;
  options?: unknown[];
  recommendation?: string;
  confidence?: number;
  full_analysis?: Record<string, unknown>;
  channel?: string;
  created_at?: string;
}

export interface ChatThreadRecord {
  id: string;
  title: string;
  channel: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message?: string;
}

export type StoredArtifactType = 'pdf' | 'md' | 'csv' | 'xlsx';

export interface NewStoredArtifact {
  fileName: string;
  displayName: string;
  type: StoredArtifactType;
  mimeType: string;
  content: Buffer;
  generatedAt: string;
}

export interface StoredArtifactMetadata {
  fileName: string;
  displayName: string;
  type: StoredArtifactType;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  generatedAt: string;
}

export interface StoredArtifact extends StoredArtifactMetadata {
  content: Buffer;
}

export interface ArtifactStorageReadiness {
  configured: boolean;
  connected: boolean;
  schemaReady: boolean;
}

function postgresErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9]+$/.test(code)) return code;
  }
  return 'unknown';
}

class NeonDatabaseService {
  private pool: Pool | null = null;
  private currentUrl: string | null = null;
  private isConnected = false;
  private lastError: string | null = null;
  private lastConnectionError: unknown = null;
  private initializedSchema = false;
  private connectionAttempt: Promise<boolean> | null = null;
  private readonly maxConnectionAttempts = 3;
  private readonly reconnectIntervalMs = 30_000;
  private reconnectTimer: NodeJS.Timeout;

  constructor() {
    void this.ensureConnected();
    this.reconnectTimer = setInterval(() => {
      if (this.isConnected || !this.getActiveUrl().url || this.connectionAttempt) return;
      console.warn('[NeonDB] Database remains disconnected; attempting bounded background reconnection.');
      void this.ensureConnected();
    }, this.reconnectIntervalMs);
    this.reconnectTimer.unref?.();
  }

  /**
   * Wait for a shared connection attempt or initiate bounded retries. This prevents
   * concurrent startup services from racing to create separate PostgreSQL pools.
   */
  public ensureConnected(): Promise<boolean> {
    const { url } = this.getActiveUrl();
    if (url && this.isConnected && this.pool && this.currentUrl === url) {
      return Promise.resolve(true);
    }

    if (this.connectionAttempt) return this.connectionAttempt;

    const attempt = this.connectWithRetries();
    this.connectionAttempt = attempt;
    void attempt.finally(() => {
      if (this.connectionAttempt === attempt) this.connectionAttempt = null;
    }).catch(() => {
      // connectWithRetries handles connection errors; this guard prevents a
      // rejected cleanup chain from becoming an unhandled promise rejection.
    });
    return attempt;
  }

  /**
   * Backward-compatible entry point for services that explicitly refresh the
   * connection. It shares the same in-flight attempt and bounded retry policy.
   */
  public refreshConnection(): Promise<boolean> {
    return this.ensureConnected();
  }

  private async connectWithRetries(): Promise<boolean> {
    const { url } = this.getActiveUrl();
    if (!url) return this.connectOnce();

    for (let attempt = 1; attempt <= this.maxConnectionAttempts; attempt++) {
      if (await this.connectOnce()) return true;

      const connectionError = this.lastConnectionError;
      if (attempt >= this.maxConnectionAttempts || !isRetryableDatabaseError(connectionError)) {
        break;
      }

      const delayMs = attempt * 1_000;
      console.warn(
        `[NeonDB] Transient database connection failure (attempt ${attempt}/${this.maxConnectionAttempts}); retrying in ${delayMs}ms.`
      );
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }

    console.warn('[NeonDB] Initial connection attempts did not succeed; automatic reconnection will retry in the background.');
    return false;
  }

  /**
   * Database connection configuration is deployment-managed and environment-only.
   * Missing DATABASE_URL remains missing; the application does not persist a URL sent by the UI.
   */
  public getActiveUrl(): { url: string | null; source: 'environment' | 'none' } {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
      return { url: process.env.DATABASE_URL.trim(), source: 'environment' };
    }

    return { url: null, source: 'none' };
  }

  /**
   * Mask connection string for safe UI display (hides password)
   */
  public maskUrl(rawUrl: string | null): string | null {
    if (!rawUrl) return null;
    try {
      const parsed = new URL(rawUrl);
      const user = parsed.username ? parsed.username.slice(0, 3) + '***' : '';
      return `${parsed.protocol}//${user}:****@${parsed.host}${parsed.pathname}`;
    } catch {
      return 'Invalid connection URL format';
    }
  }

  /**
   * Initialize or refresh connection pool
   */
  private async connectOnce(): Promise<boolean> {
    const { url, source } = this.getActiveUrl();

    if (!url) {
      const previousPool = this.pool;
      this.pool = null;
      this.currentUrl = null;
      this.isConnected = false;
      this.lastConnectionError = null;
      this.lastError = 'No DATABASE_URL configured in the deployment environment.';
      if (previousPool) void previousPool.end().catch(() => {});
      return false;
    }

    if (this.pool && this.currentUrl === url && this.isConnected) return true;

    const previousUrl = this.currentUrl;
    const previousPool = this.pool;
    this.pool = null;
    this.currentUrl = null;
    this.isConnected = false;
    if (previousUrl !== url) this.initializedSchema = false;
    if (previousPool) void previousPool.end().catch(() => {});

    let nextPool: Pool | null = null;
    try {
      nextPool = new Pool({
        connectionString: url,
        ssl: { rejectUnauthorized: true },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
      });

      nextPool.on('error', (err: Error) => {
        if (this.pool !== nextPool) return;
        this.isConnected = false;
        this.lastConnectionError = err;
        const details = summarizeDatabaseConnectionError(err, url);
        this.lastError = details.causeMessage || details.message;
        console.error('[NeonDB] Idle PostgreSQL connection error:', JSON.stringify(details));
      });

      this.pool = nextPool;

      const client = await nextPool.connect();
      client.release();

      this.currentUrl = url;
      this.isConnected = true;
      this.lastConnectionError = null;
      this.lastError = null;
      console.log(`[NeonDB] Successfully connected to Neon PostgreSQL (${source})`);

      await this.initSchema();
      return true;
    } catch (err: unknown) {
      this.isConnected = false;
      this.lastConnectionError = err;
      const details = summarizeDatabaseConnectionError(err, url);
      this.lastError = details.causeMessage || details.message;
      console.error('[NeonDB] Connection failed:', JSON.stringify(details));

      const failedPool = this.pool === nextPool ? this.pool : nextPool;
      this.pool = null;
      this.currentUrl = null;
      if (failedPool) void failedPool.end().catch(() => {});
      return false;
    }
  }

  /**
   * Initialize tables for conversations, decisions, and system logs
   */
  public async initSchema(): Promise<void> {
    if (!this.pool || !this.isConnected || this.initializedSchema) return;

    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS conversations (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(64) DEFAULT 'default',
          channel VARCHAR(32) NOT NULL,
          role VARCHAR(32) NOT NULL,
          content TEXT NOT NULL,
          provider VARCHAR(32),
          model VARCHAR(64),
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chat_threads (
          id VARCHAR(64) PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          channel VARCHAR(32) DEFAULT 'web',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS decisions (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          situation TEXT,
          options JSONB DEFAULT '[]',
          recommendation TEXT,
          confidence INTEGER,
          full_analysis JSONB,
          channel VARCHAR(32) DEFAULT 'web',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS decision_reviews (
          id SERIAL PRIMARY KEY,
          decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
          idempotency_key VARCHAR(128) UNIQUE,
          user_email VARCHAR(255),
          observation TEXT NOT NULL,
          actual_outcome VARCHAR(64),
          review_data JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS decision_experiments (
          id SERIAL PRIMARY KEY,
          decision_id INTEGER NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
          user_email VARCHAR(255) NOT NULL,
          baseline_metric VARCHAR(255),
          target_metric VARCHAR(255),
          units VARCHAR(50),
          threshold_value NUMERIC,
          measurement_direction VARCHAR(20) DEFAULT 'above',
          status VARCHAR(50) DEFAULT 'Proposed',
          start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          target_date TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS twin_events (
          id SERIAL PRIMARY KEY,
          event_type VARCHAR(64) NOT NULL,
          payload JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS twin_settings (
          key VARCHAR(64) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS twin_jobs (
          id VARCHAR(64) PRIMARY KEY,
          message_sid VARCHAR(128) UNIQUE,
          sender_phone VARCHAR(32),
          channel VARCHAR(32) DEFAULT 'whatsapp',
          status VARCHAR(20) DEFAULT 'pending',
          worker_lease_id VARCHAR(64),
          last_heartbeat_at TIMESTAMP WITH TIME ZONE,
          attempt_count INTEGER DEFAULT 0,
          payload JSONB NOT NULL,
          result JSONB,
          error TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS persona_memories (
          id SERIAL PRIMARY KEY,
          category VARCHAR(32) NOT NULL, -- 'preference', 'opinion', 'correction', 'feedback'
          content TEXT NOT NULL,
          priority INTEGER DEFAULT 1,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS generated_artifacts (
          file_name TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          artifact_type VARCHAR(16) NOT NULL CHECK (artifact_type IN ('pdf', 'md', 'csv', 'xlsx')),
          mime_type VARCHAR(255) NOT NULL,
          size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
          sha256 VARCHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
          content BYTEA NOT NULL,
          generated_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (size_bytes = octet_length(content))
        );

        CREATE INDEX IF NOT EXISTS idx_generated_artifacts_created
          ON generated_artifacts(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);
        CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_experiments_decision ON decision_experiments(decision_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_user_key ON decision_reviews (user_email, idempotency_key);
        CREATE INDEX IF NOT EXISTS idx_persona_memories_category ON persona_memories(category);
        CREATE INDEX IF NOT EXISTS idx_persona_memories_created ON persona_memories(created_at DESC);
      `);

      // Initialize pgvector extension for Neon vector knowledge search
      try {
        await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS twin_knowledge (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            category VARCHAR(64) DEFAULT 'personal_note',
            tags JSONB DEFAULT '[]',
            embedding vector(768),
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE INDEX IF NOT EXISTS idx_twin_knowledge_category ON twin_knowledge(category);
          CREATE INDEX IF NOT EXISTS idx_twin_knowledge_created ON twin_knowledge(created_at DESC);
        `);
        console.log('[NeonDB] pgvector extension and twin_knowledge table enabled successfully.');
      } catch (vectorErr: unknown) {
        console.warn('[NeonDB] pgvector extension setup note, falling back to JSONB embeddings if vector not installed:', vectorErr);
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS twin_knowledge (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            category VARCHAR(64) DEFAULT 'personal_note',
            tags JSONB DEFAULT '[]',
            embedding JSONB,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }

      // Auto-backfill chat_threads for any existing conversations that don't have a thread entry yet
      try {
        await this.pool.query(`
          INSERT INTO chat_threads (id, title, channel, created_at, updated_at)
          SELECT session_id,
                 COALESCE(SUBSTRING(MIN(content) FROM 1 FOR 45), 'Saved Conversation'),
                 'web',
                 MIN(created_at),
                 MAX(created_at)
          FROM conversations
          WHERE session_id IS NOT NULL AND session_id NOT IN (SELECT id FROM chat_threads)
          GROUP BY session_id
          ON CONFLICT (id) DO NOTHING;
        `);
      } catch (backfillErr) {
        console.warn('[NeonDB] Thread backfill warning:', backfillErr);
      }

      this.initializedSchema = true;
      console.log('[NeonDB] Database schema verified and ready.');
    } catch (err: unknown) {
      console.error('[NeonDB] Error creating schema:', err);
    }
  }

  /**
   * Test a custom connection string (e.g. before saving from UI)
   */
  public async testCustomUrl(testUrl: string): Promise<{ success: boolean; message: string }> {
    if (!testUrl || !testUrl.trim()) {
      return { success: false, message: 'Connection string cannot be empty.' };
    }

    let tempPool: Pool | null = null;
    try {
      tempPool = new Pool({
        connectionString: testUrl.trim(),
        ssl: { rejectUnauthorized: true },
        connectionTimeoutMillis: 8000,
      });

      const res = await tempPool.query('SELECT version();');
      const version = res.rows[0]?.version;
      if (typeof version !== 'string' || !version.trim()) {
        return { success: false, message: 'Connection succeeded but PostgreSQL returned no server-version metadata.' };
      }
      const serverVersion = version.split(' on ')[0]?.trim();
      if (!serverVersion) {
        return { success: false, message: 'PostgreSQL server-version metadata was not usable.' };
      }
      return {
        success: true,
        message: `Connection validated. Server version: ${serverVersion}`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Failed to connect to Neon database',
      };
    } finally {
      if (tempPool) {
        await tempPool.end().catch(() => {});
      }
    }
  }

  /**
   * Save database URL to private settings (Environment variable is preferred)
   */
  public async saveConfigUrl(_url: string): Promise<{ success: boolean; message: string }> {
    return {
      success: false,
      message: 'Database connections are managed only through the deployment DATABASE_URL secret. Use the separate connection-test endpoint to validate a candidate URL; this endpoint never stores or clears it.',
    };
  }

  /**
   * Get overall status and table counts
   */
  public async getStatus(): Promise<DatabaseStatus> {
    const { url, source } = this.getActiveUrl();

    const status: DatabaseStatus = {
      configured: !!url,
      connected: this.isConnected,
      source,
      maskedUrl: this.maskUrl(url),
      tables: {
        conversations: null,
        decisions: null,
        twin_events: null,
      },
      error: this.lastError,
    };

    if (this.isConnected && this.pool) {
      try {
        const [convRes, decRes, eventRes] = await Promise.all([
          this.pool.query('SELECT COUNT(*) FROM conversations;'),
          this.pool.query('SELECT COUNT(*) FROM decisions;'),
          this.pool.query('SELECT COUNT(*) FROM twin_events;'),
        ]);

        const parseCount = (value: unknown): number | null => {
          const count = typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim()
              ? Number(value)
              : NaN;
          return Number.isSafeInteger(count) && count >= 0 ? count : null;
        };
        status.tables.conversations = parseCount(convRes.rows[0]?.count);
        status.tables.decisions = parseCount(decRes.rows[0]?.count);
        status.tables.twin_events = parseCount(eventRes.rows[0]?.count);
      } catch (err: unknown) {
        // Table count query error
        console.warn('[NeonDB] Error getting table counts:', err);
      }
    }

    return status;
  }

  /**
   * Persist conversation message
   */
  /** Confirm the live database connection and artifact table before enabling file operations. */
  public async getArtifactStorageReadiness(): Promise<ArtifactStorageReadiness> {
    const configured = Boolean(this.getActiveUrl().url);
    if (!configured) return { configured: false, connected: false, schemaReady: false };

    const connected = await this.ensureConnected();
    if (!connected || !this.pool || !this.isConnected) {
      return { configured: true, connected: false, schemaReady: false };
    }
    try {
      await this.pool.query('SELECT 1 FROM generated_artifacts LIMIT 0;');
      return { configured: true, connected: true, schemaReady: true };
    } catch (error: unknown) {
      console.warn('[NeonDB] Generated artifact table is not ready; PostgreSQL error code:', postgresErrorCode(error));
      return { configured: true, connected: true, schemaReady: false };
    }
  }

  private async requireArtifactPool(): Promise<Pool> {
    const connected = await this.ensureConnected();
    if (!connected || !this.pool || !this.isConnected) {
      throw new Error('ARTIFACT_DATABASE_UNAVAILABLE');
    }
    return this.pool;
  }

  private mapArtifactMetadata(row: Record<string, unknown>): StoredArtifactMetadata {
    const type = row.artifact_type;
    if (type !== 'pdf' && type !== 'md' && type !== 'csv' && type !== 'xlsx') {
      throw new Error('ARTIFACT_METADATA_INVALID');
    }
    const sizeBytes = Number(row.size_bytes);
    const rawDate = row.generated_at instanceof Date ? row.generated_at : new Date(String(row.generated_at));
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || !Number.isFinite(rawDate.getTime())) {
      throw new Error('ARTIFACT_METADATA_INVALID');
    }
    const sha256 = typeof row.sha256 === 'string' ? row.sha256.trim() : '';
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('ARTIFACT_METADATA_INVALID');
    return {
      fileName: String(row.file_name),
      displayName: String(row.display_name),
      type,
      mimeType: String(row.mime_type),
      sizeBytes,
      sha256,
      generatedAt: rawDate.toISOString(),
    };
  }

  /** Persist actual generated bytes, not merely a filesystem path or metadata record. */
  public async saveArtifact(artifact: NewStoredArtifact): Promise<StoredArtifactMetadata> {
    if (
      !artifact ||
      typeof artifact.fileName !== 'string' ||
      !artifact.fileName.trim() ||
      artifact.fileName !== artifact.fileName.split(/[\\/]/).pop() ||
      artifact.fileName === '.' ||
      artifact.fileName === '..' ||
      typeof artifact.displayName !== 'string' ||
      !artifact.displayName.trim() ||
      !Buffer.isBuffer(artifact.content) ||
      artifact.content.length === 0 ||
      !Number.isFinite(Date.parse(artifact.generatedAt)) ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;\s*charset=utf-8)?$/i.test(artifact.mimeType) ||
      (artifact.type !== 'pdf' && artifact.type !== 'md' && artifact.type !== 'csv' && artifact.type !== 'xlsx')
    ) {
      throw new Error('INVALID_ARTIFACT_METADATA');
    }

    const pool = await this.requireArtifactPool();
    const sha256 = createHash('sha256').update(artifact.content).digest('hex');
    try {
      const result = await pool.query(
        `INSERT INTO generated_artifacts
          (file_name, display_name, artifact_type, mime_type, size_bytes, sha256, content, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING file_name, display_name, artifact_type, mime_type, size_bytes, sha256, generated_at;`,
        [
          artifact.fileName,
          artifact.displayName,
          artifact.type,
          artifact.mimeType,
          artifact.content.length,
          sha256,
          artifact.content,
          new Date(artifact.generatedAt).toISOString(),
        ],
      );
      if (result.rows.length !== 1) throw new Error('ARTIFACT_PERSISTENCE_FAILED');
      return this.mapArtifactMetadata(result.rows[0] as Record<string, unknown>);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('ARTIFACT_')) throw error;
      console.error('[NeonDB] Artifact write failed; PostgreSQL error code:', postgresErrorCode(error));
      throw new Error('ARTIFACT_PERSISTENCE_FAILED');
    }
  }

  public async getArtifactMetadata(fileName: string): Promise<StoredArtifactMetadata | null> {
    const pool = await this.requireArtifactPool();
    try {
      const result = await pool.query(
        `SELECT file_name, display_name, artifact_type, mime_type, size_bytes, sha256, generated_at
         FROM generated_artifacts WHERE file_name = $1 LIMIT 1;`,
        [fileName],
      );
      if (result.rows.length === 0) return null;
      return this.mapArtifactMetadata(result.rows[0] as Record<string, unknown>);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('ARTIFACT_')) throw error;
      console.error('[NeonDB] Artifact metadata lookup failed; PostgreSQL error code:', postgresErrorCode(error));
      throw new Error('ARTIFACT_STORAGE_UNAVAILABLE');
    }
  }

  /** Retrieve and verify the stored bytes before serving a download. */
  public async getArtifactContent(fileName: string): Promise<StoredArtifact | null> {
    const pool = await this.requireArtifactPool();
    try {
      const result = await pool.query(
        `SELECT file_name, display_name, artifact_type, mime_type, size_bytes, sha256, generated_at, content
         FROM generated_artifacts WHERE file_name = $1 LIMIT 1;`,
        [fileName],
      );
      if (result.rows.length === 0) return null;

      const row = result.rows[0] as Record<string, unknown>;
      const metadata = this.mapArtifactMetadata(row);
      const rawContent = row.content;
      if (!(Buffer.isBuffer(rawContent) || rawContent instanceof Uint8Array)) {
        throw new Error('ARTIFACT_INTEGRITY_CHECK_FAILED');
      }
      const content = validateStoredArtifact(rawContent, metadata.sizeBytes, metadata.sha256);
      return { ...metadata, content };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('ARTIFACT_')) throw error;
      console.error('[NeonDB] Artifact content lookup failed; PostgreSQL error code:', postgresErrorCode(error));
      throw new Error('ARTIFACT_STORAGE_UNAVAILABLE');
    }
  }

  public async deleteArtifact(fileName: string): Promise<boolean> {
    const pool = await this.requireArtifactPool();
    try {
      const result = await pool.query('DELETE FROM generated_artifacts WHERE file_name = $1;', [fileName]);
      return (result.rowCount ?? 0) > 0;
    } catch (error: unknown) {
      console.error('[NeonDB] Artifact cleanup failed; PostgreSQL error code:', postgresErrorCode(error));
      throw new Error('ARTIFACT_STORAGE_UNAVAILABLE');
    }
  }

  public async saveMessage(msg: ConversationMessage): Promise<number | undefined> {
    if (!this.pool || !this.isConnected) return undefined;

    try {
      const res = await this.pool.query(
        `INSERT INTO conversations (session_id, channel, role, content, provider, model, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id;`,
        [
          msg.session_id || 'default',
          msg.channel,
          msg.role,
          msg.content,
          msg.provider || null,
          msg.model || null,
          JSON.stringify(msg.metadata || {}),
        ]
      );
      return res.rows[0]?.id;
    } catch (err) {
      console.error('[NeonDB] Failed to save conversation message:', err);
      return undefined;
    }
  }

  /**
   * Retrieve recent conversation history
   */
  public async getRecentMessages(limit = 30, channel?: string): Promise<ConversationMessage[]> {
    if (!this.pool || !this.isConnected) return [];

    try {
      let query = 'SELECT * FROM conversations';
      const params: unknown[] = [];

      if (channel) {
        query += ' WHERE channel = $1';
        params.push(channel);
      }

      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const res = await this.pool.query(query, params);
      return res.rows.reverse().map((r) => ({
        id: r.id,
        session_id: r.session_id,
        channel: r.channel,
        role: r.role,
        content: r.content,
        provider: r.provider,
        model: r.model,
        metadata: r.metadata,
        created_at: r.created_at,
      }));
    } catch (err) {
      console.error('[NeonDB] Error fetching messages:', err);
      return [];
    }
  }

  /**
   * Get all chat threads with message counts and last message previews
   */
  public async getThreads(channel?: string): Promise<ChatThreadRecord[]> {
    if (this.pool && this.isConnected) {
      try {
        let query = `
          SELECT t.id, t.title, t.channel, t.created_at, t.updated_at,
                 COUNT(c.id) AS message_count,
                 (SELECT content FROM conversations WHERE session_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_message
          FROM chat_threads t
          LEFT JOIN conversations c ON c.session_id = t.id
        `;
        const params: unknown[] = [];
        if (channel) {
          query += ` WHERE t.channel = $1`;
          params.push(channel);
        }
        query += ` GROUP BY t.id, t.title, t.channel, t.created_at, t.updated_at ORDER BY t.updated_at DESC`;

        const res = await this.pool.query(query, params);
        if (res.rows.length > 0) {
          return res.rows.map((r) => ({
            id: r.id,
            title: r.title,
            channel: r.channel,
            created_at: r.created_at,
            updated_at: r.updated_at,
            message_count: parseInt(r.message_count || '0', 10),
            last_message: r.last_message || '',
          }));
        }
      } catch (err) {
        console.warn('[NeonDB] Error fetching threads from DB:', err);
      }
    }

    return [];
  }

  public async saveThread(thread: { id: string; title: string; channel?: string }): Promise<boolean> {
    if (!this.pool || !this.isConnected) return false;
    const channel = thread.channel || 'web';
    try {
      await this.pool.query(
        `INSERT INTO chat_threads (id, title, channel, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET title = $2, updated_at = CURRENT_TIMESTAMP`,
        [thread.id, thread.title, channel]
      );
      return true;
    } catch (err) {
      console.error('[NeonDB] Error saving thread to DB:', err);
      return false;
    }
  }

  public async deleteThread(threadId: string): Promise<void> {
    if (this.pool && this.isConnected) {
      try {
        await this.pool.query('DELETE FROM conversations WHERE session_id = $1;', [threadId]);
        await this.pool.query('DELETE FROM chat_threads WHERE id = $1;', [threadId]);
      } catch (err) {
        console.error('[NeonDB] Error deleting thread from DB:', err);
      }
    }
  }

  public async clearAllThreads(): Promise<void> {
    if (this.pool && this.isConnected) {
      try {
        await this.pool.query('DELETE FROM conversations;');
        await this.pool.query('DELETE FROM chat_threads;');
      } catch (err) {
        console.error('[NeonDB] Error clearing all threads from DB:', err);
      }
    }
  }

  /**
   * Get all messages for a specific thread
   */
  public async getThreadMessages(threadId: string): Promise<ConversationMessage[]> {
    if (!this.pool || !this.isConnected) return [];

    try {
      const res = await this.pool.query(
        'SELECT * FROM conversations WHERE session_id = $1 ORDER BY created_at ASC;',
        [threadId]
      );
      return res.rows.map((r) => ({
        id: r.id,
        session_id: r.session_id,
        channel: r.channel,
        role: r.role,
        content: r.content,
        provider: r.provider,
        model: r.model,
        metadata: r.metadata,
        created_at: r.created_at,
      }));
    } catch (err) {
      console.error('[NeonDB] Error fetching thread messages:', err);
      return [];
    }
  }

  /**
   * Edit/update a message content
   */
  public async updateMessage(messageId: number | string, newContent: string, sessionId?: string): Promise<boolean> {
    if (!this.pool || !this.isConnected) return false;

    try {
      const numId = typeof messageId === 'number' ? messageId : parseInt(String(messageId), 10);
      if (!isNaN(numId)) {
        const res = await this.pool.query(
          'UPDATE conversations SET content = $1 WHERE id = $2 RETURNING id;',
          [newContent, numId]
        );
        return (res.rowCount ?? 0) > 0;
      }
      if (sessionId) {
        const res = await this.pool.query(
          `UPDATE conversations SET content = $1
           WHERE id = (SELECT id FROM conversations WHERE session_id = $2 ORDER BY created_at DESC LIMIT 1)
           RETURNING id;`,
          [newContent, sessionId]
        );
        return (res.rowCount ?? 0) > 0;
      }
      return false;
    } catch (err) {
      console.error('[NeonDB] Error updating message:', err);
      return false;
    }
  }

  /**
   * Delete a single message
   */
  public async deleteMessage(messageId: number | string, sessionId?: string): Promise<boolean> {
    if (!this.pool || !this.isConnected) return false;

    try {
      const numId = typeof messageId === 'number' ? messageId : parseInt(String(messageId), 10);
      if (!isNaN(numId)) {
        const res = await this.pool.query('DELETE FROM conversations WHERE id = $1;', [numId]);
        return (res.rowCount ?? 0) > 0;
      }
      if (sessionId) {
        const res = await this.pool.query(
          `DELETE FROM conversations
           WHERE id = (SELECT id FROM conversations WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1);`,
          [sessionId]
        );
        return (res.rowCount ?? 0) > 0;
      }
      return false;
    } catch (err) {
      console.error('[NeonDB] Error deleting message:', err);
      return false;
    }
  }

  /**
   * Persist strategic decision analysis
   */
  public async saveDecision(dec: DecisionRecord): Promise<number | null> {
    if (!this.pool || !this.isConnected) return null;

    try {
      const res = await this.pool.query(
        `INSERT INTO decisions (title, situation, options, recommendation, confidence, full_analysis, channel)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          dec.title,
          dec.situation || null,
          JSON.stringify(dec.options || []),
          dec.recommendation || null,
          dec.confidence ?? null,
          JSON.stringify(dec.full_analysis || {}),
          dec.channel || 'web',
        ]
      );
      return res.rows[0]?.id || null;
    } catch (err) {
      console.error('[NeonDB] Failed to save decision:', err);
      return null;
    }
  }

  /**
   * Retrieve decision journal
   */
  public async getDecisions(limit = 20): Promise<DecisionRecord[]> {
    if (!this.pool || !this.isConnected) return [];

    try {
      const res = await this.pool.query(
        'SELECT * FROM decisions ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      return res.rows.map((r) => ({
        id: r.id,
        title: r.title,
        situation: r.situation,
        options: r.options,
        recommendation: r.recommendation,
        confidence: r.confidence,
        full_analysis: r.full_analysis,
        channel: r.channel,
        created_at: r.created_at,
      }));
    } catch (err) {
      console.error('[NeonDB] Error fetching decisions:', err);
      return [];
    }
  }

  /**
   * Return the next bounded batch of eligible Sentinel decisions that do not
   * have a durable completed audit record. Deferred audits are held out for
   * one retry window so failures do not block every later decision.
   */
  public async getPendingSentinelDecisions(limit = 15): Promise<DecisionRecord[] | null> {
    if (!this.pool || !this.isConnected) return null;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('INVALID_SENTINEL_BATCH_SIZE');

    try {
      const result = await this.pool.query(
        `SELECT d.*
         FROM decisions d
         WHERE NULLIF(BTRIM(d.recommendation), '') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM twin_events e
             WHERE e.event_type = 'sentinel_decision_audit'
               AND e.payload->>'decisionId' = d.id::text
               AND (
                 e.payload->>'status' = 'completed'
                 OR (
                   e.payload->>'status' = 'deferred'
                   AND e.created_at > CURRENT_TIMESTAMP - INTERVAL '12 hours'
                 )
               )
           )
         ORDER BY d.created_at ASC, d.id ASC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        situation: row.situation,
        options: row.options,
        recommendation: row.recommendation,
        confidence: row.confidence,
        full_analysis: row.full_analysis,
        channel: row.channel,
        created_at: row.created_at,
      }));
    } catch (err) {
      console.error('[NeonDB] Failed to retrieve pending Sentinel decisions:', err);
      return null;
    }
  }

  /**
   * Count eligible decisions without a completed audit. Null means that the
   * database state could not be read; it is not equivalent to an empty queue.
   */
  public async getSentinelPendingDecisionCount(): Promise<number | null> {
    if (!this.pool || !this.isConnected) return null;

    try {
      const result = await this.pool.query(
        `SELECT COUNT(*)::int AS pending_count
         FROM decisions d
         WHERE NULLIF(BTRIM(d.recommendation), '') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM twin_events e
             WHERE e.event_type = 'sentinel_decision_audit'
               AND e.payload->>'decisionId' = d.id::text
               AND e.payload->>'status' = 'completed'
           )`
      );
      const count = result.rows[0]?.pending_count;
      return typeof count === 'number' && Number.isFinite(count) ? count : null;
    } catch (err) {
      console.error('[NeonDB] Failed to count pending Sentinel decisions:', err);
      return null;
    }
  }

  /**
   * Persist Sentinel audit state. A completion is only considered durable when
   * the insert succeeds and returns its event ID.
   */
  public async recordSentinelDecisionAudit(
    decisionId: number,
    status: 'completed' | 'deferred',
    details: Record<string, unknown> = {}
  ): Promise<boolean> {
    if (!this.pool || !this.isConnected || !Number.isSafeInteger(decisionId) || decisionId < 1) return false;

    const payload = {
      ...details,
      decisionId,
      status,
      recordedAt: new Date().toISOString(),
    };

    try {
      const result = await this.pool.query(
        `INSERT INTO twin_events (event_type, payload)
         VALUES ('sentinel_decision_audit', $1)
         RETURNING id`,
        [JSON.stringify(payload)]
      );
      return (result.rowCount ?? result.rows.length) > 0;
    } catch (err) {
      console.warn('[NeonDB] Unable to persist Sentinel audit state:', err instanceof Error ? err.message : 'unknown error');
      return false;
    }
  }

  /**
   * Get single decision record by ID
   */
  public async getDecisionById(id: number): Promise<DecisionRecord | null> {
    if (!this.pool || !this.isConnected) return null;

    try {
      const res = await this.pool.query('SELECT * FROM decisions WHERE id = $1 LIMIT 1', [id]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        title: r.title,
        situation: r.situation,
        options: r.options,
        recommendation: r.recommendation,
        confidence: r.confidence,
        full_analysis: r.full_analysis,
        channel: r.channel,
        created_at: r.created_at,
      };
    } catch (err) {
      console.error('[NeonDB] Error fetching decision by ID:', err);
      return null;
    }
  }

  /**
   * Append-only decision outcome observation review with idempotency
   */
  public async saveDecisionReview(review: {
    decisionId: number;
    idempotencyKey?: string;
    userEmail?: string;
    observation: string;
    actualOutcome?: string;
    reviewData?: Record<string, unknown>;
  }): Promise<{ reviewId: number | null; isDuplicate: boolean; conflict?: boolean }> {
    if (!this.pool || !this.isConnected) {
      return { reviewId: null, isDuplicate: false };
    }

    try {
      if (review.idempotencyKey) {
        const existing = await this.pool.query(
          'SELECT id, observation, actual_outcome FROM decision_reviews WHERE idempotency_key = $1 AND (user_email = $2 OR $2 IS NULL) LIMIT 1',
          [review.idempotencyKey, review.userEmail || null]
        );
        if (existing.rows.length > 0) {
          const prev = existing.rows[0];
          const isSameObservation = prev.observation === review.observation && (prev.actual_outcome || '') === (review.actualOutcome || '');
          if (!isSameObservation) {
            return { reviewId: prev.id, isDuplicate: true, conflict: true };
          }
          return { reviewId: prev.id, isDuplicate: true, conflict: false };
        }
      }

      const res = await this.pool.query(
        `INSERT INTO decision_reviews (decision_id, idempotency_key, user_email, observation, actual_outcome, review_data)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          review.decisionId,
          review.idempotencyKey || null,
          review.userEmail || null,
          review.observation,
          review.actualOutcome || null,
          JSON.stringify(review.reviewData || {}),
        ]
      );

      return { reviewId: res.rows[0]?.id || null, isDuplicate: false, conflict: false };
    } catch (err) {
      console.error('[NeonDB] Failed to save decision review:', err);
      return { reviewId: null, isDuplicate: false, conflict: false };
    }
  }

  /**
   * Retrieve outcome review history for a decision
   */
  public async getDecisionReviews(decisionId?: number): Promise<Array<{
    id: number;
    decision_id: number;
    idempotency_key: string | null;
    user_email: string | null;
    observation: string;
    actual_outcome: string | null;
    review_data: Record<string, unknown>;
    created_at: string;
  }>> {
    if (!this.pool || !this.isConnected) return [];

    try {
      const sql = decisionId
        ? 'SELECT * FROM decision_reviews WHERE decision_id = $1 ORDER BY created_at DESC'
        : 'SELECT * FROM decision_reviews ORDER BY created_at DESC LIMIT 100';
      const params = decisionId ? [decisionId] : [];
      const res = await this.pool.query(sql, params);
      return res.rows;
    } catch (err) {
      console.error('[NeonDB] Error fetching decision reviews:', err);
      return [];
    }
  }

  /**
   * Save or update an experiment linked to a decision
   */
  public async saveDecisionExperiment(exp: {
    decisionId: number;
    userEmail: string;
    baselineMetric?: string;
    targetMetric?: string;
    units?: string;
    thresholdValue?: number;
    measurementDirection?: 'above' | 'below';
    status?: string;
    targetDate?: string;
  }): Promise<{ id: number | null }> {
    if (!this.pool || !this.isConnected) return { id: null };

    try {
      const res = await this.pool.query(
        `INSERT INTO decision_experiments 
         (decision_id, user_email, baseline_metric, target_metric, units, threshold_value, measurement_direction, status, target_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          exp.decisionId,
          exp.userEmail,
          exp.baselineMetric || null,
          exp.targetMetric || null,
          exp.units || null,
          exp.thresholdValue ?? null,
          exp.measurementDirection || 'above',
          exp.status || 'Proposed',
          exp.targetDate ? new Date(exp.targetDate).toISOString() : null,
        ]
      );
      return { id: res.rows[0]?.id || null };
    } catch (err) {
      console.error('[NeonDB] Failed to save decision experiment:', err);
      return { id: null };
    }
  }

  /**
   * Get all experiments for a decision or across all decisions
   */
  public async getDecisionExperiments(decisionId?: number): Promise<Array<{
    id: number;
    decision_id: number;
    user_email: string;
    baseline_metric: string | null;
    target_metric: string | null;
    units: string | null;
    threshold_value: number | null;
    measurement_direction: string;
    status: string;
    start_date: string;
    target_date: string | null;
    created_at: string;
    decision_title?: string;
  }>> {
    if (!this.pool || !this.isConnected) return [];

    try {
      const sql = decisionId
        ? `SELECT e.*, d.title as decision_title 
           FROM decision_experiments e 
           JOIN decisions d ON d.id = e.decision_id 
           WHERE e.decision_id = $1 
           ORDER BY e.created_at DESC`
        : `SELECT e.*, d.title as decision_title 
           FROM decision_experiments e 
           JOIN decisions d ON d.id = e.decision_id 
           ORDER BY e.created_at DESC LIMIT 100`;
      const params = decisionId ? [decisionId] : [];
      const res = await this.pool.query(sql, params);
      return res.rows;
    } catch (err) {
      console.error('[NeonDB] Error fetching decision experiments:', err);
      return [];
    }
  }

  /**
   * Compute unbundled Brier score and calibration metrics across finalized decisions
   */
  public async getCalibrationMetrics(): Promise<{
    available: boolean;
    error?: string;
    totalDecisions: number | null;
    totalReviews: number | null;
    eligibleCount: number;
    sampleSizeSufficient: boolean; // requires eligibleCount >= 5
    brierScore: number | null; // (1/N) * sum((predicted_prob - outcome)^2)
    overconfidenceLevel: number | null;
    outcomeCounts: Record<string, number>;
  }> {
    if (!this.pool || !this.isConnected) {
      return {
        available: false,
        error: 'DATABASE_UNAVAILABLE',
        totalDecisions: null,
        totalReviews: null,
        eligibleCount: 0,
        sampleSizeSufficient: false,
        brierScore: null,
        overconfidenceLevel: null,
        outcomeCounts: {
          'Met Success Threshold': 0,
          'Missed Baseline': 0,
          'Inconclusive': 0,
          'Pivot Executed': 0,
          'Overdue': 0,
          'Cancelled': 0,
        },
      };
    }

    try {
      const dRes = await this.pool.query('SELECT COUNT(*) FROM decisions');
      const totalDecisions = parseInt(dRes.rows[0]?.count || '0', 10);

      const rRes = await this.pool.query(`
        SELECT dr.actual_outcome, d.confidence 
        FROM decision_reviews dr 
        JOIN decisions d ON d.id = dr.decision_id
      `);

      const totalReviews = rRes.rows.length;
      const outcomeCounts: Record<string, number> = {
        'Met Success Threshold': 0,
        'Missed Baseline': 0,
        'Inconclusive': 0,
        'Pivot Executed': 0,
        'Overdue': 0,
        'Cancelled': 0,
      };

      let sumSquareError = 0;
      let sumPredictedProbability = 0;
      let sumObservedOutcome = 0;
      let eligibleCount = 0;

      for (const row of rRes.rows) {
        const outcome = row.actual_outcome || 'Inconclusive';
        outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;

        // Brier score calculation applies only to binary outcomes (Met Success Threshold = 1, Missed Baseline = 0)
        if (outcome === 'Met Success Threshold' || outcome === 'Missed Baseline') {
          const confidence = row.confidence === null || row.confidence === undefined ? NaN : Number(row.confidence);
          if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) continue;
          const predictedProb = confidence / 100;
          const actualVal = outcome === 'Met Success Threshold' ? 1 : 0;
          sumSquareError += Math.pow(predictedProb - actualVal, 2);
          sumPredictedProbability += predictedProb;
          sumObservedOutcome += actualVal;
          eligibleCount++;
        }
      }

      const sampleSizeSufficient = eligibleCount >= 5;
      const brierScore = sampleSizeSufficient && eligibleCount > 0 ? parseFloat((sumSquareError / eligibleCount).toFixed(4)) : null;
      const meanPredictionBias = sampleSizeSufficient && eligibleCount > 0
        ? (sumPredictedProbability / eligibleCount) - (sumObservedOutcome / eligibleCount)
        : null;
      // 0.5 indicates no mean calibration bias; above 0.5 means predicted probabilities
      // exceed the observed success rate in the eligible binary-outcome sample.
      const overconfidenceLevel = meanPredictionBias === null
        ? null
        : Math.max(0, Math.min(1, 0.5 + meanPredictionBias / 2));

      return {
        available: true,
        totalDecisions,
        totalReviews,
        eligibleCount,
        sampleSizeSufficient,
        brierScore,
        overconfidenceLevel,
        outcomeCounts,
      };
    } catch (err) {
      console.error('[NeonDB] Error computing calibration metrics:', err);
      return {
        available: false,
        error: 'CALIBRATION_QUERY_FAILED',
        totalDecisions: null,
        totalReviews: null,
        eligibleCount: 0,
        sampleSizeSufficient: false,
        brierScore: null,
        overconfidenceLevel: null,
        outcomeCounts: {},
      };
    }
  }

  /**
   * Persist unified application & brain settings
   */
  public async saveSettings(settings: Record<string, unknown>): Promise<boolean> {
    if (!this.pool || !this.isConnected) return false;

    try {
      await this.pool.query(
        `INSERT INTO twin_settings (key, value, updated_at)
         VALUES ('global_settings', $1, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;`,
        [JSON.stringify(settings)]
      );
      return true;
    } catch (err) {
      console.error('[NeonDB] Error saving settings:', err);
      return false;
    }
  }

  /**
   * Retrieve unified application & brain settings
   */
  public async getSettings(): Promise<Record<string, unknown> | null> {
    if (!this.pool || !this.isConnected) return null;

    try {
      const res = await this.pool.query(
        "SELECT value FROM twin_settings WHERE key = 'global_settings' LIMIT 1;"
      );
      if (res.rows.length > 0) {
        return res.rows[0].value;
      }
      return null;
    } catch (err) {
      console.error('[NeonDB] Error fetching settings:', err);
      return null;
    }
  }

  /**
   * Insert a document or personal note with optional pgvector embedding
   */
  public async saveKnowledge(item: {
    title: string;
    content: string;
    category?: string;
    tags?: string[];
    embedding?: number[];
    metadata?: Record<string, unknown>;
  }): Promise<{ id: number; success: boolean }> {
    if (!this.pool || !this.isConnected) {
      return { id: 0, success: false };
    }

    try {
      const category = item.category || 'personal_note';
      const tags = JSON.stringify(item.tags || []);
      const metadata = JSON.stringify(item.metadata || {});

      if (item.embedding && item.embedding.length > 0) {
        // Format embedding as pgvector literal: '[0.123, -0.456, ...]'
        const vectorStr = `[${item.embedding.join(',')}]`;
        const res = await this.pool.query(
          `INSERT INTO twin_knowledge (title, content, category, tags, embedding, metadata, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id;`,
          [item.title, item.content, category, tags, vectorStr, metadata]
        );
        return { id: res.rows[0].id, success: true };
      } else {
        const res = await this.pool.query(
          `INSERT INTO twin_knowledge (title, content, category, tags, metadata, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id;`,
          [item.title, item.content, category, tags, metadata]
        );
        return { id: res.rows[0].id, success: true };
      }
    } catch (err) {
      console.error('[NeonDB] Error saving knowledge document:', err);
      return { id: 0, success: false };
    }
  }

  /**
   * Search knowledge base using pgvector cosine distance (<=> operator)
   */
  public async searchKnowledgeVector(
    embedding: number[],
    limit = 5,
    threshold = 0.4
  ): Promise<Array<{ id: number; title: string; content: string; category: string; tags: string[]; similarity: number }>> {
    if (!this.pool || !this.isConnected || !embedding || embedding.length === 0) {
      return [];
    }

    try {
      const vectorStr = `[${embedding.join(',')}]`;
      // Cosine similarity = 1 - (embedding <=> target_vector)
      const res = await this.pool.query(
        `SELECT id, title, content, category, tags,
                (1 - (embedding <=> $1::vector)) as similarity
         FROM twin_knowledge
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector ASC
         LIMIT $2;`,
        [vectorStr, limit]
      );

      return res.rows
        .filter((r) => Number(r.similarity) >= threshold)
        .map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          category: r.category,
          tags: Array.isArray(r.tags) ? r.tags : [],
          similarity: Number(r.similarity),
        }));
    } catch (err) {
      console.warn('[NeonDB] pgvector search warning (falling back if vector extension not present):', err);
      return [];
    }
  }

  /**
   * Retrieve all knowledge documents with optional text filtering
   */
  public async getKnowledgeList(
    category?: string,
    query?: string,
    limit = 50
  ): Promise<Array<{ id: number; title: string; content: string; category: string; tags: string[]; hasEmbedding: boolean; createdAt: string }>> {
    if (!this.pool || !this.isConnected) return [];

    try {
      let sql = 'SELECT id, title, content, category, tags, (embedding IS NOT NULL) as has_embedding, created_at FROM twin_knowledge WHERE 1=1';
      const params: unknown[] = [];

      if (category && category !== 'all') {
        params.push(category);
        sql += ` AND category = $${params.length}`;
      }

      if (query && query.trim()) {
        params.push(`%${query.trim()}%`);
        sql += ` AND (title ILIKE $${params.length} OR content ILIKE $${params.length})`;
      }

      params.push(limit);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

      const res = await this.pool.query(sql, params);
      return res.rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        category: r.category,
        tags: Array.isArray(r.tags) ? r.tags : [],
        hasEmbedding: Boolean(r.has_embedding),
        createdAt: r.created_at,
      }));
    } catch (err) {
      console.error('[NeonDB] Error fetching knowledge list:', err);
      return [];
    }
  }

  /**
   * Delete a knowledge document
   */
  public async deleteKnowledge(id: number | string): Promise<boolean> {
    if (!this.pool || !this.isConnected) return false;

    try {
      await this.pool.query('DELETE FROM twin_knowledge WHERE id = $1', [id]);
      return true;
    } catch (err) {
      console.error('[NeonDB] Error deleting knowledge document:', err);
      return false;
    }
  }

  /**
   * Get telemetry stats for pgvector knowledge base
   */
  public async getKnowledgeStats(): Promise<{
    count: number;
    vectorCount: number;
    pgvectorActive: boolean;
  }> {
    if (!this.pool || !this.isConnected) {
      return { count: 0, vectorCount: 0, pgvectorActive: false };
    }

    try {
      const res = await this.pool.query(
        `SELECT COUNT(*)::int as total,
                COUNT(embedding)::int as with_vector
         FROM twin_knowledge;`
      );
      const extRes = await this.pool.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'vector' LIMIT 1;"
      );
      return {
        count: res.rows[0]?.total || 0,
        vectorCount: res.rows[0]?.with_vector || 0,
        pgvectorActive: extRes.rows.length > 0,
      };
    } catch {
      return { count: 0, vectorCount: 0, pgvectorActive: false };
    }
  }

  /**
   * Log an operational twin event to twin_events
   */
  public async logEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.pool || !this.isConnected) return;
    try {
      await this.pool.query(
        'INSERT INTO twin_events (event_type, payload) VALUES ($1, $2);',
        [eventType, JSON.stringify(payload)]
      );
    } catch (err) {
      console.warn('[NeonDB] Error logging event:', err);
    }
  }

  // ==========================================
  // Job Queue Persistence Methods
  // ==========================================

  public async getJobByMessageSid(messageSid: string): Promise<any | null> {
    if (!this.pool || !this.isConnected || !messageSid) return null;
    try {
      const res = await this.pool.query('SELECT * FROM twin_jobs WHERE message_sid = $1 LIMIT 1', [messageSid]);
      return res.rows[0] || null;
    } catch (err) {
      console.error('[NeonDB] Error getting job by message_sid:', err);
      return null;
    }
  }

  public async insertJob(job: {
    id: string;
    message_sid: string;
    sender_phone: string;
    payload: any;
  }): Promise<boolean> {
    if (!this.pool || !this.isConnected) return false;
    try {
      const result = await this.pool.query(
        `INSERT INTO twin_jobs (id, message_sid, sender_phone, payload, status, updated_at)
         VALUES ($1, $2, $3, $4, 'pending', CURRENT_TIMESTAMP)
         ON CONFLICT (message_sid) DO NOTHING
         RETURNING id`,
        [job.id, job.message_sid, job.sender_phone, JSON.stringify(job.payload)]
      );
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      console.error('[NeonDB] Error inserting job:', err);
      return false;
    }
  }

  public async claimNextJob(workerLeaseId: string, heartbeatExpirationMs: number): Promise<any | null> {
    if (!this.pool || !this.isConnected) return null;
    try {
      // Exhausted leases are terminally failed before a new job is claimed.
      await this.pool.query(
        `UPDATE twin_jobs
         SET status = 'failed',
             error = 'RETRY_LIMIT_EXCEEDED',
             updated_at = CURRENT_TIMESTAMP
         WHERE status = 'processing'
           AND last_heartbeat_at < CURRENT_TIMESTAMP - ($1 || ' milliseconds')::interval
           AND attempt_count >= 3`,
        [heartbeatExpirationMs]
      );

      // Atomic claim using UPDATE ... RETURNING
      // Finds pending jobs OR processing jobs with expired heartbeat
      const res = await this.pool.query(
        `UPDATE twin_jobs
         SET status = 'processing',
             worker_lease_id = $1,
             last_heartbeat_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP,
             attempt_count = attempt_count + 1
         WHERE id = (
           SELECT id FROM twin_jobs
           WHERE status = 'pending'
              OR (status = 'processing' AND last_heartbeat_at < CURRENT_TIMESTAMP - ($2 || ' milliseconds')::interval AND attempt_count < 3)
           ORDER BY created_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [workerLeaseId, heartbeatExpirationMs]
      );
      return res.rows[0] || null;
    } catch (err) {
      console.error('[NeonDB] Error claiming next job:', err);
      return null;
    }
  }

  public async updateJobHeartbeat(jobId: string, workerLeaseId: string): Promise<boolean> {
    if (!this.pool || !this.isConnected) return false;
    try {
      const res = await this.pool.query(
        `UPDATE twin_jobs
         SET last_heartbeat_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND worker_lease_id = $2 AND status = 'processing'`,
        [jobId, workerLeaseId]
      );
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      console.error('[NeonDB] Error updating job heartbeat:', err);
      return false;
    }
  }

  public async updateJobStatus(jobId: string, workerLeaseId: string, status: string, result?: any, error?: string): Promise<boolean> {
    if (!this.pool || !this.isConnected) return false;
    try {
      const res = await this.pool.query(
        `UPDATE twin_jobs
         SET status = $3,
             result = $4,
             error = $5,
             worker_lease_id = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND worker_lease_id = $2`,
        [jobId, workerLeaseId, status, result ? JSON.stringify(result) : null, error || null]
      );
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      console.error('[NeonDB] Error updating job status:', err);
      return false;
    }
  }

  public async getJobList(limit = 50): Promise<any[]> {
    if (!this.pool || !this.isConnected) return [];
    try {
      const res = await this.pool.query('SELECT * FROM twin_jobs ORDER BY created_at DESC LIMIT $1', [limit]);
      return res.rows;
    } catch (err) {
      console.error('[NeonDB] Error fetching job list:', err);
      return [];
    }
  }
  /**
   * Persist a learned persona trait, preference, or correction
   */
  public async savePersonaMemory(memory: {
    category: 'preference' | 'opinion' | 'correction' | 'feedback';
    content: string;
    priority?: number;
    metadata?: Record<string, unknown>;
  }): Promise<number | null> {
    if (!this.pool || !this.isConnected) return null;

    try {
      const res = await this.pool.query(
        `INSERT INTO persona_memories (category, content, priority, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [memory.category, memory.content, memory.priority || 1, JSON.stringify(memory.metadata || {})]
      );
      return res.rows[0]?.id || null;
    } catch (err) {
      console.error('[NeonDB] Failed to save persona memory:', err);
      return null;
    }
  }

  /**
   * Retrieve all learned persona memories
   */
  public async getPersonaMemories(limit = 100): Promise<Array<{
    id: number;
    category: string;
    content: string;
    priority: number;
    metadata: Record<string, unknown>;
    created_at: string;
  }>> {
    if (!this.pool || !this.isConnected) return [];

    try {
      const res = await this.pool.query(
        'SELECT * FROM persona_memories ORDER BY priority DESC, created_at DESC LIMIT $1',
        [limit]
      );
      return res.rows;
    } catch (err) {
      console.error('[NeonDB] Error fetching persona memories:', err);
      return [];
    }
  }

  /**
   * Delete a specific persona memory
   */
  public async deletePersonaMemory(id: number): Promise<boolean> {
    if (!this.pool || !this.isConnected) return false;

    try {
      const res = await this.pool.query('DELETE FROM persona_memories WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      console.error('[NeonDB] Error deleting persona memory:', err);
      return false;
    }
  }
}

export const neonDb = new NeonDatabaseService();
