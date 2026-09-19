/**
 * The upload store: where a seller's zip waits between the browser and the worker.
 *
 * Any S3-compatible bucket; docker-compose runs MinIO. The browser is handed a presigned PUT
 * link and sends the archive there itself, so the API never carries the bytes and a rush of
 * uploads costs it nothing but a few small JSON requests. The worker reads the object out
 * when its turn comes and deletes it once it is in the vault store (vault-store.ts); a
 * lifecycle rule sweeps anything left behind after a day, so an abandoned upload cannot pile up.
 *
 * With no MINIO_* configured this module is inert and uploads take the inline path (see
 * vault-upload.ts).
 */
import { randomUUID } from 'node:crypto';
import type { Client } from 'minio';
import { cfg } from './config.ts';
import { S3_REGION, ensureBucketExists, objectSizeOf, readWhole, s3Client } from './s3.ts';

export const UPLOAD_STORE_ENABLED = !!(cfg.uploadStore.endpoint && cfg.uploadStore.accessKey && cfg.uploadStore.secretKey);

const BUCKET = cfg.uploadStore.bucket;
/** Everything the browser puts lands under here; the lifecycle rule below is scoped to it. */
const PREFIX = 'incoming/';
/** How long a presigned link is good for. The 70 MB ceiling on a slow line needs minutes, not hours. */
const PRESIGN_SECONDS = 15 * 60;

let internal: Client | null = null;
/** Talks to the store over the network the API and worker share. */
const store = (): Client => (internal ??= s3Client(cfg.uploadStore));

let signer: Client | null = null;
/**
 * Signs links for the browser. A presigned URL carries the host it was signed for, so this
 * client is configured with the store's public address; it never sends a request itself
 * (see S3_REGION for why that matters).
 */
const presigner = (): Client => (signer ??= s3Client({ ...cfg.uploadStore, endpoint: cfg.uploadStore.publicUrl || cfg.uploadStore.endpoint }));

let ready: Promise<void> | null = null;

/** Creates the bucket and its sweep rule once per process. Safe to call every time. */
export function ensureBucket(): Promise<void> {
  ready ??= (async () => {
    await ensureBucketExists(store(), BUCKET);
    // Best effort: some S3 stand-ins do not do lifecycle, and the worker deletes on its own anyway.
    await store()
      .setBucketLifecycle(BUCKET, { Rule: [{ ID: 'sweep-incoming', Status: 'Enabled', Filter: { Prefix: PREFIX }, Expiration: { Days: 1 } }] })
      .catch(() => {});
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** A fresh key under the seller's own prefix, which is what `ownsKey` later checks. */
export function incomingKey(userId: string): string {
  return `${PREFIX}${userId}/${randomUUID()}.zip`;
}

/** Whether `key` is one this seller was handed. The prefix is theirs; the rest is ours. */
export function ownsKey(key: string, userId: string): boolean {
  return key.startsWith(`${PREFIX}${userId}/`) && /^[\w./-]+$/.test(key) && !key.includes('..');
}

/** A one-time PUT link for the browser. */
export async function presignUpload(key: string): Promise<string> {
  await ensureBucket();
  return presigner().presignedPutObject(BUCKET, key, PRESIGN_SECONDS);
}

/** Size of the object, or null when nothing is there. */
export function objectSize(key: string): Promise<number | null> {
  return objectSizeOf(store(), BUCKET, key);
}

/** The whole object. Callers check `objectSize` first; nothing here caps it. */
export function readObject(key: string): Promise<Buffer> {
  return readWhole(store(), BUCKET, key);
}

/** Deletes the object. Already gone is fine: the sweep rule or another attempt got there first. */
export async function removeObject(key: string): Promise<void> {
  await store().removeObject(BUCKET, key).catch(() => {});
}

export { S3_REGION };
