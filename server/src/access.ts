/**
 * Who is calling, and may they read a vault's contents?
 * Supabase mode: bearer token -> auth user; ownership = purchases row or being the seller.
 * Demo mode (no Supabase): the client sends `x-demo-user`; purchases live in the client,
 * so the server trusts demo callers for content reads. Never run demo mode publicly.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Vault } from '../../src/types.ts';
import { IS_DEMO } from './config.ts';
import { admin, userFromRequest, type AuthUser } from './supabase.ts';

export interface Requester extends AuthUser {
  demo: boolean;
  /** Demo callers may describe their seller profile since there is no database. */
  seller?: { username: string; displayName: string };
}

export async function requester(req: FastifyRequest): Promise<Requester | null> {
  if (IS_DEMO) {
    const id = req.headers['x-demo-user'];
    if (typeof id !== 'string' || !id) return null;
    const username = req.headers['x-demo-username'];
    const displayName = req.headers['x-demo-displayname'];
    return {
      id,
      email: null,
      demo: true,
      seller: {
        username: typeof username === 'string' && username ? username : id.replace(/^demo-/, '').slice(0, 24) || 'seller',
        displayName: typeof displayName === 'string' && displayName ? decodeURIComponent(displayName) : 'Seller',
      },
    };
  }
  const u = await userFromRequest(req);
  return u ? { ...u, demo: false } : null;
}

export async function requireRequester(req: FastifyRequest, reply: FastifyReply): Promise<Requester | null> {
  const r = await requester(req);
  if (!r) reply.code(401).send({ error: 'Not signed in' });
  return r;
}

export async function hasPurchase(userId: string, vaultId: string): Promise<boolean> {
  if (IS_DEMO) return false;
  const { data } = await admin().from('purchases').select('id').eq('vault_id', vaultId).eq('buyer_id', userId).maybeSingle();
  return !!data;
}

/** Owner = seller of the vault or a buyer. Demo callers count as owners (see module doc). */
export async function ownsVault(r: Requester | null, vault: Vault): Promise<boolean> {
  if (!r) return false;
  if (r.demo) return true;
  if (vault.sellerId === r.id) return true;
  return hasPurchase(r.id, vault.id);
}

/** Seller profile fields for the Sanity `seller` document. */
export async function sellerProfile(r: Requester): Promise<{ userId: string; username: string; displayName: string; bio?: string | null; avatarUrl?: string | null }> {
  if (r.demo) return { userId: r.id, username: r.seller?.username ?? 'seller', displayName: r.seller?.displayName ?? 'Seller' };
  const { data, error } = await admin().from('profiles').select('username, display_name, bio, avatar_url').eq('id', r.id).single();
  if (error || !data) throw new Error('Profile not found');
  return { userId: r.id, username: data.username, displayName: data.display_name ?? data.username, bio: data.bio, avatarUrl: data.avatar_url };
}
