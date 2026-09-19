/**
 * The vault store: where a listing's bytes live for good.
 *
 * Postgres holds what is queried about a vault (the listing, the note index, the seller's
 * plan; see supabase/migrations/0018). This bucket holds what is merely large:
 *
 *   bundles/<bundle>.zip        the scanned upload, exactly as it passed the scanner; this IS
 *                               the buyer's download, never rebuilt
 *   bundles/<bundle>/<path>     every note body and attachment, read one at a time by path for
 *                               the reader, MCP and in-vault search
 *   covers/<uuid>.<ext>         listing covers, served by GET /files/covers/:name
 *
 * A separate bucket from the scan buffer in upload-store.ts on purpose: that one is transient
 * and swept daily, this one is the product. docker-compose runs them as two MinIO containers;
 * in production this is the one that moves to R2 or OCI Object Storage.
 */
import type { Readable } from 'node:stream';
import type { Client } from 'minio';
import { cfg } from './config.ts';
import { ensureBucketExists, mapLimit, openObject, readWhole, removeByPrefix, s3Client } from './s3.ts';

export const VAULT_STORE_ENABLED = !!(cfg.vaultStore.endpoint && cfg.vaultStore.accessKey && cfg.vaultStore.secretKey);

const BUCKET = cfg.vaultStore.bucket;

let client: Client | null = null;
const store = (): Client => (client ??= s3Client(cfg.vaultStore));

let ready: Promise<void> | null = null;
/** Creates the bucket once per process. Safe to call every time. */
export function ensureVaultBucket(): Promise<void> {
  ready ??= ensureBucketExists(store(), BUCKET).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/* ---------- keys ---------- */

export const zipKey = (bundle: string): string => `bundles/${bundle}.zip`;
export const filePrefix = (bundle: string): string => `bundles/${bundle}/`;
export const fileKey = (bundle: string, path: string): string => `${filePrefix(bundle)}${path}`;
export const coverKey = (name: string): string => `covers/${name}`;

/* ---------- objects ---------- */

export async function putObject(key: string, data: Uint8Array, contentType: string): Promise<void> {
  await ensureVaultBucket();
  await store().putObject(BUCKET, key, Buffer.from(data.buffer, data.byteOffset, data.byteLength), data.byteLength, { 'Content-Type': contentType });
}

/** Writes many objects with a few in flight at once; one zip's worth of notes is hundreds of small puts. */
export async function putObjects(items: { key: string; data: Uint8Array; contentType: string }[], concurrency = 8): Promise<void> {
  await ensureVaultBucket();
  await mapLimit(items, concurrency, (f) => putObject(f.key, f.data, f.contentType));
}

/** The whole object, or null when it is not there. */
export async function readObject(key: string): Promise<Buffer | null> {
  try {
    return await readWhole(store(), BUCKET, key);
  } catch (e) {
    if ((e as { code?: string }).code === 'NoSuchKey' || (e as { code?: string }).code === 'NotFound') return null;
    throw e;
  }
}

/** Several objects, a few at a time, in the order asked. Missing ones come back null. */
export function readObjects(keys: string[], concurrency = 16): Promise<(Buffer | null)[]> {
  return mapLimit(keys, concurrency, (k) => readObject(k));
}

/** The object as a stream with its size, for sending straight to a response. Null when absent. */
export function streamObject(key: string): Promise<{ stream: Readable; size: number } | null> {
  return openObject(store(), BUCKET, key);
}

/** Deletes one object. Already gone is fine. */
export async function removeObject(key: string): Promise<void> {
  await store().removeObject(BUCKET, key).catch(() => {});
}

/** Everything a bundle put in the store: its files and its zip. */
export async function removeBundleObjects(bundle: string): Promise<void> {
  await removeByPrefix(store(), BUCKET, filePrefix(bundle));
  await removeObject(zipKey(bundle));
}

/* ---------- content types ---------- */

const MIME: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  canvas: 'application/json',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  html: 'text/html; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  zip: 'application/zip',
};

/** A content type from the file name. Unknown extensions are plain bytes. */
export function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}
