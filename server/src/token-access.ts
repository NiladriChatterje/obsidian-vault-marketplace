/**
 * Personal access tokens from the site's Connect page: who is calling, and what do they own.
 *
 * Two clients authenticate this way rather than with a Supabase session: the MCP endpoint
 * (routes/mcp.ts) and the Obsidian plugin's sync routes (routes/sync.ts). Both are read-only
 * over vaults the caller bought or published, so a leaked token can never spend, publish or
 * delete anything — unlike the session bearer that access.ts resolves.
 *
 * Only the sha-256 of a token is stored (supabase/migrations/0002). Demo mode has no database,
 * so it accepts any token and treats the whole catalog as owned; never run demo mode publicly.
 */
import { createHash } from 'node:crypto';
import { IS_DEMO } from './config.ts';
import * as catalog from './catalog/index.ts';
import { admin } from './supabase.ts';
import type { Vault } from './types.ts';

export function bearerToken(auth: string | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(auth ?? '');
  return m?.[1]?.trim() || null;
}

/** Maps a token to a user id, or null when it is unknown or revoked. */
export async function resolveTokenUser(token: string): Promise<string | null> {
  if (IS_DEMO) return 'demo-user';
  const hash = createHash('sha256').update(token).digest('hex');
  const { data, error } = await admin().from('mcp_tokens').select('user_id').eq('token_hash', hash).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id ?? null;
}

/** Everything this user may read: what they bought, plus their own listings (drafts included). */
export async function ownedVaults(userId: string): Promise<Vault[]> {
  if (IS_DEMO) return (await catalog.listVaults({ limit: 100 })).items; // demo purchases live in the browser
  const { data, error } = await admin().from('purchases').select('vault_id').eq('buyer_id', userId);
  if (error) throw new Error(error.message);
  const [bought, mine] = await Promise.all([
    catalog.getVaultsByIds((data ?? []).map((p: { vault_id: string }) => p.vault_id)),
    catalog.getSellerVaults(userId, true),
  ]);
  const seen = new Set<string>();
  return [...bought, ...mine].filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)));
}

export async function requireOwnedVault(userId: string, vaultId: string): Promise<Vault> {
  const v = (await ownedVaults(userId)).find((x) => x.id === vaultId);
  if (!v) throw new Error(`You do not own a vault with id ${vaultId}. Call list_vaults first.`);
  return v;
}
