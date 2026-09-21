/**
 * What happens to a seller's zip once it is in hand: scanned, unpacked, checked against their
 * storage quota, and written to the catalog as a bundle: its index in Postgres, its bytes in the store.
 *
 * One function with two callers. `POST /uploads/vault-zip` (routes/catalog.ts) runs it inline
 * and answers the seller when it is done. The worker in `worker/` runs the very same steps on a
 * zip it pulled out of the upload store (see upload-queue.ts), then reports through the queue.
 * The steps live here so the two paths cannot drift: a zip is accepted or refused for the same
 * reasons, with the same words, whichever way it arrived.
 */
import { unzipSync } from 'fflate';
import * as catalog from './catalog/index.ts';
import { whyRefused } from './catalog/file-policy.ts';
import { isIgnoredPath, stripCommonRoot } from './catalog/markdown.ts';
import { platformFee } from './config.ts';
import { MALWARE_SCAN_ENABLED, scanForMalware } from './malware.ts';
import { planFor } from './plans.ts';

/** The authority on vault size. The clients copy it as MAX_VAULT_ZIP_BYTES to reject early. */
export const MAX_ZIP_BYTES = 70 * 1024 * 1024;
export const MAX_ZIP_LABEL = `${MAX_ZIP_BYTES / (1024 * 1024)} MB`;

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A zip refused for a reason the seller is told about. `statusCode` is what the HTTP route
 * answers with. Only the 503 is worth trying again later: the scanner was not answering, which
 * says nothing about the zip. Every other code is final for that archive.
 */
export class UploadRejected extends Error {
  readonly statusCode: 400 | 413 | 422 | 503;

  constructor(statusCode: 400 | 413 | 422 | 503, message: string) {
    super(message);
    this.name = 'UploadRejected';
    this.statusCode = statusCode;
  }

  /** True when the same zip may well go through on a retry. */
  get transient(): boolean {
    return this.statusCode === 503;
  }
}

/** What the seller gets back. `path` keeps the client's VaultInput.filePath contract: it carries the bundle id. */
export interface VaultUploadResult {
  path: string;
  sizeBytes: number;
  noteCount: number;
  attachmentCount: number;
  skipped: string[];
  fee: number;
}

/** The two log calls this makes, in pino's (object, message) shape; console fits it too. */
export interface UploadLog {
  warn(obj: object, msg: string): void;
  error(obj: unknown, msg: string): void;
}

/**
 * Scans, unpacks, quota-checks and ingests one zip. Throws `UploadRejected` for anything the
 * seller did; lets anything else (Postgres or the store down, a bug) propagate for the caller to report.
 *
 * `replacingVaultId` is the listing this zip will replace, whose current size is left out of the
 * quota since saving frees it. Absent for a listing that has not been saved yet.
 */
export async function processVaultZip(zip: Uint8Array, userId: string, log: UploadLog, replacingVaultId?: string): Promise<VaultUploadResult> {
  // Scanned before a byte of it is unpacked or written: this archive becomes a product other
  // people download, and being named .zip says nothing about what is inside. A scanner we
  // cannot reach refuses the upload; the alternative is a check that disappears exactly when
  // something is wrong.
  if (MALWARE_SCAN_ENABLED) {
    const verdict = await scanForMalware(zip).catch((e) => {
      log.error(e, 'malware scan failed');
      return null;
    });
    if (!verdict) throw new UploadRejected(503, 'The malware scanner is not answering, so this upload was not accepted. Try again in a few minutes.');
    if (!verdict.clean) {
      log.warn({ sellerId: userId, signature: verdict.signature }, 'upload rejected by malware scan');
      throw new UploadRejected(422, `That zip was refused: the scanner found ${verdict.signature} in it. Check the vault on your own machine before uploading it again.`);
    }
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength));
  } catch {
    throw new UploadRejected(400, 'That file is not a valid zip archive');
  }
  // Windows tooling (PowerShell's Compress-Archive) writes entry names with backslashes, against
  // the zip spec. Normalise before anything reads a path: the common-root strip, the folder split
  // and the object key all assume '/', so a backslash zip would otherwise strip no root at all
  // and store the whole thing as single files named "vault\Templates\Daily note.md".
  const files = Object.entries(entries)
    .map(([path, data]) => ({ path: path.replace(/\\/g, '/'), data }))
    .filter((f) => !f.path.endsWith('/') && f.data.byteLength > 0);
  if (!files.length) throw new UploadRejected(400, 'The zip is empty');

  // Every file that would be stored is judged by its bytes (catalog/file-policy.ts): a vault
  // is notes and text, and an image renamed `.md` is still an image. One bad file refuses the
  // whole zip, named, rather than being dropped quietly; the seller should know what they packed.
  const strip = stripCommonRoot(files.map((f) => f.path));
  for (const file of files) {
    const path = strip(file.path);
    if (!path || isIgnoredPath(path)) continue;
    const reason = whyRefused(path, file.data);
    if (reason) throw new UploadRejected(422, `That zip was refused: "${path}" ${reason}. Remove it and upload again.`);
  }

  // Checked against the unpacked bytes, not the zip: what the quota measures is what gets
  // stored. The ceiling is the seller's plan, across all their listings (plans.ts). Done
  // before ingest so a vault that will not fit is never written at all.
  const incoming = catalog.bundleBytes(files);
  const [used, plan] = await Promise.all([catalog.storageUsed(userId, replacingVaultId), planFor(userId)]);
  if (used + incoming > plan.quotaBytes) {
    throw new UploadRejected(
      413,
      `That vault unpacks to ${mb(incoming)}, and only ${mb(Math.max(0, plan.quotaBytes - used))} of the ${mb(plan.quotaBytes)} on your ${plan.label} plan is free. Delete a listing you no longer sell, upload a smaller vault, or move to a bigger plan.`,
    );
  }

  // The archive itself goes to the store too: it is what buyers download, exactly as scanned.
  const summary = await catalog.ingestBundle(files, userId, zip);
  if (!summary.noteCount) throw new UploadRejected(400, 'No markdown notes found in the zip. Zip the vault folder itself.');
  return { path: summary.bundle, sizeBytes: summary.sizeBytes, noteCount: summary.noteCount, attachmentCount: summary.attachmentCount, skipped: summary.skipped, fee: platformFee(0) };
}
