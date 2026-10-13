import fs from 'fs';
import path from 'path';
import lockfile from 'proper-lockfile';
import writeFileAtomic from 'write-file-atomic';

export interface JobRecord {
  jobId: string;
  messageSid: string;
  senderPhone: string;
  channel: 'whatsapp';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  workerLeaseId?: string;
  lastHeartbeatAt?: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  payload: {
    body: string;
    from: string;
    to: string;
    messageSid: string;
    [key: string]: any;
  };
  result?: any;
  error?: string;
}

const JOBS_FILE = path.resolve(process.cwd(), 'twin-jobs.json');
const HEARTBEAT_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

export class JobQueueService {
  constructor() {
    this.ensureJobsFile();
  }

  private ensureJobsFile() {
    if (!fs.existsSync(JOBS_FILE)) {
      try {
        fs.writeFileSync(JOBS_FILE, JSON.stringify([], null, 2), 'utf-8');
      } catch (err) {
        console.error('[JobQueueService] Failed creating initial twin-jobs.json:', err);
      }
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    this.ensureJobsFile();
    let release: (() => Promise<void>) | null = null;
    try {
      release = await lockfile.lock(JOBS_FILE, { retries: 5, realpath: false });
      return await fn();
    } catch (err) {
      console.warn('[JobQueueService] Lock acquire failed or timed out, executing without lock:', err);
      return await fn();
    } finally {
      if (release) {
        await release().catch(() => {});
      }
    }
  }

  private readJobsUnsafe(): JobRecord[] {
    try {
      if (!fs.existsSync(JOBS_FILE)) return [];
      const raw = fs.readFileSync(JOBS_FILE, 'utf-8');
      return JSON.parse(raw || '[]');
    } catch (err) {
      console.error('[JobQueueService] Error reading twin-jobs.json:', err);
      return [];
    }
  }

  private async writeJobsUnsafe(jobs: JobRecord[]): Promise<void> {
    const data = JSON.stringify(jobs, null, 2);
    await writeFileAtomic(JOBS_FILE, data, { encoding: 'utf-8' });
  }

  /**
   * Check if MessageSid exists already for deduplication
   */
  public async getJobByMessageSid(messageSid: string): Promise<JobRecord | null> {
    if (!messageSid) return null;
    return this.withLock(async () => {
      const jobs = this.readJobsUnsafe();
      return jobs.find((j) => j.messageSid === messageSid) || null;
    });
  }

  /**
   * Atomically enqueue inbound WhatsApp message job with deduplication
   */
  public async enqueueInboundJob(
    messageSid: string,
    senderPhone: string,
    payload: { body: string; from: string; to: string; messageSid: string; [key: string]: any }
  ): Promise<{ job: JobRecord; isDuplicate: boolean }> {
    return this.withLock(async () => {
      const jobs = this.readJobsUnsafe();

      // Check for duplicate MessageSid
      const existing = jobs.find((j) => j.messageSid === messageSid);
      if (existing) {
        console.log(`[JobQueueService] Duplicate MessageSid detected: ${messageSid}. Skipping duplicate queueing.`);
        return { job: existing, isDuplicate: true };
      }

      const now = new Date().toISOString();
      const newJob: JobRecord = {
        jobId: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        messageSid,
        senderPhone,
        channel: 'whatsapp',
        status: 'pending',
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
        payload,
      };

      jobs.push(newJob);
      await this.writeJobsUnsafe(jobs);

      console.log(`[JobQueueService] Enqueued job ${newJob.jobId} for MessageSid ${messageSid}`);
      return { job: newJob, isDuplicate: false };
    });
  }

  /**
   * Claim next pending job OR expired lease job
   */
  public async claimNextJob(workerLeaseId: string): Promise<JobRecord | null> {
    return this.withLock(async () => {
      const jobs = this.readJobsUnsafe();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      let targetIndex = -1;

      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        if (j.status === 'pending') {
          targetIndex = i;
          break;
        }

        // Lease-aware crash recovery check
        if (j.status === 'processing') {
          const lastHb = j.lastHeartbeatAt ? new Date(j.lastHeartbeatAt).getTime() : new Date(j.createdAt).getTime();
          const isExpired = nowMs - lastHb > HEARTBEAT_EXPIRATION_MS;
          if (isExpired && j.attemptCount < 3) {
            console.warn(`[JobQueueService] Found stalled job ${j.jobId} (lease expired). Recovering for retry attempt ${j.attemptCount + 1}`);
            targetIndex = i;
            break;
          }
        }
      }

      if (targetIndex === -1) return null;

      const job = jobs[targetIndex];
      job.status = 'processing';
      job.workerLeaseId = workerLeaseId;
      job.lastHeartbeatAt = nowIso;
      job.updatedAt = nowIso;
      job.attemptCount += 1;

      await this.writeJobsUnsafe(jobs);
      return job;
    });
  }

  /**
   * Heartbeat ping to keep worker lease active during multi-pass debates
   */
  public async updateHeartbeat(jobId: string, workerLeaseId: string): Promise<boolean> {
    return this.withLock(async () => {
      const jobs = this.readJobsUnsafe();
      const job = jobs.find((j) => j.jobId === jobId);
      if (job && job.workerLeaseId === workerLeaseId && job.status === 'processing') {
        const now = new Date().toISOString();
        job.lastHeartbeatAt = now;
        job.updatedAt = now;
        await this.writeJobsUnsafe(jobs);
        return true;
      }
      return false;
    });
  }

  /**
   * Mark job completed
   */
  public async completeJob(jobId: string, workerLeaseId: string, result?: any): Promise<boolean> {
    return this.withLock(async () => {
      const jobs = this.readJobsUnsafe();
      const job = jobs.find((j) => j.jobId === jobId);
      if (job) {
        const now = new Date().toISOString();
        job.status = 'completed';
        job.workerLeaseId = undefined;
        job.updatedAt = now;
        job.result = result;
        await this.writeJobsUnsafe(jobs);
        return true;
      }
      return false;
    });
  }

  /**
   * Mark job failed
   */
  public async failJob(jobId: string, workerLeaseId: string, error: string): Promise<boolean> {
    return this.withLock(async () => {
      const jobs = this.readJobsUnsafe();
      const job = jobs.find((j) => j.jobId === jobId);
      if (job) {
        const now = new Date().toISOString();
        job.status = 'failed';
        job.workerLeaseId = undefined;
        job.updatedAt = now;
        job.error = error;
        await this.writeJobsUnsafe(jobs);
        return true;
      }
      return false;
    });
  }

  /**
   * List all queued jobs
   */
  public async getJobs(): Promise<JobRecord[]> {
    return this.withLock(async () => {
      return this.readJobsUnsafe();
    });
  }
}

export const jobQueueService = new JobQueueService();
