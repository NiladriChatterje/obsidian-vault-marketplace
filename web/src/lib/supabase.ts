import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

/** Returns the shared browser client, or null in demo mode. Sessions persist in localStorage. */
export function getSupabase(): SupabaseClient | null {
  if (IS_DEMO) return null;
  return (client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }));
}

export function requireSupabase(): SupabaseClient {
  const c = getSupabase();
  if (!c) throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  return c;
}
