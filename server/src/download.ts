/**
 * Vault downloads. The buyer gets the zip the seller uploaded, exactly as it passed the
 * scanner, streamed out of the vault store; nothing is rebuilt. Links are short-lived HMAC
 * tokens because browsers cannot attach an Authorization header to a navigation.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
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
