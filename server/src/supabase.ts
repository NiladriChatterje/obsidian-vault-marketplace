import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FastifyRequest } from 'fastify';
import { IS_DEMO, cfg } from './config.ts';

let client: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS; only used server-side. */
export function admin(): SupabaseClient {
  if (IS_DEMO) throw new Error('Supabase is not configured on the server');
  return (client ??= createClient(cfg.supabase.url, cfg.supabase.serviceKey, { auth: { persistSession: false } }));
}

export interface AuthUser {
  id: string;
  email: string | null;
}

/** Resolves the Supabase user from the app's bearer token, or null. */
export async function userFromRequest(req: FastifyRequest): Promise<AuthUser | null> {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
