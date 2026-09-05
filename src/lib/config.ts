/**
 * Runtime configuration. All values come from EXPO_PUBLIC_* env vars so they
 * are safe to ship in the client bundle (anon key only, never the service key).
 *
 * When SUPABASE_URL is missing the app runs in demo mode: an in-memory
 * marketplace with seed data, fake auth and instant "purchases". This makes the
 * UI fully usable in Expo Go before any backend exists.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

/** Platform commission on every paid sale, in percent. Mirrored in the edge function. */
export const PLATFORM_FEE_PERCENT = Number(process.env.EXPO_PUBLIC_PLATFORM_FEE_PERCENT ?? 15);

/** Minimum price a seller may set for a paid vault, in cents. */
export const MIN_PRICE_CENTS = 199;

export const APP_SCHEME = 'vaultmarket';

export const STORAGE_BUCKETS = {
  covers: 'vault-covers',
  files: 'vault-files',
} as const;

export const MAX_VAULT_ZIP_BYTES = 200 * 1024 * 1024;
