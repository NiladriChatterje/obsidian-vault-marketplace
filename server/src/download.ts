/**
 * Vault downloads. A vault is its notes, so the zip is assembled from Sanity on
 * demand: every note becomes `<path>` with its markdown body, attachments are
 * pulled from the asset CDN. Links are short-lived HMAC tokens because browsers
 * cannot attach an Authorization header to a navigation.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { zipSync } from 'fflate';
import { SANITY_API_TOKEN, getAllNoteContents, incrementDownloads, listAttachments } from './sanity/index.ts';
import { cfg } from './config.ts';

const secret = () => cfg.downloadSecret;
const TTL_MS = 5 * 60 * 1000;

export function signDownload(vaultId: string, userId: string): string {
  const payload = Buffer.from(JSON.stringify({ v: vaultId, u: userId, e: Date.now() + TTL_MS })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyDownload(token: string): { vaultId: string; userId: string } | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { v, u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { v: string; u: string; e: number };
    if (!v || !u || Date.now() > e) return null;
    return { vaultId: v, userId: u };
  } catch {
    return null;
  }
}

/** Builds the zip in memory. Vaults are text-heavy, so this stays small; attachments are capped at ingest. */
export async function buildVaultZip(vaultId: string, folderName: string): Promise<Uint8Array> {
  const [notes, attachments] = await Promise.all([getAllNoteContents(vaultId), listAttachments(vaultId)]);
  const files: Record<string, Uint8Array> = {};
  const root = folderName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'vault';
  const encoder = new TextEncoder();
  for (const n of notes) files[`${root}/${n.path}`] = encoder.encode(n.content ?? '');
  await Promise.all(
    attachments.map(async (a) => {
      if (!a.url) return;
      const res = await fetch(a.url, { headers: SANITY_API_TOKEN ? { Authorization: `Bearer ${SANITY_API_TOKEN}` } : undefined });
      if (res.ok) files[`${root}/${a.path}`] = new Uint8Array(await res.arrayBuffer());
    })
  );
  if (!Object.keys(files).length) files[`${root}/README.md`] = encoder.encode('# Empty vault\n\nThis listing has no notes yet.\n');
  void incrementDownloads(vaultId);
  return zipSync(files, { level: 6 });
}
