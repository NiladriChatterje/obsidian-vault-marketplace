/**
 * The scan queue between the API and the worker: BullMQ over Redis.
 *
 * The queue does not carry the zip, only a ticket saying where in the upload store it is and
 * whose it is (see upload-store.ts). The API adds a ticket and answers the browser at once;
 * a worker (worker/) takes tickets as fast as it can scan them and no faster, so a rush of
 * uploads waits in line instead of thrashing the scanner into timeouts. The browser polls
 * `uploadJobStatus` until its ticket is done or failed.
 *
 * Active only when QUEUE_REDIS_URL and the store are both set; otherwise every upload takes
 * the inline path and this module is never touched. QUEUE_REDIS_URL is deliberately not
 * REDIS_URL: sign-in codes are five-minute secrets and jobs are a work log. They may share an
 * instance, but nothing says they have to.
 */
import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { cfg } from './config.ts';
import { UPLOAD_STORE_ENABLED } from './upload-store.ts';
import type { VaultUploadResult } from './vault-upload.ts';

export const QUEUE_NAME = 'vault-uploads';

export const UPLOAD_QUEUE_ENABLED = !!cfg.uploadQueue.redisUrl && UPLOAD_STORE_ENABLED;

/** One ticket: the object to scan and the seller it belongs to. */
export interface ScanJob {
  key: string;
  userId: string;
  /** The listing this zip replaces, left out of the quota; see processVaultZip. */
  replacingVaultId?: string;
}

/**
 * A fresh Redis client for the Queue here or the Worker in worker/, so both connect to the same
 * place the same way. Built here rather than left to BullMQ: under native ESM it cannot load
 * ioredis itself and asks for a ready client. `maxRetriesPerRequest: null` is what BullMQ
 * requires of a worker's connection, so a blocking wait for the next job is never abandoned.
 */
export function queueConnection(): Redis {
  return new Redis(cfg.uploadQueue.redisUrl, { maxRetriesPerRequest: null });
}

/**
 * Three tries with a growing pause covers a scanner that was briefly down or Postgres hiccuping.
 * A zip the seller must fix is failed for good by the worker regardless (UnrecoverableError).
 * Finished jobs are kept long enough for the browser to read the answer, failures for a day so
 * a complaint can be looked into.
 */
const JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: { age: 60 * 60 },
  removeOnFail: { age: 24 * 60 * 60 },
};

let queue: Queue<ScanJob, VaultUploadResult> | null = null;
const uploadQueue = (): Queue<ScanJob, VaultUploadResult> => (queue ??= new Queue(QUEUE_NAME, { connection: queueConnection(), defaultJobOptions: JOB_OPTIONS }));

/** Adds a ticket and returns its id, which the browser polls with. Rejects when Redis is unreachable. */
export async function enqueueScan(data: ScanJob): Promise<string> {
  const job = await uploadQueue().add('scan', data);
  return String(job.id);
}

export type UploadJobStatus =
  | { state: 'queued' | 'scanning' }
  | { state: 'done'; result: VaultUploadResult }
  | { state: 'failed'; error: string };

/** Where a seller's upload is. Null for an id that is not theirs, or one the queue has forgotten. */
export async function uploadJobStatus(jobId: string, userId: string): Promise<UploadJobStatus | null> {
  const job = await uploadQueue().getJob(jobId);
  if (!job || job.data.userId !== userId) return null;
  const state = await job.getState();
  if (state === 'completed') return { state: 'done', result: job.returnvalue };
  if (state === 'failed') return { state: 'failed', error: job.failedReason || 'Upload failed' };
  if (state === 'active') return { state: 'scanning' };
  // waiting, delayed (a retry is due), prioritized: all "not yet" to the seller.
  return { state: 'queued' };
}
