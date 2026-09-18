/**
 * The upload worker: the consumer end of the scan queue.
 *
 * The API takes a seller's zip only as far as the upload store and a ticket in the queue
 * (server/src/upload-queue.ts). This process takes the tickets, a few at a time, and does the
 * work the API used to do inline: pull the zip from the store, post it to the scanner, unpack
 * it, check the quota, write it to Sanity. The steps themselves are the API's own code,
 * imported from server/src, so a zip is judged the same way whichever path it took.
 *
 * Nothing here is reachable over the network. It talks to Redis, the store, the scanner and
 * Sanity, and to nobody else. Run several for throughput; they share the queue.
 *
 *   npm run dev      # reads ../.env, restarts on change
 */
import '../../server/src/env.ts'; // must stay first: shared modules read process.env when imported
import { createClient } from '@sanity/client';
import { UnrecoverableError, Worker } from 'bullmq';
import { cfg } from '../../server/src/config.ts';
import { MALWARE_SCAN_ENABLED } from '../../server/src/malware.ts';
import { SANITY_API_TOKEN, useSanityClientFactory } from '../../server/src/sanity/index.ts';
import { QUEUE_NAME, UPLOAD_QUEUE_ENABLED, queueConnection, type ScanJob } from '../../server/src/upload-queue.ts';
import { ensureBucket, objectSize, readObject, removeObject } from '../../server/src/upload-store.ts';
import { MAX_ZIP_BYTES, MAX_ZIP_LABEL, UploadRejected, processVaultZip, type VaultUploadResult } from '../../server/src/vault-upload.ts';

if (!UPLOAD_QUEUE_ENABLED) throw new Error('QUEUE_REDIS_URL, MINIO_ENDPOINT, MINIO_ACCESS_KEY and MINIO_SECRET_KEY must all be set: the worker has no queue to consume.');
if (!SANITY_API_TOKEN) throw new Error('SANITY_API_TOKEN is required: the worker writes every vault it accepts to Sanity.');

// The cast is for a laptop only: there worker/ and server/ each have their own install of
// @sanity/client, and TypeScript treats the two identical SanityClient types as strangers.
// The image has one node_modules and no such doubling.
useSanityClientFactory(createClient as unknown as Parameters<typeof useSanityClientFactory>[0]);

const stamp = () => new Date().toISOString();
const log = {
  info: (obj: object, msg: string) => console.log(stamp(), msg, JSON.stringify(obj)),
  warn: (obj: object, msg: string) => console.warn(stamp(), msg, JSON.stringify(obj)),
  error: (obj: unknown, msg: string) => console.error(stamp(), msg, obj instanceof Error ? obj.message : obj),
};

if (!MALWARE_SCAN_ENABLED) log.warn({}, 'SCANNER_URL is not set: vaults are unpacked unscanned (fine on a laptop, nowhere else)');

// The store may still be starting when this does (compose brings them up together). Waiting
// beats dying: a crash-loop until MinIO answers is the same wait with a noisier log.
for (let attempt = 1; ; attempt++) {
  try {
    await ensureBucket();
    break;
  } catch (e) {
    log.warn({ attempt, endpoint: cfg.uploadStore.endpoint, reason: e instanceof Error ? e.message : String(e) }, 'upload store not answering yet, retrying in 3s');
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const worker = new Worker<ScanJob, VaultUploadResult>(
  QUEUE_NAME,
  async (job) => {
    const { key, userId, replacingVaultId } = job.data;
    // Sized again here, not only when the ticket was written: the presigned link stays good for
    // a while after, and the object could have been replaced with a bigger one in the meantime.
    const size = await objectSize(key);
    if (size === null) throw new UnrecoverableError('The zip is no longer in the upload store. Upload it again.');
    try {
      if (size > MAX_ZIP_BYTES) throw new UploadRejected(413, `Zip is larger than ${MAX_ZIP_LABEL}`);
      const result = await processVaultZip(await readObject(key), userId, log, replacingVaultId);
      await removeObject(key);
      return result;
    } catch (e) {
      // The seller's problem (bad zip, malware, over quota) is final: no retry will change it.
      // A scanner that was down, or Sanity that was not answering, is ours: BullMQ tries again.
      if (e instanceof UploadRejected && !e.transient) throw new UnrecoverableError(e.message);
      throw e;
    }
  },
  { connection: queueConnection(), concurrency: cfg.uploadQueue.concurrency },
);

worker.on('completed', (job, result) => log.info({ job: job.id, sellerId: job.data.userId, bundle: result.path, notes: result.noteCount, bytes: result.sizeBytes }, 'vault ingested'));
worker.on('failed', async (job, err) => {
  if (!job) return log.error(err, 'a job failed before it could be read');
  const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
  log.warn({ job: job.id, sellerId: job.data.userId, attempt: job.attemptsMade, final, reason: err.message }, final ? 'upload failed' : 'upload attempt failed, will retry');
  // Nothing will read the object again once the ticket is dead; the sweep rule is only the backstop.
  if (final) await removeObject(job.data.key);
});
// A dropped Redis connection is reported here; without a listener it would take the process down.
worker.on('error', (err) => log.error(err, 'worker error'));

log.info({ queue: QUEUE_NAME, concurrency: cfg.uploadQueue.concurrency, scan: MALWARE_SCAN_ENABLED }, 'upload worker ready');

// Finish what is in hand, then leave; a job cut off mid-way would otherwise stall until BullMQ noticed.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await worker.close();
    process.exit(0);
  });
}
