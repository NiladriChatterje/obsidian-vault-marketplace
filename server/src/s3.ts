/**
 * The S3 client both object stores are built on: the scan buffer (upload-store.ts) and the
 * vault store (vault-store.ts). MinIO in docker-compose, R2 or OCI Object Storage in
 * production; the code speaks generic S3 and only the endpoint and keys change.
 */
import type { Readable } from 'node:stream';
import { Client } from 'minio';

export interface S3Config {
  /** http(s)://host[:port] */
  endpoint: string;
  accessKey: string;
  secretKey: string;
}

/**
 * Fixed rather than discovered. minio-js would otherwise ask the endpoint for the bucket's
 * region before signing, and a client that only signs links for the browser may be pointed at
 * an address this process cannot reach at all (localhost:9000 from inside a container).
 */
export const S3_REGION = 'us-east-1';

export function s3Client(c: S3Config): Client {
  const u = new URL(c.endpoint);
  return new Client({
    endPoint: u.hostname,
    port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
    useSSL: u.protocol === 'https:',
    accessKey: c.accessKey,
    secretKey: c.secretKey,
    region: S3_REGION,
    pathStyle: true,
  });
}

/** Creates the bucket if it is missing. Two processes booting together may both try; that is not an error. */
export async function ensureBucketExists(client: Client, bucket: string): Promise<void> {
  if (await client.bucketExists(bucket)) return;
  await client.makeBucket(bucket, S3_REGION).catch((e: { code?: string }) => {
    if (e.code !== 'BucketAlreadyOwnedByYou' && e.code !== 'BucketAlreadyExists') throw e;
  });
}

/** Size of the object, or null when nothing is there. */
export async function objectSizeOf(client: Client, bucket: string, key: string): Promise<number | null> {
  try {
    return (await client.statObject(bucket, key)).size;
  } catch (e) {
    if ((e as { code?: string }).code === 'NotFound') return null;
    throw e;
  }
}

/** The whole object in memory. Callers know what they are asking for; nothing here caps it. */
export async function readWhole(client: Client, bucket: string, key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await client.getObject(bucket, key)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** The object as a stream, or null when it is not there. */
export async function openObject(client: Client, bucket: string, key: string): Promise<{ stream: Readable; size: number } | null> {
  const size = await objectSizeOf(client, bucket, key);
  if (size === null) return null;
  return { stream: await client.getObject(bucket, key), size };
}

/** Deletes every object under `prefix`, in batches. A prefix with nothing under it is fine. */
export async function removeByPrefix(client: Client, bucket: string, prefix: string): Promise<number> {
  const names: string[] = [];
  for await (const item of client.listObjectsV2(bucket, prefix, true)) {
    if ('name' in item && item.name) names.push(item.name);
  }
  for (let i = 0; i < names.length; i += 1000) await client.removeObjects(bucket, names.slice(i, i + 1000));
  return names.length;
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping result order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}
