/**
 * Browser side of MCP access: mint a personal token, store only its SHA-256
 * hash in `mcp_tokens` (RLS: own row only). The plaintext is shown once.
 * The payment server's /mcp route resolves the hash with the service role key.
 */
import { api } from '@/lib/api';
import { requireSupabase } from '@/lib/supabase';

export const DEMO_MCP_TOKEN = 'vm_demo_token';

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `vm_${b64}`;
}

/** Whether the signed-in user already has a token (plaintext is not recoverable). */
export async function hasMcpToken(): Promise<boolean> {
  if (api.isDemo) return true;
  const sb = requireSupabase();
  const { count, error } = await sb.from('mcp_tokens').select('user_id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/** Creates (or rotates) the user's token and returns the plaintext once. */
export async function createMcpToken(): Promise<string> {
  if (api.isDemo) return DEMO_MCP_TOKEN;
  const sb = requireSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Error('Please sign in first.');
  const token = randomToken();
  const { error } = await sb.from('mcp_tokens').upsert({ user_id: data.user.id, token_hash: await sha256Hex(token) }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return token;
}

export async function revokeMcpToken(): Promise<void> {
  if (api.isDemo) return;
  const sb = requireSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) return;
  const { error } = await sb.from('mcp_tokens').delete().eq('user_id', data.user.id);
  if (error) throw new Error(error.message);
}
