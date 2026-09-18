/**
 * The upload store: where a seller's zip waits between the browser and the worker.
 *
 * Any S3-compatible bucket; docker-compose runs MinIO. The browser is handed a presigned PUT
 * link and sends the archive there itself, so the API never carries the bytes and a rush of
 * uploads costs it nothing but a few small JSON requests. The worker reads the object out
 * when its turn comes and deletes it once it is in Sanity; a lifecycle rule sweeps anything
 * left behind after a day, so an abandoned upload cannot pile up.
 *
 * With no MINIO_* configured this module is inert and uploads take the inline path (see
 * vault-upload.ts).
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'minio';
import { cfg } from './config.ts';

export const UPLOAD_STORE_ENABLED = !!(cfg.uploadStore.endpoint && cfg.uploadStore.accessKey && cfg.uploadStore.secretKey);

const BUCKET = cfg.uploadStore.bucket;
/** Everything the browser puts lands under here; the lifecycle rule below is scoped to it. */
const PREFIX = 'incoming/';
/** How long a presigned link is good for. The 70 MB ceiling on a slow line needs minutes, not hours. */
const PRESIGN_SECONDS = 15 * 60;
/**
 * Fixed rather than discovered. minio-js would otherwise ask the endpoint for the bucket's
 * region before signing, and the client that signs for the browser is pointed at an address
 * this process may not be able to reach at all (localhost:9000 from inside a container).
 */
const REGION = 'us-east-1';

function clientFor(url: string): Client {
  const u = new URL(url);
  return new Client({
    endPoint: u.hostname,
    port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
    useSSL: u.protocol === 'https:',
    accessKey: cfg.uploadStore.accessKey,
    secretKey: cfg.uploadStore.secretKey,
    region: REGION,
    pathStyle: true,
  });
}

let internal: Client | null = null;
/** Talks to the store over the network the API and worker share. */
const store = (): Client => (internal ??= clientFor(cfg.uploadStore.endpoint));

let signer: Client | null = null;
/**
 * Signs links for the browser. A presigned URL carries the host it was signed for, so this
 * client is configured with the store's public address; it never sends a request itself.
 */
const presigner = (): Client => (signer ??= clientFor(cfg.uploadStore.publicUrl || cfg.uploadStore.endpoint));

let ready: Promise<void> | null = null;

/** Creates the bucket and its sweep rule once per process. Safe to call every time. */
export function ensureBucket(): Promise<void> {
  ready ??= (async () => {
    if (!(await store().bucketExists(BUCKET))) {
      // Two processes booting together both see no bucket; the second create is not an error.
      await store().makeBucket(BUCKET, REGION).catch((e: { code?: string }) => {
        if (e.code !== 'BucketAlreadyOwnedByYou' && e.code !== 'BucketAlreadyExists') throw e;
      });
    }
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
export async function objectSize(key: string): Promise<number | null> {
  try {
    return (await store().statObject(BUCKET, key)).size;
  } catch (e) {
    if ((e as { code?: string }).code === 'NotFound') return null;
    throw e;
  }
}

/** The whole object. Callers check `objectSize` first; nothing here caps it. */
export async function readObject(key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await store().getObject(BUCKET, key)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Deletes the object. Already gone is fine: the sweep rule or another attempt got there first. */
export async function removeObject(key: string): Promise<void> {
  await store().removeObject(BUCKET, key).catch(() => {});
}
