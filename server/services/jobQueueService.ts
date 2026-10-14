import { neonDb } from '../db/neonService.ts';

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

const HEARTBEAT_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

export class JobQueueService {
  private inMemoryJobs = new Map<string, JobRecord>();

  /**
   * Check if MessageSid exists already for deduplication
   */
  public async getJobByMessageSid(messageSid: string): Promise<JobRecord | null> {
    if (!messageSid) return null;
    const row = await neonDb.getJobByMessageSid(messageSid);
    if (row) return this.mapRowToJob(row);
    return this.inMemoryJobs.get(messageSid) || null;
  }

  /**
   * Atomically enqueue inbound WhatsApp message job with deduplication
   */
  public async enqueueInboundJob(
    messageSid: string,
    senderPhone: string,
    payload: { body: string; from: string; to: string; messageSid: string; [key: string]: any }
  ): Promise<{ job: JobRecord | null; isDuplicate: boolean }> {
    const existing = await this.getJobByMessageSid(messageSid);
    if (existing) {
      console.log(`[JobQueueService] Duplicate MessageSid detected: ${messageSid}. Skipping.`);
      return { job: existing, isDuplicate: true };
    }

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newJob: JobRecord = {
      jobId,
      messageSid,
      senderPhone,
      channel: 'whatsapp',
      status: 'pending',
      attemptCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      payload,
    };
    this.inMemoryJobs.set(messageSid, newJob);

    await neonDb.insertJob({
      id: jobId,
      message_sid: messageSid,
      sender_phone: senderPhone,
      payload,
    }).catch(() => {});

    return { job: newJob, isDuplicate: false };
  }

  /**
   * Claim next pending job OR expired lease job
   */
  public async claimNextJob(workerLeaseId: string): Promise<JobRecord | null> {
    const row = await neonDb.claimNextJob(workerLeaseId, HEARTBEAT_EXPIRATION_MS);
    if (row) {
      const mapped = this.mapRowToJob(row);
      this.inMemoryJobs.set(mapped.messageSid, mapped);
      return mapped;
    }

    // Local in-memory claim if database offline
    for (const job of this.inMemoryJobs.values()) {
      if (job.status === 'pending') {
        job.status = 'processing';
        job.workerLeaseId = workerLeaseId;
        job.attemptCount += 1;
        job.lastHeartbeatAt = new Date().toISOString();
        job.updatedAt = new Date().toISOString();
        return job;
      }
    }
    return null;
  }

  /**
   * Heartbeat ping to keep worker lease active during multi-pass debates
   */
  public async updateHeartbeat(jobId: string, workerLeaseId: string): Promise<boolean> {
    for (const job of this.inMemoryJobs.values()) {
      if (job.jobId === jobId && job.workerLeaseId === workerLeaseId) {
        job.lastHeartbeatAt = new Date().toISOString();
        job.updatedAt = new Date().toISOString();
        break;
      }
    }
    return await neonDb.updateJobHeartbeat(jobId, workerLeaseId);
  }

  /**
   * Mark job completed
   */
  public async completeJob(jobId: string, workerLeaseId: string, result?: any): Promise<boolean> {
    for (const job of this.inMemoryJobs.values()) {
      if (job.jobId === jobId) {
        job.status = 'completed';
        job.result = result;
        job.updatedAt = new Date().toISOString();
        break;
      }
    }
    return await neonDb.updateJobStatus(jobId, workerLeaseId, 'completed', result);
  }

  /**
   * Mark job failed
   */
  public async failJob(jobId: string, workerLeaseId: string, error: string): Promise<boolean> {
    for (const job of this.inMemoryJobs.values()) {
      if (job.jobId === jobId) {
        job.status = 'failed';
        job.error = error;
        job.updatedAt = new Date().toISOString();
        break;
      }
    }
    return await neonDb.updateJobStatus(jobId, workerLeaseId, 'failed', undefined, error);
  }

  /**
   * List all queued jobs
   */
  public async getJobs(): Promise<JobRecord[]> {
    const rows = await neonDb.getJobList(50);
    return rows.map((r) => this.mapRowToJob(r));
  }

  private mapRowToJob(row: any): JobRecord {
    return {
      jobId: row.id,
      messageSid: row.message_sid,
      senderPhone: row.sender_phone,
      channel: row.channel,
      status: row.status,
      workerLeaseId: row.worker_lease_id,
      lastHeartbeatAt: row.last_heartbeat_at,
      attemptCount: row.attempt_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payload: row.payload,
      result: row.result,
      error: row.error,
    };
  }
}

export const jobQueueService = new JobQueueService();
